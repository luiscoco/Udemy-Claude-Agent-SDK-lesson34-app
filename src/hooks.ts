import type {
  HookCallback,
  Options,
  HookJSONOutput,
} from "@anthropic-ai/claude-agent-sdk";
import { resolve } from "node:path";
import { deliver } from "./integrations.js";
import { subagentTracker } from "./tracking-reference.js";
import type { Mode, HookRecord } from "./protocol.js";
export function hostAllows(
  cwd: string,
  name: string,
  input: Record<string, unknown>,
) {
  return (
    name === "Read" &&
    typeof input.file_path === "string" &&
    resolve(cwd, input.file_path) === resolve(cwd, "lesson.txt")
  );
}
export function createHooks(
  mode: Mode,
  cwd: string,
  url: string,
  record: (e: Omit<HookRecord, "sequence">) => void,
  complete: (tool: string, id: string | null) => void,
  note: (kind: string, channel: string, detail: unknown) => void,
  track: (p: Promise<void>) => void,
): NonNullable<Options["hooks"]> {
  const wrap =
    (name: string, callback: HookCallback): HookCallback =>
    async (input, id, context) => {
      const output = await callback(input, id, context);
      record({
        hook: name,
        event: input.hook_event_name,
        tool: "tool_name" in input ? String(input.tool_name) : null,
        toolUseID: id ?? null,
        sessionId: input.session_id,
        cwd: input.cwd,
        input:
          "tool_input" in input
            ? input.tool_input
            : "message" in input
              ? {
                  message: input.message,
                  notificationType:
                    "notification_type" in input
                      ? input.notification_type
                      : null,
                }
              : { event: input.hook_event_name },
        output,
        signalAborted: context.signal.aborted,
      });
      note("callback-return", "sdk", {
        hook: name,
        event: input.hook_event_name,
        output,
      });
      return output;
    };
  const guard: HookCallback = async (input) => {
    if (input.hook_event_name !== "PreToolUse") return {};
    if (
      !hostAllows(
        cwd,
        input.tool_name,
        input.tool_input as Record<string, unknown>,
      )
    )
      return {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason:
            "Only the disposable lesson.txt Read is permitted.",
        },
      };
    return mode === "notification"
      ? {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "ask",
            permissionDecisionReason: "Review the fixed classroom read.",
          },
        }
      : {};
  };
  const slowPre: HookCallback = async (input, id, { signal }) => {
    await deliver(
      url + "/audit",
      {
        event: input.hook_event_name,
        tool: "Read",
        purpose: "force-pre-timeout",
      },
      signal,
      note,
    );
    return {};
  };
  const audit: HookCallback = async (
    input,
    id,
    { signal },
  ): Promise<HookJSONOutput> => {
    if (input.hook_event_name !== "PostToolUse") return {};
    const payload = {
      event: input.hook_event_name,
      tool: input.tool_name,
      toolUseID: id,
      timestamp: new Date().toISOString(),
    };
    if (mode === "async-audit") {
      note("async-start", "audit", { tool: input.tool_name });
      const work = deliver(
        url + "/audit",
        payload,
        AbortSignal.any([signal, AbortSignal.timeout(10000)]),
        note,
      ).finally(() => {
        note("async-complete", "audit", { tool: input.tool_name });
      });
      track(work);
      return { async: true, asyncTimeout: 10000 };
    }
    const requestSignal =
      mode === "audit-abort"
        ? AbortSignal.any([signal, AbortSignal.timeout(150)])
        : signal;
    await deliver(url + "/audit", payload, requestSignal, note);
    return {};
  };
  const notify: HookCallback = async (input, id, { signal }) => {
    if (input.hook_event_name !== "Notification") return {};
    await deliver(
      url + "/slack",
      { text: `Agent status: ${input.message}` },
      signal,
      note,
      "slack",
    );
    return {};
  };
  return {
    PreToolUse: [
      { hooks: [wrap("scopeGuard", guard)] },
      ...(mode === "timeout-pre"
        ? [
            {
              matcher: "Read",
              timeout: 1,
              hooks: [wrap("slowPreHook", slowPre)],
            },
          ]
        : []),
    ],
    PostToolUse: [
      {
        hooks: [
          wrap("completionLogger", async (input, id) => {
            if (input.hook_event_name === "PostToolUse")
              complete(input.tool_name, id ?? null);
            return {};
          }),
        ],
      },
      ...(mode === "notification" || mode === "timeout-pre"
        ? []
        : [
            {
              matcher: mode === "matcher-miss" ? "lesson.txt" : "Read",
              ...(mode === "timeout-post" ? { timeout: 1 } : {}),
              hooks: [wrap("auditWebhook", audit)],
            },
          ]),
    ],
    Notification: [{ hooks: [wrap("notificationForwarder", notify)] }],
    SubagentStop: [
      {
        hooks: [
          wrap(
            "subagentTracker",
            subagentTracker((summary) =>
              note("subagent-stopped", "sdk", summary),
            ),
          ),
        ],
      },
    ],
  };
}
