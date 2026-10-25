import { renderMarkdown } from "./markdown.js";
import type { LabEvent, Mode, RunConfig } from "./protocol.js";
const $ = (id: string) => document.getElementById(id)!;
const button = $("run") as HTMLButtonElement,
  rows: LabEvent[] = [];
const deliveries: unknown[] = [];
const traces: unknown[] = [],
  native: unknown[] = [],
  warnings: unknown[] = [];
const json = (id: string, value: unknown) => {
  $(id).textContent = JSON.stringify(value, null, 2);
  (window as any).Prism?.highlightElement($(id));
};
let reviewID = "";
for (const [id, decision] of [
  ["approve-review", "approve"],
  ["deny-review", "deny"],
]) {
  $(id).onclick = async () => {
    const response = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: reviewID, decision }),
    });
    if (!response.ok) $("review-status").textContent = await response.text();
  };
}
function receive(e: LabEvent) {
  rows.push(e);
  if (e.type === "integration") {
    deliveries.push(e.record);
    json("delivery-record", e.record);
    const selector = $("delivery-select") as HTMLSelectElement;
    const option = document.createElement("option");
    option.value = String(deliveries.length - 1);
    option.textContent = `${e.record.sequence} · ${e.record.atMs} ms · ${e.record.kind} · ${e.record.channel}`;
    selector.append(option);
    selector.value = option.value;
    selector.onchange = () =>
      json("delivery-record", deliveries[Number(selector.value)]);
    json("delivery-trace", deliveries);
    const tr = document.createElement("tr");
    for (const value of [
      e.record.sequence,
      e.record.atMs,
      e.record.kind,
      e.record.channel,
    ]) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.append(td);
    }
    $("delivery-history").append(tr);
  }
  if (e.type === "review-request") {
    reviewID = e.request.id;
    json("review-input", e.request);
    $("review-panel").hidden = false;
    $("review-status").textContent = "Waiting for your explicit decision.";
    (document.getElementById("approve-review") as HTMLButtonElement).disabled =
      false;
    (document.getElementById("deny-review") as HTMLButtonElement).disabled =
      false;
  }
  if (e.type === "review-resolved") {
    reviewID = "";
    $("review-status").textContent = "Review resolved: " + e.decision;
    (document.getElementById("approve-review") as HTMLButtonElement).disabled =
      true;
    (document.getElementById("deny-review") as HTMLButtonElement).disabled =
      true;
  }
  if (e.type === "hook") {
    traces.push(e.record);
    json("trace", traces);
    json("hook-output", e.record);
    const picker = $("hook-select") as HTMLSelectElement;
    const option = document.createElement("option");
    option.value = String(traces.length - 1);
    option.textContent = `${e.record.sequence} · ${e.record.event} · ${e.record.hook} · ${e.record.tool || "lifecycle"}`;
    picker.append(option);
    picker.value = option.value;
    picker.onchange = () => json("hook-output", traces[Number(picker.value)]);
    const row = document.createElement("tr");
    for (const value of [
      e.record.sequence,
      e.record.event,
      e.record.hook,
      e.record.tool || "—",
      e.record.toolUseID || "—",
    ]) {
      const td = document.createElement("td");
      td.textContent = String(value);
      row.append(td);
    }
    $("hook-history").append(row);
  }
  if (e.type === "configuration") {
    const select = $("configuration-file") as HTMLSelectElement;
    select.replaceChildren();
    e.files.forEach((file, i) => {
      const option = document.createElement("option");
      option.value = String(i);
      option.textContent = file.name;
      select.append(option);
    });
    const show = () => {
      $("configuration-content").textContent =
        e.files[Number(select.value)].contents;
      (window as any).Prism?.highlightElement($("configuration-content"));
    };
    select.onchange = show;
    show();
  }
  if (e.type === "options") json("options", e.options);
  if (e.type === "initialized") {
    $("session").textContent = e.sessionId;
    json("discovery", e);
  }
  if (e.type === "native-result") {
    native.push(e);
    json("native", native);
  }
  if (e.type === "answer") renderMarkdown($("answer"), e.text);
  if (e.type === "result") {
    $("status").textContent = e.status;
    $("cost").textContent =
      e.costUsd === null
        ? "Not reported by SDK for cancelled run"
        : "$" + e.costUsd.toFixed(5);
    renderMarkdown($("answer"), e.text);
  }
  if (e.type === "evidence") {
    json("evidence", e);
    const feedback =
      e.predictedCorrect === undefined
        ? "No prediction provided."
        : e.predictedCorrect
          ? "Your prediction matched."
          : "Compare the recorded evidence with the reference order.";
    $("verdict").textContent =
      `Observed: ${e.observedOutcome}. Prediction: ${e.prediction || "not provided"}. ` +
      feedback;
    const tr = document.createElement("tr");
    for (const value of [
      e.mode,
      e.expectedStage,
      e.prediction || "—",
      e.observedOutcome,
      e.callbackCalls,
      e.hookCount,
      String(e.receipts.length) + " received",
    ]) {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.append(td);
    }
    $("history").append(tr);
  }
  if (e.type === "notice" || e.type === "error")
    $("notice").textContent = e.text;
  if (e.type === "error") $("status").textContent = "Could not finish";
  if (
    [
      "message",
      "tool",
      "native-result",
      "trace",
      "result",
      "warning",
      "error",
    ].includes(e.type)
  ) {
    const li = document.createElement("li");
    li.textContent = JSON.stringify(e);
    $("events").append(li);
  }
}
button.onclick = async () => {
  button.disabled = true;
  $("review-panel").hidden = true;
  reviewID = "";
  traces.length = 0;
  deliveries.length = 0;
  $("delivery-select").replaceChildren();
  json("delivery-record", {});
  $("delivery-history").replaceChildren();
  json("delivery-trace", []);
  native.length = 0;
  warnings.length = 0;
  $("hook-history").replaceChildren();
  $("hook-select").replaceChildren();
  json("hook-output", {});
  $("answer").replaceChildren();
  $("events").replaceChildren();
  $("notice").textContent = "";
  $("status").textContent = "Running…";
  $("verdict").textContent = "Waiting for actual evidence…";
  for (const id of [
    "options",
    "discovery",
    "native",
    "trace",
    "evidence",
    "hook-output",
  ])
    json(id, {});
  $("session").textContent = "—";
  $("cost").textContent = "—";
  const config: RunConfig = {
    mode: ($("mode") as HTMLSelectElement).value as Mode,
    prediction: ($("prediction") as HTMLSelectElement).value as
      | "execute"
      | "block"
      | "mixed"
      | "observe",
  };
  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok) throw new Error(await response.text());
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    let pending = "";
    while (true) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split("\n");
      pending = lines.pop()!;
      for (const line of lines)
        if (line.startsWith("data: ")) receive(JSON.parse(line.slice(6)));
      if (done) break;
    }
    if ($("status").textContent === "Running…")
      $("status").textContent = "No final result; inspect the actual events";
  } catch (error) {
    $("status").textContent = "Could not finish";
    $("notice").textContent =
      error instanceof Error ? error.message : "Request failed";
  } finally {
    button.disabled = false;
  }
};
$("download").onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(rows, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "lesson34-observations.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
fetch("/api/config")
  .then((r) => r.json())
  .then((c) => {
    $("configuration").textContent =
      `Model: ${c.model} · SDK ${c.typescriptVersion} · ${c.ready ? "API key configured" : "Configure .env first"}`;
    button.disabled = !c.ready;
    ($("mode") as HTMLSelectElement).value = c.defaults.mode;
  })
  .catch(() => {
    $("configuration").textContent =
      "Could not reach the server. See How to run.";
  });
