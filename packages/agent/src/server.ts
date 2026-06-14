import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { catalogRouter } from "./routes/catalog.js";
import { checkoutRouter } from "./routes/checkout.js";
import { ordersRouter } from "./routes/orders.js";
import { insightsRouter } from "./routes/insights.js";

const app = express();

app.use(cors({ origin: env.corsOrigin.split(",").map((o) => o.trim()) }));
app.use(express.json({ limit: "256kb" }));

// Health check — also the target for the 14-day keep-alive cron on Railway.
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    network: env.hedera.network,
    x402_mode: env.x402.mode,
    llm_enabled: Boolean(env.llm.apiKey),
    time: new Date().toISOString(),
  });
});

// ACP + paid endpoints
app.use(catalogRouter);
app.use(checkoutRouter);
app.use(ordersRouter);
app.use(insightsRouter);

// Fallback error handler so a thrown error never crashes the demo.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error("[server] Unhandled error:", err);
    res.status(500).json({ error: "internal error" });
  },
);

app.listen(env.port, () => {
  console.log(`\n  Hedera Insights Agent`);
  console.log(`  ▸ listening on http://localhost:${env.port}`);
  console.log(`  ▸ network:    ${env.hedera.network}`);
  console.log(`  ▸ x402 mode:  ${env.x402.mode}${env.x402.mode === "dev" ? " (no real settlement)" : ""}`);
  console.log(`  ▸ LLM agent:  ${env.llm.apiKey ? "enabled" : "deterministic fallback"}\n`);
});

// Don't let an unhandled rejection take the process down mid-demo.
process.on("unhandledRejection", (reason) => {
  console.error("[server] Unhandled rejection:", reason);
});
