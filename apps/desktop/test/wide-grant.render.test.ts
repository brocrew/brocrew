import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { publishedOffer, type PermissionOutcome } from '@brobot2/runtime'
import type { TranscriptEvent } from '../src/shared/runtime-ipc'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import { NO_ANSWER_ON_THIS_REQUEST, noPositiveSays } from '../src/renderer/src/lib/permission-offer'
import type { NoPositiveBecause } from '../src/renderer/src/lib/transcript'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import { applyEvent } from '../src/renderer/src/lib/transcript'

/**
 * The wholesale session grant, as a user meets it (058).
 *
 * 031 refused an opaque tool any session grant, for a measured reason: approving `Bash — echo
 * ALPHA` for the session let `rm -f …` run afterwards with no card. That ruling is intact — the
 * NARROW grant is still refused — and 058 added the wide one in its place, which really does do the
 * thing 031 measured. The entire difference between that defect and this feature is that the user
 * asked for it in words that said what it was.
 *
 * ⚠️ **So the label and the separation are the safety property, not styling**, and that is what
 * this file exists to hold. The dispatch's rule is that the wide grant "must not be reachable by
 * the same click that grants a narrow scope", and must be "visibly distinct" and "never the
 * default, never pre-selected".
 */

const card = (
  availableDecisions: PermissionOutcome[],
  over: Record<string, unknown> = {},
  // ⚑ **487 · the adapter's own word for why nothing here can be allowed**, undefined on every
  // card that can be. Its own parameter rather than a member of `over`, which reaches the ITEM.
  noPositiveBecause?: NoPositiveBecause,
): Record<string, unknown> => ({
  item: {
    at: 1_700_000_000_000,
    outcome: null,
    note: null,
    request: {
      id: 'req_1',
      kind: 'command',
      action: 'Bash',
      detail: 'echo ALPHA',
      scope: {
        cwd: '/tmp/x',
        paths: [],
        networkHosts: [],
        persistence: 'session',
        amendments: [],
        availableDecisions,
        noPositiveBecause,
        underDisclosed: true,
      },
    },
    ...over,
  },
})

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(PermissionCard as never, props) }))

const OPAQUE: PermissionOutcome[] = ['allow', 'allow_all_for_session', 'deny', 'cancel']
const DISCLOSED: PermissionOutcome[] = ['allow', 'allow_for_session', 'deny', 'cancel']

describe('the wholesale grant is offered apart, and says what it covers (058)', () => {
  it('names the TOOL and says it covers any command, not this one', async () => {
    const html = await render(card(OPAQUE))
    expect(html).toContain('data-cy="permission-allow_all_for_session"')
    // The tool comes from the request, not from a name written in the component — the same rule
    // the rest of the renderer follows. A hardcoded "Bash" would be the view deciding.
    // 🔴 **739 review · re-aimed** — it said *"Always allow Bash this session"*. Since R95 *Always
    // allow* names the grant that OUTLIVES the conversation (`allow_always`, drawn since `739`, on
    // the same card as this one where both are offered), and this grant ends with it — so it says
    // so, in words that start with no *Always* (review findings 6, 12, 30).
    expect(html).toContain('Allow every Bash call for this conversation')
    expect(html).not.toContain('Always allow Bash')
    // The scope, in front of the button rather than behind a tooltip. "any … command" and "not just
    // this one" are the two things a user has to understand before pressing it, and 031's whole
    // finding is that they are not obvious from a button that says "for session".
    expect(html).toContain('data-cy="permission-wide-warning"')
    // The scoped-style attribute rides on every element, so the match allows for it rather than
    // pinning a bare tag — this asserts the SENTENCE, not Vue's SSR output format.
    expect(html).toMatch(/<strong[^>]*>any Bash command<\/strong>/)
    // 🔴 743 · re-aimed — `739` F-8: *for this conversation*, its button's words (it said *for the rest
    // of this session*), in the parts Home and the person's queue draw whole.
    expect(html).toMatch(
      /any Bash command<\/strong> for this conversation — not just this one\. Nothing will ask again/,
    )
    expect(html).not.toContain('rest of this session')
    expect(html).toContain('not just this one')
  })

  it('is NOT in the button row — so no click aimed at the row can land on it', async () => {
    // The dispatch's rule, held structurally. The backend already makes the two grants mutually
    // exclusive, so this is belt and braces — but it is the half a user actually experiences, and
    // the half that a later change to `ORDER` could quietly undo.
    const html = await render(card(OPAQUE))
    const actions = /<div class="permission-actions"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
    expect(actions, 'the row must not contain the wide grant').not.toContain(
      'permission-allow_all_for_session',
    )
    expect(actions, 'the ordinary decisions are still in the row').toContain('permission-allow')
    expect(html).toContain('class="wide-grant"')
  })

  it('is not styled as the expected answer — outlined, never the filled primary', async () => {
    // `approve` is the filled amber the ordinary approvals carry, because they are the expected
    // answer to the question. This one must not read as the expected answer to anything.
    const html = await render(card(OPAQUE))
    const button =
      /<button[^>]*data-cy="permission-allow_all_for_session"[^>]*>/.exec(html)?.[0] ?? ''
    expect(button).toContain('btn wide')
    expect(button, 'the wide grant must not wear the primary approve style').not.toContain(
      'approve',
    )
  })

  it('is absent from a card that was offered the narrow grant instead', async () => {
    // The complement. A fully-disclosed file tool gets `allow_for_session`, whose scope the card
    // really did state — and the wide button has no business on it.
    const html = await render(card(DISCLOSED))
    expect(html).toContain('data-cy="permission-allow_for_session"')
    expect(html).not.toContain('permission-allow_all_for_session')
    expect(html).not.toContain('class="wide-grant"')
    expect(html).not.toContain('data-cy="permission-wide-warning"')
  })

  it('reads back as what it GRANTED once answered, not as an ordinary session approval', async () => {
    // The settled line is where someone goes to find out what they agreed to. "Approved for
    // session" on both would make the two grants indistinguishable in the transcript — which is the
    // disclosure failure 031 was about, relocated to the record instead of the card.
    const html = await render(card(OPAQUE, { outcome: 'allow_all_for_session' }))
    // 🔴 **739 review · re-aimed** — it read back *"Always allowed this session"*; the point (058:
    // never the narrow grant's *Allowed for this conversation*) is kept, in the grant's own words now, and
    // without the *always* that since R95 means kept beyond the conversation.
    expect(html).toContain('Allowed every Bash call for this conversation')
    expect(html).not.toContain('Always allowed')
    expect(html).not.toContain('>Allowed for this conversation<')
    // Still an approval by colour: it is one, and dressing it as a refusal would be its own lie.
    expect(html).toContain('data-outcome="approved"')
    // An answered card offers nothing — the warning and the button belong to the question.
    expect(html).not.toContain('data-cy="permission-wide-warning"')
  })

  /**
   * 🔴 **487 · the card `483` found, answerable, and saying whose decision it was.**
   *
   * ⛔ **`482` and `483` both pinned this as a gap and left it open**, because *"what an EMPTY
   * offer should show a person is a ruling, not a refactor"*. The ruling is `483`'s repair 1, and
   * both halves of it are here: the two always-honoured refusals are ON the card, and the line
   * above them no longer says the provider offered nothing when the provider offered plenty.
   */
  it('🔴 the fail-closed card can be refused, and says BroBot withheld the rest (487)', async () => {
    // ⚑ **The offer is DERIVED from the product's own floor**, not typed out: if `publishedOffer`
    // ever stops keeping both refusals this fixture moves with it rather than pinning a memory.
    const withheld = await render(card(publishedOffer([]), {}, 'could-not-describe-the-grant'))
    // 🔴 Both refusals are drawn, and they are the ONLY controls — the positives stay withheld.
    expect(withheld).toContain('data-cy="permission-deny"')
    expect(withheld).toContain('data-cy="permission-cancel"')
    // ⚑ 736 · R95 — `allow_always` is a positive too, and withheld with the rest.
    for (const positive of [
      'allow',
      'allow_for_session',
      'allow_all_for_session',
      'allow_always',
    ] as const) {
      expect(withheld).not.toContain(`data-cy="permission-${positive}"`)
    }
    expect(withheld).not.toContain('class="wide-grant"')
    // ⛔ **The sentence, and who it names.** It attributes the withholding to this app and says
    // the refusals still work; it does not say the provider offered nothing, because it did not.
    expect(withheld).toContain('data-cy="permission-cannot-allow"')
    expect(withheld).toContain('data-why="could-not-describe-the-grant"')
    expect(withheld).toContain(noPositiveSays('could-not-describe-the-grant'))
    expect(withheld).not.toContain('The provider offered no decisions')
    // ⚠️ **And it does not name the shape it could not describe** — that is what withholding the
    // positives was for, and leaking it through the negative would undo it.
    expect(noPositiveSays('could-not-describe-the-grant')).not.toMatch(
      /fileSystem|network|profile|special|glob/i,
    )
  })

  it('says an event carrying NO answers at all arrived that way, and exposes no control', async () => {
    // The empty-offer line keys off the neutral `offered` projection. With the wide grant living
    // outside that projection, a card offering ONLY the wide grant must not show “no decisions”
    // above a perfectly good button.
    //
    // 🔴 **487 narrowed what can reach this arm and did not remove it.** No producer this app owns
    // publishes an offer with nothing in it any more; what still renders here is an event this
    // window did not produce — a replayed ledger, or an adapter it has never met — and the
    // sentence no longer says WHO offered nothing, because nothing here knows.
    const empty = await render(card([]))
    expect(empty).toContain(NO_ANSWER_ON_THIS_REQUEST)
    expect(empty).not.toContain('The provider offered no decisions')
    // 🔴 **483 · pin the gap, not merely its explanation.** Nothing is drawn on this one, and
    // that is right: a surface may not invent a refusal against a gate it cannot see.
    const everyOutcome = {
      allow: true,
      allow_for_session: true,
      allow_all_for_session: true,
      // ⚑ 736 · R95
      allow_always: true,
      deny: true,
      cancel: true,
    } as const satisfies Readonly<Record<PermissionOutcome, true>>
    for (const outcome of Object.keys(everyOutcome)) {
      expect(empty).not.toContain(`data-cy="permission-${outcome}"`)
    }
    const actions = /<div class="permission-actions"[^>]*>([\s\S]*?)<\/div>/.exec(empty)?.[1] ?? ''
    expect(actions).not.toContain('<button')
    expect(empty).not.toContain('class="wide-grant"')
    // ⛔ **The control, in BOTH readings** (`482`'s own rule): a card that CAN be allowed draws
    // neither sentence, so neither negative above is satisfied by a component that says nothing.
    const wideOnly = await render(card(['allow_all_for_session']))
    expect(wideOnly).not.toContain(NO_ANSWER_ON_THIS_REQUEST)
    expect(wideOnly).not.toContain('data-cy="permission-cannot-allow"')
    expect(wideOnly).not.toContain('The provider offered no decisions')
  })
})

/**
 * 🔴 **The OTHER consumer of the same fact** (299 §1, from 297 finding 1).
 *
 * ⛔ **Everything above was true and the app still drew the wholesale grant as a peer button** — on
 * the Home overview, which reads the identical `scope.availableDecisions` through `attention.ts`.
 * The rule lived in `PermissionCard.vue` as a private `ORDER` array; there were two consumers and
 * only one was ever asked. The rows here come out of the real projection — a real fold of a real
 * event — because a hand-written `AttentionRequest` would assert the fixture rather than the code.
 */

const OVERVIEW_NOW = 1_700_000_100_000

function permissionEvent(
  availableDecisions: PermissionOutcome[],
  action = 'Bash',
): TranscriptEvent {
  return {
    type: 'permission_request',
    id: 'req_1',
    kind: 'command',
    action,
    detail: 'echo ALPHA',
    scope: {
      cwd: '/tmp/x',
      paths: [],
      networkHosts: [],
      persistence: 'session',
      amendments: [],
      availableDecisions,
      underDisclosed: availableDecisions.includes('allow_all_for_session'),
    },
  } as TranscriptEvent
}

/** One row, projected exactly as Home projects it. */
function overviewRow(availableDecisions: PermissionOutcome[], action = 'Bash'): AttentionRequest {
  const record = createSessionRecord('sess_1')
  record.meta = {
    sessionId: 'sess_1',
    provider: 'claude',
    cwd: '/tmp/x',
    profileId: 'default',
  } as never
  record.phase = 'open'
  applyEvent(record.control, permissionEvent(availableDecisions, action), OVERVIEW_NOW - 60_000)
  const rows = attentionQueue([record], () => 'waiting: permission')
  expect(
    rows,
    'the projection produced no row — every assertion below would pass over it',
  ).toHaveLength(1)
  return rows[0]!
}

const renderOverview = (requests: AttentionRequest[]): Promise<string> =>
  renderToString(
    createSSRApp({ render: () => h(AttentionQueue as never, { requests, now: OVERVIEW_NOW }) }),
  )

describe('the overview draws the same rule (299 §1)', () => {
  // 🔴 743 · re-aimed — `739` F-1, ruled: the grant is a one-click answer here too, AFTER the row,
  // under its own warning. ⚑ 299 §1 still holds: it is never the SECOND button.
  it('🔴 the button row is Allow · Deny · Cancel, in that order, and the grant comes after them', async () => {
    const row = overviewRow(OPAQUE)
    // ⛔ **What IS drawn, and in what order.** The negative below is the finding; on its own it
    // would pass just as happily over a row with no buttons at all.
    expect(row.decisions.map((decision) => decision.label)).toEqual([
      'Allow',
      'Deny',
      'Cancel',
      'Allow every Bash call for this conversation',
    ])
    expect(row.decisions.map((decision) => decision.label)).not.toContain(
      'Allow all for this conversation',
    )

    const html = await renderOverview([row])
    const actions = /<div class="request-actions"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
    expect(actions, 'the slice found the button strip').toContain('attention-decide-sess_1')
    // ⛔ **The three words, in order, read off the LABEL elements** (481) — the whole finding is
    // about which one is SECOND.
    //
    // ⚠️ **`indexOf` over the raw markup answered that from ANY occurrence of the string**, and
    // since criterion 20's third clause landed on this surface the strip also carries an effect
    // sentence per button and a comment explaining where it comes from. The word *Cancel* in one
    // of those comments put `indexOf('Cancel')` 400 characters ahead of the Cancel button and took
    // this assertion red — `a-source-census-must-strip-prose-before-it-asserts`, inside one
    // `expect`. ⚑ Reading the labels is the stronger form as well as the safe one: it pins the
    // whole sequence, so a fourth button appearing in the row is red here too.
    const words = [...actions.matchAll(/data-cy="attention-decide-word"[^>]*>([^<]*)</g)].map(
      (match) => match[1],
    )
    expect(words).toEqual([
      'Allow',
      'Deny',
      'Cancel',
      'Allow every Bash call for this conversation',
    ])
    expect(actions).not.toContain('Allow all for this conversation')
  })

  // 🔴 743 · re-aimed — it pinned the sentence saying where the grant was (*"… Open it"*); since
  // `739` F-1 was ruled the grant is here, under the card's own warning (058, 106).
  it('⛔ …and offers the grant under the card’s own warning, because dropping it silently is 106 from the other side', async () => {
    const html = await renderOverview([overviewRow(OPAQUE)])
    expect(html).toContain('data-cy="attention-wide-warning"')
    // The card's own words for the same grant — one grant, three surfaces, one name.
    expect(html).toContain('Allow every Bash call for this conversation')
    expect(html).toContain('⚠ Covers any Bash command for this conversation — not just this one.')
    expect(html).not.toContain('Open it to grant that')
  })

  it('names the TOOL from the request, never a word written in the renderer', async () => {
    const row = overviewRow(OPAQUE, 'WebFetch')
    // 🔴 743 · re-aimed — the grant's button and its warning, on the row (`739` F-1, ruled).
    const wide = row.decisions.at(-1)
    expect(wide?.label).toBe('Allow every WebFetch call for this conversation')
    expect(wide?.kind === 'permission' ? wide.warns : null).toContain('any WebFetch command')
    expect(JSON.stringify(wide)).not.toContain('Bash')
  })

  it('the complement: a disclosed card has no wholesale grant and says nothing about one', async () => {
    const row = overviewRow(DISCLOSED)
    // Positive first: the narrow grant IS a peer button here, and it is the second one.
    expect(row.decisions.map((decision) => decision.label)).toEqual([
      'Allow',
      'Allow for this conversation',
      'Deny',
      'Cancel',
    ])
    // 🔴 743 · re-aimed — no wholesale grant, so no warning (it pinned the sentence's absence).
    expect(row.decisions.filter((one) => one.kind === 'permission' && one.warns)).toEqual([])
    const html = await renderOverview([row])
    expect(html).toContain('Allow for this conversation')
    expect(html).not.toContain('attention-wide-warning')
  })

  it('⚠️ the row order is OURS, not the provider’s — a reshuffled offer draws the same row', async () => {
    // `availableDecisions` arrives in whatever order an adapter's filter produced. "Whatever the
    // adapter listed first" is not a fact about what a reader should press first, and the second
    // button meaning one thing on one card and another on the next is the whole finding.
    const row = overviewRow(['cancel', 'deny', 'allow_all_for_session', 'allow'])
    // 🔴 743 · re-aimed — the wholesale grant after the row (`739` F-1, ruled).
    expect(row.decisions.map((decision) => decision.label)).toEqual([
      'Allow',
      'Deny',
      'Cancel',
      'Allow every Bash call for this conversation',
    ])
  })
})
