import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allProviderCapabilities, isNetUnchanged as runtimeNetUnchanged } from '@brobot2/runtime'
import type {
  FileChange,
  RuntimeEvent,
  RuntimeEventMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'
import {
  changeSet,
  diffBody,
  isNetUnchanged,
  scoped,
  tabCount,
  totals,
} from '../src/renderer/src/lib/changes'
import { attentionTraces, DRAWER_TABS, tracesOutsideDrawer } from '../src/renderer/src/lib/drawer'
import {
  MAX_CARRIED_CHANGE_REPORTS,
  MAX_HELD_DIFF_REPORTS,
  appendUserMessage,
  applyEvent,
  createTranscript,
  markPermissionAnswered,
  opensTurn,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { carryForward, foldWindow } from '../src/renderer/src/lib/transcript-window'
import { runtimeEventSchema } from '@brobot2/runtime'

/**
 * 096 · the Changes pane's fold — one row per file, and every blank kept distinct.
 *
 * ⚠️ These assertions are about the two things 092 said were load-bearing and are invisible on
 * screen: **what the collapsed pane costs** (bounded by distinct files, holding no diff bodies) and
 * **which blank is which** (absent counts vs zero counts vs a change we were not told the files of).
 */

function report(changes: FileChange[], source = 'turn/diff/updated', dropped = 0): RuntimeEvent {
  return { type: 'file_change', changes, source, ...(dropped ? { dropped } : {}) }
}

const modified = (path: string, added = 1, removed = 1, diff?: string): FileChange => ({
  path,
  status: 'modified',
  added,
  removed,
  ...(diff !== undefined ? { diff } : {}),
})

function permission(state: TranscriptState, id: string, underDisclosed: boolean): void {
  applyEvent(state, {
    type: 'permission_request',
    id,
    kind: 'file',
    action: 'apply_patch',
    detail: 'write',
    scope: {
      cwd: '/tmp/x',
      paths: [],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions: ['allow', 'deny', 'cancel'],
      underDisclosed,
    },
  })
}

describe('the pane’s unit is the distinct FILE, not the turn and not the edit', () => {
  it('a file reported four times is one row, and the last report wins', () => {
    // ⚠️ The measured Codex behaviour this exists for: `turn/diff/updated` is a full snapshot of the
    // turn, re-sent three to five times per turn, byte-identical. Four rows for one file would make
    // a two-file turn read as an eight-file turn.
    const state = createTranscript()
    appendUserMessage(state, 'go')
    for (const added of [1, 4, 9, 12])
      applyEvent(state, report([modified('src/a.ts', added, 2), modified('src/b.ts')]))
    const set = changeSet(state)
    expect(set.rows).toHaveLength(2)
    expect(set.rows.find((row) => row.path === 'src/a.ts')?.added).toBe(12)
  })

  it('a snapshot REPLACES its predecessor; an increment is appended beside it', () => {
    // The rule is about the data rather than the provider: a report naming everything the last one
    // did supersedes it. Codex's snapshots land on one side of that and Claude's one-file edits on
    // the other, without either being asked which it is.
    const state = createTranscript()
    appendUserMessage(state, 'go')
    applyEvent(state, report([modified('a.ts')]))
    applyEvent(state, report([modified('a.ts'), modified('b.ts')]))
    expect(state.changes.reports, 'the snapshot replaced').toHaveLength(1)

    applyEvent(state, report([{ path: 'c.ts', status: 'touched' }], 'Edit'))
    expect(state.changes.reports, 'the increment appended').toHaveLength(2)
    expect(changeSet(state).rows.map((row) => row.path)).toEqual(['a.ts', 'b.ts', 'c.ts'])
  })

  it('the collapsed pane holds NO diff bodies — the rows carry a pointer, not the text', () => {
    // 092 §4, and the reason this pane is affordable at all after 054 measured the fold going
    // quadratic. The assertion is the type's shape rather than a benchmark: a row physically cannot
    // carry a diff, so no amount of rendering can accidentally load one.
    const state = createTranscript()
    appendUserMessage(state, 'go')
    const body = '@@ -1 +1 @@\n-a\n+b'
    applyEvent(state, report([modified('a.ts', 1, 1, body)]))
    const [row] = changeSet(state).rows
    expect(JSON.stringify(row)).not.toContain('@@')
    expect(row!.bodyReportId).not.toBeNull()
    // …and the ONE lazy read, which is what expanding does.
    expect(diffBody(state, row!)).toBe(body)
  })

  it('a file the agent never reported a diff for cannot be expanded', () => {
    const state = createTranscript()
    appendUserMessage(state, 'go')
    applyEvent(state, report([{ path: '/repo/a.ts', status: 'touched' }], 'Edit'))
    const [row] = changeSet(state).rows
    expect(row!.bodyReportId).toBeNull()
    expect(diffBody(state, row!)).toBeNull()
  })
})

describe('the memory bound, and what it is allowed to lose', () => {
  it('old reports lose their diff TEXT and keep every row', () => {
    // ⚠️ 054's hazard from the other end: a per-report ceiling does not bound a conversation. 171
    // turns × a 256 KiB report is 43 MB of diff nobody asked to see.
    const state = createTranscript()
    for (let index = 0; index <= MAX_HELD_DIFF_REPORTS + 2; index += 1) {
      appendUserMessage(state, `turn ${index}`)
      applyEvent(state, report([modified(`f${index}.ts`, 1, 1, `@@ -1 +1 @@\n-a\n+b${index}`)]))
    }
    const released = state.changes.reports.filter((entry) => entry.released)
    expect(released.length, 'the oldest were released').toBe(3)
    expect(
      released.every((entry) => entry.changes.every((change) => change.diff === undefined)),
    ).toBe(true)
    // Every file is still listed — only the text went.
    const set = changeSet(state)
    expect(set.rows).toHaveLength(MAX_HELD_DIFF_REPORTS + 3)
    const oldest = set.rows.find((row) => row.path === 'f0.ts')!
    expect(oldest.bodyReportId, 'and the row stops claiming to be expandable').toBeNull()
    expect(oldest.added, 'while its counts survive, because they cost nothing').toBe(1)
  })

  it('…and a body still held is still readable, so the release is not a blanket', () => {
    // NON-VACUITY for the test above: if releasing were unconditional the assertions would pass and
    // the pane would never expand anything again.
    const state = createTranscript()
    for (let index = 0; index <= MAX_HELD_DIFF_REPORTS + 2; index += 1) {
      appendUserMessage(state, `turn ${index}`)
      applyEvent(state, report([modified(`f${index}.ts`, 1, 1, `@@ -1 +1 @@\n-a\n+b${index}`)]))
    }
    const newest = changeSet(state).rows.at(-1)!
    expect(diffBody(state, newest)).toContain('@@')
  })

  it('rows the provider named past the cap are stated, not swallowed', () => {
    const state = createTranscript()
    appendUserMessage(state, 'go')
    applyEvent(state, report([modified('a.ts')], 'turn/diff/updated', 12))
    expect(changeSet(state).dropped).toBe(12)
  })
})

describe('the scope axis is the transcript’s own, so both providers get one', () => {
  it('`this turn` is the turn the conversation is on, and the whole set is everything', () => {
    const state = createTranscript()
    appendUserMessage(state, 'first')
    applyEvent(state, report([modified('early.ts')]))
    appendUserMessage(state, 'second')
    applyEvent(state, report([modified('late.ts')]))

    const set = changeSet(state)
    expect(set.turn).toBe(2)
    expect(scoped(set, 'conversation').map((row) => row.path)).toEqual(['early.ts', 'late.ts'])
    expect(scoped(set, 'turn').map((row) => row.path)).toEqual(['late.ts'])
  })

  it('a file touched again in a later turn moves INTO that turn', () => {
    const state = createTranscript()
    appendUserMessage(state, 'first')
    applyEvent(state, report([modified('a.ts')]))
    appendUserMessage(state, 'second')
    applyEvent(state, report([modified('a.ts', 5, 5)]))
    const set = changeSet(state)
    expect(scoped(set, 'turn').map((row) => row.path)).toEqual(['a.ts'])
    expect(scoped(set, 'conversation')).toHaveLength(1)
  })
})

describe('every blank stays a different blank (092 §3)', () => {
  it('an ALLOWED file change with undisclosed files is counted — and gets no path', () => {
    const state = createTranscript()
    appendUserMessage(state, 'go')
    permission(state, 'p1', true)
    markPermissionAnswered(state, 'p1', 'allow')
    const set = changeSet(state)
    expect(set.underDisclosed).toBe(1)
    // ⚠️ **And there is no row for it.** One faceless row is drawn from this count; fabricating N
    // rows to match N approvals is exactly the invention the surface refuses.
    expect(set.rows).toEqual([])
  })

  it('…but a DENIED one, and one still waiting, are not', () => {
    // NON-VACUITY, and it is a correctness claim: a declined approval changed nothing, and a card
    // still frozen has changed nothing YET. Counting either puts a permanent "we don't know what
    // happened" under a conversation where demonstrably nothing did.
    const denied = createTranscript()
    permission(denied, 'p1', true)
    markPermissionAnswered(denied, 'p1', 'deny')
    expect(changeSet(denied).underDisclosed).toBe(0)

    const waiting = createTranscript()
    permission(waiting, 'p2', true)
    expect(changeSet(waiting).underDisclosed).toBe(0)
  })

  it('…and a file approval that DID disclose its paths is not one either', () => {
    const state = createTranscript()
    permission(state, 'p3', false)
    markPermissionAnswered(state, 'p3', 'allow')
    expect(changeSet(state).underDisclosed).toBe(0)
  })

  it('absent counts contribute nothing to the totals — not zero, nothing', () => {
    const state = createTranscript()
    appendUserMessage(state, 'go')
    applyEvent(
      state,
      report([modified('counted.ts', 7, 3), { path: 'claude.ts', status: 'touched' }], 'Edit'),
    )
    expect(totals(changeSet(state).rows)).toEqual({ added: 7, removed: 3 })
  })

  it('the source of every row is kept, so the pane labels rather than averages', () => {
    const state = createTranscript()
    appendUserMessage(state, 'go')
    applyEvent(state, report([modified('a.ts')], 'turn/diff/updated'))
    applyEvent(state, report([{ path: 'b.ts', status: 'touched' }], 'Write'))
    expect(changeSet(state).sources).toEqual(['turn/diff/updated', 'Write'])
  })
})

describe('the tab’s quiet count (092 §2)', () => {
  it('is absent — not zero — when nothing has changed', () => {
    // 081's rule, and the reason the strip stays quiet: a `0` is a claim, and an empty badge is a
    // pixel of noise on a tab nobody needs to look at.
    expect(tabCount(changeSet(createTranscript()))).toBeNull()
  })

  it('counts the WHOLE conversation, never the scope on screen', () => {
    // ⚠️ The badge's job is "something changed while you were looking elsewhere". A reader on
    // This turn who watched a 2 drop to nothing when they switched scope would be reading the
    // toggle, not the tree.
    const state = createTranscript()
    appendUserMessage(state, 'first')
    applyEvent(state, report([modified('early.ts')]))
    appendUserMessage(state, 'second')
    const set = changeSet(state)
    expect(scoped(set, 'turn'), 'nothing changed this turn').toEqual([])
    expect(tabCount(set), 'and the badge still says one').toBe(1)
  })
})

describe('a file changing is not a question (092 §2, inheriting 086)', () => {
  it('raises NONE of 080’s five traces, on any tab, with any number of files changed', () => {
    // ⚠️ **Acceptance §6, and it is asserted against all five rather than against the one that would
    // be tempting.** 063/080 built five traces for *"something is waiting on you"*. A diff is never
    // that: the Changes tab may put a quiet count on its own icon and nothing else — no drawer-toggle
    // badge, no amber pulse, no status pill, no dot on any tab, no cross-tab bar.
    for (const files of [0, 1, 40]) {
      const state = createTranscript()
      appendUserMessage(state, 'go')
      if (files)
        applyEvent(
          state,
          report(Array.from({ length: files }, (_, index) => modified(`f${index}.ts`))),
        )
      const set = changeSet(state)
      expect(tabCount(set), `${files} files`).toBe(files === 0 ? null : files)
      for (const tab of DRAWER_TABS.map((entry) => entry.id)) {
        for (const drawerOpen of [true, false]) {
          const traces = attentionTraces({ waiting: 0, status: 'working', drawerOpen, tab })
          expect(Object.values(traces), `${files} files · ${tab} · open=${drawerOpen}`).toEqual([
            false,
            false,
            false,
            false,
            false,
          ])
          expect(tracesOutsideDrawer(traces)).toBe(0)
        }
      }
    }
    // NON-VACUITY, the same shape 087's version uses: the SAME function raises traces when something
    // really is waiting. Without it, an `attentionTraces` returning all-false would pass every case.
    const waiting = attentionTraces({
      waiting: 1,
      status: 'waiting_permission',
      drawerOpen: false,
      tab: 'changes',
    })
    expect(waiting.badge).toBe(true)
    expect(tracesOutsideDrawer(waiting)).toBeGreaterThanOrEqual(1)
  })

  it('the change set is not an input to the attention model at all', () => {
    // Asserted against the SOURCE rather than a literal written two lines up — 087's review finding
    // 20. A `changes` field appearing on `AttentionInput` some later day is what this catches.
    const source = readFileSync(
      fileURLToPath(new URL('../src/renderer/src/lib/drawer.ts', import.meta.url)),
      'utf8',
    )
    const body = /export interface AttentionInput \{([^}]*)\}/.exec(source)?.[1] ?? ''
    expect(body, 'AttentionInput not found in drawer.ts').not.toBe('')
    const fields = [...body.matchAll(/^\s{2}(\w+):/gm)].map((m) => m[1]).sort()
    expect(fields).toEqual(['drawerOpen', 'status', 'tab', 'waiting'])
  })
})

describe('the deferred revert foot states a reason that is TRUE (096 §4)', () => {
  const capabilities = allProviderCapabilities()

  it('both providers are `unwired` — neither is `absent`, because neither API is missing', () => {
    for (const provider of ['claude', 'codex'] as const)
      expect(capabilities[provider].rewind.state, provider).toBe('unwired')
  })

  it('and Claude’s reason does NOT repeat 092’s, which was wrong', () => {
    // ⚠️ 092 filed this `absent`, quoting *"`rewindFiles()`/`enableFileCheckpointing` appear in zero
    // source… the doc has been wrong twice."* True of OUR source; false of the SDK, which declares
    // `enableFileCheckpointing` at `sdk.d.ts:1629` and `rewindFiles()` at `:2980` at the exact pin (0.3.281).
    // Shipping that sentence would have put a false statement in the product, which is the failure
    // this table exists to prevent.
    const claude = capabilities.claude.rewind
    if (claude.state !== 'unwired') throw new Error('expected unwired')
    expect(claude.reason).not.toMatch(/no source|zero source|does not exist|unconfirmed/i)
    expect(claude.reason, 'it says the API exists and that we chose not to call it').toMatch(
      /rewindFiles|checkpointing/i,
    )
    // The reason that actually carries the deferral, and it is the same one on both providers.
    for (const provider of ['claude', 'codex'] as const) {
      const status = capabilities[provider].rewind
      if (status.state !== 'unwired') throw new Error('expected unwired')
      expect(status.reason, provider).toMatch(/writes to your files/i)
    }
  })
})

describe('what review found in the fold, kept red-until-fixed', () => {
  it('an EMPTY report is not superseded by the next one', () => {
    // ⚠️ `previous.changes.every(…)` over an empty array is `true`, so a report that named nothing —
    // the under-disclosed case, a provider hiccup — was replaced by whatever came next, and its own
    // `dropped` count went with it. A superset of nothing is not a superset.
    const state = createTranscript()
    appendUserMessage(state, 'go')
    applyEvent(state, report([], 'turn/diff/updated', 4))
    applyEvent(state, report([modified('a.ts')]))
    expect(state.changes.reports, 'the empty one was kept').toHaveLength(2)
    expect(changeSet(state).dropped, 'and its dropped count survived with it').toBe(4)
  })

  it('a change reported before the reader has said anything is IN the current turn', () => {
    // ⚠️ The report was stamped `max(turn, 1)` and the fold read a bare `turn`, so a resumed session
    // replaying — or an agent that moves first — put rows in turn 1 while the conversation was on
    // turn 0. "This turn" then matched nothing and the pane drew an empty scope over rows it held.
    const state = createTranscript()
    applyEvent(state, report([modified('early.ts')]))
    const set = changeSet(state)
    expect(set.rows, 'the row is there').toHaveLength(1)
    expect(
      scoped(set, 'turn').map((row) => row.path),
      'and This turn can see it',
    ).toEqual(['early.ts'])
  })

  it('a diff crowded out of a long report is not called oversize', () => {
    const state = createTranscript()
    appendUserMessage(state, 'go')
    applyEvent(
      state,
      report([{ path: 'a.ts', status: 'modified', added: 9, removed: 1, crowdedOut: true }]),
    )
    const [row] = changeSet(state).rows
    expect(row!.crowdedOut).toBe(true)
    expect(row!.oversize).toBeUndefined()
  })
})

describe('the one rule that lives in two places, checked rather than trusted', () => {
  it('the renderer’s `isNetUnchanged` answers exactly what the runtime’s does', () => {
    // ⚠️ Review found this duplicated and wanted it deleted. It cannot be: delegating would make the
    // renderer take a VALUE import from `@brobot2/runtime`, which drags the package index — and
    // `codex/generated-image.ts`'s `node:fs` — into the browser bundle. Measured, not assumed: the
    // DOM project failed to import at all. So the copy stays and this is what stops it drifting.
    const table: FileChange[] = [
      { path: 'a', status: 'modified', added: 0, removed: 0 }, // written and put back
      { path: 'b', status: 'modified', added: 1, removed: 0 },
      { path: 'c', status: 'modified', added: 0, removed: 1 },
      { path: 'd', status: 'touched' }, // Claude: no counts at all
      { path: 'e', status: 'deleted', added: 0, removed: 44 },
      { path: 'f', status: 'deleted', added: 0, removed: 0 }, // the refinement most likely to land
      { path: 'g', status: 'added', added: 0, removed: 0 },
      { path: 'h', status: 'modified', added: 0 }, // half-reported
      { path: 'i', status: 'modified', removed: 0 },
    ]
    for (const change of table) {
      const row = { ...change, bodyReportId: null, source: 'test', turn: 1 }
      expect(isNetUnchanged(row), change.path).toBe(runtimeNetUnchanged(change))
    }
    // NON-VACUITY: the table is not all one answer, so "they agree" is a real comparison.
    expect(new Set(table.map((change) => runtimeNetUnchanged(change))).size).toBe(2)
  })
})

/**
 * # 🔴 The change log across a window RELEASE (299 §2, from 297 finding 5)
 *
 * ⛔ **`changes.test.ts` never built a window and `transcript-window.test.ts` never emitted a
 * `file_change`.** Both were right about their own half: this file proves the badge counts the whole
 * conversation, and that one proves the release/carry machinery works. Between them, `state.changes`
 * was the one member of the not-an-item family that a release silently zeroed — so a conversation
 * long enough to roll its window said *"No file changes in this conversation"* about a conversation
 * that had demonstrably changed files, and the drawer's file count vanished from the tab strip.
 */

const SESSION = 'sess_1'
const at = (ordinal: number, event: TranscriptEvent): RuntimeEventMessage =>
  ({ sessionId: SESSION, ordinal, at: 1_800_000_000_000 + ordinal, event }) as RuntimeEventMessage

describe('the change log survives a release (299 §2)', () => {
  it('🔴 a file changed in the RELEASED prefix is still in the pane after the release', () => {
    const stream = [
      at(0, { type: 'user_turn', text: 'go' }),
      at(1, report([modified('src/alpha.ts')])),
      at(2, { type: 'activity', phase: 'thinking' }),
      at(3, { type: 'activity', phase: 'tool' }),
    ]
    const whole = foldWindow(stream)
    // The premise, asserted: the row really was folded before anything was released.
    expect(changeSet(whole).rows.map((row) => row.path)).toEqual(['src/alpha.ts'])

    const retained = stream.slice(2)
    // …and nothing in the suffix could restate it, which is what makes the carry the reason.
    expect(
      retained.some((entry) => entry.event.type === 'file_change'),
      'a retained event states the change — this proves nothing',
    ).toBe(false)

    const after = foldWindow(retained, null, carryForward(whole, retained))
    expect(after.changes.reports).toHaveLength(1)
    expect(changeSet(after).rows.map((row) => row.path)).toEqual(['src/alpha.ts'])
    // ⛔ The two false statements the loss produced, both gone: the tab strip keeps its count…
    expect(tabCount(changeSet(after))).toBe(1)
    // …and the pane is not drawing "nothing changed".
    expect(changeSet(after).rows.length).toBeGreaterThan(0)
  })

  it('⛔ …and a report the SUFFIX rebuilds is not carried as well — no row appears twice', () => {
    // ⚠️ **The case that makes this hard, and the ordinary one on the paging path.** `prependOlder`
    // re-folds a run that CONTAINS everything the carry was folded from, so a log copied wholesale
    // would double every row on every page back. The ordinal is what tells them apart.
    const stream = [
      at(0, report([modified('src/alpha.ts')])),
      at(1, report([modified('src/beta.ts')])),
    ]
    const whole = foldWindow(stream)
    expect(whole.changes.reports).toHaveLength(2)
    // Retaining EVERYTHING — the prepend shape, where the suffix restates the whole prefix.
    const after = foldWindow(stream, null, carryForward(whole, stream))
    expect(after.changes.reports).toHaveLength(2)
    expect(changeSet(after).rows.map((row) => row.path)).toEqual(['src/alpha.ts', 'src/beta.ts'])
  })

  it('⚠️ a report with no ordinal is left behind, exactly as it was before the carry existed', () => {
    // The fold is a pure function over events and a caller with nothing to give must not be given a
    // guess. An unstamped report cannot be told apart from one the suffix will rebuild, so it keeps
    // the behaviour it already had rather than being duplicated on every release.
    const state = createTranscript()
    applyEvent(state, report([modified('src/alpha.ts')]))
    expect(state.changes.reports[0]?.ordinal).toBeUndefined()
    expect(carryForward(state, []).changes.reports).toHaveLength(0)
  })

  it('⛔ the TURN base is carried net of what the suffix re-opens', () => {
    // ⚠️ A carried report keeps the absolute turn it landed in, and the re-fold counts the suffix's
    // own turns again — so carrying the total would count every retained turn twice and push the
    // fold's "This turn" past the rows that belong to it.
    const stream = [
      at(0, { type: 'user_turn', text: 'one' }),
      at(1, report([modified('src/alpha.ts')])),
      at(2, { type: 'user_turn', text: 'two' }),
      at(3, report([modified('src/beta.ts')])),
    ]
    const whole = foldWindow(stream)
    expect(whole.changes.turn).toBe(2)
    const retained = stream.slice(2)
    const after = foldWindow(retained, null, carryForward(whole, retained))
    expect(after.changes.turn, 'the second turn was counted twice').toBe(2)
    // …and the scope still means what it says: beta is this turn, alpha is not.
    const set = changeSet(after)
    expect(scoped(set, 'turn').map((row) => row.path)).toEqual(['src/beta.ts'])
    expect(scoped(set, 'conversation').map((row) => row.path)).toEqual([
      'src/alpha.ts',
      'src/beta.ts',
    ])
  })

  it('⛔ the carry is CAPPED, and the cap is counted rather than silent', () => {
    // A cap is never silent (092's rule, 096's precedent, and every other registry in the family).
    const many = MAX_CARRIED_CHANGE_REPORTS + 7
    const stream = Array.from({ length: many }, (_, index) =>
      at(index, report([modified(`src/file-${index}.ts`)])),
    )
    const whole = foldWindow(stream)
    expect(whole.changes.reports).toHaveLength(many)
    const carried = carryForward(whole, [])
    expect(carried.changes.reports).toHaveLength(MAX_CARRIED_CHANGE_REPORTS)
    expect(carried.changes.dropped).toBe(7)
    // The newest are what survive: what a reader is asked about is what just happened.
    expect(carried.changes.reports.at(-1)?.changes[0]?.path).toBe(`src/file-${many - 1}.ts`)
    // …and the surface says so rather than presenting a short list as a whole one.
    const after = foldWindow([], null, carried)
    expect(changeSet(after).droppedReports).toBe(7)
  })

  it('⚑ a conversation that never rolls its window says nothing about dropped reports', () => {
    // The paired positive: the sentence must not appear on the ordinary conversation.
    const whole = foldWindow([at(0, report([modified('src/alpha.ts')]))])
    expect(changeSet(whole).droppedReports).toBe(0)
  })

  it('⛔ the carry is a COPY — two folds cannot come to disagree through a shared array', () => {
    const whole = foldWindow([at(0, report([modified('src/alpha.ts')]))])
    const carried = carryForward(whole, [])
    carried.changes.reports.push(carried.changes.reports[0]!)
    expect(whole.changes.reports).toHaveLength(1)
  })

  it('⛔ ids do not collide across a release — `seq` is carried with the reports', () => {
    // `ChangeRow.bodyReportId` points at a report by its `changes_<n>` string, and a fresh fold
    // restarts that counter at zero. Without carrying `seq`, a carried report and a newly built one
    // would share an id and an expanded row would open the wrong diff.
    const stream = [
      at(0, report([modified('src/alpha.ts', 1, 1, 'diff-a')])),
      at(1, { type: 'activity', phase: 'thinking' }),
    ]
    const whole = foldWindow(stream)
    const retained = [...stream.slice(1), at(2, report([modified('src/beta.ts', 1, 1, 'diff-b')]))]
    const after = foldWindow(retained, null, carryForward(whole, retained))
    const ids = after.changes.reports.map((one) => one.id)
    expect(new Set(ids).size, `two reports share an id: ${ids.join(', ')}`).toBe(ids.length)
  })
})

/**
 * ⛔ **`opensTurn` and the fold, held to the same answer** (299 §2).
 *
 * The carry has to know how many turns the events it is about to re-fold will open, and that rule is
 * now written in two places — the fold's own `case 'user_turn'` and {@link opensTurn}. This is what
 * stops them drifting: every event type the transcript can hold is folded, and the predicate must
 * agree with what the fold actually did to the counter.
 *
 * ⚠️ **Two sources, because the union has two halves.** The runtime's 26 types are read off
 * `runtimeEventSchema` rather than typed out; the ones the APP adds have no schema — they never
 * cross a provider boundary — so they are a `Record` keyed by their literals, which does not compile
 * until a new one is given a sample. ⚑ 318 is the first new member since this was written, and the
 * `Record` is what made it a compile error rather than a row nobody folded.
 */
const APP_EVENTS: Record<
  Exclude<TranscriptEvent, RuntimeEvent>['type'],
  Exclude<TranscriptEvent, RuntimeEvent>
> = {
  worker_registered: {
    type: 'worker_registered',
    identity: 'aid:reader',
    identityCreatedAt: 123,
    giver: 'sess_giver',
    number: 1,
  },
  user_turn: { type: 'user_turn', text: 'go' },
  user_decision: { type: 'user_decision', requestId: 'r', outcome: 'answered' },
  message_queued: { type: 'message_queued', text: 'later' },
  message_unqueued: { type: 'message_unqueued', reason: 'sent', text: 'later' },
  user_command: { type: 'user_command', command: 'closed' },
  request_routed: {
    type: 'request_routed',
    requestId: 'req_1',
    to: 'a-person',
    because: 'a-permission-decision',
    parent: 'sess_1',
  },
  // 395 · the fifth, and it arrived as a compile error like the four before it. ⚠️ It must not open
  // a turn either: it is written INSIDE the turn it stops, and a row that opened one would put the
  // interruption in a turn of its own that nothing ever ends.
  work_interrupted: { type: 'work_interrupted', by: 'an-agent', agent: 'sess_1' },
  // 723 · and it arrived as a compile error like every one before it. ⚠️ It must not open a turn,
  // for `work_interrupted`'s reason one row up: it is written INSIDE the turn the unanswered ask was
  // about, and a row that opened one would put the stop's own bookkeeping in a turn nothing ends.
  stop_unanswered: { type: 'stop_unanswered', waitedMs: 2_000, by: 'a-person' },
  // 396 · the sixth, and it arrived as a compile error like the five before it. ⚠️ It must not open
  // a turn: it is written by a startup sweep into a ledger whose conversation is not running, and a
  // turn opened there would be one nothing can ever close — `settleOrphanRuns` would find it at the
  // NEXT launch and close it `unknown`, which is this app inventing a turn and then explaining it.
  request_stranded: { type: 'request_stranded', requestId: 'req_1' },
  // 397 · the seventh, and it arrived as a compile error like the six before it. ⚠️ It must not open
  // a turn, for `work_interrupted`'s reason and beside it: it is written INSIDE the turn being
  // stopped, in the same synchronous stretch as the ask, and a row that opened one would put the
  // interruption's own bookkeeping in a turn nothing ever ends.
  request_interrupted: { type: 'request_interrupted', requestId: 'req_1' },
  // ⚑ D-016 · 591's `request_work_withdrawn` went: `work_taken_back` ends a piece's questions now.
  // ⚑ **D-009**
  question_withdrawn: { type: 'question_withdrawn', requestId: 'req_1' },
  question_recipient_ended: {
    type: 'question_recipient_ended',
    requestId: 'req_1',
    recipient: 'sess_b',
  },
  question_ended_with_its_piece: {
    type: 'question_ended_with_its_piece',
    requestId: 'req_1',
    ending: 'work-replied',
  },
  // 398 · the eighth, and it arrived as a compile error like the seven before it. ⚠️ It must not
  // open a turn, and here that is nearly a tautology worth writing down anyway: this row is written
  // BECAUSE a turn has been open and silent, so a row that opened a second one would make the very
  // condition it reports unobservable — the new turn's `user_turn` would be the activity that ends
  // the quiet it just recorded.
  work_restarted: { type: 'work_restarted' },
  // 673 · the host's row that a reopen happened. ⚠️ It must not open a turn: nothing was said.
  reopened: { type: 'reopened' },
  // An agent brought it back from the archive. It opens no turn: nothing was said.
  restored_from_archive: {
    type: 'restored_from_archive',
    saying: 'Brought back from the archive.',
  },
  // D-017 · R4 · the host's row that this app launched the provider, at every start and reopen.
  // ⚠️ It must not open a turn, for `reopened`'s reason beside it: nothing was said, and it is
  // written before the conversation's first turn of that life.
  launched: { type: 'launched' },
  // D-017 · R10 · the pair a replacement writes, and it arrived as a compile error like every one
  // before it. ⚠️ Neither opens a turn: `replaced_by` is the LAST row of a conversation that can
  // never run again, so a turn opened there is one nothing could end; `replaces` sits right under
  // the new conversation's `launched`, before anything was said in it — `launched`'s reason.
  replaced_by: { type: 'replaced_by', sessionId: 'sess_new' },
  replaces: { type: 'replaces', sessionId: 'sess_old' },
  // 404 · the tenth, and it arrived as a compile error like the nine before it. ⚠️ It must not open
  // a turn, and the reason is the one row it always sits under: the notice it is a receipt for went
  // in as a `user_turn` a moment earlier, so a turn opened here would split one delivery across two.
  // ⛔ Its `its-own-ending` member has no message at all and is written while the conversation may be
  // doing nothing, which is `request_stranded`'s reason as well. ⚑ D-016: `work_reported` became
  // `work_stall_told`, keyed by the piece.
  work_reconciliation: {
    type: 'work_reconciliation',
    incident: 'incident',
    piece: 'work_1',
    kind: 'wait-target-ended',
    since: 1,
    step: 'person',
    outcome: 'listed',
  },
  work_recovery: {
    type: 'work_recovery',
    turn: 'turn_1',
    pieces: ['work_1'],
    since: 1,
    phase: 'pending',
  },
  work_stall_told: {
    type: 'work_stall_told',
    piece: 'work_1',
    cause: 'app_restarted',
    how: 'pushed',
  },
  // 398 · the ninth. ⚠️ It must not open a turn for `request_stranded`'s reason: a sweep writes it
  // into a conversation that may not be running at all, and a turn opened there is one nothing can
  // close.
  request_escalated: { type: 'request_escalated', requestId: 'req_1' },
  // 405 · the eleventh. ⚠️ It must not open a turn, and this one is the plainest of the eleven: it
  // is written from INSIDE a turn that is already open — a tool call is something a model does
  // mid-turn — so a row that opened one here would open a second turn inside the first.
  tool_refused: {
    type: 'tool_refused',
    tool: 'give_work',
    rail: 'too-deep',
    permanence: 'until-a-person-changes-it',
    retryable: false,
  },
  memory_note: {
    type: 'memory_note',
    notes: [{ path: '/p/memories/extensions/ad_hoc/notes/2026-09-04T00-00-00-x.md', bytes: 3 }],
  },
  // 332 · the second new member since this `Record` was written, and it went in as a compile error
  // rather than as a row nobody folded — which is the whole point of the shape.
  memory_loaded: { type: 'memory_loaded', index: '/p/memory/MEMORY.md', beside: 2 },
  // 379 · the third, and it arrived the same way. ⚠️ A piece row must not open a turn: the turn is
  // opened by the `user_turn` that carries the brief, and a second one would put a conversation a
  // message behind itself for the rest of its life. ⚑ D-016: `task_assigned` became `work_given`.
  work_given: {
    type: 'work_given',
    piece: 'work_1',
    label: 'W1.1',
    parent: 'work_root',
    givenBy: 'sess_parent',
    title: 'the work',
    brief: 'go',
  },
  // 393 · the fourth, and it arrived the same way. ⚠️ A reply must not open a turn either: it is
  // written by a TOOL CALL inside a turn that is already open, so counting one here would put the
  // conversation a turn ahead of itself for the rest of its life — `work_given`'s hazard with the
  // sign flipped. ⚑ D-016: `task_replied` became `work_replied`.
  work_replied: {
    type: 'work_replied',
    piece: 'work_1',
    outcome: 'done',
    summary: 'it is done',
    resources: [],
  },
  // 429 · it arrived as a compile error like every one before it. ⚠️ It must not open a turn, and
  // the reason is the strongest on this list: NOTHING runs on the conversation this row lands in.
  // A take-back is written into the owner's ledger by its giver's tool call, so a turn opened here
  // would be one the owner never started and nothing could ever end. ⚑ D-016: `task_withdrawn`
  // became `work_taken_back`.
  work_taken_back: { type: 'work_taken_back', piece: 'work_1', by: 'sess_1' },
  // ⚑ D-016 · the other four piece rows, and they arrived as compile errors like every one before
  // them. ⚠️ None opens a turn, for `work_taken_back`'s reason: each is written by a tool call —
  // often another conversation's — into the owner's ledger, where nothing is being said.
  work_retitled: {
    type: 'work_retitled',
    piece: 'work_1',
    title: 'the work, renamed',
    by: 'sess_1',
  },
  work_status_set: { type: 'work_status_set', piece: 'work_1', line: 'half way', by: 'sess_1' },
  work_rebriefed: { type: 'work_rebriefed', piece: 'work_1', brief: 'go further', by: 'sess_1' },
  work_closed: { type: 'work_closed', piece: 'work_1', by: 'sess_1' },
  // ⚑ D-047 · the giver's own record of a give, and it arrived as a compile error too. ⚠️ It must
  // not open a turn: it is written from inside the turn that called `give_work`.
  work_sent: {
    type: 'work_sent',
    piece: 'work_1',
    label: 'W1.1',
    as: 'given',
    to: 'sess_2',
    title: 'the work',
    brief: 'do it',
  },
  // 415 · the twelfth, and it arrived as a compile error like the eleven before it. ⚠️ It must not
  // open a turn for `work_replied`'s reason, one row further on: it is written from inside the very
  // turn that called `reply_to_parent`, immediately after the reply it is about, and a turn opened
  // here would put the replying conversation a turn ahead of itself for the rest of its life.
  reply_undelivered: {
    type: 'reply_undelivered',
    piece: 'work_1',
    parent: 'sess_parent',
    because: 'no-conversation',
  },
  // ⚑ D-042 · 682's `model_choice_set_aside` went, with the stand-in re-judge it reported: no launch
  // sets a choice aside any more. R1 names the conversation's pair and records it on its row, a give
  // outside the list is refused at the give (`refuseModel`), and a model the provider itself refuses
  // is said at that call (D-039). There is no row left to sample.
  // 437 · the thirteenth, and it arrived as a compile error like the twelve before it. ⚠️ It must
  // not open a turn, for `request_routed`'s reason one row over: it is written from INSIDE the turn
  // that called `ask_parent`, and a turn opened here would put the asking conversation a turn ahead
  // of itself for the rest of its life — while the answer it is waiting for is still to come.
  question_asked: {
    type: 'question_asked',
    requestId: 'req_1',
    piece: 'work_1',
    label: 'W1.1',
    prompt: 'which database?',
    questions: [{ id: 'answer', prompt: 'which database?', options: [] }],
  },
  // 439 · and it arrived as a compile error like the ones before it. ⚠️ It must not open a turn: it
  // is the SENDER's receipt, written in the same synchronous stretch as the tool call that sent the
  // message, and the turn that matters is the RECIPIENT's. ⛔ A row that opened one here would put
  // the sender in a turn nothing ever ends — `work_stall_told`'s argument exactly, one direction over.
  message_sent: {
    type: 'message_sent',
    to: 'sess_1',
    toProfile: 'project-manager',
    kind: 'follow-up',
    piece: 'work_1',
    label: 'W1.1',
    delivery: 'sent',
    onBehalfOfAPerson: false,
  },
  instruction_proposed: {
    type: 'instruction_proposed',
    askId: 'iprop_1',
    ask: 'propose',
    about: 'worker',
    proposedBy: 'default',
    text: 'Never force-push.',
    why: 'it keeps coming up',
  },
  instruction_settled: { type: 'instruction_settled', askId: 'iprop_1', ending: 'refused' },
  instruction_changed: {
    type: 'instruction_changed',
    conversation: 'ses-wren',
    profile: 'lark',
    version: 2,
    previousVersion: 1,
    author: { profile: 'wren', name: 'Wren' },
    replacedPersonVersion: 1,
  },
  mcp_server_requested: {
    type: 'mcp_server_requested',
    requestId: 'msreq_1',
    name: 'kibana',
    url: 'http://127.0.0.1:8765/mcp',
    reaches: 'reads the logs',
    whoGetsIt: 'everyone',
    requestedBy: 'default',
  },
  mcp_server_request_settled: {
    type: 'mcp_server_request_settled',
    requestId: 'msreq_1',
    ending: 'refused',
  },
}

describe('what opens a turn is one rule (299 §2)', () => {
  it('agrees with the fold, on every event the transcript can hold', () => {
    const runtimeTypes = runtimeEventSchema.options.map(
      (option) => (option as unknown as { shape: { type: { value: string } } }).shape.type.value,
    )
    expect(
      runtimeTypes.length,
      'the union was read as empty — this would pass over nothing',
    ).toBeGreaterThan(20)
    const events: TranscriptEvent[] = [
      ...Object.values(APP_EVENTS),
      ...runtimeTypes.map((type) => ({ type }) as TranscriptEvent),
    ]
    let opened = 0
    let folded = 0
    for (const event of events) {
      const state = createTranscript()
      // ⚠️ **A bare `{type}` is not always foldable** — `session` reads `event.ref.sessionId` — and
      // inventing a whole valid payload for all 25 runtime types would be a second event fixture
      // library to keep in step. A type that cannot be folded from its discriminator alone is still
      // held to the predicate: it must not claim to open a turn.
      let moved: boolean
      try {
        applyEvent(state, event)
        folded += 1
        moved = state.changes.turn > 0
      } catch {
        moved = false
      }
      expect(opensTurn(event), `${event.type}: opensTurn disagrees with the fold`).toBe(moved)
      if (moved) opened += 1
    }
    // NON-VACUITY, both ways: exactly one type opens a turn, and 25 of the 32 really were folded
    // rather than skipped by the catch above.
    //
    // ⚠️ **8 rather than 7 since 319**, and the reason is the one the catch block states rather than
    // a threshold being nudged: `memory_recall` reads `event.entries`, so a bare `{type}` throws in
    // the fold exactly as `session` does reading `event.ref`. ⛔ It is still held to the predicate —
    // an event that cannot be folded must still not claim to open a turn — which is the assertion
    // this census exists for and the one that does NOT weaken here.
    //
    // ⚠️ **9 rather than 8 since 358**, for exactly that reason again: `tool_inventory` reads
    // `event.declared` and `event.naming`, so a bare `{type}` throws. ⛔ **The predicate half is
    // where this census does its work and it is untouched** — the new type is still folded through
    // `opensTurn` and still asserted not to open a turn; only the count of types whose PAYLOAD a
    // bare discriminator cannot stand in for moved.
    expect(opened, 'no event type opened a turn — the table builds nothing').toBe(1)
    expect(
      folded,
      'too many types were unfoldable — this census is passing over them',
    ).toBeGreaterThan(events.length - 9)
  })
})
