/**
 * ⛔ **Every state in which the host refuses a send, and whether this window can know it BEFORE the
 * press** (219 §2).
 *
 * ## Why this is a file and not a paragraph in a response doc
 *
 * `217` §9 found `blocked` withheld by `ConversationPane` by COMPARING the two composer mounts, and
 * `219` fixed it. That was the third time in this project a defect had been living inside a gap a
 * previous response doc had already named — `162`, `188`, and this one. A doc is read once, by
 * whoever is dispatched next; a module is read by everyone who touches the send path, and it can be
 * asserted against. `send-refusals.test.ts` censuses `RuntimeHost`'s gate chain against this list, so
 * a refusal added to the host without a row here turns red.
 *
 * ## What it is a list OF
 *
 * ⚠️ **The gate chain, not every way a send can fail.** `RuntimeHost.send` is `requireToMessage`
 * (→ `sessionFor`, `assertMayMessage` → `assertMayControl`) → `assertCanTakeTurn`
 * (→ `assertAcceptsMessages`, `assertSignInCurrent`) → `recheckHandedPaths`, and
 * every one of those refuses BEFORE the provider is spoken to — the message is still in the box and
 * nothing has been sent. Past that line a send can still fail (the provider dies mid-turn, the
 * ledger write breaks), but those are failures of a turn that HAPPENED, and no control could have
 * been dark for them. `169`'s rule is about gestures the app knew could not work.
 *
 * ⚠️ **670 · one more way past that line ends in a refusal of a turn that did NOT happen.** A send
 * that loses the handover to another turn is HELD, and the hold asks the QUEUE's gates again —
 * `RuntimeHost.queueAs`, which this list does not census. ⛔ So a send can now also be refused with
 * the queue's own sentences, exactly as the Queue button would have been at that moment. Nothing
 * was sent, and the words go back in the box.
 *
 * ⚑ **D-017 · R1 — a send to a conversation that is not running STARTS it.** It goes in through
 * `RuntimeHost.deliverWhenItRuns`: `refuseBeforeAStart` asks, before anything is started, the
 * refusals the started conversation would give (so a refused send starts nothing), then the start,
 * then the chain above. ⚑ **And a conversation that stops under a send that went straight in is
 * waited out and started again**, the words delivered after the start — *still closing* and *this
 * conversation is over* are never the answer to that. ⚠️ They remain the words for a stop that lands
 * a SECOND time, under words already carried through a start: the send is delivered again once,
 * never in a loop.
 *
 * ## What "knowable" decides
 *
 * ⛔ **It is not a list of things to gate.** `118`'s opposite defect — a control disabled for a state
 * that would have worked — is one row's worth of over-eagerness away, and `219` §4 forbids it
 * explicitly. A row is only worth gating when the renderer holds the fact with certainty. Everything
 * else is refused by the host, in words, with the message handed back (`019`), which is the honest
 * outcome for a fact this window does not have.
 *
 * ⚠️ **714 · one row gates on a fact the window holds USUALLY, and it is a ruling, not a slip**
 * (`714` §2.3, `708` H-3a): `a-command-takes-no-attachments` darkens Send from the provider's command
 * list as this window folded it, which is the host's list in the ordinary case and not in three
 * others that row names. ⚑ The PM's condition is the one this paragraph states for everything else:
 * **the host stays the authority**, so a refusal the window did not predict still reaches the person
 * in words with the message handed back.
 */

/**
 * Whether this window can know a refusal is coming.
 *
 * ⚑ **`first-press` is `217`'s nuance and it is not a softer `before`.** A supersession is
 * *discovered* by a gesture: `checkSignIn` costs a `security` subprocess and runs at the turn
 * boundary (and, since `690`, when an agent asks to wake the conversation), so the fact does not
 * exist until a send — or such a wake — has been refused once. The first press is
 * therefore unavoidable and gating it would be gating on a fact nobody has. Every press after it is
 * over a fact the window is holding, and that is the gap `219` closed.
 */
export type RefusalKnowable =
  /**
   * The renderer holds the fact before any gesture, and something is dark because of it.
   *
   * ⚠️ **714 · one row holds it USUALLY** — `a-command-takes-no-attachments`, whose `gate` names the
   * states where the window's copy is not the host's (and where the window holds no list, nothing
   * is dark at all). See the note above {@link SEND_REFUSALS}'s module header.
   */
  | 'before'
  /** Discovered BY a press; knowable from the second one on. */
  | 'first-press'
  /** Nothing published to this window distinguishes it — only the press can find out. */
  | 'never'

export interface SendRefusal {
  /** Short name, for the census and for talking about it. */
  readonly id: string
  /** The method that throws, as it is spelled in `runtime-host.ts`. */
  readonly thrownBy:
    | 'send'
    /**
     * ⚑ **340 split the entitlement and the throws went with the split.** A send enters through an
     * entitlement gate — *"may this caller give this session work"*, which a spawning agent passes
     * and a stranger does not — and the two id-shaped refusals below moved into `sessionFor`, the
     * one place the three questions an id is asked are asked in their one legal order. ⚠️ **`431`
     * changed WHICH gate**, to `requireToMessage`; it changed no refusal, because the new gate
     * delegates its only throw to the same `assertMayControl` the old one did.
     */
    | 'sessionFor'
    /**
     * ⛔ **`requireToMessage`/`assertMayMessage` since `431`, where `requireToCommand` and
     * `assertMayCommand` used to be.** A send asks the MESSAGE entitlement now — the same one
     * `queueMessage` asks — because the two are the two spellings of one act and only one of them
     * used to ask it. ⚑ Neither throws anything of its own; both are here because the census rests
     * on the delegation being real, and a gate that stopped delegating would leave every count
     * correct and the table wrong.
     */
    | 'requireToMessage'
    | 'assertMayMessage'
    | 'assertMayControl'
    | 'assertCanTakeTurn'
    /** What the words are as a command: the gate's last question, a method of its own. */
    | 'whatTheseWordsAre'
    | 'assertAcceptsMessages'
    | 'assertSignInCurrent'
    /**
     * ⛔ **374's messaging capability, and the only member on this list a window can never meet.**
     * The gate asks `sessionSpeakingAs(by)` first and a `webContents:<n>` decodes to `null`, so it
     * returns before it can refuse anybody with a surface. It is here because this table's census
     * raises an alarm when a refusal is ADDED to the send chain, not when one fires — and without
     * the member the chain stopped being the one the table describes.
     */
    | 'assertMayReach'
  /**
   * A fragment of the throw site, verbatim, long enough that the census can find it in that
   * method's body — the pin that makes this row about a real line rather than about a memory of one.
   */
  readonly hostSays: string
  readonly knowable: RefusalKnowable
  /** What stops the gesture in the renderer — or, for `never`, why nothing can. */
  readonly gate: string
}

/**
 * ⚠️ **Twelve rows, and the census asserts it is exactly twelve** — one per refusal reachable in the
 * chain, a throw that repeats a row's refusal at another door named in the census instead. Ordered
 * as a send meets them. (It said *"Eight"* over nine rows from `374` until `708` counted; `713`
 * added `R59`'s two.)
 */
export const SEND_REFUSALS: readonly SendRefusal[] = [
  {
    /**
     * 🔴 **374's messaging capability, on the send path and unreachable from this window.**
     *
     * ⛔ **A row rather than an exemption**, because the census this table feeds exists to raise an
     * alarm when a refusal is ADDED to the chain — not when one fires. `374` inserted
     * `RuntimeHost.assertMayReach` between the entitlement gate and `assertCanTakeTurn` on `send`,
     * `queueMessage` and `sendInterrupting`; `send`'s own body gained a call and not a `throw`, so
     * without these two rows and the method beside them the table stayed "complete" over a chain it
     * no longer described.
     */
    id: 'a-capability-refused-it',
    thrownBy: 'assertMayReach',
    hostSays: 'throw new MessagingRefused(',
    knowable: 'never',
    gate:
      'Nothing, and nothing ever will — which is a different “never” from every other row here. ' +
      'This gate asks `sessionSpeakingAs(by)` first, and a window’s `webContents:<n>` decodes to ' +
      '`null`, so the question is not asked of a person at all. ⚠️ **It is an absence of a question ' +
      'rather than an exemption**: there is no clause a later edit could make say `true` for a ' +
      'caller that is not an agent, because there is no clause. ⛔ **The capability is ' +
      '`can_message`**, and which of its rails refused the call is carried in the payload’s `rail`, ' +
      'in `341`’s shape, and read by the tool layer.',
  },
  {
    id: 'unknown-session',
    thrownBy: 'sessionFor',
    hostSays: 'unknown session:',
    knowable: 'never',
    gate:
      'Nothing. The window sends to the id the host gave it, and no channel says whether that slot ' +
      'is still held — a session the host has forgotten and one it is about to answer for look the ' +
      'same from here. ⚑ **D-017 · R1 — a conversation the host is not running is no longer refused ' +
      'this**: the send starts it (`deliverWhenItRuns`), and `refuseBeforeAStart` says these words ' +
      'only of a row nothing can start — none at all, a bundle, a sub-agent with no input end, or ' +
      'one adopted or found in a person’s own home. ⚑ **D-017b** — a conversation this window draws ' +
      'from its ledger (`phase: "recorded"`) sends through `startAndSend`, which answers rather than ' +
      'throws, and one a message cannot continue draws the host’s refusal in place of the composer ' +
      '(`CreatedSession.cannotTakeAMessage`).',
  },
  {
    id: 'not-yours',
    thrownBy: 'assertMayControl',
    hostSays: "'not-yours'",
    knowable: 'never',
    gate:
      'Nothing, and nothing should. 203 put ownership in main precisely so no surface has to be ' +
      'trusted about it; a renderer-side copy would be a second opinion about the one fact the ' +
      'check exists to be sole author of. This window renders only the conversations it was handed, ' +
      'so a press that reaches this refusal is holding an id from somewhere it does not own. ' +
      '⚠️ **340 widened WHO gets past it, not what a renderer knows about it**: `assertMayCommand` ' +
      'admits the caller a session was spawned for and then borrows this exact refusal for ' +
      'everybody else, so there is still one gesture and one diagnostic for “not yours”. ' +
      '🔴 **421 gave that one `throw` a SECOND sentence, and the count here is of throws rather ' +
      'than of sentences.** A conversation with no owner is refused `held-by-nobody` instead — ' +
      '*“not open in any window. Open it here”* — because `not-yours` sends a person to another ' +
      'window and a session an agent spawned has none. ⚠️ Still one row: what a renderer can know ' +
      'before the press is unchanged, and it is still `never`.',
  },
  {
    id: 'still-starting',
    thrownBy: 'sessionFor',
    hostSays: 'session is still starting:',
    knowable: 'before',
    gate:
      'Structural: `RuntimeScreen` mounts `ConversationPane` only on `active?.meta`, and `meta` is ' +
      'the `CreatedSession` the host returns after the slot is registered. There is no composer to ' +
      'press until the session exists. The LAUNCHER covers the same window with the `starting` ' +
      'composer state, which `canSend` refuses (103).',
  },
  {
    id: 'nothing-to-send',
    thrownBy: 'assertCanTakeTurn',
    hostSays: 'throw new Error(NOTHING_TO_SEND)',
    knowable: 'before',
    gate:
      '⛔ **234 §3, from `228` L1: the host owns the content rule now.** It was enforced at the ' +
      'wire and in the composer and nowhere in between, so a main-process caller — the endgame’s ' +
      'MCP spawn tools are the one being built — could queue a blank turn, or interrupt a running ' +
      'one to send spaces. ⚑ The renderer holds it BEFORE the press and has since 223: `canSend` ' +
      'asks `hasSomethingToSend(text, attached)`, the button is dark, and {@link nothingToSendYet} ' +
      'says why. Three layers, one predicate — which is the point, and the reason this row is ' +
      '`before` rather than `never`. ⚠️ **For the COMPOSER. The gate also guards `endPlanMode`, ' +
      'whose control is the plan bar’s go-ahead button and never asks `hasSomethingToSend`** — it ' +
      'sends a constant or nothing, so no gesture reaches this refusal there either, but by a ' +
      'different mechanism (noted in review rather than left implied).',
  },
  {
    id: 'still-closing',
    thrownBy: 'assertAcceptsMessages',
    knowable: 'before',
    hostSays: 'is still closing',
    gate:
      '⛔ **219 §2 found this one, and it is a SECOND instance of the defect 219 was dispatched ' +
      'for.** `closing`/`finalizing` are host-side fields and `SessionLiveness` carries neither — ' +
      'but the renderer does not need them: `sessionStore.close()` sets `record.phase = "closing"` ' +
      'BEFORE it awaits the host, deliberately (089, *"that a close was asked for is the one fact ' +
      'only this side holds"*), and the pane already reads it — `facetInput.phase` feeds the header ' +
      'plate, which draws the word "closing" while Send stayed lit beside it. Teardown drains and ' +
      'archives (075), so that window is long enough to type in. `sendBlocked` covers it now, with ' +
      '{@link CLOSING_BLOCK}. ⚑ **D-017 · R1 — the host no longer answers a send with it** when the ' +
      'conversation was closing before the press or stops under a send that went straight in: it ' +
      'waits the close out and starts the conversation again, and the words go after the start. ' +
      '⚠️ So the gate is no longer about a refusal — it keeps a press from starting again the ' +
      'conversation this window is closing. ⚠️ The words remain only for a second stop under words ' +
      'already carried through a start.',
  },
  {
    id: 'conversation-over',
    thrownBy: 'assertAcceptsMessages',
    hostSays: 'this conversation is over',
    knowable: 'before',
    gate:
      '⚑ **D-017b · there is no ended composer**: a conversation whose fold stopped is drawn from its ' +
      'ledger, and its message goes through `startAndSend`, which starts it first. ⚑ **D-017 · R1 — ' +
      'the host no longer answers a send to a stopped conversation with it**: the send starts it ' +
      '(`deliverWhenItRuns`), and a provider that ends under a send that went straight in is waited ' +
      'out and started again. ⚠️ The words remain only for a provider that ends a second time, under ' +
      'words already carried through a start.',
  },
  {
    id: 'sign-in-superseded',
    thrownBy: 'assertSignInCurrent',
    hostSays: 'sign-in it started with',
    knowable: 'first-press',
    gate:
      '⛔ **219 §1: `ConversationPane` passes `blocked`.** Until then this was the one send path ' +
      'left un-gated — the pane already read `signInSuperseded` for the go-ahead button beside it. ' +
      'See {@link SIGN_IN_SUPERSEDED_BLOCK} for the sentence and for why it is withheld while the ' +
      'composer is frozen or ended.',
  },
  {
    /**
     * 🔴 **713 · `R59` — a person's `/compact` with files, on a conversation that compacts on request.**
     *
     * ⛔ **Its own row, not a repeat of `R42`'s** (713's review): the SENTENCE is `R42`'s — *"/compact
     * is a command, and a command takes no attachments…"*, true, it is one, BroBot's own, hence
     * `listed: true` at the throw — but the DECISION is not. No list is asked: the handle decides
     * (`compact` exists or not), and Codex's published list is `$` skills that never hold `compact`.
     * So a composer gate built from the palette's list, which `R42`'s row describes, would never see
     * it — which is what `never` says.
     */
    id: 'a-compaction-takes-no-attachments',
    thrownBy: 'whatTheseWordsAre',
    hostSays:
      'if (content.attached > 0) throw new ACommandTakesNoAttachments(compaction.word, true)',
    knowable: 'never',
    gate:
      'Nothing, for the instructions row’s reason: whether a conversation compacts through a request ' +
      'of its own is a fact about its ADAPTER — the host asks whether the handle has `compact` — and ' +
      'nothing published to the window carries it as data. ⛔ The palette’s command list cannot stand ' +
      'in for it: Codex’s holds `$` skills and never `compact`. So the press is refused with `R42`’s ' +
      'sentence — it names the command, says what to do and ends *Nothing has been sent* — and the ' +
      'words and files go back in the box (`019`).',
  },
  {
    /**
     * 🔴 **713 · `R59` — a person's `/compact` with instructions, on a conversation that compacts
     * through a request that takes none** (Codex's `thread/compact/start`: `{ threadId }`, and an
     * `instructions` field measured accepted and DROPPED). ⛔ *"Refuse at the door with a sentence
     * saying Codex compacts without instructions, and never drop them silently."* ⚠️ Its
     * attachments are refused one throw above it, by `R42`'s own row — `send-refusals.test.ts`'s
     * `REPEATS_A_ROW` names that line.
     */
    id: 'a-compaction-takes-no-instructions',
    thrownBy: 'whatTheseWordsAre',
    hostSays: 'throw new ACompactionTakesNoInstructions(session.provider)',
    knowable: 'never',
    gate:
      'Nothing, and nothing published says it as data. Whether a conversation compacts through a ' +
      'request that takes no instructions is a fact about its ADAPTER — the host asks whether the ' +
      'handle has `compact` — and the window holds only the capability’s `note`, which says it in ' +
      'words for a person to read, not in a field a gate could test. ⛔ A gate keyed on the provider ' +
      'would be the renderer branching on which provider it is (`039`). So the press is refused with ' +
      'the host’s sentence — it names the provider, says what would have happened and what to do, and ' +
      'ends *Nothing has been sent* — and the words go back in the box (`019`).',
  },
  {
    /**
     * 🔴 **708 · `R42` — a person's command takes no attachments** (`a-command-goes-as-typed.ts`).
     *
     * ⛔ **Refused at the door, before anything moves**: the command would go bare, so its
     * attachment block would either be lost or be sent where the CLI reads it as part of the
     * command. `R42`: *"never sent with its attachment block, and never sent without telling them"*.
     */
    id: 'a-command-takes-no-attachments',
    thrownBy: 'whatTheseWordsAre',
    hostSays: 'throw new ACommandTakesNoAttachments(command.word, command.listed)',
    // ⚑ **714 · `before`, where `708` left it `held-not-gated`** — that word said the window held
    // the fact and nothing was dark for it, and `714` put the gate in (`708` H-3a). The word went
    // with its last row.
    knowable: 'before',
    gate:
      '⚑ **714 · `ConversationPane` passes `blocked`** — `aCommandInTheBox` (`a-command-with-files.ts`) ' +
      'asks the host’s question of the draft, the chips and the provider’s published command list ' +
      'this window folds (the palette’s `set`, from `provider_commands`): Send goes dark — Queue and ' +
      'interrupt-and-send give way to the plain stop, as for every `blocked` — and the foot says a ' +
      'command takes no attachments. ⚠️ **The ' +
      'window’s list is USUALLY the host’s and not always**: the host’s is per LIFE and starts empty ' +
      'at every reopen while the window’s fold keeps the last life’s until the new child publishes; ' +
      'the host may decide on its own bounded ASK before the window has seen the answer; and with no ' +
      'list at all the host judges by the CLI’s shape test, which a `set: null` says nothing about. ' +
      '⛔ **So the gate answers only where the window holds a list, and the host stays the ' +
      'authority**: a refusal the window did not predict is the host’s sentence — which names the ' +
      'command, says what to do and ends *Nothing has been sent* — beside the conversation, with the ' +
      'words and files back in the box (`019`). ⚠️ **And the other direction, stated rather than ' +
      'hidden**: a last life’s list that named a command the new life no longer publishes darkens ' +
      'Send over a press the host would take — the remedy is still under the pointer (take the file ' +
      'off, or send it in a message of its own), and the window re-reads the moment the new child ' +
      'publishes.',
  },
  {
    id: 'attachment-vanished',
    thrownBy: 'send',
    hostSays: "'refusal' in handed",
    knowable: 'never',
    gate:
      'Nothing, and 216 §3 decided that deliberately. `kind` and `outsideCwd` on the wire are a ' +
      'caption main wrote at choose-time; the filesystem is asked again at send-time because a file ' +
      'can be moved between the paperclip and the press. A renderer that pre-checked would be ' +
      'racing the same window with a worse answer, and BroBot does not read the bytes anyway.',
  },
]

/**
 * ⛔ **What the composer says when the machine sign-in has moved on** (219 §1).
 *
 * ## The sentence
 *
 * ⚠️ **Not the host's exception text, and not the bar's.** `202` §3 had to unpick a surface that
 * forwarded a main-process error verbatim; and `085`'s *"one refusal rendered twice"* is what
 * copying the bar would be, since the bar is on screen at the same time by construction — this is
 * only ever set while `signInSuperseded` is true, which is the bar's own `v-if`.
 *
 * So the division of labour is the one `169` established for the launcher's folder refusal, and the
 * words follow it: the BAR says what happened, what reopening costs and carries the button; this
 * says why the control under your pointer is dark and points at that button. Two sentences about one
 * state, neither of them a copy of the other.
 *
 * ⚑ **It names a remedy that is guaranteed to be on screen**, which is `106`'s rule with the extra
 * step: a disabled control must say what would let it, and the thing it names must be reachable.
 * `send-gate.dom.test.ts` asserts the Reopen button is rendered wherever this sentence is.
 */
export const SIGN_IN_SUPERSEDED_BLOCK =
  'No message can go out on the sign-in this conversation is holding — reopen it on the current one, above.'

/**
 * ⛔ **What the composer says while this conversation is being closed** (219 §2, found by the
 * enumeration rather than by the ticket).
 *
 * ⚑ **The same defect as the sign-in one, one fact over.** The pane has read `record.phase` all
 * along — it feeds the header plate, which draws **closing** — and the composer beside it went on
 * offering Send. Pressing it reached `assertAcceptsMessages` and came back *"cannot send: session …
 * is still closing"*, with the words handed back. The window is not a flicker: `close()` marks the
 * phase before the IPC call, and teardown drains and archives behind it (075).
 *
 * ⚠️ **It names no remedy, and that is correct rather than a shortfall.** `118`'s rule is that a
 * disabled control is only honest when the later is reachable — and here there is genuinely no
 * later for THIS conversation's composer: it is going away, by a gesture the user just made. So the
 * sentence says what is happening and where the words will be instead, which is the only true thing
 * to say. ⚑ **D-017b · and it names no process fact** (`05` rule 5): the close is a change the
 * conversation is taking up, and a message after it continues the conversation.
 */
export const CLOSING_BLOCK =
  'Wait a moment — this conversation is taking up the change. What you typed stays here.'

/**
 * # ⛔ The layer above the gates — what will never ARRIVE (221 §1b)
 *
 * ## Why the table above could not see the refusal a real person hit
 *
 * `SEND_REFUSALS` is censused against `runtime-host.ts`: six methods, every `throw` counted, eight
 * throws and eight rows. ⚑ **It is a good instrument and it is blind to one whole layer.** `220`
 * dropped a file on the launcher, pressed a lit Send and got
 * `invalid runtime command: text: Too small…` — which is not a throw, and is not in
 * `runtime-host.ts`. It is `executeRuntimeCommand` failing a zod parse in `ipc.ts`, one layer ABOVE
 * every method that census reads.
 *
 * > ⛔ **A command that cannot pass the schema never reaches a gate, so a table built from gates
 * > cannot list it.** `SEND_REFUSALS` answers *"what will the host refuse once the command
 * > arrives?"*. Nobody had asked *"what will never arrive?"*
 *
 * ## What "the composer cannot build it" means, and why every row says it
 *
 * ⛔ **This table is about payloads, not about states.** A row is `reachable` when a person, using
 * the app as it ships, can produce a payload the schema rejects. ⚠️ **After `221` §1 there are
 * none** — and that emptiness is the property worth asserting, not a reason to skip the table.
 * `send-refusals.test.ts` drives every `probe` below through the REAL `runtimeCommandSchema`, so a
 * row cannot describe a rule that no longer exists; and it counts the constraints on the four
 * declarations a message-carrying command is built from, so a rule cannot be ADDED without somebody
 * deciding which side of this line it falls on.
 *
 * ## ⚑ And the answer to §1b's question about `knowable`
 *
 * §1b asks which side of the `before` / `first-press` / `never` line an attachment-only send falls
 * on once the wire accepts it. **Neither: it stops being a refusal at all.** ⛔ That is the best
 * outcome a knowable refusal can have, and it is why `SEND_REFUSALS` gained no row for it — the gap
 * `220` found is not a gate that needed a better sentence, it was a rule that should never have
 * existed once an attachment could BE the content.
 *
 * ⚠️ **This paragraph said *"no eighth row"* until 234 §3, and there is one now** (found in review):
 * `nothing-to-send`, from `228` L1. It is not this rule coming back — it is the CONTENT rule, the
 * one an attachment satisfies, moving into the host so a main-process caller cannot skip it. The
 * claim that survives is the one the census still pins: no row of `SEND_REFUSALS` is about an
 * attachment-only send.
 */
export type WireVerdict =
  /** No gesture in the app can produce a payload that breaks this rule. */
  | 'composer-cannot'
  /** A person can build one, so the schema's words can reach a screen. */
  | 'reachable'

/**
 * ⛔ **The commands that carry a message — FOUR, not three** (234 §3, from `228` M3).
 *
 * `endPlanMode` reaches `session.handle.send` and writes a `user_turn` exactly as the other three
 * do, and it sat outside this table for six dispatches on the strength of *"the button only ever
 * sends a constant"*. ⚠️ **Rows are per-VERB now** rather than implicitly about the three, because
 * the four do not share a shape: the go-ahead takes no attachments at all, so an attachment rule
 * would be tested against a command that strips the field and would silently pass.
 */
export type WireVerb =
  | 'send'
  | 'sendInterrupting'
  | 'queueMessage'
  | 'endPlanMode'
  // 296. ⛔ **FIVE now**, and this one is the first that does not reach `session.handle.send` at
  // all: it addresses a CHILD of the session, through `handle.childInput`, and starts a turn in a
  // conversation this window is only watching. It is in this table for the reason `endPlanMode`
  // finally was — it carries a message a person types, and every rule on that message has to be
  // classified somewhere a reader will find it.
  | 'sendToChild'
  // 🔴 **735 · SIX**: a first message to a conversation the quit left open and the start it causes,
  // in one act. ⚑ Built by `sendShaped` like the three, so it holds their rules by construction —
  // and is listed with them so every row that says so is PROBED on it.
  | 'startAndSend'

/** The four that are built by one factory, and therefore cannot hold a rule one at a time. */
export const SEND_VERBS: readonly WireVerb[] = [
  'send',
  'sendInterrupting',
  'queueMessage',
  'startAndSend',
]

/** All six, for the declarations they share. */
export const ALL_VERBS: readonly WireVerb[] = [...SEND_VERBS, 'endPlanMode', 'sendToChild']

/**
 * ⛔ **What each verb needs BESIDE the field a row is probing** (296).
 *
 * ⚠️ **Without this the census would have gone vacuous for the new verb, quietly.** The two shared
 * `sessionId` rows drive their probe through every verb in {@link ALL_VERBS}; `sendToChild` also
 * requires an `agentId`, so those probes would have been refused for the MISSING ID rather than for
 * the empty session id — a red-for-the-wrong-reason that reads exactly like a pass. The rule this
 * closes is the one 279 ran into from the other side: an assertion that cannot fail for the reason
 * it names is an assertion about nothing.
 */
export const VERB_REQUIRES: Partial<Record<WireVerb, Record<string, unknown>>> = {
  sendToChild: { agentId: 'agent_1' },
}

export interface WireRefusal {
  /** The field the rule is on, as the schema spells it. */
  readonly field: string
  /** The constraint, in the schema's own terms. */
  readonly rule: string
  /**
   * ⛔ **Which commands this rule is ON.** The census drives the probe through each of them, so a
   * row cannot claim ground the schema does not hold — and a rule that applies to three of the four
   * says so instead of leaving the fourth unmeasured.
   */
  readonly verbs: readonly WireVerb[]
  /**
   * A payload that BREAKS this rule, minus its `kind` and `sessionId` — the census sends it through
   * the real schema, so a row describing a rule that has been removed turns red rather than
   * lingering as prose.
   */
  readonly probe: Record<string, unknown>
  /** What in the renderer makes a person unable to build that payload — or why nothing does. */
  readonly composerHolds: string
  readonly verdict: WireVerdict
}

/** One valid attachment, so a probe can break exactly one field of one. */
const A_PATH = { path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }

/**
 * ⚠️ **FOURTEEN rows** — one per constraint on the six declarations a message-carrying command is
 * built from (`sessionId` ×2, `attachments` ×7, the refine inside `sendShaped`, `goAheadText`,
 * `childMessage`, and — 🔴 `735` — `launchKey` ×2, which `startAndSend` carries beside its message).
 *
 * ⛔ **The number in this sentence has never been right until now** (234, found in review). It said
 * *"Nine"* over ten rows before this dispatch, and 234's first draft said *"Ten"* over eleven —
 * because the census compares `rules.length` against `WIRE_REFUSALS.length`, so the prose was the
 * one thing nothing measured. ⚑ `send-refusals.test.ts` now also asserts the LITERAL, which is the
 * only way a written count can be kept honest: a number nothing compares to is a number that drifts.
 */
export const WIRE_REFUSALS: readonly WireRefusal[] = [
  {
    field: 'sessionId',
    rule: 'min(1)',
    // Shared by every verb here: `sessionId` is one declaration, used by every command on this wire.
    verbs: ALL_VERBS,
    probe: { sessionId: '', text: 'hello' },
    composerHolds:
      'The id is the host’s own, handed back by `createSession`/`resume` and held in the record the ' +
      'pane is mounted on. A composer with no record does not render (`RuntimeScreen` mounts on ' +
      '`active?.meta`), so there is no press that could carry a blank one.',
    verdict: 'composer-cannot',
  },
  {
    field: 'sessionId',
    rule: 'max(200)',
    verbs: ALL_VERBS,
    probe: { sessionId: 's'.repeat(201), text: 'hello' },
    composerHolds:
      'Same: `newSessionId()` writes `sess_<uuid>`, and nothing in the renderer edits it.',
    verdict: 'composer-cannot',
  },
  {
    field: 'text',
    rule: 'refine(hasSomethingToSend)',
    verbs: SEND_VERBS,
    probe: { text: '   ' },
    composerHolds:
      '⛔ **The SAME function** (221 §1). `canSend` calls `hasSomethingToSend(text, attached)` and ' +
      'so does the schema, so the button is dark for exactly the payloads the wire refuses. This ' +
      'row is the defect 220 reported, from the other side: it used to be `min(1)` here and ' +
      '`text.trim() !== "" || attached > 0` there, and they disagreed about a message that is ' +
      'nothing but an attachment.',
    verdict: 'composer-cannot',
  },
  {
    field: 'attachments',
    rule: 'max(MAX_HANDED_PATHS)',
    verbs: SEND_VERBS,
    probe: { text: 'here', attachments: Array.from({ length: 11 }, () => A_PATH) },
    composerHolds:
      '`PromptComposer.stage` stops at the ceiling and says so out loud (216) — *"one message can ' +
      'carry 10 attachments — the rest were not added"* — rather than silently keeping the first ' +
      'ten. `classifyDroppedPaths` and `captionHandedPaths` bound their own reads at the same number.',
    verdict: 'composer-cannot',
  },
  {
    field: 'attachments[].path',
    rule: 'min(1)',
    verbs: SEND_VERBS,
    probe: { text: 'here', attachments: [{ ...A_PATH, path: '' }] },
    composerHolds:
      'A staged path is whatever `classifyHandedPath` returned, and it returns one only for ' +
      'something it has stat’d. The empty string is dropped before classification by both entry ' +
      'points (`classifyDroppedPaths`, `captionHandedPaths`).',
    verdict: 'composer-cannot',
  },
  {
    field: 'attachments[].path',
    rule: 'max(MAX_PATH_CHARS)',
    verbs: SEND_VERBS,
    probe: { text: 'here', attachments: [{ ...A_PATH, path: `/${'a'.repeat(4096)}` }] },
    composerHolds:
      'Both entry points drop a string past the ceiling before it can be staged — bounded there ' +
      'rather than in the `ipcMain.handle` callback precisely so a test can reach the rule (216 M55).',
    verdict: 'composer-cannot',
  },
  {
    field: 'attachments[].path',
    rule: 'refine(isAbsolute)',
    verbs: SEND_VERBS,
    probe: { text: 'here', attachments: [{ ...A_PATH, path: 'notes.md' }] },
    composerHolds:
      '⚑ **Two answers, deliberately.** `classifyHandedPath` refuses a relative path by name rather ' +
      'than resolving it against main’s own `process.cwd()`, and the schema refuses it again at the ' +
      'door — because the door is where a renderer’s claim stops being taken at face value.',
    verdict: 'composer-cannot',
  },
  {
    field: 'attachments[].path',
    rule: 'refine(!hasControlCharacter)',
    verbs: SEND_VERBS,
    probe: { text: 'here', attachments: [{ ...A_PATH, path: '/work/a\nb.md' }] },
    composerHolds:
      '⚑ **The same two answers as `isAbsolute` above, for the same reason** (232 §2). ' +
      '`classifyHandedPath` refuses a control-bearing name at the picker and the drop, where a ' +
      'person is standing and can be told a sentence; the door refuses it again, because a path ' +
      'no classifier of ours produced is a forged or replayed command. ⛔ It is the wire half of ' +
      '`227` HIGH 2: a legal filename could otherwise write BroBot’s own attachment records.',
    verdict: 'composer-cannot',
  },
  {
    field: 'attachments[].kind',
    rule: "enum(['file','directory'])",
    verbs: SEND_VERBS,
    probe: { text: 'here', attachments: [{ ...A_PATH, kind: 'socket' }] },
    composerHolds:
      'A caption main wrote a moment ago (216 §3) and the renderer only carries back — so the enum ' +
      'is the whole of what this field needs on the WIRE. ⚠️ **What it is not, since 232 §1, is ' +
      '“thrown away”**: `recheckHandedPaths` asks the filesystem again AND compares, so a `kind` ' +
      'that no longer matches refuses the send rather than being silently corrected.',
    verdict: 'composer-cannot',
  },
  {
    field: 'text (endPlanMode)',
    rule: 'refine(hasSomethingToSend)',
    verbs: ['endPlanMode'],
    probe: { text: '   ' },
    composerHolds:
      '⛔ **The fourth message-carrying verb, censused since 234 §3** (from `228` M3). It held ' +
      '`min(1)` — the rule `221` §1 removed from the other three — so a whitespace-only go-ahead ' +
      'was an accepted command: the host left plan mode durably and then recorded a turn made of ' +
      'spaces. ⚑ `plan-mode.ts` composes a fixed `GO_AHEAD_MESSAGE`, or the button sends no `text` ' +
      'at all for the LEAVE, so no gesture builds one — but that is why it went unnoticed, not why ' +
      'it was safe.',
    verdict: 'composer-cannot',
  },
  {
    field: 'attachments[].outsideCwd',
    rule: 'boolean()',
    verbs: SEND_VERBS,
    probe: { text: 'here', attachments: [{ ...A_PATH, outsideCwd: 'yes' }] },
    composerHolds:
      'The other half of the same caption, and the half that IS still thrown away — main decided ' +
      'it, the renderer only carried it back, and `recheckHandedPaths` decides it again before the ' +
      'turn goes out (232 §1: it is a fact about a folder, not about the thing chosen).',
    verdict: 'composer-cannot',
  },
  {
    field: 'text (sendToChild)',
    rule: 'refine(hasSomethingToSend)',
    verbs: ['sendToChild'],
    probe: { text: '   ' },
    composerHolds:
      '⛔ **The same function again, and this composer is the first one outside a session** (296). ' +
      '`ChildWorkViewer`’s Send button is disabled while `draft.trim()` is empty, so the wire ' +
      'refuses exactly the payload the button declines to offer — 221 §1’s rule, in the one place ' +
      'it had not yet been applied. ⚠️ **No attachment rules ride with it**, because a child runs ' +
      'in its own working directory and nothing in this app has classified that one: the whole ' +
      'handed-path apparatus is about the cwd THIS session opened.',
    verdict: 'composer-cannot',
  },
  {
    field: 'launchKey (startAndSend)',
    rule: 'min(1)',
    verbs: ['startAndSend'],
    probe: { text: 'hello', launchKey: '' },
    composerHolds:
      '🔴 **735 · the name a window gives its own wait**, shared with `resume` and `createSession`: ' +
      'the store mints it with `nextLaunchKey()` inside `forLaunch`, for every gesture a Cancel can ' +
      'reach, and nothing types it. ⚑ Since D-017b a message from a recorded conversation’s view is ' +
      'its caller (`store.startAndSend`), under the conversation’s own gesture, as `resume` is.',
    verdict: 'composer-cannot',
  },
  {
    field: 'launchKey (startAndSend)',
    rule: 'max(200)',
    verbs: ['startAndSend'],
    probe: { text: 'hello', launchKey: 'k'.repeat(201) },
    composerHolds:
      'Same: `nextLaunchKey()` writes a short counter-based key, far below the bound, and nothing ' +
      'in the renderer edits it.',
    verdict: 'composer-cannot',
  },
]
