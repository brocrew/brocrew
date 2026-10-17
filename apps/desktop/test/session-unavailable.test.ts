import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  SessionUnavailable,
  UNAVAILABLE_REASONS,
  describeUnavailable,
  unavailableContextOf,
  unavailableOf,
} from '../src/main/runtime/session-unavailable'

/**
 * # No refusal in the open/reopen class may put an internal string on screen (100 §2)
 *
 * A red banner must explain that the session is already open without exposing an internal
 * session handle.
 *
 * `085` converted seven throw sites for exactly this and translated them once, at
 * `RuntimeHost.refuseAnswer` — *"he should never see a request key"* — and the reopen class was
 * never converted. This walks the whole vocabulary rather than the handful of refusals a host test
 * happens to reach, because the leak is a property of the sentence and the next reason added is the
 * one nobody will write a host test for.
 */
describe('the sentence a refused open shows a person (100)', () => {
  /**
   * Ids as they really look, from the report and from the tests.
   *
   * ⚠️ **The bare `sess_` prefix is here on purpose and is the important one.** A test that only
   * looked for the whole id would pass a sentence reading "…could not open sess_53d78fdf" — the
   * fragment is as much of a leak as the whole, and truncating is the likeliest way one would come
   * back.
   */
  const INTERNAL = [
    'sess_53d78fdf-3e9b-4b80-bbd0-dce624508cbd',
    'sess_',
    'webContents:',
    'owner:',
    'ownerId',
    'slot',
    'phase',
    'undefined',
    'null',
    '[object',
  ]

  it('every reason has one, and none of them leaks anything internal', () => {
    // Non-vacuity first: an empty vocabulary would satisfy every assertion in the loop below.
    expect(UNAVAILABLE_REASONS.length).toBeGreaterThanOrEqual(9)

    for (const reason of UNAVAILABLE_REASONS) {
      const sentence = describeUnavailable(reason)
      expect(sentence, reason).not.toBe('')
      // A sentence, not a state name: the reason itself must not be what a person is shown.
      expect(sentence, reason).not.toContain(reason)
      for (const internal of INTERNAL) {
        expect(sentence, `${reason} leaked ${internal}`).not.toContain(internal)
      }
      // It has to READ as a sentence — the whole complaint is that the old text was a diagnostic.
      expect(sentence, reason).toMatch(/^[A-Z].*[.!?]$/s)
    }
  })

  it('⛔ no two reasons share a sentence — the argument this file makes three times, asserted once', () => {
    // 🔴 **Found by 340's per-row killer check, and the gap is older than 340.** Three docblocks in
    // `session-unavailable.ts` say a refusal has *"its own code, and NOT `x`"* — because `x`'s
    // sentence would be false of it — and `118`, `214` and `336` each paid for that argument. But
    // nothing here checked that the SENTENCES stayed apart: two codes can be perfectly distinct and
    // read identically, and then the whole argument lives in the comments. A mutation replacing one
    // reason's sentence with another's walked through every assertion in this file.
    //
    // ⚠️ **It is the sentence that is the promise, not the code.** `describeUnavailable` exists so
    // that the words a person reads are keyed by the reason alone; two reasons answering with one
    // string means one of the two is being told something untrue about their own refusal, which is
    // exactly the defect each of those three docblocks was written to prevent.
    //
    // ⚑ **D-017 · R10 — ONE pair shares its sentence, and the census asks the pair its own
    // question.** `never-started` was split out of `cannot-be-reopened` for what the HOST does (a
    // delivery replaces a row its provider never named; a bundle or a person's own conversation is
    // never replaced), not for what a person reads: both say the ROW's own refusal
    // (`UnavailableContext.refusal`), which is what that row said as `cannot-be-reopened` before
    // the split. ⛔ So neither is told anything untrue about its refusal — the defect this census
    // exists for — and the pair is named rather than skipped: it must read the same in BOTH arms,
    // or the split changed the words and this exemption is false.
    const SAYS_THE_ROWS_OWN_REASON = { 'never-started': 'cannot-be-reopened' } as const
    for (const [split, from] of Object.entries(SAYS_THE_ROWS_OWN_REASON)) {
      expect(UNAVAILABLE_REASONS).toContain(split)
      expect(describeUnavailable(split as never)).toBe(describeUnavailable(from))
      const refusal = 'no turn was ever taken in this one'
      expect(describeUnavailable(split as never, { refusal })).toBe(
        describeUnavailable(from, { refusal }),
      )
      expect(describeUnavailable(split as never, { refusal })).toContain(refusal)
    }
    const sentences = UNAVAILABLE_REASONS.map((reason) => describeUnavailable(reason))
    const seen = new Map<string, string>()
    for (const [index, sentence] of sentences.entries()) {
      const reason = UNAVAILABLE_REASONS[index] as string
      if (reason in SAYS_THE_ROWS_OWN_REASON) continue
      const first = seen.get(sentence)
      expect(first, `${reason} reads exactly like ${first ?? ''}`).toBeUndefined()
      seen.set(sentence, reason)
    }
    // …and the walk really covered the vocabulary, rather than a list that had gone empty.
    expect(seen.size).toBe(
      UNAVAILABLE_REASONS.length - Object.keys(SAYS_THE_ROWS_OWN_REASON).length,
    )
  })

  it('says what is holding the conversation AND what to do about it', () => {
    // A genuinely live slot says what it is waiting for and offers an actionable way out.
    // Reasons that are only facts about a recording must not pretend the person can clear
    // them.
    const actionable = UNAVAILABLE_REASONS.filter(
      (reason) =>
        reason !== 'not-recorded' &&
        reason !== 'read-only' &&
        reason !== 'already-open' &&
        // 118 — a sub-agent conversation is the same class as `read-only`: a fact about a recording
        // rather than a state that will pass. There IS no way forward to name, and inventing one
        // ("try again in a moment") would be the app promising something that cannot happen. What
        // it does instead is say what the conversation still offers, which the sentence does.
        reason !== 'no-input-end' &&
        // 214 §1 — the same class again, and the clearest case of it: a bundle somebody sent you
        // was never run by a provider on this machine, so there is no state that will pass and no
        // second press that helps. Its sentence says what BroBot HAS instead, which is the part a
        // person needs, and `086` is why it must not invent a way forward it does not have.
        reason !== 'restored-elsewhere' &&
        // ⚑ **D-017b · the same class, since the press it named went.** `started-here` answers a
        // hand-back of a conversation the caller started itself, and its way forward was *End
        // conversation* — a press D-017b deleted with every other sentence about stopping one.
        // What is left is a fact that will not pass (*"there is nobody to hand it back to"*): the
        // caller already has the conversation, and `086` is why it must not invent a gesture.
        reason !== 'started-here',
    )
    for (const reason of actionable) {
      const sentence = describeUnavailable(reason)
      // ⚠️ `Start it again` joined this list for 102's `cancelled`, and the alternation is WIDER,
      // not weaker: every actionable reason still has to name a way forward, and a sentence that
      // named none would fail exactly as before. The one it admits is the only refusal a person
      // asked for, so "try again in a moment" would be the app telling them to undo their own
      // press — the way forward is genuinely different, and the wording says so.
      //
      // ⚠️ `Open it again` joined it for 265 §1's `surface-gone`, on the same rule and for a
      // difference that is just as real: the conversation EXISTS and was never started, so *"start
      // it again"* would name a new conversation and *"try again in a moment"* would describe a
      // state that will pass on its own. This one passed the moment the window came back.
      //
      // ⚠️ `Reopen it` joined it for 336's `not-running`, and it is the fourth genuinely different
      // way forward. That refusal is a take-over of a conversation this host is not running: it will
      // not start running on its own, so *"try again"* is false; a new conversation is not what was
      // asked for, so *"start it again"* names the wrong thing; and there is no window to go back to,
      // so *"open it again"* is about the wrong object. What a person does is press Reopen, which is
      // a button that exists and which no other refusal points at.
      //
      // ⚠️ `answer it there` joined it for 340's `a-person-must-answer`, and it is the fifth, and
      // the first one that is about WHO rather than about getting at the conversation. Every other
      // way forward above assumes the asker is the one who will act: try again, start it, open it,
      // reopen it, switch to it. This refusal is given to a caller that already HAS the conversation
      // — it may send to it and interrupt it — and is being told that this one gesture is not its to
      // make. So *"try again"* is false (nothing passes on its own), *"switch to that window"* is
      // false (there may be no window; the conversation may be nobody's), and the move really is for
      // a person to open it and answer. The alternation is wider, not weaker: a sentence that named
      // no way forward at all still fails exactly as before.
      //
      // ⚠️ `Take it over` joined it for 421's `held-by-nobody`, and it is the SIXTH genuinely
      // different way forward — the first one that names a gesture this refusal's own surface now
      // offers. The conversation is running, so *"try again"* is false and *"reopen it"* names a
      // door the host will refuse for as long as the id is live; nobody holds it, so *"switch to
      // that window"* is the sentence `418` measured being a lie. What a person does is take it
      // over, which is a press on the row they are already looking at.
      //
      // ⚠️ `did not reopen` joined it for 504's `cannot-be-reopened`, and it is the SEVENTH — the
      // first one whose way forward is carried by the ROW rather than written here. That refusal is
      // about a conversation BroBot2 is holding and resume has no address for, and the store already
      // owns six sentences for the six ways that happens; three of them name the move in their own
      // words (*"BroBot can read it here"*, *"BroBot has the whole conversation and can show it"*),
      // and for *"no turn was ever taken in this one"* there is honestly nothing to do — which is
      // `086` in the direction that is easy to miss: never claim more than happened. ⛔ So this
      // clause admits the same shape `lost-its-place` already has — it says plainly that the thing
      // did not happen, and says why — and the alternation is still what it was for the other
      // twelve. A sentence naming no way forward AND no outcome still fails exactly as before.
      //
      // ⚠️ `End it` joined it for 523's `started-here` (⚑ D-017: `End conversation`, the press it
      // names, which STOPS it — nothing ends a conversation), and it is the EIGHTH genuinely different way
      // forward — the first one that is not a way to REACH the conversation. Every clause above
      // answers *"how do I get to it"*; this refusal is given to a caller that is already in it, has
      // every right it could want over it, and asked for the one act that does not exist for a
      // conversation it started itself. ⛔ *"Try again"* is false (nothing passes on its own),
      // *"take it over"* is false (it already has it), and *"reopen it"* names a door the host
      // refuses for as long as the id is live. ⚑ What a person does about it is end it — the control
      // one place along on the same bar — or leave it running, which is what they were doing.
      //
      // 🔴 **716 · `710` F-5 — `Try again` stays in the alternation for no sentence at all now**: the
      // four that said it (`run-by-another-host`, `still-opening`, `took-too-long`, `still-closing`)
      // say what the app does by itself and the gesture that works — *opens by itself*, *can
      // continue here*, *start it again*, *a message sent to it waits*
      // (`what-a-person-can-do-instead-of-try-again.test.ts` owns them).
      //
      // ⚑ **D-017b · there is no Reopen and no End any more** — one press opens every conversation
      // and a message continues it — so the alternatives that named them (*Reopen it*, *can be
      // reopened*, *a reopen waits*, *Reopening*, *did not reopen*, *End conversation*) are OUT
      // rather than kept: a sentence that named either press would name one that does not exist,
      // and this census must not pass it. ⚑ In their place, the gesture that replaced them — a
      // message: *send it your message again*, *Send it a message*, *a message sent to it waits*,
      // *can continue here* — and the outcome, said plainly, where there is none to name
      // (*did not continue*, *could not continue*, *cannot continue yet*), the shape
      // `cannot-be-reopened` was admitted on.
      expect(sentence, reason).toMatch(
        /Try again|Start it again|start it again|Open it again|opens by itself|Switch to|shutting down|did not open|answer it there|Take it over|can continue here|a message sent to it waits|A message sent to it waits|Send it a message|send it your message again|did not continue|could not continue|cannot continue yet/,
      )
    }
  })

  it('states the bound the one refusal nobody chose was given (102)', () => {
    // `took-too-long` is the launch's own ending — nobody pressed anything, so what it waited for
    // and how long is the whole of what it has to say. It reads the SEPARATE `waitedForMs`, not
    // `still-opening`'s elapsed time: one is the budget and the other is the spend, and a sentence
    // that confused them would tell a person a number about the wrong thing.
    const expired = describeUnavailable('took-too-long', { waitedForMs: 15_000, openingForMs: 900 })

    expect(expired).toContain('agent did not answer within 15s')
    expect(expired).not.toContain('900')
    // …and it is still a sentence with no measurement at all, because the context is optional at
    // every call site.
    expect(describeUnavailable('took-too-long')).toContain('did not answer in time')
    expect(describeUnavailable('took-too-long')).not.toContain('undefined')
  })

  it('states how long the one refusal with no other way out has been waiting', () => {
    // `still-opening` was the state nothing transitioned out of on its own — measured then: only
    // Codex reached it, because its handshake had no deadline. ⚠️ Since `102` the launch gives up on
    // itself, and since `716` the sentence says so (`710` F-5); the elapsed time is still the fact a
    // person decides on, so the number stays.
    const waited = describeUnavailable('still-opening', { openingForMs: 42_000 })

    expect(waited).toContain('42s')
    // …and it is still a sentence without it, because the context is optional at every call site.
    expect(describeUnavailable('still-opening')).not.toContain('undefined')
    expect(describeUnavailable('still-opening')).toContain('waiting for its agent')
  })

  it('keeps the diagnostic on the error and the id out of the sentence', () => {
    // The split this class exists for: the log gets everything, the user gets a sentence.
    const raw = 'session is already open: sess_53d78fdf (held for webContents:1)'
    const error = new SessionUnavailable('already-open-elsewhere', raw, { openingForMs: 5 })

    expect(error.message).toBe(raw)
    expect(unavailableOf(error)).toBe('already-open-elsewhere')
    expect(unavailableContextOf(error)).toEqual({ openingForMs: 5 })
    expect(describeUnavailable('already-open-elsewhere')).not.toContain('sess_')
  })

  it('leaves no untranslated throw on the path a refused reopen takes', () => {
    // ⚠️ **Review finding 14.** `resumeSession` translates by catching, and it passes anything it
    // does not recognise straight through — so a single plain `throw new Error(...)` anywhere on
    // that path puts the id back on screen and nothing else notices. This reads the source rather
    // than exercising each throw, because several of them are races no test can reach on demand;
    // what it pins is that none of them is a bare Error.
    const source = readFileSync(
      new URL('../src/main/runtime/runtime-host.ts', import.meta.url),
      'utf8',
    )
    /**
     * The two that are deliberately NOT in this class, named so the exemption is a decision.
     *
     * `require()` guards every per-session command — send, interrupt, close — not the opening of
     * one, and translating it properly means translating at the IPC boundary for all commands,
     * which is wider than 100 and is written up as a follow-up. They are listed here so a THIRD
     * raw throw cannot be added quietly: this test fails on it.
     */
    const notThisClass = [
      'unknown session: ${sessionId}',
      'session is still starting: ${sessionId}',
    ]
    // Every throw whose message interpolates a session id.
    const idBearing = [
      ...source.matchAll(
        /throw new (\w+)\(\s*\n?\s*(?:'[^']*',\s*\n?\s*)?`(session[^`]*\$\{(?:id|sessionId)\}[^`]*)`/g,
      ),
    ]
    // Non-vacuity: if the regex stops matching anything, this test is asserting over nothing.
    expect(idBearing.length).toBeGreaterThanOrEqual(4)
    let checked = 0
    for (const match of idBearing) {
      if (notThisClass.some((known) => match[2]?.startsWith(known))) continue
      checked++
      expect(
        match[1],
        `an id-bearing throw is a plain ${match[1]}: ${match[2]?.slice(0, 90)}`,
      ).toBe('SessionUnavailable')
    }
    // …and the exemption list must not have swallowed the whole set.
    expect(checked).toBeGreaterThanOrEqual(4)
  })

  it('does not claim to recognise an ordinary failure', () => {
    // Anything that is not one of ours passes through untranslated: inventing a sentence for a
    // failure we do not understand is how a real cause gets hidden behind a friendly noise.
    expect(unavailableOf(new Error('the disk is full'))).toBeNull()
    expect(unavailableOf('a string')).toBeNull()
    expect(unavailableOf(null)).toBeNull()
    expect(unavailableContextOf(new Error('the disk is full'))).toEqual({})
  })
})
