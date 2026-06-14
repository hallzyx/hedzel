# hedera-insights-mcp

An **MCP server** that lets any MCP-capable AI agent buy **Hedera on-chain
intelligence** over **x402** — it discovers the catalog, pays the HBAR fee from a
configured wallet, and returns verified data. No UI, no human, no crypto handling
in the calling agent.

This is the **agent-to-agent (A2A)** side of the Hedera Insights Agent: the same
service a human uses through the chat UI, exposed as tools any agent can call.

> The server signs and submits the HBAR transfer **headlessly** with the operator
> key (`@hiero-ledger/sdk`) — no WalletConnect, no wallet popup.

---

## Tools

| Tool | Cost | What it does |
|---|---|---|
| `list_services` | free | List services + prices |
| `account_intelligence(accountId)` | 2 HBAR | Balance, last 10 txs, tokens |
| `token_report(tokenId)` | 3 HBAR | Supply, metadata, top holders |
| `topic_feed(topicId, limit?)` | 1 HBAR | Latest HCS messages, decoded |
| `network_pulse()` | 1 HBAR | TPS, avg fee, HBAR supply |
| `wallet_forensics(accountId)` | 5 HBAR | Frequent counterparties + volume |
| `buy_insight(service_id, params)` | varies | Generic escape hatch |
| `get_order(session_id)` | free | ACP checkout-session status |

Each paid tool runs the full x402 loop internally: probe → sign & submit the HBAR
transfer → retry with proof → return data + a HashScan link.

---

## Configuration

Secrets are read from the **environment** (set in your MCP client's config),
never from CLI arguments. Use a **dedicated, low-balance testnet account** — the
server holds a hot key.

| Env var | Required | Default |
|---|---|---|
| `HEDERA_ACCOUNT_ID` | for paid tools | — |
| `HEDERA_PRIVATE_KEY` | for paid tools | — |
| `AGENT_URL` | no | `http://localhost:3001` |
| `HEDERA_NETWORK` | no | `testnet` |
| `MAX_SPEND_HBAR` | no | `10` (refuses pricier queries) |

Print ready-to-paste configs any time:

```bash
npx -y hedera-insights-mcp config
```

### Claude Code / Claude Desktop

`.mcp.json` (project) or `~/.claude.json` (user) / `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "hedera-insights": {
      "command": "npx",
      "args": ["-y", "hedera-insights-mcp"],
      "env": {
        "HEDERA_ACCOUNT_ID": "0.0.xxxxx",
        "HEDERA_PRIVATE_KEY": "302e...",
        "AGENT_URL": "http://localhost:3001",
        "HEDERA_NETWORK": "testnet"
      }
    }
  }
}
```

Or via the CLI:

```bash
claude mcp add --transport stdio \
  --env HEDERA_ACCOUNT_ID=0.0.xxxxx --env HEDERA_PRIVATE_KEY=302e... \
  --env AGENT_URL=http://localhost:3001 --env HEDERA_NETWORK=testnet \
  hedera-insights -- npx -y hedera-insights-mcp
```

### OpenCode

`opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "hedera-insights": {
      "type": "local",
      "command": ["npx", "-y", "hedera-insights-mcp"],
      "enabled": true,
      "environment": {
        "HEDERA_ACCOUNT_ID": "0.0.xxxxx",
        "HEDERA_PRIVATE_KEY": "302e...",
        "AGENT_URL": "http://localhost:3001",
        "HEDERA_NETWORK": "testnet"
      }
    }
  }
}
```

> Same binary, two wrappers. Claude uses `command` + `args` + `env`; OpenCode uses
> a single `command` array + `environment` + `type: "local"`. Both schemas are
> from the official docs ([Claude Code](https://code.claude.com/docs/en/mcp),
> [OpenCode](https://opencode.ai/docs/mcp-servers/)).

---

## Try it

Point the agent backend at a running Hedera Insights agent (local or Railway),
then ask the connected AI agent, in plain language:

- _"List the Hedera Insights services."_
- _"Buy account intelligence for 0.0.2."_
- _"Get me a token report for 0.0.9233901."_

The agent calls the tool, the server pays in HBAR, and verified on-chain data
comes back with a HashScan proof link.

---

## Develop

```bash
pnpm install
pnpm --filter hedera-insights-mcp build
node packages/mcp/dist/index.cjs config   # print client configs
```

Diagnostics go to **stderr** (stdout is the JSON-RPC channel).
