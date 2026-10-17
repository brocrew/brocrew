import { describe, expect, it } from 'vitest'
import {
  boundRecall,
  MAX_RECALL_ENTRIES,
  MAX_RECALL_NOTE,
  MAX_RECALL_PATH,
  MAX_RECALL_THREADS,
  MAX_THREAD_ID,
  runtimeEventSchema,
  type MemoryRecallEntry,
} from '../src/index'

/**
 * 🔴 **319 · the one bounding rule for what the agent said it read.**
 *
 * ⛔ **Two callers, one rule** — `codex/normalize.ts` on the live wire and `session-store.ts` on
 * replay — which is the whole reason this is a function rather than caps inlined twice (`169` §1).
 * Every assertion here is about the SHAPE that reaches a person, and the schema is re-asserted
 * beside the bound because a bound the schema then rejects is a row `toWireEvent` degrades to
 * `unknown` and loses in silence.
 */

const entry = (over: Partial<MemoryRecallEntry> = {}): MemoryRecallEntry => ({
  path: 'MEMORY.md',
  lineStart: 1,
  lineEnd: 3,
  note: 'the user’s full name',
  ...over,
})

/** The bounded citation as it would travel — so every test asserts on a payload the schema accepts. */
function asEvent(entries: readonly MemoryRecallEntry[], threads: readonly string[] = []): unknown {
  const bound = boundRecall(entries, threads)
  return {
    type: 'memory_recall',
    entries: bound.entries,
    ...(bound.dropped ? { dropped: bound.dropped } : {}),
    ...(bound.threadIds.length ? { threadIds: bound.threadIds } : {}),
    ...(bound.threadsDropped ? { threadsDropped: bound.threadsDropped } : {}),
    source: 'memoryCitation',
  }
}

describe('boundRecall (319)', () => {
  it('keeps the file, the range and the note — the three things that make a row worth drawing', () => {
    // ⚑ 319 §1.1, as an assertion rather than a sentence: a row that says only "the agent used
    // memory" has thrown away the part a person cares about.
    const bound = boundRecall([entry()], [])
    expect(bound.entries).toEqual([
      { path: 'MEMORY.md', lineStart: 1, lineEnd: 3, note: 'the user’s full name' },
    ])
    expect(bound.dropped).toBe(0)
    expect(runtimeEventSchema.safeParse(asEvent([entry()])).success).toBe(true)
  })

  it('a path too long to be a path is DROPPED and COUNTED, never shortened', () => {
    // ⛔ A clipped path is not a shorter answer to "which file?", it is a wrong one — and it would
    // send a person looking in the store for a name that is not there. Same ruling `boundCommands`
    // makes about a command's name.
    const long = `${'a'.repeat(MAX_RECALL_PATH)}.md`
    const bound = boundRecall([entry(), entry({ path: long })], [])
    expect(bound.entries).toHaveLength(1)
    expect(bound.entries[0]?.path).toBe('MEMORY.md')
    // ⚠️ The POSITIVE half of the same assertion (SSR-vacuity rule): the shortfall is stated, so the
    // list can never read as complete while being one row short.
    expect(bound.dropped).toBe(1)
  })

  it('an empty path is dropped and counted too — a citation with no file names nothing', () => {
    expect(boundRecall([entry({ path: '   ' })], [])).toEqual({
      entries: [],
      dropped: 1,
      threadIds: [],
      threadsDropped: 0,
    })
  })

  it('a note too long is CLIPPED, and the row survives — the opposite ruling to the path', () => {
    const long = 'w'.repeat(MAX_RECALL_NOTE + 50)
    const bound = boundRecall([entry({ note: long })], [])
    const note = bound.entries[0]?.note ?? ''
    // ⛔ INCLUSIVE — the ellipsis is inside the bound, so the schema states the number the constant
    // states and not one less. A clip that overshot by one would be rejected at the wire boundary.
    expect(note).toHaveLength(MAX_RECALL_NOTE)
    expect(note.endsWith('…')).toBe(true)
    expect(bound.dropped).toBe(0)
    expect(runtimeEventSchema.safeParse(asEvent([entry({ note: long })])).success).toBe(true)
  })

  it('an empty note is absent rather than an empty string, and the file still shows', () => {
    const bound = boundRecall([entry({ note: '  ' })], [])
    expect(bound.entries[0]).toEqual({ path: 'MEMORY.md', lineStart: 1, lineEnd: 3 })
    expect('note' in (bound.entries[0] ?? {})).toBe(false)
  })

  it('half a range is no range, and the entry keeps its path (074)', () => {
    // ⛔ A number with no partner cannot be printed as a range, and a range printed from one number
    // would be a measurement nobody made. The file is still the answer to "which memory?".
    const bound = boundRecall([entry({ lineEnd: undefined })], [])
    expect(bound.entries[0]).toEqual({ path: 'MEMORY.md', note: 'the user’s full name' })
    expect(bound.dropped).toBe(0)
  })

  it('past the entry cap the surplus is counted, never silently cut (092 §4)', () => {
    const many = Array.from({ length: MAX_RECALL_ENTRIES + 4 }, (_, i) =>
      entry({ path: `note-${i}.md` }),
    )
    const bound = boundRecall(many, [])
    expect(bound.entries).toHaveLength(MAX_RECALL_ENTRIES)
    expect(bound.dropped).toBe(4)
    // ⚠️ Paired positive: the ones that survived are the FIRST ones, because the model's own
    // instruction is "list entries in order of importance (most important first)".
    expect(bound.entries[0]?.path).toBe('note-0.md')
  })

  it('duplicate session ids collapse — the provider’s own contract, not our tidiness', () => {
    // The 0.146.0 binary instructs the model: "include unique ids only; do not repeat ids".
    const bound = boundRecall([entry()], ['a-1', 'a-1', 'b-2'])
    expect(bound.threadIds).toEqual(['a-1', 'b-2'])
    // ⛔ NOT counted as dropped: the citation named two earlier sessions and this list holds two.
    expect(bound.threadsDropped).toBe(0)
  })

  it('an id is never SHAPE-checked, only bounded — one capture is not a contract', () => {
    // ⚠️ The provider says these "should look like UUIDs". Hardening a filter on that is how a
    // channel goes quiet the day the shape moves, so anything of a usable length survives.
    const bound = boundRecall([entry()], ['not-a-uuid', 'x'.repeat(MAX_THREAD_ID + 1), ''])
    expect(bound.threadIds).toEqual(['not-a-uuid'])
    // ⛔ **The one it would not carry is COUNTED** (found reviewing this diff): a surface adds these
    // two numbers to say how many earlier sessions were named, so an uncounted drop understates
    // what the model wrote. ⚠️ The EMPTY string is not counted — the provider allows an empty
    // `<rollout_ids>` section, so a blank line is not an id it dropped.
    expect(bound.threadsDropped).toBe(1)
  })

  it('past the id cap the surplus is counted, so a COUNT on screen cannot understate', () => {
    const ids = Array.from({ length: MAX_RECALL_THREADS + 3 }, (_, i) => `id-${i}`)
    const bound = boundRecall([entry()], ids)
    expect(bound.threadIds).toHaveLength(MAX_RECALL_THREADS)
    expect(bound.threadsDropped).toBe(3)
  })

  it('a bounded citation always satisfies the schema — the bound and the wire agree', () => {
    const wild = [
      entry(),
      entry({ path: 'x'.repeat(MAX_RECALL_PATH) }),
      entry({ note: 'n'.repeat(MAX_RECALL_NOTE * 3) }),
      entry({ lineStart: undefined }),
    ]
    const ids = Array.from({ length: MAX_RECALL_THREADS + 2 }, (_, i) => `id-${i}`)
    expect(runtimeEventSchema.safeParse(asEvent(wild, ids)).success).toBe(true)
  })
})
