export async function deliver(
  url: string,
  payload: unknown,
  signal: AbortSignal,
  note: (kind: string, channel: string, detail: unknown) => void,
  channel = "audit",
) {
  note("post-start", channel, payload);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    note("http-result", channel, { status: response.status });
  } catch (error) {
    note("http-error", channel, {
      message: error instanceof Error ? error.message : "Delivery failed",
      aborted: signal.aborted,
    });
    // A reporting integration must not discard a successful tool result.
  }
}
