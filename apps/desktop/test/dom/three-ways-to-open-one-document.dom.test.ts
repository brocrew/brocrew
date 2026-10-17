import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, shallowRef } from 'vue'
import CanonicalDocumentOverlay from '../../src/renderer/src/components/CanonicalDocumentOverlay.vue'
import type { ResourceReading } from '../../src/shared/runtime-ipc'
import { mount, unmountAll } from './harness'

/**
 * 🔴 **640 · the one component three surfaces now open a document through.**
 *
 * ## ⛔ Why a suite of its own, when three suites already press the button
 *
 * ⚑ **`a-press-that-opens-the-document-it-names`, `the-documents-a-project-actually-produced` and
 * `work-report` each mount a real surface and press** — and all three passed the fold UNEDITED,
 * which is the evidence that the behaviour did not move. ⚠️ **What none of them can see is the
 * component itself**: they reach it through a pane, so a rule the overlay keeps for every surface
 * — the door check, the scope guard, the capture before the await — is measured only where that
 * pane happens to exercise it.
 *
 * ⛔ **`067`'s defect was found on ONE surface and fixed on ONE surface.** Now that the guard is
 * shared, a fourth surface inherits it, and this file is where that inheritance is pinned: the
 * race is driven against the component rather than against `ConversationPane`.
 *
 * ## ⚠️ Every arm is paired
 *
 * 🔴 **A panel that never draws would pass half of this file** ([[a-positive-assertion-must-differ-from-the-default]]),
 * so each silence below is stated beside the same mount one fact over, where the panel DOES draw.
 */

afterEach(unmountAll)

/** ⚑ A resource id as `keepResource` mints one — `res_<32 hex>` (D-016). */
const A_RESOURCE_ID = 'res_4c2f0e1a111142228333444455556666'

const A_DOCUMENT: ResourceReading = {
  ok: true,
  form: 'markdown',
  resourceId: A_RESOURCE_ID,
  name: 'response.md',
  text: '# the answer\n',
  bytes: 14,
}

/** A reader whose answer the test releases by hand, so the in-flight window can be driven. */
function heldReader(): {
  read: () => Promise<ResourceReading>
  release: (result: ResourceReading) => void
  asked: () => number
} {
  let resolve!: (result: ResourceReading) => void
  const answer = new Promise<ResourceReading>((it) => {
    resolve = it
  })
  let asked = 0
  return {
    read: () => {
      asked += 1
      return answer
    },
    release: resolve,
    asked: () => asked,
  }
}

/** The overlay under a parent that can move its `scope`, which is what a real surface does. */
function scoped(read?: (resourceId: string) => Promise<ResourceReading>) {
  const scope = shallowRef<string | undefined>('sess_1')
  const child = ref<{ open: (resourceId: string) => Promise<void> } | null>(null)
  const Wrapper = defineComponent({
    setup: () => () =>
      h(CanonicalDocumentOverlay as never, { read, scope: scope.value, ref: child }),
  })
  const m = mount(Wrapper, {}, { width: 1200, height: 800 })
  return { m, scope, open: (id: string) => child.value!.open(id) }
}

describe('640 §1 · the door — a surface with no reader opens nothing', () => {
  it('🔴 with a reader the panel is drawn, and without one the same press draws nothing', async () => {
    const { m, open } = scoped(async () => A_DOCUMENT)
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
    await open(A_RESOURCE_ID)
    await nextTick()
    // ⛔ The positive half: the press really does put the panel on screen.
    expect(m.all('canonical-document-viewer')).toHaveLength(1)
    expect(m.q('canonical-document-name').textContent).toBe('response.md')

    // ⚑ **The paired negative, same component, one fact removed** — `106`: a surface mounted with
    // no door draws nothing rather than an empty panel.
    const without = scoped(undefined)
    await without.open(A_RESOURCE_ID)
    await nextTick()
    expect(without.m.all('canonical-document-viewer')).toHaveLength(0)
  })
})

describe('640 §2 · the 067 guard, now inherited rather than re-derived', () => {
  it('🔴 a document opened under one scope does not float over the next', async () => {
    const reader = heldReader()
    const { m, scope, open } = scoped(reader.read)
    void open(A_RESOURCE_ID)
    // ⚑ **The premise, asserted**: the read really is in flight and nothing is drawn yet.
    expect(reader.asked()).toBe(1)
    expect(m.all('canonical-document-viewer')).toHaveLength(0)

    scope.value = 'sess_2'
    await nextTick()
    reader.release(A_DOCUMENT)
    await nextTick()
    await nextTick()
    // ⛔ The document belonged to the conversation that asked for it, and it is no longer here.
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
  })

  it('⚑ …and the same race with the scope held still DOES draw — the control', async () => {
    const reader = heldReader()
    const { m, open } = scoped(reader.read)
    void open(A_RESOURCE_ID)
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
    reader.release(A_DOCUMENT)
    await nextTick()
    await nextTick()
    // ⛔ Without this arm the test above would pass over a component that never draws at all.
    expect(m.all('canonical-document-viewer')).toHaveLength(1)
  })

  it('⚠️ a scope that moves after the panel is up takes the panel with it', async () => {
    const { m, scope, open } = scoped(async () => A_DOCUMENT)
    await open(A_RESOURCE_ID)
    await nextTick()
    expect(m.all('canonical-document-viewer')).toHaveLength(1)
    scope.value = 'sess_2'
    await nextTick()
    // ⛔ **The second half of the guard**, which fails differently from the race above: a panel
    // already on screen when the surface moves is dropped rather than left floating.
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
  })

  it('🔴 coming BACK does not re-open the document that was left behind', async () => {
    // ⛔ **The half the `showing` guard cannot answer, and the reason the watch sits beside it.**
    // ⚠️ A computed HIDES a panel whose scope is not the one on screen; it does not DROP it — so
    // a surface that returns to the conversation it left would find the old document over it
    // again, minutes later, with nobody having pressed anything. ⚑ `ConversationPane` held
    // exactly this pair before the fold (a `watch` on `record.sessionId` beside `documentFor`),
    // and the pair is what got folded, not just the guard.
    const { m, scope, open } = scoped(async () => A_DOCUMENT)
    await open(A_RESOURCE_ID)
    await nextTick()
    expect(m.all('canonical-document-viewer')).toHaveLength(1)
    scope.value = 'sess_2'
    await nextTick()
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
    scope.value = 'sess_1'
    await nextTick()
    // ⛔ Back where it was opened, and the panel is GONE rather than restored.
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
  })

  it('⚑ a surface that passes NO scope keeps its panel — ReadingPane and the room', async () => {
    // ⛔ `undefined === undefined` is the whole of the guard for a surface that draws one thing
    // for its whole life, and a fold that had made the guard strict would have closed their
    // panels the moment anything re-rendered.
    const m = mount(CanonicalDocumentOverlay, { read: async () => A_DOCUMENT }, { width: 1200 })
    await (m.vm as { open: (id: string) => Promise<void> }).open(A_RESOURCE_ID)
    await nextTick()
    expect(m.all('canonical-document-viewer')).toHaveLength(1)
  })
})

describe('640 §3 · closing is the panel’s own gesture, and it clears the state', () => {
  it('⛔ the panel’s close button takes the overlay down, and a second open brings it back', async () => {
    const { m, open } = scoped(async () => A_DOCUMENT)
    await open(A_RESOURCE_ID)
    await nextTick()
    m.q('close-overlay').click()
    await nextTick()
    expect(m.all('canonical-document-viewer')).toHaveLength(0)
    // ⚑ **Closed, not broken**: the state was cleared rather than latched, so the next press works.
    await open(A_RESOURCE_ID)
    await nextTick()
    expect(m.all('canonical-document-viewer')).toHaveLength(1)
  })
})
