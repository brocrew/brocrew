import { expandAgentCards } from './harness'
import { afterEach, describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { defineComponent, h, nextTick, type Component } from 'vue'
import AttentionQueue from '../../src/renderer/src/components/AttentionQueue.vue'
import ConversationPane from '../../src/renderer/src/components/ConversationPane.vue'
import QueuedMessage from '../../src/renderer/src/components/QueuedMessage.vue'
import ResumableSessions from '../../src/renderer/src/components/ResumableSessions.vue'
import TeamWorkspace from '../../src/renderer/src/components/TeamWorkspace.vue'
import { aCommandTakesNoAttachmentsYet } from '../../src/renderer/src/lib/a-command-with-files'
import { attentionQueue } from '../../src/renderer/src/lib/attention'
import { createAttachmentBook, draftKey } from '../../src/renderer/src/lib/drafts'
import { SIGN_IN_SUPERSEDED_BLOCK } from '../../src/renderer/src/lib/send-refusals'
import type { SessionRecord } from '../../src/renderer/src/lib/session-record'
import type { QueuedItem } from '../../src/renderer/src/lib/transcript'
import { aCommandTakesNoAttachments } from '../../src/main/runtime/a-command-goes-as-typed'
import {
  AN_AGENT_THIS_APP_CANNOT_NAME,
  aNoticeALaterFactRetracted,
} from '../../src/main/runtime/reply-rails'
import type { IdentityUse } from '../../src/shared/agent-roster'
import { DEFAULT_CAPABILITIES } from '../../src/shared/capabilities'
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_LABEL,
  agentName,
  type AgentIdentities,
  type AgentIdentity,
  type HandedPath,
  type ResumableSessionInfo,
  type TranscriptEvent,
  type UnresumableSessionInfo,
} from '../../src/shared/runtime-ipc'
import { UNDRIVEN_SENTENCES, type WorkReport } from '../../src/shared/tasks'
import { drawnReady } from './drawn'
import { META, mount, paneProps, record, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 714 — names, a new project, and a command with files
 *
 * | § | the draw | 🔴 RED on `main` @ `c56b27d2` | ⚑ the control, one fact over |
 * |---|---|---|---|
 * | 1 | R41 (`712` F-4) — five surfaces NAME an identity | the slug on Home's row, the reopen list, the Info tab, the shelf, the rename field | no roster → the slug; no identity → no name; a user-home row runs as nobody |
 * | 2 | ⚑ **gone at `D-016`** — `712` F-6's *Works in* line drew the projects an agent worked in, and projects went | | |
 * | 3 | `708` H-3a — a command with files, said before the press | Send lit over a press the host refuses | no files · no command · no list (the host's authority, and its refusal still draws) |
 * | 4 | `701` F-6 — the longest endings fit their row | a state line 37 px tall in a 22 px row, spilling over the words | a short ending: one 22 px row, as before |
 *
 * ⚑ **Every sentence below is the host's or the code's own** — composed by main's functions
 * (`aCommandTakesNoAttachments`, `reply-rails.ts`) or asked of the renderer's — never typed here.
 */

const ORIGINAL = { width: window.innerWidth, height: window.innerHeight }
type Api = { api?: unknown }
const stubbed = (): Api => window as unknown as Api

afterEach(async () => {
  unmountAll()
  delete stubbed().api
  await page.viewport(ORIGINAL.width, ORIGINAL.height)
})

const words = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim()
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    await nextTick()
  }
}
const ev = (event: Record<string, unknown>): TranscriptEvent => event as unknown as TranscriptEvent

const ident = (slug: string, over: Partial<AgentIdentity> = {}): AgentIdentity =>
  ({
    id: `aid:${slug}`,
    slug,
    displayName: null,
    createdAt: 1_700_000_000_000,
    createdBy: null,
    provider: null,
    externalMcpServerIds: [],
    capabilities: DEFAULT_CAPABILITIES,
    chosen: Object.fromEntries(Object.keys(DEFAULT_CAPABILITIES).map((key) => [key, 'default'])),
    ...over,
  }) as unknown as AgentIdentity

/** ⚑ A name a PERSON gave (`nearly-every-identity-has-a-pool-name`) — and one nobody gave. */
const ROSTER: readonly AgentIdentity[] = [
  ident('developer', { displayName: 'Ada' }),
  ident('helper', { displayName: 'Pam' }),
  ident('worker'),
  ident(DEFAULT_PROFILE_ID),
]

/* ============================================================ §1 · R41, five surfaces */

describe('§1 · R41 (`712` F-4) — the identity a person reads is NAMED', () => {
  /* ---------------------------------------------------------------- Home's attention row */

  const SCOPE = {
    paths: [],
    networkHosts: [],
    persistence: 'once' as const,
    amendments: [],
    availableDecisions: ['allow' as const, 'deny' as const],
    underDisclosed: false,
  }
  function waitingAs(sessionId: string, profileId: string | null): SessionRecord {
    const r = record(
      [
        ev({
          type: 'permission_request',
          id: `req_${sessionId}`,
          kind: 'command',
          action: 'Bash',
          detail: 'run: ls',
          scope: SCOPE,
        }),
        ev({ type: 'status', state: 'waiting_permission' }),
      ],
      sessionId,
    )
    r.meta = { ...META, sessionId, profileId: profileId as string }
    return r
  }
  async function home(records: SessionRecord[]): Promise<Mounted> {
    await page.viewport(1100, 700)
    // ⚑ The screen's own `nameOf` — `RuntimeScreen.agentHeadingFor` is `agentName` over the roster.
    const requests = attentionQueue(
      records,
      () => 'waiting: permission',
      (slug) => agentName(slug, ROSTER),
    )
    const m = mount(AttentionQueue, { requests, now: 1_700_000_100_000 }, { width: 900 })
    await settle()
    return m
  }

  it('🔴 Home: a waiting row says WHO — *Ada*, not `developer`', async () => {
    const m = await home([waitingAs('sess_a', 'developer')])
    const row = m.q('attention-request-sess_a')
    expect(words(m.q('attention-who'))).toBe('· Ada')
    expect(visible(m.q('attention-who'))).toBe(true)
    expect(words(row)).not.toContain('developer')
  })

  it('⚑ THE CONTROLS — nobody named it: its slug; the host named no identity: no name at all', async () => {
    const m = await home([waitingAs('sess_w', 'worker'), waitingAs('sess_n', null)])
    expect(words(m.q('attention-request-sess_w').querySelector('[data-cy="attention-who"]')!)).toBe(
      '· worker',
    )
    expect(m.q('attention-request-sess_n').querySelector('[data-cy="attention-who"]')).toBeNull()
  })

  /* ---------------------------------------------------------------- the reopen list */

  const RESUMABLE: ResumableSessionInfo = {
    provider: 'claude',
    cwd: '/tmp/work',
    status: 'idle',
    approvalMode: null,
    profileId: 'developer',
    reasoningEffort: null,
    model: null,
    planMode: null,
    adoptedAt: null,
    hasTranscript: true,
    lastEnding: 'completed',
    updatedAt: 1_700_000_001_000,
    running: 'not-running',
    state: { is: 'idle' },
    // ⚑ D-016 · commit 7 · R2 — a conversation holding no piece.
    named: null,
    sessionId: 'sess_dev',
    ref: { provider: 'claude', sessionId: 'dev-thread', cwd: '/tmp/work', rotation: 0 },
    child: null,
    resumeRefusal: null,
  } as ResumableSessionInfo
  const RECORDED: UnresumableSessionInfo = {
    sessionId: 'sess_ours',
    provider: 'claude',
    cwd: '/tmp/work',
    status: 'ended',
    running: 'not-running',
    state: { is: 'idle' },
    named: null,
    profileId: 'developer',
    adoptedAt: null,
    updatedAt: 1_700_000_001_000,
    hasTranscript: true,
    lastEnding: 'completed',
    foundInUserHome: false,
    restoredFromBundle: false,
    reason: 'its provider ref did not survive',
  }
  const THEIRS: UnresumableSessionInfo = {
    ...RECORDED,
    sessionId: 'sess_theirs',
    profileId: null,
    adoptedAt: 1_700_000_000_000,
    foundInUserHome: true,
    reason: 'it was found in your own provider home, which this app only reads',
  }
  async function reopenList(
    identities: readonly AgentIdentity[] | null,
    resumable: ResumableSessionInfo[] = [RESUMABLE],
    unresumable: UnresumableSessionInfo[] = [RECORDED, THEIRS],
  ): Promise<Mounted> {
    stubbed().api = {
      runtime: {
        listResumable: () => Promise.resolve(resumable),
        listUnresumable: () => Promise.resolve(unresumable),
      },
    }
    const m = mount(ResumableSessions, { identities }, { width: 640 })
    await settle()
    return m
  }

  it('🔴 the reopen list: *agent: Ada* on a row that can come back AND on one that cannot', async () => {
    const m = await reopenList(ROSTER)
    expect(words(m.q('resumable-profile'))).toBe('agent: Ada')
    const [ours] = m.all('unresumable-profile')
    expect(words(ours!)).toBe('agent: Ada')
  })

  it('⚑ THE CONTROLS — before the roster lands: the slug, and BroBot’s own word for BroBot', async () => {
    const m = await reopenList(null, [
      RESUMABLE,
      { ...RESUMABLE, sessionId: 's2', profileId: null },
    ])
    expect(m.all('resumable-profile').map(words)).toEqual([
      'agent: developer',
      `agent: ${DEFAULT_PROFILE_LABEL}`,
    ])
  })

  it('⛔ a conversation restored from a BUNDLE is not named from this roster — another machine ran it', async () => {
    // ⚑ **As the store builds them**: an import sets `adoptedAt`, so a bundle that names no profile
    // is ALSO `foundInUserHome` (`adopted_at !== null && profile_id === null`) — the state 714's
    // second review found this list read as *from Claude's own folder*.
    const restored: UnresumableSessionInfo = {
      ...RECORDED,
      sessionId: 'sess_bundle',
      adoptedAt: 1_700_000_000_000,
      restoredFromBundle: true,
      reason: 'it was restored from a bundle, which this app only reads',
    }
    const nobody: UnresumableSessionInfo = {
      ...restored,
      sessionId: 's2',
      profileId: null,
      foundInUserHome: true,
    }
    const m = await reopenList(ROSTER, [], [restored, nobody])
    const [asDeveloper, asNobody] = m.all('unresumable-profile')
    // ⚑ The slug its bundle carries is THAT machine's; this machine's *Ada* is someone else — and,
    // as `LibraryEntry` rules for a restored row, it ran as nobody of ours.
    expect(words(asDeveloper!)).toBe('from a bundle')
    expect(words(asDeveloper!)).not.toContain('Ada')
    // ⚑ …and one that names no profile is still a bundle's, not the person's own folder.
    expect(words(asNobody!)).toBe('from a bundle')
  })

  it('⛔ a conversation from the person’s own folder ran as NO agent, and says where it came from', async () => {
    const m = await reopenList(ROSTER)
    const theirs = m.all('unresumable-profile')[1]!
    expect(words(theirs)).toBe("from Claude's own folder")
    expect(words(theirs)).not.toContain('agent')
    expect(words(theirs)).not.toContain(DEFAULT_PROFILE_LABEL)
  })

  /* ---------------------------------------------------------- the pane: Agent panel + Info tab */

  async function pane(
    identities: readonly AgentIdentity[] | null,
    over: Record<string, unknown> = {},
  ): Promise<Mounted> {
    await page.viewport(1200, 808)
    const r = record([ev({ type: 'status', state: 'idle' })])
    r.meta = { ...META, profileId: 'developer' }
    const m = mount(ConversationPane, paneProps({ record: r, identities, ...over }), {
      width: 1200,
      height: 800,
    })
    await settle()
    return m
  }
  // The Agent panel's name, the one place the conversation's WHO is read off since the top
  // strip's cells say usage.
  const named = (m: Mounted): string => words(m.q('session-bot-name'))

  it('🔴 the Agent panel: *Ada* — the name a person reads the conversation’s WHO off', async () => {
    const m = await pane(ROSTER, { drawerOpen: true, drawerTab: 'open' })
    expect(named(m)).toBe('Ada')
  })

  it('🔴 the Info tab: *agent: Ada* beside the home’s variable — the home path keeps the folder’s spelling', async () => {
    const m = await pane(ROSTER, { drawerOpen: true, drawerTab: 'info' })
    expect(words(m.q('session-profile'))).toBe('agent: Ada · CLAUDE_CONFIG_DIR')
    expect(words(m.q('session-home'))).toBe(META.config.home)
  })

  it('⚑ THE CONTROL — no roster yet: both read the slug, which is `agentName`’s own answer', async () => {
    const m = await pane(null, { drawerOpen: true, drawerTab: 'info' })
    expect(words(m.q('session-profile'))).toBe('agent: developer · CLAUDE_CONFIG_DIR')
    const open = await pane(null, { drawerOpen: true, drawerTab: 'open' })
    expect(named(open)).toBe('developer')
  })

  /* ---------------------------------------------------------------- the rename field's label */

  it('🔴 the Team card’s rename field is labelled with the NAME — and an unnamed agent’s with its slug', async () => {
    const m = await theTeam()
    const field = (slug: string): HTMLInputElement =>
      m.q(`team-rename-${slug}`).parentElement!.querySelector('input') as HTMLInputElement
    expect(field('named').getAttribute('aria-label')).toBe('Display name for Ada')
    expect(field('keeper').getAttribute('aria-label')).toBe('Display name for keeper')
  })
})

/* ============================================================ §2 · the Team page */

/**
 * ⚑ **`D-016` took §2's subject away.** It pinned `712` F-6 — a launch into a NEW project drawn as
 * a tag on the card's *Works in* line — and `D-016` deleted projects, the line and the
 * `projects`/`projectsOfItsLaunches` fields that fed it, so its four cases went with them.
 * ⚠️ **`theTeam` stays** because §1's rename-field case reads the same card.
 */
const use = (slug: string, over: Partial<IdentityUse> = {}): IdentityUse => ({
  slug,
  conversations: 0,
  thisAppMintsIt: false,
  isLaunching: false,
  isStarting: false,
  runsOn: { provider: null, from: 'nothing-yet' },
  ...over,
})

async function theTeam(): Promise<Mounted> {
  await page.viewport(1200, 900)
  const agents = {
    identities: [ident('keeper'), ident('named', { displayName: 'Ada' })],
    foldersWithoutARow: [],
    spawningEnabled: true,
    defaultApprovalMode: 'ask',
    use: [use('keeper', { conversations: 3 }), use('named', { conversations: 1 })],
  } as unknown as AgentIdentities
  const m = mount(
    TeamWorkspace,
    {
      agents,
      store: {
        renameTo: () => {
          throw new Error('read only')
        },
        remove: () => {
          throw new Error('read only')
        },
      },
    },
    { width: 1180, height: 880 },
  )
  await settle()
  await drawnReady()
  return m
}

/* ============================================================ §3 · a command with files */

const FILE: HandedPath = { path: '/work/checkout/notes.md', kind: 'file', outsideCwd: false }
const COMMANDS = ev({
  type: 'provider_commands',
  commands: [{ name: 'compact' }, { name: 'cost', aliases: ['usage'] }],
  prefix: '/',
})

interface Composer {
  readonly m: Mounted
  readonly sent: unknown[][]
  readonly handing: ReturnType<ReturnType<typeof createAttachmentBook>['handing']>
}

async function composer(input: {
  draft: string
  files?: readonly HandedPath[]
  events?: TranscriptEvent[]
  state?: 'idle' | 'working'
  superseded?: boolean
  error?: string
}): Promise<Composer> {
  await page.viewport(1200, 808)
  const r = record([
    ...(input.events ?? [COMMANDS]),
    ev({ type: 'status', state: input.state ?? 'idle' }),
  ])
  if (input.superseded === true)
    r.meta = { ...META, liveness: { ...META.liveness, signInSuperseded: true } }
  if (input.error !== undefined) r.error = input.error
  const handing = createAttachmentBook().handing(draftKey('sess_1'))
  handing.stage([...(input.files ?? [])])
  const sent: unknown[][] = []
  const m = mount(
    defineComponent({
      setup: () => () =>
        h(ConversationPane as Component, {
          ...paneProps({ record: r, draft: input.draft, handing }),
          onSend: (...args: unknown[]) => sent.push(args),
        }),
    }),
    {},
    { width: 1200, height: 800 },
  )
  await settle()
  return { m, sent, handing }
}
const sendButton = (m: Mounted): HTMLButtonElement => m.q('send-prompt') as HTMLButtonElement
const foot = (m: Mounted): string => words(m.q('composer-hint'))

const LISTED = aCommandTakesNoAttachmentsYet({ word: '/compact', listed: true })

describe('§3 · `708` H-3a — a command with files is said BEFORE the press', () => {
  it('🔴 `/compact` with a file: Send is dark, and the foot and the button say why — the press does nothing', async () => {
    const { m, sent } = await composer({ draft: '/compact keep the schema notes', files: [FILE] })
    const send = sendButton(m)
    expect(visible(send)).toBe(true)
    expect(send.disabled, 'Send was lit over a press the host refuses').toBe(true)
    expect(send.title).toBe(LISTED)
    expect(foot(m)).toBe(LISTED)
    // ⚑ Rule 5 — the clause `R42` rules, by name, where the person reads it.
    expect(foot(m)).toContain('a command takes no attachments')
    send.click()
    await settle()
    expect(sent).toEqual([])
  })

  it('🔴 …and the remedy it names is under the pointer: take the file off, and Send lights', async () => {
    const { m } = await composer({ draft: '/compact', files: [FILE] })
    expect(sendButton(m).disabled).toBe(true)
    m.q('detach-file').click()
    await settle()
    expect(sendButton(m).disabled).toBe(false)
    expect(foot(m)).not.toContain('takes no attachments')
  })

  it('🔴 by alias, and while a turn runs: Queue and interrupt-and-send give way, the stop stays', async () => {
    const { m } = await composer({ draft: '/usage', files: [FILE], state: 'working' })
    expect(foot(m)).toBe(aCommandTakesNoAttachmentsYet({ word: '/usage', listed: true }))
    expect(m.all('queue-prompt')).toHaveLength(0)
    expect(m.all('interrupt-send-prompt')).toHaveLength(0)
    expect(visible(m.q('interrupt-session'))).toBe(true)
  })

  it('🔴 a list cut short: a name it could not rule out *reads as* a command — the host’s own hedge', async () => {
    const { m } = await composer({
      draft: '/clear',
      files: [FILE],
      events: [
        ev({ type: 'provider_commands', commands: [{ name: 'compact' }], prefix: '/', dropped: 4 }),
      ],
    })
    expect(foot(m)).toBe(aCommandTakesNoAttachmentsYet({ word: '/clear', listed: false }))
    expect(sendButton(m).disabled).toBe(true)
  })

  it('⚑ THE CONTROLS — no file, or no command: Send is lit and the foot says nothing of commands', async () => {
    for (const [draft, files] of [
      ['/compact', []],
      ['compact the schema notes, please', [FILE]],
      ['/Users/me/notes is the folder', [FILE]],
      ['/clear', [FILE]],
    ] as const) {
      const { m } = await composer({ draft, files })
      expect(sendButton(m).disabled, `${draft} with ${String(files.length)} file(s)`).toBe(false)
      expect(foot(m)).not.toContain('takes no attachments')
      unmountAll()
    }
  })

  it('⛔ NO list in this window: the composer does not guess — and the host’s refusal, when it comes, still draws', async () => {
    const hosts = aCommandTakesNoAttachments('/compact', false)
    const { m } = await composer({ draft: '/compact', files: [FILE], events: [], error: hosts })
    expect(sendButton(m).disabled, 'a gate on a list this window does not hold').toBe(false)
    expect(foot(m)).not.toContain('takes no attachments')
    // ⚑ The host stays the authority: its sentence is beside the conversation, whole.
    const error = m.q('session-error')
    expect(visible(error)).toBe(true)
    expect(words(error)).toBe(hosts)
  })

  it('⚑ a superseded sign-in outranks it: no message goes, and taking the file off would not change that', async () => {
    const { m } = await composer({ draft: '/compact', files: [FILE], superseded: true })
    expect(foot(m)).toBe(SIGN_IN_SUPERSEDED_BLOCK)
  })
})

/**
 * ⚑ **The same pane, on a conversation drawn from its LEDGER** — `714`'s review found the gate
 * missing on the quit's kept-open pane, where a press STARTS the conversation and only then did the
 * host refuse it. ⚑ **D-017b · re-aimed**: that pane is gone, and every conversation opens in the one
 * full view (`ConversationPane`, `phase: 'recorded'` until a message continues it — `startAndSend`).
 * The list is the one its fold holds — the life its ledger records.
 */
async function recorded(input: {
  draft: string
  files: readonly HandedPath[]
  events: TranscriptEvent[]
}): Promise<Composer> {
  await page.viewport(1200, 808)
  const r = record(input.events, 'sess_kept')
  r.meta = {
    ...META,
    sessionId: 'sess_kept',
    profileId: 'developer',
    ref: { provider: 'claude', sessionId: 'thread-kept', cwd: '/work/checkout', rotation: 0 },
  }
  r.phase = 'recorded'
  const handing = createAttachmentBook().handing(draftKey('sess_kept'))
  handing.stage([...input.files])
  const sent: unknown[][] = []
  const m = mount(
    defineComponent({
      setup: () => () =>
        h(ConversationPane as Component, {
          ...paneProps({ record: r, draft: input.draft, handing, identities: ROSTER }),
          onSend: (...args: unknown[]) => sent.push(args),
        }),
    }),
    {},
    { width: 1200, height: 800 },
  )
  await settle()
  return { m, sent, handing }
}

describe('§3b · the same, on a conversation drawn from its ledger (the full view, `recorded`)', () => {
  it('🔴 `/compact` with a file: Send is dark before the press that would CONTINUE it, and says why', async () => {
    const { m, sent } = await recorded({ draft: '/compact', files: [FILE], events: [COMMANDS] })
    // ⚑ The premise: the view is the full one, drawn from its ledger.
    expect(visible(m.q('session-header'))).toBe(true)
    expect(sendButton(m).disabled).toBe(true)
    expect(foot(m)).toBe(LISTED)
    sendButton(m).click()
    await settle()
    expect(sent).toEqual([])
  })

  it('⚑ THE CONTROLS — no list in its fold, or no file: Send is lit', async () => {
    for (const input of [
      { draft: '/compact', files: [FILE], events: [] },
      { draft: '/compact', files: [], events: [COMMANDS] },
    ]) {
      const { m } = await recorded(input)
      expect(sendButton(m).disabled, JSON.stringify(input.files)).toBe(false)
      expect(foot(m)).not.toContain('takes no attachments')
      unmountAll()
    }
  })
})

/* ============================================================ §4 · the endings fit their row */

type Held = QueuedItem & { at: number }
const REPORT: WorkReport = {
  piece: 'work_7',
  label: 'W1.7',
  state: 'stalled',
  stalledBecause: 'turn_ended',
}
/** ⚑ The stall notice a later fact made false — its words, composed from the cause's own sentence. */
const A_STALL_NOTICE = `W1.7 with ${AN_AGENT_THIS_APP_CANNOT_NAME} is not being worked on: ${UNDRIVEN_SENTENCES.turn_ended}`
const ENDINGS: readonly { name: string; item: Held }[] = [
  {
    name: 'abandoned · a command met its flush with files',
    item: {
      kind: 'queued',
      id: 'q1',
      text: '/compact keep the schema notes',
      outcome: 'abandoned',
      detail: aCommandTakesNoAttachments('/compact', false),
      at: 1_700_000_000_000,
    } as Held,
  },
  // ⚑ **D-016c · the longest later fact that remains** (`rebriefed`, naming the holder): the
  // question-ended and own-wake take-backs went with the stop family, and this one is longer than
  // either was.
  {
    name: 'retracted · an agent this app cannot name',
    item: {
      kind: 'queued',
      id: 'q2',
      text: A_STALL_NOTICE,
      outcome: 'retracted',
      detail: aNoticeALaterFactRetracted('rebriefed', AN_AGENT_THIS_APP_CANNOT_NAME),
      report: REPORT,
      at: 1_700_000_000_000,
    } as Held,
  },
]
/**
 * ⚠️ **The longest HEADING a held row draws, with the longest ending** (714's review): a relayed row
 * between two agents nobody named — *web-frontend-pm to project-manager-ledger* — with the sender's
 * word and the relay mark beside it. ⛔ Sized last, the state was left a sliver and spilled sideways.
 */
const LONG_HEADING: { name: string; item: Held; ownAgent: string } = {
  name: 'relayed · the longest heading',
  item: {
    kind: 'queued',
    id: 'q4',
    text: '/compact keep the schema notes',
    outcome: 'abandoned',
    relayed: true,
    relayedFrom: 'sess_pm',
    relayedFromProfile: 'web-frontend-pm',
    says: 'follow-up',
    detail: aCommandTakesNoAttachments('/compact', false),
    at: 1_700_000_000_000,
  } as Held,
  ownAgent: 'project-manager-ledger',
}
/**
 * ⚑ **440 px is the narrowest message column the app gives** — `.stream` at its 560 px floor
 * (`--transcript-min`, `drawer.ts`' `TRANSCRIPT_MIN`) less `clamp(20px, 5vw, 60px)` a side at a
 * 1200 px window; 760 is the reading measure (`--measure-message`).
 */
const WIDTHS = [440, 760] as const

async function held(item: Held, width: number, ownAgent: string | null = null): Promise<Mounted> {
  await page.viewport(1200, 700)
  const m = mount(
    QueuedMessage,
    { item, identities: null, ownAgent, mayCarryOn: false },
    { width, height: 400 },
  )
  await settle()
  return expandAgentCards(m)
}
const box = (el: Element): DOMRect => el.getBoundingClientRect()

describe('§4 · `701` F-6 — the longest endings fit their row (QueuedMessage `.msg-meta`)', () => {
  for (const width of WIDTHS) {
    for (const { name, item } of ENDINGS) {
      it(`🔴 ${name} @ ${String(width)} px: the state is inside its row, the words start below it, the heading and the clock on one line`, async () => {
        const m = await held(item, width)
        const entry = m.q('queued-entry')
        const meta = entry.querySelector('.msg-meta')!
        const state = m.q('queued-state')
        expect(words(state)).toBe(`not sent · ${item.detail ?? ''}`)
        expect(box(state).top, 'the state spills over the top of its row').toBeGreaterThanOrEqual(
          box(meta).top - 0.5,
        )
        expect(
          box(state).bottom,
          'the state spills out of the bottom of its row',
        ).toBeLessThanOrEqual(box(meta).bottom + 0.5)
        expect(
          box(m.q('queued-message')).top,
          'the state is drawn over the words below it',
        ).toBeGreaterThanOrEqual(box(state).bottom - 0.5)
        // ⚑ The state is the part that gives way — the heading and the clock keep one line each.
        const oneLine = (el: Element, what: string): void => {
          const lh = parseFloat(getComputedStyle(el).lineHeight)
          expect(box(el).height, `${what} broke onto a second line`).toBeLessThan(lh * 1.5)
        }
        oneLine(entry.querySelector('.msg-meta strong')!, 'the heading')
        oneLine(entry.querySelector('.time')!, 'the clock')
        // ⚑ **Beside a heading this short, the state starts ON the heading's line and the clock
        // shares its line** — the state gives way, rather than dropping below a heading with room
        // beside it and pushing the clock to a line of its own.
        const head = box(entry.querySelector('.msg-meta strong')!)
        const clock = box(entry.querySelector('.time')!)
        expect(box(state).top, 'the state dropped below its heading').toBeLessThan(head.bottom)
        expect(clock.top, 'the clock is on a line of its own').toBeLessThan(box(state).bottom)
      })
    }
  }

  for (const width of WIDTHS) {
    it(`🔴 ${LONG_HEADING.name} @ ${String(width)} px: the state keeps a line of its own width — never a sliver, never over the heading or the clock`, async () => {
      const m = await held(LONG_HEADING.item, width, LONG_HEADING.ownAgent)
      const entry = m.q('queued-entry')
      const column = box(entry.querySelector('.msg-column')!)
      const heading = box(entry.querySelector('.msg-meta strong')!)
      const state = box(m.q('queued-state'))
      const clock = box(entry.querySelector('.time')!)
      expect(words(m.q('queued-heading'))).toBe('web-frontend-pm')
      expect(words(m.q('exchange-head').querySelector('.exchange-heading')!)).toBe(
        'web-frontend-pm → project-manager-ledger · follow-up',
      )
      expect(words(m.q('exchange-body'))).not.toContain('project-manager-ledger')
      // ⚑ Readable: at least 12 em of the state's own type, and inside the column.
      const em = parseFloat(getComputedStyle(m.q('queued-state')).fontSize)
      expect(state.width, `the state is ${state.width.toFixed(1)} px wide`).toBeGreaterThanOrEqual(
        12 * em - 0.5,
      )
      expect(state.left).toBeGreaterThanOrEqual(column.left - 0.5)
      expect(state.right).toBeLessThanOrEqual(column.right + 0.5)
      // ⛔ …and drawn over nothing: not the heading, not the clock.
      const apart = (a: DOMRect, b: DOMRect): boolean =>
        a.right <= b.left + 0.5 ||
        b.right <= a.left + 0.5 ||
        a.bottom <= b.top + 0.5 ||
        b.bottom <= a.top + 0.5
      expect(apart(state, heading), 'the state is drawn over the heading').toBe(true)
      expect(apart(state, clock), 'the state is drawn over the clock').toBe(true)
      expect(box(m.q('queued-message')).top).toBeGreaterThanOrEqual(state.bottom - 0.5)
    })
  }

  it('🔴 the longest heading at EVERY column width from 300 to 760 px: the state never narrower than 12 em', async () => {
    // ⚑ **A sweep, because the sliver lives in a band** (714's row verification): where the heading
    // and its marks leave a few pixels on their line, a state that starts from nothing stays there
    // at that width; a state with a floor wraps to a line of its own instead.
    const m = await held(LONG_HEADING.item, 760, LONG_HEADING.ownAgent)
    const em = parseFloat(getComputedStyle(m.q('queued-state')).fontSize)
    let measured = 0
    for (let width = 300; width <= 760; width += 4) {
      m.host.style.width = `${String(width)}px`
      const state = box(m.q('queued-state'))
      expect(
        state.width,
        `at ${String(width)} px the state is ${state.width.toFixed(1)} px wide`,
      ).toBeGreaterThanOrEqual(12 * em - 0.5)
      measured += 1
    }
    expect(measured).toBe(116)
  })

  it('⚑ THE CONTROL — a short ending is one 22 px row, its state centred in it, as before', async () => {
    const m = await held(
      { kind: 'queued', id: 'q0', text: 'also check', outcome: 'cancelled', at: 1 } as Held,
      440,
    )
    const meta = m.q('queued-entry').querySelector('.msg-meta')!
    const state = m.q('queued-state')
    expect(box(meta).height).toBe(22)
    const gapAbove = box(state).top - box(meta).top
    const gapBelow = box(meta).bottom - box(state).bottom
    expect(Math.abs(gapAbove - gapBelow)).toBeLessThanOrEqual(1)
  })
})
