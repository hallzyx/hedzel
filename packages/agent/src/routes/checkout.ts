import { Router } from "express";
import { env } from "../config/env.js";
import { getService, hbarToTinybars } from "../config/services.js";
import { createSession } from "../acp/sessions.js";
import { resourceExists } from "../services/index.js";

/**
 * ACP: POST /checkout_session — reserves a purchase and returns the x402
 * payment handler. Does not execute the service yet.
 */
export const checkoutRouter = Router();

checkoutRouter.post("/checkout_session", async (req, res) => {
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

  // Reject early if the id doesn't exist as this resource type, so an ACP buyer
  // never reserves (and then pays for) a session that can't be fulfilled.
  if (!(await resourceExists(service.id, validation.data as Record<string, unknown>))) {
    return res.status(404).json({
      error: `${service.name} target not found on Hedera. Check the id and type.`,
    });
  }

  const session = createSession(service_id, validation.data);
  res.json({
    session_id: session.session_id,
    status: session.status,
    payment_handler: {
      type: "x402",
      chain: `hedera:${env.hedera.network}`,
      amount: hbarToTinybars(service.priceHbar),
      amount_hbar: String(service.priceHbar),
      asset: "0.0.0",
      payTo: env.x402.payTo,
    },
    expires_at: session.expires_at,
  });
});
