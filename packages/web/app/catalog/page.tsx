import Link from "next/link";
import type { CatalogService } from "@/lib/api";

async function loadCatalog(): Promise<CatalogService[]> {
  const url = `${process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3001"}/catalog`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const body = await res.json();
    return body.services as CatalogService[];
  } catch {
    return [];
  }
}

export default async function CatalogPage() {
  const services = await loadCatalog();
  return (
    <div className="shell" style={{ gridTemplateColumns: "1fr", gridTemplateAreas: '"header" "main"' }}>
      <header className="topbar">
        <div className="brand">
          <span className="mark">Catalog</span>
          <h1>
            Insights <em>Agent</em>
          </h1>
        </div>
        <Link className="btn btn-ghost" href="/">
          ← Back to chat
        </Link>
      </header>
      <main className="thread" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16, alignContent: "start" }}>
        {services.length === 0 && (
          <p style={{ color: "var(--text-dim)" }}>
            Catalog unavailable — is the agent backend running on{" "}
            {process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3001"}?
          </p>
        )}
        {services.map((s) => (
          <div className="card" key={s.id} style={{ cursor: "default" }}>
            <div className="card-head">
              <h3>{s.name}</h3>
              <span className="price">
                {s.price.amount} {s.price.currency}
              </span>
            </div>
            <p>{s.description}</p>
            <div className="try" style={{ opacity: 1, color: "var(--text-faint)" }}>
              service_id: {s.id}
            </div>
          </div>
        ))}
      </main>
    </div>
  );
}
