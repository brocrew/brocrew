import type { TranscriptEvent } from '../src/shared/conversation-events'
import type { WorkReport } from '../src/shared/task-contracts'
import { describe, expect, it } from 'vitest'
import { workAnswered, workUndriven } from '../src/main/runtime/reply-rails'
import { PANEL_EMPTY_WORDS } from '../src/renderer/src/lib/session-panel'
import { OPEN_THE_CONVERSATION } from '../src/renderer/src/lib/taking-over'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../src/renderer/src/lib/transcript'
import { workIsWith } from '../src/renderer/src/lib/where-the-work-is'

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
  })
})
