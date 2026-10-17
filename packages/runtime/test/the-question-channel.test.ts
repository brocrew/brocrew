import { describe, expect, it } from 'vitest'
import {
  CHANNEL_REFUSALS,
  CHANNEL_REFUSAL_SENTENCES,
  QUESTION_REQUEST_KEYS,
  askedOfTheChannel,
  type ChannelRefusal,
  type RuntimeEvent,
} from '../src/index'

/**
 * 🔴 **394 · the question channel, as a named set** — HO-007 criterion 10.
 *
 * ## ⛔ What this file is for, and what it deliberately is not
 *
 * ⚠️ **The both-provider demonstration is NOT here.** It is in `claude-runtime.test.ts` and
 * `codex-runtime.test.ts`, where each adapter can be driven from the wire — `394` §3: *"from the
 * code and the wire, not from a capture"*, and §7: *"not one plus an argument that the other is the
 * same."* ⚑ This file is the OTHER half of the same negative: the shapes **neither** provider sends
 * today, which no adapter can be asked to produce.
 *
 * ⛔ **A negative is only as strong as the search shape that produced it** (standing rule 4). The
 * search shape is {@link QUESTION_REQUEST_KEYS} — an admit-list, asserted as a named set — and the
 * assertions below are that anything outside it is refused, including things nothing has ever sent.
 */
const CARD = (over: Record<string, unknown> = {}): RuntimeEvent =>
  ({
    type: 'user_input_request',
    id: 'req_1',
    prompt: 'which branch?',
    questions: [{ id: 'q0', prompt: 'which branch?', options: [{ label: 'main' }] }],
    ...over,
  }) as unknown as RuntimeEvent

describe('394 · the question channel', () => {
  describe('§1 · the admitted shape is a NAMED SET, and everything else is refused', () => {
    it('🔴 the ordinary question travels, and the set it must be is asserted rather than counted', () => {
      const verdict = askedOfTheChannel(CARD())
      expect(verdict).toMatchObject({ travels: true, id: 'req_1' })
      // ⛔ **The set, not its size.** `353`'s idiom: a provider that dropped `prompt` and added
      // `permission` would keep a count of four and change the meaning entirely.
      expect([...QUESTION_REQUEST_KEYS].sort()).toEqual([
        'id',
        'isBlocking',
        'prompt',
        'questions',
        'type',
      ])
      // ⚑ `isBlocking` is admitted, never required: Codex's card carries it, Claude's does not.
      expect(Object.keys(CARD({ isBlocking: false })).sort()).toEqual(
        [...QUESTION_REQUEST_KEYS].sort(),
      )
      expect(askedOfTheChannel(CARD({ isBlocking: false }))).toMatchObject({ travels: true })
    })

    it('⛔ a shape this app has not been taught is REFUSED — and the control plants TWO', () => {
      // ⚠️ **Standing rule 12: a census needs a control that plants TWO, not one.** A classifier that
      // recognised one made-up field and passed the next would satisfy a single plant; two different
      // ones, neither of which any adapter emits, is what makes the admit-list a claim about every
      // key rather than about a key somebody thought of.
      //
      // ⛔ **And neither of these can be reached AFTER the wire parse** — `runtimeEventSchema` is
      // built from `z.object`, which strips an undeclared key rather than failing on it. That is why
      // the host classifies the adapter's own event, and why this assertion is about the shape and
      // not about what the ledger ends up holding.
      const planted = [CARD({ escalate: true }), CARD({ answeredAutomaticallyAfterMs: 30_000 })]
      for (const shape of planted) {
        expect(askedOfTheChannel(shape), JSON.stringify(shape)).toEqual({
          travels: false,
          id: 'req_1',
          because: 'a-shape-this-app-has-not-been-taught',
        })
      }
      // ⚑ **Non-vacuity, in the same breath**: the identical card WITHOUT either key travels, so
      // what the two above measured is the key rather than the classifier refusing everything.
      expect(askedOfTheChannel(CARD())).toMatchObject({ travels: true })
    })

    it('⛔ a shape neither provider sends — a permission WITH questions — is a grant, not a question', () => {
      // 🔴 **Codex sends `{questions: [], permission}` and Claude sends no `permission` at all**, so
      // this pairing exists nowhere today. ⚠️ It is exactly the shape a filter written from a capture
      // would wave through: it looks like a question and carries an authority payload.
      const verdict = askedOfTheChannel(
        CARD({ permission: { paths: ['write /etc'], network: true } }),
      )
      expect(verdict).toEqual({ travels: false, id: 'req_1', because: 'a-grant-of-access' })
    })

    it('⚠️ `permission` is asked BEFORE the empty-questions branch, so a grant is never reported as a plan card', () => {
      // ⛔ **340's finding — a reason answering with another reason's sentence.** Codex's real grant
      // carries BOTH facts (`questions: []` and `permission`), so the order decides which word the
      // ledger gets, and the wrong one would describe a sandbox widening as a consent card.
      expect(
        askedOfTheChannel(CARD({ questions: [], permission: { paths: [], network: false } })),
      ).toEqual({ travels: false, id: 'req_1', because: 'a-grant-of-access' })
      // ⚑ The control: the same card with no `permission` lands on the other member, which is what
      // proves the ordering was doing work rather than one branch shadowing the other.
      expect(askedOfTheChannel(CARD({ questions: [] }))).toEqual({
        travels: false,
        id: 'req_1',
        because: 'a-consent-with-nothing-to-answer',
      })
    })

    it('🔴 478 · a `consent` card keeps its OWN reason, and is never a shape nobody taught', () => {
      // ⛔ **The same ordering question as `permission` above, for the field `478` added.** A plan
      // card carries `{questions: [], consent}` — so without a branch ABOVE the admit-list walk it
      // would be `a-shape-this-app-has-not-been-taught`, which is 340's finding again: a reason
      // answering with another reason's sentence, about the one request whose whole nature is that
      // there is nothing to answer.
      for (const consent of ['start-planning', 'stop-planning']) {
        expect(askedOfTheChannel(CARD({ questions: [], consent })), consent).toEqual({
          travels: false,
          id: 'req_1',
          because: 'a-consent-with-nothing-to-answer',
        })
      }
      // ⚑ **And it is inadmissible even WITH questions** — a shape neither adapter sends, and the
      // one a reader who thought `consent` was decoration would let through.
      expect(askedOfTheChannel(CARD({ consent: 'stop-planning' }))).toEqual({
        travels: false,
        id: 'req_1',
        because: 'a-consent-with-nothing-to-answer',
      })
      // ⛔ **`consent` is NOT in the admitted set**, and that is the assertion that keeps it out.
      expect([...QUESTION_REQUEST_KEYS]).not.toContain('consent')
    })

    it('⚠️ 478 · a key present with `undefined` under it is still a key, and this is why', () => {
      // 🔴 **Measured the hard way.** The adapter's first draft wrote `consent: undefined` onto
      // every card, `Object.keys` does not care what the value is, and EVERY Claude question
      // stopped travelling to a parent. ⚑ So the walk's behaviour is pinned here rather than left
      // as a property nobody has looked at: a present key refuses, an absent one does not.
      expect(askedOfTheChannel(CARD({ somethingNobodyTaught: undefined }))).toEqual({
        travels: false,
        id: 'req_1',
        because: 'a-shape-this-app-has-not-been-taught',
      })
      // ⛔ The paired positive: `consent` is the one such key that keeps its own reason, because it
      // is classified above the walk — and its `undefined` form falls through to the walk, which is
      // why the adapter must not write it.
      expect(askedOfTheChannel(CARD({ consent: undefined }))).toMatchObject({
        because: 'a-shape-this-app-has-not-been-taught',
      })
      expect(askedOfTheChannel(CARD())).toMatchObject({ travels: true })
    })

    it('⛔ a request with no usable id is not a request at all', () => {
      // ⚠️ **`null`, not a refusal.** Nothing can answer it, nothing can join it to a card, and
      // `runtimeEventSchema` declares `id` required — so the wire parse degrades it to `unknown` and
      // the ledger never says a request happened either. ⚑ A verdict here would put a routing row
      // beside no request.
      expect(askedOfTheChannel(CARD({ id: '' }))).toBeNull()
      expect(askedOfTheChannel(CARD({ id: 42 }))).toBeNull()
      // ⛔ And the control: the same shape with an id is a request.
      expect(askedOfTheChannel(CARD({ id: 'req_2' }))).toMatchObject({ travels: true })
    })

    it('⚠️ a secret question is a person’s, and the identical question without the flag travels', () => {
      const secret = CARD({
        questions: [{ id: 'q0', prompt: 'paste the token', options: [], secret: true }],
      })
      expect(askedOfTheChannel(secret)).toEqual({
        travels: false,
        id: 'req_1',
        because: 'a-secret-only-a-person-can-type',
      })
      // ⛔ **ONE FACT OVER, and the pair is the measurement.** The same request with `secret`
      // removed travels — so what was measured is the flag rather than the free-form shape.
      expect(
        askedOfTheChannel(
          CARD({ questions: [{ id: 'q0', prompt: 'paste the token', options: [] }] }),
        ),
      ).toMatchObject({ travels: true })
    })

    it('⛔ ONE secret among several makes the whole request a person’s', () => {
      // ⚠️ **`139` measured a real two-question call** (`sess_71a5b654` ord 234), and both providers
      // take ONE response for the whole request — a partial answer is failed closed by both adapters
      // — so a request cannot be split into the part an agent may see and the part it may not.
      expect(
        askedOfTheChannel(
          CARD({
            questions: [
              { id: 'q0', prompt: 'which branch?', options: [{ label: 'main' }] },
              { id: 'q1', prompt: 'paste the token', options: [], secret: true },
            ],
          }),
        ),
      ).toMatchObject({ because: 'a-secret-only-a-person-can-type' })
    })

    it('⚑ an event that asks nobody anything is not classified at all', () => {
      for (const event of [
        { type: 'status', state: 'idle' },
        { type: 'assistant_message', text: 'hello' },
        { type: 'request_resolved', id: 'req_1' },
      ] as unknown as RuntimeEvent[]) {
        expect(askedOfTheChannel(event), event.type).toBeNull()
      }
    })
  })

  it('🔴 728 · a server’s form with fields does NOT travel to a parent — the same questions without the marker DO (red on main: it travelled)', () => {
    const questions = [{ id: 'name', prompt: 'Your name', options: [] }]
    expect(askedOfTheChannel(CARD({ questions, mcpServerAsks: { server: 'probe728' } }))).toEqual({
      travels: false,
      id: expect.any(String),
      because: 'a-server-asks-the-person',
    })
    // ⚑ The control, one fact over: the model's own question travels as it always has.
    expect(askedOfTheChannel(CARD({ questions }))).toMatchObject({ travels: true })
  })

  it('🔴 728 review · a server’s zero-field card or url visit — a PERMISSION request — is named the server’s too, not the agent’s approval', () => {
    const serversCard = {
      type: 'permission_request',
      id: 'req_s',
      mcpServerAsks: { server: 'probe728' },
    } as unknown as RuntimeEvent
    expect(askedOfTheChannel(serversCard)).toEqual({
      travels: false,
      id: 'req_s',
      because: 'a-server-asks-the-person',
    })
    // ⚑ The control, one fact over: without the marker it is the agent's approval, as ever.
    expect(
      askedOfTheChannel({ type: 'permission_request', id: 'req_p' } as unknown as RuntimeEvent),
    ).toMatchObject({ because: 'a-permission-decision' })
  })

  describe('§2 · the vocabulary', () => {
    it('🔴 every member of CHANNEL_REFUSALS is REACHED by the classifier', () => {
      // ⛔ **`341`'s census — *every rail in the vocabulary is reached by the door*** — because a
      // member nothing can produce is a word in a list rather than a rule, and a reader would take
      // its presence for coverage. ⚑ Each shape below is the one that produces it.
      const reached: Record<ChannelRefusal, RuntimeEvent> = {
        'a-permission-decision': {
          type: 'permission_request',
          id: 'req_p',
        } as unknown as RuntimeEvent,
        'a-grant-of-access': CARD({ questions: [], permission: { paths: [], network: false } }),
        'a-consent-with-nothing-to-answer': CARD({ questions: [] }),
        'a-shape-this-app-has-not-been-taught': CARD({ escalate: true }),
        'a-secret-only-a-person-can-type': CARD({
          questions: [{ id: 'q0', prompt: 'token', options: [], secret: true }],
        }),
        // ⚑ 728 · a server's own form — an ordinary question's shape, plus the marker that says whose.
        'a-server-asks-the-person': CARD({
          questions: [{ id: 'name', prompt: 'Your name', options: [] }],
          mcpServerAsks: { server: 'probe728' },
        }),
      }
      // ⚠️ **Keyed by the type, so a sixth member does not compile until somebody produces it** —
      // a `for` over the constant with a lookup would pass over a member nobody had written a shape
      // for.
      for (const rail of CHANNEL_REFUSALS) {
        const verdict = askedOfTheChannel(reached[rail])
        expect(verdict, rail).toEqual({
          travels: false,
          id: verdict?.travels === false ? verdict.id : '',
          because: rail,
        })
      }
      expect(Object.keys(reached).sort()).toEqual([...CHANNEL_REFUSALS].sort())
    })

    it('⚠️ every refusal has its own sentence, and they are prose', () => {
      const sentences = CHANNEL_REFUSALS.map((rail) => CHANNEL_REFUSAL_SENTENCES[rail])
      expect(new Set(sentences).size).toBe(CHANNEL_REFUSALS.length)
      // ⚑ **Non-vacuity: these really are sentences and not slugs.** `347`'s own census compared 21
      // `undefined`s before somebody read the return type, so the shape is asserted rather than
      // assumed.
      expect(sentences.every((one) => one.includes(' '))).toBe(true)
      // ⛔ **And they are for a READER of a ledger, not for a model.** None of them instructs
      // anybody to do anything — the model-facing sentences live in `question-rails.ts`, one package
      // over, and `a-question-finds-a-person.test.ts` asserts no string is shared between the two.
      expect(sentences.some((one) => one.includes('you'))).toBe(false)
    })
  })
})
