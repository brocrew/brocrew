import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_READABLE_EVENTS,
  TOOL_ACTIVITY_IS_INCLUDED,
  TOOL_ACTIVITY_WAS_LEFT_OUT,
  composeReadable,
  readWholeConversation,
} from '../src/renderer/src/lib/readable-export'
import {
  appendAppNotice,
  applyEvent,
  createTranscript,
  type TranscriptItem,
} from '../src/renderer/src/lib/transcript'
import { THE_APP_IS_THE_AUTHOR } from '../src/shared/app-notice'
import { writeReadingExport } from '../src/main/archive/write-reading'
import {
  MAX_READING_BYTES,
  READING_NOTE,
  READING_SUFFIX,
  type HistoryWindow,
  type PersistedEventInfo,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 A conversation a person can read (633)
 *
 * Export a conversation as Markdown matching what the UI shows, with an option to include MCP
 * tool calls and shell commands.
 *
 * ## ⛔ The three facts this file holds
 *
 *  1. **§1 — the words come from the UI's own fold**, and authorship survives (`624`).
 *  2. **§2 — it is the WHOLE conversation and not the window**, which is the measurement that
 *     decided where this is composed: the live window holds 5,000 events and Ada's was 7,062.
 *  3. **§3 — the bound REFUSES with the size in it** (`read-bundle.ts`' discipline, copied).
 */

const at = (ordinal: number): number => 1_700_000_000_000 + ordinal * 1_000

const entry = (ordinal: number, event: TranscriptEvent): PersistedEventInfo => ({
  ordinal,
  at: at(ordinal),
  event,
})

const said = (text: string): TranscriptEvent => ({ type: 'assistant_message', text })
const asked = (text: string): TranscriptEvent => ({ type: 'user_turn', text })

/** ⚑ **Folded through the ONE public fold**, so the items under test are the screen's own. */
const itemsFrom = (events: readonly TranscriptEvent[]): TranscriptItem[] => {
  const state = createTranscript()
  for (const [ordinal, event] of events.entries()) applyEvent(state, event, at(ordinal))
  return state.items
}

describe('§1 · ⛔ the words, and whose they are', () => {
  it('the agent’s words and the person’s words reach the file under distinct headings', () => {
    const md = composeReadable(
      'World clock',
      itemsFrom([asked('build me a clock'), said('on it')]),
      {
        toolActivity: false,
      },
    )
    expect(md).toContain('# World clock')
    expect(md).toContain('### You')
    expect(md).toContain('build me a clock')
    expect(md).toContain('### the agent')
    expect(md).toContain('on it')
    // ⛔ **The note is the SHARED constant**, so the file and the popup cannot promise two things.
    expect(md).toContain(READING_NOTE)
  })

  it('⛔ the file SAYS which of the two it is, in both arms', () => {
    // ⚠️ **A reader is never left inferring silence.** An export with no tool rows and an export
    // with the option off look identical in the body; only this line tells them apart.
    const items = itemsFrom([said('hello')])
    expect(composeReadable('x', items, { toolActivity: false })).toContain(
      TOOL_ACTIVITY_WAS_LEFT_OUT,
    )
    expect(composeReadable('x', items, { toolActivity: true })).toContain(TOOL_ACTIVITY_IS_INCLUDED)
    expect(TOOL_ACTIVITY_WAS_LEFT_OUT).not.toBe(TOOL_ACTIVITY_IS_INCLUDED)
  })

  it('🔴 624 · the app’s own row is headed `This app`, and not as the person or as BroBot', () => {
    // ⛔ **`624` gave the app's report its own row — *a message says who wrote it*.** ⚠️ An export
    // that flattened everything into `user:` / `assistant:` would undo that in the one artefact
    // the PO reads, which is `633` §3.2 by name.
    //
    // 🔴 **And the heading is `This app` rather than `BroBot`, which is the PO's own correction**:
    // *"And the app sent it, not BroBot… a row headed BroBot inside BroBot's conversation claims
    // the agent wrote words it in fact RECEIVED."* ⚑ This is the assertion that caught the first
    // draft of `AUTHOR`, which said `BroBot`.
    const state = createTranscript()
    applyEvent(state, asked('please approve'), at(0))
    appendAppNotice(state, 'A person decided: approved.', 'a-decision-a-person-made')
    const md = composeReadable('x', state.items, { toolActivity: false })

    expect(md).toContain('A person decided: approved.')
    const before = md.slice(0, md.indexOf('A person decided'))
    expect(before.lastIndexOf(`### ${THE_APP_IS_THE_AUTHOR}`)).toBeGreaterThan(
      before.lastIndexOf('### You'),
    )
    // ⛔ **It is the SHARED constant and not a copy** — a heading written here would be a second
    // spelling, free to disagree with the conversation it claims to reproduce.
    expect(THE_APP_IS_THE_AUTHOR).not.toBe('BroBot')
    expect(md).not.toContain('### BroBot')
    // The paired positive keeps the person’s own row attributed to them. Together the
    // assertions distinguish authorship in a file that also contains their display name.
    expect(md.slice(0, md.indexOf('please approve')).lastIndexOf('### You')).toBeGreaterThan(-1)
  })
})

describe('§2 · ⚠️ the OPTION, and it is one category rather than the two he named', () => {
  const withATool = itemsFrom([
    said('let me look'),
    { type: 'tool_call', id: 'call_1', name: 'Bash', summary: 'ls -la' },
    { type: 'tool_result', id: 'call_1', summary: 'four files', ok: true },
  ])

  it('⛔ the tool activity is OUT by default and IN when asked for', () => {
    // 🔴 **`633` §7: the readable output is the PRIMARY case and the debug output is the option.**
    expect(composeReadable('x', withATool, { toolActivity: false })).not.toContain('ls -la')
    expect(composeReadable('x', withATool, { toolActivity: true })).toContain('ls -la')
    // ⚑ **The prose is in BOTH**, which is what makes the line above an option rather than a
    // second export.
    for (const toolActivity of [true, false]) {
      expect(composeReadable('x', withATool, { toolActivity })).toContain('let me look')
    }
  })

  it('🔴 a shell command and an MCP call ride the SAME switch, because they are one item kind', () => {
    // `TranscriptItem` has one `tool` kind; the provider’s tool name distinguishes shell
    // commands from MCP calls. Both share one inclusion predicate in this projection.
    const both = itemsFrom([
      { type: 'tool_call', id: 'c1', name: 'Bash', summary: 'echo hi' },
      { type: 'tool_call', id: 'c2', name: 'brobot__list_agents', summary: 'list the agents' },
    ])
    const off = composeReadable('x', both, { toolActivity: false })
    const on = composeReadable('x', both, { toolActivity: true })
    for (const text of ['echo hi', 'list the agents']) {
      expect(off, `${text} is in the prose export`).not.toContain(text)
      expect(on, `${text} is missing from the debug export`).toContain(text)
    }
  })
})

describe('§2b · ⛔ what the export drops, and each is a decision the screen already made', () => {
  it('🔴 a notice at `info` is out of BOTH arms, and `warn` is in BOTH', () => {
    // ⛔ **`transcript-mode.ts`' own ruling, carried**: `info` is lifecycle chrome — *"it tells you
    // the machinery worked"* — and `warn` is where a failed turn, a rate-limit notice and a stall
    // warning live. ⚠️ *"A user who cannot see those is being lied to by omission"*, and an export
    // sent to somebody who was not there is the worst place to omit them.
    const items = itemsFrom([
      {
        type: 'session',
        state: 'started',
        ref: { provider: 'claude', sessionId: 'abc', cwd: '/tmp/w', rotation: 0 },
      },
      { type: 'error', message: 'the provider rate-limited this turn', fatal: false },
    ])
    const chrome = items.filter((item) => item.kind === 'notice' && item.level === 'info')
    const loud = items.filter((item) => item.kind === 'notice' && item.level !== 'info')
    // 🔴 **BOTH controls, and the first one was missing.** ⛔ The first draft of this test looped
    // over `chrome` with no `info` notice in the fixture, so the whole assertion was vacuous —
    // found by `M5` SURVIVING. ⚠️ `a-negative-is-only-as-strong-as-the-search-shape` at the
    // fixture, and a count is what turns it back into a measurement.
    expect(
      chrome.length,
      'the fixture produced no info notice, so the drop below is not measured',
    ).toBeGreaterThan(0)
    expect(
      loud.length,
      'the fixture produced no loud notice, so nothing below is measured',
    ).toBeGreaterThan(0)
    for (const toolActivity of [true, false]) {
      const md = composeReadable('x', items, { toolActivity })
      expect(md).toContain('the provider rate-limited this turn')
      for (const item of chrome) {
        const text = item.kind === 'notice' ? item.text : ''
        expect(text.length).toBeGreaterThan(0)
        expect(md, 'an info notice reached the export').not.toContain(text)
      }
    }
  })

  it('⚠️ a SUPERSEDED tool row is out of both arms, because the screen shows it in neither', () => {
    // ⛔ **`028`'s checklist**: Claude builds it out of `TaskCreate`/`TaskUpdate` calls, so showing
    // the calls AND the checklist is the same fact twice. ⚑ `isVisibleIn` drops it in both modes;
    // an export that put it back would be disagreeing with the screen it claims to reproduce.
    const items = itemsFrom([
      { type: 'tool_call', id: 'c1', name: 'TaskCreate', summary: 'plan the work' },
      { type: 'plan_update', steps: [{ text: 'do it', status: 'pending' }], supersedes: ['c1'] },
    ])
    expect(
      items.some((item) => item.kind === 'tool' && item.superseded === true),
      'the fixture produced no superseded row, so nothing below is measured',
    ).toBe(true)
    expect(composeReadable('x', items, { toolActivity: true })).not.toContain('plan the work')
  })
})

describe('§3 · 🔴 the WHOLE conversation, not the window the reader is looking at', () => {
  /** ⚑ A ledger of `n` events, paged the way the host pages one. */
  const ledgerOf = (n: number): PersistedEventInfo[] =>
    Array.from({ length: n }, (_one, i) => entry(i, said(`turn ${String(i)}`)))

  const pagerOver = (
    all: readonly PersistedEventInfo[],
    pageSize: number,
  ): {
    latest: () => Promise<HistoryWindow>
    earlier: (said: { before: number }) => Promise<HistoryWindow>
    calls: number[]
  } => {
    const calls: number[] = []
    // ⛔ **STRICTLY before the cursor**, which is the host's own contract: the statement behind
    // `earlierHistory` is `… AND ordinal < ? ORDER BY ordinal`. ⚠️ **A fixture that overlapped
    // would hide a duplication bug rather than expose one** — the first draft of this pager did,
    // and the count came back 7,500 for a 7,062-event ledger, which is how it was found.
    const windowAt = (from: number, until: number): HistoryWindow => ({
      entries: all.slice(from, until),
      from,
      hasOlder: from > 0,
      turnAligned: true,
    })
    return {
      latest: () => Promise.resolve(windowAt(Math.max(0, all.length - pageSize), all.length)),
      earlier: (asked) => {
        calls.push(asked.before)
        return Promise.resolve(windowAt(Math.max(0, asked.before - pageSize), asked.before))
      },
      calls,
    }
  }

  it('⛔ it pages back to ordinal 0 — a conversation larger than one window is whole', async () => {
    // `WINDOW_MAX_EVENTS` is 5,000 and the live window releases older events. A conversation
    // longer than that must export from the complete ledger; composing
    // `session.window.entries` would export only a portion.
    const all = ledgerOf(7_062)
    const pager = pagerOver(all, 2_500)
    const read = await readWholeConversation({
      sessionId: 'sess_1',
      liveFrom: null,
      latest: pager.latest,
      earlier: pager.earlier,
    })
    expect(read.ok, JSON.stringify(read)).toBe(true)
    expect(read.ok && read.events).toBe(7_062)
    // ⚑ **The FIRST turn is in it**, which is the half a slab would be missing.
    expect(read.ok && composeReadable('x', read.items, { toolActivity: false })).toContain('turn 0')
    expect(read.ok && composeReadable('x', read.items, { toolActivity: false })).toContain(
      'turn 7061',
    )
    // ⚠️ **It really paged**, so the assertion above is about the loop rather than about a fixture
    // that fitted in one window.
    expect(pager.calls.length).toBeGreaterThan(1)
  })

  it('⚑ …and a conversation that fits in ONE page asks for nothing more', async () => {
    // ⛔ **The paired negative**: a loop that always paged would look identical on the test above.
    const pager = pagerOver(ledgerOf(10), 2_500)
    const read = await readWholeConversation({
      sessionId: 'sess_1',
      liveFrom: null,
      latest: pager.latest,
      earlier: pager.earlier,
    })
    expect(read.ok && read.events).toBe(10)
    expect(pager.calls).toEqual([])
  })

  it('🔴 a door that cannot answer says so rather than looping for ever', async () => {
    // ⛔ **`34`'s rule**: a check that cannot run and a check that found nothing look identical, so
    // this one says which. ⚠️ An empty page with `hasOlder` still true is a door that is not
    // answering, and returning silently would spin.
    const read = await readWholeConversation({
      sessionId: 'sess_1',
      liveFrom: null,
      latest: () =>
        Promise.resolve({
          entries: [entry(5, said('x'))],
          from: 5,
          hasOlder: true,
          turnAligned: true,
        }),
      earlier: () => Promise.resolve({ entries: [], from: 0, hasOlder: true, turnAligned: true }),
    })
    expect(read.ok).toBe(false)
    expect(!read.ok && read.reason).toContain('back to its beginning')
  })

  it('⛔ past the bound it REFUSES, with the number in it — never truncated', async () => {
    // ⚑ `read-bundle.ts`' discipline, copied by instruction: *"Nothing is silently truncated: past
    // this size the answer is `no`, with the size in it."*
    // ⚠️ **The older page ENDS the ledger** (`hasOlder: false`), deliberately. ⛔ A fixture that
    // never ran out would make a raised bound HANG rather than go red — and a mutation runner
    // cannot tell a hang from a slow suite. ⚑ Found by `M7` timing out against the first draft.
    const read = await readWholeConversation({
      sessionId: 'sess_1',
      liveFrom: null,
      latest: () =>
        Promise.resolve({
          entries: ledgerOf(MAX_READABLE_EVENTS + 10),
          from: 10,
          hasOlder: true,
          turnAligned: true,
        }),
      earlier: () =>
        Promise.resolve({ entries: ledgerOf(10), from: 0, hasOlder: false, turnAligned: true }),
    })
    expect(read.ok).toBe(false)
    expect(!read.ok && read.reason).toContain(String(MAX_READABLE_EVENTS))
  })
})

describe('§4 · ⛔ the writer — bytes it was given, and a refusal that names the size', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-reading-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('⚑ writes the Markdown it was handed, and makes the directory', async () => {
    // ⚠️ **Into a directory that does not exist yet**, which is every install that has never
    // exported.
    const path = join(dir, 'exports', `sess_1${READING_SUFFIX}`)
    const outcome = await writeReadingExport(path, '# hello\n\nthere\n')
    expect(outcome.ok, JSON.stringify(outcome)).toBe(true)
    expect(readFileSync(path, 'utf8')).toBe('# hello\n\nthere\n')
    expect(outcome.ok && outcome.written.bytes).toBe(15)
  })

  it('🔴 past the bound it refuses with the size, and writes NOTHING', async () => {
    const path = join(dir, `sess_1${READING_SUFFIX}`)
    const outcome = await writeReadingExport(path, 'x'.repeat(MAX_READING_BYTES + 1))
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toContain('MB of Markdown')
    expect(!outcome.ok && outcome.reason).toContain(String(MAX_READING_BYTES / 1024 / 1024))
    // ⛔ **Nothing half-written**, which is the whole difference between refusing and truncating.
    expect(() => readFileSync(path, 'utf8')).toThrow()
  })

  it('⚠️ an empty body is refused too, and it is a different sentence', async () => {
    const outcome = await writeReadingExport(join(dir, `sess_1${READING_SUFFIX}`), '')
    expect(outcome.ok).toBe(false)
    expect(!outcome.ok && outcome.reason).toBe('there was nothing to write')
  })

  it('⛔ the bound counts BYTES and not characters', async () => {
    // ⚑ **An accented conversation is longer than its length**, and the filesystem holds bytes.
    const outcome = await writeReadingExport(join(dir, `a${READING_SUFFIX}`), 'é')
    expect(outcome.ok && outcome.written.bytes).toBe(2)
  })
})
