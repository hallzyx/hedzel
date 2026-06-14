import { Router } from "express";
import { listServices } from "../config/services.js";

/**
 * ACP: GET /catalog — public service discovery. No payment, no auth.
 * Spec: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
 */
export const catalogRouter = Router();

catalogRouter.get("/catalog", (_req, res) => {
  res.json({
    agent: {
      name: "Hedera Insights Agent",
      description: "Real-time on-chain intelligence for the Hedera network",
      version: "1.0.0",
    },
    services: listServices().map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      price: { amount: String(s.priceHbar), currency: "HBAR" },
      params_schema: s.paramsSchema,
    })),
  });
});
