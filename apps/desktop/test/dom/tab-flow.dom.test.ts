import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
// The walk is a plain `.mjs` module the live smokes import — deliberately no build step, because a
// harness the scripts cannot `import` is not a harness. `tab-flow.d.mts` beside it is what makes
// that importable from TypeScript, rather than a `@ts-expect-error` on this line — which prettier
// is free to reformat away from the import it was suppressing, and did.
import {
  APP_WIDE_HOOKS,
  TAB_OF_HOOK,
  TAB_OF_HOOK_PREFIX,
} from '../../../../scripts/lib/tab-flow.mjs'
import AgentInstructionsSheet from '../../src/renderer/src/components/AgentInstructionsSheet.vue'
import AgentBookButton from '../../src/renderer/src/components/AgentBookButton.vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { DRAWER_TABS, type DrawerTab } from '../../src/renderer/src/lib/drawer'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
} from '../../src/renderer/src/lib/transcript'
import type { CreatedSession } from '../../src/shared/runtime-ipc'
import type { WhoCalledWhom } from '../../src/shared/who-called-whom'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { META, drawerProps, mount, toldProps, unmountAll } from './harness'

/**
 * **The tab-flow table, checked against the app it describes** (097, from 083 §5.6).
 *
 * 083 proved that each tab mounts its own hooks and nobody else's. What it left open was the walk:
 * *"what I did not build is the walk that says 'this step reads an Info row while sitting on
 * Events'."* That walk lives in `scripts/lib/tab-flow.mjs` and needs a table of who owns what.
 *
 * ⚠️ **A hand-written ownership table that nothing checks is worse than no table**: it would drift
 * the moment a hook moved tabs, and a drifted table fails correct steps while passing the ones it
 * exists to catch. So the table is checked HERE, in a real engine, against what the drawer actually
 * mounts — both directions, because each catches a different kind of drift.
 *
 * This is deliberately a second file rather than more assertions in `drawer-tabs.dom.test.ts`: that
 * one is about the app (one body at a time, a click moves it), and this one is about the harness
 * agreeing with the app. If the drawer breaks, both fail and the first says why; if only the table
 * is stale, only this one fails.
 */

afterEach(() => {
  unmountAll()
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
})

/**
 * 🔴 **547 · the Open tab's relationship band, drawn rather than left cold.**
 *
 * ⛔ **A fixture that leaves a tab's body in its empty state measures a tab the app does not
 * draw**, and the coverage floor below is what says so: with the band cold it contributed two of
 * its thirty-six hooks and the check ran over less than half the table. ⚑ Same discovery as
 * {@link INFO_FIXTURE}'s, one tab over — and the same repair.
 *
 * ⚠️ **Every list is short by one on purpose**, so the three *could not be read* treatments are on
 * screen beside the rows: a state the band really reaches, and the only way those hooks are ever
 * swept. ⛔ The doubts, the empties and the refusal are mutually exclusive with rows and stay in
 * the `unrendered` report, which is what that report is for.
 */
const CAST: WhoCalledWhom = {
  conversation: META.sessionId,
  parent: {
    conversation: 'sess_parent',
    identity: 'default',
    provider: 'claude',
    running: 'in-a-window',
  },
  children: {
    rows: [
      {
        conversation: 'sess_pm',
        identity: 'project-manager',
        provider: 'claude',
        running: 'unwatched',
      },
    ],
    walk: 'every-conversation-this-one-spawned',
    ledgers: 1,
    rowsUnread: 1,
  },
  workGivenOut: {
    rows: [
      {
        piece: 'work_pm',
        label: 'W1.1',
        title: 'read the brief',
        from: META.sessionId,
        fromIdentity: 'default',
        to: 'sess_pm',
        toIdentity: 'project-manager',
        state: 'working',
        givenAt: 1_700_000_000_000,
        endedAt: null,
      },
      {
        piece: 'work_peer',
        label: 'W1.2',
        title: 'and a peer',
        from: META.sessionId,
        fromIdentity: 'default',
        to: 'sess_peer',
        toIdentity: 'peer',
        state: 'working',
        givenAt: 1_700_000_000_000,
        endedAt: null,
      },
    ],
    walk: 'every-conversation-this-one-gave-work-to',
    ledgers: 2,
    rowsUnread: 1,
  },
  workTakenIn: {
    rows: [
      {
        piece: 'work_in',
        label: 'W2.1',
        title: 'the work this one was given',
        from: 'sess_parent',
        fromIdentity: 'default',
        to: META.sessionId,
        toIdentity: 'project-manager',
        state: 'working',
        givenAt: 1_700_000_000_000,
        endedAt: null,
      },
    ],
    walk: 'every-piece-of-work-this-one-was-given',
    ledgers: 1,
    rowsUnread: 1,
  },
  // ⚠️ **Older than one poll**, so the band draws the age line it is required to draw.
  readAt: 1_700_000_000_000,
}

/**
 * ⚑ **What the Info tab needs to draw more than half its table** (356).
 *
 * ⛔ **The shared `drawerProps` renders EMPTY instructions and passes no callbacks**, which is right
 * for every other file here — a session told nothing extra must render nothing — and made this
 * fixture unable to see fourteen of the hooks 356 added: the folds, the two affordances, and the
 * provider block. The coverage floor below caught it, which is what the floor is for.
 *
 * ⚠️ **Deliberately NOT an opened preview.** Pressing `provider-open` mounts a `DocumentBody`, whose
 * hooks belong to a component six surfaces outside the drawer render — the exempt-list rule two
 * tests up. The folds and the buttons are enough, and they are all hooks the table claims.
 */
const INFO_FIXTURE: CreatedSession = {
  ...META,
  config: {
    ...META.config,
    files: [
      { name: 'auth.json', path: '/homes/claude/auth.json', exists: true, note: 'the credential' },
    ],
  },
  instructions: {
    ...META.instructions,
    provider: [{ path: '/work/checkout/AGENTS.md', scope: 'project' }],
    refused: [{ path: '/work/checkout/.claude/CLAUDE.md', reason: 'symlink' }],
    note: 'read at launch; searched 2 directories',
  },
}

/**
 * ⚑ **739 · a grant *Always allow* kept in this conversation**, so Info draws its row and its fold
 * (`info-kept`, `info-why-kept`, `info-note-kept` — `736` F-1, *"disclose kept grants apart from
 * conversation grants"*) and the table's three claims for them are swept rather than reported as
 * unrendered. ⚑ The drawer reads it off its control projection (`state`), as the app's does: one
 * Claude card answered `allow_always`, with the rule and the file it was kept in — `740`'s MEASURED
 * `make build` card (R99: kept in the project's `.claude/settings.local.json`; an `rm`, which `739`
 * round 1 built here, is offered no *Always allow* since `740`).
 */
function keptHere(): TranscriptState {
  const state = createTranscript()
  const rule = { kind: 'tool' as const, tool: 'Bash', content: 'make build *' }
  applyEvent(state, {
    type: 'permission_request',
    id: 'req_kept',
    kind: 'command',
    action: 'Bash',
    detail: 'make build',
    scope: {
      cwd: '/work/checkout',
      paths: [],
      networkHosts: [],
      persistence: 'always',
      grants: {
        allow_for_session: [rule],
        allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }],
        allow_always: [rule],
        alwaysFile: '/work/checkout/.claude/settings.local.json',
      },
      amendments: [],
      availableDecisions: [
        'allow',
        'allow_for_session',
        'allow_all_for_session',
        'allow_always',
        'deny',
        'cancel',
      ],
      underDisclosed: true,
    },
  })
  applyEvent(state, {
    type: 'user_decision',
    requestId: 'req_kept',
    outcome: 'allow_always',
    by: { who: 'a-person' },
  })
  return state
}

const Harness = defineComponent({
  setup() {
    const tab = ref<DrawerTab>('open')
    const cast = useWhoCalledWhom()
    // ⚑ **632 · no reading of what each conversation is doing** — this file is about the TABS, and
    // a band with none draws the faceless plate it drew before `632`.
    cast.reading.value = { conversation: META.sessionId, read: CAST, answered: true, atWork: null }
    // ⚑ **A press is supplied**, because `cast-press` is a hook the drawer really mounts and a band
    // with no screen above it draws none (`118`).
    cast.goTo.value = () => {}
    return () =>
      h(SessionDrawer as never, {
        ...drawerProps({
          tab: tab.value,
          session: INFO_FIXTURE,
          state: keptHere(),
          // ⚑ **718 · a live conversation behind the drawer, with its capabilities**, so R60's
          // *Compact now…* is offered and its confirm can be opened — the five hooks it draws are
          // then swept like every other (`718`'s review: a disabled control hid them).
          capabilities: CAPABILITY_FIXTURE,
          compaction: {
            state: 'idle',
            closing: false,
            signInSuperseded: false,
            hasQueued: false,
            compactionIsWaiting: false,
            who: 'BroBot',
          },
          onReadInstruction: async () => ({ ok: false as const, reason: 'gone' as const }),
          onRevealPath: async () => ({ ok: false as const, reason: 'gone' as const }),
          // ⚑ **733 · the config row's Open**, so the sweep mounts `info-open-config-<name>`.
          onReadConfigFile: async () => ({ ok: false as const, reason: 'gone' as const }),
        }),
        'onUpdate:tab': (next: DrawerTab) => {
          tab.value = next
        },
      })
  },
})

/**
 * Open every disclosure in the body, so a hook that is only drawn behind one is swept.
 *
 * ⛔ **Presses only what the TABLE claims** — `[data-cy^="info-why-"]` and `instructions-why` — so
 * this cannot smuggle an unclaimed hook onto the screen and make the exempt-list rule pass over it.
 * ⚑ `718`'s `context-compact-now` left with the Context tab (W4.208): it is in a popup now.
 */
async function openDisclosures(host: HTMLElement): Promise<void> {
  const body = host.querySelector('.drawer-body')
  if (!body) return
  for (const button of body.querySelectorAll<HTMLElement>(
    '[data-cy^="info-why-"], [data-cy="instructions-why"]',
  )) {
    button.click()
  }
  await nextTick()
}

async function bodyHooks(host: HTMLElement): Promise<Set<string>> {
  await openDisclosures(host)
  const body = host.querySelector('.drawer-body')
  expect(body, 'no .drawer-body — the drawer did not render its tab body at all').not.toBeNull()
  return new Set([...body!.querySelectorAll('[data-cy]')].map((el) => el.getAttribute('data-cy')!))
}

async function show(host: HTMLElement, tab: DrawerTab): Promise<Set<string>> {
  const button = host.querySelector<HTMLElement>(`[data-cy="drawer-tab-${tab}"]`)
  expect(button, `no [data-cy=drawer-tab-${tab}] to click`).not.toBeNull()
  button!.click()
  await nextTick()
  expect(button!.dataset.active, `clicking drawer-tab-${tab} did not select it`).toBe('true')
  return await bodyHooks(host)
}

/** Everything the drawer mounts, tab by tab, from the real component tree. */
async function mountedByTab(host: HTMLElement): Promise<Map<DrawerTab, Set<string>>> {
  const byTab = new Map<DrawerTab, Set<string>>([['open', await bodyHooks(host)]])
  for (const tab of DRAWER_TABS.filter((t) => t.id !== 'open')) {
    byTab.set(tab.id, await show(host, tab.id))
  }
  expect(byTab.size, 'a tab was dropped from the sweep').toBe(DRAWER_TABS.length)
  return byTab
}

/** The table's answer for one hook — the same two-step lookup `tabOfHook` does. */
function claimed(hook: string): string | null {
  const exact = TAB_OF_HOOK
  if (Object.hasOwn(exact, hook)) return exact[hook]!
  const prefixes = Object.keys(TAB_OF_HOOK_PREFIX).sort((a, b) => b.length - a.length)
  for (const prefix of prefixes) {
    if (hook.startsWith(prefix)) return TAB_OF_HOOK_PREFIX[prefix]!
  }
  return null
}

describe('the tab-flow table describes the drawer this app actually renders', () => {
  it('the Book control and unread badge are shared hooks, with a real Open-tab entry', async () => {
    const drawer = mount(Harness, {}, { width: 380, height: 700 })
    const byTab = await mountedByTab(drawer.host)
    expect(byTab.get('open')?.has('agent-book-button')).toBe(true)
    for (const [tab, hooks] of byTab) {
      if (tab !== 'open') expect(hooks.has('agent-book-button'), tab).toBe(false)
    }
    const opened: string[] = []
    const button = mount(AgentBookButton, {
      profileSlug: 'quill',
      bridge: { agentRulesUnread: async () => ({ seenThrough: 0, newestDirectVersion: 1, unread: true }) },
      onOpen: (slug: string) => opened.push(slug),
    }, { width: 320, height: 120 })
    await nextTick()
    await nextTick()
    for (const hook of ['agent-book-button', 'agent-book-unread']) {
      expect(button.all(hook)).toHaveLength(1)
      expect(APP_WIDE_HOOKS.has(hook), hook).toBe(true)
      expect(claimed(hook), `${hook} must not require a drawer tab`).toBeNull()
    }
    button.q('agent-book-button').click()
    expect(opened).toEqual(['quill'])
  })

  it('every hook the drawer mounts is claimed by the tab that mounted it', async () => {
    const m = mount(Harness, {}, { width: 380, height: 700 })
    const byTab = await mountedByTab(m.host)

    // Non-vacuity: a sweep that found nothing would satisfy every assertion below.
    const total = [...byTab.values()].reduce((n, hooks) => n + hooks.size, 0)
    expect(total, 'the sweep mounted no hooks at all').toBeGreaterThan(20)

    const wrong: string[] = []
    const missing: string[] = []
    const exempt: string[] = []
    for (const [tab, hooks] of byTab) {
      for (const hook of hooks) {
        // ⚠️ **A hook can be inside a tab body and still belong to no tab** — `AgentState` is drawn
        // by the rail, the header, the activity pill and every sub-agent entry too. Mounting the
        // drawer cannot see that, which is why the exemption is a named list checked elsewhere
        // (`scripts/test/tab-flow.reach.test.mjs`) rather than a silent gap here.
        if (APP_WIDE_HOOKS.has(hook)) {
          exempt.push(hook)
          continue
        }
        const owner = claimed(hook)
        if (owner === null) missing.push(`${hook} (mounted by ${tab}, claimed by nobody)`)
        else if (owner !== tab) wrong.push(`${hook} (mounted by ${tab}, table says ${owner})`)
      }
    }
    expect(missing, 'hooks the drawer mounts that the walk would not guard').toEqual([])
    expect(wrong, 'hooks the walk would attribute to the wrong tab').toEqual([])
    // The exemption has to be USED, or it has quietly stopped describing this drawer and the next
    // app-wide component to arrive would be waved through by a list that means nothing.
    expect(exempt.length, 'no app-wide hook was found inside the drawer at all').toBeGreaterThan(0)
    // …and it must never be claimed by the table as well: one answer per hook.
    for (const hook of exempt)
      expect(claimed(hook), `${hook} is both exempt and claimed`).toBeNull()
  })

  it('every hook the table claims is one the drawer really mounts on that tab', async () => {
    const m = mount(Harness, {}, { width: 380, height: 700 })
    const byTab = await mountedByTab(m.host)

    /**
     * ⚠️ **Only the hooks this fixture actually renders can be checked**, and pretending otherwise
     * would make the test a lie. `drawerProps` builds one state; entries that need a different one —
     * an empty panel, a dropped-file notice, a compaction row — are not on screen here, and the
     * assertion below is over the intersection rather than the whole table.
     *
     * What it still catches is the drift that matters: a hook that moved from one tab to another
     * appears under its new tab in the sweep, and this side is what notices that the table still
     * files it under the old one. The `unrendered` list is REPORTED rather than asserted, so a
     * future fixture that starts rendering more of them is visible instead of silently ignored.
     */
    const mounted = new Map<string, DrawerTab>()
    for (const [tab, hooks] of byTab) for (const hook of hooks) mounted.set(hook, tab)

    const wrong: string[] = []
    const unrendered: string[] = []
    for (const [hook, tab] of Object.entries(TAB_OF_HOOK)) {
      const where = mounted.get(hook)
      if (where === undefined) unrendered.push(hook)
      else if (where !== tab) wrong.push(`${hook}: table says ${tab}, drawer mounts it on ${where}`)
    }
    expect(wrong, 'the table files a hook under a tab that does not mount it').toEqual([])
    // Positive pair for the negative above: the fixture has to render MOST of the table, or the
    // check ran over almost nothing and the empty `wrong` list means nothing.
    const checked = Object.keys(TAB_OF_HOOK).length - unrendered.length
    expect(
      checked,
      `only ${checked} of the table was on screen: ${unrendered.join(', ')}`,
    ).toBeGreaterThan(Object.keys(TAB_OF_HOOK).length / 2)
  })

  /**
   * 🔴 **527 · re-aimed, and the assertion turned over.**
   *
   * ⛔ **What it pinned:** *every hook the instructions block draws is claimed by `info`*, because
   * the block was welded into `SessionInfo`'s `<dl>` and the Info tab was the only way to reach it.
   * ⚑ **`HO-050` §1.1 moved it to a sheet on the overlay layer**, so the fact changed rather than
   * its spelling — standing rule 26, and the repair is to re-aim rather than to delete.
   *
   * ⛔ **What it pins now:** *not one of them is claimed by any tab.* That is the same instrument
   * measuring the same hazard from the other side. `tabOfHook` answering `info` for a hook the
   * drawer body no longer mounts would send a live step to the Info tab, the read would find
   * nothing, and the step would assert against an absence it caused — 097's class, which this whole
   * table exists to remove. ⚠️ Deleting the test would have left exactly that unguarded.
   *
   * ⚑ **And the entry that REACHES it is the half that stays on the tab**, asserted below: a sheet
   * nothing on the Info tab can open would be the *"separate screen"* the PO ruled against.
   *
   * ⚑ **583 · re-aimed a second time, and the claim is still unchanged.** `HO-073` §4 regrouped
   * the sheet by WHOSE each block is and gave it its OWN tab strip (`told-tab-<key>` inside
   * `told-tabs`) — a second, unrelated set of tabs nested inside the one Info entry this table
   * already treats as opaque. ⛔ **Only one of the sheet's tabs is in the document at a time**, so
   * a fixture that used to see every row in one render now has to press each of the sheet's own
   * tabs before reading — the union across all of them is what "the instructions block's hooks"
   * means now, and `tabOfHook` still has to answer `null` for every one of them. ⚠️ **The
   * `injected-<kind>` family this test used to name by hook is gone**: 583 replaced it with a
   * single `told-block` hook per row plus a `data-kind` attribute, so "a per-file row was drawn"
   * is now read off that attribute rather than off a hook name.
   */
  it('the instructions block’s hooks are claimed by NO tab — asked of the component, not of a list', async () => {
    const instructions = {
      injected: [
        {
          kind: 'profile-memory',
          path: '/homes/claude/CLAUDE.md',
          text: 'hello',
          bytes: 5,
          truncated: false,
        },
        {
          kind: 'project-memory',
          path: '/work/checkout/CLAUDE.md',
          text: 'hello',
          bytes: 5,
          truncated: true,
        },
      ],
      agentMemory: [
        {
          kind: 'agent-memory',
          path: '/homes/claude/memory/MEMORY.md',
          text: 'remembered',
          bytes: 10,
          truncated: false,
          reach: 'prompt',
          link: '/elsewhere/real.md',
        },
      ],
      provider: [{ path: '/work/checkout/AGENTS.md', scope: 'project' as const }],
      refused: [{ path: '/work/checkout/.claude', reason: 'symlink' }],
      note: 'read at launch',
    }
    const sheet = mount(
      AgentInstructionsSheet as never,
      toldProps(instructions as CreatedSession['instructions']),
      { width: 760, height: 900 },
    )

    // ⚑ **583 · every one of the SHEET's own tabs, not the one that happens to land first.**
    // `told-tabs` lists every drawn owner plus `not-read` and `as-sent` in one strip regardless of
    // which is showing, so the keys are read once, up front, and are stable across the presses
    // below — only the panel underneath swaps. Landing on `configured` (this fixture wrote no
    // `factory`-owned file) would on its own see nothing but `told-nothing-of-yours`; the walk
    // this test is guarding is over what the OTHER tabs mount, which a single render cannot show.
    const tabKeys = [...sheet.host.querySelectorAll('[data-cy^="told-tab-"]')].map((el) =>
      el.getAttribute('data-cy')!.slice('told-tab-'.length),
    )
    expect(tabKeys.length, 'the sheet drew no tabs at all').toBeGreaterThan(1)

    const hooks = new Set<string>()
    const kinds = new Set<string>()
    for (const key of tabKeys) {
      sheet.q(`told-tab-${key}`).click()
      await nextTick()
      for (const el of sheet.host.querySelectorAll<HTMLElement>('[data-cy]')) {
        hooks.add(el.getAttribute('data-cy')!)
      }
      // ⚑ **The per-file distinction now lives in an ATTRIBUTE, not a hook name** — `told-block`
      // is one hook shared by every row, and `data-kind` is what used to be spelled
      // `injected-<kind>`. See the docblock above.
      for (const el of sheet.host.querySelectorAll<HTMLElement>('[data-cy="told-block"]')) {
        kinds.add(el.getAttribute('data-kind')!)
      }
    }

    // Non-vacuity first, and it is the assertion that matters most: a fixture the component ignored
    // would render no instruction rows at all and every check below would be over the empty set.
    // ⛔ **`injected-` dropped from the filter** — 583 removed that whole family, so it would only
    // ever match nothing and keeping it would be a filter describing a hook the app no longer has.
    const ours = [...hooks].filter(
      (hook) => hook.startsWith('told-') || hook.includes('instruction'),
    )
    expect(ours.length, 'the fixture rendered no instructions block at all').toBeGreaterThan(8)
    // ⛔ …and the family really is a family: at least one row's `data-kind` carries the kind of
    // file it is — `injected-agent-memory` no longer exists as a hook (see above), so the same
    // claim is made by reading the attribute the replacement row carries.
    expect(kinds, 'no per-file row was drawn').toContain('agent-memory')
    expect(ours, 'the refusal 170 ruled on was not drawn').toContain('refused-instruction')

    const stillClaimed = ours.filter((hook) => claimed(hook) !== null)
    expect(
      stillClaimed,
      'a hook that left the drawer body is still filed under a tab — the walk would send a step to a tab that does not mount it',
    ).toEqual([])

    // ⚑ **The door, which IS on the tab.** The sheet is reachable from the Info tab and from
    // nowhere else, so the entry has to stay claimed or a step could never get to any of the above.
    const drawer = mount(
      defineComponent({
        setup() {
          return () =>
            h(SessionDrawer as never, {
              ...drawerProps({ tab: 'info', session: { ...META, instructions } }),
            })
        },
      }),
      {},
      { width: 380, height: 700 },
    )
    const body = await bodyHooks(drawer.host)
    expect(body, 'the Info tab draws no entry that opens the block').toContain('told-index')
    expect(claimed('told-index')).toBe('info')
  })

  it('the tab strip and the attention chrome are NOT in the table', async () => {
    // The walk must not guard anything outside the drawer body: those hooks are on screen whatever
    // tab is selected, and claiming one would make every step that touches the strip fail.
    const m = mount(Harness, {}, { width: 380, height: 700 })
    const outside = [...m.host.querySelectorAll('[data-cy]')]
      .filter((el) => el.closest('.drawer-body') === null)
      .map((el) => el.getAttribute('data-cy')!)
    expect(
      outside.length,
      'no chrome hooks outside the body — the fixture is not the drawer',
    ).toBeGreaterThan(0)
    for (const hook of outside)
      expect(claimed(hook), `${hook} is chrome, not a body hook`).toBeNull()
  })
})
