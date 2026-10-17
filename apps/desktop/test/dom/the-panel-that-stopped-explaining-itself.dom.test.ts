import { afterEach, describe, expect, it } from 'vitest'
import { fileManagerWord } from '../../src/renderer/src/lib/message-paths'
import { defineComponent, h, nextTick, ref } from 'vue'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import type {
  CreatedSession,
  InstructionSourceResult,
  ProviderConfigInfo,
  RevealResult,
  SessionInstructions,
  SessionPathTarget,
} from '../../src/shared/runtime-ipc'
import { drawerProps, META, mount, unmountAll, type Mounted, toldProps } from './harness'

/**
 * 🔴 **356 · the Info panel reads in two seconds, and the sentences are still there.**
 *
 * An Info row initially shows its label, path, and a way to open it. Keep the explanation of
 * the mechanism behind a per-row disclosure that starts collapsed rather than deleting the
 * explanation.
 *
 * ⛔ **This file is in `dom/` and not in a `.render.` sibling because a disclosure has to be
 * CLICKED.** An SSR render of a `v-if` that never opens asserts the absence and can never assert the
 * presence, and 356 §4 names that trap by hand: *"Renderer tests are SSR-only and pass vacuously."*
 * Every negative below is paired with the positive on the same mount.
 */

afterEach(unmountAll)

const CONFIG: ProviderConfigInfo = {
  home: '/homes/default/codex',
  homeEnv: 'CODEX_HOME',
  model: 'file-based — config.toml in this home is where servers and preferences are declared',
  authNote: 'the credential lives in the Keychain',
  files: [
    {
      name: 'auth.json',
      path: '/homes/default/codex/auth.json',
      exists: true,
      note: 'the credential this profile runs on',
    },
    {
      name: 'config.toml',
      path: '/homes/default/codex/config.toml',
      exists: false,
      note: 'servers and preferences',
    },
  ],
}

const NOTHING: SessionInstructions = {
  injected: [],
  agentMemory: [],
  provider: [],
  refused: [],
  note: '',
  recallsReported: false,
  writesReported: false,
  composed: null,
}

const REPORTED: SessionInstructions = {
  ...NOTHING,
  provider: [
    { path: '/homes/default/codex/AGENTS.md', scope: 'profile' },
    { path: '/work/checkout/AGENTS.md', scope: 'project' },
  ],
  note: 'this app appends nothing for this provider — it reads its own instruction files',
}

function panel(over: Partial<CreatedSession> = {}, props: Record<string, unknown> = {}): Mounted {
  const session: CreatedSession = { ...META, config: CONFIG, ...over }
  return mount(SessionDrawer as never, drawerProps({ tab: 'info', session, ...props }), {
    width: 380,
    height: 900,
  })
}

/**
 * 🔴 **The agent's side, on the surface it lives on since `527`** (`HO-050` §1.1).
 *
 * ⛔ **Not a weakening of anything below.** Every claim in this file about a provider-reported
 * file, its two affordances and its fold is unchanged; what moved is where the block is drawn.
 * `SessionInstructions` used to emit `<dt>`/`<dd>` into `SessionInfo`'s `<dl>`, so the only way to
 * reach it was to mount the whole drawer on the Info tab. ⚑ **The same arguments, deliberately**,
 * so that what changed in each test below is one identifier.
 */
function told(over: Partial<CreatedSession> = {}, props: Record<string, unknown> = {}): Mounted {
  return mount(AgentInstructionsSheet as never, toldProps(over.instructions ?? NOTHING, props), {
    width: 760,
    height: 900,
  })
}

/**
 * 🔴 **583 · the sheet is a TAB STRIP, and only one tab is in the DOM at a time.**
 *
 * Assertions run on the row’s owner tab among `told-tab-<key>`, with one tab drawn at a time.
 * Provider-reported rows are on `not-held` because the app holds none of their bytes;
 * `instructions-why` belongs on `as-sent` with the composition account.
 *
 * ⚑ **A press rather than a prop**, because that is what a person does: the landing tab is
 * whichever owner is drawn first, and reaching another one is a click. ⛔ **Asserted to exist
 * before it is clicked** — a `querySelector(…)?.click()` on a tab that was renamed would make
 * every assertion after it a measurement of an empty panel.
 *
 * ⚠️ **Any control, not only a tab.** A fold on the tab a person has landed on is the same
 * gesture with the same requirement — press something that is there, then let Vue render.
 */
async function press(host: HTMLElement, cy: string): Promise<void> {
  const el = host.querySelector<HTMLButtonElement>(`[data-cy="${cy}"]`)
  expect(
    el,
    `nothing with data-cy="${cy}" is in the DOM, so nothing after this measured it`,
  ).not.toBeNull()
  el!.click()
  await nextTick()
}

/* ------------------------------------------------------------ what is on screen unasked */

describe('the prose is moved rather than deleted (356 §1)', () => {
  it('⛔ the config row shows PATHS and not the paragraph about them', () => {
    const { host } = panel()

    // The data.
    expect(host.textContent).toContain('/homes/default/codex/auth.json')
    // …and not the documentation.
    expect(host.textContent).not.toContain('is where servers and preferences are declared')
    expect(host.textContent).not.toContain('the credential this profile runs on')
    expect(host.querySelector('[data-cy="info-note-config"]')).toBeNull()
  })

  it('⚑ …and one press brings the whole of it back, each sentence beside the file it explains', async () => {
    // The paired positive, and it is the half that matters: 356 §1 says *"Do not simply delete the
    // prose"*, so a panel that had quietly lost these sentences would pass the test above.
    const { host, q } = panel()

    q('info-why-config').click()
    await nextTick()

    const fold = host.querySelector('[data-cy="info-note-config"]')
    expect(fold?.textContent).toContain('is where servers and preferences are declared')
    expect(fold?.textContent).toContain('the credential this profile runs on')
    expect(fold?.textContent).toContain('the credential lives in the Keychain')
    // ⛔ Scoped to the row's own fold, not to the panel — 356 §4: an assertion can be satisfied by a
    // neighbouring element, and the file's NAME appears in the row above as part of its path.
    expect(fold?.querySelector('.note-file')?.textContent).toContain('auth.json')
  })

  it('⛔ the cwd row says the files found there are the PROJECT’s (356 §3, from 357)', async () => {
    const { host, q } = panel()

    expect(host.querySelector('[data-cy="info-note-cwd"]')).toBeNull()
    q('info-why-cwd').click()
    await nextTick()

    expect(host.querySelector('[data-cy="info-note-cwd"]')?.textContent).toContain(
      "Instruction files found here are the project's",
    )
  })

  it('🔴 the home row no longer claims an instruction file this app never creates', async () => {
    // The sentence that used to sit on this row read "this home, its own CLAUDE.md, and what it
    // remembers across every project". 357 measured that this app authors no profile instruction
    // leaf on EITHER provider, and one of the two never reads that name from a home at all.
    const { host, q } = panel()

    q('info-why-home').click()
    await nextTick()

    const said = host.textContent ?? ''
    expect(said).not.toContain('its own CLAUDE.md')
    // …and all three things a profile owns are still said, in the launcher's own words, so this is
    // a correction rather than a deletion. (That the two surfaces really match is asserted where the
    // sources can be read — `the-layer-a-file-belongs-to.test.ts`.)
    const note = host.querySelector('[data-cy="info-note-home"]')?.textContent?.replace(/\s+/g, ' ')
    expect(note).toContain('the conversations it runs there')
    expect(note).toContain('its own instruction file')
    expect(note).toContain('every folder it works in')
    // The DATA on the row survives: whose home it is, and which variable pins it.
    expect(host.querySelector('[data-cy="session-profile"]')?.textContent).toContain('CODEX_HOME')
  })

  it('⚑ every disclosure starts closed — the default state 356 §1 asks for', async () => {
    // ⚑ **Both surfaces since `527`, and that is a strengthening.** The rule was measured over one
    // mount because there was one; the split put three folds on the index and the rest on the
    // sheet, and a rule checked on only the half that happens to pass is the shape `526` §0.1 was
    // caught by. ⛔ Each surface is asserted to have folds of its OWN, so neither can carry the
    // other's count.
    const index = panel({ instructions: REPORTED }).host
    expect(
      [...index.querySelectorAll('[aria-expanded]')].map((el) => el.getAttribute('aria-expanded')),
      'the index opened one unasked',
    ).not.toContain('true')
    // …and there really were disclosures to be closed.
    expect(
      index.querySelectorAll('[aria-expanded="false"]').length,
      'the index has no disclosure at all',
    ).toBeGreaterThan(2)

    // 🔴 **583 · the sheet's folds are now spread over its tabs, so the rule is walked over ALL of
    // them.** ⛔ **Not a weakening and not a narrowing**: one mount used to hold every fold, so
    // one query answered *did anything open unasked* for the whole sheet. With one tab in the DOM
    // at a time, the same question needs every tab visited — and a run that only looked at the
    // landing tab would let a fold that starts open on `not shown` through, which is precisely
    // the state `356` §1 forbids and the state a person reaches in two clicks. ⚑ The `> 2` bound
    // is the ORIGINAL one and it is still a bound on the sheet, summed rather than per tab: the
    // folds it counted did not disappear, they were dealt out.
    const sheet = told({ instructions: REPORTED }).host
    const tabs = [...sheet.querySelectorAll('[data-cy="told-tabs"] [role="tab"]')].map((el) =>
      el.getAttribute('data-cy'),
    )
    expect(tabs.length, 'the sheet drew no tab strip, so this walked nothing').toBeGreaterThan(1)
    let closed = 0
    for (const tab of tabs) {
      await press(sheet, tab!)
      // ⛔ **The press is asserted to have LANDED, and without this the walk is a fiction.** A
      // `pick` that stopped switching would leave the landing tab on screen for every iteration,
      // and its one closed fold counted four times would clear the bound below while five folds
      // on three other tabs went unread — the loop measuring the same panel over and over.
      expect(
        sheet.querySelector(`[data-cy="${tab!}"]`)?.getAttribute('aria-selected'),
        `pressing ${tab!} did not select it`,
      ).toBe('true')
      expect(
        [...sheet.querySelectorAll('[aria-expanded]')].map((el) =>
          el.getAttribute('aria-expanded'),
        ),
        `the sheet opened one unasked on ${tab!}`,
      ).not.toContain('true')
      closed += sheet.querySelectorAll('[aria-expanded="false"]').length
    }
    expect(closed, 'the sheet has no disclosure at all').toBeGreaterThan(2)
  })
})

/* --------------------------------------------------------------------- the two affordances */

describe('two affordances, and the panel says which is which (356 §1)', () => {
  it('⛔ no button at all when the panel has no door to open', async () => {
    // ⚑ **The two affordances live on two surfaces since `527`**, and each is paired against a row
    // on its OWN surface — an absence paired against a row somebody else drew proves nothing.
    const index = panel({ instructions: REPORTED })
    expect(index.host.querySelector('[data-cy="info-reveal-cwd"]')).toBeNull()
    // ⛔ **556: each pair reads the row it is paired against.** *No button at all* is a claim about
    // a row a person is looking at, and a row present-but-blank would carry no button either.
    expect(index.host.querySelector('[data-cy="session-cwd"]')?.textContent).toContain(
      '/work/checkout',
    )

    const sheet = told({ instructions: REPORTED })
    // ⚑ **583 · the provider-reported rows are on the `not-held` tab.** ⛔ **The press comes
    // FIRST, and 556's rule is why**: on the landing tab there is no `provider-open` because there
    // is no provider row either, so the absence below would be satisfied by a panel that draws
    // nothing at all. The pairing that makes it a measurement — the two paths — is on the same
    // tab, read after the same press.
    await press(sheet.host, 'told-tab-not-held')
    expect(sheet.host.querySelector('[data-cy="provider-open"]')).toBeNull()
    expect(
      [...sheet.host.querySelectorAll('[data-cy="provider-instruction"] .path')].map(
        (el) => el.textContent,
      ),
    ).toEqual(['/homes/default/codex/AGENTS.md', '/work/checkout/AGENTS.md'])
  })

  it('⛔ …and ONE door open does not draw the other one', async () => {
    // 🔴 **Found by 356's own mutation table**: the row that removed `Open`'s condition SURVIVED,
    // because the test above supplies neither callback and the `.acts` wrapper hides the whole pair.
    // A mount with exactly one of them is the state where the two conditions DIVERGE — and it is a
    // real state, since either callback can be absent on its own.
    const onRevealPath = async (): Promise<RevealResult> => ({ ok: true, path: '/x' })
    const { host } = told({ instructions: REPORTED }, { onRevealPath })
    // ⚑ **583 · on the `not-held` tab, where the provider rows are drawn.**
    await press(host, 'told-tab-not-held')

    expect(host.querySelector('[data-cy="provider-open"]')).toBeNull()
    // …and the affordance that IS wired is drawn, so this is one button missing rather than both.
    // ⛔ **556: the button is read by its word.** Two of something is not two of *Finder*, and the
    // whole point of this pair is that a person can still see the affordance that survived.
    expect(host.querySelectorAll('[data-cy="provider-reveal"]').length).toBe(2)
    expect(host.querySelector('[data-cy="provider-reveal"]')?.textContent).toContain(
      fileManagerWord(navigator.platform),
    )
  })

  it('⛔ Finder names the ROW, never a path', async () => {
    // The whole security shape of 356 §1 in one assertion: what crosses the boundary is which row
    // was pressed. A component that sent `{ path }` would be an arbitrary-path reveal with a
    // friendly name.
    const asked: SessionPathTarget[] = []
    const onRevealPath = async (target: SessionPathTarget): Promise<RevealResult> => {
      asked.push(target)
      return { ok: true, path: 'whatever main resolved' }
    }
    const { q } = panel({ instructions: REPORTED }, { onRevealPath })

    q('info-reveal-cwd').click()
    q('info-reveal-home').click()
    q('info-reveal-config-auth.json').click()
    await nextTick()

    expect(asked).toEqual([{ of: 'cwd' }, { of: 'home' }, { of: 'config-file', name: 'auth.json' }])
  })

  it('⚠️ a config file that is not there has no Finder button, and says it is not there', () => {
    const onRevealPath = async (): Promise<RevealResult> => ({ ok: true, path: '/x' })
    const { host } = panel({}, { onRevealPath })

    expect(host.querySelector('[data-cy="info-reveal-config-config.toml"]')).toBeNull()
    expect(host.querySelector('[data-cy="config-file-config.toml"]')?.textContent).toContain(
      'not present',
    )
    // …and the file that IS there has one, so the absence above is about existence.
    expect(host.querySelector('[data-cy="info-reveal-config-auth.json"]')).not.toBeNull()
  })

  it('⛔ a refusal lands on the row that was pressed', async () => {
    const onRevealPath = async (): Promise<RevealResult> => ({ ok: false, reason: 'gone' })
    const { host, q } = panel({}, { onRevealPath })

    expect(host.querySelector('[data-cy="info-refusal"]')).toBeNull()
    q('info-reveal-home').click()
    await nextTick()
    await nextTick()

    const refusal = host.querySelector('[data-cy="info-refusal"]')
    expect(refusal?.textContent).toContain('nothing there any more')
    // ⛔ **On the home row and nowhere else.** A refusal drawn under every path would tell a reader
    // that three files were missing when one was.
    expect(host.querySelectorAll('[data-cy="info-refusal"]').length).toBe(1)
    // ⛔ **Scoped by the row's OWN hook, not by a path that two rows share.** `/homes/default/codex`
    // is a prefix of the config row's `auth.json`, so a refusal that landed in the config row would
    // have satisfied a `toContain` on it — found reviewing this file.
    expect(refusal?.closest('dd')?.querySelector('[data-cy="session-home"]')).not.toBeNull()
    expect(refusal?.closest('dd')?.querySelector('[data-cy="session-config"]')).toBeNull()
  })

  it('⛔ …and a CONFIG refusal lands inside the file’s own row, not under the block', async () => {
    // 🔴 Found reviewing this dispatch's own diff: the config row holds several files, so a refusal
    // keyed to the section would say *one of these is gone* and leave the reader to guess which.
    const onRevealPath = async (): Promise<RevealResult> => ({ ok: false, reason: 'gone' })
    const { host, q } = panel({}, { onRevealPath })

    q('info-reveal-config-auth.json').click()
    await nextTick()
    await nextTick()

    const row = host.querySelector('[data-cy="config-file-auth.json"]')
    expect(row?.querySelector('[data-cy="info-refusal"]')?.textContent).toContain(
      'nothing there any more',
    )
    // …and the OTHER config row says nothing, which is what makes the placement a measurement.
    expect(
      host.querySelector('[data-cy="config-file-config.toml"] [data-cy="info-refusal"]'),
    ).toBeNull()
  })
})

/* ------------------------------------------------------------------ the preview, in place */

describe('a provider-reported file opens on the app’s own paper (356 §2)', () => {
  const read =
    (over: Partial<Extract<InstructionSourceResult, { ok: true }>> = {}) =>
    async (index: number): Promise<InstructionSourceResult> => ({
      ok: true,
      path: REPORTED.provider[index]!.path,
      name: 'AGENTS.md',
      text: '# Project instructions\n\nEnd every reply with WORKER.',
      truncated: false,
      bytes: 46,
      ...over,
    })

  it('⛔ the text is behind a press — the path is what the row shows', async () => {
    const { host, all } = told({ instructions: REPORTED }, { onReadInstruction: read() })
    // ⚑ **583 · the provider rows moved to the `not-held` tab, and the negative is taken THERE.**
    // ⛔ Read on the landing tab it would be an absence on a panel that draws no provider row at
    // all — true, and about nothing. Here the row is on screen, closed, which is the state
    // *"the text is behind a press"* is a claim about.
    await press(host, 'told-tab-not-held')
    expect(all('provider-instruction').length, 'the provider rows are not on this tab').toBe(2)

    expect(host.textContent).not.toContain('End every reply with WORKER.')
    all('provider-open')[1]?.click()
    await nextTick()
    await nextTick()

    expect(host.textContent).toContain('End every reply with WORKER.')
  })

  it('⛔ …and it opens on the standard paper, with both views', async () => {
    // 356 §2: *"BroBot has a document-viewer standard and it is not negotiable: Markdown / Raw
    // views, on a white paper background… do not fork a second viewer."*
    const { host, all } = told({ instructions: REPORTED }, { onReadInstruction: read() })
    // ⚑ **583 · the provider rows are on the `not-held` tab.**
    await press(host, 'told-tab-not-held')

    all('provider-open')[0]?.click()
    await nextTick()
    await nextTick()

    const paper = host.querySelector('[data-cy="provider-read"] [data-cy="document-body"]')
    expect(paper).not.toBeNull()
    expect(paper?.hasAttribute('data-on-white')).toBe(true)
    expect(paper?.querySelector('[data-cy="doc-view-markdown"]')).not.toBeNull()
    expect(paper?.querySelector('[data-cy="doc-view-raw"]')).not.toBeNull()
  })

  it('🔴 …and says the bytes are TODAY’s, not the ones the provider loaded', async () => {
    // 357: "the preview must say **current file bytes**, not claim they are the exact bytes from
    // launch." Without this the panel would be doing precisely what `SessionInfo`'s own comment
    // forbids — showing today's file beside a conversation had with the one it was handed.
    const { host, all } = told({ instructions: REPORTED }, { onReadInstruction: read() })
    // ⚑ **583 · the provider rows are on the `not-held` tab.**
    await press(host, 'told-tab-not-held')

    all('provider-open')[0]?.click()
    await nextTick()
    await nextTick()

    expect(host.querySelector('[data-cy="provider-read"]')?.textContent).toContain(
      'not necessarily the text the provider loaded at launch',
    )
  })

  it('⛔ the read names the ROW’s index — the confinement, from this side of it', async () => {
    const asked: number[] = []
    const { host, all } = told(
      { instructions: REPORTED },
      {
        onReadInstruction: async (index: number): Promise<InstructionSourceResult> => {
          asked.push(index)
          return { ok: false, reason: 'gone' }
        },
      },
    )
    // ⚑ **583 · the provider rows are on the `not-held` tab.** ⛔ **And the index the press sends
    // is still the index into `instructions.provider`, not a position within a tab** — which is
    // the whole confinement: the row names itself and the caller resolves the path.
    await press(host, 'told-tab-not-held')

    all('provider-open')[1]?.click()
    await nextTick()

    expect(asked).toEqual([1])
  })

  it('⚠️ a refusal is a sentence, not an empty paper', async () => {
    const { host, all } = told(
      { instructions: REPORTED },
      {
        onReadInstruction: async (): Promise<InstructionSourceResult> => ({
          ok: false,
          reason: 'not-readable',
        }),
      },
    )
    // ⚑ **583 · the provider rows are on the `not-held` tab.**
    await press(host, 'told-tab-not-held')

    all('provider-open')[0]?.click()
    await nextTick()
    await nextTick()

    const read = host.querySelector('[data-cy="provider-read"]')
    // ⚑ 731 · re-aimed, never loosened: the refusal is about what can be DRAWN now, not a policy.
    expect(read?.textContent).toContain('it cannot be shown as text here')
    expect(read?.textContent).not.toContain('will not open that file')
    expect(read?.querySelector('[data-cy="document-body"]')).toBeNull()
  })
})

describe('a disclosure is only drawn where it has something to disclose', () => {
  it('⛔ a session with injected files and no provider list draws no "what this is"', async () => {
    // Found in review: `anything` is true for a session with injected files alone, and such a
    // session has neither a provider list nor a note — so the button would have opened an empty box.
    //
    // 🔴 **583 retired `anything` itself** — *"the boolean gated one `instructions` section over
    // four empty lists; every group now decides for itself from what is in it"* — but the DEFECT
    // this test was written for is unchanged and still reachable: `instructions-why` is drawn on
    // `as sent` under its own `v-if="provider.length > 0 || note"`, and a condition widened there
    // would open the same empty box. ⛔ **So the absence is asserted ON `as sent`**; read on the
    // landing tab it would be an absence of a fold that is not on that tab either way, which is
    // an assertion satisfied by a neighbour rather than a measurement.
    const injected: SessionInstructions = {
      ...NOTHING,
      injected: [
        {
          kind: 'project-memory',
          path: '/work/checkout/CLAUDE.md',
          text: 'be brief',
          bytes: 8,
          truncated: false,
        },
      ],
    }
    const { host } = told({ instructions: injected })
    await press(host, 'told-tab-as-sent')

    expect(host.querySelector('[data-cy="instructions-why"]')).toBeNull()
    // ⚑ **442 · and the COMPOSITION row's own disclosure is a DIFFERENT button** — it explains how
    // the layers are ordered and is drawn on every conversation, so one gate shared between two
    // folds with different subjects would have hidden whichever of them was true. ⛔ **Both are
    // on `as sent` since `583`**, which is what makes the pair readable in one press: the two
    // buttons are siblings, so *this one and not that one* is a claim about one screen.
    expect(host.querySelector('[data-cy="told-why"]')).not.toBeNull()
    // …and the block itself IS on screen, so this is a missing button rather than a missing block.
    expect(host.querySelector('[data-cy="session-instructions"]')).not.toBeNull()
    // 🔴 **583 · the file's row is on its owner's tab, and its PATH is behind the row's press.**
    // ⛔ **Both halves are kept rather than one traded for the other.** A `CLAUDE.md` on the cwd
    // chain belongs to `the-place` (`HO-009` §3: *"Belongs to the place, not the agent"*), so the
    // row is asserted to be there and to be that kind — `data-kind`/`data-whose` rather than the
    // heading, which is `163`'s rule — and then opened, because the full path moved inside
    // `.opened` when seven sections of one bundle started printing a 104-character path seven
    // times. ⚠️ The original claim was *the block is on screen with its real path on it*; it is
    // the same claim, one press deeper.
    await press(host, 'told-tab-the-place')
    const row = host.querySelector('[data-cy="told-block"][data-kind="project-memory"]')
    expect(row, 'the injected file is on no tab at all').not.toBeNull()
    expect(row?.getAttribute('data-whose')).toBe('the-place')
    row!.querySelector<HTMLButtonElement>('[data-cy="told-block-toggle"]')!.click()
    await nextTick()
    expect(row?.textContent).toContain('/work/checkout/CLAUDE.md')
  })

  it('⚑ …and a session whose note explains where the walk stopped does draw one', async () => {
    // The paired positive, on the same shape: a note alone is enough to have something to say.
    // ⚑ **On the same tab as the negative above** (`583`), so the pair differs in one fact — the
    // note — and in nothing else.
    const withNote: SessionInstructions = {
      ...NOTHING,
      injected: [
        {
          kind: 'project-memory',
          path: '/work/checkout/CLAUDE.md',
          text: 'be brief',
          bytes: 8,
          truncated: false,
        },
      ],
      note: 'read at launch; searched 2 directories',
    }
    const { host } = told({ instructions: withNote })
    await press(host, 'told-tab-as-sent')

    expect(host.querySelector('[data-cy="instructions-why"]')).not.toBeNull()
    // ⛔ **…and it really opens on the note**, which is what makes the button's presence mean
    // *there is something to disclose* rather than *there is a button*.
    await press(host, 'instructions-why')
    expect(host.querySelector('[data-cy="instructions-note"]')?.textContent).toContain(
      'read at launch; searched 2 directories',
    )
  })
})

/* ------------------------------------------------- what belongs to ONE conversation */

describe('state does not outlive the conversation it belongs to', () => {
  /** A drawer whose session can be swapped in place — which is what the app really does. */
  function swappable(first: CreatedSession): {
    host: HTMLElement
    show: (next: CreatedSession) => Promise<void>
  } {
    const session = ref(first)
    const view = mount(
      defineComponent({
        setup() {
          return () =>
            h(SessionDrawer as never, {
              ...drawerProps({
                tab: 'info',
                session: session.value,
                onReadInstruction: async (): Promise<InstructionSourceResult> => ({
                  ok: true,
                  path: '/homes/default/codex/AGENTS.md',
                  name: 'AGENTS.md',
                  text: 'A CONVERSATION AGO',
                  truncated: false,
                  bytes: 18,
                }),
                onRevealPath: async (): Promise<RevealResult> => ({ ok: false, reason: 'gone' }),
              }),
            })
        },
      }),
      {},
      { width: 380, height: 900 },
    )
    return {
      host: view.host,
      show: async (next) => {
        session.value = next
        await nextTick()
        await nextTick()
      },
    }
  }

  /**
   * ⚑ **The same swap, on the sheet** (`527`). `SessionInstructions` resets on its `instructions`
   * OBJECT — *"a launch fact, replaced only when the conversation is"* — so the thing that has to
   * change identity is that prop, which is exactly what the pane hands the sheet when the active
   * conversation changes. ⛔ A new object with the same contents is the real case: `{ ...REPORTED }`
   * below is a different conversation's instructions that happen to say the same thing.
   */
  function swappableTold(first: SessionInstructions): {
    host: HTMLElement
    show: (next: SessionInstructions) => Promise<void>
  } {
    const instructions = ref(first)
    const view = mount(
      defineComponent({
        setup() {
          return () =>
            h(AgentInstructionsSheet as never, {
              ...toldProps(instructions.value, {
                onReadInstruction: async (): Promise<InstructionSourceResult> => ({
                  ok: true,
                  path: '/homes/default/codex/AGENTS.md',
                  name: 'AGENTS.md',
                  text: 'A CONVERSATION AGO',
                  truncated: false,
                  bytes: 18,
                }),
                onRevealPath: async (): Promise<RevealResult> => ({ ok: false, reason: 'gone' }),
              }),
            })
        },
      }),
      {},
      { width: 760, height: 900 },
    )
    return {
      host: view.host,
      show: async (next) => {
        instructions.value = next
        await nextTick()
        await nextTick()
      },
    }
  }

  const A: CreatedSession = { ...META, config: CONFIG, instructions: REPORTED }
  const B: CreatedSession = { ...A, sessionId: 'sess_2', instructions: { ...REPORTED } }

  it('🔴 an open preview does not follow you into the next conversation', async () => {
    // ⛔ Nothing between `RuntimeScreen` and this component carries a `:key`, so the session is
    // swapped in place — and `reading` is keyed by INDEX. Without the reset, row 0 of the NEXT
    // conversation shows the previous one's bytes under the sentence "Read just now, from disk".
    const { host, show } = swappableTold(A.instructions)

    // ⚑ **583 · the preview lives on the `not-held` tab.**
    await press(host, 'told-tab-not-held')
    host.querySelectorAll<HTMLButtonElement>('[data-cy="provider-open"]')[0]!.click()
    await nextTick()
    await nextTick()
    expect(host.textContent, 'the preview did not open at all').toContain('A CONVERSATION AGO')

    await show(B.instructions)

    // …and the block is still on screen, so this is a reset rather than an unmount. ⚑ Paired on the
    // sheet's own unconditional row since `527`, because that is the surface the reset happens on.
    expect(host.querySelector('[data-cy="told-tabs"]')).not.toBeNull()

    // 🔴 **583 · the absence is read back ON THE TAB THE PREVIEW WAS ON, and that is the whole
    // point of this test rather than a detail of it.** ⛔ The watcher also clears `tab`, so the
    // new conversation lands on its first owner — and a `not.toContain` taken there would pass on
    // a component that reset NOTHING but the tab, which is exactly the defect: `reading` is keyed
    // by INDEX, and a person two clicks away would be reading the previous conversation's file
    // under the sentence *"Read just now, from disk"*. ⚑ Pressing back is what a person does, and
    // it is the only place the stale read could still be shown.
    await press(host, 'told-tab-not-held')
    expect(host.textContent).not.toContain('A CONVERSATION AGO')
    expect(host.querySelector('[data-cy="provider-read"]')).toBeNull()
    // ⛔ **…and the rows the preview hangs off ARE drawn on that tab**, so the two absences above
    // are about a closed preview rather than about a tab that came back empty.
    expect(host.querySelectorAll('[data-cy="provider-instruction"]').length).toBe(2)

    // ⚑ **And the account of the composition survived the swap too** — the unconditional row this
    // pairing has used since `527`, now one tab over.
    await press(host, 'told-tab-as-sent')
    expect(host.querySelector('[data-cy="told-composition"]')).not.toBeNull()
  })

  it('🔴 …nor does a refusal, nor an opened fold', async () => {
    const { host, show } = swappable(A)

    host.querySelector<HTMLButtonElement>('[data-cy="info-reveal-home"]')!.click()
    host.querySelector<HTMLButtonElement>('[data-cy="info-why-config"]')!.click()
    await nextTick()
    await nextTick()
    // ⛔ **556: what the swap CLEARS has to have been readable first.** Two `not.toBeNull()`s are
    // satisfied by an empty refusal and an empty fold, and then the two absences below measure the
    // reset of nothing. ⚑ **The refusal's own words** — `REVEAL_WORDS.gone`, which is what the
    // stubbed `onRevealPath` above earns — **and the fold's first line**, which is `CONFIG.model`.
    expect(host.querySelector('[data-cy="info-refusal"]')?.textContent).toContain(
      'there is nothing there any more',
    )
    expect(host.querySelector('[data-cy="info-note-config"]')?.textContent).toContain(CONFIG.model)

    await show(B)

    expect(host.querySelector('[data-cy="info-refusal"]')).toBeNull()
    expect(host.querySelector('[data-cy="info-note-config"]')).toBeNull()
  })

  it('⚑ …but a re-read of the SAME conversation leaves what you opened open', async () => {
    // ⛔ **The paired positive, and the one that makes the reset a measurement.** `refreshConfig`
    // replaces `meta` with a spread — a NEW session object carrying the SAME `instructions` — and a
    // reset keyed on the object rather than on identity would close a fold under somebody's hands
    // every time the config block re-read the disk.
    const { host, show } = swappable(A)

    host.querySelector<HTMLButtonElement>('[data-cy="info-why-config"]')!.click()
    await nextTick()
    expect(host.querySelector('[data-cy="info-note-config"]')).not.toBeNull()

    await show({ ...A, config: { ...CONFIG, authNote: 're-read just now' } })

    expect(host.querySelector('[data-cy="info-note-config"]')).not.toBeNull()
  })
})

/* ------------------------------------------------------------------------------ layout */

describe('the panel does not clip at either drawer width (356 §4)', () => {
  const everything: CreatedSession = {
    ...META,
    config: CONFIG,
    cwd: '/work/checkout/a-really-quite-long-directory-name-that-somebody-actually-has',
    instructions: REPORTED,
  }

  const overflow = (host: HTMLElement): number => {
    const body = host.querySelector<HTMLElement>('.drawer-body')
    expect(body, 'the drawer body is not in the DOM, so this measured nothing').not.toBeNull()
    return body!.scrollWidth - body!.clientWidth
  }

  it.each([
    ['comfortable', 380],
    ['narrow', 320],
  ])('⛔ nothing escapes the %s column', (_fit, width) => {
    const { host } = mount(
      SessionDrawer as never,
      drawerProps({
        tab: 'info',
        session: everything,
        onRevealPath: async (): Promise<RevealResult> => ({ ok: true, path: '/x' }),
        onReadInstruction: async (): Promise<InstructionSourceResult> => ({
          ok: false,
          reason: 'gone',
        }),
      }),
      { width, height: 900 },
    )

    expect(overflow(host)).toBeLessThanOrEqual(1)
  })

  it('⚑ …and the probe can see an overflow when there is one — the planted control', () => {
    // ⛔ Without this the measurement above passes against a drawer body that does not scroll, a
    // panel that never rendered, and a `scrollWidth` that is always its `clientWidth`. The control
    // is trapped exactly the way the subject is: inside the same container, at the same width.
    const { host } = mount(
      SessionDrawer as never,
      drawerProps({ tab: 'info', session: everything }),
      { width: 320, height: 900 },
    )
    const body = host.querySelector<HTMLElement>('.drawer-body')!
    const wide = document.createElement('div')
    wide.style.width = '2000px'
    wide.style.height = '1px'
    body.append(wide)

    expect(overflow(host)).toBeGreaterThan(1000)
  })
})
