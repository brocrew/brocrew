import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { capabilitiesFor } from '@brobot2/runtime'
import { runtimeCommandSchema } from '../src/main/runtime/ipc'
import {
  ALL_VERBS,
  SEND_REFUSALS,
  SEND_VERBS,
  SIGN_IN_SUPERSEDED_BLOCK,
  VERB_REQUIRES,
  WIRE_REFUSALS,
} from '../src/renderer/src/lib/send-refusals'

/**
 * # ⛔ Every state the host refuses a send in, named where the code is (219 §2)
 *
 * The dispatch: *"`signInSuperseded` is ONE fact the pane knows. Are there others? Enumerate every
 * state in which the host would refuse a send, and say for each whether the pane can know it before
 * the press."* — and then the reason for asking: ⚠️ ***"this project has now three times had a defect
 * live inside a gap a previous response doc had already named. Write it down where the code is, not
 * only in a doc."***
 *
 * `send-refusals.ts` is where it is written down. This file is what stops it becoming a lie.
 *
 * ## What is actually asserted, and what is not
 *
 * ⚑ **The CHAIN and the COUNT.** `RuntimeHost.send` reaches its refusals through six methods; this
 * censuses each one's body, matches every `throw` in it to a row, and fails when the two counts
 * disagree. A refusal added to `assertAcceptsMessages` tomorrow turns this red until somebody decides
 * whether the renderer can know about it — which is the whole point, because the alternative is that
 * `blocked` silently stops being the complete answer again.
 *
 * ⚠️ **It is a source census, and it is named as one** (`206` H1; the shape is
 * `one-way-to-stage.test.ts`'s). It proves the throw is written where the row says it is, not that
 * the refusal fires — `sign-in-supersede.test.ts` drives the host for that. What it buys is the one
 * thing behaviour tests cannot: an alarm on a refusal nobody has thought about yet.
 *
 * ⛔ **The `never` rows are asserted too, and that is not decoration.** `still-closing` is `never`
 * because `SessionLiveness` carries no `closing` field. The day someone adds one, the row's verdict
 * is wrong — so the absence is pinned rather than remembered.
 */

const here = dirname(fileURLToPath(import.meta.url))
const HOST = join(here, '../src/main/runtime/runtime-host.ts')
const IPC = join(here, '../src/shared/runtime-ipc.ts')
const PANE = join(here, '../src/renderer/src/components/ConversationPane.vue')
const SCREEN = join(here, '../src/renderer/src/components/RuntimeScreen.vue')
const STORE = join(here, '../src/renderer/src/lib/session-store.ts')

/**
 * Line comments and block comments removed.
 *
 * ⛔ **The stripper is load-bearing here for a reason this file demonstrates in its own subject**:
 * `assertSignInCurrent`'s body carries a comment reading *"Publish before throwing"*, and its doc
 * block is thick with the word. A census that counted prose would report refusals that do not exist.
 */
function codeOf(source: string): string {
  let inBlock = false
  return source
    .split('\n')
    .map((raw) => {
      let code = ''
      for (let at = 0; at < raw.length; at += 1) {
        const rest = raw.slice(at)
        if (inBlock) {
          if (!rest.startsWith('*/')) continue
          at += 1
          inBlock = false
          continue
        }
        if (rest.startsWith('//')) break
        if (rest.startsWith('/*')) {
          inBlock = true
          at += 1
          continue
        }
        code += raw[at]
      }
      return code
    })
    .join('\n')
}

/**
 * One CLASS METHOD's body, from its signature to the closing brace at two-space indent.
 *
 * ⚠️ **Two spaces, not zero**, and that is the difference from `one-way-to-stage.test.ts`'s: these
 * are methods on `RuntimeHost`, so column 0 would run to the end of the class. Everything nested
 * inside a method closes at four spaces or deeper — including `} catch (error) {` — so the first
 * `\n  }` after the signature is the method's own.
 */
function methodBody(source: string, signature: string): string {
  const from = source.indexOf(signature)
  if (from === -1) return ''
  const to = source.indexOf('\n  }', from)
  if (to === -1) return ''
  return source.slice(from, to)
}

/** How many `throw` statements a slice contains. Comments are already gone. */
function throws(body: string): number {
  return body.match(/\bthrow\b/g)?.length ?? 0
}

/**
 * The methods a send passes through, in the order it meets them.
 *
 * ⛔ **SIX since 234 §3.** `assertCanTakeTurn` used to be the linking method that refused nothing of
 * its own; it owns the content rule now (`228` L1), so it is censused like the rest rather than
 * asserted to be empty. ⚑ That assertion is what turned red when the rule landed — which is the
 * whole reason it was written that way.
 *
 * ⛔ **EIGHT since 340, and this list turning red is how the split announced itself.** A send no
 * longer enters through `require`: it asks the entitlement gate, which is *"may this caller GIVE
 * this session work"* rather than *"is this session yours"*, and the two questions an id is asked
 * either side of the entitlement moved into `sessionFor` so three entitlements cannot come to
 * disagree about their order. ⚑ `require` itself is no longer on the send path at all, so it is not
 * censused here — the methods below are what a send really meets, and the first assertion in the
 * file is what stops that claim from being a memory.
 *
 * ⛔ **STILL EIGHT at 431, and that is the finding rather than the absence of one.** The
 * entitlement gate a send asks CHANGED — `requireToMessage`/`assertMayMessage`, the same pair
 * `queueMessage` asks — and not one refusal was added, removed or re-worded, because the new gate
 * delegates its only throw to the same `assertMayControl` the old one did. ⚑ **A widening that
 * changed the rows would have been a different change**; this one moved who gets past, which is
 * 340's own distinction, made a second time.
 */
const SIGNATURES = {
  // ⛔ **670 moved the body, and this line turning red is how it announced itself.** The public
  // `send` is one line now — it hands the body a rule for a lost race — and the body, with every
  // gate below, is `sendAs`, which `queueMessage`'s idle branch also calls. ⚑ The public door is
  // pinned to that one delegation below, so the chain is still what a send meets.
  send: '\n  private async sendAs(',
  // ⛔ **`431` moved this link, and this list turning red is how that announced itself too.** A
  // send asks the MESSAGE entitlement now — `requireToMessage`, which admits everything
  // `mayCommand` admits plus, for an identity a person granted a global reach, a conversation it
  // did not start. ⚑ `requireToCommand` is no longer on the send path at all, so it is not censused
  // here; `queueMessage`'s idle branch delegates to `send`, and the two gates disagreeing was the
  // defect that made criterion 6 unreachable from inside the app's own method.
  requireToMessage: '\n  private requireToMessage(',
  sessionFor: '\n  private sessionFor(',
  // ⛔ **`431`'s predicate, censused for `assertMayReach`'s reason**: it is on the send path, it
  // decides who gets past, and it throws NOTHING — so a `throw` added inside it would be a refusal
  // on this chain that the table does not name, and this is the row-count that would catch it.
  withinMessagingReach: '\n  withinMessagingReach(',
  assertMayMessage: '\n  private assertMayMessage(',
  assertMayControl: '\n  private assertMayControl(',
  // ⛔ **374's messaging gate, added to the chain because it THROWS on the send path.** Without it
  // this census was structurally blind to the refusal that dispatch inserted between
  // `requireToCommand` and `assertCanTakeTurn`: `send`'s own body gained a call and not a `throw`,
  // so every count still matched and the claim below — *"the chain is the one the table assumes"* —
  // was quietly false. ⚠️ Its two rows are `knowable: 'never'` for a reason no other row has: this
  // window can never MEET them, because the gate asks nothing at all of a caller that is not an
  // agent. That is still worth a row: the alarm is on a refusal being added, not on one firing.
  assertMayReach: '\n  private assertMayReach(',
  assertCanTakeTurn: '\n  private async assertCanTakeTurn(',
  // ⚑ **The gate's last question, a method of its own**: what the words are as a command. The gate
  // asks it after its sign-in check, and a person's interrupt-and-send asks it alone, before its
  // stop, when the sign-in has moved and the words are held for the reopen.
  whatTheseWordsAre: '\n  private async whatTheseWordsAre(',
  // 🔴 **708 · the handover, censused for the one refusal it REPEATS** (708's review). ⛔ It refuses a
  // person's command that carries attachments when the list moved between the gate and here — the
  // gate's row, one door on — so a SECOND throw added to it is as loud as a new refusal.
  handToProvider: '\n  private handToProvider(',
  assertAcceptsMessages: '\n  private assertAcceptsMessages(',
  assertSignInCurrent: '\n  private async assertSignInCurrent(',
  // 🔴 **D-017 · R1 — a send to a conversation that is not running STARTS it, and this is the way
  // in.** ⛔ The public door no longer delegates only to `sendAs`: a conversation that cannot take
  // the words this instant goes through `deliverWhenItRuns`, which asks `refuseBeforeAStart` —
  // every rail the message would meet, so a refused message starts nothing — then the start, then
  // `sendAs` and the whole chain above. ⚑ Both are censused, because a refusal added to either is
  // one this window meets before the chain the table was written for; their throws are classified
  // below, by line.
  deliverWhenItRuns: '\n  private deliverWhenItRuns<T>(',
  refuseBeforeAStart: '\n  private async refuseBeforeAStart(',
} as const

type Method = keyof typeof SIGNATURES

/**
 * ⚑ **670 · a `throw` that passes a failure ON rather than refusing** — named here, by its line, so a
 * second one is as loud as a new refusal.
 *
 * ⛔ **Not a refusal, and the table says why it has no row**: *"past that line a send can still
 * fail … those are failures of a turn that HAPPENED"*. The adapter refused the handover, and the
 * body catches that only to HOLD a lost race; everything else it throws again, as it always
 * propagated. ⚠️ **The hold's own refusals are the queue's** (`queueAs`), which this file does not
 * census — `send-refusals.ts` says so in its `670` note. ⚠️ **Counted rather than skipped**, so the census cannot be quieted by a second catch
 * that swallows a refusal and re-throws something else.
 */
/**
 * ⚑ **708 · a throw that REPEATS a row's refusal at another door**, named by its line and the row it
 * repeats — {@link SIGNATURES}' `handToProvider` note says why it is there at all.
 *
 * ⚑ **D-017 · R1 — and at an EARLIER door**: `refuseBeforeAStart` asks, of a conversation that is
 * not running, the refusals its started self would give — so the words are a row's, said before
 * anything is started. ⛔ Each is pinned with the line that leads to it, because three of them are
 * the same `unknown session:` sentence and a bare line would be satisfied by any one of the three.
 */
const REPEATS_A_ROW: Partial<Record<Method, readonly { line: string; row: string }[]>> = {
  handToProvider: [
    {
      line: 'if (handed.length > 0) throw new ACommandTakesNoAttachments(command.word, command.listed)',
      row: 'a-command-takes-no-attachments',
    },
  ],
  refuseBeforeAStart: [
    // ⛔ An agent out of reach — `sessionFor`'s word, which a running conversation tells it too.
    {
      line: 'if (!this.withinMessagingReach(sessionId, by, me)) {\n        throw new Error(`unknown session: ${sessionId}`)',
      row: 'unknown-session',
    },
    // ⛔ No row, or one this app cannot start — the word a conversation it is not running gave.
    {
      line: '} else if (row === null || this.startable(sessionId) === null) {\n      throw new Error(`unknown session: ${sessionId}`)',
      row: 'unknown-session',
    },
    // ⛔ A commander (340) that would not command it as it runs — fail closed, the same word.
    {
      line: 'throw new Error(`unknown session: ${sessionId}`)\n    }\n    if (theSurfaceAsking(by) === null) return',
      row: 'unknown-session',
    },
    // ⚑ A person's window: words to send, and what is attached still where it was.
    {
      line: 'if (!hasSomethingToSend(text, attachments.length)) throw new Error(NOTHING_TO_SEND)',
      row: 'nothing-to-send',
    },
    {
      line: "if ('refusal' in handed) throw new Error(handed.refusal)",
      row: 'attachment-vanished',
    },
  ],
}

/*
 * ⚑ **D-016 · the one throw a send could not reach went with its rail.** `deliverWhenItRuns` and
 * `refuseBeforeAStart` are `queueMessage`'s way in too, and an agent's work message met the
 * one-open-task rail there (`WorkAlreadyOpen`), which a send — a `'note'` — never opened. ⛔ The
 * rail is gone (a busy conversation takes a piece now), so every throw in both links is a row, a
 * repeat of one, or a failure passed on — and the count below has no fourth term.
 */

const PASSED_ON: Partial<Record<Method, readonly string[]>> = {
  send: [
    "if (how.ifItLosesTheRace === 'pass-it-on' || !(error instanceof TurnInProgress)) throw error",
    // ⚑ **D-017 · R1 — the gate's own refusal, passed on unchanged**: the catch around
    // `assertCanTakeTurn` and the path recheck takes back only a conversation that STOPPED under a
    // send that went straight in (waited out and started again — *still closing* is never the
    // answer), and throws every other refusal as it came, each a row of the method that threw it.
    // ⚑ …and a person's own words on a moved sign-in are held for its reopen, not refused: every
    // other refusal is thrown as it came.
    "'after-a-lost-race',\n        )\n        return\n      }\n      throw error\n    }",
    // ⚑ …and a caller's words that no longer reach a service are taken as a lost race, never handed
    // over: the catch below holds them like any other, and the queue door asks again.
    'if (this.aCallersWordsNoLongerGoStraightIn(sessionId, by)) throw new TurnInProgress()',
  ],
  // ⚑ **D-017 · R1 — a start that did not happen, passed on in its own words** (R1: a start that
  // fails for a passing reason is a delivery failure with its true reason, never *not running*).
  // ⛔ Not a refusal of the words: the reopen door's failure, as `670`'s is the adapter's.
  // ⚑ **…and `refuseBeforeAStart`'s refusal, asked on ARRIVAL and passed on unchanged** (R1: every
  // rail before any start, and before a wait behind one) — each is a row of the method that threw it.
  deliverWhenItRuns: [
    'throw waker === null ? error : new AStartThatDidNotHappen(error)',
    'throw refused',
  ],
  // ⚑ A stamp that can't be read before the handover is passed on unchanged, once the record of
  // whose turn it was is put back: a command's, then any other words'.
  handToProvider: [
    'session.itsTurnIs = kept\n        throw error',
    'session.itsTurnIs = kept\n      throw error',
  ],
}

const host = codeOf(readFileSync(HOST, 'utf8'))
/** Written out rather than mapped, so each body is a known key and not an index lookup. */
const bodies: Record<Method, string> = {
  send: methodBody(host, SIGNATURES.send),
  requireToMessage: methodBody(host, SIGNATURES.requireToMessage),
  sessionFor: methodBody(host, SIGNATURES.sessionFor),
  withinMessagingReach: methodBody(host, SIGNATURES.withinMessagingReach),
  assertMayMessage: methodBody(host, SIGNATURES.assertMayMessage),
  assertMayControl: methodBody(host, SIGNATURES.assertMayControl),
  assertCanTakeTurn: methodBody(host, SIGNATURES.assertCanTakeTurn),
  whatTheseWordsAre: methodBody(host, SIGNATURES.whatTheseWordsAre),
  assertAcceptsMessages: methodBody(host, SIGNATURES.assertAcceptsMessages),
  assertSignInCurrent: methodBody(host, SIGNATURES.assertSignInCurrent),
  assertMayReach: methodBody(host, SIGNATURES.assertMayReach),
  handToProvider: methodBody(host, SIGNATURES.handToProvider),
  deliverWhenItRuns: methodBody(host, SIGNATURES.deliverWhenItRuns),
  refuseBeforeAStart: methodBody(host, SIGNATURES.refuseBeforeAStart),
}
/** The gate, and the last question it asks in a method of its own, in the order they are asked. */
const chain = `${bodies.assertCanTakeTurn}\n${bodies.whatTheseWordsAre}`

describe('the census can see what it is censusing', () => {
  it('⚑ every method body was really found, and the stripper did not empty them', () => {
    // ⛔ Non-vacuity FIRST. A renamed method returns '' from `methodBody`, and `throws('')` is 0 —
    // which would match a table row count of 0 and pass silently. Every rule below rests on this.
    for (const [name, body] of Object.entries(bodies)) {
      expect(body.length, `${name} was not found in runtime-host.ts`).toBeGreaterThan(80)
    }
    expect(chain.length, 'assertCanTakeTurn was not found').toBeGreaterThan(40)
    // …and the stripper left the code, not just the whitespace.
    expect(bodies.sessionFor).toContain('unknown session:')
    expect(bodies.assertSignInCurrent).toContain('checkSignIn')
  })

  it('⚑ the stripper removes prose that says "throw", and keeps statements that do', () => {
    // The teeth. `assertSignInCurrent` genuinely contains the word in a comment — *"Publish before
    // throwing"* — and exactly one real `throw`. Both halves in one assertion.
    expect(readFileSync(HOST, 'utf8')).toContain('Publish before throwing')
    expect(throws(bodies.assertSignInCurrent)).toBe(1)
    // …and a slice with a second one really does count two, so the counter is not stuck.
    expect(throws(`${bodies.assertSignInCurrent}\n    throw new Error('extra')`)).toBe(2)
  })
})

describe('219 §2 · the table names every refusal on the send path', () => {
  it('🔴 every throw in the chain is named by a row, and every row names a throw', () => {
    for (const [name, body] of Object.entries(bodies)) {
      const rows = SEND_REFUSALS.filter((refusal) => refusal.thrownBy === name)
      const passedOn = PASSED_ON[name as Method] ?? []
      const repeats = REPEATS_A_ROW[name as Method] ?? []
      expect(
        throws(body),
        `${name} throws a number of times the table does not account for — a refusal was added ` +
          'to the send path without deciding whether this window can know about it first',
      ).toBe(rows.length + passedOn.length + repeats.length)
      for (const line of passedOn) {
        expect(body, `${name} no longer passes the adapter's failure on as named`).toContain(line)
      }
      for (const repeat of repeats) {
        expect(body, `${name} no longer repeats ${repeat.row} as named`).toContain(repeat.line)
        expect(SEND_REFUSALS.map((row) => row.id)).toContain(repeat.row)
      }
      // …and each row is about a line that is really there, rather than about a memory of one.
      for (const row of rows) {
        expect(body, `${row.id} does not match anything in ${name}`).toContain(row.hostSays)
      }
    }
  })

  it('🔴 the chain is the one the table assumes — every method, reached in one order', () => {
    // ⛔ The count above is only meaningful if these ARE the methods a send passes through. A gate
    // moved out of `assertCanTakeTurn` would leave every count correct and the table wrong.
    expect(bodies.send).toContain('this.requireToMessage(')
    expect(bodies.send).toContain('this.assertCanTakeTurn(')
    expect(bodies.send).toContain('recheckHandedPaths(')
    // ⚑ …and its catch waits out a stop under it before anything else.
    expect(bodies.send).toContain(
      "if (how.onAStop === 'start-it-again' && this.itStoppedUnder(session)) {\n        return this.aDeliveryAStopCaught(sessionId, text, by, attachments, how)\n      }",
    )
    // ⛔ **670 · and the public door IS that body**, with a rule for a lost race and nothing else.
    // A second gate — or a second way in — added to the one-line door would sit outside this census,
    // so its code is pinned whole: exactly one statement, the delegation, and no `throw`.
    // ⚠️ **By its first parameter**, because `send(` at two-space indent is also a sink's method
    // in this file — twice.
    const THE_DOOR = '\n  send(\n    sessionId: string,'
    const door = methodBody(host, THE_DOOR)
    expect(host.split(THE_DOOR).length, 'more than one public `send` door').toBe(2)
    const opens = door.indexOf('): Promise<void> {')
    expect(opens, 'the public send lost its signature').toBeGreaterThan(0)
    const statements = door
      .slice(opens + '): Promise<void> {'.length)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    // 🔴 **D-017 · R1 — TWO ways in now, and both are pinned whole.** ⛔ A conversation that takes
    // the words this instant gets them straight through `sendAs` (a stop under them is waited out
    // and it is started again); any other goes through `deliverWhenItRuns` — its rails, its start,
    // then the same `sendAs`. ⚠️ **The only other statements are the take (R5) and its read**, whose
    // failure is handed back as a rejection rather than thrown: neither refuses the words.
    expect(statements).toEqual([
      'let now: boolean',
      'try {',
      'now = this.takesADeliveryNow(sessionId)',
      'if (now) this.aPersonsWindowTakesIt(sessionId, theSurfaceAsking(by))',
      '} catch (error) {',
      'return Promise.reject(error)',
      '}',
      // ⚑ **D-017 · R10 — the second way in delivers to the conversation it is HANDED**: the one
      // that took the place of one that could never be reopened, or the id itself.
      'const send = (to: string): Promise<void> =>',
      "this.sendAs(to, text, by, attachments, { facts, ifItLosesTheRace: 'hold-it' })",
      'if (now) {',
      'return this.sendAs(sessionId, text, by, attachments, {',
      'facts,',
      "ifItLosesTheRace: 'hold-it',",
      "onAStop: 'start-it-again',",
      '})',
      '}',
      'return this.deliverWhenItRuns(',
      'sessionId,',
      'text,',
      'by,',
      'attachments,',
      'WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS,',
      'send,',
      ')',
    ])
    expect(throws(door)).toBe(0)
    // ⛔ **…and the second way in asks the rails BEFORE the start and delivers through `sendAs`
    // after it**, so every refusal below is still asked of words that reach a provider, and the
    // early ones start nothing.
    // ⚑ **D-017 · R10 — asked of the conversation in its place** (`to`), which is the id itself
    // unless one that could never be reopened was replaced; the start answers where it went (`ran`).
    const wayIn = bodies.deliverWhenItRuns
    const railsAt = wayIn.indexOf('await this.refuseBeforeAStart(to, text, by, attachments, says)')
    expect(railsAt, 'the way in stopped asking the rails').toBeGreaterThan(-1)
    expect(railsAt).toBeLessThan(wayIn.indexOf('await this.ensureRunning('))
    const afterTheStart = wayIn.indexOf('return deliver(ran)')
    expect(afterTheStart, 'the way in stopped delivering after the start').toBeGreaterThan(-1)
    expect(wayIn.indexOf('await this.ensureRunning(')).toBeLessThan(afterTheStart)
    // ⛔ **The one delivery before the rails is to a conversation that RUNS** — one a delivery ahead
    // of this one started — so it goes through `sendAs` and meets the whole chain there.
    const straightIn = wayIn.indexOf('if (this.runsNow(to)) {')
    expect(straightIn, 'the way in lost its running check').toBeGreaterThan(-1)
    expect(wayIn.indexOf('return deliver(to)')).toBeGreaterThan(straightIn)
    expect(wayIn.indexOf('return deliver(to)')).toBeLessThan(railsAt)
    expect(wayIn.split('return deliver(')).toHaveLength(3)
    // ⚑ **What a send says it is, measured** — a `'note'`, the kind that asks the reach floor of an
    // agent and nothing of a window. ⚠️ D-016 took the one-open-task rail this also pinned (a
    // `note` opened no task, so a send never met it), and with it `OPENS_A_TASK`.
    expect(host).toContain("const WHAT_A_MESSAGE_NOBODY_DECLARED_SAYS: AgentMessageKind = 'note'")
    // ⚑ …and the rails it asks of a window delegate to the chain's own gate where there is a slot.
    expect(bodies.refuseBeforeAStart).toContain('this.assertMayMessage(slot, by)')
    expect(chain).toContain('this.assertAcceptsMessages(')
    expect(chain).toContain('this.assertSignInCurrent(')
    // ⛔ **340's two extra links, asserted rather than assumed** — `431`'s pair in their place.
    // `requireToMessage` refuses nothing itself and `assertMayMessage` throws nothing itself — both
    // delegate — so a count of `throw` statements can say nothing about either. What the table
    // rests on is that the delegation is really there: a gate that stopped calling `sessionFor`
    // would skip both id-shaped refusals with every row still matching, and one that stopped
    // calling `assertMayControl` would admit every stranger with the `not-yours` row still true of
    // a method nothing reaches.
    expect(bodies.requireToMessage).toContain('this.sessionFor(')
    expect(bodies.assertMayMessage).toContain('this.assertMayControl(')
    // ⛔ **`431`'s widening, asserted where it is.** The gate a send asks admits by reach, and a
    // `send` that quietly went back to `requireToCommand` is caught by the line above this one.
    // ⚠️ **What this file CANNOT catch is the wider gate spreading to another verb** — nothing here
    // reads `sendInterrupting` — and that negative lives where it can be measured:
    // `a-message-that-crosses-a-project.test.ts` §3 counts `this.requireToCommand(` across the whole
    // file, so a fourth verb taking the wider gate makes that count fall.
    expect(bodies.assertMayMessage).toContain('this.withinMessagingReach(slot.id, by)')
    expect(bodies.withinMessagingReach).toContain('reachesWhatItDidNotStart(')
    expect(host).toContain('private assertMayCommand(')
    // ⛔ **374's link, asserted the same way and for the same reason.** `send` calls it, and it is
    // the one method on this path whose refusal a window can never reach — so the delegation is
    // what has to be real, not the refusal firing.
    expect(bodies.send).toContain('this.assertMayReach(')
    expect(bodies.assertMayReach).toContain('sessionSpeakingAs(by)')
    // ⛔ **…and the linking method refuses ONE thing itself** (234 §3): the content rule, which the
    // host did not own until `228` L1 was taken. It is a row like any other now — this line used to
    // assert zero, and it is what caught the new throw rather than letting it in unclassified.
    // 🔴 **708 · and a SECOND, `R42`'s** — a person's command that carries attachments. It is a
    // row like the first; this count is what turned red when it landed, and it names both.
    // 🔴 **713 · and `R59`'s two** — a person's `/compact` on a conversation that compacts on
    // request, refused for its files and for its instructions, each a row of its own (the files one
    // repeats `R42`'s SENTENCE and not its decision — 713's review). This count turned red again
    // when they landed.
    expect(throws(chain), 'assertCanTakeTurn grew a refusal the table does not name').toBe(4)
    expect(bodies.assertCanTakeTurn).toContain('return this.whatTheseWordsAre(session, content)')
    expect(chain).toContain('hasSomethingToSend(')
    // ⚠️ …and `R42`'s and `R59`'s are asked LAST, below both session guards: a closing or superseded
    // conversation is refused for that, and its provider is asked nothing.
    for (const refusal of [
      'throw new ACommandTakesNoAttachments(command.word',
      'throw new ACommandTakesNoAttachments(compaction.word',
      'throw new ACompactionTakesNoInstructions(',
    ]) {
      expect(chain.indexOf(refusal), refusal).toBeGreaterThan(-1)
      expect(chain.indexOf('this.assertSignInCurrent('), refusal).toBeLessThan(
        chain.indexOf(refusal),
      )
    }
    // ⚠️ …and it is asked FIRST, above the two session guards it links, so a malformed command
    // never reaches the Keychain read that publishes before it throws.
    expect(chain.indexOf('hasSomethingToSend(')).toBeLessThan(
      chain.indexOf('this.assertAcceptsMessages('),
    )
    // Every row is about one of the six, so the count above covers the whole table.
    const named: string[] = Object.keys(SIGNATURES)
    expect(SEND_REFUSALS.every((row) => named.includes(row.thrownBy))).toBe(true)
  })

  it('⚑ the rows are distinct, and there are twelve of them', () => {
    expect(SEND_REFUSALS).toHaveLength(12)
    expect(new Set(SEND_REFUSALS.map((row) => row.id)).size).toBe(12)
    // Every row says what stops the gesture, or why nothing can — a row with an empty `gate` is a
    // row nobody finished thinking about, which is exactly what this file exists to prevent.
    for (const row of SEND_REFUSALS) {
      expect(row.gate.length, `${row.id} has no gate written down`).toBeGreaterThan(40)
    }
  })
})

describe('219 §2 · the knowable verdicts are true of the code today', () => {
  const row = (id: string) => SEND_REFUSALS.find((each) => each.id === id)!

  it('🔴 `sign-in-superseded` is first-press, and the pane now hands the composer the reason', () => {
    expect(row('sign-in-superseded').knowable).toBe('first-press')
    const pane = readFileSync(PANE, 'utf8')
    // ⛔ 217 §9's gap in one line: this binding did not exist, so `blocked` defaulted to null and
    // Send was lit in a state the pane already knew made a send impossible.
    expect(pane, 'ConversationPane stopped passing `blocked`').toContain(':blocked="sendBlocked"')
    expect(pane).toContain('SIGN_IN_SUPERSEDED_BLOCK')
  })

  it('🔴 `conversation-over` and `still-starting` are before-the-press, and the code still says so', () => {
    expect(row('conversation-over').knowable).toBe('before')
    expect(row('still-starting').knowable).toBe('before')
    // ⚠️ **`canSend` itself is asserted in `composer.render.test.ts`**, not here — it lives in an
    // SFC, and this file is in the node project, which cannot import one. That file pins
    // `canSend('hello', 'starting') === false` and the positive `canSend('hello', 'idle') === true`
    // beside it. What is pinned HERE is the half that file cannot see: the two structural facts
    // those verdicts rest on.
    const pane = readFileSync(PANE, 'utf8')
    // ⚑ **D-017b · there is no `ended` composer state any more** — a conversation whose fold stopped
    // is drawn from its ledger (`phase: 'recorded'`) and takes its next message, which
    // `startAndSend` carries through a start; so a press never reaches the host's *over*.
    expect(pane).toContain("if (props.record.phase === 'recorded') return 'idle'")
    expect(pane).not.toContain("return 'ended'")
    // …and one a message cannot continue says the host's own refusal in place of Send — a
    // `blocked`, read off the hand-over, before the press.
    expect(pane).toContain('const cannot = props.record.meta?.cannotTakeAMessage ?? null')
    expect(pane).toContain('if (cannot !== null) return cannot')
    // …and no composer exists at all before the session does, which is `still-starting`'s answer.
    expect(readFileSync(SCREEN, 'utf8')).toContain("surface === 'conversation' && active?.meta")
  })

  it('🔴 `a-command-takes-no-attachments` is BEFORE the press — and the gate it names exists, in one home', () => {
    // ⚑ **714 re-aimed this** (`708` H-3a). It asserted the row was `held-not-gated` and that NOTHING
    // in the renderer said *takes no attachments* — `708`'s own note: *"The day one appears, this goes
    // red and the row has to move to `before` — which is the point."* ⚑ `714` put the gate in, so the
    // row moved, and what is pinned now is that the gate is REAL and has one home.
    expect(row('a-command-takes-no-attachments').knowable).toBe('before')
    // ⚑ The window holds the fact: the transcript folds the provider's published list, prefix and all.
    const transcript = readFileSync(join(here, '../src/renderer/src/lib/transcript.ts'), 'utf8')
    expect(transcript).toContain("case 'provider_commands': {")
    // ⚑ …and the pane asks the gate of it, into the `blocked` the composer already honours.
    const pane = readFileSync(PANE, 'utf8')
    const from = pane.indexOf('const sendBlocked = computed<string | null>(() => {')
    expect(from, 'sendBlocked is gone').toBeGreaterThan(-1)
    const body = pane.slice(from, pane.indexOf('\n})', from))
    expect(body).toContain('aCommandInTheBox(props.draft, control.value.commands)')
    expect(body).toContain('aCommandTakesNoAttachmentsYet(command)')
    expect(body).toContain('props.handing.staged.length === 0')
    expect(pane).toContain(':blocked="sendBlocked"')
    // ⛔ **One home for the words** — searched over every renderer file by what a gate would have to
    // SAY, as `708` searched: only the gate's module says it, and this table describes it.
    const renderer = join(here, '../src/renderer/src')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const at = join(dir, entry.name)
        if (entry.isDirectory()) walk(at)
        else if (/\.(ts|vue)$/.test(entry.name)) files.push(at)
      }
    }
    walk(renderer)
    expect(files.length, 'the renderer walk found nothing').toBeGreaterThan(50)
    const saying = files
      .filter((file) => readFileSync(file, 'utf8').includes('takes no attachments'))
      .map((file) => file.slice(renderer.length + 1).replaceAll('\\', '/'))
      .sort()
    expect(saying).toEqual(['lib/a-command-with-files.ts', 'lib/send-refusals.ts'])
  })

  it('⚠️ 713 · `R59`’s two refusals are NEVER knowable — the fact reaches the window only as words', () => {
    // ⚑ Both rows claim nothing published carries the fact as data. The positive half: the window
    // DOES hold it, as the capability's note a person reads — so the negatives below are about
    // STRUCTURE and about GATES, not about the window being told nothing.
    expect(row('a-compaction-takes-no-attachments').knowable).toBe('never')
    expect(row('a-compaction-takes-no-instructions').knowable).toBe('never')
    const codex = capabilitiesFor('codex').requestCompaction
    expect(codex.state === 'available' ? codex.note : '').toContain('no instructions')
    // ⛔ **The structure: the capability is a state and words, nothing a gate could test.** A field
    // saying *"compacts on request"* or *"takes no instructions"* would appear here first.
    expect(Object.keys(codex).sort()).toEqual(['note', 'state'])
    // ⛔ **And no renderer file gates on it** — searched by what a gate would have to SAY or USE,
    // over every renderer file (708's review, for the row above it): the refusal's own words, the
    // host's rule module and the class, and the adapter's door by name.
    const renderer = join(here, '../src/renderer/src')
    const files: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const at = join(dir, entry.name)
        if (entry.isDirectory()) walk(at)
        else if (/\.(ts|vue)$/.test(entry.name)) files.push(at)
      }
    }
    walk(renderer)
    expect(files.length, 'the renderer walk found nothing').toBeGreaterThan(50)
    const GATE_SHAPES = [
      /compacts without instructions/,
      /ACompactionTakesNoInstructions|aCompactionTakesNoInstructions/,
      /aPersonsCompaction/,
      /\bcompactsOnRequest\b|handle\.compact\b/,
    ]
    for (const file of files) {
      // ⚠️ The rows' own file is where the refusals are DESCRIBED; it gates nothing.
      if (file.endsWith('send-refusals.ts')) continue
      const source = readFileSync(file, 'utf8')
      for (const shape of GATE_SHAPES) expect(source, `${file} matches ${shape}`).not.toMatch(shape)
    }
    // ⚑ **The control: each shape FINDS its subject where it lives**, so the search could succeed.
    const main =
      readFileSync(HOST, 'utf8') +
      readFileSync(join(here, '../src/main/runtime/a-command-goes-as-typed.ts'), 'utf8')
    for (const shape of GATE_SHAPES) expect(main, `${shape} finds nothing in main`).toMatch(shape)
  })

  it('🔴 `still-closing` is knowable BEFORE the press, and not from the liveness channel', () => {
    // ⛔ **The verdict 219 §2 got wrong on the first pass, and the review caught.** The obvious
    // reading is "the host holds `closing`/`finalizing`, nothing publishes them, so the renderer
    // cannot know" — and the first version of this row said exactly that. It is wrong: the renderer
    // does not learn this from the host at all. It is the one thing this side knows FIRST.
    expect(row('still-closing').knowable).toBe('before')
    // The liveness half of that reasoning is still true, and still worth pinning: if a `closing`
    // disclosure is ever added, there would be two answers to one question, which is the drift 064
    // and 099 are both about.
    const ipc = readFileSync(IPC, 'utf8')
    const from = ipc.indexOf('\nexport interface SessionLiveness {')
    const body = from === -1 ? '' : ipc.slice(from, ipc.indexOf('\n}', from))
    expect(
      body.length,
      'SessionLiveness was not found — this assertion is about nothing',
    ).toBeGreaterThan(400)
    expect(body).not.toMatch(/^\s*closing\??:/m)
    // The positive half: the fields it DOES carry are found by the same slice, so a mis-sliced
    // interface could not produce the negative above for free.
    expect(body).toMatch(/^\s*signInSuperseded\??:/m)
    // ⛔ …and the fact the verdict actually rests on: the STORE writes the phase before it awaits,
    // and the PANE gates on it. Two pins, because either one going away makes the row a lie.
    expect(readFileSync(STORE, 'utf8')).toContain("asked!.phase = 'closing'")
    expect(readFileSync(PANE, 'utf8')).toContain(
      "if (props.record.phase === 'closing') return CLOSING_BLOCK",
    )
  })
})

describe('219 §1 · the sentence a person reads', () => {
  it('🔴 is not the host’s exception text, and not the bar’s', () => {
    // ⛔ 202 §3 had to unpick a surface that forwarded a main-process error verbatim.
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('cannot send:')
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('Nothing has been sent.')
    // ⛔ …and 085's *"one refusal rendered twice"*: the bar is on screen at the same moment by
    // construction, so repeating its opening clause would be two sentences saying one thing.
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('your machine has moved on')
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toContain('A renewal counts')
  })

  it('🔴 says why the control is dark AND names the remedy — 118’s rule, 106’s rule', () => {
    // A greyed button still says "this is the thing to do here, later"; there is no later unless the
    // sentence says what reaches it.
    expect(SIGN_IN_SUPERSEDED_BLOCK).toMatch(/no message can go out/i)
    expect(SIGN_IN_SUPERSEDED_BLOCK).toMatch(/reopen/i)
    // One line under a text box, not a paragraph — the foot renders it beside the button.
    expect(SIGN_IN_SUPERSEDED_BLOCK.length).toBeLessThan(140)
    // ⛔ It claims no account, for 039's reason and the bar's: the Keychain blob carries no identity.
    expect(SIGN_IN_SUPERSEDED_BLOCK).not.toMatch(/@|signed in as|account/i)
  })
})

/**
 * # ⛔ The layer the census above cannot see (221 §1b)
 *
 * ⚑ **`SEND_REFUSALS` is censused against `runtime-host.ts`, and the refusal a real person hit is
 * not a throw and is not in that file.** It is `executeRuntimeCommand` failing a zod parse one layer
 * higher — a command that cannot pass the schema never reaches a gate, so a table built from gates
 * cannot list it. `WIRE_REFUSALS` is that layer, and this is what keeps it honest.
 *
 * ⚠️ **Two directions, and both matter.** Every row's `probe` goes through the REAL
 * `runtimeCommandSchema`, so a row cannot outlive the rule it describes; and the constraints on the
 * three declarations `sendShaped` is built from are COUNTED, so a rule cannot be added without
 * somebody classifying it. ⛔ Without the second, the table would go quietly stale in the same way a
 * response doc does — which is the failure `219` §2 exists to prevent.
 */
describe('221 §1b · the wire, censused against the schema itself', () => {
  const SCHEMA = join(here, '../src/main/runtime/ipc.ts')

  /**
   * The declarations a message-carrying command is built from, comment-free.
   *
   * ⛔ **FOUR now, not three** (234 §3). `goAheadText` is declared between `sendShaped` and the
   * union precisely so this slice reaches it: `endPlanMode`'s rule used to be written inline inside
   * `runtimeCommandSchema`, below where this stops reading, which is how a fourth message-carrying
   * verb kept `min(1)` for six dispatches with a census two feet away that could not see it.
   */
  function sendDeclarations(): string {
    const code = codeOf(readFileSync(SCHEMA, 'utf8'))
    const between = (from: string, to: string): string => {
      const at = code.indexOf(from)
      const end = code.indexOf(to, at)
      expect(at, `${from} was not found in ipc.ts`).toBeGreaterThan(-1)
      expect(end, `${to} was not found after ${from}`).toBeGreaterThan(at)
      return code.slice(at, end)
    }
    return [
      between('const sessionId =', 'const requestId'),
      // 🔴 **735 · `launchKey`, which the fifth send-shaped verb carries beside its message** — the
      // declaration `startAndSend`'s `.safeExtend` reuses, so its rules are counted where they live.
      between('const launchKey =', 'const attachments ='),
      between('const attachments =', 'function sendShaped'),
      between('function sendShaped', 'export const runtimeCommandSchema'),
    ].join('\n')
  }

  it('⚑ one row per constraint — a rule cannot be added without being classified', () => {
    const declarations = sendDeclarations()
    // ⛔ Non-vacuity: an empty slice would make the count zero and agree with an empty table.
    expect(declarations.length).toBeGreaterThan(400)
    const rules = declarations.match(/\.(?:min|max|refine)\(|z\.(?:enum|boolean)\(/g) ?? []
    expect(
      rules.length,
      'a rule was added to or removed from the send commands — give it a row in WIRE_REFUSALS',
    ).toBe(WIRE_REFUSALS.length)
    // ⛔ **And the LITERAL, because the line above cannot keep the PROSE honest** (234, review). The
    // table's own docblock said "Nine" over ten rows before this dispatch and "Ten" over eleven
    // during it: a count compared only against itself is a count nothing measures. Changing the
    // number here is the moment somebody has to go and change the sentence too.
    // ⚑ 12 → 14 at `735`: `launchKey`'s two, on `startAndSend`.
    expect(WIRE_REFUSALS).toHaveLength(14)
    // …and the table is not merely the right SIZE: every row names a field and says who holds it.
    for (const row of WIRE_REFUSALS) {
      expect(row.field.length, 'a row with no field').toBeGreaterThan(2)
      expect(
        row.composerHolds.length,
        `\`${row.field}\` is classified with no reason`,
      ).toBeGreaterThan(60)
    }
  })

  it('🔴 every probe is REALLY refused, by every verb its row claims', () => {
    // ⛔ **Per-row verbs since 234 §3.** Driving every probe through all four would have been worse
    // than useless: `endPlanMode` STRIPS an unknown `attachments` key, so the six attachment rows
    // would have parsed clean and the loop would have failed for a rule that is not its business.
    for (const row of WIRE_REFUSALS) {
      expect(row.verbs.length, `\`${row.field}\` claims no verb`).toBeGreaterThan(0)
      for (const kind of row.verbs) {
        // ⛔ **`VERB_REQUIRES` first, the probe second** (296). A verb with a required field of its
        // own — `sendToChild.agentId` — would otherwise be refused for the MISSING field rather
        // than for the rule under test, and a red for the wrong reason is indistinguishable from a
        // pass here. The probe still wins on any key it names, so a row can break the required
        // field too if that is what it is about.
        const command = { kind, sessionId: 'sess_1', ...VERB_REQUIRES[kind], ...row.probe }
        expect(
          runtimeCommandSchema.safeParse(command).success,
          `\`${row.field} ${row.rule}\` is in WIRE_REFUSALS and \`${kind}\` does not enforce it`,
        ).toBe(false)
      }
    }
  })

  /**
   * # ⛔ What the `verbs` column can and cannot be held to (234 §3, rewritten in review)
   *
   * ⚠️ **The first version of this test claimed to catch a row that quietly UNDER-claims, and it
   * did not.** Its check was a Set union over every row, so a verb stayed "claimed" as long as any
   * other row mentioned it — shrink the `text` row to `['send']` and everything stayed green. A
   * census whose comment promises more than its assertion is worse than no census, because the next
   * reader stops looking.
   *
   * ⛔ **So the claim is the one that is measurable: an EXCLUSION is a fact about the schema, not a
   * guess.** For every row that leaves `endPlanMode` out because the field is not on that command,
   * the probe must be ACCEPTED there — `endPlanMode` strips an unknown `attachments` key, and that
   * is precisely why those rows may not claim it.
   *
   * ⚠️ **One exclusion is NOT behaviourally distinguishable, and it is named rather than implied**:
   * the `text` row leaves `endPlanMode` out, and `endPlanMode` refuses `'   '` anyway through
   * `goAheadText`. Nothing here can tell that row's `verbs` from `ALL_VERBS`, so that part of the
   * map is pinned structurally instead — a weaker guarantee, and saying so is the point.
   */
  it('⚑ an exclusion is a fact about the schema, and the one that is not is named', () => {
    for (const row of WIRE_REFUSALS) {
      expect(row.verbs.length, `\`${row.field}\` claims no verb`).toBeGreaterThan(0)
      if (row.verbs.includes('endPlanMode') || !row.field.startsWith('attachments')) continue
      // ⛑ The measurable half: this row's rule genuinely is not on `endPlanMode`.
      expect(
        runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1', ...row.probe })
          .success,
        `\`${row.field}\` excludes endPlanMode, but endPlanMode refuses its probe — the row is wrong`,
      ).toBe(true)
    }
    // …and the structural half, for the rows behaviour cannot separate.
    expect(WIRE_REFUSALS.filter((row) => row.field === 'sessionId')).toHaveLength(2)
    for (const row of WIRE_REFUSALS.filter((row) => row.field === 'sessionId')) {
      expect(row.verbs, 'a shared declaration is censused on every verb that uses it').toEqual(
        ALL_VERBS,
      )
    }
    expect(
      WIRE_REFUSALS.filter((row) => row.verbs.includes('endPlanMode')).map((row) => row.field),
      'the fourth verb is censused by the two shared rules and by its own text rule, and no other',
    ).toEqual(['sessionId', 'sessionId', 'text (endPlanMode)'])
    expect(new Set(WIRE_REFUSALS.flatMap((row) => row.verbs))).toEqual(new Set(ALL_VERBS))
  })

  it('⚑ …and the legal payloads those probes are variations of are ACCEPTED — the paired positive', () => {
    // ⚠️ Without this, a schema that rejected everything would satisfy the test above completely.
    const attachments = [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }]
    // ⛔ **The go-ahead's own two legal shapes** (234 §3): the message, and the LEAVE that carries no
    // message at all. The second is why `goAheadText` is `.optional()` and not merely non-blank —
    // 085's asymmetry would be reversed by a rule that demanded text.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1', text: 'go ahead' })
        .success,
    ).toBe(true)
    expect(
      runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1' }).success,
      'leaving plan mode with no message is the 085 LEAVE and must still be a legal command',
    ).toBe(true)
    // …and the one the row is about, from the other side: `''` was already refused, `'   '` was not.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'endPlanMode', sessionId: 'sess_1', text: '' })
        .success,
    ).toBe(false)
    for (const kind of SEND_VERBS) {
      expect(
        runtimeCommandSchema.safeParse({ kind, sessionId: 'sess_1', text: 'hello' }).success,
      ).toBe(true)
      expect(
        runtimeCommandSchema.safeParse({ kind, sessionId: 'sess_1', text: 'here', attachments })
          .success,
      ).toBe(true)
      // ⛔ **And the one the whole dispatch is about**: no words, one attachment.
      expect(
        runtimeCommandSchema.safeParse({ kind, sessionId: 'sess_1', text: '', attachments })
          .success,
        'an attachment-only message is refused by the wire again — this is 220’s adoption blocker',
      ).toBe(true)
    }
    // ⛔ **The fifth verb's legal shape** (296), and it is the paired positive that makes the row
    // above mean something: without it, a `sendToChild` schema that refused every payload would
    // satisfy the refusal loop perfectly.
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'sendToChild',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        text: 'how is it going?',
      }).success,
    ).toBe(true)
    // ⚠️ **And the two ways it is NOT legal**, one per required field — so `VERB_REQUIRES` is doing
    // real work rather than papering over a schema that never wanted the id.
    expect(
      runtimeCommandSchema.safeParse({ kind: 'sendToChild', sessionId: 'sess_1', text: 'hello' })
        .success,
      'a message to no child in particular is not a command this wire accepts',
    ).toBe(false)
    expect(
      runtimeCommandSchema.safeParse({
        kind: 'sendToChild',
        sessionId: 'sess_1',
        agentId: 'agent_1',
        text: '   ',
      }).success,
    ).toBe(false)
  })

  it('⛔ nothing a composer can build is refused — and that is the CLAIM, not an empty table', () => {
    // §1b asks which side of the knowable line an attachment-only send falls on once the wire
    // accepts it. Neither: it stops being a refusal at all. What is left is eleven rules a person
    // has no gesture for, and the day one becomes reachable this line is where it is admitted.
    expect(WIRE_REFUSALS.filter((row) => row.verdict === 'reachable')).toEqual([])
    expect(WIRE_REFUSALS.every((row) => row.verdict === 'composer-cannot')).toBe(true)
    // …and no row of the GATE table claims the wire's ground, which is how the two stay one map
    // rather than two overlapping ones.
    expect(SEND_REFUSALS.map((row) => row.id)).not.toContain('attachment-only')
  })
})
