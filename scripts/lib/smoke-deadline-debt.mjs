/**
 * List smoke files that still rely on per-test Vitest timeouts instead of the owned-run
 * deadline helper. Per-test timeout releases an awaiter without stopping its child processes.
 * Helper adoption owns resources before work, refuses at startup and after binding, and
 * keeps roots until expectations finish.
 *
 * The source census derives the smoke include set and requires each file either to adopt
 * the helper or appear here, never both or neither. New unbounded files need an explicit
 * entry; converted files must leave this list. The reported count is checked against it.
 */
export const SMOKES_NOT_ON_THE_HELPER = [
  'apps/desktop/smoke/a-codex-agent-spawns-an-agent.smoke.ts',
  'apps/desktop/smoke/a-question-a-worker-can-ask.smoke.ts',
  'apps/desktop/smoke/an-agent-spawns-an-agent.smoke.ts',
  'apps/desktop/smoke/credential-ownership.smoke.ts',
  'apps/desktop/smoke/idle-is-not-true.smoke.ts',
  'apps/desktop/smoke/interruption-read-a-week-later-codex.smoke.ts',
  'apps/desktop/smoke/interruption-read-a-week-later.smoke.ts',
  'apps/desktop/smoke/lifecycle-stage.smoke.ts',
  'apps/desktop/smoke/one-session-and-a-queue.smoke.ts',
  'apps/desktop/smoke/taking-work-back.smoke.ts',
  'apps/desktop/smoke/the-text-a-child-is-actually-told.smoke.ts',
  'apps/desktop/smoke/tool-inventory-probe.smoke.ts',
  'apps/desktop/smoke/two-at-once.smoke.ts',
  'apps/desktop/smoke/two-verbs-one-sentence.smoke.ts',
  'packages/runtime/smoke/auth-state-probe.smoke.ts',
  'packages/runtime/smoke/auto-memory-probe.smoke.ts',
  'packages/runtime/smoke/background-reach-probe.smoke.ts',
  'packages/runtime/smoke/claude-memory-topics.smoke.ts',
  'packages/runtime/smoke/claude-memory-write-wire.smoke.ts',
  'packages/runtime/smoke/claude-yolo-probe.smoke.ts',
  'packages/runtime/smoke/codex-background-probe.smoke.ts',
  'packages/runtime/smoke/codex-home-race.smoke.ts',
  'packages/runtime/smoke/codex-memory-citation.smoke.ts',
  'packages/runtime/smoke/codex-memory-config.smoke.ts',
  'packages/runtime/smoke/codex-memory-store.smoke.ts',
  'packages/runtime/smoke/command-output-probe.smoke.ts',
  'packages/runtime/smoke/compacting-probe.smoke.ts',
  'packages/runtime/smoke/file-approval-paths.smoke.ts',
  'packages/runtime/smoke/file-change-probe.smoke.ts',
  'packages/runtime/smoke/foreign-thread-drops.smoke.ts',
  'packages/runtime/smoke/handshake-latency-probe.smoke.ts',
  'packages/runtime/smoke/model-effort-probe.smoke.ts',
  'packages/runtime/smoke/orphan-descendant-probe.smoke.ts',
  'packages/runtime/smoke/out-of-turn-probe.smoke.ts',
  'packages/runtime/smoke/plan-mode-probe.smoke.ts',
  'packages/runtime/smoke/provider-commands-probe.smoke.ts',
  'packages/runtime/smoke/ratelimit-baseline.smoke.ts',
  'packages/runtime/smoke/reject-question-probe.smoke.ts',
  'packages/runtime/smoke/resume-agent-info.smoke.ts',
  'packages/runtime/smoke/scheduled-work-probe.smoke.ts',
  'packages/runtime/smoke/steer-probe.smoke.ts',
  'packages/runtime/smoke/subagent-level-probe.smoke.ts',
  'packages/runtime/smoke/termination-receipt.smoke.ts',
  'packages/runtime/smoke/throttle-probe.smoke.ts',
  'packages/runtime/smoke/toolset-probe.smoke.ts',
  'packages/runtime/smoke/two-children-wire-probe.smoke.ts',
  'packages/runtime/smoke/workspace-canary-claude.smoke.ts',
  'packages/runtime/smoke/workspace-canary.smoke.ts',
]
