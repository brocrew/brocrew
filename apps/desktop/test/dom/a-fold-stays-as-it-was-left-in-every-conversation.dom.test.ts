import { foldStorage } from './fold-storage-fixture'
import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import type { RuntimeEvent } from '@brobot2/runtime'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { screenFacts } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { applyEvent, createTranscript } from '../../src/renderer/src/lib/transcript'
import type { KeptFile } from '../../src/shared/runtime-ipc'
import { META, drawerProps, mount, unmountAll, visible, type Mounted } from './harness'

/**
 * The Agent panel's four folds: Current task, Files, the still-running block and the scheduled-jobs
 * block. Each keeps the state a person left it in when the panel shows another conversation, and
 * when the panel is drawn again. The still-running block's own fold is checked here too.
 */

const storage = foldStorage()

const OTHER = 'sess_another_conversation'

const fileOf = (conversation: string): KeptFile => ({
  resourceId: `res_${conversation}`,
  title: 'Results',
  name: 'results.md',
  form: 'markdown',
  bytes: 2_048,
  role: 'made',
  keptAt: new Date(2026, 8, 30, 19, 30).getTime(),
  sha256: 'a'.repeat(64),
  addedBy: { conversation, name: 'Ali', identity: 'ali' },
  piece: 'work_3',
  label: 'W1.3',
  pieceTitle: 'Test the tree after the reset',
})

/** A conversation with one thing still running and one job scheduled. */
function busy(id: string) {
  const state = createTranscript()
  applyEvent(state, {
    type: 'background_work',
    running: [{ id: `bg_${id}`, kind: 'local_bash', description: 'the long build' }],
    source: 'background_tasks_changed',
  } as RuntimeEvent)
  applyEvent(state, {
    type: 'scheduled_work',
    jobs: [{ id: `job_${id}`, schedule: '17 12 7 10 *', recurring: false, prompt: 'check it' }],
    source: 'hook/Stop',
  } as RuntimeEvent)
  return state
}

function filesFor(conversation: string): void {
  screenFacts().update({
    cardFiles: {
      conversation,
      files: [fileOf(conversation)],
      answered: true,
    },
  })
}

/** The panel on one conversation, with a way to show it another. */
function panel(): { m: Mounted; show: (conversation: string) => Promise<void> } {
  const shown = ref(META.sessionId)
  filesFor(META.sessionId)
  const Host = defineComponent({
    name: 'PanelAcrossConversations',
    setup: () => () =>
      h(
        SessionDrawer as never,
        drawerProps({
          session: { ...META, sessionId: shown.value },
          state: busy(shown.value),
          canOpenDocument: true,
          canStopBackgroundWork: true,
        }),
      ),
  })
  const m = mount(Host, {}, { width: 560, height: 1200 })
  return {
    m,
    show: async (conversation) => {
      filesFor(conversation)
      shown.value = conversation
      await nextTick()
      await nextTick()
    },
  }
}

/** Each fold: its heading button, and something it hides. */
const FOLDS = [
  {
    name: 'Current task',
    button: (m: Mounted) => m.q('card-task').querySelector<HTMLElement>('.head > button')!,
    key: 'brobot2.cardTaskFolded',
  },
  {
    name: 'Files',
    button: (m: Mounted) => m.q('card-files').querySelector<HTMLElement>('.head > button')!,
    key: 'brobot2.cardFilesFolded',
  },
] as const

const open = (m: Mounted): boolean[] =>
  FOLDS.map((fold) => fold.button(m).getAttribute('aria-expanded') === 'true')

describe('a fold stays as it was left, in every conversation', () => {
  it('🔴 each card fold, turned in one conversation, stays turned in another', async () => {
    const { m, show } = panel()
    await nextTick()
    // The two sections start open, and the two blocks start folded.
    expect(open(m)).toEqual([true, true])
    for (const fold of FOLDS) fold.button(m).click()
    await nextTick()
    expect(open(m)).toEqual([false, false])

    await show(OTHER)
    // The panel really is on the other conversation: its rows are that one's.
    expect(m.all(`panel-run-background:bg_${OTHER}`)).toHaveLength(1)
    expect(m.all(`schedule-open-job_${OTHER}`)).toHaveLength(1)
    expect(open(m)).toEqual([false, false])
    expect(visible(m.q(`panel-run-background:bg_${OTHER}`))).toBe(true)
    expect(visible(m.q(`schedule-open-job_${OTHER}`))).toBe(true)
  })

  it('🔴 …and after the panel is drawn again, each is as it was left', async () => {
    const first = panel()
    await nextTick()
    // A section folded and a block opened, the other two left as they start.
    FOLDS[0].button(first.m).click()
    await nextTick()
    expect(storage().getItem(FOLDS[0].key)).toBe('true')
    expect(storage().getItem(FOLDS[1].key)).toBeNull()
    unmountAll()

    const again = panel()
    await nextTick()
    expect(open(again.m)).toEqual([false, true])
    await again.show(OTHER)
    expect(open(again.m)).toEqual([false, true])
  })

  it('⚑ one key for each fold, shared by every conversation', () => {
    expect(new Set(FOLDS.map((fold) => fold.key)).size).toBe(FOLDS.length)
    for (const fold of FOLDS) expect(fold.key).not.toContain('sess_')
  })
})
