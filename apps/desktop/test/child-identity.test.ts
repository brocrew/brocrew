import { describe, expect, it } from 'vitest'
import { codexDescent } from '../src/main/adopt/discover-sessions'

/**
 * 111 · Which Codex threads are somebody's child, read the way the provider actually writes it.
 *
 * Fixtures use verified `state_5.sqlite` row shapes from a corpus of 1,986 threads, including
 * 815 children. The measured counts below constrain the classifier:
 *
 * ```
 * union of all three signals .... 815
 * thread_source = 'subagent' .... 806     misses 9 legacy rows
 * a spawn edge .................. 812     misses 3 rows whose descent is only on the row
 * source = {"subagent":…} ....... 815
 * ```
 *
 * That is why the classifier reads three things and not the one the dispatch named.
 */

const row = (over: Record<string, unknown> = {}) =>
  ({
    id: 'thread-1',
    cwd: '/work',
    rollout_path: '/tmp/x.jsonl',
    archived: 0,
    created_at: 1,
    created_at_ms: null,
    updated_at: 2,
    updated_at_ms: null,
    ...over,
  }) as Parameters<typeof codexDescent>[0]

const SPAWN =
  '{"subagent":{"thread_spawn":{"parent_thread_id":"019db591-8b7d-7d91-a183-a16e869aa683","depth":1,"agent_path":"agents/worker.md","agent_nickname":"Turing","agent_role":"worker"}}}'

describe('codexDescent — who spawned this thread (111)', () => {
  it('reads the whole descent out of the `source` JSON', () => {
    expect(codexDescent(row({ source: SPAWN, thread_source: 'subagent' }), undefined)).toEqual({
      parentSessionId: '019db591-8b7d-7d91-a183-a16e869aa683',
      depth: 1,
      nickname: 'Turing',
      role: 'worker',
      agentPath: 'agents/worker.md',
    })
  })

  it('⚠️ a LEGACY row — spawn JSON and an edge, but no `thread_source`', () => {
    // Nine rows predate the `thread_source` migration. Reading only that column misclassifies
    // these children as ordinary conversations.
    expect(
      codexDescent(
        row({ source: SPAWN, thread_source: null }),
        '019db591-8b7d-7d91-a183-a16e869aa683',
      ),
    ).toMatchObject({ parentSessionId: '019db591-8b7d-7d91-a183-a16e869aa683', nickname: 'Turing' })
  })

  it('⚠️ a GUARDIAN row — a child that cannot name its parent', () => {
    // 3 real rows, `{"subagent":{"other":"guardian"}}`, with no spawn edge either. The childhood is
    // a fact; the descent is not. It must come back as a child with NOTHING invented — 086/104's
    // rule applies to a parent id exactly as it does to a token count.
    const descent = codexDescent(
      row({ source: '{"subagent":{"other":"guardian"}}', thread_source: 'subagent' }),
      undefined,
    )
    expect(descent).toEqual({})
    expect(descent).not.toBeNull()
  })

  it('⚠️ the spawn EDGE alone is enough when the row itself says nothing', () => {
    // The only signal that survives a `source` we cannot parse — which is the reason it is read.
    expect(codexDescent(row({ source: 'vscode' }), 'parent-9')).toEqual({
      parentSessionId: 'parent-9',
    })
  })

  it('an ordinary conversation is NOT a child — the paired positive', () => {
    for (const source of ['vscode', 'cli', 'exec']) {
      expect(codexDescent(row({ source, thread_source: 'user' }), undefined), source).toBeNull()
    }
    // …and a home too old to have any of the columns at all.
    expect(codexDescent(row(), undefined)).toBeNull()
  })

  it('unparseable JSON is "not a child", never a throw', () => {
    // This runs over ~2,000 rows with the whole home behind it; 047's rule that a caption is not
    // worth losing every session applies with more force to a marker.
    expect(codexDescent(row({ source: '{"subagent":' }), undefined)).toBeNull()
    // …but the edge still speaks for the same broken row, which is the point of reading three.
    expect(codexDescent(row({ source: '{"subagent":' }), 'parent-9')).toEqual({
      parentSessionId: 'parent-9',
    })
  })

  it('the row COLUMNS win over the JSON, and neither invents the other', () => {
    // Both carry the nickname on this snapshot (812 each) and they agree; preferring the normalized
    // column means a JSON reshape costs the parent id, not the name.
    expect(
      codexDescent(
        row({ source: SPAWN, agent_nickname: 'Plato', agent_role: 'explorer' }),
        undefined,
      ),
    ).toMatchObject({ nickname: 'Plato', role: 'explorer' })
    // A role is rare — 16 of 815 — and its absence must stay absent rather than becoming ''.
    const noRole = codexDescent(
      row({
        source:
          '{"subagent":{"thread_spawn":{"parent_thread_id":"p","depth":2,"agent_nickname":"Boyle","agent_role":null}}}',
      }),
      undefined,
    )
    expect(noRole).toEqual({ parentSessionId: 'p', depth: 2, nickname: 'Boyle' })
    expect(noRole && 'role' in noRole).toBe(false)
  })
})
