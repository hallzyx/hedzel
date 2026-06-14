import { NextResponse } from "next/server";

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:3001";

/**
 * Thin server-side proxy to the agent backend's free intent resolver. Keeps the
 * agent URL server-side and avoids CORS for the first hop. The paid /insights
 * call carries the X-PAYMENT header and is made directly from the client.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const prompt = String(body?.prompt ?? "").trim();
  if (!prompt) {
    return NextResponse.json({ error: "prompt is required" }, { status: 400 });
  }
  try {
    const res = await fetch(`${AGENT_URL}/resolve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err) {
    return NextResponse.json(
      { error: `agent unreachable: ${(err as Error).message}` },
      { status: 502 },
    );
  }
}
