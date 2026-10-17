import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ToolAnswerViewer from '../src/renderer/src/components/ToolAnswerViewer.vue'
import ToolEntry from '../src/renderer/src/components/ToolEntry.vue'
import {
  ANSWER_NOT_HELD,
  answerAbsence,
  asPrettyJson,
  partDroppedNote,
  partHeading,
  partSizeNote,
  partsDroppedNote,
  rawAnswer,
} from '../src/renderer/src/lib/tool-answer'
import type { ToolAnswer } from '../src/shared/runtime-ipc'

/**
 * 🔴 **462 · the answer a person can actually read** — `457`'s finding 1, which it named and handed
 * over: *"the structured half of a tool answer is durable nowhere and has no surface."*
 *
 * ## ⛔ What is pinned here, and why each part is
 *
 * §1 **the four silences**, each its own sentence, because `074`'s rule is that saying nothing
 *    arrived is a different fact from saying what did — and one of the four is the HOLE this whole
 *    surface sits inside (a replayed conversation holds nothing).
 * §2 the reading: how a part is named, what gets indented and what deliberately does not.
 * §3 the panel, rendered — every claim in §1 and §2 reaching a screen.
 * §4 **the row's two states**, which are the door and the gap drawn where the door would be.
 * §5 a source census over what this surface must NOT have grown.
 *
 * ⚠️ **SSR, so every negative is paired with a positive in the same assertion**
 * (`brobot2-ssr-tests-pass-vacuously`): a `not.toContain` against a query that silently found
 * nothing is a test that passes when the component fails to render at all.
 */

const here = dirname(fileURLToPath(import.meta.url))
const VIEWER = join(here, '../src/renderer/src/components/ToolAnswerViewer.vue')
const LIB = join(here, '../src/renderer/src/lib/tool-answer.ts')

/**
 * ⚑ **The SHAPE `agent-tools.ts` builds, not a toy one** — the fields `448` put on a report and the
 * covers-sentence `447` made it carry. ⚠️ **Not a live call**: nothing in `ci` runs the real tool,
 * and the size that matters is `457`'s measurement, which `the-answer-a-person-can-read.dom.test.ts`
 * asserts against. This is here so every assertion below is about the thing a person is trying to
 * read rather than about three keys.
 */
const PROJECTS_PAYLOAD = {
  outcome: 'ok',
  count: 6,
  reach: 'any',
  count_covers: 'every project this app has',
  projects: Array.from({ length: 6 }, (_, i) => ({
    project: `project-${i + 1}`,
    display_name: `Project ${i + 1}`,
    running: [{ session: `sess_${i}`, agent: 'project-manager', state: 'idle' }],
    open_work: [{ task: `t_${i}`, asked: 'ship the thing', since: '2026-09-14T10:00:00.000Z' }],
    finished_work: [],
    counts: { running: 1, open: 1, finished: 0 },
    not_recorded: ['what each conversation is actually doing right now'],
  })),
}

const ANSWER: ToolAnswer = {
  parts: [
    {
      text: 'Six projects, and you may send work into all of them. Each report carries what it cannot answer — read that before summarising it.',
      dropped: 0,
    },
    { text: JSON.stringify(PROJECTS_PAYLOAD), dropped: 0 },
  ],
  partsDropped: 0,
}

async function panel(
  over: Partial<{ answer: ToolAnswer | null; canAsk: boolean }> = {},
): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(ToolAnswerViewer, {
          name: 'mcp__brobot__list_projects',
          answer: over.answer === undefined ? ANSWER : over.answer,
          canAsk: over.canAsk ?? true,
        }),
    }),
  )
}

async function row(canReadAnswer: boolean, withResult = true): Promise<string> {
  return renderToString(
    createSSRApp({
      render: () =>
        h(ToolEntry, {
          item: {
            kind: 'tool' as const,
            id: 'i1',
            callId: 'toolu_462',
            name: 'mcp__brobot__list_projects',
            summary: '{}',
            at: 1,
            result: withResult ? { summary: 'Six projects, and you may…', ok: true } : null,
          },
          canReadAnswer,
        }),
    }),
  )
}

/* ------------------------------------------------------------------- §1 · four silences, four sentences */

describe('§1 · the four silences are four different facts (074)', () => {
  /**
   * ⚑ **D-017b · re-aimed, not stripped.** It said *"This conversation is not running, so nothing it
   * was told is still held…"* — a process fact (`05` rule 5) the window no longer states. ⛔ The
   * claim is unchanged: the panel that cannot be asked says so, in its own sentence, and says what
   * is kept — now as *what the tool said is no longer held; only its row is kept*.
   */
  it('🔴 a conversation that is not running says SO — the hole this surface sits inside', () => {
    const said = answerAbsence(ANSWER, false)
    expect(said).toContain('no longer held')
    // ⚑ **It says what is kept**, because *"nothing here"* is a state a person would read as a bug
    // in the panel rather than as a property of the app.
    expect(said).toContain('only its row is kept')
    // ⛔ …and no process fact: whether anything runs is not the panel's to say.
    expect(said).not.toMatch(/running|reopen/)
    // ⛔ The control: the SAME answer, with the conversation live, is not a silence at all.
    expect(answerAbsence(ANSWER, true)).toBeNull()
    // 🔴 **And the pairing a replay ACTUALLY produces, which the line above does not reach.** A
    // conversation with no handle answers `null` to every read, so `(null, false)` is the ONLY
    // combination a reopened conversation ever shows — and *this app is not holding it* would be a
    // true sentence in the wrong voice for a person who has reopened a conversation on purpose.
    // ⚠️ Found by this dispatch's own mutation run: the order of these two arms survived, because
    // every case the suite drove had an answer in it.
    expect(answerAbsence(null, false)).toContain('no longer held')
    expect(answerAbsence(null, false)).not.toContain('not holding')
  })

  it('⛔ "not holding it" and "it carried no words" are different sentences', () => {
    const missing = answerAbsence(null, true)
    const wordless = answerAbsence({ parts: [], partsDropped: 0 }, true)
    expect(missing).toContain('not holding')
    expect(wordless).toContain('carried no words')
    expect(missing).not.toBe(wordless)
  })

  it('⚠️ the ROW’s sentence names no number, so it cannot outlive the bound it is about', () => {
    expect(ANSWER_NOT_HELD).toContain('short form')
    // ⛔ **No digits at all.** `458`'s rule: a number whose derivation lives in another package is a
    // number that goes quietly wrong — and a value import from `@brobot2/runtime` to print it costs
    // the renderer 135 kB. The positive control is that the sentence still says the useful half.
    expect(/\d/.test(ANSWER_NOT_HELD)).toBe(false)
    // ⚑ **D-017b · the useful half is now the whole of it**: it went on *"…held only while a
    // conversation is running, and this one is not"*, a process fact the window no longer states.
    expect(ANSWER_NOT_HELD).toContain('what the tool answered')
    expect(ANSWER_NOT_HELD).not.toContain('running')
  })
})

/* -------------------------------------------------------------------------- §2 · reading the parts */

describe('§2 · what a part is called, and what gets indented', () => {
  it('🔴 the FIRST part is what it said, whatever the characters look like', () => {
    expect(partHeading(0, 1)).toBe('What it said')
    expect(partHeading(0, 2)).toBe('What it said')
    expect(partHeading(1, 2)).toBe('What it sent with it')
    // ⚠️ Numbered only when there is more than one of them, so the two-part case — which is every
    // shape this app builds — reads as a pair rather than as *1 of 1*.
    expect(partHeading(1, 4)).toBe('What it sent with it (1 of 3)')
    expect(partHeading(3, 4)).toBe('What it sent with it (3 of 3)')
  })

  it('⛔ a JSON object is indented; a sentence, a number and a bare string are NOT', () => {
    const pretty = asPrettyJson(JSON.stringify(PROJECTS_PAYLOAD))
    expect(pretty).not.toBeNull()
    expect(pretty).toContain('\n  "count": 6')
    // ⚑ **The whole argument for a panel, in one number**: one line becomes many, and many lines is
    // what *read a list and pick a row out of it* needs.
    expect((pretty ?? '').split('\n').length).toBeGreaterThan(40)
    // ⛔ The negatives, each of which would otherwise be "formatted" into exactly itself.
    expect(asPrettyJson('Six projects, and you may send work into all of them.')).toBeNull()
    expect(asPrettyJson('353')).toBeNull()
    expect(asPrettyJson('"a string"')).toBeNull()
    expect(asPrettyJson('null')).toBeNull()
    expect(asPrettyJson('{ not json')).toBeNull()
    // ⚑ …and an ARRAY is, because a list is the commonest thing a payload is.
    expect(asPrettyJson('[{"a":1}]')).toContain('\n  {')
  })

  it('⚠️ the Raw view is the parts, in order, and it claims nothing about a model', () => {
    expect(rawAnswer(ANSWER)).toBe(`${ANSWER.parts[0]!.text}\n${ANSWER.parts[1]!.text}`)
    expect(rawAnswer({ parts: [], partsDropped: 0 })).toBe('')
  })

  it('⛔ the cut notes count, and say which END is missing', () => {
    expect(partDroppedNote(1)).toBe('1 further character was not kept')
    expect(partDroppedNote(4312)).toContain('4,312')
    expect(partDroppedNote(4312)).toContain('further characters')
    expect(partsDroppedNote(1)).toContain('1 further part')
    expect(partsDroppedNote(3)).toContain('3 further parts')
  })

  it('🔴 the size note reports what ARRIVED, which is the number `457` needed a probe for', () => {
    // The payload in this file is a real one; the note is the measurement a person now gets free.
    expect(partSizeNote(ANSWER.parts[1]!)).toBe(
      `${ANSWER.parts[1]!.text.length.toLocaleString()} characters`,
    )
    // ⚠️ A cut part reports the WHOLE, not the kept half — a reader just told some is missing needs
    // the size of the thing it was cut from.
    expect(partSizeNote({ text: 'abc', dropped: 97 })).toBe('100 characters')
    expect(partSizeNote({ text: 'a', dropped: 0 })).toBe('1 character')
  })
})

/* ------------------------------------------------------------------------------- §3 · the panel */

describe('§3 · the panel draws both halves, on paper, with the raw one press away', () => {
  it('🔴 six projects are readable — the thing that is impossible on the row', async () => {
    const html = await panel()
    expect(html).toContain('tool-answer-viewer')
    expect(html).toContain('What it said')
    expect(html).toContain('What it sent with it')
    // ⚑ Every project line is there, which is precisely what the 200-character summary cuts.
    for (let i = 1; i <= 6; i += 1) expect(html, `project ${i}`).toContain(`project-${i}`)
    // …and it is INDENTED rather than one line.
    expect(html).toContain('&quot;count&quot;: 6')
    // ⛔ Paper, and the island attribute that keeps the ink readable on it (126).
    expect(html).toContain('data-on-white')
  })

  it('⚠️ the panel opens on Readable and the Raw segment is present but not chosen', async () => {
    const html = await panel()
    expect(html).toContain('data-view="readable"')
    // ⛔ Both buttons exist — a toggle with one arm is a label.
    expect(html).toContain('tool-answer-view-readable')
    expect(html).toContain('tool-answer-view-raw')
    // ⚠️ The pair: the raw BODY is not rendered while Readable is chosen, and the readable one is.
    expect(html).not.toContain('tool-answer-raw"')
    expect(html).toContain('tool-answer-body-0')
  })

  it('⛔ a replayed conversation gets the sentence and NO paper at all', async () => {
    const html = await panel({ canAsk: false })
    expect(html).toContain('tool-answer-absence')
    // ⚑ **D-017b · the sentence itself, whole** — it matched *not running*, and once the sentence
    // lost those words the match was a comment in the component's template that SSR keeps.
    expect(html).toContain(answerAbsence(ANSWER, false)!)
    // 🔴 **The pair that makes the negative mean something**: with the same props and `canAsk` on,
    // the paper is there — so an empty render could not pass this.
    expect(html).not.toContain('tool-answer-paper')
    expect(await panel({ canAsk: true })).toContain('tool-answer-paper')
  })

  it('⚠️ a held answer that carried no words says so, and is not the same screen as holding none', async () => {
    const wordless = await panel({ answer: { parts: [], partsDropped: 0 } })
    const missing = await panel({ answer: null })
    expect(wordless).toContain('carried no words')
    expect(missing).toContain('not holding')
    expect(wordless).not.toBe(missing)
  })

  it('🔴 a cut part says how much is gone, and an uncut one says nothing at all', async () => {
    const cut = await panel({
      answer: { parts: [{ text: 'the beginning', dropped: 4312 }], partsDropped: 2 },
    })
    expect(cut).toContain('tool-answer-dropped-0')
    expect(cut).toContain('4,312')
    expect(cut).toContain('tool-answer-parts-dropped')
    // ⛔ The control on the same two queries: the ordinary answer draws neither note.
    const whole = await panel()
    expect(whole).toContain('tool-answer-body-0')
    expect(whole).not.toContain('tool-answer-dropped-0')
    expect(whole).not.toContain('tool-answer-parts-dropped')
  })
})

/* --------------------------------------------------------------------------- §4 · the row's door */

describe('§4 · the row offers the door, or draws the gap where the door would be', () => {
  it('🔴 a live conversation gets the button', async () => {
    const html = await row(true)
    expect(html).toContain('tool-answer-open-i1')
    expect(html).toContain('Show the whole answer')
    // ⛔ The pair: the gap sentence is NOT also drawn, so a reader never meets both.
    expect(html).not.toContain('tool-answer-gone-i1')
  })

  it('⛔ a replay gets the SENTENCE, which is 462 §2.2’s instruction rather than a preference', async () => {
    const html = await row(false)
    expect(html).toContain('tool-answer-gone-i1')
    expect(html).toContain('short form')
    expect(html).not.toContain('tool-answer-open-i1')
  })

  it('⚠️ a call with no receipt gets neither — there is no answer to be missing yet', async () => {
    const html = await row(true, false)
    expect(html).not.toContain('tool-answer-open-i1')
    expect(html).not.toContain('tool-answer-gone-i1')
    // 🔴 **The positive that makes both negatives mean something**: the row itself rendered.
    expect(html).toContain('tool-entry')
    expect(html).toContain('mcp__brobot__list_projects')
  })
})

/* ------------------------------------------------------------------------- §5 · a source census */

describe('§5 · what this surface deliberately does not have', () => {
  it('⛔ the panel does not mount `DocumentBody`, and says why in the file that does not', () => {
    const source = readFileSync(VIEWER, 'utf8')
    expect(source).not.toContain("from './DocumentBody.vue'")
    // ⚑ The positive control: the reason is written down rather than left as an omission, and the
    // component really is the thing this census is reading.
    expect(source).toContain('markdown-rendering a JSON payload mangles')
    expect(source).toContain('data-cy="tool-answer-viewer"')
  })

  it('🔴 the renderer holds NO ceiling of its own — how much is kept is the adapter’s answer', () => {
    const source = readFileSync(LIB, 'utf8')
    for (const ceiling of ['MAX_TOOL_ANSWER_PART', 'MAX_TOOL_ANSWER_PARTS', 'MAX_TOOL_ANSWERS']) {
      expect(source, ceiling).not.toContain(ceiling)
    }
    // ⛔ **The control that stops this being a census of an empty file**: it DOES name the ceilings'
    // consequence, which is the thing a reader has to be told.
    expect(source).toContain('dropped')
    expect(source).toContain('export function answerAbsence')
  })

  it('⚠️ nothing in the panel branches on which PROVIDER this is (039)', () => {
    const source = readFileSync(VIEWER, 'utf8')
    for (const word of ["'claude'", "'codex'"]) expect(source, word).not.toContain(word)
    // The positive: the file does talk about providers — in a comment saying why it must not decide
    // anything from one.
    expect(source).toContain('a surface that draws both')
  })
})
