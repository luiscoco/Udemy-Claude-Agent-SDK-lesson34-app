import { runAgent, validateConfig } from "./agent.js";
await runAgent(
  validateConfig({ mode: process.argv[2] || "audit-success" }),
  (event) => console.log(JSON.stringify(event)),
  new AbortController(),
  process.argv.includes("--approve-review")
    ? async () => {
        await new Promise((ok) => setTimeout(ok, 9000));
        return "approve";
      }
    : undefined,
);
