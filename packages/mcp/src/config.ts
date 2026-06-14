/**
 * Configuration for the Hedera Insights MCP server.
 *
 * Secrets are read from the environment (set in the MCP client's config), never
 * from CLI arguments — command-line args leak into shell history and process
 * listings. `HEDERA_ACCOUNT_ID` + `HEDERA_PRIVATE_KEY` form the hot wallet the
 * server uses to pay for queries; use a dedicated, low-balance testnet account.
 */

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export type Network = "testnet" | "mainnet";

export const config = {
  /** Hedera Insights agent backend. */
  agentUrl: (process.env.AGENT_URL ?? "http://localhost:3001").replace(/\/$/, ""),
  network: (process.env.HEDERA_NETWORK ?? "testnet") as Network,
  /** Hot wallet that pays for queries. Optional — without it, only free tools (catalog) work. */
  accountId: optional("HEDERA_ACCOUNT_ID"),
  privateKey: optional("HEDERA_PRIVATE_KEY"),
  /** Safety cap: refuse any query priced above this many HBAR. */
  maxSpendHbar: Number(process.env.MAX_SPEND_HBAR ?? "10"),
} as const;

export function hasWallet(): boolean {
  return Boolean(config.accountId && config.privateKey);
}
