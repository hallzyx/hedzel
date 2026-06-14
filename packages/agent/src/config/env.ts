import "dotenv/config";

/**
 * Centralised, validated environment access.
 * Missing operational secrets do NOT crash the process — the server can still
 * serve the ACP catalog and run in x402 dev-mode. Each subsystem reports its
 * own readiness so a judge running a clean checkout always gets a booting app.
 */

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim().length > 0 ? v.trim() : undefined;
}

export const env = {
  port: Number(process.env.PORT ?? 3001),
  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",

  hedera: {
    accountId: optional("HEDERA_ACCOUNT_ID"),
    privateKey: optional("HEDERA_PRIVATE_KEY"),
    network: (process.env.HEDERA_NETWORK ?? "testnet") as "testnet" | "mainnet",
  },

  llm: {
    // DeepSeek is OpenAI-compatible; we drive it through @langchain/openai.
    apiKey: optional("DEEPSEEK_API_KEY") ?? optional("OPENAI_API_KEY"),
    baseUrl: process.env.LLM_BASE_URL ?? "https://api.deepseek.com/v1",
    model: process.env.LLM_MODEL ?? "deepseek-chat",
  },

  x402: {
    facilitatorUrl:
      process.env.X402_FACILITATOR_URL ?? "https://api.testnet.blocky402.com",
    // payTo is the treasury account that receives the HBAR micropayments.
    payTo: optional("HEDERA_ACCOUNT_ID") ?? "0.0.0",
    // DEV mode lets the full request→402→pay→fulfill loop run locally with no
    // real on-chain settlement. Set X402_MODE=live for real Blocky402 verification.
    mode: (process.env.X402_MODE ?? "dev") as "dev" | "live",
  },
} as const;

export const mirrorBaseUrl =
  env.hedera.network === "mainnet"
    ? "https://mainnet.mirrornode.hedera.com/api/v1"
    : "https://testnet.mirrornode.hedera.com/api/v1";

export const hashscanBase =
  env.hedera.network === "mainnet"
    ? "https://hashscan.io/mainnet"
    : "https://hashscan.io/testnet";
