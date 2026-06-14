"use client";

import { useWallet } from "@/lib/wallet";

export interface PendingPayment {
  service_id: string;
  name: string;
  params: Record<string, unknown>;
  price: { amount: string; currency: string };
}

export function PaymentConfirmModal({
  pending,
  busy,
  status,
  onConfirm,
  onCancel,
}: {
  pending: PendingPayment;
  busy: boolean;
  status?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { account, connected, connect } = useWallet();
  const paramEntries = Object.entries(pending.params);

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Confirm payment</h3>
        <p className="sub">This query is gated by x402 — pay to unlock the insight.</p>

        <div className="row">
          <span className="k">Service</span>
          <span className="v">{pending.name}</span>
        </div>
        {paramEntries.map(([k, v]) => (
          <div className="row" key={k}>
            <span className="k">{k}</span>
            <span className="v">{String(v)}</span>
          </div>
        ))}
        <div className="row">
          <span className="k">Pay from</span>
          <span className="v">{account ?? "—"}</span>
        </div>
        <div className="row">
          <span className="k">Amount</span>
          <span className="v big">
            {pending.price.amount} {pending.price.currency}
          </span>
        </div>

        {busy ? (
          <div className="pay-status">
            <span className="dots">
              <span /> <span /> <span />
            </span>
            <span className="stage">{status ?? "Working…"}</span>
          </div>
        ) : (
          <div className="actions">
            <button className="btn btn-ghost" onClick={onCancel}>
              Cancel
            </button>
            {connected ? (
              <button className="btn btn-primary" onClick={onConfirm}>
                Confirm &amp; pay
              </button>
            ) : (
              <button className="btn btn-primary" onClick={connect}>
                Connect wallet
              </button>
            )}
          </div>
        )}

        <p className="note">
          The agent responds <b>402 Payment Required</b>; your HashPack wallet signs
          and submits the HBAR transfer directly on Hedera, then the agent verifies
          it on the mirror node and fulfills the query.
        </p>
      </div>
    </div>
  );
}
