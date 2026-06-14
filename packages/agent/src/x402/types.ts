/**
 * Minimal x402 type surface for the Hedera "exact" scheme.
 * x402 is an HTTP standard (HTTP 402 + the `X-PAYMENT` header), not a single
 * npm package — so we model just the fields this resource server needs.
 * Spec context: https://docs.hedera.com/solutions/ai/x402
 */

export const X402_VERSION = 1;

export interface PaymentRequirements {
  scheme: "exact";
  network: string; // "hedera:testnet"
  /** amount in tinybars as a string */
  maxAmountRequired: string;
  resource: string;
  description: string;
  /** treasury account that receives the payment */
  payTo: string;
  /** native HBAR asset id */
  asset: string;
  extra: { decimals: number; currency: "HBAR" };
}

export interface PaymentRequiredBody {
  x402Version: number;
  error?: string;
  accepts: PaymentRequirements[];
}

/** Decoded contents of the base64 `X-PAYMENT` header sent by the client. */
export interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    /**
     * Direct-settlement scheme: the id of the HBAR TransferTransaction the buyer
     * already signed and submitted to Hedera via HashPack. The resource server
     * verifies it against the mirror node. Format: `0.0.x@secs.nanos`.
     */
    txId?: string;
    /** signed (or partially-signed) Hedera transfer transaction, base64 (legacy facilitator scheme) */
    signedTransaction?: string;
    from?: string;
    amount?: string;
    [k: string]: unknown;
  };
}

export interface VerificationResult {
  valid: boolean;
  /** Hedera transaction id once settled, used to build the HashScan proof link */
  txId?: string;
  reason?: string;
}
