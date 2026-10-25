import test from "node:test";
import assert from "node:assert/strict";
import { resolve, join } from "node:path";
import { createCollector } from "./collector.js";
import { deliver } from "./integrations.js";
import { createHooks, hostAllows } from "./hooks.js";
import { validateConfig } from "./modes.js";
import { prepareWorkspace } from "./workspace.js";
import { subagentTracker } from "./tracking-reference.js";
import { requestReview, resolveReview, pendingCount } from "./reviews.js";
const cwd = resolve("lesson34-unit"),
  post = {
    hook_event_name: "PostToolUse",
    session_id: "unit",
    transcript_path: "unit",
    cwd,
    tool_name: "Read",
    tool_input: { file_path: join(cwd, "lesson.txt") },
    tool_response: { marker: "unit" },
  } as const;
test("fixed scenarios and read scope reject unrelated input", () => {
  assert.throws(() => validateConfig({ mode: "unlisted" }));
  assert.throws(() =>
    validateConfig({ mode: "audit-success", prediction: "guess" }),
  );
  assert.equal(
    hostAllows(cwd, "Read", { file_path: join(cwd, "lesson.txt") }),
    true,
  );
  assert.equal(
    hostAllows(cwd, "Read", { file_path: join(cwd, ".env") }),
    false,
  );
  assert.equal(hostAllows(cwd, "Write", {}), false);
});
test("actual local HTTP receiver records the delivered JSON and status", async () => {
  const notes: any[] = [];
  const note = (...args: any[]) => notes.push(args);
  const c = await createCollector("audit-success", note);
  try {
    await deliver(
      c.url + "/audit",
      { tool: "Read" },
      new AbortController().signal,
      note,
    );
    assert.equal(c.receipts.length, 1);
    assert.deepEqual(c.receipts[0].payload, { tool: "Read" });
    assert.equal(c.receipts[0].status, 200);
    assert.ok(notes.some((n) => n[0] === "http-result"));
  } finally {
    await c.close();
  }
});
test("HTTP errors are caught instead of being rethrown from the hook", async () => {
  const notes: any[] = [];
  const note = (...args: any[]) => notes.push(args);
  const c = await createCollector("audit-error", note);
  try {
    await assert.doesNotReject(
      deliver(
        c.url + "/audit",
        { tool: "Read" },
        new AbortController().signal,
        note,
      ),
    );
    assert.equal(c.receipts[0].status, 503);
    assert.ok(notes.some((n) => n[0] === "http-error"));
  } finally {
    await c.close();
  }
});
test("request cancellation closes the actual local delivery", async () => {
  const notes: any[] = [];
  const note = (...args: any[]) => notes.push(args);
  const c = await createCollector("audit-abort", note);
  try {
    await deliver(
      c.url + "/audit",
      { tool: "Read" },
      AbortSignal.timeout(150),
      note,
    );
    await new Promise((ok) => setTimeout(ok, 30));
    assert.equal(c.receipts[0].aborted, true);
    assert.equal(c.receipts[0].status, null);
    assert.ok(notes.some((n) => n[0] === "http-error" && n[2].aborted));
  } finally {
    await c.close();
  }
});
test("event and matcher registration distinguishes missing, fixed and timeout cases", () => {
  const make = (mode: any) =>
    createHooks(
      mode,
      cwd,
      "http://127.0.0.1",
      () => {},
      () => {},
      () => {},
      () => {},
    );
  assert.equal(make("matcher-miss").PostToolUse![1].matcher, "lesson.txt");
  assert.equal(make("matcher-fixed").PostToolUse![1].matcher, "Read");
  assert.equal(make("timeout-pre").PreToolUse![1].timeout, 1);
  assert.equal(make("timeout-post").PostToolUse![1].timeout, 1);
  assert.ok(make("notification").Notification);
  assert.ok(make("notification").SubagentStop);
});
test("async callback returns before its actual HTTP acknowledgement; task remains tracked", async () => {
  const c = await createCollector("async-audit", () => {});
  const tasks: Promise<void>[] = [];
  let completed = false;
  try {
    const hooks = createHooks(
      "async-audit",
      cwd,
      c.url,
      () => {},
      () => {},
      () => {},
      (p) => {
        tasks.push(
          p.then(() => {
            completed = true;
          }),
        );
      },
    );
    const out = await hooks.PostToolUse![1].hooks[0](post as any, "unit", {
      signal: new AbortController().signal,
    });
    assert.deepEqual(out, { async: true, asyncTimeout: 10000 });
    assert.equal(completed, false);
    await Promise.all(tasks);
    assert.equal(c.receipts[0].status, 200);
  } finally {
    await c.close();
  }
});
test("review IDs settle once and abort denies without leaking pending state", async () => {
  let id = "";
  const signal = new AbortController();
  const first = requestReview(
    { tool: "Read", input: {}, toolUseID: "unit" },
    (e) => {
      if (e.type === "review-request") id = e.request.id;
    },
    signal.signal,
  );
  assert.equal(resolveReview({ id, decision: "approve" }), true);
  assert.equal(await first, "approve");
  assert.equal(resolveReview({ id, decision: "approve" }), false);
  const next = new AbortController();
  const second = requestReview(
    { tool: "Read", input: {}, toolUseID: "unit" },
    () => {},
    next.signal,
  );
  next.abort();
  assert.equal(await second, "deny");
  assert.equal(pendingCount(), 0);
});
test("SubagentStop reference parses an explicitly labelled unit fixture", async () => {
  let summary: unknown;
  const tracker = subagentTracker((s) => {
    summary = s;
  });
  assert.deepEqual(
    await tracker(
      {
        hook_event_name: "SubagentStop",
        agent_id: "unit-fixture-agent",
        agent_transcript_path: "unit-fixture.jsonl",
      } as any,
      "unit",
      { signal: new AbortController().signal },
    ),
    {},
  );
  assert.deepEqual(summary, {
    agentId: "unit-fixture-agent",
    transcriptPath: "unit-fixture.jsonl",
  });
});
test("disposable lesson fixture is checked before bounded cleanup", async () => {
  const w = await prepareWorkspace();
  try {
    assert.equal((await w.inspect()).fixtureUnchanged, true);
  } finally {
    await w.cleanup();
  }
});
