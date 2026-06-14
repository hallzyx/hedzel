"use client";

import { useEffect, useState } from "react";
import { ChatInterface, type ChatMessage } from "@/components/ChatInterface";
import { ServiceCard } from "@/components/ServiceCard";
import { WalletConnectButton } from "@/components/WalletConnectButton";
import {
  PaymentConfirmModal,
  type PendingPayment,
} from "@/components/PaymentConfirmModal";
import {
  getCatalog,
  sendChat,
  payAndQuery,
  type CatalogService,
  type PayStage,
  type ChatHistoryMsg,
} from "@/lib/api";
import { useWallet } from "@/lib/wallet";

const sampleFor: Record<string, string> = {
  "account-intelligence": "Analyze account 0.0.2",
  "token-report": "Token report for 0.0.9233901",
  "topic-feed": "Show the latest messages of topic 0.0.4320245",
  "network-pulse": "What's the current network pulse?",
  "wallet-forensics": "Wallet forensics for 0.0.800",
};

let counter = 0;
const nextId = () => `m${++counter}`;

/**
 * Build the recent conversation to send with a chat turn, so the agent can
 * answer follow-ups about earlier results. Insight messages contribute their
 * summary plus a trimmed copy of the raw data the question might be about.
 */
function buildHistory(messages: ChatMessage[]): ChatHistoryMsg[] {
  return messages
    .slice(-6)
    .map((m): ChatHistoryMsg | null => {
      if (m.role === "user" && m.text) return { role: "user", content: m.text };
      if (m.role === "agent" && m.text) return { role: "agent", content: m.text };
      if (m.role === "agent" && m.insight) {
        const data = JSON.stringify(m.insight.result.data).slice(0, 1800);
        const summary = m.insight.summary ?? "";
        return { role: "agent", content: `${summary}\n\nData: ${data}` };
      }
      return null;
    })
    .filter((m): m is ChatHistoryMsg => m !== null);
}

export default function Home() {
  const { account, isReal, signAndExecuteTransfer } = useWallet();
  const [catalog, setCatalog] = useState<CatalogService[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    getCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  async function handleAsk() {
    const prompt = input.trim();
    if (!prompt) return;
    setMessages((m) => [...m, { id: nextId(), role: "user", text: prompt }]);
    setInput("");
    setBusy(true);
    try {
      // `messages` here is the conversation BEFORE this prompt — the prior context.
      const turn = await sendChat(prompt, buildHistory(messages));
      if (turn.kind === "service") {
        setPending({
          service_id: turn.service_id,
          name: turn.name,
          params: turn.params,
          price: turn.price,
        });
      } else {
        // Free conversational reply — greeting, explanation, or polite refusal.
        setMessages((m) => [...m, { id: nextId(), role: "agent", text: turn.text }]);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { id: nextId(), role: "agent", error: (err as Error).message },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function confirmPay() {
    if (!pending || !account) return;
    const job = pending;
    setBusy(true);
    setStatus("Requesting payment terms…");

    const stageText = (stage: PayStage): string => {
      switch (stage) {
        case "quoting":
          return "Requesting payment terms…";
        case "awaiting_approval":
          return "Waiting for approval in HashPack…";
        case "settling":
          return "Confirming your payment on Hedera…";
        case "verified":
          return "Payment confirmed — fetching live data…";
        case "running":
          return `Running ${job.name} against the mirror node…`;
        case "summarizing":
          return "Writing the summary…";
      }
    };

    try {
      const insight = await payAndQuery(
        job.service_id,
        job.params,
        account,
        // Only sign on-chain with a real wallet; demo mode uses the dev-mode path.
        isReal ? signAndExecuteTransfer : undefined,
        (stage) => {
          setStatus(stageText(stage));
          // Once the payment is submitted, close the modal and narrate the rest
          // in the chat thread's working indicator.
          if (stage === "settling") setPending(null);
        },
      );
      setMessages((m) => [...m, { id: nextId(), role: "agent", insight }]);
      setPending(null);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { id: nextId(), role: "agent", error: (err as Error).message },
      ]);
      setPending(null);
    } finally {
      setBusy(false);
      setStatus(null);
    }
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="mark">x402 · Hedera</span>
          <h1>
            Insights <em>Agent</em>
          </h1>
        </div>
        <WalletConnectButton />
      </header>

      <aside className="sidebar">
        <div className="eyebrow">Catalog</div>
        {catalog.map((s, i) => (
          <ServiceCard
            key={s.id}
            service={s}
            index={i}
            onTry={(svc) => setInput(sampleFor[svc.id] ?? `Use ${svc.name}`)}
          />
        ))}
      </aside>

      <ChatInterface
        messages={messages}
        input={input}
        setInput={setInput}
        onSubmit={handleAsk}
        busy={busy && !pending}
        status={status}
      />

      {pending && (
        <PaymentConfirmModal
          pending={pending}
          busy={busy}
          status={status}
          onConfirm={confirmPay}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
