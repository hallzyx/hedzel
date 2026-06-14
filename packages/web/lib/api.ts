const AGENT_URL =
  process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3001";

export interface CatalogService {
  id: string;
  name: string;
  description: string;
  price: { amount: string; currency: string };
  params_schema: Record<string, unknown>;
}

export interface ResolveResult {
  service_id: string;
  name: string;
  params: Record<string, unknown>;
  price: { amount: string; currency: string };
}

export interface InsightResponse {
  service_id: string;
  verified: boolean;
  result: { service_id: string; generated_at: string; data: Record<string, unknown> };
  summary: string | null;
  tx_proof?: string;
}

export async function getCatalog(): Promise<CatalogService[]> {
  const res = await fetch(`${AGENT_URL}/catalog`);
  if (!res.ok) throw new Error("Failed to load catalog");
  const body = await res.json();
  return body.services as CatalogService[];
}

export async function resolveIntent(prompt: string): Promise<ResolveResult> {
  const res = await fetch(`${AGENT_URL}/resolve`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Could not understand the request");
  }
  return res.json();
}

/** A conversational turn: either a paid-service intent or a plain text reply. */
export type ChatTurn =
  | { kind: "service"; service_id: string; name: string; params: Record<string, unknown>; price: { amount: string; currency: string } }
  | { kind: "message"; text: string };

/** Prior conversation turn sent so the agent can answer follow-ups about it. */
export interface ChatHistoryMsg {
  role: "user" | "agent";
  content: string;
}

/**
 * Free conversational turn. Sends recent history so the agent can resolve
 * follow-up questions about earlier results. Aborts after 30s so the UI never
 * hangs on a slow or unreachable agent.
 */
export async function sendChat(prompt: string, history: ChatHistoryMsg[] = []): Promise<ChatTurn> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${AGENT_URL}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, history }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? "Could not reach the agent");
    }
    return res.json();
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new Error("The agent took too long to respond. Please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

interface PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  payTo: string;
}

const NETWORK = process.env.NEXT_PUBLIC_HEDERA_NETWORK
  ? `hedera:${process.env.NEXT_PUBLIC_HEDERA_NETWORK}`
  : "hedera:testnet";

/** Live progress stages reported by payAndQuery so the UI can narrate the flow. */
export type PayStage =
  | "quoting"
  | "awaiting_approval"
  | "settling"
  | "verified"
  | "running"
  | "summarizing";

/**
 * Runs the real x402 flow against /insights:
 *   1. request with no payment  -> 402 + PaymentRequirements (payTo, amount)
 *   2. pay: when a real HashPack signer is provided, sign + submit an on-chain
 *      HBAR transfer to the treasury and capture the tx id; otherwise (demo /
 *      backend dev-mode) send a placeholder payload
 *   3. retry with the X-PAYMENT header -> fulfilled insight
 *
 * `signTransfer` is the wallet's signAndExecuteTransfer. When omitted the call
 * only succeeds against a backend running X402_MODE=dev.
 */
export async function payAndQuery(
  serviceId: string,
  params: Record<string, unknown>,
  account: string,
  signTransfer?: (payTo: string, amountTinybars: string) => Promise<string | null>,
  onStatus?: (stage: PayStage) => void,
): Promise<InsightResponse> {
  const body = JSON.stringify({ service_id: serviceId, params });

  // Step 1 — provoke the 402 to learn where and how much to pay.
  onStatus?.("quoting");
  const probe = await fetch(`${AGENT_URL}/insights`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

  if (probe.status !== 402) {
    // Either an error, or a server that didn't gate this request.
    if (!probe.ok) {
      const err = await probe.json().catch(() => ({}));
      throw new Error(err.error ?? `Request failed (${probe.status})`);
    }
    return probe.json();
  }

  const quote = await probe.json();
  const requirements: PaymentRequirements | undefined = quote.accepts?.[0];
  if (!requirements) throw new Error("Server did not return payment requirements.");

  // Step 2 — settle.
  //  - real wallet that returned an id  -> { from, txId }
  //  - real wallet, no id (WalletConnect dropped the response, but the payment
  //    may have settled) -> { from } so the backend verifies via the mirror node
  //  - demo / dev mode (no signer) -> { from, signedTransaction: "demo" }
  let inner: Record<string, unknown>;
  if (signTransfer) {
    onStatus?.("awaiting_approval");
    const txId = await signTransfer(requirements.payTo, requirements.maxAmountRequired);
    inner = txId ? { from: account, txId } : { from: account };
  } else {
    inner = { from: account, signedTransaction: "demo" };
  }

  const payload = { x402Version: 1, scheme: "exact", network: NETWORK, payload: inner };
  const header = btoa(JSON.stringify(payload));

  // Step 3 — retry with proof of payment, asking for a streamed progress feed.
  onStatus?.("settling");
  const res = await fetch(`${AGENT_URL}/insights`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-PAYMENT": header, "X-Stream": "1" },
    body,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `Request failed (${res.status})`);
  }

  // Non-streaming fallback (older backend / proxy that buffered the response).
  if (!res.body || !res.headers.get("content-type")?.includes("ndjson")) {
    return res.json();
  }

  // Read NDJSON progress events; the final "done" event carries the insight.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let insight: InsightResponse | undefined;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const evt = JSON.parse(line) as { stage: string; insight?: InsightResponse; error?: string };
      if (evt.stage === "error") throw new Error(evt.error ?? "Service execution failed");
      if (evt.stage === "done") insight = evt.insight;
      else if (evt.stage === "verified" || evt.stage === "running" || evt.stage === "summarizing") {
        onStatus?.(evt.stage);
      }
    }
  }

  if (!insight) throw new Error("No result received from the agent.");
  return insight;
}
