"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

interface WalletState {
  account: string | null;
  connected: boolean;
  /** true when backed by a real HashPack/WalletConnect session (can sign on-chain). */
  isReal: boolean;
  connect: () => void | Promise<void>;
  disconnect: () => void;
  /**
   * Signs and submits an HBAR transfer from the connected account to `payTo`
   * through HashPack, returning the on-chain transaction id (`0.0.x@secs.nanos`).
   * Only available with a real session — throws in demo mode.
   */
  signAndExecuteTransfer: (payTo: string, amountTinybars: string) => Promise<string | null>;
}

/** Thrown-error marker for the wallet request timing out (vs. a user rejection). */
const WALLET_TIMEOUT = "__wallet_timeout__";

const WalletContext = createContext<WalletState | null>(null);

/** Reject after `ms` so an unanswered wallet request can't hang the UI forever. */
function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

const STORAGE_KEY = "hedera-insights-account";
const PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
const NETWORK = process.env.NEXT_PUBLIC_HEDERA_NETWORK ?? "testnet";

// Typed loosely to avoid pulling the heavy SDK types into the initial bundle;
// the real module is dynamically imported only when a wallet actually connects.
type DAppConnector = {
  init: (opts?: { logger?: string }) => Promise<void>;
  openModal: () => Promise<unknown>;
  disconnectAll?: () => Promise<void>;
  signAndExecuteTransaction: (params: {
    signerAccountId: string;
    transactionList: string;
  }) => Promise<unknown>;
  signers: { getAccountId: () => { toString: () => string } }[];
};

/**
 * Wallet context.
 *
 * With NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID set, `connect` opens a real HashPack
 * pairing (WalletConnect v2) and `signAndExecuteTransfer` submits a real HBAR
 * transfer on-chain — the buyer pays the treasury directly and the tx is visible
 * on HashScan.
 *
 * Without a project id it falls back to a demo connector (asks for a testnet
 * account id) so the full pay->query flow still runs against the backend in
 * x402 dev-mode with zero configuration.
 */
export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [isReal, setIsReal] = useState(false);
  const connectorRef = useRef<DAppConnector | null>(null);

  // Lazily build (and reuse) the WalletConnect connector — client-only.
  const getConnector = useCallback(async (): Promise<DAppConnector> => {
    if (connectorRef.current) return connectorRef.current;

    const { DAppConnector, HederaChainId, HederaJsonRpcMethod, HederaSessionEvent } =
      await import("@hashgraph/hedera-wallet-connect");
    const { LedgerId } = await import("@hiero-ledger/sdk");

    const chain = NETWORK === "mainnet" ? HederaChainId.Mainnet : HederaChainId.Testnet;
    const ledger = NETWORK === "mainnet" ? LedgerId.MAINNET : LedgerId.TESTNET;

    const connector = new DAppConnector(
      {
        name: "Hedera Insights Agent",
        description: "Real-time on-chain intelligence, paid per request via x402.",
        url: typeof window !== "undefined" ? window.location.origin : "https://localhost",
        icons: [],
      },
      ledger,
      PROJECT_ID as string,
      Object.values(HederaJsonRpcMethod),
      [HederaSessionEvent.ChainChanged, HederaSessionEvent.AccountsChanged],
      [chain],
    ) as unknown as DAppConnector;

    await connector.init({ logger: "error" });
    connectorRef.current = connector;
    return connector;
  }, []);

  // Restore a prior session: a real WalletConnect session if one survives, else
  // the saved demo account.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (PROJECT_ID) {
        try {
          const connector = await getConnector();
          const signer = connector.signers?.[0];
          if (!cancelled && signer) {
            setAccount(signer.getAccountId().toString());
            setIsReal(true);
            return;
          }
        } catch {
          /* fall through to demo restore */
        }
      }
      const saved = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
      if (!cancelled && saved) setAccount(saved);
    })();
    return () => {
      cancelled = true;
    };
  }, [getConnector]);

  const connect = useCallback(async () => {
    if (PROJECT_ID) {
      const connector = await getConnector();
      await connector.openModal();
      const signer = connector.signers?.[0];
      if (signer) {
        setAccount(signer.getAccountId().toString());
        setIsReal(true);
      }
      return;
    }

    // Demo fallback — no project id configured.
    const input = window.prompt(
      "Connect a Hedera testnet account\n\nPaste your testnet account id (e.g. 0.0.1234567), or leave blank to use a demo account:",
      "",
    );
    if (input === null) return; // cancelled
    const acct = /^\d+\.\d+\.\d+$/.test(input.trim()) ? input.trim() : "0.0.1001 (demo)";
    setAccount(acct);
    setIsReal(false);
    localStorage.setItem(STORAGE_KEY, acct);
  }, [getConnector]);

  const disconnect = useCallback(() => {
    if (isReal && connectorRef.current?.disconnectAll) {
      connectorRef.current.disconnectAll().catch(() => {});
    }
    setAccount(null);
    setIsReal(false);
    localStorage.removeItem(STORAGE_KEY);
  }, [isReal]);

  const signAndExecuteTransfer = useCallback(
    async (payTo: string, amountTinybars: string): Promise<string | null> => {
      const connector = connectorRef.current;
      if (!isReal || !connector) {
        throw new Error(
          "Connect a real HashPack wallet to pay on-chain (set NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID).",
        );
      }
      const signer = connector.signers?.[0];
      if (!signer) throw new Error("No wallet signer available.");

      const { TransferTransaction, Hbar, AccountId } = await import("@hiero-ledger/sdk");
      const { transactionToBase64String } = await import("@hashgraph/hedera-wallet-connect");

      const fromAccountId = signer.getAccountId().toString();
      const amount = Hbar.fromTinybars(amountTinybars);

      // Build the transfer UNFROZEN. HashPack picks the node accounts, freezes,
      // signs and submits it — the dApp has no Hedera client, so freezing here
      // would fail with "nodeAccountId must be set or client must be provided".
      const tx = new TransferTransaction()
        .addHbarTransfer(AccountId.fromString(fromAccountId), amount.negated())
        .addHbarTransfer(AccountId.fromString(payTo), amount);

      try {
        const result = (await withTimeout(
          connector.signAndExecuteTransaction({
            signerAccountId: `hedera:${NETWORK}:${fromAccountId}`,
            transactionList: transactionToBase64String(tx),
          }),
          45_000,
          WALLET_TIMEOUT,
        )) as Record<string, any>;

        const txId =
          result?.transactionId ??
          result?.result?.transactionId ??
          result?.response?.transactionId;
        // No id in the response (or an unexpected shape): the payment may still
        // have settled on-chain. Return null so the backend verifies it by
        // searching the buyer's recent transfers on the mirror node.
        return txId ? String(txId) : null;
      } catch (err) {
        // Timeout / dropped WalletConnect response → fall back to mirror verify.
        if ((err as Error).message === WALLET_TIMEOUT) return null;
        // A real error (e.g. the user rejected the request) must abort.
        throw err;
      }
    },
    [isReal],
  );

  const value = useMemo(
    () => ({
      account,
      connected: Boolean(account),
      isReal,
      connect,
      disconnect,
      signAndExecuteTransfer,
    }),
    [account, isReal, connect, disconnect, signAndExecuteTransfer],
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within WalletProvider");
  return ctx;
}
