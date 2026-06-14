import { mirrorBaseUrl } from "../config/env.js";

/**
 * Thin client over the Hedera Mirror Node REST API.
 * Public, no auth. This is the source of truth that no LLM can answer from
 * memory — every value here is fetched live, which is what makes a paid query
 * actually worth paying for.
 * Docs: https://docs.hedera.com/hedera/sdks-and-apis/rest-api
 */

export class MirrorError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "MirrorError";
  }
}

async function get<T>(path: string): Promise<T> {
  const url = path.startsWith("http") ? path : `${mirrorBaseUrl}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new MirrorError(`Mirror node ${res.status} for ${path}`, res.status);
    }
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof MirrorError) throw err;
    throw new MirrorError(
      `Mirror node request failed for ${path}: ${(err as Error).message}`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ---- Typed shapes (only the fields we use) ----

export interface MirrorBalance {
  balance: number;
  timestamp: string;
  tokens: { token_id: string; balance: number }[];
}

export interface MirrorAccount {
  account: string;
  balance: MirrorBalance;
  created_timestamp: string | null;
  evm_address: string | null;
  key: { _type: string; key: string } | null;
}

export interface MirrorTransfer {
  account: string;
  amount: number;
}

export interface MirrorTransaction {
  transaction_id: string;
  name: string;
  result: string;
  consensus_timestamp: string;
  charged_tx_fee: number;
  transfers: MirrorTransfer[];
}

export interface MirrorToken {
  token_id: string;
  name: string;
  symbol: string;
  decimals: string;
  total_supply: string;
  type: string;
  treasury_account_id: string;
}

export interface MirrorTokenBalance {
  account: string;
  balance: number;
}

export interface MirrorTopicMessage {
  consensus_timestamp: string;
  sequence_number: number;
  message: string; // base64
  payer_account_id: string;
}

export const mirror = {
  account: (id: string) => get<MirrorAccount>(`/accounts/${id}`),

  /**
   * Fetch a single transaction by id. The mirror node expects the id in
   * `0.0.x-secs-nanos` form, so callers must normalise the SDK's `0.0.x@secs.nanos`
   * shape first. Returns a list because one transaction id can map to several
   * records (e.g. scheduled / triggered children).
   */
  transaction: (mirrorTxId: string) =>
    get<{ transactions: MirrorTransaction[] }>(`/transactions/${mirrorTxId}`),

  accountTransactions: (id: string, limit = 10) =>
    get<{ transactions: MirrorTransaction[] }>(
      `/transactions?account.id=${id}&limit=${limit}&order=desc`,
    ),

  token: (id: string) => get<MirrorToken>(`/tokens/${id}`),

  tokenBalances: (id: string, limit = 10) =>
    get<{ balances: MirrorTokenBalance[] }>(
      `/tokens/${id}/balances?order=desc&limit=${limit}`,
    ),

  topicMessages: (id: string, limit = 10) =>
    get<{ messages: MirrorTopicMessage[] }>(
      `/topics/${id}/messages?order=desc&limit=${limit}`,
    ),

  latestTransactions: (limit = 100) =>
    get<{ transactions: MirrorTransaction[] }>(
      `/transactions?order=desc&limit=${limit}`,
    ),

  networkFees: () => get<unknown>("/network/fees"),

  networkSupply: () =>
    get<{ released_supply: string; total_supply: string; timestamp: string }>(
      "/network/supply",
    ),

  raw: get,
};

export function decodeBase64(b64: string): string {
  try {
    return Buffer.from(b64, "base64").toString("utf-8");
  } catch {
    return b64;
  }
}

/** consensus_timestamp is "seconds.nanos" — convert to JS Date. */
export function consensusToDate(ts: string): Date {
  const [secs] = ts.split(".");
  return new Date(Number(secs) * 1000);
}

export function hbarFromTinybars(tinybars: number): number {
  return tinybars / 100_000_000;
}
