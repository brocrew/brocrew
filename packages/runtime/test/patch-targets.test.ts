import { describe, expect, it } from 'vitest'
import { PatchTargets, patchTargetLabel } from '../src/codex/patch-targets'

/**
 * 181 · **The correlation the approval card names its files from.**
 *
 * `codex-runtime.test.ts` drives this through a real handle, which is where the wire order and the
 * turn gate are asserted. These are the rules of the tracker itself — the ones a single approval
 * cannot exercise, and the ones a live probe would need a pathological provider to produce.
 *
 * ⛔ **184 · every call here now carries the thread and the turn**, because that is what the wire
 * carries. 182 H3's own words about the old shape: *"No generated type or code comment promises
 * session-global item-id uniqueness."*
 */

/** The thread and turn every frame in this file belongs to unless it says otherwise. */
const THREAD = 'thread-01a01283'
const TURN = 'turn-9aef77c2'

const item = (
  id: string,
  changes: unknown[],
  ids: { threadId?: unknown; turnId?: unknown } = {},
): Record<string, unknown> => ({
  threadId: THREAD,
  turnId: TURN,
  ...ids,
  item: { type: 'fileChange', id, changes, status: 'pending' },
})

/** An approval's params — the shape {@link PatchTargets.for} is handed on the other end. */
const asks = (
  itemId: string,
  ids: { threadId?: unknown; turnId?: unknown } = {},
): Record<string, unknown> => ({ threadId: THREAD, turnId: TURN, ...ids, itemId })

const add = (path: string): Record<string, unknown> => ({ path, kind: { type: 'add' } })

describe('PatchTargets — what the provider said it would touch', () => {
  it('reads every PatchChangeKind into the pane’s own vocabulary', () => {
    const targets = new PatchTargets()
    targets.note(
      'item/started',
      item('i1', [
        { path: '/w/a', kind: { type: 'add' } },
        { path: '/w/b', kind: { type: 'update', move_path: null } },
        { path: '/w/c', kind: { type: 'delete' } },
        { path: '/w/d', kind: { type: 'update', move_path: '/w/e' } },
      ]),
    )
    expect(targets.for(asks('i1'))).toEqual([
      { path: '/w/a', status: 'added' },
      { path: '/w/b', status: 'modified' },
      { path: '/w/c', status: 'deleted' },
      { path: '/w/e', status: 'renamed', oldPath: '/w/d' },
    ])
    expect(targets.for(asks('i1')).map(patchTargetLabel)).toEqual([
      'added /w/a',
      'modified /w/b',
      'deleted /w/c',
      'renamed /w/e (from /w/d)',
    ])
  })

  it('a kind it cannot read still NAMES the file, and claims nothing about it', () => {
    // ⚠️ The two halves are different failures and only one of them is acceptable. Dropping the row
    // would hide a file the patch writes; calling it `modified` would be a claim about a file we
    // were told nothing about. `touched` is the word {@link FileChange.status} already reserves for
    // "the agent wrote this file, and we were not told how".
    const targets = new PatchTargets()
    targets.note('item/started', item('i2', [{ path: '/w/x', kind: { type: 'teleport' } }, {}]))
    expect(targets.for(asks('i2'))).toEqual([{ path: '/w/x', status: 'touched' }])
  })

  it('a change with no path is dropped rather than rendered as a blank line', () => {
    const targets = new PatchTargets()
    targets.note('item/started', item('i3', [{ kind: { type: 'add' } }, add('/w/real')]))
    expect(targets.for(asks('i3'))).toEqual([{ path: '/w/real', status: 'added' }])
  })

  it('an EMPTY changes array never erases what we already hold', () => {
    // ⛔ The frames arrive `started` → approval → `completed`, and each one carries the array. A
    // later frame reporting nothing is not a report that there is nothing: letting it overwrite
    // would turn a card that could name its file into one that could not, by frame order alone.
    const targets = new PatchTargets()
    targets.note('item/started', item('i4', [add('/w/kept')]))
    targets.note('item/completed', item('i4', []))
    expect(targets.for(asks('i4'))).toEqual([{ path: '/w/kept', status: 'added' }])
  })

  it('but a later frame that DOES name files replaces the earlier answer', () => {
    // The paired positive for the rule above: "never erase" must not become "never update", or a
    // patch the model revised would be approved against the version it first proposed.
    const targets = new PatchTargets()
    targets.note('item/started', item('i5', [add('/w/first')]))
    targets.note('item/completed', item('i5', [add('/w/first'), add('/w/second')]))
    expect(targets.for(asks('i5')).map((t) => t.path)).toEqual(['/w/first', '/w/second'])
  })

  it('reads item/fileChange/patchUpdated too — the source that has never arrived', () => {
    // 096 measured zero across 458,200 frames, 181 measured zero across two runs and 184 measured
    // zero again across 97. It is read anyway because it is the DECLARED per-file source; if it
    // starts arriving it wins by being later, with nothing else to change.
    const targets = new PatchTargets()
    targets.note('item/fileChange/patchUpdated', {
      threadId: THREAD,
      turnId: TURN,
      itemId: 'i6',
      changes: [add('/w/late')],
    })
    expect(targets.for(asks('i6'))).toEqual([{ path: '/w/late', status: 'added' }])
  })

  it('an item that is not a file change teaches it nothing', () => {
    const targets = new PatchTargets()
    targets.note('item/started', {
      threadId: THREAD,
      turnId: TURN,
      item: { type: 'commandExecution', id: 'i7', changes: [add('/w/nope')] },
    })
    targets.note('item/started', {
      threadId: THREAD,
      turnId: TURN,
      item: { type: 'fileChange', changes: [add('/w/nope')] },
    }) // no id
    expect(targets.for(asks('i7'))).toEqual([])
    expect(targets.for(asks(''))).toEqual([])
    expect(targets.for(undefined)).toEqual([])
    expect(targets.for(asks('never-seen'))).toEqual([])
  })

  it('holds a bounded number of items — the oldest goes, not the newest', () => {
    // An item whose approval never comes is never removed, and a long conversation is exactly where
    // this app runs. 64 is the bound; the entry that ages out is one already decided, because an
    // approval arrives two frames after its item.
    const targets = new PatchTargets()
    for (let i = 0; i < 70; i += 1) targets.note('item/started', item(`i${i}`, [add(`/w/${i}`)]))
    expect(targets.for(asks('i0')), 'the oldest was evicted').toEqual([])
    expect(targets.for(asks('i5')), 'and so were the five after it').toEqual([])
    expect(
      targets.for(asks('i6')).map((t) => t.path),
      'the 64 most recent are held',
    ).toEqual(['/w/6'])
    expect(
      targets.for(asks('i69')).map((t) => t.path),
      'including the newest',
    ).toEqual(['/w/69'])
  })

  describe('⛔ the same item id is not the same item (184, from 182 H3)', () => {
    it('an entry from ANOTHER TURN cannot answer this turn’s approval', () => {
      // ⛔ The failure this key exists for. Nothing in the generated protocol promises an item id is
      // unique beyond its turn, so an id reused by a later turn used to read the earlier turn's
      // paths — a card naming a file it is not about, with `underDisclosed: false` beside it.
      const targets = new PatchTargets()
      targets.note('item/started', item('exec-1', [add('/etc/hosts')], { turnId: 'turn-OLD' }))
      expect(
        targets.for(asks('exec-1', { turnId: 'turn-NOW' })),
        'the current turn was told nothing about this item, and says so',
      ).toEqual([])
      // The paired positive: the turn that WAS told still gets its answer.
      expect(targets.for(asks('exec-1', { turnId: 'turn-OLD' })).map((t) => t.path)).toEqual([
        '/etc/hosts',
      ])
    })

    it('an entry from ANOTHER THREAD cannot answer this thread’s approval', () => {
      const targets = new PatchTargets()
      targets.note(
        'item/started',
        item('exec-2', [add('/etc/hosts')], { threadId: 'thread-CHILD' }),
      )
      expect(targets.for(asks('exec-2'))).toEqual([])
      expect(targets.for(asks('exec-2', { threadId: 'thread-CHILD' })).map((t) => t.path)).toEqual([
        '/etc/hosts',
      ])
    })

    it('unkeyable in, unkeyable out — a frame with no thread or no turn is not held', () => {
      // ⛔ **Both halves, because only together are they observable.** Dropping the frame alone
      // proves nothing: a lookup built from a real approval misses an empty-id entry whether it was
      // stored or not. What the guard actually prevents is the pair — a frame that names no thread
      // and no turn being filed under the empty ids, where a request that also names none reads it
      // back. On the wire that request cannot exist (`serverRequestScopeProblem` refuses it before a
      // card does), and a store whose safety depends on a caller upstream is a store that is safe by
      // luck.
      const targets = new PatchTargets()
      targets.note('item/started', item('exec-3', [add('/etc/hosts')], { turnId: undefined }))
      targets.note('item/started', item('exec-4', [add('/etc/passwd')], { threadId: undefined }))
      targets.note('item/started', item('exec-5', [add('/etc/shadow')], { turnId: '' }))
      targets.note('item/fileChange/patchUpdated', { itemId: 'exec-6', changes: [add('/etc/g')] })
      // …asked for by a request that names EXACTLY what each of them named — mirrored field for
      // field, because a lookup that names something different misses whether the entry was stored
      // or not, and would assert over nothing.
      expect(targets.for({ threadId: THREAD, itemId: 'exec-3' })).toEqual([]) // thread, no turn
      expect(targets.for({ turnId: TURN, itemId: 'exec-4' })).toEqual([]) // turn, no thread
      expect(targets.for({ threadId: THREAD, turnId: '', itemId: 'exec-5' })).toEqual([]) // empty turn
      expect(targets.for({ itemId: 'exec-6' })).toEqual([]) // neither
      // …and by one that names everything, which is the shape a real approval has.
      expect(targets.for(asks('exec-3'))).toEqual([])
      expect(targets.for(asks('exec-6'))).toEqual([])
      // …and the paired positive, so this is not passing because nothing is ever recorded.
      targets.note('item/started', item('exec-7', [add('/w/named')]))
      expect(targets.for(asks('exec-7')).map((t) => t.path)).toEqual(['/w/named'])
    })

    it('two different triples cannot spell one key — the ids are opaque strings', () => {
      // ⚠️ Every part of the key is a provider string that may contain the separator. Length-prefixing
      // is what makes the encoding injective; a plain join would let `('a|b', 'c')` and `('a', 'b|c')`
      // become the same entry, which is the id-collision class 045 already paid for once.
      const targets = new PatchTargets()
      targets.note('item/started', item('x', [add('/w/first')], { threadId: 'a|b', turnId: 'c' }))
      targets.note('item/started', item('x', [add('/w/second')], { threadId: 'a', turnId: 'b|c' }))
      expect(targets.for(asks('x', { threadId: 'a|b', turnId: 'c' })).map((t) => t.path)).toEqual([
        '/w/first',
      ])
      expect(targets.for(asks('x', { threadId: 'a', turnId: 'b|c' })).map((t) => t.path)).toEqual([
        '/w/second',
      ])
      // And the length prefix itself is not a place to hide one: `1:a|1:b|…` is decodable exactly one
      // way, so an id that LOOKS like a prefix is still just an id.
      targets.note('item/started', item('x', [add('/w/third')], { threadId: '1:a', turnId: '1:b' }))
      expect(targets.for(asks('x', { threadId: '1:a', turnId: '1:b' })).map((t) => t.path)).toEqual(
        ['/w/third'],
      )
      expect(targets.for(asks('x', { threadId: 'a|b', turnId: 'c' })).map((t) => t.path)).toEqual([
        '/w/first',
      ])
    })

    it('a non-string thread or turn is not a thread or a turn', () => {
      const targets = new PatchTargets()
      targets.note('item/started', item('exec-8', [add('/etc/hosts')], { turnId: 42 }))
      expect(targets.for(asks('exec-8', { turnId: 42 }))).toEqual([])
      expect(targets.for(asks('exec-8'))).toEqual([])
    })
  })
})
