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
import {
  LAUNCH_APPROVAL_BOUND,
  LAUNCH_APPROVAL_GOVERNS,
  launchApprovalView,
} from '../../src/renderer/src/lib/front-door-words'
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

describe('§1 · the control, and the three states it can be in', () => {
  it('⚑ it says what new conversations do, and what the press would do', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m } = openFrontDoor()
    await nextTick()
    const button = m.q('launch-approval-mode')
    expect(visible(button)).toBe(true)
    expect(button.dataset.mode).toBe('ask')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    // ⛔ **The derivation's own words, not a second copy typed into the template.**
    expect(m.q('launch-approval-says').textContent?.trim()).toBe(launchApprovalView('ask').heading)
    expect(m.q('launch-approval-press').textContent?.trim()).toBe(launchApprovalView('ask').press)
    // 🔴 **579 · the SCOPE is on the control and the DETAIL is behind a press** (`EXT-010` §2.2).
    // ⛔ The label is what stops the fold making this read as a per-conversation toggle, so it is
    // asserted here, beside the state, and against the view rather than against a literal.
    expect(m.q('launch-approval-governs').textContent?.trim()).toBe(
      launchApprovalView('ask').governs,
    )
    expect(m.all('launch-approval-bound'), 'the bound is folded, not standing').toEqual([])
    ;(m.q('launcher-why-approval') as HTMLButtonElement).click()
    await nextTick()
    expect(m.q('launch-approval-bound').textContent?.trim()).toBe(LAUNCH_APPROVAL_BOUND)
  })

  /**
   * 🔴 **579 · the half of `EXT-010` §2.2 that a fold could have taken away** — and it is the
   * defect the brief names as worse than the one it sent me for: *"a control that looks like a
   * per-conversation toggle but changes every future conversation."*
   *
   * ⛔ **Derived, not typed.** The label comes off the same view the state does, so a surface
   * cannot draw one without the other; and the assertion below is that what a person sees WITHOUT
   * pressing anything already says this is not about the conversation they are about to start.
   */
  it('🔴 what a person reads without pressing anything says it is EVERY conversation', async () => {
    await page.viewport(REAL.width, REAL.height)
    for (const mode of ['ask', 'auto', null] as const) {
      const { m } = openFrontDoor({ defaultApprovalMode: mode })
      await nextTick()
      const standing = `${m.q('launch-approval').innerText}`.toLowerCase()
      expect(standing, `${mode}: the scope is behind a press`).toContain(
        LAUNCH_APPROVAL_GOVERNS.toLowerCase(),
      )
      // ⛔ **And it is not there only because the folded paragraph leaked into the read.**
      expect(m.all('launch-approval-bound'), `${mode}: the bound is standing`).toEqual([])
      m.unmount()
    }
  })

  it('⚠️ …and the detector: the scope really can be missing from that read', async () => {
    // ⚑ **The plant `a-positive-assertion-must-differ-from-the-default` asks for.** The assertion
    // above is a `toContain` over a subtree, which is exactly the shape that passes on a
    // neighbouring element — so this removes the label and shows the reading follows it.
    await page.viewport(REAL.width, REAL.height)
    const { m } = openFrontDoor()
    await nextTick()
    m.q('launch-approval-governs').remove()
    expect(`${m.q('launch-approval').innerText}`.toLowerCase()).not.toContain(
      LAUNCH_APPROVAL_GOVERNS.toLowerCase(),
    )
  })

  it('⛔ in yolo it says so, and both halves of 367’s disclosure arrive', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m } = openFrontDoor({ defaultApprovalMode: 'auto' })
    await nextTick()
    const button = m.q('launch-approval-mode')
    expect(button.dataset.mode).toBe('auto')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(m.q('launch-approval-press').textContent?.trim()).toBe(launchApprovalView('auto').press)
    // 🔴 **The shared constant, byte for byte** — the same one the agent card's panel renders.
    expect(m.q('yolo-means').textContent ?? '').toContain(YOLO_MEANS)
    // ⛔ **And the half only the ADAPTER can write, for the provider THIS launch will run on.**
    const codex = allProviderCapabilities().codex.approvals
    expect(codex.state).toBe('available')
    expect(m.q('yolo-reach').textContent?.trim()).toBe(
      codex.state === 'available' ? codex.note : '',
    )
  })

  /**
   * ⚠️ **The state `086` rules on: nobody has answered, so there is nothing to press and nothing to
   * claim.** ⛔ Drawn *asking* it would claim a person is being consulted when nobody knows; drawn
   * *yolo* it would claim a consent nobody has given.
   */
  it('⚠️ before the policy read lands there is no press, and the launch still sends ask', async () => {
    await page.viewport(REAL.width, REAL.height)
    const { m, started, set } = openFrontDoor({ defaultApprovalMode: null })
    await nextTick()
    const button = m.q('launch-approval-mode') as HTMLButtonElement
    expect(button.dataset.mode).toBe('')
    expect(button.disabled).toBe(true)
    expect(m.host.querySelector('[data-cy="launch-approval-press"]')).toBeNull()
    expect(m.host.querySelector('[data-cy="yolo-means"]')).toBeNull()
    // ⛔ **Pressing it asks for nothing** — the press is disabled AND the handler has no answer, so
    // neither half alone is what makes this true.
    button.click()
    await nextTick()
    expect(set).toEqual([])
    // ⚑ **…and the door still works**, in the word that keeps somebody being asked.
    ;(m.q('send-prompt') as HTMLButtonElement).click()
    await nextTick()
    expect(started[0]?.approvalMode).toBe('ask')
  })

  /**
   * 🔴 **The payload, across all three states, and `500`'s own mutation table is why it is HERE.**
   *
   * ⛔ The row that makes this door go back to `417`'s hard-coded `'ask'` SURVIVED its first
   * verification: every other assertion in this section mounts with the default already `'ask'`, so
   * the mutated door and the real one agreed on every cell the file could see. ⚠️
   * `a-comparison-tested-where-both-sides-agree-measures-nothing`, found by the table rather than by
   * review. ⚑ **The divergent cell is `auto`**, and it belongs in the file the row names.
   */
  it('🔴 what the door SENDS is the mode the person set, and ask until the row is read', async () => {
    await page.viewport(REAL.width, REAL.height)
    for (const [set, sent] of [
      ['ask', 'ask'],
      ['auto', 'auto'],
      [null, 'ask'],
    ] as const) {
      const { m, started } = openFrontDoor({ defaultApprovalMode: set })
      await nextTick()
      ;(m.q('send-prompt') as HTMLButtonElement).click()
      await nextTick()
      expect(started, JSON.stringify(set)).toHaveLength(1)
      expect(started[0]?.approvalMode, JSON.stringify(set)).toBe(sent)
      // ⚑ **And nothing else moved on the wire** — the setting is the only field it decides.
      expect(started[0]?.profileId).toBe(DEFAULT_PROFILE_ID)
      expect(started[0]?.provider).toBe('codex')
      m.unmount()
    }
  })

  it('🔴 the press asks for the OTHER mode, from the same key the sentence was read from', async () => {
    await page.viewport(REAL.width, REAL.height)
    const asking = openFrontDoor({ defaultApprovalMode: 'ask' })
    await nextTick()
    ;(asking.m.q('launch-approval-mode') as HTMLButtonElement).click()
    await nextTick()
    expect(asking.set).toEqual(['auto'])
    asking.m.unmount()

    // ⛔ **The other direction, at the same moment** — a press that always asked for `auto` would
    // pass the cell above and would be a control a person could not turn off.
    const yolo = openFrontDoor({ defaultApprovalMode: 'auto' })
    await nextTick()
    ;(yolo.m.q('launch-approval-mode') as HTMLButtonElement).click()
    await nextTick()
    expect(yolo.set).toEqual(['ask'])
  })
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
          approvalNote: 'approvals: ask · YOLO from your next message',
        },
        capabilities: allProviderCapabilities(),
      }),
      PANE,
    )
    await nextTick()
    // ⛔ **Now and next, beside the plate**, without a press.
    expect(m.q('card-approval-pending').textContent?.trim()).toBe(
      'Ask now · YOLO from your next message',
    )
    expect(visible(m.q('card-approval-pending'))).toBe(true)
    const face = m.q('card-approval')
    expect(face.textContent?.trim()).toBe('YOLO off')
    expect(face.dataset.pending).toBe('auto')
    // …and the host's own composed sentence, in the panel the face opens.
    face.click()
    await nextTick()
    await nextTick()
    expect(m.q('card-approval-note').textContent?.trim()).toBe(
      'approvals: ask · YOLO from your next message',
    )
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
          approvalNote: 'approvals: ask',
        },
        capabilities: allProviderCapabilities(),
      }),
      PANE,
    )
    await nextTick()
    expect(settled.all('card-approval-pending')).toHaveLength(0)
    expect(settled.q('card-approval').textContent?.trim()).toBe('YOLO off')
    expect(settled.q('card-approval').dataset.pending).toBe('')
  })
})
