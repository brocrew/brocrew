import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import ConversationPane from '../src/renderer/src/components/ConversationPane.vue'
import SessionDrawer from '../src/renderer/src/components/SessionDrawer.vue'
import SideRail from '../src/renderer/src/components/SideRail.vue'
import TeamWorkspace from '../src/renderer/src/components/TeamWorkspace.vue'
import { createAttachmentBook, draftKey } from '../src/renderer/src/lib/drafts'
import { CAPABILITY_FIELDS, type ProfileCapabilities } from '../src/shared/capabilities'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent, createTranscript } from '../src/renderer/src/lib/transcript'
import { createWindow } from '../src/renderer/src/lib/transcript-window'
import type { AgentIdentities, AgentIdentity, CreatedSession } from '../src/shared/runtime-ipc'
import { aNameForANewAgent } from '../src/shared/human-names'

/**
 * # 🔴 538 · §2's SECOND half — the same identity, on more than one surface, reading one word
 *
 * ## ⛔ Why this half needs its own file
 *
 * ⚠️ **The brief's property has two halves and both are load-bearing:** *"An identity this app
 * brought into being has a name a person can read, **and it is the SAME word on every surface that
 * names it**."* 🔴 **A name that is friendly in the transcript and a slug in the rail is the defect
 * `537` refused to ship, arriving by the other door** — so a test that only read the database
 * column would pass over exactly the failure this dispatch exists to prevent.
 *
 * ## 🔴 584 · what it pins NOW, because the name stopped coming from a table
 *
 * ⛔ **`HO-078` §1 retired the identity this file was written about** and `HO-078` §5 replaced the
 * seed with a generator, so *the seeded name* is not a thing any more. ⚑ **The PROPERTY is
 * untouched and is what this still measures**: an identity this app named has ONE word, and every
 * surface that names it says that word. ⚠️ **Re-aimed rather than stripped** (standing rule 26):
 * the slug is a local constant and the word comes from `human-names.ts`, so a test that went green
 * because the table emptied is impossible — the generator has to answer for the assertion to run
 * at all.
 *
 * ⚑ **`a-name-the-app-mints-for-itself.test.ts` is the first half and the mechanism**; this is what
 * a person sees. ⛔ A component census cannot run from the node project
 * (`a-test-that-imports-an-sfc-is-a-renderer-file`), and `StartAsAgent` cannot be rendered here at
 * all — it binds to a window-scoped store on setup — so its half is in
 * `test/dom/a-name-the-app-mints-for-itself.dom.test.ts`, in a real engine.
 *
 * ## ⚑ Every surface is rendered from ONE roster, and against a PAIR
 *
 * ⛔ **SSR renders no layout and computes no styles** (086), so every assertion here is paired: the
 * same four surfaces are rendered a second time from a roster with the name taken out, and each
 * one is required to say the SLUG there. ⚠️ Without that pair, a surface that rendered nothing at
 * all would satisfy `not.toContain('project-manager')` and a surface that hard-coded the words
 * would satisfy `toContain('Project Manager')`.
 */

/**
 * ⚑ **584 · the slug is a LOCAL constant now** (`HO-078` §1). ⛔ `MINTED_SLUG` was
 * the one identity this app shipped, and it ships none but BroBot — so this is a name an agent
 * CREATED, which is the ordinary case this file was always about. ⚠️ The string is unchanged on
 * purpose: it is the one `538`'s ink measurement was taken against.
 */
const MINTED_SLUG = 'project-manager'

/**
 * 🔴 **584 · the name is GENERATED and is read from the generator** (`HO-078` §5, `human-names.ts`)
 * — ⛔ **never typed here a second time**, which is what `538` meant by reading it from the table.
 *
 * ⚑ **An empty roster, drawn with a source that always answers 0**, so the name is the same on
 * every run: the first of BroBot's own list.
 */
const NAME = aNameForANewAgent([], () => 0)

const identity = (displayName: string | null): AgentIdentity => ({
  id: `aid:${MINTED_SLUG}`,
  slug: MINTED_SLUG,
  displayName,
  provider: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  externalMcpServerIds: [],
  // ⚠️ **A whole grant, because the rail DRAWS one** — `530`'s pair of lines is rendered under
  // every roster row, and a partial fixture is a `TypeError` in `grantSays` rather than a missing
  // sentence. ⛔ The narrowest values, so nothing here is a claim about capability — ⚑ D-016:
  // each field's own `narrowest`, read off the schema now that the set it made is gone.
  capabilities: Object.fromEntries(
    CAPABILITY_FIELDS.map((field) => [field.key, field.narrowest]),
  ) as unknown as ProfileCapabilities,
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
})

const roster = (displayName: string | null): AgentIdentities => ({
  identities: [identity(displayName)],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  defaultApprovalMode: 'ask',
  externalMcpServers: [],
})

const META: CreatedSession = {
  sessionId: 'sess_1',
  provider: 'claude',
  cwd: '/work/freeze-clock',
  providerHome: '/homes/claude',
  profileId: MINTED_SLUG,
  instructions: {
    injected: [],
    agentMemory: [],
    provider: [],
    refused: [],
    note: '',
    recallsReported: false,
    writesReported: false,
    composed: null,
  },
  ref: { provider: 'claude', sessionId: 'th_1', cwd: '/work', rotation: 0 },
  config: {
    home: '/homes/claude',
    homeEnv: 'CLAUDE_CONFIG_DIR',
    model: 'claude-sonnet-5',
    authNote: null,
    files: [],
  },
  approvalMode: 'ask',
  pendingApprovalMode: null,
  approvalNote: 'approvals: ask',
  blanketGrants: [],
  planNeedsGoAhead: false,
  queued: [],
  settings: {
    model: null,
    pendingModel: null,
    reasoningEffort: null,
    pendingReasoningEffort: null,
    planMode: false,
    pendingPlanMode: null,
  },
  liveness: { state: 'live', since: 1_700_000_000_000, process: 'pid 48213' },
  hasACommander: false,
  startedWithoutAWindow: false,
  mayHandItBack: false,
} as unknown as CreatedSession

/**
 * ⚑ **667 · the spelling the conversation was LAUNCHED under** — `provider_session.profile_id`, which
 * keeps whatever case a person typed. The default is the slug itself, which every test above means.
 */
const launchedAs = (spelling: string): CreatedSession => ({ ...META, profileId: spelling })

function record(spelling: string = MINTED_SLUG): SessionRecord {
  const r = createSessionRecord('sess_1')
  r.meta = launchedAs(spelling)
  r.phase = 'open'
  applyEvent(r.transcript, { type: 'assistant_message', text: 'Progress confirmed.' })
  applyEvent(r.transcript, { type: 'status', state: 'working' })
  return r
}

/** ⚑ **What a person actually reads** — markup with its HTML comments removed (`537`'s device). */
const visible = (markup: string): string => markup.replace(/<!--[\s\S]*?-->/g, '')

/**
 * ⛔ **The AUTHOR of an assistant turn, and not simply the first `<strong>` on the page.**
 *
 * ⚠️ **The first draft of this helper read the first one and got the composer's hint** — a
 * neighbouring element that draws the SLUG on purpose, so the pane looked like it had not moved.
 * ⚑ `AssistantMessage` puts the name immediately above `data-cy="assistant-message"`, so the
 * author is the LAST `<strong>` before that hook — which is
 * `an-assertion-can-be-satisfied-by-a-neighbouring-element` answered by anchoring rather than by
 * hoping.
 */
function authorOf(markup: string): string {
  const upTo = visible(markup).split('data-cy="assistant-message"')[0] ?? ''
  const strongs = [...upTo.matchAll(/<strong[^>]*>([\s\S]*?)<\/strong>/g)]
  expect(strongs.length, 'the pane drew no assistant turn at all').toBeGreaterThan(0)
  return (strongs.at(-1)![1] ?? '').replace(/<[^>]+>/g, '').trim()
}

/** ⛔ One element's inner text by `data-cy`, so a hit elsewhere on the page cannot answer for it. */
function cell(markup: string, cy: string): string {
  const found = new RegExp(`data-cy="${cy}"[^>]*>([\\s\\S]*?)</`).exec(visible(markup))
  expect(found, `nothing with data-cy="${cy}" was rendered`).not.toBeNull()
  return (found![1] ?? '').replace(/<[^>]+>/g, '').trim()
}

/**
 * 🔴 **570 · the fourth surface moved, and this is where it moved TO.**
 *
 * ⛔ **It was `cell(rail, \`rail-agent-${slug}-name\`)` and that row no longer exists**:
 * `EXT-008` §4.4 took the rail's AGENTS section out of the navigation column and `TeamWorkspace`
 * is the app's roster now. ⚑ **The property did not move** — *one identity, one word, every
 * surface that names it* — so the reading is re-aimed rather than deleted, which is the whole
 * reason the eviction is safe to make (standing rule 26).
 *
 * ⚠️ **`store` is passed as a stub because it must be.** The component's own fallback is
 * `useAgentStore()`, which binds to `window.api` at setup and does not exist in this project —
 * `a-test-that-imports-an-sfc-is-a-renderer-file`, met head-on. ⛔ Neither door is pressed here,
 * so a stub that throws on use is the honest shape: this file reads a NAME.
 */
const teamMarkup = (names: AgentIdentities): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(TeamWorkspace as never, {
          agents: names,
          store: {
            renameTo: () => {
              throw new Error('a name census must not write')
            },
            remove: () => {
              throw new Error('a name census must not write')
            },
          },
        }),
    }),
  )

const railMarkup = (names: AgentIdentities, spelling: string): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(SideRail as never, {
          open: [record(spelling)],
          activeId: 'sess_1',
          place: null,
          agents: names,
        }),
    }),
  )

const paneMarkup = (names: AgentIdentities, spelling: string): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(ConversationPane as never, {
          record: record(spelling),
          mode: 'normal' as const,
          debug: false,
          drawerOpen: false,
          drawerTab: 'open',
          models: null,
          draft: '',
          handing: createAttachmentBook().handing(draftKey('sess_1')),
          identities: names.identities,
        }),
    }),
  )

const drawerMarkup = (names: AgentIdentities, spelling: string): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(SessionDrawer as never, {
          session: launchedAs(spelling),
          state: createTranscript(),
          shown: createTranscript(),
          mode: 'normal',
          window: createWindow(),
          sessionRef: META.ref,
          status: 'working',
          ended: false,
          models: null,
          waiting: 0,
          tab: 'open',
          fit: 'docked',
          facets: { doing: 'working' as const, being: 'live' as const },
          work: null,
          identities: names.identities,
        }),
    }),
  )

/**
 * ⛔ **The four readings, from one roster** — the Team page's card, the rail's CONVERSATION row,
 * the transcript's turn author and the drawer's plate. ⚑ Four surfaces, four components, one
 * function ({@link agentName}) and, if §2 holds, one word.
 *
 * ⚠️ **The first of the four was the rail's AGENTS row until `570`** and is the Team page now; the
 * count of components went from three to four because the roster left the rail and the rail kept
 * its conversation rows.
 */
async function everySurface(
  displayName: string | null,
  spelling: string = MINTED_SLUG,
): Promise<Record<string, string>> {
  const names = roster(displayName)
  const [team, rail, pane, drawer] = await Promise.all([
    teamMarkup(names),
    railMarkup(names, spelling),
    paneMarkup(names, spelling),
    drawerMarkup(names, spelling),
  ])
  return {
    'the Team page’s card': cell(team, `team-name-${MINTED_SLUG}`),
    'the rail’s CONVERSATION row': (
      /data-cy="open-session-sess_1"[\s\S]*?<strong[^>]*>([\s\S]*?)<\/strong>/.exec(
        visible(rail),
      )?.[1] ?? ''
    ).trim(),
    'the transcript’s turn author': authorOf(pane),
    // The block’s name is drawn beside its plate in `session-bot-name`, rather than only in
    // the plate’s title.
    'the drawer’s plate': cell(drawer, 'session-bot-name'),
  }
}

describe('§1 · one identity, four surfaces, one word', () => {
  /**
   * 🔴 **THE SECOND HALF OF THE PROPERTY.** ⛔ Every surface that names this identity reads the
   * word the seed put on its row, and no surface reads the slug, the provider, or a word of its
   * own.
   */
  it('🔴 with the name this app seeds, every surface says it', async () => {
    // ⚑ The premise: there IS a seeded name to look for — so this is about the surfaces rather
    // than about an empty string matching everywhere.
    // ⚑ **The word this app hands the first agent it mints**, asserted so the sequence a fresh
    // install walks is pinned somewhere a person reads rather than only inside the pool.
    expect(NAME).toBe('Ada')

    const surfaces = await everySurface(NAME)
    // ⚠️ **The whole map at once**, so a failure names which surface disagreed rather than which
    // assertion ran first.
    expect(surfaces).toEqual({
      'the Team page’s card': NAME,
      'the rail’s CONVERSATION row': NAME,
      'the transcript’s turn author': NAME,
      'the drawer’s plate': NAME,
    })
  })

  /**
   * ⛔ **The PAIR, and it is what makes the test above a measurement** (`a-positive-assertion-must-
   * differ-from-the-default`). ⚠️ With the name taken off the row every one of the four falls back
   * to the slug — so none of them is drawing a literal, and each really is reading the roster.
   */
  it('⛔ …and with the name taken off the row, every one of them falls back to the slug', async () => {
    expect(await everySurface(null)).toEqual({
      'the Team page’s card': MINTED_SLUG,
      'the rail’s CONVERSATION row': MINTED_SLUG,
      'the transcript’s turn author': MINTED_SLUG,
      'the drawer’s plate': MINTED_SLUG,
    })
  })

  /**
   * ⚠️ **A THIRD word, to separate *reads the roster* from *reads this one slug*.** ⛔ A surface
   * that had special-cased the project manager would pass both tests above and fail here.
   */
  it('⚠️ a name nobody seeded is drawn just as faithfully', async () => {
    const surfaces = await everySurface('The Boss')
    expect(new Set(Object.values(surfaces))).toEqual(new Set(['The Boss']))
  })

  /**
   * 🔴 **And the word that was there before `537`** — the provider — is on none of them, which is
   * the defect that dispatch closed and this one must not re-open.
   */
  /**
   * 🔴 **667 · launched under a spelling that differs only in case** (`658`'s G5).
   *
   * ⛔ **`provider_session.profile_id` keeps the case a person typed**, and `agentName` folds its key
   * but not its fallback — so before `667` an unnamed identity launched as `Project-Manager` read
   * *Project-Manager* on the rail, the pane and the plate and *project-manager* on the Team page.
   * ⚑ **This is where the two readings DIVERGE**; the test above, launched as the slug itself, is
   * the control whose spellings already agree.
   */
  it('🔴 667 · an agent launched as `Project-Manager` is still ONE word on all four', async () => {
    const spelling = 'Project-Manager'
    expect(spelling).not.toBe(MINTED_SLUG)
    expect(spelling.toLowerCase()).toBe(MINTED_SLUG)
    // ⚑ unnamed — the slug, never the directory spelling
    expect(await everySurface(null, spelling)).toEqual({
      'the Team page’s card': MINTED_SLUG,
      'the rail’s CONVERSATION row': MINTED_SLUG,
      'the transcript’s turn author': MINTED_SLUG,
      'the drawer’s plate': MINTED_SLUG,
    })
    // ⚑ named — the name, whatever the spelling
    expect(new Set(Object.values(await everySurface(NAME, spelling)))).toEqual(new Set([NAME]))
  })

  it('🔴 and none of them names the provider', async () => {
    const surfaces = await everySurface(NAME)
    for (const [where, word] of Object.entries(surfaces)) {
      expect(word, `${where} is back to naming the provider`).not.toContain('claude')
    }
  })
})
