# Claude Agent SDK · Lesson 34 · Hooks in practice

Five linked student pages, large text, actual SDK experiments and coloured code in all thirteen UML steps.

## What you will learn

- Deliver real tool audit events: PostToolUse sends actual tool metadata as JSON to a per-run loopback HTTP receiver. Inspect the request body, response status and tool-use identifier. The local receiver is a classroom integration endpoint.
- Handle HTTP failures and cancellation: Check response.ok because fetch does not throw for HTTP 503. Catch errors inside the integration callback. Pass AbortSignal to fetch and distinguish a short request deadline from an SDK hook timeout.
- Run tracked background work: Return async output for logging-only side effects. Track and drain the actual background promise before collecting final evidence. The callback can return before delivery finishes; async hooks cannot retroactively block or modify execution.
- Forward actual notifications: Keep a real Read review pending long enough for the SDK permission_prompt notification. Forward its actual message in a Slack-format text payload to the local receiver, then approve explicitly in the browser.
- Compare event-specific timeouts: A one-second PreToolUse timeout blocks the read in the verified runtime. A one-second PostToolUse timeout keeps the successful tool result. Inspect actual abort signals and native SDK feedback.
- Troubleshoot and track responsibly: Compare a file-name matcher that never fires with the correct Read matcher. Study the source-linked SubagentStop tracker as a reference. The app launches no subagents and makes no external Slack delivery.

## Configure and run

```powershell
git clone https://github.com/luiscoco/Udemy-Claude-Agent-SDK-lesson34-app.git
cd .\Udemy-Claude-Agent-SDK-lesson34-app
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
npm start
```

From presentations use `cd .\agent-sdk\lesson34-hooks-practice`. Open http://127.0.0.1:3134 and keep the terminal running. Node.js 24+, API credit and model access are required. Windows may require Git Bash.

## Create your .env file

Preserve an existing file. Enter your own model key, then restart. Existing shell values take precedence.

```dotenv
ANTHROPIC_API_KEY=your_api_key
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3134
# Windows only, if needed:
# CLAUDE_CODE_GIT_BASH_PATH=C:/Program Files/Git/bin/bash.exe

```

No GitHub token or Managed Agents IDs are required. Secrets, dependencies and teaching media stay outside Git.

## Run the experiments

### Compare delivery and background work

Run successful delivery, HTTP 503, request cancellation and async logging. Inspect the real receiver receipts and elapsed-time records. Async mode drains its tracked background work before publishing final evidence.

```powershell
npm run sample:env -- audit-success
npm run sample:env -- audit-error
npm run sample:env -- audit-abort
npm run sample:env -- async-audit
```

### Observe a real permission notification

Choose Notification and leave the actual Read review pending for about nine seconds. Inspect the Notification callback and local Slack-format POST, then approve the Read. The CLI flag below explicitly scripts the same delayed approval for a demonstration.

```powershell
npm run sample:env -- notification --approve-review
```

### Force timeouts and repair a matcher

Compare one-second pre-tool and post-tool hook timeouts. Then compare lesson.txt as a matcher with the correct Read tool-name matcher. Read the actual native feedback and delivery records.

```powershell
npm run sample:env -- timeout-pre
npm run sample:env -- timeout-post
npm run sample:env -- matcher-miss
npm run sample:env -- matcher-fixed
npm test
```

## How the app was built

### 1. Validate the fixed classroom experiment

Accept a listed mode and bounded prediction. Browser input cannot supply a webhook URL, arbitrary tool or hook code.

Source: `src/modes.ts`, selected lines 52–58. Surrounding code omitted.

```typescript
export function validateConfig(value: unknown): RunConfig {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !MODES.includes((value as RunConfig).mode)
  )
```

### 2. Start a per-run local receiver

Bind to a random available loopback port. The receiver records actual requests and responses; it is separate from any external Slack workspace.

Source: `src/collector.ts`, selected lines 71–76. Surrounding code omitted.

```typescript
server.listen(0, "127.0.0.1", ok);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local receiver unavailable.");
  return {
```

### 3. Bound the actual Read request

Only lesson.txt can be read. The notification experiment returns ask so an actual pending review can generate permission_prompt.

Source: `src/hooks.ts`, selected lines 63–72. Surrounding code omitted.

```typescript
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
```

### 4. Register the selected matcher and timeout

The intentionally wrong file-name matcher misses Read. The corrected matcher selects the tool name. Timeout is configured in seconds on the matcher entry.

Source: `src/hooks.ts`, selected lines 173–180. Surrounding code omitted.

```typescript
matcher: mode === "matcher-miss" ? "lesson.txt" : "Read",
              ...(mode === "timeout-post" ? { timeout: 1 } : {}),
              hooks: [wrap("auditWebhook", audit)],
            },
          ]),
    ],
    Notification: [{ hooks: [wrap("notificationForwarder", notify)] }],
    SubagentStop: [
```

### 5. Start the real SDK query

The SDK owns model and tool orchestration. Hook callbacks and native results are actual observations, not browser simulations.

Source: `src/agent.ts`, selected lines 215–217. Surrounding code omitted.

```typescript
const active = query({ prompt: input(), options });
    run = active;
    for await (const message of active) {
```

### 6. Capture actual callback data

Record the event, input, output, tool-use ID and abort state. Notification metadata is preserved separately from tool input.

Source: `src/hooks.ts`, selected lines 33–42. Surrounding code omitted.

```typescript
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
```

### 7. Send JSON and pass the AbortSignal

Post bounded JSON with Content-Type and AbortSignal. A successful fetch promise alone does not imply a successful HTTP status.

Source: `src/integrations.ts`, selected lines 10–17. Surrounding code omitted.

```typescript
const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    note("http-result", channel, { status: response.status });
```

### 8. Catch reporting failures inside the hook

Check HTTP status, catch transport or cancellation errors and record them without rethrowing. Reporting failures must not erase an already successful tool result.

Source: `src/integrations.ts`, selected lines 16–24. Surrounding code omitted.

```typescript
if (!response.ok) throw new Error(`HTTP ${response.status}`);
    note("http-result", channel, { status: response.status });
  } catch (error) {
    note("http-error", channel, {
      message: error instanceof Error ? error.message : "Delivery failed",
      aborted: signal.aborted,
    });
    // A reporting integration must not discard a successful tool result.
  }
```

### 9. Return async output and track the task

Start the actual delivery, retain its promise and return async output. Background-only work cannot retroactively block or modify the tool.

Source: `src/hooks.ts`, selected lines 117–128. Surrounding code omitted.

```typescript
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
```

### 10. Forward the actual notification message

Build a Slack-format text payload from the real Notification message. The classroom target is the per-run local receiver; no external Slack delivery is claimed.

Source: `src/hooks.ts`, selected lines 135–144. Surrounding code omitted.

```typescript
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
```

### 11. Set a one-second pre-tool hook timeout

Set timeout on the PreToolUse matcher and honour the supplied signal. Compare the observed blocked read with the post-tool case where the original tool result is retained.

Source: `src/hooks.ts`, selected lines 152–156. Surrounding code omitted.

```typescript
matcher: "Read",
              timeout: 1,
              hooks: [wrap("slowPreHook", slowPre)],
            },
          ]
```

### 12. Record actual receiver status and cancellation

Record a response only when it is actually sent. A cancelled request has no fabricated success status; its close event records the aborted connection.

Source: `src/collector.ts`, selected lines 49–58. Surrounding code omitted.

```typescript
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
```

### 13. Drain tracked work and inspect evidence

Wait for tracked reporting work before collecting final receipts and the unchanged fixture. Actual timestamps establish callback return, SDK progress and background completion order.

Source: `src/agent.ts`, selected lines 279–286. Surrounding code omitted.

```typescript
await Promise.allSettled(background);
    await new Promise((ok) => setTimeout(ok, 50));
    const files = await workspace.inspect();
    const observedOutcome = completed.length
      ? nativeErrors
        ? "mixed"
        : "execute"
      : "block";
```

## Reference topics and limits

- SubagentStop reference: The registered tracker extracts agent_id and agent_transcript_path from a real SubagentStop input. This app exposes only Read and launches no subagents. Its offline tracker test uses an explicitly labelled unit fixture; that fixture is not presented as a live SDK event.
- Local Slack-format delivery: The Notification demo sends a real HTTP POST containing text to a loopback receiver. This verifies payload construction and error handling without external messaging. A real Slack workspace needs its own incoming webhook URL and secret handling; external Slack delivery is not implemented in this sample.
- Notification availability: Current SDK documentation says permission_prompt occurs after a canUseTool request has waited about six seconds. This app waits roughly nine seconds in the scripted demonstration and verifies the actual Notification callback. Other interactive-only notifications are not assumed to occur.
- Async task ownership: asyncTimeout is milliseconds; matcher timeout is seconds. Returning async output does not make side effects durable or guarantee delivery. The host tracks each background promise and drains it before final evidence. Background failures are caught and remain visible.
- Event-specific timeout outcomes: Verified live: PreToolUse timeout blocks the Read, while PostToolUse timeout preserves its result. Late callback output is recorded as an observation, but the SDK discards output after its timeout. Other event outcomes are reference topics: UserPromptSubmit can block the prompt; Stop/SubagentStop count a timeout as no decision; PreModelSwitch can block the switch. Defaults and details depend on runtime version.
- Matcher and event troubleshooting: Event names are case-sensitive. Tool-event matchers select names such as Read, not lesson.txt. Other events can use different matcher fields, and Stop ignores matchers. Check maxTurns, earlier denial and actual registration before assuming a hook is broken.
- Input shape and recursion: updatedInput belongs inside hookSpecificOutput with hookEventName. Pairing it with defer discards the update. This app does not modify tool input. A UserPromptSubmit hook that launches work needs a re-entry guard to avoid recursive loops; this app starts no nested agent work.
- Scope, cost and cleanup: Only a disposable lesson.txt Read is available. The $0.45 SDK budget threshold is not a prepaid cap. Timers, local HTTP connections and pending reviews are settled during cleanup. API keys, dependencies and all teaching media remain excluded from Git.

## References

- [Official SDK hooks documentation](https://code.claude.com/docs/en/agent-sdk/hooks)
- [TypeScript SDK reference](https://code.claude.com/docs/en/agent-sdk/typescript)

Regenerate student pages with `python scripts/build-pages.py`. Run `npm test` for offline boundaries, review lifecycle, workspace and startup checks.

## SubagentStop tracker · reference only

This read-only application launches no subagents. The registered callback below is tested with an explicitly labelled offline fixture; no fixture is claimed as a live event.

```typescript
import type { HookCallback } from "@anthropic-ai/claude-agent-sdk";
// Reference callback: registered, but this read-only lab launches no subagents.
export function subagentTracker(
  record: (summary: unknown) => void,
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== "SubagentStop") return {};
    record({
      agentId: input.agent_id,
      transcriptPath: input.agent_transcript_path,
    });
    return {};
  };
}

```
