import {
  query,
  type Options,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { MODES, SCENARIOS, validateConfig } from "./modes.js";
import { prepareWorkspace } from "./workspace.js";
import { createHooks, hostAllows } from "./hooks.js";
import { requestReview, pendingCount, type ReviewDecision } from "./reviews.js";
import { createCollector } from "./collector.js";
import type { IntegrationRecord } from "./protocol.js";
import type { ReviewRequest } from "./protocol.js";
import type {
  RunConfig,
  Mode,
  LabEvent,
  HookRecord,
  Evidence,
} from "./protocol.js";
export { MODES, validateConfig };
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
export const DEFAULT_CONFIG: RunConfig = {
  mode: "audit-success",
  prediction: "execute",
};
export const PROMPTS = Object.fromEntries(
  MODES.map((mode) => [
    mode,
    "Attempt Read exactly once on lesson.txt. Wait for the actual tool result, then report its exact lesson marker. If blocked or timed out, accept the result without retry, workaround, delegation or another tool. Briefly explain the actual failure instead of inventing file content.",
  ]),
) as Record<Mode, string>;
export function redact(text: string) {
  for (const secret of [
    process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_AUTH_TOKEN,
  ].filter(Boolean) as string[])
    text = text.split(secret).join("[REDACTED]");
  return text.replace(/sk-ant-[A-Za-z0-9_-]+/g, "[REDACTED]").slice(0, 24000);
}
export async function runAgent(
  value: RunConfig,
  emit: (event: LabEvent) => void,
  controller = new AbortController(),
  reviewer?: (request: ReviewRequest) => Promise<ReviewDecision>,
) {
  const c = validateConfig(value),
    s = SCENARIOS[c.mode],
    workspace = await prepareWorkspace();
  const hooks: HookRecord[] = [],
    completed: string[] = [],
    callbackInputs: unknown[] = [],
    reviewDecisions: string[] = [],
    reportedModes: string[] = [],
    resultStatuses: string[] = [],
    sessionIds: string[] = [];
  const completedIDs: string[] = [],
    names = new Map<string, string>();
  let callbackCalls = 0,
    nativeErrors = 0,
    finalText = "";
  const record = (entry: Omit<HookRecord, "sequence">) => {
    const item = { sequence: hooks.length + 1, ...entry };
    hooks.push(item);
    emit({ type: "hook", record: item });
  };
  const started = Date.now(),
    integrations: IntegrationRecord[] = [],
    background: Promise<void>[] = [];
  const note = (kind: string, channel: string, detail: unknown) => {
    const record = {
      sequence: integrations.length + 1,
      atMs: Date.now() - started,
      kind,
      channel,
      detail,
    };
    integrations.push(record);
    emit({ type: "integration", record });
  };
  const collector = await createCollector(c.mode, note);
  const registered = createHooks(
    c.mode,
    workspace.cwd,
    collector.url,
    record,
    (tool, id) => {
      completed.push(tool);
      if (id) completedIDs.push(id);
    },
    note,
    (p) => background.push(p),
  );
  const options: Options = {
    model: MODEL,
    cwd: workspace.cwd,
    tools: ["Read"],
    mcpServers: {},
    allowedTools: c.mode === "notification" ? [] : ["Read"],
    permissionMode: "default",
    hooks: registered,
    settingSources: [],
    skills: [],
    plugins: [],
    strictMcpConfig: true,
    persistSession: false,
    maxTurns: 7,
    maxBudgetUsd: 0.45,
    effort: "low",
    thinking: { type: "disabled" },
    abortController: controller,
    env: {
      ...process.env,
      HOME: workspace.home,
      USERPROFILE: workspace.home,
      CLAUDE_CONFIG_DIR: workspace.sdkHome,
      CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
      ENABLE_CLAUDEAI_MCP_SERVERS: "false",
      ENABLE_TOOL_SEARCH: "false",
    },
    systemPrompt:
      "This is a real bounded hook experiment. Use the requested available tools and wait for their actual results. Never simulate calls or anticipate a denial instead of attempting. If a request is rejected, accept it without retry or workaround; continue only when a distinct next task was explicitly requested. Keep your final answer brief. No subagents or shell commands are available.",
    canUseTool: async (tool, input, context) => {
      callbackCalls++;
      callbackInputs.push({ tool, input });
      if (c.mode === "notification" && hostAllows(workspace.cwd, tool, input)) {
        const request = { tool, input, toolUseID: context.toolUseID };
        const decision = reviewer
          ? await reviewer({
              ...request,
              id: "scripted-review",
              deadline: "Explicitly scripted CLI/test review",
            })
          : await requestReview(request, emit, context.signal);
        reviewDecisions.push(decision);
        emit({ type: "callback", tool, decision });
        if (decision === "approve")
          return { behavior: "allow", updatedInput: input };
      }
      emit({ type: "callback", tool, decision: "deny unresolved permission" });
      return {
        behavior: "deny",
        message: "Classroom review denied this Read. Do not retry.",
      };
    },
  };
  const registration = Object.entries(registered).map(([event, matchers]) => ({
    event,
    matchers: matchers!.map((m) => ({
      matcher: m.matcher ?? "(all)",
      callbackCount: m.hooks.length,
      timeoutSeconds: m.timeout ?? "(event default)",
    })),
  }));
  emit({
    type: "configuration",
    files: [
      {
        name: "Actual hook registrations",
        contents: JSON.stringify(registration, null, 2),
      },
      {
        name: "Classroom boundaries",
        contents: JSON.stringify(
          {
            fixture: "Disposable lesson.txt; Read is the only available tool",
            receiver:
              "Real loopback HTTP receiver; Slack-format payloads are local only",
            settingsSources: [],
            subagents:
              "SubagentStop registered as a reference; no subagents launched",
            logging:
              "Observed callback arrivals; parallel callback order is not guaranteed",
            cost: "Callbacks run locally; context and tool feedback sent to the model can still affect token usage",
          },
          null,
          2,
        ),
      },
    ],
  });
  emit({
    type: "options",
    config: c,
    options: {
      model: MODEL,
      tools: options.tools,
      allowedTools: options.allowedTools,
      permissionMode: options.permissionMode,
      hooks: registration,
      receiver: "Per-run loopback HTTP receiver",
      externalSlackDelivery: false,
      referenceStage: s.stage,
      expectedOutcome: s.outcome,
      cwd: "fresh disposable directory",
    },
  });
  let release!: () => void;
  const gate = new Promise<void>((ok) => {
    release = ok;
  });
  async function* input(): AsyncGenerator<SDKUserMessage> {
    yield {
      type: "user",
      message: {
        role: "user",
        content: PROMPTS[c.mode] + `\nWorking directory: ${workspace.cwd}`,
      },
      parent_tool_use_id: null,
      session_id: "",
    };
    await gate;
  }
  let run: ReturnType<typeof query> | undefined;
  try {
    const active = query({ prompt: input(), options });
    run = active;
    for await (const message of active) {
      emit({
        type: "message",
        sdkType: message.type,
        summary:
          "subtype" in message ? String(message.subtype) : "Actual SDK message",
      });
      if (message.type === "system" && message.subtype === "init") {
        reportedModes.push(message.permissionMode);
        emit({
          type: "initialized",
          model: message.model,
          sessionId: message.session_id,
          tools: message.tools,
          permissionMode: message.permissionMode,
        });
      }
      if (message.type === "assistant")
        for (const block of message.message.content) {
          if (block.type === "text")
            emit({ type: "answer", text: redact(block.text) });
          if (block.type === "tool_use") {
            names.set(block.id, block.name);
            emit({ type: "tool", name: block.name, args: block.input });
          }
        }
      if (message.type === "user" && Array.isArray(message.message.content))
        for (const block of message.message.content)
          if (block.type === "tool_result") {
            if (block.is_error) nativeErrors++;
            note("native-result", "sdk", { isError: Boolean(block.is_error) });
            emit({
              type: "native-result",
              name: names.get(block.tool_use_id) || block.tool_use_id,
              isError: Boolean(block.is_error),
              content: JSON.parse(redact(JSON.stringify(block.content))),
            });
          }
      if (message.type === "result") {
        const status =
          message.subtype === "success"
            ? message.is_error
              ? "error"
              : "success"
            : message.subtype;
        resultStatuses.push(status);
        note("sdk-result", "sdk", { status });
        sessionIds.push(message.session_id);
        finalText = redact(
          message.subtype === "success"
            ? message.result
            : message.errors.join("\n"),
        );
        emit({
          type: "result",
          status,
          text: finalText,
          costUsd: message.total_cost_usd,
        });
        break;
      }
    }
    await Promise.allSettled(background);
    await new Promise((ok) => setTimeout(ok, 50));
    const files = await workspace.inspect();
    const observedOutcome = completed.length
      ? nativeErrors
        ? "mixed"
        : "execute"
      : "block";
    const hookCounts = Object.fromEntries(
      [...new Set(hooks.map((h) => h.hook))].map((name) => [
        name,
        hooks.filter((h) => h.hook === name).length,
      ]),
    );
    const correlatedToolIDs = completedIDs.filter((id) =>
      hooks.some((h) => h.event === "PreToolUse" && h.toolUseID === id),
    );
    const evidence: Evidence = {
      mode: c.mode,
      prediction: c.prediction,
      predictedCorrect: c.prediction
        ? c.prediction === "observe" || c.prediction === observedOutcome
        : undefined,
      expectedStage: s.stage,
      expectedOutcome: s.outcome,
      observedOutcome,
      ...files,
      callbackCalls,
      completed,
      nativeErrors,
      reportedModes,
      resultStatuses,
      sessionIds,
      hookCount: hooks.length,
      hookCounts,
      hooks,
      correlatedToolIDs,
      callbackInputs,
      reviewDecisions,
      pendingAfterRun: pendingCount(),
      receipts: collector.receipts,
      integrations,
      notificationsObserved: hooks.filter((h) => h.event === "Notification")
        .length,
      httpErrors: integrations.filter((i) => i.kind === "http-error").length,
      abortedRequests: collector.receipts.filter((r) => r.aborted).length,
      asyncReturnedBeforeCompletion:
        !!integrations.find((i) => i.kind === "async-complete") &&
        integrations.some(
          (i) =>
            i.kind === "callback-return" &&
            (i.detail as any).output?.async === true &&
            i.atMs <
              integrations.find((i) => i.kind === "async-complete")!.atMs,
        ),
      nativeResultBeforeAsyncCompletion:
        !!integrations.find((i) => i.kind === "async-complete") &&
        integrations.some(
          (i) =>
            i.kind === "native-result" &&
            i.atMs <
              integrations.find((i) => i.kind === "async-complete")!.atMs,
        ),
      subagentCallbacks: hooks.filter((h) => h.event === "SubagentStop").length,
    };
    emit({ type: "evidence", ...evidence });
    return evidence;
  } finally {
    release();
    controller.abort();
    run?.close();
    await Promise.allSettled(background);
    await collector.close();
    await workspace.cleanup();
  }
}
