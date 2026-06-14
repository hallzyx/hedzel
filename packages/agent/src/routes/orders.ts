import { Router } from "express";
import { getSession } from "../acp/sessions.js";

/**
 * ACP: GET /orders/:session_id — fulfillment status for a checkout session.
 */
export const ordersRouter = Router();

ordersRouter.get("/orders/:session_id", (req, res) => {
  const session = getSession(req.params.session_id);
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  if (session.status === "fulfilled") {
    return res.json({
      session_id: session.session_id,
      status: session.status,
      service_id: session.service_id,
      result: session.result,
      tx_proof: session.tx_proof,
      fulfilled_at: session.fulfilled_at,
    });
  }

  res.json({
    session_id: session.session_id,
    status: session.status,
    service_id: session.service_id,
  });
});
