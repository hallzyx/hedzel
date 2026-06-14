import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { hbarToTinybars } from "../config/services.js";
import { verifyPayment } from "../x402/facilitator.js";
import {
  X402_VERSION,
  type PaymentRequiredBody,
  type PaymentRequirements,
} from "../x402/types.js";

const NETWORK = `hedera:${env.hedera.network}`;
const HBAR_ASSET = "0.0.0";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** populated by the x402 gate once a payment is verified */
      payment?: { txId?: string };
    }
  }
}

/** Describes what is being charged for, resolved per-request from the body. */
export interface PriceQuote {
  priceHbar: number;
  resource: string;
  description: string;
}

export function buildRequirements(quote: PriceQuote): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    maxAmountRequired: hbarToTinybars(quote.priceHbar),
    resource: quote.resource,
    description: quote.description,
    payTo: env.x402.payTo,
    asset: HBAR_ASSET,
    extra: { decimals: 8, currency: "HBAR" },
  };
}

/**
 * x402 gate. `resolveQuote` derives the price from the request (e.g. which
 * service the body asks for). Returning null means the request is malformed —
 * we let it through so the route handler can answer 400 instead of charging.
 */
export function x402Gate(
  resolveQuote: (req: Request) => PriceQuote | null | Promise<PriceQuote | null>,
) {
  return async function gate(req: Request, res: Response, next: NextFunction) {
    const quote = await resolveQuote(req);
    if (!quote) return next();

    const requirements = buildRequirements(quote);
    const header = req.header("X-PAYMENT");

    if (!header) {
      const body: PaymentRequiredBody = {
        x402Version: X402_VERSION,
        error: "Payment required to access this resource.",
        accepts: [requirements],
      };
      return res.status(402).json(body);
    }

    const result = await verifyPayment(header, requirements);
    if (!result.valid) {
      const body: PaymentRequiredBody = {
        x402Version: X402_VERSION,
        error: result.reason ?? "Payment verification failed.",
        accepts: [requirements],
      };
      return res.status(402).json(body);
    }

    req.payment = { txId: result.txId };
    return next();
  };
}
