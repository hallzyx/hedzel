"use client";

import { useWallet } from "@/lib/wallet";

export function WalletConnectButton() {
  const { account, connected, connect, disconnect } = useWallet();

  if (connected && account) {
    return (
      <div className="wallet">
        <span className="acct">
          <b>◇</b> {account}
        </span>
        <button className="btn btn-ghost" onClick={disconnect}>
          Disconnect
        </button>
      </div>
    );
  }

  return (
    <button className="btn btn-primary" onClick={connect}>
      Connect Wallet
    </button>
  );
}
