import type { Mode, RunConfig } from "./protocol.js";
export const MODES = [
  "audit-success",
  "audit-error",
  "audit-abort",
  "async-audit",
  "notification",
  "timeout-pre",
  "timeout-post",
  "matcher-miss",
  "matcher-fixed",
] as const;
export const SCENARIOS: Record<Mode, { stage: string; outcome: string }> = {
  "audit-success": {
    stage: "PostToolUse delivers actual tool metadata to the local receiver",
    outcome: "execute",
  },
  "audit-error": {
    stage: "Catch HTTP 503 and retain the real tool result",
    outcome: "execute",
  },
  "audit-abort": {
    stage: "Abort a slow HTTP delivery with a local request deadline",
    outcome: "execute",
  },
  "async-audit": {
    stage: "Return async output before background HTTP acknowledgement",
    outcome: "execute",
  },
  notification: {
    stage:
      "Wait for an actual permission_prompt and forward its Slack-format payload locally",
    outcome: "execute",
  },
  "timeout-pre": {
    stage: "One-second PreToolUse timeout; inspect the native outcome",
    outcome: "block",
  },
  "timeout-post": {
    stage: "One-second PostToolUse timeout; retain the tool result",
    outcome: "execute",
  },
  "matcher-miss": {
    stage: "A file-name matcher misses the actual Read tool",
    outcome: "execute",
  },
  "matcher-fixed": {
    stage: "The Read matcher triggers the actual audit callback",
    outcome: "execute",
  },
};
export function validateConfig(value: unknown): RunConfig {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !MODES.includes((value as RunConfig).mode)
  )
    throw new Error("Choose a listed practical hook experiment.");
  const c = value as RunConfig;
  if (
    c.prediction !== undefined &&
    !["execute", "block", "mixed", "observe"].includes(c.prediction)
  )
    throw new Error("Choose a listed prediction.");
  return { mode: c.mode, prediction: c.prediction };
}
