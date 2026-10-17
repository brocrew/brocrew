import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  appendLive,
  createWindow,
  openAt,
  prependPage,
  WINDOW_MAX_EVENTS,
  WINDOW_RELEASE_CHUNK,
} from '../src/renderer/src/lib/transcript-window'
import {
  HISTORY_WINDOW_MAX_EVENTS,
  type HistoryWindow,
  type RuntimeEventMessage,
  type TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 Eleven hours you cannot scroll to (313 — friction log F3)
 *
 * ## The defect, in one sentence
 *
 * `TranscriptView` rendered the only way back to the tail under `v-if="props.behind > 0"`, and
 * `behind` counts **live events that arrived while you were reading back**. On an idle session
 * nothing ever arrives, so it stays 0 for ever — and a window that had let go of the end had no
 * control, no hint, and no way back. ⛔ The store never agreed with the view: `session-store`'s own
 * `jumpToLatest` has always returned early on `record.window.atTail`, never on `behind`, and
 * `transcript-window.ts` says the split out loud — *"`session-store.jumpToLatest` is that escape,
 * and `behind` is what tells the reader to take it."* **The nudge had been wired as the gate.**
 *
 * ## What this file is, and why it is not the dom test
 *
 * Two rules, both about the same sentence, neither of which needs a browser:
 *
 *  Reach the non-tail state through one gesture using the real `openAt`, `appendLive`, and
 *  `prependPage` functions and measured counts, rather than hand-setting `atTail: false`.
 *  Derive every escape-offering caller from `.vue` sources and require it to pass the gating
 *  fact, so future transcript surfaces join the census automatically.
 *
 * The gesture itself — the button rendering, its label, the click, the scroll — is
 * `test/dom/eleven-hours.dom.test.ts`, in real Chromium, because the defect is that an element was
 * absent and only a real render can answer that honestly (`193`).
 */

const AT = 1_700_000_000_000

const event = (ordinal: number): TranscriptEvent =>
  ({ type: 'assistant_message', text: `line ${ordinal}` }) as TranscriptEvent

const persisted = (from: number, count: number): HistoryWindow['entries'] =>
  Array.from({ length: count }, (_, index) => ({
    ordinal: from + index,
    at: AT + from + index,
    event: event(from + index),
  }))

const live = (from: number, count: number): RuntimeEventMessage[] =>
  Array.from({ length: count }, (_, index) => ({
    sessionId: 'sess_1',
    ordinal: from + index,
    at: AT + from + index,
    event: event(from + index),
  })) as RuntimeEventMessage[]

const page = (from: number, count: number, rest: Partial<HistoryWindow> = {}): HistoryWindow => ({
  entries: persisted(from, count),
  from,
  hasOlder: from > 0,
  turnAligned: true,
  ...rest,
})

/**
 * Replay a measured session shape with 5,015 events, ordinals 0…5014, and 13 turns.
 *
 * Read from his ledger with a read-only `sqlite3` snapshot while his app was closed, and every
 * number here is one of his:
 *
 * | | |
 * |---|---|
 * | `session/resumed` | ordinal **4083**, 23:37:15 — the reopen really happened |
 * | reopen page | the host's NEWEST 2,500 (`turnWindow` defaults `before` to `max(ordinal)+1`) |
 * | live after it | ordinals 4084…5014 — turns 7 to 12, up to 23:55:13 |
 * | one gesture back | the 1,584 events below the page, which is all that remained |
 *
 * ⛔ **The reopen did NOT load the oldest page.** `openAt` sets `atTail = true` over a page the host
 * windows backwards from the end; the stranding is entirely on the way back.
 */
function aPersonSession(): { window: ReturnType<typeof createWindow>; released: number } {
  const window = createWindow()
  // 23:37:15 — `session/resumed`. `ResumedSession.history` is `historyWindow(id, {})`, the newest
  // page, so this opens at ordinals 1584…4083 with `atTail` true.
  openAt(window, page(1584, HISTORY_WINDOW_MAX_EVENTS, { hasOlder: true }), 'sess_1')
  // 23:37 → 23:55 — turns 7 to 12 stream in and are folded, because the window holds the tail.
  for (const message of live(4084, 931)) appendLive(window, message)
  // ONE backward gesture. There are only 1,584 events below the page, so this is also the last one.
  const { released } = prependPage(window, page(0, 1584, { hasOlder: false }), 'sess_1')
  return { window, released }
}

describe('the state a reader gets stranded in (313 §3.3)', () => {
  it('🔴 one gesture takes the window off the tail, and `behind` never moves', () => {
    const { window, released } = aPersonSession()

    // ⛔ The retained slab is `max(page, WINDOW_MAX_EVENTS − WINDOW_RELEASE_CHUNK)` from the OLDEST
    // end — 3,750 events, ordinals 0…3749. That is the window he was looking at.
    expect(window.entries.length).toBe(WINDOW_MAX_EVENTS - WINDOW_RELEASE_CHUNK)
    expect(window.from).toBe(0)
    expect(window.entries.at(-1)?.ordinal).toBe(3749)
    // …and 1,265 events — turns 5 to 12, 23:29 to 23:55 — went out of the window in one patch.
    expect(released).toBe(1_265)

    // 🔴 THE DEFECT. Both are true at once, and the affordance used to read the second one.
    expect(window.atTail).toBe(false)
    expect(window.behind).toBe(0)

    // ⛔ **And the other edge went dark in the same patch.** `hasOlder` comes from the page, the page
    // reached ordinal 0, so *Load earlier messages* is correctly hidden — leaving a window with no
    // control at either end. That is why the bar is not a nicety.
    expect(window.hasOlder).toBe(false)
  })

  it('⚑ …and it is the FIRST gesture, because live events had already grown the window', () => {
    // The control (106): a window that only ever held the host's page does NOT strand on one
    // prepend — 2,500 + 1,584 is under the 5,000 cap, nothing is released, `atTail` stays true.
    // It is the 931 live events between the reopen and 23:55 that push the union over it. Without
    // this, the assertion above would read as "paging back strands you", which is not what happened.
    const quiet = createWindow()
    openAt(quiet, page(1584, HISTORY_WINDOW_MAX_EVENTS, { hasOlder: true }), 'sess_1')
    const { released } = prependPage(quiet, page(0, 1584, { hasOlder: false }), 'sess_1')
    expect(released).toBe(0)
    expect(quiet.atTail).toBe(true)
    expect(quiet.entries.length).toBe(HISTORY_WINDOW_MAX_EVENTS + 1584)
  })

  it('⚠️ an idle session can never earn a `behind` — derived, not asserted about one fixture', () => {
    // ⛔ **`behind` has exactly one writer that raises it, and it needs a live event to run at all.**
    // No traffic, no increment, for ever. That is the whole of F3: the gate was a counter of a thing
    // that had already stopped happening. Read off the renderer rather than stated, so a second
    // writer appearing somewhere else fails here instead of quietly making this paragraph false.
    const renderer = RENDERER
    const sources: Array<{ file: string; text: string }> = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.vue'))
          sources.push({
            file: full.slice(renderer.length + 1).replaceAll('\\', '/'),
            text: readFileSync(full, 'utf8'),
          })
      }
    }
    walk(renderer)
    expect(sources.length).toBeGreaterThan(0)
    const raisers = sources
      .filter(({ text }) => /\.behind\s*(\+\+|\+=)/.test(text))
      .map((s) => s.file)
    expect(raisers).toEqual(['lib/session-record.ts'])
    // …and it is inside the off-tail branch, which only a live event reaches.
    const record = sources.find(({ file }) => file === 'lib/session-record.ts')!.text
    const raise = record.indexOf('.behind += 1')
    // ⚠️ Without this, a `-1` from a renamed increment turns the slice below into the WHOLE file,
    // which contains `liveDisposition` several times over and passes about nothing.
    expect(
      raise,
      'the increment was renamed and this assertion stopped having a subject',
    ).toBeGreaterThan(-1)
    expect(record.slice(raise - 300, raise)).toContain('liveDisposition')
  })
})

const HERE = fileURLToPath(new URL('.', import.meta.url))
const RENDERER = join(HERE, '../src/renderer/src')

/** Every `.vue` under the renderer, recursively — not one flat directory. */
function vueFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) found.push(...vueFiles(full))
    else if (entry.name.endsWith('.vue')) found.push(full)
  }
  return found
}

/**
 * The whole `<TranscriptView …>` opening tag, ending at the `>` that really closes it.
 *
 * ⛔ **A regex cannot do this and the first version of this file used one.** `/<TranscriptView\b[\s\S]*?\/?>/`
 * is lazy to the first `>` in the source — and a Vue tag is full of them, one per arrow function in
 * a handler. Measured on `ConversationPane.vue`: it stopped at `@decide="(id, decision) =>`, 788
 * characters in, and only kept working because `:jump-to-latest` happens to sit ABOVE the handlers.
 * ⚠️ **It failed OPEN**: a caller whose attribute order put an arrow first would drop out of the
 * offending list AND out of the roster, and the rule this file exists for would go quietly green
 * over a surface with no `:at-tail` — F3 restored, with the guard passing. Found by an adversarial
 * pass over this dispatch's own diff, not by the tests.
 *
 * So: walk the characters, remember which quote we are inside, and stop at the first `>` that is
 * outside one.
 */
function openingTagAt(source: string, start: number): string {
  let quote: string | null = null
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]!
    if (quote !== null) {
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') quote = char
    else if (char === '>') return source.slice(start, index + 1)
  }
  return source.slice(start)
}

/** Every `<TranscriptView …>` opening tag in the renderer, with the file it came from. */
function transcriptViewTags(): Array<{ file: string; tag: string }> {
  const tags: Array<{ file: string; tag: string }> = []
  for (const path of vueFiles(RENDERER)) {
    const source = readFileSync(path, 'utf8')
    for (const match of source.matchAll(/<TranscriptView\b/g))
      tags.push({
        file: path.slice(RENDERER.length + 1).replaceAll('\\', '/'),
        tag: openingTagAt(source, match.index),
      })
  }
  return tags
}

describe('the escape and the fact that gates it travel together (313, derived)', () => {
  it('⛔ every caller that offers `jump-to-latest` also passes `at-tail`', () => {
    const offending = transcriptViewTags()
      .filter(({ tag }) => tag.includes(':jump-to-latest') && !tag.includes(':at-tail'))
      .map(({ file }) => file)
    expect(
      offending,
      'this surface offers the way back to the tail and does not say whether the window has left ' +
        'it, so `atTail` falls to its default of `true` and the bar can never render — which is ' +
        'F3, one component over.',
    ).toEqual([])
  })

  it('⚑ and the scan is about something — it finds the caller and can tell the others apart (193)', () => {
    const tags = transcriptViewTags()
    // Non-vacuity: a scan that matched nothing would pass the rule above over an empty list.
    expect(tags.length).toBeGreaterThan(0)
    const offering = tags.filter(({ tag }) => tag.includes(':jump-to-latest'))
    expect(offering.map(({ file }) => file)).toContain('components/ConversationPane.vue')
    for (const { file, tag } of offering) {
      expect(tag, `${file} offers the escape without the fact that gates it`).toContain(':at-tail')
    }
    // ⛔ **The negative half, on a real file rather than on absence.** `ReadingPane` mounts the same
    // component and passes neither prop, so a scan that could not tell the two apart would report
    // every caller as compliant and this rule would be decoration.
    //
    // ⚠️ **And the reason is NOT "a recording has no tail" — that was wrong and an adversarial pass
    // over this dispatch's diff caught it.** `atTail` means *the window holds the newest RECORDED
    // event*, which a finished session has as much as a live one, and `ReadingPane` pages back
    // through the same `prependPage` — so a reading window can leave the tail exactly the way the
    // conversation window did. 🔴 **It has no escape at all**, because nothing hands it a
    // `jumpToLatest`: the store's is keyed to a live `SessionRecord` and a recording has none.
    // **313 leaves that surface as it found it and says so** — see the response's *Left open*. This
    // assertion pins today's shape so the day someone gives `ReadingPane` a way back, this rule
    // starts demanding `:at-tail` with it.
    const reading = tags.find(({ file }) => file === 'components/ReadingPane.vue')
    expect(reading, 'ReadingPane no longer mounts a transcript').toBeDefined()
    expect(reading?.tag).not.toContain(':jump-to-latest')
    // ⛔ **The whole tag, not the first `>`.** `@restore-queued` is the LAST attribute on
    // ConversationPane's mount and sits behind four arrow functions; the lazy regex this scan
    // replaced captured 788 characters and never reached it. If the walk regresses, this is what
    // says so — rather than the rule silently going green over a caller it can no longer see.
    const pane = tags.find(({ file }) => file === 'components/ConversationPane.vue')
    expect(pane?.tag.endsWith('>'), 'the tag scan stopped before the tag did').toBe(true)
    expect(pane?.tag, 'the tag scan truncated at an arrow function again').toContain(
      '@restore-queued',
    )
  })

  it('🔴 the view and the store gate on the SAME fact, which is the drift that caused F3 (169 §1)', () => {
    // One rule in two places drifts, and this is the pair it drifted between. The store guarded on
    // `atTail` and the view guarded on `behind` — both were defensible read alone, and together
    // they meant the only caller of `jumpToLatest` could never be reached.
    const view = readFileSync(join(RENDERER, 'components/TranscriptView.vue'), 'utf8')
    const at = view.indexOf('data-cy="transcript-behind"')
    expect(at, 'the bar is gone from the component entirely').toBeGreaterThan(-1)
    const guard = view.slice(0, at).lastIndexOf('v-if=')
    expect(guard, 'the bar is no longer gated on anything').toBeGreaterThan(-1)
    const condition = view.slice(guard, at)
    expect(condition, 'the bar is gated on something other than the tail again').toContain('atTail')

    const store = readFileSync(join(HERE, '../src/renderer/src/lib/session-store.ts'), 'utf8')
    const jump = store.slice(store.indexOf('async jumpToLatest('))
    expect(jump.slice(0, 400), 'the store stopped guarding on the tail').toContain('atTail')
  })
})
