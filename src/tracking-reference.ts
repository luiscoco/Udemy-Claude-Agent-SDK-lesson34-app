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
