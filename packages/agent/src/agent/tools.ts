import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { runService } from "../services/index.js";

/**
 * Custom LangChain tools that call the Mirror Node through our service
 * executors. These are appended to the Hedera Agent Kit's native tools so the
 * LLM can reason over live on-chain data. Each tool maps 1:1 to a sellable
 * service so the agent's answers are grounded in the exact data the buyer paid
 * for.
 */
export function buildMirrorTools(): DynamicStructuredTool[] {
  return [
    new DynamicStructuredTool({
      name: "get_account_intelligence",
      description:
        "Balance, recent transactions and associated tokens for a Hedera account id (0.0.x).",
      schema: z.object({ accountId: z.string() }),
      func: async ({ accountId }) =>
        JSON.stringify((await runService("account-intelligence", { accountId })).data),
    }),
    new DynamicStructuredTool({
      name: "get_token_report",
      description: "Supply, metadata and top holders of an HTS token id (0.0.x).",
      schema: z.object({ tokenId: z.string() }),
      func: async ({ tokenId }) =>
        JSON.stringify((await runService("token-report", { tokenId })).data),
    }),
    new DynamicStructuredTool({
      name: "get_topic_feed",
      description: "Latest messages of an HCS topic id (0.0.x).",
      schema: z.object({ topicId: z.string(), limit: z.number().optional() }),
      func: async ({ topicId, limit }) =>
        JSON.stringify((await runService("topic-feed", { topicId, limit })).data),
    }),
    new DynamicStructuredTool({
      name: "get_network_pulse",
      description: "Live network metrics: estimated TPS, average fee, HBAR supply.",
      schema: z.object({}),
      func: async () => JSON.stringify((await runService("network-pulse", {})).data),
    }),
    new DynamicStructuredTool({
      name: "get_wallet_forensics",
      description: "Frequent counterparties and transfer volume for a Hedera account id.",
      schema: z.object({ accountId: z.string() }),
      func: async ({ accountId }) =>
        JSON.stringify((await runService("wallet-forensics", { accountId })).data),
    }),
  ];
}
