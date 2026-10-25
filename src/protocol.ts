export const EXPERIMENTS = [
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
export type Mode = (typeof EXPERIMENTS)[number];
export interface Receipt {
  channel: string;
  payload: unknown;
  receivedAt: number;
  respondedAt: number | null;
  status: number | null;
  aborted: boolean;
}
export interface IntegrationRecord {
  sequence: number;
  atMs: number;
  kind: string;
  channel: string;
  detail: unknown;
}
export interface ReviewRequest {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  toolUseID: string;
  deadline: string;
}
export interface RunConfig {
  mode: Mode;
  prediction?: "execute" | "block" | "mixed" | "observe";
}
export interface HookRecord {
  sequence: number;
  hook: string;
  event: string;
  tool: string | null;
  toolUseID: string | null;
  sessionId: string;
  cwd: string;
  input: unknown;
  output: unknown;
  signalAborted: boolean;
}
export interface Evidence {
  mode: Mode;
  prediction?: string;
  predictedCorrect?: boolean;
  expectedStage: string;
  expectedOutcome: string;
  observedOutcome: string;
  fixtureUnchanged: boolean;
  callbackCalls: number;
  callbackInputs: unknown[];
  reviewDecisions: string[];
  pendingAfterRun: number;
  completed: string[];
  nativeErrors: number;
  reportedModes: string[];
  resultStatuses: string[];
  sessionIds: string[];
  hookCount: number;
  hookCounts: Record<string, number>;
  hooks: HookRecord[];
  correlatedToolIDs: string[];
  receipts: Receipt[];
  integrations: IntegrationRecord[];
  notificationsObserved: number;
  httpErrors: number;
  abortedRequests: number;
  asyncReturnedBeforeCompletion: boolean;
  nativeResultBeforeAsyncCompletion: boolean;
  subagentCallbacks: number;
}
export type LabEvent =
  | { type: "integration"; record: IntegrationRecord }
  | { type: "options"; config: RunConfig; options: unknown }
  | { type: "configuration"; files: { name: string; contents: string }[] }
  | {
      type: "initialized";
      model: string;
      sessionId: string;
      tools: string[];
      permissionMode: string;
    }
  | { type: "hook"; record: HookRecord }
  | { type: "review-request"; request: ReviewRequest }
  | { type: "review-resolved"; decision: string }
  | { type: "callback"; tool: string; decision: string }
  | { type: "tool"; name: string; args: unknown }
  | { type: "native-result"; name: string; isError: boolean; content: unknown }
  | { type: "message"; sdkType: string; summary: string }
  | { type: "answer"; text: string }
  | { type: "result"; status: string; text: string; costUsd: number | null }
  | ({ type: "evidence" } & Evidence)
  | { type: "error" | "notice"; text: string };
