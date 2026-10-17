import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { workAnswered, workUndriven } from '../src/main/runtime/reply-rails'
import { PANEL_EMPTY_WORDS } from '../src/renderer/src/lib/session-panel'
import { OPEN_THE_CONVERSATION } from '../src/renderer/src/lib/taking-over'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { workIsWith } from '../src/renderer/src/lib/where-the-work-is'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import type { WorkReport } from '../src/shared/tasks'

/**
 * 🔴 **A report that names a conversation, and can take you there** (506).
 *
 * A task completion or report includes a link to the conversation where the task runs.
 *
 * ## ⛔ What this file is actually pinning
 *
 * ⚠️ **The row he was reading names two session ids in its PROSE** — `undrivenWorkText` writes
 * *"Task #5 (task_…) with sess_A is not being worked on: the turn it was running in was stopped,
 * by sess_B."* (a piece's label and id since D-016) — and `work-report.ts`'s standing rule is
 * *"Nothing here is computed from the words"*. ⛔ So §3 below is the load-bearing section: it
 * plants a report whose FIELD and whose SENTENCE name different conversations and reads which one
 * the control carries.
 *
 * ⚑ **D-017b · one press, whatever the conversation is doing** — `taking-over.ts`'s
 * `OPEN_THE_CONVERSATION`, the words every surface that opens a conversation reads. `held` is
 * still carried, for `data-held`, and no longer forks the words.
 *
 * ⚑ **D-016 · a task is a PIECE** — the report's `assignedTo` is its `owner`, and a piece reads by
 * its label (`W1.5`), never *Task #5*.
 */

const SRC = (path: string): string => readFileSync(resolve(import.meta.dirname, '..', path), 'utf8')

const LIB = 'src/renderer/src/lib/where-the-work-is.ts'
const VIEW = 'src/renderer/src/components/TranscriptView.vue'
const SCREEN = 'src/renderer/src/components/RuntimeScreen.vue'

const report = (over: Partial<WorkReport> = {}): WorkReport => ({
  piece: 'work_1',
  label: 'W1.5',
  owner: 'sess_child',
  state: 'answered',
  outcome: 'done',
  ...over,
})

/** The piece row shape the two constructors are handed — a `Pick`, exactly as the host passes it. */
const row = { piece: 'work_1', label: 'W1.5', owner: 'sess_child' }

function fold(...events: TranscriptEvent[]): TranscriptState {
  const state = createTranscript()
  for (const event of events) applyEvent(state, event)
  return state
}

/** The work-report item a fold left behind, or `undefined`. */
function reportItem(state: TranscriptState): { report: WorkReport; text: string } | undefined {
  const found = state.items.find((item) => item.kind === 'workReport')
  return found?.kind === 'workReport' ? { report: found.report, text: found.text } : undefined
}

describe('506 · a report that names a conversation, and will not take you there', () => {
  describe('§1 · the conversation is a FACT on both halves, not a word in one sentence', () => {
    it('🔴 both constructors copy it off the row, and neither re-derives it', () => {
      expect(workAnswered(row, { outcome: 'done', needsUserAction: false }, []).owner).toBe(
        'sess_child',
      )
      expect(workUndriven(row, 'turn_interrupted').owner).toBe('sess_child')
      // ⚑ **Copied, and the control is a row whose id is something else**: a constructor that
      // spelled its own would pass the two assertions above against any fixture.
      expect(workUndriven({ ...row, owner: 'sess_other' }, 'turn_ended').owner).toBe('sess_other')
    })

    it('⛔ the fold carries it onto the item, because the report is copied whole', () => {
      const state = fold({
        type: 'user_turn',
        text: 'W1.5 (work_1) was answered by sess_child: done.',
        attribution: 'app_authored',
        work: report(),
      } as TranscriptEvent)
      expect(reportItem(state)?.report.owner).toBe('sess_child')
    })
  })

  describe('§2 · what the row may offer, and the two absences that are not refusals', () => {
    const held = (...ids: string[]): ReadonlySet<string> => new Set(ids)

    it('🔴 held by this window · the words are *Open the conversation* and they are IMPORTED', () => {
      const where = workIsWith(report(), held('sess_child'))
      expect(where).toEqual({
        conversation: 'sess_child',
        held: true,
        action: OPEN_THE_CONVERSATION,
      })
      // ⚠️ **Asserted against the shared constant rather than against a string**, so a dispatch
      // that rewords `taking-over.ts` moves this surface with the others instead of leaving it
      // saying yesterday's sentence — `169` §1, which is the whole reason that file exists.
      expect(where?.action).toBe('Open the conversation')
    })

    it('🔴 not held · D-017b — the SAME one press, and `held` still says this window does not hold it', () => {
      const where = workIsWith(report(), held('sess_someone-else'))
      expect(where).toEqual({
        conversation: 'sess_child',
        held: false,
        action: OPEN_THE_CONVERSATION,
      })
      // ⛔ The take-over's words are gone (D-017b): the press opens the conversation whoever runs it.
      expect(where?.action).not.toBe('Take it over and open it')
    })

    it('⛔ a report written before 506 offers nothing — and it is not *nobody is doing it*', () => {
      const old = report()
      delete (old as { owner?: string }).owner
      expect(workIsWith(old, held('sess_child'))).toBeNull()
      // ⚑ **The paired positive from the same fixture**, so the null above is the missing FIELD
      // and not a lib that returns null for everything.
      expect(workIsWith(report(), held('sess_child'))).not.toBeNull()
      // ⚠️ An empty string is bytes a `.brobot` bundle can carry — `toPersistedEvents` casts —
      // and *"go to the conversation called nothing"* is not a control.
      expect(workIsWith(report({ owner: '' }), held())).toBeNull()
    })

    it('⛔ a surface with no runtime offers nothing, and that is `106` rather than a default', () => {
      // ⚠️ `ReadingPane` and `ChildWorkViewer` render this same entry over a recording and pass
      // no held set; a press there would reach nothing at all.
      expect(workIsWith(report(), null)).toBeNull()
      // ⚑ The paired positive: the same report, from a surface that DOES know.
      expect(workIsWith(report(), held())?.held).toBe(false)
    })

    it('⚠️ an EMPTY set is a different claim from an ABSENT one, and it draws the press', () => {
      // ⛔ A window that genuinely holds nothing is not a window that cannot answer the question.
      // Folding the two into one would put the press on every row of the read-only pane.
      expect(workIsWith(report(), new Set())?.action).toBe(OPEN_THE_CONVERSATION)
      expect(workIsWith(report(), null)).toBeNull()
    })
  })

  describe('§3 · derived from the REPORT, and never from the sentence beside it', () => {
    it('🔴 the field and the prose name different conversations — the control follows the field', () => {
      // ⛔ **The plant.** `work-report.ts`: *"Nothing here is computed from the words … a renderer
      // that read the outcome out of the prose would be a second reading of a fold it cannot
      // see."* This is that rule made falsifiable: a control parsed out of the body would carry
      // `sess_in_the_prose`, which is the only id the body contains.
      const state = fold({
        type: 'user_turn',
        text: 'W1.5 (work_1) with sess_in_the_prose is not being worked on: the turn it was running in was stopped, by sess_who_stopped_it.',
        attribution: 'app_authored',
        work: report({ state: 'stalled', stalledBecause: 'turn_interrupted', outcome: undefined }),
      } as TranscriptEvent)
      const item = reportItem(state)
      expect(item?.text).toContain('sess_in_the_prose')
      expect(item?.text).toContain('sess_who_stopped_it')
      expect(workIsWith(item?.report ?? report(), new Set())?.conversation).toBe('sess_child')
    })

    it('⛔ …and a body FULL of session ids offers nothing when the field is absent', () => {
      const old = report({ state: 'stalled', stalledBecause: 'turn_interrupted' })
      delete (old as { owner?: string }).owner
      const state = fold({
        type: 'user_turn',
        text: 'W1.5 (work_1) with sess_a is not being worked on: the turn it was running in was stopped, by sess_b.',
        attribution: 'app_authored',
        work: old,
      } as TranscriptEvent)
      expect(reportItem(state)?.text).toContain('sess_a')
      expect(workIsWith(reportItem(state)?.report ?? old, new Set())).toBeNull()
    })
  })

  describe('§4 · the press is emitted, and the door is the one every surface uses', () => {
    it('⛔ the lib spells no sentence — it asks `taking-over.ts` for the one press', () => {
      const source = SRC(LIB)
      expect(source).toContain("from './taking-over'")
      expect(source).toContain('action: OPEN_THE_CONVERSATION')
      // ⚠️ **The negative, with the positive above making it mean something**: a copy of the words
      // here is how two surfaces come to name one gesture differently.
      expect(source).not.toContain("'Take it over and open it'")
      expect(source.includes("action: 'Open the conversation'")).toBe(false)
    })

    it('🔴 the transcript RAISES it and performs nothing — the look lives in `RuntimeScreen`', () => {
      const view = SRC(VIEW)
      // ⚑ UI-011 · the press may also name the piece whose brief the opened conversation shows.
      expect(view).toContain('openConversation: [sessionId: string, briefOf?: string]')
      // ⛔ **No door in the view.** A transcript that claimed or looked would be a second route into
      // the routing `095` spent a dispatch collecting into one place.
      expect(view).not.toContain('store.claim')
      expect(view).not.toContain('store.look')
      // ⚑ The positive control for that negative: the screen is where the door is, and it is the
      // one every press that opens a conversation goes through (D-017b).
      const screen = SRC(SCREEN)
      expect(screen).toContain('async function goToTheWork(')
      expect(screen).toContain('await openConversation(sessionId)')
      expect(screen).toContain('await store.look(sessionId)')
      expect(screen).toContain('@open-conversation="goToTheWork"')
    })

    it('⚠️ `from` is read BEFORE the look, which is the rule the queue paid for', () => {
      // ⛔ **Both ends of the slice are asserted PRESENT before anything is compared, and that is
      // not belt-and-braces — it is the row that survived.** `indexOf` answers `-1` for a string
      // that is gone, `-1` is less than every real offset, and the first version of this read
      // *"the missing line comes first"* as *"the ordering is right"*. ⚑ The mutation that moves
      // `view()` past the await deletes `const from = view()` outright, so the only assertion
      // that can see it is one that asks whether the line is there at all.
      // ⚑ **D-017b · the door is `openConversation`**, which `goToTheWork` calls — so its body is read.
      const screen = SRC(SCREEN)
      const at = screen.indexOf('async function openConversation(')
      expect(at).toBeGreaterThan(-1)
      const body = screen.slice(at, screen.indexOf('\n}\n', at))
      expect(body).toContain('const from = view()')
      expect(body).toContain('await store.look(sessionId)')
      expect(body).toContain('showConversation(opened, from)')
      expect(body.indexOf('const from = view()')).toBeLessThan(body.indexOf('await store.look'))
    })

    it('⛔ the two transcripts with no runtime behind them pass no held set', () => {
      // ⚑ Derived from the mounts rather than asserted about them: the control is absent on a
      // recording because nothing hands it the fact it needs, not because a flag says so.
      for (const mount of [
        'src/renderer/src/components/ReadingPane.vue',
        'src/renderer/src/components/ChildWorkViewer.vue',
      ]) {
        expect(SRC(mount)).not.toContain(':held=')
      }
      // ⚠️ The paired positive: the one pane with a live conversation behind it does hand it over.
      expect(SRC('src/renderer/src/components/ConversationPane.vue')).toContain(
        ':held="props.held"',
      )
    })
  })

  describe('§5 · the panel promised *agents* and meant sub-agents', () => {
    it('🔴 the empty paragraph names the population the band actually lists', () => {
      // ⚑ **Lowercased since `577`, because the noun became sentence-initial** — three of the five
      // nouns moved up into the heading, so `sub-agents` is now the paragraph's first word. The
      // claim is unchanged; only its position in the sentence is.
      const body = PANEL_EMPTY_WORDS.quiet.body.toLowerCase()
      expect(body).toContain('running sub-agents')
      // ⛔ **The discriminator, and it is not the same assertion twice**: the old sentence said
      // `running agents`, which a person reads as *the agents I started* while the app's own
      // roster of them — a different population — is one press away. ⚠️ It was the left rail's
      // AGENTS section until `EXT-008` §4.4 moved that list to the Team page at `570`; the word
      // collision the sentence fixes is unchanged.
      expect(body).not.toContain('running agents')
      // ⚑ **Every noun in the pointer clause is still there, and `577` spread it over two lines.**
      // ⛔ Read as ONE paragraph on purpose: the heading names what the column COUNTS (two since
      // D-016 took the proposals out) and the body names the two it merely lists, so an assertion
      // against the body alone would pass over a sentence that had silently dropped a heading noun.
      const paragraph =
        `${PANEL_EMPTY_WORDS.quiet.head} ${PANEL_EMPTY_WORDS.quiet.body}`.toLowerCase()
      for (const named of ['questions', 'permissions', 'the checklist']) {
        expect(paragraph).toContain(named)
      }
    })

    it('⛔ the band’s heading says the same word as its own untitled rows', () => {
      // ⚑ The sections are the agent card's since the panel's top agent became `AgentCard`.
      const panel = SRC('src/renderer/src/components/AgentCard.vue')
      expect(panel).toContain("label: 'Sub-agents'")
      // ⚠️ **The HOOK is untouched**, which is the half a rename usually breaks: the render tests,
      // the live smoke and `tab-flow.mjs` all address this band by `panel-agents`.
      expect(panel).toContain("cy: 'panel-agents'")
      expect(SRC('src/renderer/src/lib/session-panel.ts')).toContain("card.kind ?? 'sub-agent'")
    })
  })
})
