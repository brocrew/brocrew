import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
// The live smokes' tab-ownership walk — a plain `.mjs` module, imported here for the one hook this
// file mounts and the shared drawer fixture does not. See the assertion at the end of §2's test.
import { tabOfHook } from '../../../../scripts/lib/tab-flow.mjs'
import type { TranscriptEvent } from '../../src/shared/runtime-ipc'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import { markPermissionAnswered } from '../../src/renderer/src/lib/transcript'
import {
  channelGap,
  luminance,
  mount,
  paintedBackground,
  paneProps,
  parseColor,
  record,
  show,
  unmountAll,
  type Mounted,
} from './harness'

/**
 * **The Changes pane in a real engine** (096 acceptance 9, on 083's harness).
 *
 * ⚠️ **Exactly the shape of defect the harness was built for**, and 087 set the precedent: a
 * theme-scoped drawer column with a **paper island inside it** — a light surface seated in dark
 * chrome, whose appearance is decided by what its tokens resolve to *where it sits* rather than by
 * what it declares. 080 shipped two of those past 2,043 green tests. Two of the assertions below
 * (the diffstat track, and the paper in dark chrome) are about tokens that have no light value or no
 * dark one, which no amount of SSR markup could have seen.
 */

afterEach(unmountAll)

const DIFF = ['@@ -1,3 +1,3 @@', ' alpha', '-beta', '+BETA', ' gamma'].join('\n')

const changed = (
  changes: {
    path: string
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'touched'
    added?: number
    removed?: number
    diff?: string
  }[],
  source = 'turn/diff/updated',
): TranscriptEvent[] => [{ type: 'file_change', changes, source } as never]

const TWO = changed([
  {
    path: 'src/member/CheckoutResolver.java',
    status: 'modified',
    added: 31,
    removed: 9,
    diff: DIFF,
  },
  { path: 'src/member/CheckoutResolverTest.java', status: 'modified', added: 58, removed: 2 },
])

/**
 * ⚠️ **`theme` sets the carrier after mount; it was a `chatLight` prop until 344.** The pane now
 * renders `data-chat-theme="light"` unconditionally, and the claim this file makes is precisely
 * that the diff does NOT follow it: `DiffBody` is a white island in either ramp, so the ramp has to
 * be movable for that to be a claim at all. ⛔ `:root`'s dark ramp is still live — it is the app
 * frame and every overlay — so a diff rendered against it is a real configuration.
 */
function pane(
  events: TranscriptEvent[],
  over: Record<string, unknown> & { theme?: 'light' | 'dark' } = {},
): Mounted {
  const { theme, ...props } = over
  const m = mount(
    ConversationPane,
    paneProps({ record: record(events), drawerOpen: true, drawerTab: 'changes', ...props }),
    { width: 1200, height: 820 },
  )
  if (theme) m.q('conversation-pane').setAttribute('data-chat-theme', theme)
  return m
}

/** Codex's real under-disclosure: a file change approved without the files being named. */
const undisclosed = (id: string): TranscriptEvent =>
  ({
    type: 'permission_request',
    id,
    kind: 'file',
    action: 'apply_patch',
    detail: 'write',
    scope: {
      cwd: '/work',
      paths: [],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions: ['allow', 'deny', 'cancel'],
      underDisclosed: true,
    },
  }) as never

/** Every custom property the pane paints with, resolved where it actually sits. */
function tokens(scope: HTMLElement, names: string[]): Record<string, string> {
  const style = getComputedStyle(scope)
  return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name).trim()]))
}

describe('the collapsed pane is the real state, and it costs the file list', () => {
  it('renders one row per file and NOT a single diff line', async () => {
    // 092 §4 as a DOM fact rather than a data one: `changes.test.ts` proves the rows carry no diff
    // text; this proves nothing rendered one anyway. `data-cy="diff-line"` is emitted per line by
    // `DiffBody`, so zero of them is the measurement.
    const m = pane(TWO)
    await nextTick()
    expect(m.q('session-changes')).toBeTruthy()
    expect(m.all('changes-row-src/member/CheckoutResolver.java')).toHaveLength(1)
    expect(m.all('diff-line'), 'collapsed loads no diff bodies').toHaveLength(0)
    expect(m.all('diff-body')).toHaveLength(0)
  })

  it('and the collapsed cost is MEASURED, not asserted', async () => {
    // ⚠️ Acceptance §5 says measured. The number that matters is not bytes of JS — it is how the
    // pane grows: bounded by DISTINCT FILES rather than by turns or by content. So the measurement
    // is the DOM itself, at two very different diff sizes and two very different report counts.
    const small = pane(TWO)
    await nextTick()
    const collapsedNodes = small.q('session-changes').querySelectorAll('*').length
    small.unmount()

    // The same two files, reported forty times, each carrying a diff a hundred times larger.
    const fat = Array.from({ length: 40 }, () =>
      changed([
        {
          path: 'src/member/CheckoutResolver.java',
          status: 'modified',
          added: 31,
          removed: 9,
          diff: `${DIFF}\n${'+padding\n'.repeat(400)}`,
        },
        { path: 'src/member/CheckoutResolverTest.java', status: 'modified', added: 58, removed: 2 },
      ]),
    ).flat()
    const big = pane(fat)
    await nextTick()
    const fatNodes = big.q('session-changes').querySelectorAll('*').length
    // A measurement whose number nobody sees is just an assertion wearing a different hat.
    console.log(
      `collapsed DOM: ${collapsedNodes} nodes for 2 files × 1 report; ` +
        `${fatNodes} nodes for 2 files × 40 reports carrying ~4 KB of diff each`,
    )
    expect(fatNodes, 'the pane grows with FILES, not with reports or with diff size').toBe(
      collapsedNodes,
    )
    // …and the text is genuinely not in the document, not merely not counted as a node.
    expect(big.q('session-changes').textContent ?? '').not.toContain('padding')
  })

  it('expanding is an accordion — opening a second releases the first', async () => {
    // 092 §4: at most ONE diff body is ever in the DOM. It is enforced by `expanded` being a single
    // value rather than a set, so the accordion is structural; this is the proof it behaves that way.
    const m = pane(
      changed([
        { path: 'a.ts', status: 'modified', added: 1, removed: 1, diff: DIFF },
        { path: 'b.ts', status: 'modified', added: 2, removed: 2, diff: DIFF },
      ]),
    )
    await nextTick()
    m.q('changes-row-a.ts').click()
    await nextTick()
    expect(m.all('diff-body')).toHaveLength(1)

    m.q('changes-row-b.ts').click()
    await nextTick()
    expect(m.all('diff-body'), 'still exactly one').toHaveLength(1)
    expect(m.q('diff-body').textContent).toContain('b.ts')

    m.q('changes-row-b.ts').click()
    await nextTick()
    expect(m.all('diff-body'), 'and collapsing releases it entirely').toHaveLength(0)
  })
})

describe('the diff is paper — even in dark chrome (092 §5)', () => {
  it('the expanded body is a LIGHT island inside a dark drawer', async () => {
    // ⛔ **`theme: 'dark'` is explicit since 344, and the test is about the CASE it names.** The
    // conversation is paper unconditionally now, so a mount that says nothing renders a light
    // island inside a light drawer — where "it is paper" is true for a reason that has nothing to
    // do with `data-on-white`, and the assertion below would pass over the wrong mechanism. The
    // dark ramp is still what the app frame and every overlay read, so this is a configuration
    // `DiffBody` genuinely has to survive.
    const m = pane(
      changed([{ path: 'a.ts', status: 'modified', added: 1, removed: 1, diff: DIFF }]),
      { theme: 'dark' },
    )
    await nextTick()
    m.q('changes-row-a.ts').click()
    await nextTick()

    const paper = paintedBackground(m.q('diff-body'))
    const drawer = paintedBackground(m.q('session-changes'))
    expect(
      luminance(paper),
      `the diff paper should be light; it painted ${show(paper)}`,
    ).toBeGreaterThan(0.8)
    expect(
      luminance(drawer),
      `the drawer around it should be dark; it painted ${show(drawer)}`,
    ).toBeLessThan(0.2)
    expect(
      channelGap(paper, drawer),
      'and they are unmistakably different surfaces',
    ).toBeGreaterThan(100)
  })

  it('its toggle is Unified/Split, and there is no Markdown/Raw anywhere near it', async () => {
    // ⚠️ 092's ruling, made falsifiable: a diff borrows the paper, not the toggle. Rendering `+`/`−`
    // as markdown destroys the gutter that makes it a diff.
    const m = pane(
      changed([{ path: 'a.ts', status: 'modified', added: 1, removed: 1, diff: DIFF }]),
    )
    await nextTick()
    m.q('changes-row-a.ts').click()
    await nextTick()
    expect(m.q('diff-view-unified').textContent?.trim()).toBe('Unified')
    expect(m.q('diff-view-split').textContent?.trim()).toBe('Split')
    expect(m.all('doc-view-markdown'), 'DocumentBody is untouched and is not here').toHaveLength(0)
    expect(m.all('doc-view-raw')).toHaveLength(0)
    expect(m.all('document-body')).toHaveLength(0)
  })

  it('added and removed lines are readable ON the paper, in both chromes', async () => {
    // The defect class this whole harness exists for: `--success` and `--danger` are chrome tokens
    // that FLIP with the theme, so taking them for a diff would put mint-green text on a white page
    // in dark mode. `DiffBody` declares its own deep inks against the paper instead; this is what
    // says so where the cascade actually resolves.
    for (const theme of ['dark', 'light'] as const) {
      const m = pane(
        changed([{ path: 'a.ts', status: 'modified', added: 1, removed: 1, diff: DIFF }]),
        { theme },
      )
      await nextTick()
      m.q('changes-row-a.ts').click()
      await nextTick()
      const lines = m.all('diff-line')
      const add = lines.find((line) => line.className.includes('add'))!
      const del = lines.find((line) => line.className.includes('del'))!
      for (const [label, line] of [
        ['added', add],
        ['removed', del],
      ] as const) {
        const bg = paintedBackground(line)
        const ink = parseColor(getComputedStyle(line.querySelector('.lc')!).color)!
        expect(
          luminance(bg),
          `${label} line on paper, theme=${theme}: painted ${show(bg)}`,
        ).toBeGreaterThan(0.7)
        expect(
          luminance(ink),
          `${label} ink must be dark ON that paper, theme=${theme}`,
        ).toBeLessThan(0.35)
      }
      m.unmount()
    }
  })

  it('switching to Split keeps the line count and the paper', async () => {
    const m = pane(
      changed([{ path: 'a.ts', status: 'modified', added: 1, removed: 1, diff: DIFF }]),
    )
    await nextTick()
    m.q('changes-row-a.ts').click()
    await nextTick()
    const unified = m.all('diff-line').length
    m.q('diff-view-split').click()
    await nextTick()
    expect(m.all('diff-line')).toHaveLength(unified)
    expect(luminance(paintedBackground(m.q('diff-body')))).toBeGreaterThan(0.8)
  })
})

describe('the tokens 092 named, resolved where they actually sit', () => {
  it('the diffstat track is `--wash-3`, which exists in BOTH themes', async () => {
    // ⚠️ 086 caught this once and 092 wrote it down twice because it is easy to get wrong: `--wash-4`
    // is declared only in `:root`, so in the light pane it inherits a near-transparent WHITE and the
    // track vanishes. This asserts the resolved values rather than the name in the stylesheet.
    for (const theme of ['dark', 'light'] as const) {
      const m = pane(TWO, { theme })
      await nextTick()
      const scope = m.q('session-changes')
      const resolved = tokens(scope, ['--wash-3', '--wash-4'])
      expect(resolved['--wash-3'], `--wash-3 must resolve, theme=${theme}`).not.toBe('')
      const track = paintedBackground(m.q('changes-stat'))
      const around = paintedBackground(scope)
      expect(
        channelGap(track, around),
        `the diffstat track must be visible against the pane, theme=${theme}: ` +
          `track ${show(track)} vs pane ${show(around)}`,
      ).toBeGreaterThan(0)
      m.unmount()
    }
  })

  it('and the amber attention token is nowhere in the feature', async () => {
    // 092: *"Amber `--waiting` is deliberately unused — it stays the attention channel's alone."*
    // Asserted the way 087 asserted its own version: by resolving the hue and looking for it, so a
    // future `background: var(--waiting)` on a row is caught by the cascade rather than by review.
    const m = pane(TWO)
    await nextTick()
    // `--waiting` resolves to a HEX literal, not `rgb()`, so it is converted here rather than run
    // through `parseColor` — which returns null for hex and would have made every comparison below
    // throw. (It did, on the first run of this test.)
    const raw = getComputedStyle(m.q('session-changes')).getPropertyValue('--waiting').trim()
    expect(raw, '--waiting must resolve, or this test compares against nothing').toMatch(/^#/)
    const amber: [number, number, number, number] = [
      Number.parseInt(raw.slice(1, 3), 16),
      Number.parseInt(raw.slice(3, 5), 16),
      Number.parseInt(raw.slice(5, 7), 16),
      1,
    ]
    const surfaces = [
      m.q('session-changes'),
      m.q('changes-files'),
      m.q('changes-revert'),
      m.q('changes-stat'),
    ]
    for (const el of surfaces) {
      expect(
        channelGap(paintedBackground(el), amber),
        `amber found on ${el.dataset.cy}`,
      ).toBeGreaterThan(24)
    }
  })
})

/**
 * 🔴 **What a window release let go of, said on the pane** (299 §2, from 297 finding 5).
 *
 * ⛔ Before this the release took the whole change log without a word, so this pane drew the empty
 * state below — *"nothing changed"* — about a conversation that had demonstrably changed files. The
 * carry fixes that; the CAP on the carry is what this sentence is for, and a cap is never silent.
 */
describe('reports a release let go of are said, not swallowed (299 §2)', () => {
  it('⛔ the pane says how many observations it has stopped holding', async () => {
    const written = record(TWO)
    written.transcript.changes.dropped = 3
    const m = mount(
      ConversationPane,
      paneProps({ record: written, drawerOpen: true, drawerTab: 'changes' }),
      {
        width: 1200,
        height: 820,
      },
    )
    await nextTick()
    const said = m.q('changes-released')
    expect(said.textContent).toContain('3 earlier reports')
    expect(said.textContent).toContain('no longer held')
    // …and the rows it DOES hold are still drawn, so this is a note beside a list rather than
    // instead of one.
    expect(
      m.all('changes-row-src/member/CheckoutResolver.java').length,
      'the note replaced the list instead of sitting beside it',
    ).toBe(1)
  })

  it('⚑ …and an ordinary conversation says nothing of the kind', async () => {
    // The paired positive: a conversation that never rolled its window must not carry the sentence.
    const m = pane(TWO)
    await nextTick()
    expect(m.all('changes-released')).toHaveLength(0)
  })
})

describe('every blank renders, and nothing is fabricated (092 §3)', () => {
  it('nothing changed → a faceless dashed ring, and NOT a zero', async () => {
    const m = pane([])
    await nextTick()
    const empty = m.q('changes-empty')
    expect(empty.textContent).toContain('No file changes in this conversation')
    expect(empty.textContent, '081: never a zero').not.toMatch(/\b0\b/)
    const ring = empty.querySelector('.ring')!
    expect(getComputedStyle(ring).borderStyle).toBe('dashed')
    // …and the summary header is not drawn at all, so there is no `0 files` line either.
    expect(m.all('changes-files')).toHaveLength(0)
  })

  it('a change we were not told the files of → no path, no count, not expandable', async () => {
    // ⚠️ Acceptance §4, asserted rather than described. The row is drawn from a COUNT of approvals
    // this app ALLOWED without disclosure; there is nothing to name, and nothing is named.
    const written = record([undisclosed('p1')])
    markPermissionAnswered(written.transcript, 'p1', 'allow')
    const m = mount(
      ConversationPane,
      paneProps({ record: written, drawerOpen: true, drawerTab: 'changes' }),
      { width: 1200, height: 820 },
    )
    await nextTick()
    const row = m.q('changes-under-disclosed')
    expect(row.textContent).toContain('content not reported')
    // No path, no count — the two things we do not have and will not invent.
    expect(row.textContent).not.toMatch(/[/\\]/)
    // ⛔ **…and no BASENAME either** (188 §2, from 182 L3/L4). A separator check calls `README.md`
    // and `secrets.env` clean, so this row could have leaked the one thing it must not invent and
    // stayed green. `\S+\.\w{1,8}` is a filename with an extension and no separator, which is
    // exactly the shape the old assertion could not see.
    expect(row.textContent, 'a bare filename is a path too').not.toMatch(/\S+\.\w{1,8}\b/)
    expect(row.textContent).not.toMatch(/[+−]\d/)
    expect(m.all('changes-stat'), 'no diffstat bar on a row with nothing to stat').toHaveLength(0)
    // Not expandable: no chevron affordance, and nothing opens.
    expect(row.tagName, 'not even a button — there is nothing to press').toBe('DIV')
    row.click()
    await nextTick()
    expect(m.all('diff-body')).toHaveLength(0)
    // ⚠️ And it does NOT put the pane into its empty state, which would read as "nothing happened".
    expect(m.all('changes-empty')).toHaveLength(0)
    m.unmount()
  })

  it('and the sentence beside it agrees with its own count — at ONE and at TWO (181 §2)', async () => {
    // ⛔ **"1 file change were approved"**, live, in the PM's own conversation. The noun was
    // pluralised inline and the verb was hard-coded, so the line was ungrammatical at exactly the
    // count it is most often seen at — one approval.
    //
    // ⚠️ **Both counts, because a fix that only reads right at 1 is the same bug at 2.** Each half
    // also asserts the OTHER spelling is absent: without that, a line reading "1 file change was
    // approved … 1 file change were approved" would satisfy a `toContain` and still be wrong.
    for (const [count, sentence, wrong] of [
      [1, '1 file change was approved', /file change were/],
      [2, '2 file changes were approved', /file changes was/],
    ] as const) {
      const ids = Array.from({ length: count }, (_, i) => `p${i + 1}`)
      const written = record(ids.map((id) => undisclosed(id)))
      for (const id of ids) markPermissionAnswered(written.transcript, id, 'allow')
      const m = mount(
        ConversationPane,
        paneProps({ record: written, drawerOpen: true, drawerTab: 'changes' }),
        { width: 1200, height: 820 },
      )
      await nextTick()
      const note = m.q('changes-under-disclosed-note').textContent!.replace(/\s+/g, ' ').trim()
      expect(note, `the sentence at ${count}`).toContain(sentence)
      expect(note, 'and not the other count’s verb').not.toMatch(wrong)
      // The rest of the sentence is the ruling it exists to state, and it survives the rewrite.
      expect(note).toContain('We will not invent a path or a count')
      m.unmount()
    }
    // ⛔ **And the walk's table is asked about the new hook, HERE** (178's lesson). The shared drawer
    // fixture never renders an under-disclosed row, so `tab-flow.dom.test.ts` cannot see this name —
    // it lands in that file's `unrendered` list and nothing checks it. A live step reading it off
    // the wrong tab would then find `null` and assert against an absence it caused, which is the one
    // class 097 exists to remove. This is the state that mounts it, so this is where it is claimed.
    expect(tabOfHook('changes-under-disclosed-note')).toBe('changes')
  })

  it('…but a change still waiting on an answer claims nothing at all', async () => {
    // NON-VACUITY, and a correctness claim: a card still frozen has changed nothing YET. Identical
    // setup, one difference — nobody answered it.
    const m = mount(
      ConversationPane,
      paneProps({
        record: record([undisclosed('p2')]),
        drawerOpen: true,
        drawerTab: 'changes',
      }),
      { width: 1200, height: 820 },
    )
    await nextTick()
    expect(m.all('changes-under-disclosed')).toHaveLength(0)
    expect(m.q('changes-empty')).toBeTruthy()
    m.unmount()
  })

  it('written and then put back → shown, tagged `net unchanged`, and it expands', async () => {
    // 074 via 092: don't claim what you didn't observe **and** don't hide what you did. The agent
    // wrote the file; the net diff is empty. Hiding it would lose a write the reader may care about.
    const m = pane(
      changed([{ path: 'src/Service.java', status: 'modified', added: 0, removed: 0, diff: DIFF }]),
    )
    await nextTick()
    const row = m.q('changes-row-src/Service.java')
    expect(row.textContent).toContain('net unchanged')
    expect(row.textContent, 'and no +0 −0 anywhere on it').not.toContain('+0')
    row.click()
    await nextTick()
    expect(m.q('diff-banner').textContent).toContain('reverted')
  })

  it('a deleted file keeps its row and banners that there is nothing to revert to', async () => {
    const m = pane(
      changed([
        { path: 'fixtures/legacy.json', status: 'deleted', added: 0, removed: 44, diff: DIFF },
      ]),
    )
    await nextTick()
    const row = m.q('changes-row-fixtures/legacy.json')
    expect(row.textContent).toContain('deleted')
    row.click()
    await nextTick()
    expect(m.q('diff-banner').textContent).toContain('nothing on disk to revert to')
  })

  it('a file Claude touched shows its path and says the diff is not reported', async () => {
    // The measured asymmetry, on screen: Claude reports WHICH file, never what changed in it. The
    // row states that instead of drawing `+0 −0` or a chevron that opens onto an empty box.
    const m = pane(changed([{ path: '/work/src/a.ts', status: 'touched' }], 'Edit'))
    await nextTick()
    const row = m.q('changes-row-/work/src/a.ts')
    expect(row.textContent).toContain('no diff reported')
    expect(row.textContent).not.toContain('+0')
    expect((row as HTMLButtonElement).disabled, 'and it cannot be opened').toBe(true)
    row.click()
    await nextTick()
    expect(m.all('diff-body')).toHaveLength(0)
  })
})

describe('the deferred revert foot', () => {
  it('is present, disabled, and states a reason that is true', async () => {
    // ⚠️ Acceptance §8. The reason comes from the capability rather than from prose in the template,
    // and 092's version of it — *"appears in no source"* — is exactly what must NOT be here: the
    // SDK declares `rewindFiles()` at our pin, so shipping that sentence would ship a false one.
    const m = pane(TWO, {
      capabilities: {
        claude: {
          rewind: {
            state: 'unwired',
            reason:
              'Claude can do this — `enableFileCheckpointing` plus `rewindFiles()`, both declared in the pinned SDK. It is not wired because rewind writes to your files.',
          },
        },
      },
    })
    await nextTick()
    const button = m.q('changes-revert') as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.textContent).toContain('Revert these changes')
    const why = m.q('changes-revert-why').textContent ?? ''
    expect(why).toContain('writes to your files')
    expect(why).toContain('rewindFiles')
    expect(why, 'the reason 092 had wrong is not repeated').not.toMatch(/no source|zero source/i)
  })
})

describe('what review found on screen, kept red-until-fixed', () => {
  it('switching scope CLOSES the diff instead of hiding and reviving it', async () => {
    // ⚠️ `expanded` held a path, and a path that left the scope simply stopped rendering: the diff
    // vanished with no cue and came back on its own when the reader switched back. Both halves are
    // wrong, and the second is the same defect 095 fixed one field over — a surface reopening
    // something nobody asked for.
    const m = pane(
      changed([{ path: 'a.ts', status: 'modified', added: 1, removed: 1, diff: DIFF }]),
    )
    await nextTick()
    m.q('changes-row-a.ts').click()
    await nextTick()
    expect(m.all('diff-body')).toHaveLength(1)

    m.q('changes-scope-turn').click()
    await nextTick()
    m.q('changes-scope-conversation').click()
    await nextTick()
    expect(m.all('diff-body'), 'it stays closed until asked again').toHaveLength(0)
    // NON-VACUITY: it still opens on a click after the round trip.
    m.q('changes-row-a.ts').click()
    await nextTick()
    expect(m.all('diff-body')).toHaveLength(1)
  })

  it('a row whose body is no longer held does not sit visually open', async () => {
    // The `.open` class was keyed off `expanded`, not off the body actually being there, so a row
    // whose diff had been released to bound memory drew an opened chevron over nothing.
    const many: TranscriptEvent[] = []
    for (let index = 0; index <= 22; index += 1)
      many.push(
        ...changed([
          { path: `f${index}.ts`, status: 'modified', added: 1, removed: 1, diff: DIFF },
        ]),
      )
    const m = pane(many)
    await nextTick()
    const stale = m.q('changes-row-f0.ts') as HTMLButtonElement
    expect(stale.disabled, 'released rows cannot be opened').toBe(true)
    expect(stale.textContent).toContain('no diff reported')
    expect(stale.closest('.file')?.classList.contains('open')).toBe(false)
  })

  it('a diff crowded out of a long report says so, not that the file was large', async () => {
    const m = pane(
      changed([
        { path: 'a.ts', status: 'modified', added: 9, removed: 1, crowdedOut: true } as never,
      ]),
    )
    await nextTick()
    const row = m.q('changes-row-a.ts')
    expect(row.textContent).toContain('diff not kept')
    expect(row.textContent, 'a 10 KiB diff is not "large"').not.toContain('large diff')
  })

  it('the Split view still shows where in the file you are', async () => {
    // The @@ header was blanked in Split, so three hunks 200 lines apart read as one continuous run
    // of code — and the header is the only thing that says otherwise.
    const twoHunks = [
      '@@ -1,2 +1,2 @@',
      ' a',
      '-b',
      '+B',
      '@@ -340,2 +340,2 @@',
      ' y',
      '-z',
      '+Z',
    ].join('\n')
    const m = pane(
      changed([{ path: 'a.ts', status: 'modified', added: 2, removed: 2, diff: twoHunks }]),
    )
    await nextTick()
    m.q('changes-row-a.ts').click()
    await nextTick()
    m.q('diff-view-split').click()
    await nextTick()
    const text = m.q('diff-body').textContent ?? ''
    expect(text).toContain('@@ -1,2 +1,2 @@')
    expect(text, 'the second hunk’s position too').toContain('@@ -340,2 +340,2 @@')
  })

  it('a path with a trailing slash still renders a name', async () => {
    // The local `nameOf` differed from the shared `basenameOf` on exactly this input and rendered
    // an empty filename — drift that had already happened, not drift that might.
    const m = pane(changed([{ path: 'src/generated/', status: 'touched' }], 'Write'))
    await nextTick()
    expect(m.q('changes-row-src/generated/').textContent).toContain('generated')
  })

  it('the empty state does not hide an under-disclosed change on the turn scope', async () => {
    // With no rows this turn but an undisclosed approval on the conversation, the pane drew a list
    // holding one faceless row and no explanation of why the turn looked bare.
    const written = record([undisclosed('p1')])
    markPermissionAnswered(written.transcript, 'p1', 'allow')
    const m = mount(
      ConversationPane,
      paneProps({ record: written, drawerOpen: true, drawerTab: 'changes' }),
      { width: 1200, height: 820 },
    )
    await nextTick()
    expect(m.q('changes-under-disclosed')).toBeTruthy()
    m.q('changes-scope-turn').click()
    await nextTick()
    expect(m.all('changes-under-disclosed'), 'not a lone faceless row').toHaveLength(0)
    expect(m.q('changes-empty').textContent, 'the turn says it is empty, and why').toContain(
      'No file changes in this turn',
    )
    m.unmount()
  })
})
