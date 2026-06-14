/**
 * stdout is the MCP JSON-RPC channel — anything else written there corrupts the
 * protocol. Some dependencies (e.g. the Hedera proto layer patching Long.js)
 * `console.log` at load time, which writes to stdout. Route every console.log to
 * stderr so stdout stays pure JSON-RPC. Imported FIRST, before any SDK loads.
 */
console.log = (...args: unknown[]): void => {
  console.error(...args);
};
