import { type RuntimeEventSink } from '../conversation-caller'
import { type Provider } from '@brobot2/shared'

/** What is true of one session this host is running that nobody owns (336 §2.4). */
interface UnclaimedBase {
  readonly sessionId: string
  /** When the slot was reserved, epoch ms — how long it has been nobody's. */
  readonly since: number
  /**
   * 🔴 **Who may already be giving this conversation work** (349, HO-006 §4.5) — or `null`
   * for one nobody was given command of.
   *
   * ⛔ **340 named its own gap here and left it**: *"`commandedBy` is not on `UnclaimedSession`, and
   * a person taking a session over is not told an agent can still drive it."* ⚡ **Unowned is not
   * the same as unattended**, and this list existed to stop the first from reading as a hang. A
   * session nobody owns can still be one an agent is actively driving, and a caller choosing what
   * to offer a person cannot tell those apart without this field.
   *
   * ⚠️ **On the BASE, so both states carry it**, and a reservation whose provider has not arrived
   * carries it too — `commandedBy` is fixed at reservation ({@link SessionSlot.commandedBy}), so it
   * is known strictly before there is anything else to say about the session.
   *
   * ⚠️ **An id, and this list is where an id is the right answer.** It reports to the main process,
   * beside a `sessionId`; nothing puts it on a screen. The person-facing half of §4.5 is
   * `CreatedSession.hasACommander`, which is a fact and not an identity — see `runtime-ipc.ts`.
   */
  readonly commandedBy: string | null
}

/**
 * 🔴 **A session nobody owns, in the two states one can be in.**
 *
 * ⛔ **A union rather than optional fields**, because *"there is no provider yet"* and *"the
 * provider is not waiting on anybody"* are different answers and an `undefined` would be one word
 * for both — 074's rule, which this app has now paid for in four places.
 */
export type UnclaimedSession =
  | (UnclaimedBase & {
      /** Reserved; the provider has not arrived. There is nothing to describe and nobody to ask. */
      readonly running: false
    })
  | (UnclaimedBase & {
      readonly running: true
      readonly provider: Provider
      readonly cwd: string
      /**
       * 🔴 **It has stopped and is waiting for a person, and there is no person** (336 §2.4).
       *
       * ⚠️ **This is the state, and naming it is what stops it being a hang.** The turn is not
       * wedged and nothing is lost: the request is on the ledger with its ordinal, the session
       * machine holds `waiting_permission` until it is answered, and a claim replays the card to
       * whoever takes the conversation over. What was missing was any way to find out.
       */
      readonly waitingForAHuman: boolean
    })

/**
 * 🔴 **Where a session's events go when nothing is listening** (336 §2).
 *
 * ⛔ **It is a discard, not an owner.** {@link SessionSlot.ownerId} carries `null` for these
 * sessions and every gate reads the SLOT, so nothing consults this object's identity; the field
 * exists because {@link RuntimeEventSink} declares it, and the value is the one string no
 * `sinkOwnerId` can mint — see `ipc.ts`, which prefixes every real one with `webContents:`.
 *
 * ⚠️ **Never hand it to {@link RuntimeHost.claimSession} as the claimer.** It satisfies the type, and
 * a claim made with it would set `ownerId` to the string above — an owner no window can present and
 * {@link mayClaim} will never see as free again, so the conversation would be stranded exactly the
 * way 182 H5 stranded one. The only caller of the claim path is the IPC boundary, which always has a
 * window's own sink; this is written down because the type cannot say it.
 *
 * ⚑ **The mechanism this app already had, and it is 320's split.** *"The ordinal is taken and the
 * row written whether or not anyone is listening"* — `deliver` and {@link emitOurs} both append
 * first and then return early on a dead sink. So a session with no surface records its entire
 * conversation and delivers none of it, on exactly the path a session whose window was closed
 * already takes. ⚠️ **Nothing new carries these events; the claim replays them out of the ledger**,
 * which is what 303 measured as lossless.
 *
 * ⛔ **`alive: false` is the honest declaration, not the load-bearing part — measured.** Flipping it
 * to `true` changes no observable behaviour, because `send` and `sendLiveness` below are no-ops: the
 * events would be handed to a function that drops them instead of being kept from a function that
 * would. ⚠️ **So there is no mutation row for that field**, and this paragraph is why — a row on it
 * would record as a survivor and mean nothing (074's rule about a guard that is deliberately
 * uncovered). What it buys is that every `if (!sink.alive) return` in this class takes the branch it
 * already takes for a window that has gone, so no existing line had to learn about a new state.
 *
 * ## 🔴 The sentence above is TRUE and it was read one word too wide (396 §1, from `395` §6)
 *
 * ⛔ **It is true of every line that DELIVERS TO A SURFACE, and `deliver` had one line under that
 * gate that delivers to nothing of the kind** — {@link RuntimeHost.flushQueued}, which hands work to
 * a PROVIDER. ⚠️ So *"no existing line had to learn about a new state"* was a claim about the lines
 * as they were classified, and one of them was classified wrong: a message queued to a busy child
 * nobody was watching was never sent, on exactly the conversations a mailbox exists for.
 *
 * ⚑ **The gate is now a BLOCK rather than a `return`**, so what is conditional on attention is
 * conditional by decision rather than by position, and a line added below it does not silently
 * inherit the branch. ⛔ **The rule this leaves is the one to read the paragraph above by:**
 * *`sink.alive` answers "is anyone looking?", and a gate about attention decides nothing about
 * whether work happens.*
 */
const NO_SURFACE: RuntimeEventSink = {
  ownerId: 'no surface asked for this session',
  // ⛔ **`false`, because there is no surface at all here** (349) — the same sentence
  // {@link THE_APP_ITSELF} is refused at the answer door for: *nobody* is behind it.
  //
  // ⚠️ **And, like `alive` above, no gate reads THIS object's copy.** The three places that record
  // an owner's personhood — {@link RuntimeHost.createSession}'s reservation,
  // {@link RuntimeHost.resumeSession}'s, and {@link RuntimeHost.attachHeldSession}'s claim — read
  // the CALLER's sink or answer `false` for the absence of one; this constant is only ever
  // installed as a session's sink after the fact, and nothing asks it this question.
  //
  // ⛔ **A mutation row on it is still red, and NOT because a gate reads it.** `349`'s census
  // asserts that exactly one thing under `src/main` declares a person, so flipping this to `true`
  // is caught as a second declaration rather than as a wrong answer — the belt catching what the
  // braces cannot. See `M21`.
  aPersonIsBehindIt: false,
  alive: false,
  send() {},
  sendLiveness() {},
}

/**
 * The profile id {@link RuntimeHost.checkCwd} passes, because `resolveCwd` takes one and there is no
 * profile (203). It is never used: the only branch that reads it is the blank-path one, which
 * `checkCwd` short-circuits before it gets here. Named rather than `''` so a stub that echoes its
 * arguments produces something a reader can place.
 */
const CHECKING_A_FOLDER = 'checking-a-folder'

export { CHECKING_A_FOLDER, NO_SURFACE }
