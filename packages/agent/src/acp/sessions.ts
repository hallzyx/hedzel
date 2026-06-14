import { nanoid } from "nanoid";
import type { InsightResult } from "../services/index.js";

/**
 * In-memory checkout-session store for the ACP flow. A Map is enough for the
 * MVP — no DB. Sessions expire after TTL and are swept lazily.
 */

export type SessionStatus = "pending_payment" | "fulfilled" | "expired";

export interface CheckoutSession {
  session_id: string;
  service_id: string;
  params: unknown;
  status: SessionStatus;
  created_at: string;
  expires_at: string;
  result?: InsightResult;
  tx_proof?: string;
  fulfilled_at?: string;
}

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const store = new Map<string, CheckoutSession>();

export function createSession(serviceId: string, params: unknown): CheckoutSession {
  const now = Date.now();
  const session: CheckoutSession = {
    session_id: `cs_${nanoid(16)}`,
    service_id: serviceId,
    params,
    status: "pending_payment",
    created_at: new Date(now).toISOString(),
    expires_at: new Date(now + TTL_MS).toISOString(),
  };
  store.set(session.session_id, session);
  return session;
}

export function getSession(id: string): CheckoutSession | undefined {
  const session = store.get(id);
  if (!session) return undefined;
  if (
    session.status === "pending_payment" &&
    Date.parse(session.expires_at) < Date.now()
  ) {
    session.status = "expired";
  }
  return session;
}

export function fulfillSession(
  id: string,
  result: InsightResult,
  txProof?: string,
): CheckoutSession | undefined {
  const session = store.get(id);
  if (!session) return undefined;
  session.status = "fulfilled";
  session.result = result;
  session.tx_proof = txProof;
  session.fulfilled_at = new Date().toISOString();
  return session;
}

/** Find the most recent pending session matching a service + params (used to
 * link a paid /insights call back to a prior checkout_session). */
export function findPendingByService(
  serviceId: string,
  params: unknown,
): CheckoutSession | undefined {
  const target = JSON.stringify(params ?? {});
  let match: CheckoutSession | undefined;
  for (const s of store.values()) {
    if (
      s.service_id === serviceId &&
      s.status === "pending_payment" &&
      JSON.stringify(s.params ?? {}) === target
    ) {
      if (!match || s.created_at > match.created_at) match = s;
    }
  }
  return match;
}
