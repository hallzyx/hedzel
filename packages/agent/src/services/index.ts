import {
  mirror,
  MirrorError,
  decodeBase64,
  consensusToDate,
  hbarFromTinybars,
  type MirrorTransaction,
} from "../mirror/client.js";
import { getService } from "../config/services.js";

/**
 * Service executors. Each returns a plain JSON result built entirely from live
 * Mirror Node data. No fabricated numbers — if the network doesn't expose a
 * value, we don't invent it.
 */

export interface InsightResult {
  service_id: string;
  generated_at: string;
  data: Record<string, unknown>;
}

function summariseTx(tx: MirrorTransaction) {
  return {
    transaction_id: tx.transaction_id,
    type: tx.name,
    result: tx.result,
    timestamp: consensusToDate(tx.consensus_timestamp).toISOString(),
    fee_hbar: hbarFromTinybars(tx.charged_tx_fee),
  };
}

async function accountIntelligence(params: { accountId: string }) {
  const [account, txs] = await Promise.all([
    mirror.account(params.accountId),
    mirror.accountTransactions(params.accountId, 10),
  ]);
  return {
    account: account.account,
    balance_hbar: hbarFromTinybars(account.balance.balance),
    evm_address: account.evm_address,
    created_at: account.created_timestamp
      ? consensusToDate(account.created_timestamp).toISOString()
      : null,
    associated_tokens: account.balance.tokens.map((t) => ({
      token_id: t.token_id,
      balance: t.balance,
    })),
    recent_transactions: txs.transactions.map(summariseTx),
  };
}

async function tokenReport(params: { tokenId: string }) {
  const [token, balances] = await Promise.all([
    mirror.token(params.tokenId),
    mirror.tokenBalances(params.tokenId, 10),
  ]);
  const decimals = Number(token.decimals);
  const factor = 10 ** decimals;
  return {
    token_id: token.token_id,
    name: token.name,
    symbol: token.symbol,
    type: token.type,
    decimals,
    treasury_account_id: token.treasury_account_id,
    total_supply: token.total_supply,
    total_supply_display: Number(token.total_supply) / factor,
    top_holders: balances.balances.map((b, i) => ({
      rank: i + 1,
      account: b.account,
      balance: b.balance / factor,
    })),
  };
}

async function topicFeed(params: { topicId: string; limit?: number }) {
  const limit = params.limit ?? 10;
  const res = await mirror.topicMessages(params.topicId, limit);
  return {
    topic_id: params.topicId,
    message_count: res.messages.length,
    messages: res.messages.map((m) => ({
      sequence_number: m.sequence_number,
      timestamp: consensusToDate(m.consensus_timestamp).toISOString(),
      payer: m.payer_account_id,
      content: decodeBase64(m.message),
    })),
  };
}

async function networkPulse() {
  const [latest, supply] = await Promise.all([
    mirror.latestTransactions(100),
    mirror.networkSupply(),
  ]);
  const txs = latest.transactions;
  // Real TPS estimate from the consensus-timestamp span of the latest sample.
  let tps: number | null = null;
  if (txs.length > 1) {
    const newest = consensusToDate(txs[0].consensus_timestamp).getTime();
    const oldest = consensusToDate(txs[txs.length - 1].consensus_timestamp).getTime();
    const spanSec = (newest - oldest) / 1000;
    tps = spanSec > 0 ? Number((txs.length / spanSec).toFixed(2)) : null;
  }
  const avgFee =
    txs.length > 0
      ? hbarFromTinybars(
          txs.reduce((acc, t) => acc + t.charged_tx_fee, 0) / txs.length,
        )
      : null;
  return {
    sampled_transactions: txs.length,
    estimated_tps: tps,
    average_fee_hbar: avgFee,
    hbar_released_supply: supply.released_supply,
    hbar_total_supply: supply.total_supply,
    sample_window: {
      from: txs.length
        ? consensusToDate(txs[txs.length - 1].consensus_timestamp).toISOString()
        : null,
      to: txs.length
        ? consensusToDate(txs[0].consensus_timestamp).toISOString()
        : null,
    },
  };
}

async function walletForensics(params: { accountId: string }) {
  // Pull a wider window of transactions and aggregate counterparties.
  const res = await mirror.accountTransactions(params.accountId, 100);
  const counterparties = new Map<string, { count: number; volume: number }>();
  for (const tx of res.transactions) {
    for (const transfer of tx.transfers) {
      if (transfer.account === params.accountId) continue;
      const entry = counterparties.get(transfer.account) ?? { count: 0, volume: 0 };
      entry.count += 1;
      entry.volume += Math.abs(hbarFromTinybars(transfer.amount));
      counterparties.set(transfer.account, entry);
    }
  }
  const ranked = [...counterparties.entries()]
    .map(([account, v]) => ({
      account,
      interactions: v.count,
      volume_hbar: Number(v.volume.toFixed(8)),
    }))
    .sort((a, b) => b.interactions - a.interactions)
    .slice(0, 10);
  return {
    account: params.accountId,
    analysed_transactions: res.transactions.length,
    unique_counterparties: counterparties.size,
    top_counterparties: ranked,
  };
}

const EXECUTORS: Record<string, (params: any) => Promise<Record<string, unknown>>> = {
  "account-intelligence": accountIntelligence,
  "token-report": tokenReport,
  "topic-feed": topicFeed,
  "network-pulse": networkPulse,
  "wallet-forensics": walletForensics,
};

/**
 * Existence/type guardrail shared by /chat (for a friendly message) and the
 * x402 gate (to avoid charging). Confirms the id points at the right kind of
 * entity on the mirror node. A transient (non-404) error does NOT block — we
 * assume it exists and let execution surface any real problem.
 */
export async function resourceExists(
  serviceId: string,
  params: Record<string, unknown>,
): Promise<boolean> {
  try {
    switch (serviceId) {
      case "token-report":
        await mirror.token(String(params.tokenId));
        return true;
      case "account-intelligence":
      case "wallet-forensics":
        await mirror.account(String(params.accountId));
        return true;
      case "topic-feed":
        await mirror.topicMessages(String(params.topicId), 1);
        return true;
      default:
        return true; // no id to verify (e.g. network-pulse)
    }
  } catch (err) {
    if (err instanceof MirrorError && err.status === 404) return false;
    return true;
  }
}

/** Validate params against the service schema, then execute. */
export async function runService(
  serviceId: string,
  rawParams: unknown,
): Promise<InsightResult> {
  const service = getService(serviceId);
  if (!service) throw new Error(`Unknown service: ${serviceId}`);
  const params = service.schema.parse(rawParams ?? {});
  const executor = EXECUTORS[serviceId];
  const data = await executor(params);
  return {
    service_id: serviceId,
    generated_at: new Date().toISOString(),
    data,
  };
}
