import { Router, type Request } from "express";
import { hashscanBase } from "../config/env.js";
import { getService } from "../config/services.js";
import { runService, resourceExists } from "../services/index.js";
import { summarise, resolveIntent, chatTurn, type ChatMsg } from "../agent/index.js";
import { x402Gate, type PriceQuote } from "../middleware/x402.js";
import { findPendingByService, fulfillSession } from "../acp/sessions.js";
import { MirrorError } from "../mirror/client.js";

export const insightsRouter = Router();

/**
 * Resolve the price for the requested service from the request body. Returns
 * null — which makes the x402 gate let the request through UNPAID — when the
 * service is unknown or its params are malformed, so a bad request (e.g. an
 * account id that isn't `0.0.x`) is never charged; the handler answers 400.
 */
async function quoteFromBody(req: Request): Promise<PriceQuote | null> {
  const service = getService(req.body?.service_id);
  if (!service) return null;
  const parsed = service.schema.safeParse(req.body?.params ?? {});
  if (!parsed.success) return null;
  // Don't charge for a well-formed id that doesn't exist as this resource type.
  if (!(await resourceExists(service.id, parsed.data as Record<string, unknown>))) return null;
  return {
    priceHbar: service.priceHbar,
    resource: "/insights",
    description: service.name,
  };
}

function hashscanLink(txId?: string): string | undefined {
  if (!txId) return undefined;
  // HashScan expects the tx id in 0.0.x-secs-nanos form.
  const normalised = txId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
  return `${hashscanBase}/transaction/${normalised}`;
}

/**
 * POST /insights — the paid, x402-gated endpoint.
 * Body: { service_id, params }. The gate enforces payment; on success we run
 * the deterministic executor (real mirror data), optionally add an LLM summary,
 * and fulfill any matching ACP checkout session.
 */
insightsRouter.post("/insights", x402Gate(quoteFromBody), async (req, res) => {
  const { service_id, params } = req.body ?? {};
  const service = getService(service_id);
  if (!service) {
    return res.status(400).json({ error: `Unknown service_id: ${service_id}` });
  }

  const validation = service.schema.safeParse(params ?? {});
  if (!validation.success) {
    return res.status(400).json({
      error: "Invalid params for service",
      details: validation.error.flatten(),
    });
  }

  // Clients that send `X-Stream: 1` get NDJSON progress events as the agent
  // works (payment verified → running the service → summarising → done) so the
  // UI can narrate the process in real time. Everyone else gets a single JSON.
  const stream = req.header("x-stream") === "1";

  try {
    if (stream) {
      res.setHeader("content-type", "application/x-ndjson");
      res.setHeader("cache-control", "no-cache");
      const send = (event: Record<string, unknown>) => res.write(JSON.stringify(event) + "\n");

      // Reaching the handler means the x402 gate already verified the payment.
      send({ stage: "verified" });
      send({ stage: "running", service_id, service: service.name });
      const result = await runService(service_id, validation.data);

      send({ stage: "summarizing" });
      const summary = await summarise(result);

      const txProof = hashscanLink(req.payment?.txId);
      const pending = findPendingByService(service_id, validation.data);
      if (pending) fulfillSession(pending.session_id, result, txProof);

      send({
        stage: "done",
        insight: { service_id, verified: true, result, summary, tx_proof: txProof, session_id: pending?.session_id },
      });
      return res.end();
    }

    const result = await runService(service_id, validation.data);
    const txProof = hashscanLink(req.payment?.txId);
    const summary = await summarise(result);

    // Link this paid call back to a pending ACP checkout session, if any.
    const pending = findPendingByService(service_id, validation.data);
    if (pending) fulfillSession(pending.session_id, result, txProof);

    res.json({
      service_id,
      verified: true,
      result,
      summary,
      tx_proof: txProof,
      session_id: pending?.session_id,
    });
  } catch (err) {
    const message =
      err instanceof MirrorError && err.status === 404
        ? `No ${service.name} data: id ${JSON.stringify(validation.data)} was not found on Hedera. Check the id and type.`
        : `Service execution failed: ${(err as Error).message}`;

    // If we already started streaming, the status code is locked — emit an
    // error event and close the stream instead.
    if (res.headersSent) {
      res.write(JSON.stringify({ stage: "error", error: message }) + "\n");
      return res.end();
    }
    const status = err instanceof MirrorError && err.status === 404 ? 404 : 502;
    res.status(status).json({ error: message });
  }
});

/**
 * POST /chat — free conversational turn for the chat UI. The agent understands
 * natural language and either (a) returns a service intent + price so the
 * frontend can open the x402 payment modal, or (b) answers/declines in words.
 * No payment and no live on-chain data are returned here.
 */
insightsRouter.post("/chat", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  // Recent conversation so the agent can resolve follow-ups ("are these risky?").
  const history: ChatMsg[] = Array.isArray(req.body?.history)
    ? req.body.history
        .filter((m: unknown): m is ChatMsg =>
          !!m && typeof m === "object" &&
          (((m as ChatMsg).role === "user") || ((m as ChatMsg).role === "agent")) &&
          typeof (m as ChatMsg).content === "string",
        )
        .slice(-6)
    : [];

  const turn = await chatTurn(prompt, history);

  if (turn.kind === "service") {
    const service = getService(turn.service_id);
    if (service) {
      return res.json({
        kind: "service",
        service_id: service.id,
        name: service.name,
        params: turn.params,
        price: { amount: String(service.priceHbar), currency: "HBAR" },
      });
    }
    // Resolved to an unknown service — fall back to a helpful message.
    return res.json({
      kind: "message",
      text: "I couldn't match that to one of my services. Try mentioning an account, token or topic id.",
    });
  }

  return res.json({ kind: "message", text: turn.text });
});

/**
 * POST /resolve — free intent resolution for the chat UI. Maps natural language
 * to a service + params + price so the frontend can show the payment modal
 * before charging. No payment, no data returned.
 */
insightsRouter.post("/resolve", async (req, res) => {
  const prompt = String(req.body?.prompt ?? "").trim();
  if (!prompt) return res.status(400).json({ error: "prompt is required" });

  const intent = await resolveIntent(prompt);
  if (!intent) {
    return res.status(422).json({
      error: "Could not map the request to a service. Try mentioning an account, token or topic id.",
    });
  }
  const service = getService(intent.service_id);
  if (!service) return res.status(422).json({ error: "Resolved to an unknown service." });

  res.json({
    service_id: service.id,
    name: service.name,
    params: intent.params,
    price: { amount: String(service.priceHbar), currency: "HBAR" },
  });
});
