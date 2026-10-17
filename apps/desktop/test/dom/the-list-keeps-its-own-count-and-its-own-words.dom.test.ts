import { afterEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'
import SessionDrawer from '../../src/renderer/src/components/SessionDrawer.vue'
import { useWhoCalledWhom } from '../../src/renderer/src/composables/useWhoCalledWhom'
import { DRAWER_W_MIN } from '../../src/renderer/src/lib/drawer'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import type { LedgerWalk, LedgerWalkKind } from '../../src/shared/questions'
import type { AgentIdentity } from '../../src/shared/runtime-ipc'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../../src/shared/who-called-whom'
import { META, allTasks, drawerProps, mount, unmountAll } from './harness'

/**
 * 🔴 **`TaskList.vue`'s own arithmetic and its own words** — the half of `547`/`631` that
 * `the-first-picture-of-who-called-whom.dom.test.ts` pins with a single earlier-open candidate and a
 * single hidden state at a time. ⚠️ **Every fixture there hides at most one state and leaves at most
 * one earlier task open**, so the comma the count line joins on, the plural/singular word, the
 * "keep the newest of several open backlog tasks" branch, the markdown-lead strip and the per-line
 * "who" all run on inputs that never actually exercise them.
 *
 * ⛔ **Copies this file's mount, not its assertions.** `show()`, `answer()`, `walk()`, `edge()`
 * and `identity()` are the same shapes `the-first-picture-of-who-called-whom` builds; only
 * the fixtures below are new, each one built to force a branch the existing suite's fixtures happen
 * to leave untaken.
 *
 * ⚑ **UI-006 · the list has one direction now — the work this conversation was GIVEN** — so every
 * fixture below is a piece given TO it, drawn by the drawer's own *Current task* (`cast-taken`, one
 * `cast-taken-work` row per piece). ⚠️ The test of a line that names nobody (the given list's,
 * beside a taken line naming its giver) went with its subject: every line names who gave it, and
 * the test that replaces it pins which end of the piece that is.
 */

afterEach(() => {
  unmountAll()
  // ⛔ **The channel is a window-level singleton**, so a reading left behind would be the next
  // test's premise.
  const cast = useWhoCalledWhom()
  cast.reading.value = null
  cast.goTo.value = null
})

/** ⚑ A stable instant, so every age below is a fact about the fixture rather than about the clock. */
const NOW = Date.now()

const identity = (slug: string, displayName: string | null = null): AgentIdentity => ({
  id: `aid:${slug}`,
  slug,
  displayName,
  createdAt: NOW - 86_400_000,
  createdBy: null,
  provider: null,
  externalMcpServerIds: [],
  capabilities: { ...DEFAULT_CAPABILITIES },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

/** ⚑ A piece given TO this conversation — the only work the list draws. */
const edge = (over: Partial<WorkEdge> = {}): WorkEdge => ({
  piece: 'work_one',
  label: 'W1.4',
  title: 'read the brief and report',
  from: 'sess_parent',
  fromIdentity: 'default',
  to: META.sessionId,
  toIdentity: 'worker',
  state: 'working',
  givenAt: NOW - 120_000,
  endedAt: null,
  ...over,
})

const walk = <Row>(
  rows: readonly Row[],
  kind: LedgerWalkKind,
  over: Partial<LedgerWalk<Row>> = {},
): LedgerWalk<Row> => ({ rows, walk: kind, ledgers: rows.length, rowsUnread: 0, ...over })

const answer = (over: Partial<WhoCalledWhom> = {}): WhoCalledWhom => ({
  conversation: META.sessionId,
  parent: null,
  children: walk<SpawnEdge>([], 'every-conversation-this-one-spawned'),
  workGivenOut: walk<WorkEdge>([], 'every-conversation-this-one-gave-work-to'),
  workTakenIn: walk<WorkEdge>([], 'every-piece-of-work-this-one-was-given'),
  readAt: NOW,
  ...over,
})

interface Shown {
  read: WhoCalledWhom | null
  identities?: readonly AgentIdentity[] | null
}

async function show(over: Shown) {
  const cast = useWhoCalledWhom()
  cast.reading.value =
    over.read === null
      ? null
      : { conversation: META.sessionId, read: over.read, answered: true, atWork: null }
  cast.goTo.value = null
  // ⚑ **The drawer alone** — its Current task is the one surface that draws `TaskList`, so these
  // are its rules as a person meets them.
  const m = mount(SessionDrawer as never, drawerProps({ identities: over.identities ?? null }), {
    width: DRAWER_W_MIN,
    height: 900,
  })
  // The card shows only the current piece. Test the whole list by pressing “All tasks” and
  // reading its popup.
  if (m.host.querySelector('[data-cy="card-tasks-all"]') === null) return m
  return allTasks(m)
}

/** ⚑ The work this conversation was given, as the walk reads it. */
const takenIn = (rows: readonly WorkEdge[]): LedgerWalk<WorkEdge> =>
  walk(rows, 'every-piece-of-work-this-one-was-given')

describe('"All tasks" — every piece, a filter by state, and a search', () => {
  it('lists every piece, counts each state on its filter, and narrows to what is pressed and typed', async () => {
    const m = await show({
      read: answer({
        workTakenIn: takenIn([
          edge({ piece: 'work_1', label: 'W1.1', title: 'Header', state: 'answered' }),
          edge({ piece: 'work_2', label: 'W1.2', title: 'Menu', state: 'working' }),
          edge({ piece: 'work_3', label: 'W1.3', title: 'Contact form', state: 'answered' }),
        ]),
      }),
    })
    expect(m.all('cast-taken-work')).toHaveLength(3)
    expect(m.q('all-tasks-filter-closed').textContent).toContain('2')
    m.q('all-tasks-filter-closed').click()
    await nextTick()
    expect(m.all('cast-taken-work')).toHaveLength(2)
    expect(m.q('all-tasks-count').textContent?.trim()).toBe('2 tasks')
    const search = m.q('all-tasks-search') as HTMLInputElement
    search.value = 'contact'
    search.dispatchEvent(new Event('input'))
    await nextTick()
    expect(m.all('cast-taken-work')).toHaveLength(1)
    expect(m.q('all-tasks-count').textContent?.trim()).toBe('1 task')
  })
})

describe('a piece line’s own text — the marks it drops and the marks it keeps', () => {
  it('a piece line drops a heading, a quote or a bullet lead', async () => {
    const m = await show({
      read: answer({
        workTakenIn: takenIn([
          edge({ piece: 'work_1', label: 'W1.1', title: '# Fix the crash' }),
          edge({ piece: 'work_2', label: 'W1.2', title: '> escalate this' }),
          edge({ piece: 'work_3', label: 'W1.3', title: '- ship it today' }),
        ]),
      }),
    })
    const lines = m.all('cast-taken-work')
    expect(lines).toHaveLength(3)
    const said = lines.map((one) => one.querySelector('[data-cy="cast-work-said"]'))
    for (const [index, el] of said.entries())
      expect(el, `piece ${index + 1} drew no line`).not.toBeNull()
    expect(said.map((el) => el!.textContent)).toEqual([
      'Fix the crash',
      'escalate this',
      'ship it today',
    ])
    // ⚑ Paired negative: the strip only ever touches the printed line — each row's title still
    // carries the piece's whole title, lead marker and all.
    expect(lines.map((one) => one.title)).toEqual([
      '# Fix the crash',
      '> escalate this',
      '- ship it today',
    ])
  })

  /** ⚑ No existing title uses single-mark italics, so `ITALIC` runs on no fixture today. */
  it('a piece line drops italic marks but leaves a snake_case word alone', async () => {
    const m = await show({
      read: answer({
        workTakenIn: takenIn([edge({ title: 'run *now* not snake_case_var' })]),
      }),
    })
    expect(m.q('cast-taken-work').querySelector('[data-cy="cast-work-said"]')?.textContent).toBe(
      'run now not snake_case_var',
    )
  })
})

describe('who a line names — the one that gave the piece', () => {
  /**
   * ⚑ **Every line names who gave the piece** — the list's one direction since UI-006. ⚠️ The
   * fixture names the HOLDER too, so a line that named the wrong end of the piece would say its
   * holder's name where its giver's belongs.
   */
  it('a line names the conversation that gave the work, never the one holding it', async () => {
    const m = await show({
      identities: [identity('parent-worker', 'Ada'), identity('holder', 'Bea')],
      read: answer({
        workTakenIn: takenIn([
          edge({
            piece: 'work_in',
            label: 'W2.1',
            fromIdentity: 'parent-worker',
            toIdentity: 'holder',
          }),
        ]),
      }),
    })
    const who = m.q('cast-taken-work').querySelector('[data-cy="cast-work-to"]')
    expect(who, 'the line named nobody').not.toBeNull()
    expect(who!.textContent?.trim()).toBe('Ada')
    // ⚑ Paired negative, same mount: the holder's name is on no line.
    expect(m.all('cast-work-to').map((el) => el.textContent?.trim())).not.toContain('Bea')
  })
})
