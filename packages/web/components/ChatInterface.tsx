"use client";

import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import type { InsightResponse } from "@/lib/api";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  text?: string;
  insight?: InsightResponse;
  error?: string;
}

export function ChatInterface({
  messages,
  input,
  setInput,
  onSubmit,
  busy,
  status,
}: {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  onSubmit: () => void;
  busy: boolean;
  status?: string | null;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!busy && input.trim()) onSubmit();
    }
  }

  return (
    <div className="main">
      <div className="thread">
        {messages.length === 0 && (
          <div className="empty">
            <div className="glyph">◇</div>
            <h2>Ask the network anything.</h2>
            <p>
              Real-time intelligence straight from the Hedera mirror node — account
              activity, token holders, topic feeds, network pulse. Each answer is
              data no LLM can fake, so each answer is worth a few tinybars.
            </p>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`msg ${m.role}`}>
            <span className="who">{m.role === "user" ? "You" : "Insights Agent"}</span>
            <div className="bubble">
              {m.error ? (
                <span className="error-line">{m.error}</span>
              ) : m.insight ? (
                <AgentInsight insight={m.insight} />
              ) : m.role === "agent" ? (
                <Markdown>{m.text ?? ""}</Markdown>
              ) : (
                <span>{m.text}</span>
              )}
            </div>
          </div>
        ))}

        {busy && (
          <div className="msg agent">
            <span className="who">Insights Agent</span>
            <div className="bubble">
              <span className="working">
                <span className="dots">
                  <span /> <span /> <span />
                </span>
                {status && <span className="stage">{status}</span>}
              </span>
            </div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="composer">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && input.trim()) onSubmit();
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="e.g. Analyze account 0.0.2  ·  Token report for 0.0.9233901  ·  Network pulse"
            rows={1}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || !input.trim()}>
            Ask →
          </button>
        </form>
      </div>
    </div>
  );
}

/** Renders agent prose as Markdown — bold, lists, headings, code, links. */
function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        components={{
          a: ({ node, ...props }) => <a target="_blank" rel="noreferrer" {...props} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}

function AgentInsight({ insight }: { insight: InsightResponse }) {
  return (
    <div>
      {insight.summary && (
        <div className="summary">
          <Markdown>{insight.summary}</Markdown>
        </div>
      )}
      <details className="raw">
        <summary>
          <span className="chevron" aria-hidden>▸</span> View raw data
        </summary>
        <pre>{JSON.stringify(insight.result.data, null, 2)}</pre>
      </details>
      {insight.tx_proof && (
        <a className="verified" href={insight.tx_proof} target="_blank" rel="noreferrer">
          <span className="dot" /> Verified on Hedera · view on HashScan
        </a>
      )}
    </div>
  );
}
