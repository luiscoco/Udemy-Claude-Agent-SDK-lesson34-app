import { randomUUID } from "node:crypto";
import type { ReviewRequest, LabEvent } from "./protocol.js";
export type ReviewDecision = "approve" | "deny";
const pending = new Map<string, (decision: ReviewDecision) => void>();
export function pendingCount() {
  return pending.size;
}
export function resolveReview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Provide a review ID and decision.");
  const v = value as Record<string, unknown>;
  if (
    typeof v.id !== "string" ||
    !["approve", "deny"].includes(String(v.decision))
  )
    throw new Error("Choose approve or deny for a review ID.");
  const settle = pending.get(v.id);
  if (!settle) return false;
  settle(v.decision as ReviewDecision);
  return true;
}
export function requestReview(
  details: Omit<ReviewRequest, "id" | "deadline">,
  emit: (e: LabEvent) => void,
  signal: AbortSignal,
  timeoutMs = 120000,
): Promise<ReviewDecision> {
  return new Promise((resolve) => {
    const id = randomUUID();
    let done = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (decision: ReviewDecision) => {
      if (done) return;
      done = true;
      pending.delete(id);
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      emit({ type: "review-resolved", decision });
      resolve(decision);
    };
    const abort = () => finish("deny");
    pending.set(id, finish);
    timer = setTimeout(abort, timeoutMs);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    emit({
      type: "review-request",
      request: {
        ...details,
        id,
        deadline: new Date(Date.now() + timeoutMs).toISOString(),
      },
    });
  });
}
