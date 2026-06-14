import { env } from "../config/env.js";
import { listServices, getService } from "../config/services.js";
import { resourceExists, type InsightResult } from "../services/index.js";
import { buildMirrorTools } from "./tools.js";

/**
 * Hedera Agent Kit runtime (v4). Initialised lazily and defensively: if the
 * LLM key or any package is missing, the agent degrades to null and the routes
 * fall back to deterministic behaviour. The paid data path never depends on the
 * LLM — the agent adds natural-language understanding on top of real data.
 */

type AgentLike = {
  invoke: (input: {
    messages: { role: string; content: string }[];
  }) => Promise<{ messages?: unknown[] } & Record<string, unknown>>;
};

let initPromise: Promise<AgentLike | null> | null = null;

async function init(): Promise<AgentLike | null> {
  if (!env.llm.apiKey) {
    console.warn("[agent] No LLM API key set — running in deterministic mode (no NL agent).");
    return null;
  }
  try {
    // LangChain v1 agent API, as used by Hedera Agent Kit v4.
    const [{ ChatOpenAI }, { createAgent }] = await Promise.all([
      import("@langchain/openai"),
      import("langchain"),
    ]);

    const model = new ChatOpenAI({
      apiKey: env.llm.apiKey,
      model: env.llm.model,
      temperature: 0,
      configuration: { baseURL: env.llm.baseUrl },
    });

    const tools = [...buildMirrorTools(), ...(await loadHederaTools())];

    const agent = createAgent({
      model,
      tools: tools as never,
      systemPrompt:
        "You are the Hedera Insights Agent. Answer questions about the Hedera " +
        "network using ONLY the provided tools, which return live mirror-node " +
        "data. Never invent on-chain values. Be concise.",
    });
    return agent as unknown as AgentLike;
  } catch (err) {
    console.warn(`[agent] Failed to initialise Hedera Agent Kit: ${(err as Error).message}`);
    return null;
  }
}

/** Extract the final assistant text from a LangChain v1 agent result. */
function extractOutput(res: { messages?: unknown[] } & Record<string, unknown>): string | null {
  const messages = res.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const last = messages[messages.length - 1] as { content?: unknown };
    if (typeof last?.content === "string") return last.content;
    if (Array.isArray(last?.content)) {
      return last.content
        .map((c) => (typeof c === "string" ? c : (c as { text?: string })?.text ?? ""))
        .join("");
    }
  }
  if (typeof res.output === "string") return res.output;
  return null;
}

/** Load the native Hedera Agent Kit tools. Returns [] if the kit can't load. */
async function loadHederaTools(): Promise<unknown[]> {
  if (!env.hedera.accountId || !env.hedera.privateKey) return [];
  try {
    const [{ Client, PrivateKey }, { HederaLangchainToolkit }, kit] = await Promise.all([
      import("@hiero-ledger/sdk"),
      import("@hashgraph/hedera-agent-kit-langchain"),
      import("@hashgraph/hedera-agent-kit"),
    ]);
    const client = Client.forName(env.hedera.network).setOperator(
      env.hedera.accountId,
      PrivateKey.fromStringECDSA(env.hedera.privateKey),
    );
    const toolkit = new HederaLangchainToolkit({
      client,
      configuration: { context: { mode: (kit as any).AgentMode?.AUTONOMOUS } },
    });
    return toolkit.getTools();
  } catch (err) {
    console.warn(`[agent] Native Hedera tools unavailable: ${(err as Error).message}`);
    return [];
  }
}

export async function getAgent(): Promise<AgentLike | null> {
  if (!initPromise) initPromise = init();
  return initPromise;
}

/** Wall-clock cap so a slow/unreachable LLM never hangs an HTTP request. */
const LLM_TIMEOUT_MS = 20_000;

function withTimeout<T>(p: Promise<T>, ms = LLM_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("llm timeout")), ms),
    ),
  ]);
}

/**
 * Build a plain chat model. Used for the fast paths (intent + conversation +
 * summary) that need text in, text out — NOT the full Hedera Agent Kit toolkit,
 * whose heavy init must never sit on the request hot path.
 */
async function makeLlm() {
  if (!env.llm.apiKey) return null;
  const { ChatOpenAI } = await import("@langchain/openai");
  return new ChatOpenAI({
    apiKey: env.llm.apiKey,
    model: env.llm.model,
    temperature: 0,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: 1,
    configuration: { baseURL: env.llm.baseUrl },
  });
}

function llmText(content: unknown): string {
  return typeof content === "string" ? content : JSON.stringify(content);
}

/** Produce a short natural-language summary of an insight result. */
export async function summarise(result: InsightResult): Promise<string | null> {
  const llm = await makeLlm();
  if (!llm) return null;
  try {
    const res = await withTimeout(
      llm.invoke(
        `Summarise this Hedera ${result.service_id} result in 2-3 sentences for a ` +
          `non-technical user. Reply in the user's likely language. ` +
          `Data: ${JSON.stringify(result.data)}`,
      ),
    );
    return llmText(res.content);
  } catch {
    return null;
  }
}

/**
 * Resolve a free-text prompt to a service_id + params. Uses the LLM when
 * available; otherwise a keyword heuristic so the chat works with zero config.
 */
export async function resolveIntent(
  prompt: string,
): Promise<{ service_id: string; params: Record<string, unknown> } | null> {
  const llmResult = await resolveIntentWithLlm(prompt);
  if (llmResult) return llmResult;
  return heuristicIntent(prompt);
}

async function resolveIntentWithLlm(prompt: string) {
  const llm = await makeLlm();
  if (!llm) return null;
  try {
    const catalog = listServices()
      .map((s) => `- ${s.id}: ${s.description}`)
      .join("\n");
    const res = await withTimeout(
      llm.invoke(
        `Map the user request to one service. Services:\n${catalog}\n\n` +
          `Extract any Hedera id (format 0.0.x) into params (accountId/tokenId/topicId).\n` +
          `Reply with ONLY compact JSON: {"service_id":"...","params":{...}}.\n` +
          `User: ${prompt}`,
      ),
    );
    const json = llmText(res.content).match(/\{[\s\S]*\}/)?.[0];
    if (!json) return null;
    const parsed = JSON.parse(json);
    if (parsed?.service_id) return parsed;
    return null;
  } catch {
    return null;
  }
}

/**
 * A single conversational turn. The agent talks in natural language but stays
 * strictly within its purpose: selling Hedera on-chain intelligence.
 *
 *  - "service" → the user wants live data; the caller turns this into an
 *    x402-gated, paid query (the actual data is never answered for free here).
 *  - "message" → a free reply: a greeting, an explanation of what the agent
 *    does, a high-level Hedera concept, or a polite refusal of anything
 *    off-topic. Specific on-chain values are never invented — they cost a query.
 */
export type ChatTurn =
  | { kind: "service"; service_id: string; params: Record<string, unknown> }
  | { kind: "message"; text: string };

/**
 * Guardrail: confirm the resolved service exists and its params are well-formed
 * (e.g. a Hedera id really is `0.0.x`) BEFORE the caller turns this into a paid
 * query. Returns a corrective message turn when something is off, or null when
 * the intent is valid and safe to charge for.
 */
function validateServiceIntent(
  serviceId: string,
  params: Record<string, unknown>,
): ChatTurn | null {
  const service = getService(serviceId);
  if (!service) {
    return {
      kind: "message",
      text:
        `I don't offer a service called \`${serviceId}\`. I can run: ` +
        `${listServices().map((s) => `\`${s.id}\``).join(", ")}.`,
    };
  }
  if (service.schema.safeParse(params ?? {}).success) return null;

  const field = service.id.includes("token")
    ? "token id"
    : service.id.includes("topic")
      ? "topic id"
      : "account id";
  return {
    kind: "message",
    text:
      `To run **${service.name}** I need a valid Hedera ${field} in the ` +
      `\`shard.realm.num\` format — for example \`0.0.7974311\`. ` +
      `Could you share it that way?`,
  };
}

/**
 * Existence/type guardrail, run for free in /chat BEFORE any payment. A well-
 * formed id (`0.0.x`) can still point at the wrong kind of entity — asking for a
 * Token Report on an account id is the classic case. When the resource doesn't
 * exist as the requested type, return a corrective message (with a smart hint)
 * instead of opening the payment modal. Shares the existence check with the
 * x402 gate via `resourceExists`.
 */
async function verifyResourceExists(
  serviceId: string,
  params: Record<string, unknown>,
): Promise<ChatTurn | null> {
  if (await resourceExists(serviceId, params)) return null;
  const net = env.hedera.network;

  if (serviceId === "token-report") {
    const id = String(params.tokenId);
    const isAccount = await resourceExists("account-intelligence", { accountId: id });
    const hint = isAccount
      ? ` It looks like \`${id}\` is an **account**, not a token — try **Account Intelligence** for it.`
      : "";
    return { kind: "message", text: `I couldn't find a token \`${id}\` on Hedera ${net}.${hint}` };
  }
  if (serviceId === "account-intelligence" || serviceId === "wallet-forensics") {
    return { kind: "message", text: `I couldn't find account \`${String(params.accountId)}\` on Hedera ${net}. Double-check the id?` };
  }
  if (serviceId === "topic-feed") {
    return { kind: "message", text: `I couldn't find topic \`${String(params.topicId)}\` on Hedera ${net}. Double-check the id?` };
  }
  return null;
}

/** Resolve a service intent into a validated ChatTurn (corrective message or service). */
async function toValidatedTurn(
  serviceId: string,
  params: Record<string, unknown>,
): Promise<ChatTurn> {
  const formatError = validateServiceIntent(serviceId, params);
  if (formatError) return formatError;
  return (await verifyResourceExists(serviceId, params)) ?? {
    kind: "service",
    service_id: serviceId,
    params,
  };
}

/** One prior turn of the conversation, passed so the agent can handle follow-ups. */
export interface ChatMsg {
  role: "user" | "agent";
  content: string;
}

const PURPOSE_PROMPT =
  "You are the Hedera Insights Agent. You sell live, verified on-chain " +
  "intelligence about the Hedera network, paid per query in HBAR via x402.\n" +
  "You CAN help with:\n" +
  "- Your five data services: what each one does, what fields it returns, and its price.\n" +
  "- Interpreting on-chain data already shown earlier in THIS conversation: explain " +
  "what a balance, supply distribution, holder concentration, activity pattern or fee " +
  "implies, as factual, data-grounded observations (e.g. 'one wallet holding 99% of " +
  "supply is high concentration / centralization risk').\n" +
  "- How payment/x402 works and high-level Hedera concepts.\n" +
  "Boundaries:\n" +
  "- NEVER state specific on-chain values from your own knowledge — any NEW lookup " +
  "needs a paid query. Only reference data already present in this conversation.\n" +
  "- Do NOT give personalized financial or investment advice, price predictions, or " +
  "tell the user whether to buy/sell. If asked, DON'T refuse flatly: decline the advice " +
  "in one line, then point to the relevant on-chain facts (concentration, activity, " +
  "supply) from the data so they can judge for themselves.\n" +
  "- Only truly unrelated topics (not Hedera, not your services, not the shown data) get refused.\n" +
  "Always reply in the user's language, warmly and concisely. Format replies in clean " +
  "Markdown: use bullet/numbered lists for multiple items and bold service ids.";

const ACTION_INSTRUCTIONS =
  "Decide what to do with the user's latest message and reply with ONLY compact JSON:\n" +
  `- They want a NEW data service AND gave a valid Hedera id in shard.realm.num form (e.g. 0.0.7974311): {"action":"service","service_id":"<id>","params":{...}} (put the id in accountId/tokenId/topicId)\n` +
  `- They want a service but the id is missing or not in 0.0.x format: {"action":"answer","message":"<ask, in their language, for a valid id like 0.0.7974311>"}\n` +
  `- They greet you, ask about your services/output/pricing, ask a Hedera concept, OR ask about data already shown in this conversation (including 'is this risky/safe' style questions you answer with the on-chain facts): {"action":"answer","message":"<helpful reply>"}\n` +
  `- The message is unrelated to Hedera, your services, or the shown data: {"action":"refuse","message":"<polite decline that redirects to what you can do>"}`;

export async function chatTurn(prompt: string, history: ChatMsg[] = []): Promise<ChatTurn> {
  const llm = await makeLlm();

  // No LLM: deterministic fallback. Match a service by keywords, else explain.
  if (!llm) {
    const intent = heuristicIntent(prompt);
    if (intent) return toValidatedTurn(intent.service_id, intent.params);
    return {
      kind: "message",
      text:
        "I'm the Hedera Insights Agent — I sell live on-chain intelligence about " +
        "the Hedera network (account intelligence, token reports, topic feeds, " +
        "network pulse, wallet forensics). Mention an account, token or topic id " +
        "(like 0.0.9233901) and I'll fetch verified data for a small HBAR fee.",
    };
  }

  try {
    const catalog = listServices()
      .map((s) => `- ${s.id}: ${s.description}`)
      .join("\n");
    const messages: [string, string][] = [
      ["system", `${PURPOSE_PROMPT}\n\nServices:\n${catalog}`],
      ...history.slice(-6).map((h): [string, string] => [h.role === "agent" ? "ai" : "human", h.content]),
      // Keep the JSON contract adjacent to the actual question so multi-turn
      // history doesn't make the model drift into a free-form reply.
      ["human", `${ACTION_INSTRUCTIONS}\n\nUser message: ${prompt}`],
    ];
    const res = await withTimeout(llm.invoke(messages));
    const raw = llmText(res.content).trim();

    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (json) {
      try {
        const parsed = JSON.parse(json);
        if (parsed?.action === "service" && parsed.service_id) {
          return toValidatedTurn(parsed.service_id, parsed.params ?? {});
        }
        if (typeof parsed?.message === "string" && parsed.message.trim()) {
          return { kind: "message", text: parsed.message.trim() };
        }
      } catch {
        /* malformed JSON — fall through to prose handling */
      }
    }

    // The model answered in prose instead of JSON (common with conversation
    // history) — that prose is a fine conversational reply, so use it directly
    // rather than dropping to the generic fallback.
    if (raw && !raw.startsWith("{")) {
      return { kind: "message", text: raw };
    }
  } catch {
    /* fall through to heuristic */
  }

  const intent = heuristicIntent(prompt);
  if (intent) return toValidatedTurn(intent.service_id, intent.params);
  return {
    kind: "message",
    text:
      "I can help with Hedera on-chain intelligence — account activity, token " +
      "reports, topic feeds, network pulse or wallet forensics. What would you " +
      "like to look up?",
  };
}

function heuristicIntent(
  prompt: string,
): { service_id: string; params: Record<string, unknown> } | null {
  const idMatch = prompt.match(/\d+\.\d+\.\d+/);
  const id = idMatch?.[0];
  const p = prompt.toLowerCase();

  if (/token|supply|holder/.test(p) && id) return { service_id: "token-report", params: { tokenId: id } };
  if (/topic|message|hcs/.test(p) && id) return { service_id: "topic-feed", params: { topicId: id } };
  if (/forensic|counterpart|relationship|graph/.test(p) && id)
    return { service_id: "wallet-forensics", params: { accountId: id } };
  if (/network|tps|pulse|fee/.test(p)) return { service_id: "network-pulse", params: {} };
  if (id) return { service_id: "account-intelligence", params: { accountId: id } };
  return null;
}
