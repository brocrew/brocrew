import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { publishedOffer, type PermissionOutcome } from '@brobot2/runtime'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  NO_REASON_ON_THIS_REQUEST,
  conversationGrantSaid,
  noWayToAllow,
  permissionOffer,
} from '../src/renderer/src/lib/permission-offer'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'

/**
 * 🔴 **736 · what a surface says of a grant is what the buttons it DRAWS install** (`736`'s review).
 *
 * ⚑ Two facts moved under the surfaces that were already drawn:
 *
 * - **R95** — the runtime's `persistence` summarises the whole offer, and an offer can now carry
 *   *Always allow*, which no surface draws yet (the frontend's). ⛔ So the card printed
 *   `persistence: always` over *Allow* and *Allow for this conversation*, and Home dropped its
 *   *"for the whole conversation"* line on the very cards that offer that grant.
 * - **R94** — the conversation grant is the provider's own rule for the ask, which can be far wider
 *   than the one action (an edit's is *every edit*), and *"The card's words say what the rule
 *   covers"*. ⛔ No surface said what it covered.
 *
 * ⚑ Both are one derivation each in `permission-offer.ts`, read by the card and by Home.
 *
 * 🔴 **739 · §1 and §3 re-aimed, not removed** (`736` F-1: *"*Always allow* is offered by the
 * runtime and drawn by no surface"*). `739` draws it on every surface, so the buttons a surface draws
 * ARE the offer's: `drawnPersistence` and the *"not offered here yet"* sentence went with the gap,
 * and each pin below now holds its point — *what a surface says is what the buttons it draws
 * install* — against the drawn *Always allow*.
 */

type Grants = NonNullable<
  Extract<TranscriptEvent, { type: 'permission_request' }>['scope']['grants']
>

/**
 * A card whose grants carry every KIND of rule a surface says — a tool's rule, a folder and a mode.
 * ⚠️ `740`: this was the SDK's set for an `rm` (`736`'s measurement); since R99 no measured ask carries
 * all three in one grant (an `rm`'s is its folder alone — {@link RM_MEASURED}), so it is a composed
 * fixture now, kept because it exercises every word.
 */
const RM_GRANTS: Grants = {
  allow_for_session: [
    { kind: 'tool', tool: 'Bash', content: 'rm -f zz736.txt' },
    // ⚑ 740 · a folder other than the conversation's own (`/tmp/x`) — that one says it adds nothing.
    { kind: 'directory', path: '/tmp/y' },
    { kind: 'mode', mode: 'acceptEdits' },
  ],
  allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }],
  allow_always: [{ kind: 'tool', tool: 'Bash', content: 'rm -f zz736.txt' }],
  alwaysFile: '/tmp/x/home/settings.json',
}

const RM_OFFER: PermissionOutcome[] = [
  'allow',
  'allow_for_session',
  'allow_all_for_session',
  'allow_always',
  'deny',
  'cancel',
]

/** A Codex command card whose only accept is its *don't ask again …* (R95's `allow_always`). */
const ALWAYS_ONLY: PermissionOutcome[] = ['allow_always', 'deny', 'cancel']

// 🔴 **739 review · re-aimed** — *accept edits* said *"every file edit"*; measured (`736`'s loopback)
// was the next edit in the conversation's folder run unasked and one outside it asked, so it says
// the edits in the folders it works in (review findings 1 and 13).
const RM_SAID =
  'for this conversation, its grant covers: Bash(rm -f zz736.txt); working in /tmp/y; every file ' +
  'edit in the folders it works in, without asking (accept edits)'

function permissionEvent(
  availableDecisions: PermissionOutcome[],
  persistence: 'once' | 'session' | 'always',
  grants?: Grants,
): TranscriptEvent {
  return {
    type: 'permission_request',
    id: 'req_1',
    kind: 'command',
    action: 'Bash',
    detail: 'rm -f zz736.txt',
    scope: {
      cwd: '/tmp/x',
      paths: [],
      networkHosts: [],
      persistence,
      ...(grants === undefined ? {} : { grants }),
      amendments: [],
      availableDecisions,
      underDisclosed: true,
    },
  } as TranscriptEvent
}

const renderCard = (event: TranscriptEvent): Promise<string> =>
  renderToString(
    createSSRApp({
      render: () =>
        h(PermissionCard as never, {
          item: { at: 1_700_000_000_000, outcome: null, note: null, request: event },
        }),
    }),
  )

/** The text of the one element carrying `data-cy`, or undefined. */
const textOf = (html: string, cy: string): string | undefined => {
  const match = new RegExp(`data-cy="${cy}"[^>]*>([^<]*)<`).exec(html)
  return match?.[1]?.trim()
}

/** One Home row, projected exactly as Home projects it. */
function homeRow(event: TranscriptEvent): AttentionRequest {
  const record = createSessionRecord('sess_1')
  record.meta = {
    sessionId: 'sess_1',
    provider: 'claude',
    cwd: '/tmp/x',
    profileId: 'default',
  } as never
  record.phase = 'open'
  applyEvent(record.control, event, 1_700_000_000_000)
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(rows, 'the projection produced no row').toHaveLength(1)
  return rows[0]!
}

describe('§1 · the persistence a surface says is that of the buttons it draws', () => {
  // 🔴 **739 · re-aimed** — this pinned `drawnPersistence`, which said `session` / `once` over an
  // offer summarised `always` because *Always allow* was drawn by no surface (`736` F-1). ⚑ `739`
  // draws it, so the persistence the card says is the offer's own — and it is said only beside the
  // button that makes it true. The pass-through half is kept as it was.
  it('🔴 an offer summarised `always` says `always` — beside the *Always allow* it draws, with the conversation grant and without — and an offer that never said `always` is said as it is', async () => {
    const withBoth = await renderCard(permissionEvent(RM_OFFER, 'always', RM_GRANTS))
    expect(textOf(withBoth, 'permission-persistence')).toBe('always')
    expect(withBoth).toContain('data-cy="permission-allow_always"')
    const alone = await renderCard(permissionEvent(ALWAYS_ONLY, 'always'))
    expect(textOf(alone, 'permission-persistence')).toBe('always')
    expect(alone).toContain('data-cy="permission-allow_always"')
    // ⚑ …and one that never said `always` is said as it is, with no *Always allow* beside it.
    const session = await renderCard(
      permissionEvent(['allow', 'allow_for_session', 'deny', 'cancel'], 'session'),
    )
    expect(textOf(session, 'permission-persistence')).toBe('session')
    expect(session).not.toContain('data-cy="permission-allow_always"')
    const once = await renderCard(permissionEvent(['allow', 'deny', 'cancel'], 'once'))
    expect(textOf(once, 'permission-persistence')).toBe('once')
  })

  // 🔴 **739 · re-aimed** — the card's persistence was `session` here (the buttons `736` drew); it is
  // `always` now that *Always allow* is one of them. ⚑ Home's point is unchanged and still pinned:
  // its conversation line stays on a card that ALSO offers a conversation grant.
  it('🔴 the card draws it, and Home keeps its conversation line on a card that also offers *Always allow*', async () => {
    const html = await renderCard(permissionEvent(RM_OFFER, 'always', RM_GRANTS))
    expect(textOf(html, 'permission-persistence')).toBe('always')
    expect(homeRow(permissionEvent(RM_OFFER, 'always', RM_GRANTS)).scope).toContain(
      'for the whole conversation, not just this action',
    )
    // ⚑ THE CONTROL — an always-only offer draws no conversation grant, so Home says none; the card
    // says the offer's `always`, the one button it draws that allows.
    const alone = await renderCard(permissionEvent(ALWAYS_ONLY, 'always'))
    expect(textOf(alone, 'permission-persistence')).toBe('always')
    expect(homeRow(permissionEvent(ALWAYS_ONLY, 'always')).scope).not.toContain(
      'for the whole conversation, not just this action',
    )
  })
})

describe('§2 · R94 — the conversation grant says what it covers', () => {
  it('🔴 the rules the button installs, in words — on the card and on Home, one sentence', async () => {
    expect(conversationGrantSaid({ availableDecisions: RM_OFFER, grants: RM_GRANTS })).toBe(RM_SAID)
    // ⚑ …and nothing where the grant is not offered, or carries no rules to say.
    const opaque: PermissionOutcome[] = ['allow', 'allow_all_for_session', 'deny', 'cancel']
    expect(conversationGrantSaid({ availableDecisions: opaque, grants: RM_GRANTS })).toBeNull()
    expect(conversationGrantSaid({ availableDecisions: RM_OFFER })).toBeNull()
    const html = await renderCard(permissionEvent(RM_OFFER, 'always', RM_GRANTS))
    expect(textOf(html, 'permission-grant-covers')).toBe(RM_SAID)
    expect(homeRow(permissionEvent(RM_OFFER, 'always', RM_GRANTS)).scope).toContain(RM_SAID)
  })

  it('⚑ THE CONTROL — a card offering no conversation grant draws no such line, on either surface', async () => {
    // ⚑ Passes on `main` too: it asks the SURFACES, which had no such line to draw.
    const opaque: PermissionOutcome[] = ['allow', 'allow_all_for_session', 'deny', 'cancel']
    const html = await renderCard(permissionEvent(opaque, 'session', RM_GRANTS))
    expect(html).not.toContain('data-cy="permission-grant-covers"')
    expect(homeRow(permissionEvent(opaque, 'session', RM_GRANTS)).scope).not.toContain(RM_SAID)
  })
})

/**
 * 🔴 **740 · R99 (`736` F-9) — an `rm`'s conversation grant as the CLI suggests it**: its FOLDER —
 * the folder the conversation already works in, so the same `rm` is asked again (measured, K1). No
 * *always* (the CLI offers none). ⚑ The adapter offers no such grant, so only a card saved with one
 * carries it, and it still says what it does.
 */
const RM_MEASURED: Grants = {
  allow_for_session: [{ kind: 'directory', path: '/tmp/x' }],
  allow_all_for_session: [{ kind: 'tool', tool: 'Bash' }],
}
const RM_MEASURED_OFFER: PermissionOutcome[] = [
  'allow',
  'allow_for_session',
  'allow_all_for_session',
  'deny',
  'cancel',
]
const RM_MEASURED_SAID =
  'for this conversation, its grant covers: working in /tmp/x — the folder it already works in, ' +
  'so the same request is still asked'

describe('§2b · 740 · an `rm`’s grant says it adds nothing — its folder is the one it already works in', () => {
  it('🔴 on the card and on Home — never *"working in <folder>"* as if that covered the `rm`', async () => {
    // ⛔ Before this: *"for this conversation, its grant covers: working in /tmp/x"* — a promise of
    // coverage over a grant that asks the same `rm` again.
    const html = await renderCard(permissionEvent(RM_MEASURED_OFFER, 'session', RM_MEASURED))
    expect(textOf(html, 'permission-grant-covers')).toBe(RM_MEASURED_SAID)
    expect(homeRow(permissionEvent(RM_MEASURED_OFFER, 'session', RM_MEASURED)).scope).toContain(
      RM_MEASURED_SAID,
    )
  })

  it('⚑ THE CONTROL — a folder that is NOT the conversation’s own is said as coverage', () => {
    expect(
      conversationGrantSaid({
        availableDecisions: RM_MEASURED_OFFER,
        grants: { allow_for_session: [{ kind: 'directory', path: '/elsewhere' }] },
        cwd: '/tmp/x',
      }),
    ).toBe('for this conversation, its grant covers: working in /elsewhere')
  })
})

describe('§3 · a way to allow that the provider offered is DRAWN, so nothing says there is none', () => {
  // 🔴 **739 · re-aimed** — this pinned `ONLY_AN_UNDRAWN_WAY_TO_ALLOW` (*"… BroBot does not offer
  // that choice yet"*), the sentence for `736` F-1's gap. ⚑ Its point — an always-only offer is
  // never *"did not record why"* — holds now because the choice is in the row: there IS a way to
  // allow, so no cannot-allow sentence at all.
  it('🔴 an always-only offer puts *Always allow* in the row and says no cannot-allow sentence — never *"did not record why"*', async () => {
    const offer = permissionOffer(publishedOffer(['allow_always']), 'Bash')
    expect(offer.row).toEqual(['allow_always', 'deny', 'cancel'])
    expect(noWayToAllow(undefined, offer)).toBeNull()
    const html = await renderCard(permissionEvent(ALWAYS_ONLY, 'always'))
    expect(html).toContain('data-cy="permission-allow_always"')
    expect(html).not.toContain('data-cy="permission-cannot-allow"')
    expect(html).not.toContain(NO_REASON_ON_THIS_REQUEST)
  })

  it('⚑ THE CONTROL — an offer with no way to allow at all keeps the residual sentence', () => {
    expect(noWayToAllow(undefined, permissionOffer(['deny', 'cancel'], 'Bash'))).toEqual({
      why: 'not-said',
      says: NO_REASON_ON_THIS_REQUEST,
    })
  })
})
