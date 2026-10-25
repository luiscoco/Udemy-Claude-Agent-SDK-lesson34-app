import { createServer } from "node:http";
import type { Mode, Receipt } from "./protocol.js";
export async function createCollector(
  mode: Mode,
  note: (kind: string, channel: string, detail: unknown) => void,
) {
  const receipts: Receipt[] = [];
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer(async (req, res) => {
    if (
      req.method !== "POST" ||
      !["/audit", "/slack"].includes(req.url || "")
    ) {
      res.writeHead(404);
      res.end();
      return;
    }
    const channel = req.url === "/slack" ? "slack" : "audit";
    let body = "";
    try {
      for await (const chunk of req) {
        body += chunk;
        if (Buffer.byteLength(body) > 12000)
          throw new Error("Payload too large.");
      }
      const payload = JSON.parse(body);
      const receipt: Receipt = {
        channel,
        payload,
        receivedAt: Date.now(),
        respondedAt: null,
        status: null,
        aborted: false,
      };
      receipts.push(receipt);
      note("receiver-request", channel, payload);
      const delay =
        mode === "async-audit"
          ? 5000
          : ["timeout-pre", "timeout-post"].includes(mode)
            ? 2500
            : mode === "audit-abort"
              ? 1500
              : 0;
      const status = mode === "audit-error" ? 503 : 200;
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (res.destroyed) return;
        receipt.respondedAt = Date.now();
        receipt.status = status;
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: status === 200 }));
        note("receiver-response", channel, { status });
      }, delay);
      timers.add(timer);
      res.on("close", () => {
        clearTimeout(timer);
        timers.delete(timer);
        if (!res.writableEnded) {
          receipt.aborted = true;
          note("receiver-aborted", channel, { status: null });
        }
      });
    } catch {
      res.writeHead(400);
      res.end("Invalid bounded JSON payload.");
    }
  });
  await new Promise<void>((ok, fail) => {
    server.once("error", fail);
    server.listen(0, "127.0.0.1", ok);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local receiver unavailable.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    receipts,
    async close() {
      for (const t of timers) clearTimeout(t);
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}
