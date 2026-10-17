import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import {
  isAlwaysHonoured,
  permissionOutcomeSchema,
  permissionScopeSchema,
  publishedOffer,
} from '@brobot2/runtime'
import AttentionQueue from '../src/renderer/src/components/AttentionQueue.vue'
import PermissionCard from '../src/renderer/src/components/PermissionCard.vue'
import { attentionQueue, type AttentionRequest } from '../src/renderer/src/lib/attention'
import {
  NO_ANSWER_ON_THIS_REQUEST,
  NO_REASON_ON_THIS_REQUEST,
  noPositiveSays,
  noWayToAllow,
  outcomeAllows,
  permissionOffer,
} from '../src/renderer/src/lib/permission-offer'
import { personsQueueView, type PersonsQueueWorld } from '../src/renderer/src/lib/persons-queue'
import { createSessionRecord } from '../src/renderer/src/lib/session-record'
import {
  applyEvent,
  type NoPositiveBecause,
  type PermissionOutcome,
} from '../src/renderer/src/lib/transcript'
import {
  decisionReading,
  readingSentence,
  type LedgerWalk,
  type PersonsDecision,
  type RoutedRequest,
} from '../src/shared/questions'
import { type TranscriptEvent } from '../src/shared/runtime-ipc'

/**
 * 🔴 **487 · the card a person could not answer at all, and the sentence above it** (`483`'s
 * repair 1, §1.2 and the three surfaces of §1.3).
 *
 * ## ⛔ What the card said, and why it was the wrong kind of wrong
 *
 * ⚠️ **`PermissionCard` said *"The provider offered no decisions for this request."*** on every
 * offer that came back empty. On the branch `483` traced as reachable the provider offered
 * plenty: BroBot withheld every positive because the grant riding along with the command could
 * not be displayed faithfully. ⛔ **A claim drawn as an observation about someone else** is
 * criterion 18's shape, and it is worse than silence here, because the one thing a person could
 * do about it — refuse — was not on the card either.
 *
 * ## ⚑ What this file holds, that no single surface can hold alone
 *
 * ⛔ **The three surfaces a permission can be answered from say ONE thing about it.** HO-030 §2's
 * ruling is that a sentence true on one surface and absent on another *"trains the reader out of
 * looking"*; `wide-grant.render.test.ts` and the two `.dom.test.ts` files each hold their own
 * surface, and nothing held the agreement. ⚠️ **This is the agreement**, plus the vocabulary's own
 * contract: three words, three sentences, none of them naming the shape that could not be shown.
 *
 * ⚠️ **SSR renders no layout** (`brobot2-ssr-tests-pass-vacuously`), so every absence below is
 * paired with the presence that proves the surface really drew something.
 */

const NOW = 1_700_000_000_000
const SESSION = 'sess_worker'
const REQUEST = 'req_1'
const KEY = `${SESSION}:${REQUEST}`

/** Every word the neutral scope may carry, from the schema rather than from a list typed here. */
const EVERY_WORD = permissionScopeSchema.shape.noPositiveBecause.unwrap()
  .options as readonly NoPositiveBecause[]

/** One pending command card, with whatever offer and reason the case is about. */
function requestEvent(
  availableDecisions: PermissionOutcome[],
  noPositiveBecause?: NoPositiveBecause,
): TranscriptEvent {
  return {
    type: 'permission_request',
    id: REQUEST,
    kind: 'command',
    action: 'Bash',
    detail: 'setup && curl http://x',
    scope: {
      cwd: '/work',
      paths: [],
      networkHosts: [],
      persistence: 'once',
      amendments: [],
      availableDecisions,
      noPositiveBecause,
      underDisclosed: true,
    },
  } as TranscriptEvent
}

/** The Home row `attentionQueue` derives for that card — the one every surface below reads. */
function rowFor(
  availableDecisions: PermissionOutcome[],
  noPositiveBecause?: NoPositiveBecause,
): AttentionRequest {
  const record = createSessionRecord(SESSION)
  record.phase = 'open'
  applyEvent(record.control, requestEvent(availableDecisions, noPositiveBecause), NOW - 1_000)
  const row = attentionQueue([record], () => 'waiting: permission')[0]
  if (row === undefined) throw new Error('the queue drew no row')
  return row
}

/** The person's-queue row for the same request, off the same `AttentionRequest`. */
function personsRowFor(request: AttentionRequest): {
  noPositive: string | null
  noAnswerHere: string | null
} {
  const routed: RoutedRequest = {
    requestId: request.requestId,
    askedBy: request.sessionId,
    parent: 'sess_parent',
    went: {
      is: 'the-person-the-channel-left-it-with',
      to: 'a-person',
      because: 'a-permission-decision',
    },
    at: NOW - 1_000,
    state: 'open',
    endedAt: null,
    escalatedAt: null,
  }
  const reading = decisionReading(request.sessionId, (sessionId) => sessionId)
  const decision: PersonsDecision = {
    request: {
      ...routed,
      went: {
        is: 'the-person-the-channel-left-it-with',
        to: 'a-person',
        because: 'a-permission-decision',
      },
    },
    reading,
    sentence: readingSentence(reading),
    says: 'something only a person can settle',
    work: [],
  }
  const walked: LedgerWalk<PersonsDecision> = {
    rows: [decision],
    walk: 'every-conversation-that-routed',
    ledgers: 1,
    rowsUnread: 0,
  }
  const world: PersonsQueueWorld = {
    held: new Set([request.sessionId]),
    answerable: new Map([[request.key, request]]),
    answeredFromHere: new Set<string>(),
    now: NOW,
    lastLookAnswered: { questions: true, decisions: true },
  }
  const view = personsQueueView(null, walked, world)
  const row = view?.rows.find((one) => one.key === KEY)
  if (row === undefined) throw new Error('the person’s queue drew no row')
  return row
}

/** The card, rendered. */
const renderCard = (request: AttentionRequest, event: TranscriptEvent): Promise<string> => {
  const scope = (event as Extract<TranscriptEvent, { type: 'permission_request' }>).scope
  return renderToString(
    createSSRApp({
      render: () =>
        h(PermissionCard as never, {
          item: {
            kind: 'permission',
            id: 'item_1',
            request: {
              type: 'permission_request',
              id: REQUEST,
              kind: 'command',
              action: 'Bash',
              detail: request.asked,
              scope,
            },
            outcome: null,
            note: null,
            refused: null,
            at: NOW,
          },
        }),
    }),
  )
}

/** Home, rendered, so the row's own words are read off markup rather than off the fold. */
const renderHome = (requests: AttentionRequest[]): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(AttentionQueue as never, { requests, now: NOW }) }))

describe('§1 · the vocabulary, and what each member says', () => {
  it('🔴 every word has a sentence, and no two words say the same thing', () => {
    // ⛔ **Three, from the schema.** A fourth added to the neutral scope and not to the renderer's
    // `Record` is a compile error; a fourth added to both and saying nothing new is this.
    expect(EVERY_WORD).toHaveLength(3)
    const said = EVERY_WORD.map((word) => noPositiveSays(word))
    for (const sentence of said) expect(sentence.length).toBeGreaterThan(0)
    expect(new Set(said).size).toBe(EVERY_WORD.length)
  })

  it('⛔ none of them names the shape the app could not describe', () => {
    // 🔴 **The whole reason the positives are withheld** — a sentence that leaked the shape
    // through the refusal would hand back exactly what withholding them was for. ⚠️ The words
    // searched for are the vocabulary of the thing that could not be shown: a requested
    // permission profile's own keys and target forms.
    for (const word of EVERY_WORD) {
      expect(noPositiveSays(word)).not.toMatch(
        /fileSystem|additionalPermissions|network|glob|special|tmpdir|profile|entries/i,
      )
    }
  })

  it('⛔ the unreadable-answers sentence does not claim an ACCEPT was offered', () => {
    // 🔴 **`outcomeOfCodexDecision` returns null for anything it cannot read**, not only the
    // network-amendment accept its comment names (the exec-policy one is `allow_always` since
    // `736`) — so this word is reachable on a list of two
    // refusals and one token this app could not parse. ⚠️ Saying *the ways to ACCEPT it were
    // offered* about that list is a claim drawn from something we did not read, which is
    // criterion 18's shape reintroduced by the repair written to remove it.
    //
    // ⛔ **Found by this dispatch's own review, and then by its own mutation row**: `487 M20`
    // restores the old wording and SURVIVED every other assertion in this file, because nothing
    // held the sentence to what it may not say.
    const unreadable = noPositiveSays('could-not-represent-the-answers')
    expect(unreadable).not.toMatch(/accept/i)
    expect(unreadable).toMatch(/cannot put/)
    // ⚑ **And the control, one word over**: `none-was-offered` MAY say it, because there the app
    // read every element the provider enumerated and none of them was a way to allow.
    expect(noPositiveSays('none-was-offered')).toMatch(/accept/i)
  })

  it('⚑ every one of them tells a person what they can still do', () => {
    // ⛔ **`106`, in the direction that matters here**: a card whose positives are withheld still
    // has two answers on it, and a sentence that only said what is missing would leave a person
    // looking for a way out of a screen that has one.
    for (const word of EVERY_WORD) expect(noPositiveSays(word)).toMatch(/[Rr]efus/)
  })

  it('⛔ the residual sentence names nobody, because nothing that renders it knows who', () => {
    // ⚠️ **The mistake `483` found, in the arm it survives in.** An event with no answers on it
    // reaches this window from a replayed ledger or an adapter it has never met; saying *the
    // provider* offered nothing is a claim this window cannot make.
    expect(NO_ANSWER_ON_THIS_REQUEST).not.toMatch(/provider|Codex|Claude|agent/i)
    expect(NO_ANSWER_ON_THIS_REQUEST).not.toBe(noPositiveSays('none-was-offered'))
  })

  it('🔴 the OFFER decides whether, and the word decides why', () => {
    // ⛔ **The word explains a withheld positive; it cannot create one** (corrected by this
    // dispatch's own review). The two fields are independent on the wire — nothing cross-checks
    // them — so a word arriving beside a live Approve must not print *"no way to allow this"*
    // over it, which is the same false sentence 487 exists to remove, pointing the other way.
    expect(
      noWayToAllow('none-was-offered', permissionOffer(publishedOffer(['allow']), 'Bash')),
    ).toBeNull()
    expect(
      noWayToAllow(
        'could-not-describe-the-grant',
        permissionOffer(publishedOffer(['allow_all_for_session']), 'Bash'),
      ),
    ).toBeNull()

    // ⚑ …and where there really is no positive, the word is what it says.
    expect(noWayToAllow('could-not-describe-the-grant', permissionOffer([], 'Bash'))).toEqual({
      why: 'could-not-describe-the-grant',
      says: noPositiveSays('could-not-describe-the-grant'),
    })
  })

  it('🔴 a request that can only be REFUSED and says no why is not silence', () => {
    // ⛔ **The arm the first draft missed.** A Codex command approval persisted before 487 whose
    // provider list was `['decline','cancel']` carries two refusals, no positive and no reason
    // field — it is not an EMPTY row, so an empty-row test fell through to `null` and every
    // surface said nothing while Home kept saying *"Open it before you allow it"*.
    expect(noWayToAllow(undefined, permissionOffer(['deny', 'cancel'], 'Bash'))).toEqual({
      why: 'not-said',
      says: NO_REASON_ON_THIS_REQUEST,
    })
    // ⚠️ …and it is a DIFFERENT sentence from the one for a row with nothing on it at all,
    // because that one says there is nothing to press and this row has two things to press.
    expect(noWayToAllow(undefined, permissionOffer([], 'Bash'))).toEqual({
      why: 'nothing-at-all',
      says: NO_ANSWER_ON_THIS_REQUEST,
    })
    expect(NO_REASON_ON_THIS_REQUEST).not.toBe(NO_ANSWER_ON_THIS_REQUEST)
    expect(NO_REASON_ON_THIS_REQUEST).toMatch(/[Rr]efus/)
    expect(NO_ANSWER_ON_THIS_REQUEST).not.toMatch(/[Rr]efus/)

    // ⚑ The control: anything that can be allowed answers null, including the wholesale grant,
    // which is not in the row and is still a way to allow.
    expect(noWayToAllow(undefined, permissionOffer(publishedOffer(['allow']), 'Bash'))).toBeNull()
    expect(
      noWayToAllow(undefined, permissionOffer(publishedOffer(['allow_all_for_session']), 'Bash')),
    ).toBeNull()
  })

  it('⛔ what ALLOWS and what REFUSES agrees with the runtime’s own floor', () => {
    // 🔴 **The two-table risk, measured** — `permission-offer.ts` keeps its own `SENSE` record
    // because a value import of `ALWAYS_HONOURED` drags zod into the renderer bundle. ⚠️ So the
    // agreement is asserted over the SCHEMA's own outcome list: every refusal is a member of the
    // floor and every member of the floor is a refusal, with no list typed here.
    for (const outcome of permissionOutcomeSchema.options) {
      expect(outcomeAllows(outcome), outcome).toBe(!isAlwaysHonoured(outcome))
    }
    // ⚑ Non-vacuity: the walk really covered both answers.
    const allows = permissionOutcomeSchema.options.filter(outcomeAllows)
    expect(allows.length).toBeGreaterThan(0)
    expect(allows.length).toBeLessThan(permissionOutcomeSchema.options.length)
  })
})

describe('§2 · one sentence, on all three surfaces', () => {
  it.each(EVERY_WORD.map((word) => ({ word })))(
    '🔴 $word says the same thing on the card, on Home and in the person’s queue',
    async ({ word }) => {
      const event = requestEvent(publishedOffer([]), word)
      const request = rowFor(publishedOffer([]), word)
      const said = noPositiveSays(word)

      // ⛔ **The card**, with the reason named in the markup so a test can tell the three apart.
      const card = await renderCard(request, event)
      expect(card).toContain(said)
      expect(card).toContain(`data-why="${word}"`)
      // ⚑ The presence that makes the absences below mean something: the card really drew a
      // refusal, so it is a card and not an empty string.
      expect(card).toContain('data-cy="permission-deny"')
      expect(card).not.toContain('The provider offered no decisions')

      // ⛔ **Home**, from the row's own field and from the markup it renders.
      expect(request.noPositive).toBe(said)
      const home = await renderHome([request])
      expect(home).toContain(said)
      expect(home).toContain('data-cy="attention-cannot-allow"')

      // ⛔ **The person's queue**, off the same `AttentionRequest` the window holds.
      expect(personsRowFor(request).noPositive).toBe(said)
    },
  )

  it('⛔ and Home stops telling a person to open it before they allow it', () => {
    // 🔴 **`483`'s own comment on that line**: it points through a door that still cannot do what
    // it names. ⚠️ The disclosure it belongs to stays — the request really is broader than shown.
    const withheld = rowFor(publishedOffer([]), 'could-not-describe-the-grant')
    expect(withheld.underDisclosed).toBe(true)
    return renderHome([withheld]).then((home) => {
      expect(home).toContain('cannot fully represent')
      expect(home).not.toContain('Open it before you allow it')
    })
  })

  it('⚑ …and it still says it on a card that CAN be allowed', async () => {
    // ⛔ The control for the negative above, one fact over
    // (`a-comparison-tested-where-both-sides-agree`).
    const ordinary = rowFor(publishedOffer(['allow']))
    expect(ordinary.noPositive).toBeNull()
    const home = await renderHome([ordinary])
    expect(home).toContain('Open it before you allow it')
    expect(home).not.toContain('data-cy="attention-cannot-allow"')
    expect(personsRowFor(ordinary).noPositive).toBeNull()
  })
})

describe('§3 · the residual: an event this window did not produce', () => {
  it('⚠️ an offer with nothing in it says so on every surface, and draws no control', async () => {
    const empty = rowFor([])
    const card = await renderCard(empty, requestEvent([]))
    expect(card).toContain(NO_ANSWER_ON_THIS_REQUEST)
    // ⛔ **A surface may not invent the refusals for one.** The floor is a promise about the gate
    // that will answer, and this window cannot see which gate that is.
    for (const outcome of [
      'allow',
      'allow_for_session',
      'allow_all_for_session',
      'deny',
      'cancel',
    ]) {
      expect(card).not.toContain(`data-cy="permission-${outcome}"`)
    }
    expect(empty.decisions).toEqual([])
    expect(empty.noPositive).toBe(NO_ANSWER_ON_THIS_REQUEST)
    expect(await renderHome([empty])).toContain(NO_ANSWER_ON_THIS_REQUEST)
    // 🔴 **The person's queue says it ONCE, and not with this sentence** (corrected by this
    // dispatch's own review). ⛔ That surface already has a word for a row with nothing to press
    // — `nothing-on-offer` — and every sentence `noPositive` can carry ends with *refusing still
    // works*, which is false beside zero buttons. Two sentences about one row, one of them
    // describing controls that are not there, is `468`'s false instruction with a new subject.
    const row = personsRowFor(empty)
    expect(row.noPositive).toBeNull()
    expect(row.noAnswerHere).toBe('nothing-on-offer')
  })

  it('⛔ …and a row whose answer is already on its way says only that (487)', async () => {
    // ⚠️ **The reachable half of the same defect.** A person presses Deny on the withheld card
    // from this queue: `sent` is set before the first await, the buttons go, and the row must
    // not keep saying *"Refusing still works, and always does."* over nothing.
    const withheld = rowFor(publishedOffer([]), 'could-not-describe-the-grant')
    expect(personsRowFor(withheld).noPositive).toBe(noPositiveSays('could-not-describe-the-grant'))
    const pressed = personsRowFor({ ...withheld, sent: true })
    expect(pressed.noAnswerHere).toBe('answer-sent')
    expect(pressed.noPositive).toBeNull()
  })
})
