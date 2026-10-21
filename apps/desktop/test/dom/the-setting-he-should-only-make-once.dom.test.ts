import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
// ⚠️ The MODULE, not the barrel — `@brobot2/runtime`'s index pulls in `node:fs` and the whole file
// fails to import in the browser project.
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import StartAsAgent from '../../src/renderer/src/components/StartAsAgent.vue'
import { YOLO_MEANS } from '../../src/renderer/src/lib/approval-mode'
import { NO_LAUNCH_CHOICES, type LaunchChoices } from '../../src/renderer/src/lib/launch-choices'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { DEFAULT_PROFILE_ID, type CreateSessionInput } from '../../src/shared/runtime-ipc'
import { META, drawerProps, mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 The setting he should only ever make once — what a person SEES (500, `HO-036` §3.1)
 *
 * > ⛔ **"A person sets their approval mode once, and every conversation they start begins there."**
 *
 * ## ⛔ Why the renderer half is where the safety property lives
 *
 * 🔴 **The default is resolved ABOVE the IPC boundary and spent at the two doors a person presses.**
 * That placement is what keeps it out of reach of a spawn — a spawn never crosses IPC — and the
 * census that proves it is in the node half, `test/the-setting-he-should-only-make-once.test.ts` §3.
 * ⚑ **What a node test cannot do is mount a screen**, so the other half of the same claim is here:
 * the value a person set is what these doors put on the wire, and what they SAY before the press.
 *
 * ## ⚠️ Three states, because the third is real
 *
 * ⛔ **`null` is *the policy row has not been read yet* and it is not `ask`** — `086`'s rule, on the
 * one control where the wrong default is dangerous in both directions. ⚑ A LAUNCH must still carry
 * a word in that window and the word is `ask`; the CONTROL says the row is unread. Both halves are
 * asserted below, together, because either alone is a different claim.
 *
 * ## ⚑ And the bytes are shared, never paraphrased
 *
 * `367`'s disclosure is two halves — `YOLO_MEANS` and the ADAPTER's own per-provider note — and
 * `design-v2-map.ts` rules that a surface drawing one of them tells a person strictly less than the
 * running app already does. ⛔ **Both doors render both halves, from the same constants the drawer
 * renders**, which is `492`'s `ASKED_TO_STOP` shape: one claim, shared bytes, each surface keeping
 * its own subject.
 */

/** The frameless window minus its 32px bar, and minus the rail — the launcher's real box. */
const REAL = { width: 1200, height: 808 }
const PANE = { width: 1200 - 208, height: 808 }
const ORIGINAL = { width: 1200, height: 808 }

function installBridge(): void {
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      checkProviderAuth: () => Promise.resolve({ state: 'usable' }),
      projects: () => Promise.resolve([]),
    },
  }
}

/**
 * ⚠️ **The choices are held by a FRAME, not by the component** — which is where `RuntimeScreen`
 * holds them, and the shape `a-front-door-that-asks-nothing.dom.test.ts` established.
 */
function openFrontDoor(over: Record<string, unknown> = {}): {
  m: Mounted
  started: CreateSessionInput[]
  set: ('ask' | 'auto')[]
} {
  installBridge()
  const started: CreateSessionInput[] = []
  const set: ('ask' | 'auto')[] = []
  const words = ref('work through the ticket')
  const choices = ref<LaunchChoices>({ ...NO_LAUNCH_CHOICES })
  const book = createAttachmentBook()
  const Frame = defineComponent({
    name: 'FrontDoorFrame',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: false,
          error: null,
          debug: false,
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          defaultProvider: 'codex',
          defaultApprovalMode: 'ask',
          capabilities: allProviderCapabilities(),
          models: null,
          choices: choices.value,
          onStart: (input: CreateSessionInput) => started.push(input),
          'onUpdate:draft': (text: string) => (words.value = text),
          'onUpdate:choices': (next: LaunchChoices) => (choices.value = next),
          onSetApprovalDefault: (mode: 'ask' | 'auto') => set.push(mode),
          ...over,
        })
    },
  })
  return { m: mount(Frame, {}, PANE), started, set }
}

afterEach(async () => {
  unmountAll()
  delete (window as unknown as { api?: unknown }).api
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

// The launcher no longer edits the saved default. First-choice gating is covered in
// first-approval-choice.dom.test.ts; these checks retain saved-mode payload coverage.
describe('the saved mode reaches a new conversation', () => {
  it.each(['ask', 'auto'] as const)(
    'starts with the saved %s mode without another choice',
    async (mode) => {
      await page.viewport(REAL.width, REAL.height)
      const { m, started, set } = openFrontDoor({
        defaultApprovalMode: mode,
        approvalDefaultChosen: true,
      })
      await nextTick()
      expect(m.all('first-approval-choice')).toHaveLength(1)
      expect(m.q('choose-' + mode).getAttribute('aria-pressed')).toBe('true')
      ;(m.q('send-prompt') as HTMLButtonElement).click()
      await nextTick()
      expect(started[0]?.approvalMode).toBe(mode)
      expect(set).toEqual([])
    },
  )
})

describe('§2 · the second door a person starts a conversation from', () => {
  const openSheet = (over: Record<string, unknown> = {}): Mounted => {
    installBridge()
    return mount(
      StartAsAgent as Component,
      {
        profileSlug: 'archivist',
        provider: 'claude',
        defaultApprovalMode: 'ask',
        capabilities: allProviderCapabilities(),
        ...over,
      },
      PANE,
    )
  }

  /**
   * 🔴 **`HO-036` §3.1 says *every conversation they start*, and this is the other door they start
   * one from.** ⛔ A sheet that kept sending `'ask'` would make the setting a property of one
   * screen rather than of the person — which is the re-scoping `app_policy`'s own docblock refuses.
   */
  it('🔴 it launches in the mode the person set, in all three states', async () => {
    await page.viewport(REAL.width, REAL.height)
    for (const [set, sent] of [
      ['ask', 'ask'],
      ['auto', 'auto'],
      [null, 'ask'],
    ] as const) {
      const started: CreateSessionInput[] = []
      // ⚠️ **Re-installed per iteration**, because `afterEach` deletes it and this loop mounts the
      // sheet itself rather than going through `openSheet`. `useProjectStore` reaches `window.api`
      // on setup, so a missing bridge is a mount error rather than an empty list.
      installBridge()
      const m = mount(
        StartAsAgent as Component,
        {
          profileSlug: 'archivist',
          provider: 'claude',
          defaultApprovalMode: set,
          capabilities: allProviderCapabilities(),
          onStart: (input: CreateSessionInput) => started.push(input),
        },
        PANE,
      )
      await nextTick()
      const box = m.q('prompt-input') as HTMLTextAreaElement
      box.value = 'start the work'
      box.dispatchEvent(new Event('input', { bubbles: true }))
      await nextTick()
      ;(m.q('send-prompt') as HTMLButtonElement).click()
      await nextTick()
      expect(started, JSON.stringify(set)).toHaveLength(1)
      expect(started[0]?.approvalMode, JSON.stringify(set)).toBe(sent)
      // ⚑ **And it is still the OTHER door** — the identity it was opened for, never BroBot's.
      expect(started[0]?.profileId).toBe('archivist')
      expect(started[0]?.profileId).not.toBe(DEFAULT_PROFILE_ID)
      m.unmount()
    }
  })

  /**
   * ⛔ **A door that can begin unattended and says nothing is the gap `367` closed at the other two.**
   * ⚑ It carries no CONTROL — the setting is set once, at the front door — and a second place to
   * press it would be two answers to one question.
   */
  it('⛔ it discloses yolo when it will launch in it, in the same bytes, and offers no control', async () => {
    await page.viewport(REAL.width, REAL.height)
    const asking = openSheet()
    await nextTick()
    // ⚑ The paired positive: the sheet really rendered, so the absence below is about the mode.
    expect(visible(asking.q('start-as-agent-title'))).toBe(true)
    expect(asking.host.querySelector('[data-cy="yolo-means"]')).toBeNull()
    asking.unmount()

    const yolo = openSheet({ defaultApprovalMode: 'auto' })
    await nextTick()
    expect(yolo.q('yolo-means').textContent ?? '').toContain(YOLO_MEANS)
    const claude = allProviderCapabilities().claude.approvals
    expect(claude.state).toBe('available')
    expect(yolo.q('yolo-reach').textContent?.trim()).toBe(
      claude.state === 'available' ? claude.note : '',
    )
    // ⛔ **No control, and no per-launch checkbox.**
    expect(yolo.host.querySelector('[data-cy="launch-approval-mode"]')).toBeNull()
    expect(yolo.host.querySelector('[data-cy="auto-approve"]')).toBeNull()
  })

  /**
   * 🔴 **The reach is the PROVIDER's, indexed and never recognised** (039). ⛔ This sheet runs on
   * whatever identity it was opened for, and a note fixed to one provider would be the drift
   * `a-mode-that-says-what-it-does.test.ts` §1 exists to catch, one surface further out.
   */
  it('🔴 the second half follows the provider the sheet was opened for', async () => {
    await page.viewport(REAL.width, REAL.height)
    const notes = new Set<string>()
    for (const provider of ['claude', 'codex'] as const) {
      const m = openSheet({ provider, defaultApprovalMode: 'auto' })
      await nextTick()
      notes.add(m.q('yolo-reach').textContent?.trim() ?? '')
      m.unmount()
    }
    // ⚠️ **Two providers, two different sentences** — `a-mode-that-says-what-it-does.test.ts` §1's
    // distinctness check, read off a rendered screen instead of off the capability map.
    expect(notes.size).toBe(2)
    expect([...notes].every((note) => note.length > 60)).toBe(true)
  })
})

describe('§3 · the sentence the host already composed, and nothing was holding it to a screen', () => {
  /**
   * 🔴 **`500`'s brief believed nothing rendered this. It does — and nothing was PINNING it.**
   *
   * ⛔ `runtime-host.ts`'s `approvalDisclosure` composes
   * `` `${note} · ${requested === 'auto' ? YOLO_LABEL : 'ask'} from your next message` ``, and the
   * agent card's approval mode draws it in the panel its face opens; beside the plate, the mode now
   * and the mode next are said in the card's own line. ⚑ **So the repair is this assertion.**
   *
   * ⛔ `an-assertion-can-be-satisfied-by-a-neighbouring-element` — so each reading is taken off
   * its own element: the line under the plate, the face, and the panel's note.
   */
  it('🔴 a pending mode change reaches what a person is looking at', async () => {
    await page.viewport(REAL.width, REAL.height)
    const m = mount(
      SessionDrawer as Component,
      drawerProps({
        session: {
          ...META,
          approvalMode: 'ask',
          pendingApprovalMode: 'auto',
          approvalNote: 'approvals: Ask · Auto from your next message',
        },
        capabilities: allProviderCapabilities(),
      }),
      PANE,
    )
    await nextTick()
    // The approved 0.1.3 control shows the choice now and names it as pending in plain words.
    expect(m.q('card-approval-pending').textContent?.trim()).toBe(
      'Auto starts with your next message.',
    )
    expect(visible(m.q('card-approval-pending'))).toBe(true)
    const face = m.q('card-approval')
    expect((face as HTMLInputElement).checked).toBe(true)
    expect(face.dataset.pending).toBe('auto')
    expect(face.closest('label')?.title).toContain('next message')
    // ⚑ **The control for the reading**: with nothing pending, there is no line under the plate,
    // and the face carries no pending mode — so the assertions above are about the pending half.
    m.unmount()
    const settled = mount(
      SessionDrawer as Component,
      drawerProps({
        session: {
          ...META,
          approvalMode: 'ask',
          pendingApprovalMode: null,
          approvalNote: 'approvals: Ask',
        },
        capabilities: allProviderCapabilities(),
      }),
      PANE,
    )
    await nextTick()
    expect(settled.all('card-approval-pending')).toHaveLength(0)
    expect((settled.q('card-approval') as HTMLInputElement).checked).toBe(false)
    expect(settled.q('card-approval').dataset.pending).toBe('')
  })
})
