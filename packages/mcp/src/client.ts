/**
 * x402 buyer client. Encapsulates the whole pay-and-fetch loop so the consuming
 * agent never touches crypto: discover price -> sign and submit an HBAR transfer
 * with the configured key -> retry the gated request with proof of payment.
 *
 * Unlike the browser flow, this is a headless signer with the operator key, so
 * it builds, signs and submits the transaction directly with the Hedera SDK —
 * no WalletConnect, no dropped-response problem.
 */
import {
  Client,
  AccountId,
  PrivateKey,
  TransferTransaction,
  Hbar,
} from "@hiero-ledger/sdk";
import { config } from "./config.js";

const TINYBARS_PER_HBAR = 100_000_000;

export interface CatalogService {
  id: string;
  name: string;
  description: string;
  price: { amount: string; currency: string };
  params_schema: Record<string, unknown>;
}

export interface InsightResponse {
  service_id: string;
  verified: boolean;
  result: { service_id: string; generated_at: string; data: Record<string, unknown> };
  summary: string | null;
  tx_proof?: string;
}

let client: Client | null = null;
let operatorId: AccountId | null = null;

/** Accept either ECDSA or ED25519 keys, like the rest of the project. */
function parsePrivateKey(raw: string): PrivateKey {
  try {
    return PrivateKey.fromStringECDSA(raw);
  } catch {
    return PrivateKey.fromStringED25519(raw);
  }
}

function getClient(): Client {
  if (client && operatorId) return client;
  if (!config.accountId || !config.privateKey) {
    throw new Error(
      "No wallet configured. Set HEDERA_ACCOUNT_ID and HEDERA_PRIVATE_KEY in the MCP server's environment to buy insights.",
    );
  }
  operatorId = AccountId.fromString(config.accountId);
  client = Client.forName(config.network).setOperator(operatorId, parsePrivateKey(config.privateKey));
  return client;
}

export async function getCatalog(): Promise<CatalogService[]> {
  const res = await fetch(`${config.agentUrl}/catalog`);
  if (!res.ok) throw new Error(`Catalog request failed (${res.status})`);
  const body = (await res.json()) as { services: CatalogService[] };
  return body.services;
}

export async function getOrder(sessionId: string): Promise<unknown> {
  const res = await fetch(`${config.agentUrl}/orders/${encodeURIComponent(sessionId)}`);
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `Order request failed (${res.status})`);
  }
  return res.json();
}

interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
}

/**
 * Pay for and fetch one insight. Probes for the 402, settles the HBAR transfer
 * on-chain, then retries with the `X-PAYMENT` header carrying the real tx id.
 */
export async function buyInsight(
  serviceId: string,
  params: Record<string, unknown>,
): Promise<InsightResponse> {
  const body = JSON.stringify({ service_id: serviceId, params });

  // 1. Probe — learn where and how much to pay.
  const probe = await fetch(`${config.agentUrl}/insights`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (probe.status !== 402) {
    if (probe.ok) return (await probe.json()) as InsightResponse; // dev server not gating
    const e = (await probe.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `Request failed (${probe.status})`);
  }

  const quote = (await probe.json()) as { accepts?: PaymentRequirements[] };
  const req = quote.accepts?.[0];
  if (!req) throw new Error("Server did not return payment requirements.");

  const tinybars = Number(req.maxAmountRequired);
  const capTinybars = config.maxSpendHbar * TINYBARS_PER_HBAR;
  if (tinybars > capTinybars) {
    throw new Error(
      `Price ${tinybars / TINYBARS_PER_HBAR} HBAR exceeds the spend cap of ${config.maxSpendHbar} HBAR. ` +
        "Raise MAX_SPEND_HBAR to allow it.",
    );
  }

  // 2. Settle — sign and submit the HBAR transfer to the treasury.
  const c = getClient();
  const amount = Hbar.fromTinybars(tinybars);
  const response = await new TransferTransaction()
    .addHbarTransfer(operatorId!, amount.negated())
    .addHbarTransfer(AccountId.fromString(req.payTo), amount)
    .execute(c);
  const receipt = await response.getReceipt(c);
  if (receipt.status.toString() !== "SUCCESS") {
    throw new Error(`Payment transaction failed with status ${receipt.status.toString()}`);
  }
  const txId = response.transactionId.toString();

  // 3. Retry with proof of payment.
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: `hedera:${config.network}`,
    payload: { from: operatorId!.toString(), txId },
  };
  const header = Buffer.from(JSON.stringify(payload)).toString("base64");
  const res = await fetch(`${config.agentUrl}/insights`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-PAYMENT": header },
    body,
  });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(e.error ?? `Fulfillment failed (${res.status}) — payment ${txId} was submitted.`);
  }
  return (await res.json()) as InsightResponse;
}
