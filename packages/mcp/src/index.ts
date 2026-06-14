#!/usr/bin/env node
/**
 * Hedera Insights MCP server.
 *
 * Exposes the Hedera Insights commerce agent as MCP tools so ANY MCP-capable
 * agent (Claude Code, Claude Desktop, OpenCode, …) can autonomously discover,
 * pay for (in HBAR via x402) and consume on-chain intelligence — no UI, no human.
 *
 * Transport: stdio. IMPORTANT: never write to stdout except the JSON-RPC channel
 * — all diagnostics go to stderr (console.error).
 */
import "./harden.js"; // MUST be first: keeps stdout pure for JSON-RPC before any SDK loads.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { config, hasWallet } from "./config.js";
import {
  buyInsight,
  getCatalog,
  getOrder,
  type InsightResponse,
} from "./client.js";

const ACCOUNT_ID = z.string().regex(/^\d+\.\d+\.\d+$/, "Hedera id in 0.0.x form");

function formatInsight(r: InsightResponse): string {
  const lines: string[] = [];
  if (r.summary) lines.push(r.summary, "");
  lines.push("```json", JSON.stringify(r.result.data, null, 2), "```");
  if (r.tx_proof) lines.push("", `Verified on Hedera · ${r.tx_proof}`);
  return lines.join("\n");
}

function ok(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/** Run a paid query and format the result, turning failures into clean tool errors. */
async function runBuy(serviceId: string, params: Record<string, unknown>) {
  try {
    return ok(formatInsight(await buyInsight(serviceId, params)));
  } catch (err) {
    return fail((err as Error).message);
  }
}

function buildServer(): McpServer {
  const server = new McpServer({ name: "hedera-insights", version: "1.0.0" });

  server.registerTool(
    "list_services",
    {
      title: "List services",
      description:
        "List the Hedera on-chain intelligence services for sale, with their prices in HBAR. Free — no payment.",
      inputSchema: {},
    },
    async () => {
      try {
        const services = await getCatalog();
        const text = services
          .map((s) => `- **${s.id}** (${s.price.amount} ${s.price.currency}): ${s.description}`)
          .join("\n");
        return ok(`Hedera Insights services:\n${text}`);
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  server.registerTool(
    "account_intelligence",
    {
      title: "Account Intelligence",
      description:
        "Buy an Account Intelligence report: balance, last 10 transactions and associated tokens for a Hedera account. Pays the HBAR fee automatically.",
      inputSchema: { accountId: ACCOUNT_ID.describe("Hedera account id, e.g. 0.0.2") },
    },
    async ({ accountId }) => runBuy("account-intelligence", { accountId }),
  );

  server.registerTool(
    "token_report",
    {
      title: "Token Report",
      description:
        "Buy a Token Report: total supply, metadata and top 10 holders of an HTS token. Pays the HBAR fee automatically.",
      inputSchema: { tokenId: ACCOUNT_ID.describe("HTS token id, e.g. 0.0.9233901") },
    },
    async ({ tokenId }) => runBuy("token-report", { tokenId }),
  );

  server.registerTool(
    "topic_feed",
    {
      title: "Topic Feed",
      description:
        "Buy a Topic Feed: the latest messages of an HCS topic, decoded. Pays the HBAR fee automatically.",
      inputSchema: {
        topicId: ACCOUNT_ID.describe("HCS topic id, e.g. 0.0.4320245"),
        limit: z.number().int().min(1).max(50).optional().describe("How many messages (default 10)"),
      },
    },
    async ({ topicId, limit }) =>
      runBuy("topic-feed", limit ? { topicId, limit } : { topicId }),
  );

  server.registerTool(
    "network_pulse",
    {
      title: "Network Pulse",
      description:
        "Buy a Network Pulse snapshot: estimated TPS, average fee and HBAR supply. Pays the HBAR fee automatically.",
      inputSchema: {},
    },
    async () => runBuy("network-pulse", {}),
  );

  server.registerTool(
    "wallet_forensics",
    {
      title: "Wallet Forensics",
      description:
        "Buy a Wallet Forensics report: frequent counterparties and transfer volume for an account. Pays the HBAR fee automatically.",
      inputSchema: { accountId: ACCOUNT_ID.describe("Hedera account id, e.g. 0.0.800") },
    },
    async ({ accountId }) => runBuy("wallet-forensics", { accountId }),
  );

  server.registerTool(
    "buy_insight",
    {
      title: "Buy insight (generic)",
      description:
        "Buy any service by id with arbitrary params. Use the typed tools when possible; this is the escape hatch.",
      inputSchema: {
        service_id: z.enum([
          "account-intelligence",
          "token-report",
          "topic-feed",
          "network-pulse",
          "wallet-forensics",
        ]),
        params: z.record(z.any()).optional().describe("Service params, e.g. { accountId: '0.0.2' }"),
      },
    },
    async ({ service_id, params }) => runBuy(service_id, params ?? {}),
  );

  server.registerTool(
    "get_order",
    {
      title: "Get ACP order",
      description: "Look up the status of an ACP checkout session by id (status, result, tx proof).",
      inputSchema: { session_id: z.string().describe("Session id, e.g. cs_xxxxxxxx") },
    },
    async ({ session_id }) => {
      try {
        return ok(JSON.stringify(await getOrder(session_id), null, 2));
      } catch (err) {
        return fail((err as Error).message);
      }
    },
  );

  return server;
}

/** `hedera-insights-mcp config` prints ready-to-paste client configs. */
function printConfigs(): void {
  const env = {
    HEDERA_ACCOUNT_ID: "0.0.xxxxx",
    HEDERA_PRIVATE_KEY: "302e...",
    AGENT_URL: config.agentUrl,
    HEDERA_NETWORK: config.network,
  };

  const claude = {
    mcpServers: {
      "hedera-insights": { command: "npx", args: ["-y", "hedera-insights-mcp"], env },
    },
  };

  const opencode = {
    $schema: "https://opencode.ai/config.json",
    mcp: {
      "hedera-insights": {
        type: "local",
        command: ["npx", "-y", "hedera-insights-mcp"],
        enabled: true,
        environment: env,
      },
    },
  };

  process.stdout.write(
    [
      "# Claude Code / Claude Desktop  (.mcp.json or claude_desktop_config.json)",
      JSON.stringify(claude, null, 2),
      "",
      "# Claude Code CLI",
      "claude mcp add --transport stdio \\",
      "  --env HEDERA_ACCOUNT_ID=0.0.xxxxx --env HEDERA_PRIVATE_KEY=302e... \\",
      `  --env AGENT_URL=${config.agentUrl} --env HEDERA_NETWORK=${config.network} \\`,
      "  hedera-insights -- npx -y hedera-insights-mcp",
      "",
      "# OpenCode  (opencode.json)",
      JSON.stringify(opencode, null, 2),
      "",
    ].join("\n") + "\n",
  );
}

async function main(): Promise<void> {
  if (process.argv[2] === "config") {
    printConfigs();
    return;
  }

  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[hedera-insights-mcp] ready · agent=${config.agentUrl} · network=${config.network} · wallet=${hasWallet() ? "configured" : "MISSING (only list_services works)"}`,
  );
}

main().catch((err) => {
  console.error("[hedera-insights-mcp] fatal:", err);
  process.exit(1);
});
