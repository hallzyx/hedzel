import { env } from "../config/env.js";
import { mirror, MirrorError } from "../mirror/client.js";
import type {
  PaymentPayload,
  PaymentRequirements,
  VerificationResult,
} from "./types.js";

/**
 * Verifies an x402 payment.
 *
 * - mode "live": DIRECT SETTLEMENT. The buyer's HashPack wallet has already
 *   signed and submitted an HBAR TransferTransaction to Hedera; the payload
 *   carries its `txId`. We verify it against the public mirror node — that it
 *   succeeded and actually credited the treasury (`payTo`) with at least the
 *   required amount. No external facilitator, no treasury private key needed
 *   here: the money moved in the buyer's own wallet and is visible on HashScan.
 * - mode "dev": accepts any well-formed payload and mints a synthetic tx id so
 *   the full request -> 402 -> pay -> fulfill loop runs on a clean local
 *   checkout with no testnet credentials and no wallet.
 *
 * HACK: dev-mode skips real on-chain settlement. See README "Known limitations".
 * HACK: live-mode does not yet mark a txId as spent, so a single payment could
 *   in theory be replayed for multiple queries. The 5-minute freshness window
 *   below limits the blast radius; a real deployment would persist consumed ids.
 */
export async function verifyPayment(
  header: string,
  requirements: PaymentRequirements,
): Promise<VerificationResult> {
  let payload: PaymentPayload;
  try {
    payload = JSON.parse(Buffer.from(header, "base64").toString("utf-8"));
  } catch {
    return { valid: false, reason: "X-PAYMENT header is not valid base64 JSON" };
  }

  if (payload.scheme !== requirements.scheme) {
    return { valid: false, reason: "payment scheme mismatch" };
  }
  if (payload.network !== requirements.network) {
    return { valid: false, reason: "payment network mismatch" };
  }

  if (env.x402.mode === "dev") {
    return {
      valid: true,
      txId: `0.0.0@${Math.floor(Date.now() / 1000)}.000000000`,
    };
  }

  // live: verify the buyer's already-submitted transfer on the mirror node.
  // Prefer the exact txId when the wallet returned one; otherwise fall back to
  // searching the buyer's recent transfers — WalletConnect often executes the
  // payment on-chain but never delivers the response back to the dApp.
  const txId = payload.payload?.txId;
  if (txId && typeof txId === "string") {
    return verifyOnChainTransfer(txId, requirements);
  }

  const from = payload.payload?.from;
  if (from && typeof from === "string") {
    return verifyRecentTransfer(from, requirements);
  }

  return { valid: false, reason: "payment payload is missing both txId and payer account" };
}

const MIRROR_TX_ID = /^\d+\.\d+\.\d+-\d+-\d+$/;
const ACCOUNT_ID = /^\d+\.\d+\.\d+$/;
const FRESHNESS_WINDOW_SECONDS = 5 * 60;

function ageSeconds(consensusTimestamp: string): number {
  return Math.floor(Date.now() / 1000) - Number(consensusTimestamp.split(".")[0]);
}

function creditedTo(payTo: string, transfers: { account: string; amount: number }[]): number {
  return transfers
    .filter((t) => t.account === payTo && t.amount > 0)
    .reduce((sum, t) => sum + t.amount, 0);
}

/**
 * Normalise to the mirror REST form `0.0.x-secs-nanos`. Wallets return the id as
 * either `0.0.x@secs.nanos` (SDK) or already-dashed — accept both.
 */
function toMirrorTxId(txId: string): string {
  return txId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
}

async function verifyOnChainTransfer(
  txId: string,
  requirements: PaymentRequirements,
): Promise<VerificationResult> {
  const mirrorId = toMirrorTxId(txId);
  if (!MIRROR_TX_ID.test(mirrorId)) {
    return { valid: false, reason: `malformed transaction id: ${txId}` };
  }
  const required = Number(requirements.maxAmountRequired); // tinybars

  // The mirror node lags consensus by a few seconds, so poll briefly.
  const deadline = Date.now() + 12_000;
  let lastReason = "transaction not found on the mirror node yet";

  while (Date.now() < deadline) {
    try {
      const { transactions } = await mirror.transaction(mirrorId);
      const tx = transactions?.[0];
      if (tx) {
        if (tx.result !== "SUCCESS") {
          return { valid: false, reason: `transaction did not succeed (${tx.result})` };
        }
        if (ageSeconds(tx.consensus_timestamp) > FRESHNESS_WINDOW_SECONDS) {
          return { valid: false, reason: "payment transaction is too old to accept" };
        }
        const credited = creditedTo(requirements.payTo, tx.transfers);
        if (credited < required) {
          return {
            valid: false,
            reason: `underpaid: treasury received ${credited} tinybars, required ${required}`,
          };
        }
        return { valid: true, txId };
      }
    } catch (err) {
      // A 404 while the tx is still propagating is expected — keep polling.
      if (err instanceof MirrorError && err.status && err.status !== 404) {
        lastReason = `mirror node error: ${err.message}`;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  return { valid: false, reason: lastReason };
}

/**
 * Fallback when the wallet never returned a txId: find a fresh, successful
 * CRYPTOTRANSFER from the buyer that credited the treasury with the required
 * amount. This is what makes the flow resilient to WalletConnect dropping the
 * response after the payment already settled on-chain.
 */
async function verifyRecentTransfer(
  from: string,
  requirements: PaymentRequirements,
): Promise<VerificationResult> {
  if (!ACCOUNT_ID.test(from)) {
    return { valid: false, reason: `malformed payer account id: ${from}` };
  }

  const required = Number(requirements.maxAmountRequired);
  const deadline = Date.now() + 12_000;
  let lastReason = "no matching payment found on the mirror node yet";

  while (Date.now() < deadline) {
    try {
      const { transactions } = await mirror.accountTransactions(from, 10);
      for (const tx of transactions ?? []) {
        if (tx.name !== "CRYPTOTRANSFER" || tx.result !== "SUCCESS") continue;
        if (ageSeconds(tx.consensus_timestamp) > FRESHNESS_WINDOW_SECONDS) continue;
        if (creditedTo(requirements.payTo, tx.transfers) >= required) {
          // transaction_id arrives as `0.0.x-secs-nanos`, ready for HashScan.
          return { valid: true, txId: tx.transaction_id };
        }
      }
    } catch (err) {
      if (err instanceof MirrorError && err.status && err.status !== 404) {
        lastReason = `mirror node error: ${err.message}`;
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  return { valid: false, reason: lastReason };
}
