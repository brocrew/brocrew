import { describe, expect, it } from 'vitest'
import {
  mergeWorkflowAgents,
  mergeWorkflowPhases,
  workflowPhaseState,
} from '../src/renderer/src/lib/workflow'
import type { WorkflowAgent } from '../src/shared/runtime-ipc'

/**
 * 108 · The FOLD's own rules — moved here with the functions they cover.
 *
 * These were written in `packages/runtime` first and moved to the renderer, because neither merging
 * frames nor deriving a phase's state is a runtime concern: the adapter emits one frame at a time,
 * and no phase state is ever sent on the wire. See `lib/workflow.ts` for the second reason the move
 * was forced — a value import across the renderer seam drags `node:fs` into a browser bundle.
 *
 * The measurements behind every rule below are in `packages/runtime/src/workflow-run.ts`.
 */

describe('a phase state is DERIVED — the wire never sends one (108)', () => {
  it('a phase with no agents is `empty` — not `done` by vacuous truth', () => {
    // ⚠️ The bug this pins: `every()` over an empty list is `true`, so a phase announced before any
    // agent reaches it would tick green. Measured, a run announces ALL its phases in its first
    // frame, so this is the normal early state of every run rather than an edge case.
    const agents: WorkflowAgent[] = []
    expect(workflowPhaseState(agents, 2)).toBe('empty')
  })

  it('derives the other three from the agents that named the phase', () => {
    const agents: WorkflowAgent[] = [
      { agentId: 'a', label: 'a', phaseIndex: 1, state: 'done' },
      { agentId: 'b', label: 'b', phaseIndex: 1, state: 'running' },
      { agentId: 'c', label: 'c', phaseIndex: 2, state: 'done' },
    ]
    expect(workflowPhaseState(agents, 1)).toBe('running')
    expect(workflowPhaseState(agents, 2)).toBe('done')
    // A failure outranks a majority of successes: one failed agent makes the phase failed.
    const withFailure: WorkflowAgent[] = [
      ...agents,
      { agentId: 'd', label: 'd', phaseIndex: 2, state: 'failed' },
    ]
    expect(workflowPhaseState(withFailure, 2)).toBe('failed')
  })

  it('a queued agent keeps its phase RUNNING — the phase has work in it', () => {
    const agents: WorkflowAgent[] = [
      { agentId: 'a', label: 'a', phaseIndex: 1, state: 'done' },
      { agentId: 'b', label: 'b', phaseIndex: 1, state: 'queued' },
    ]
    expect(workflowPhaseState(agents, 1)).toBe('running')
  })
})

describe('the merge — by identity, never by replacement (108)', () => {
  const one: WorkflowAgent = { agentId: 'a', label: 'first', phaseIndex: 1, state: 'running' }
  const two: WorkflowAgent = { agentId: 'b', label: 'second', phaseIndex: 1, state: 'running' }

  it('a frame that said nothing leaves what is known standing', () => {
    expect(mergeWorkflowAgents([one, two], undefined)).toEqual([one, two])
    expect(mergeWorkflowPhases([{ index: 1, title: 'Draft' }], undefined)).toEqual([
      { index: 1, title: 'Draft' },
    ])
  })

  it('a frame that named ONE agent updates it and leaves the rest alone', () => {
    const merged = mergeWorkflowAgents([one, two], [{ ...one, state: 'done', tokens: 900 }])
    expect(merged).toHaveLength(2)
    expect(merged[0]).toMatchObject({ agentId: 'a', state: 'done', tokens: 900 })
    expect(merged[1]).toEqual(two)
  })

  it('a field an update omitted is not erased', () => {
    // The roster only ever GREW across all four measured runs, and an entry that reported a
    // duration once reported it in every later frame. A merge that dropped a field on the frame
    // that omitted it would make numbers flicker for no reason a reader could see.
    const rich: WorkflowAgent = { ...one, tokens: 900, durationMs: 40, lastTool: 'Write' }
    const merged = mergeWorkflowAgents(
      [rich],
      [{ agentId: 'a', label: 'first', phaseIndex: 1, state: 'done' }],
    )
    expect(merged[0]).toMatchObject({
      state: 'done',
      tokens: 900,
      durationMs: 40,
      lastTool: 'Write',
    })
  })

  it('new agents append in first-appearance order, which is the order they started', () => {
    // Re-sorting by phase would reshuffle the list under the reader every time a phase opened.
    const merged = mergeWorkflowAgents([one], [two, { ...one, state: 'done' }])
    expect(merged.map((agent) => agent.agentId)).toEqual(['a', 'b'])
  })

  it('phases sort by index, so a late-announced phase 1 does not sit under phase 2', () => {
    const merged = mergeWorkflowPhases(
      [{ index: 2, title: 'Judge' }],
      [{ index: 1, title: 'Draft' }],
    )
    expect(merged.map((phase) => phase.index)).toEqual([1, 2])
  })
})
