import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { describeUnavailable } from '../src/main/runtime/session-unavailable'
import type {
  RuntimeCommand,
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
  TranscriptEvent,
} from '../src/shared/runtime-ipc'

/**
 * **A window that was refused the conversation must not be able to act on it** (203, from 195 H1).
 *
 * 062 decided that a second surface asking for a session already held is TOLD rather than silently
 * attached — *"joining would hand a second window a session whose events go to somebody else's
 * sink"* — and built the refusal into `resume` and `attachOpen`. The control verbs were never part
 * of it. `send`, `sendInterrupting`, the queue, the permission and user-input answers, `interrupt`,
 * `close`, `refreshConfig`, the approval mode and every live setting took a `sessionId` and nothing
 * else, so a window that had been refused could still drive the conversation it had been refused —
 * and the id is not a secret: `listLibrary` returns our own row ids by design, and `latestHistory`
 * hands over the pending request id together with the decisions it offers.
 *
 * ⚠️ **Driven through `executeRuntimeCommand`, not through the host's methods**, because the door is
 * what 195 found open. A test that called `host.send(id, text, foreigner)` would prove the predicate
 * works and prove nothing about whether the boundary passes the caller — which was the entire
 * defect: the sink was in scope at every one of these cases and used at four of them.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

class RecordingSink implements RuntimeEventSink {
  // 349 · this double stands in for a WINDOW — the tests below answer for a person through it.
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  readonly alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }
  events(): TranscriptEvent[] {
    return this.messages.map((message) => message.event)
  }
}

/**
 * **Every command kind, classified — and the classification is a `Record`, so it cannot go stale.**
 *
 * A command added to `RuntimeCommand` without a line here is a compile error rather than a silently
 * unguarded verb. That is the whole reason this is a type-keyed table and not a list of strings:
 * 195 H1 exists because a set of "the commands that need the caller" was implicit in which cases
 * happened to mention `sink`.
 *
 * ⚠️ **`reads` is a decision and not a leftover** (064). The session library shows conversations
 * this window does not own and lets you read them — that is the feature — so `earlierHistory`,
 * `latestHistory`, `exportSession`, the rebuild and the two child-work readers answer for
 * anybody. What 203 removes is the ability to ACT on what they
 * disclose.
 */
const CLASSIFIED: Record<
  RuntimeCommand['kind'],
  'controls' | 'reads' | 'no session' | 'claims' | 'person decision'
> = {
  send: 'controls',
  sendInterrupting: 'controls',
  queueMessage: 'controls',
  cancelQueuedMessage: 'controls',
  takeBackAndStop: 'controls',
  respondPermission: 'controls',
  respondUserInput: 'controls',
  // This settles an app-owned person question; it does not control the source turn.
  // Destination delivery still meets its normal window-ownership guard.
  resolveLink: 'no session',
  decideMoveRequest: 'person decision',
  // It settles a to-do this app asked a person, for its decideMoveRequest neighbour's reason.
  answerAction: 'person decision',
  interrupt: 'controls',
  // ⛔ `controls`, and it is not a borderline case (248). It reaches into a live session and stops
  // work that is running in it — the fact that the work is DETACHED makes it no less this window's
  // to own, and a second window stopping another's background command is exactly the gesture 203
  // took away.
  stopBackgroundWork: 'controls',
  // ⛔ **`reads`, and the contrast with the line above is the whole rule** (300). Stopping a
  // command reaches into a live session and changes it; reading what one has printed changes
  // nothing, and a second window watching a conversation it does not control is exactly what a
  // read is for. It cannot even leak: the answer is a buffer keyed by an id that window already has
  // on screen.
  readCommandOutput: 'reads',
  // ⛔ **`reads` on the same argument, and the id is the same id** (462). It changes nothing, and a
  // guessed value reaches a bounded hold keyed by ids the provider minted — no path, no process, no
  // directory. ⚑ A second window reading what a tool answered in a conversation it does not control
  // is the same thing a second window watching a command's output is.
  readToolAnswer: 'reads',
  // ⛔ **`no session`, and it is the word rather than `reads`** (510). ⚑ `reads` is for a command
  // that NAMES a conversation and is let past 203's ownership check anyway; this one names none —
  // its whole payload is a `resourceId`, a primary key in the app's own table — so there is no
  // owner for the check to compare against, which was the project verbs' answer for the same shape
  // until D-016 took them out. ⚠️ Nothing about it can leak between windows: the row is the app's,
  // the bytes are hash-checked, and a person is unrestricted over both (HO-005).
  readResource: 'no session',
  // ⚑ **D-032 · `no session`, `readResource`'s word and reason**: the whole payload is the same
  // `resourceId`, and the reveal raises a Finder window and changes nothing.
  drawResource: 'no session',
  revealResource: 'no session',
  // A message's paths answer for anybody, as `revealPath` does: they act on no conversation.
  resolveMessagePaths: 'reads',
  openMessagePath: 'reads',
  revealMessagePath: 'reads',
  // ⚑ **D-026 · `reads`**, `whoCalledWhom`'s word and reason: two of its three scopes name a
  // conversation, and it offers no act.
  filesKept: 'reads',
  filesLibrary: 'no session',
  teamProfileGraph: 'no session',
  searchWork: 'reads',
  close: 'controls',
  refreshConfig: 'controls',
  setApprovalMode: 'controls',
  setSessionSetting: 'controls',
  endPlanMode: 'controls',

  exportSession: 'reads',
  // ⛔ **`no session`, not `reads`** (214 §1). It names no session — there is no id to check a
  // window's ownership against, because the conversation it creates does not exist yet. Same
  // classification as `adoptSessions`, which is the other command that brings a conversation this
  // app never ran into the database.
  importBundleFile: 'no session',
  importRecordedSession: 'reads',
  rebuildLedger: 'reads',
  readWorkflowOutput: 'reads',
  // 356. ⚑ **`reads` on the same reasoning as its neighbours** — 064's rule that reading a
  // conversation is not controlling it. Both are keyed to a session and neither can change one: the
  // read opens a file the session's own provider named, and the reveal raises a Finder window.
  readInstructionSource: 'reads',
  revealPath: 'reads',
  // 733. ⚑ `reads`, with the two above: it opens one file of the session's own home and changes
  // nothing about the session.
  readConfigFile: 'reads',
  readChildWork: 'reads',
  // ⛔ **Both `controls`, and the READ is the one worth arguing about** (296). The paragraph above
  // rules the two child-work readers `reads` because the library discloses conversations this window
  // does not own — but those go to a FILE. `readChildState` asks the owning session's live
  // app-server, on a connection this window may not hold, and `sendToChild` writes to it. `203`'s
  // line is *"what it removes is the ability to ACT on what they disclose"*, and reaching into
  // somebody else's provider process is on the acting side of it.
  readChildState: 'controls',
  sendToChild: 'controls',
  earlierHistory: 'reads',
  latestHistory: 'reads',

  // Not addressed by session id at all: they either name a launch this host matched by owner
  // itself, or nothing.
  createSession: 'no session',
  resume: 'no session',
  // 🔴 **735 · `resume`'s word, for `resume`'s reason**: this boundary checks no owner for it — the
  // host does. ⚑ **D-017b** — a conversation another window holds is answered `held-elsewhere` and
  // nothing is sent; any other is attached, taken or reopened for this window, then sent to.
  startAndSend: 'no session',
  cancelLaunch: 'no session',
  attachOpen: 'no session',
  listResumable: 'no session',
  listUnresumable: 'no session',
  adoptSessions: 'no session',
  listLibrary: 'no session',
  importUserHomeSession: 'no session',
  checkCwd: 'no session',
  /**
   * ⛔ **`no session`, and 419 owes the sentence** — this verb names no conversation, so there is
   * nothing for THIS boundary to check.
   *
   * ⚠️ **It does not mean ungated**, and that trap is sharper here than it was on the project
   * verbs D-016 took out: this
   * one mints the thing every capability is a fact ABOUT. What gates it is `requireAPerson` in
   * `ipc.ts`, which is the capability door's gate rather than this one's — and what keeps an AGENT
   * off it is that the verb lives on the window wire and on no toolset. ⛔ `create_agent` is a
   * separate door with its own rails, and `the-rails-before-anything-can-reach-them.test.ts` is
   * where the inventory that keeps the two apart is pinned.
   */
  createAgent: 'no session',
  /**
   * ⛔ **`no session` — literally true, and 433 owes the sentence for `createAgent`'s reason.** This
   * verb names one IDENTITY and no conversation, so there is nothing for THIS boundary to check.
   *
   * ⚠️ **It does not mean ungated**, and the trap here has its own shape: a reader who knows that a
   * provider is fixed for the life of a conversation may take this row to mean the verb cannot
   * reach a session at all. ⛔ That is true, and it is true for a different reason than this word —
   * `a-front-door-that-asks-nothing.test.ts` §1 is the census that holds it, and what gates THIS
   * door is `requireAPerson` in `ipc.ts`, one gate over from ownership.
   */
  setAgentProvider: 'no session',
  /**
   * ⛔ **`no session` for both, and it is `setAgentProvider`'s sentence directly above** (558).
   * Each names one IDENTITY and no conversation, so there is nothing for THIS boundary to check.
   *
   * ⚠️ **It does not mean ungated, and on the removal that trap is at its worst.** A verb that
   * deletes a row a person can see, filed under a word meaning *nothing to check*, is exactly how
   * an assertion gets widened by a reader in a hurry. ⛔ What gates both doors is `requireAPerson`
   * in `ipc.ts`, one gate over from ownership, and
   * `the-rails-before-anything-can-reach-them.test.ts` is where that inventory lives.
   */
  setAgentDisplayName: 'no session',
  removeAgent: 'no session',
  /**
   * ⛔ **Named by a conversation, but no window's to own.** A person archives, restores or deletes
   * any conversation from All conversations, whichever window drives it, and these change what
   * that person's lists show and what is kept, not a turn. ⚠️ **They are not ungated**:
   * `requireAPerson` stands in front of all four in `ipc.ts`. ⚑ The check is a read of the same.
   */
  archiveConversation: 'no session',
  restoreConversation: 'no session',
  checkDeleteConversation: 'reads',
  deleteConversation: 'no session',
  /**
   * ⛔ **D-016 · R4 · `no session` — literally true: it names a PIECE, by its label or its id, and
   * no conversation.** The host finds the piece's owner and writes the title into that ledger
   * whatever state the conversation is in and whichever window holds it — a title drives no turn,
   * so there is no ownership for THIS boundary to check. ⚠️ **It does not mean ungated**:
   * `requireAPerson` stands in front of it in `ipc.ts`, `setAgentDisplayName`'s gate.
   */
  retitleWork: 'no session',
  // ⚑ A person takes back the piece a service is on: it names a piece, and `requireAPerson` gates it.
  takeBackWork: 'no session',
  /**
   * ⛔ **`no session` for both, and it is `setAgentProvider`'s sentence** (677). Each names one
   * IDENTITY and no conversation. ⚠️ **It does not mean ungated**: `requireAPerson` stands in front
   * of both in `ipc.ts`. ⚑ **D-042 · R2 moved the write's reason**: it sets the agent's DEFAULT —
   * what its new conversations start on, no longer a rail a give cannot cross — and an agent
   * reaching it could change any agent's.
   */
  setAgentModelAndEffort: 'no session',
  agentModelAndEffort: 'no session',
  /**
   * ⛔ **D-042 · R3 · `no session` for all three, the two rows above's sentence.** Each names a
   * PROVIDER — its list, or a model a person added to it — and no conversation, so there is no
   * ownership for THIS boundary to check. ⚠️ **It does not mean ungated**: `requireAPerson` stands
   * in front of every one in `ipc.ts`.
   */
  modelList: 'no session',
  addHandAddedModel: 'no session',
  deleteHandAddedModel: 'no session',
  apiKeyStatus: 'no session',
  setApiKey: 'no session',
  removeApiKey: 'no session',
  checkApiKey: 'no session',
  // ⚑ The Providers screen's four reads: about the providers, never a conversation.
  providerVersions: 'no session',
  providerSetup: 'no session',
  providerUsage: 'no session',
  providerResources: 'no session',
  // ⚑ The kept rules: files of the person's, about no conversation.
  keptRules: 'no session',
  removeKeptRule: 'no session',
  /**
   * ⛔ **`no session` — literally true, and 582 owes the sentence saying why** (the rule the row
   * above it states).
   *
   * ⚑ **All three name an IDENTITY or an ASK and no conversation**, so there is no ownership for
   * THIS boundary to check. ⚠️ **It does not mean ungated**: `requireAPerson` stands in front of
   * every one of them in `ipc.ts`, and on `decideInstruction` that gate is `HO-009` §2.2's own —
   * approval is the only thing that writes a version, so a caller that is not a person reaching it
   * would be criterion 21's *his approval is the ONLY gate* with the gate removed.
   * ⛔ `the-rails-before-anything-can-reach-them.test.ts` is where that inventory lives.
   */
  instructAgent: 'no session',
  agentInstructions: 'no session',
  agentMethods: 'no session',
  agentMethodBody: 'no session',
  agentMethodChanges: 'no session',
  removeAgentMethod: 'no session',
  undoAgentMethod: 'no session',
  checkInterruptedAgentMethods: 'no session',
  agentOwnNotes: 'no session',
  agentOwnNotesUnread: 'no session',
  saveOwnNotes: 'no session',
  undoOwnNotes: 'no session',
  markOwnNotesSeen: 'no session',
  agentRulesUnread: 'no session',
  undoAgentRules: 'no session',
  markAgentRulesSeen: 'no session',
  decideInstruction: 'no session',
  // Decided on the request, by its id, which is in no conversation the window names.
  decideMcpServerRequest: 'no session',
  /**
   * ⛔ **`no session` — literally true, and 625 owes the sentence saying why** (the rule two rows
   * up).
   *
   * ⚑ **Both name an IDENTITY and no conversation**, which is the whole of what `no session`
   * claims here: `EXT-015` §1's Team-page door opens with nothing running, so there is no
   * ownership for THIS boundary to check. ⚠️ **It does not mean ungated** — `requireAPerson`
   * stands in front of both in `ipc.ts`, and on the WRITE that gate is the only authority the
   * record has: `identity_memory_amendment` carries no provenance vocabulary because exactly one
   * kind of caller can reach it. ⛔ `the-rails-before-anything-can-reach-them.test.ts` is where
   * that inventory lives.
   */
  agentMemory: 'no session',
  // F093. ⚑ **`reads`, with `readInstructionSource`'s reasoning** — keyed to a session, and it
  // changes nothing about it; ⛔ the person gate is `requireAPerson` at the door.
  whatThisAgentWasGiven: 'reads',
  // F093 · C9 d · ⚑ **`reads`, for the same reason** — keyed to a session, and it changes nothing.
  whatTheModelGot: 'reads',
  amendAgentMemory: 'no session',
  undoAgentMemory: 'no session',
  checkInterruptedMemory: 'no session',
  /**
   * ⛔ **`no session` — literally true, and 355 owes the sentence saying why it is not a fifth word.**
   *
   * The three capability verbs name no conversation, so there is no ownership for THIS boundary to
   * check, which is the whole of what `no session` claims. ⚠️ **It does not mean ungated**, and that
   * is the trap: `claim` got its own word (336) precisely because filing a gated verb under a
   * word that means *"nothing to check"* is how an assertion gets widened by a reader in a hurry.
   *
   * ⚑ **The difference is which question the gate asks.** `claim` is refused by asking *whose is
   * this* — the question this file is about — so it belongs here under a word of its own. A
   * capability verb is refused by asking *is a PERSON asking at all* (349's
   * `RuntimeEventSink.aPersonIsBehindIt`), which is a fact about the CHANNEL rather than about
   * ownership, and which this boundary knows nothing about. Its census lives with the rails, in
   * `the-rails-before-anything-can-reach-them.test.ts`, where the reason for it is.
   */
  skills: 'no session',
  agentIdentities: 'no session',
  setCapabilities: 'no session',
  // ⚑ **516 · the registry's two writes name no conversation either.** ⛔ A registered server is
  // app-wide, like the switch below it: there is no session for this boundary to check ownership
  // of, and what gates them is the other question — `requireAPerson`, whose census is with the
  // rails. ⚠️ **Not `reads`**: both of them WRITE, and the removal takes a capability away from
  // every identity that held it.
  registerExternalMcpServer: 'no session',
  removeExternalMcpServer: 'no session',
  setSpawningEnabled: 'no session',
  setServicesOn: 'no session',
  // ⚑ **500's launch default names no conversation either** — it is read at the NEXT one, which is
  // not a session this boundary could check ownership of. ⛔ Gated, and gated by the other
  // question: `requireAPerson`, whose census is with the rails.
  setDefaultApprovalMode: 'no session',
  capabilities: 'no session',
  profiles: 'no session',
  checkProviderAuth: 'no session',
  reprovisionProviderAuth: 'no session',
  signInProvider: 'no session',
  cancelProviderSignIn: 'no session',

  /**
   * 🔴 **Its own word, because none of the three above is true of it** (336).
   *
   * ⛔ It is not `no session` — it names one, and what it does to it is the strongest thing this
   * boundary allows. It is not `reads` — a read *"changes nothing"*, and this changes who the
   * conversation belongs to. And it is not `controls`, which is the interesting one: every verb in
   * that group is refused with `not-yours`, whereas a claim asks
   * {@link mayClaim} — *"is this nobody's?"* — and is refused with a sentence naming the owner it
   * found. ⚠️ **Filing it under `controls` would have put it in `CONTROL_COMMANDS`, where the
   * assertion is that a stranger is told `not-yours`; it would have gone red, and the fix a reader
   * in a hurry reaches for is to widen that assertion.** So it gets a word and two tests of its own.
   */
  claim: 'claims',
  // ⚑ **D-017b · `claims`, for the strongest thing it can do.** A look at one another window holds
  // is a read (the recorded hand-over, with nothing refused), but a PRESS on one running with no
  // owner takes it by {@link mayClaim} — so filing it under `reads` would hide a gated verb under a
  // word that means *"changes nothing"*, the trap `claim`'s own word exists to avoid.
  look: 'claims',
  // ⚑ `reads`: it changes nothing but whether this window is shown a conversation's rows.
  stopLooking: 'reads',
  /**
   * 🔴 **`controls`, and it is the one word the sibling above could not take** (523).
   *
   * ⛔ **Not `claims`, even though it is that gesture reversed.** `claim` earned its own word because
   * it is refused by {@link mayClaim} — *"is this nobody's?"* — with a sentence naming the owner it
   * found, so filing it under `controls` would have put it where the assertion is *a stranger is told
   * `not-yours`*, and it would have gone red. ⚑ A release is refused by `assertMayControl` itself,
   * which is that assertion's own mechanism: a window holding an id it was not given is told
   * `not-yours` here for the same reason it is told it for `close`.
   *
   * ⚠️ **And the owner half holds for the right reason rather than by luck.** This file's session is
   * one the owner STARTED, so the owner's release is refused too — with `started-here`, which is not
   * `not-yours`, which is exactly what that half asserts. ⛔ The pair below therefore measures the
   * ownership boundary and says nothing about the birth fact; that rail is measured where the two
   * readings diverge, in `a-look-he-can-take-back.test.ts`.
   */
  release: 'controls',
  // ⛔ **398 · `no session`, and the word is exact rather than convenient.** It names no conversation
  // and takes no sink, so there is no owner for it to be checked against — the population it reports
  // is *every* escalated question, across families, because a person is not inside one. ⚠️ It is not
  // `reads`: that class is about conversations this window does not own and MAY read, which is a
  // per-session judgement; this asks a question about the app.
  questionsForAPerson: 'no session',
  // ⛔ **403 · `no session`, its neighbour's word for its neighbour's reason.** It names no
  // conversation and takes no sink, and the population it reports is every request only a person
  // may settle, across families. ⚠️ **Not `reads`**: that class is a per-session judgement about a
  // conversation this window does not own; this asks a question about the app.
  decisionsForAPerson: 'no session',
  // ⛔ **533 · `no session`, its three siblings' word for their reason and a sharper one.** It
  // names no conversation, and the thing it reports is not about a conversation at all: what a
  // provider said about this app's own account. ⚠️ **Not `reads`** — that class is a per-session
  // judgement about a conversation this window does not own, and there is no session here to own.
  limitsForAPerson: 'no session',
  readLimitsDisplay: 'no session',
  // ⛔ **D-017 · R19 · `no session`, its siblings' word for their reason.** It names no
  // conversation: the walk is every agent's ask against an identity's instructions, because a
  // person is not inside one family. ⚠️ **Not `reads`** — there is no session here to own.
  instructionAsksForAPerson: 'no session',
  mcpServerRequestsForAPerson: 'no session',
  // ⛔ **557 · `no session`, its four siblings' word for their reason.** It names no conversation:
  // the walk is every conversation this app has ever given work to, because a person is not inside
  // one family. ⚠️ **Not `reads`** — that class is a per-session judgement about a conversation
  // this window does not own, and there is no session here to own.
  stalledWorkForAPerson: 'no session',
  // ⛔ `no session`, its neighbour's word for its reason: it names no conversation, and walks every
  // one this app has given work to.
  stoppedWorkForAPerson: 'no session',
  // ⛔ `no session`, for its neighbours' reason: it names no conversation.
  workIncidentsForAPerson: 'no session',
  // ⛔ **F097 · `no session`, its siblings' word for their reason.** It names no conversation: the
  // walk is every conversation this app has ever given work to, because a person is not inside one
  // family. ⚠️ **Not `reads`** — there is no session here to own.
  waitingOnWhoWroteForAPerson: 'no session',
  // ⛔ **438 · `no session`, and the word means *there is no ownership for THIS boundary to
  // check* — never *ungated*.** A digest names a window (and a PROJECT until D-016); it names no
  // conversation, so there is no owner for a window-authority rule to compare against. ⚠️ The door
  // it does pass is the quit door, where it is `refused`.
  digest: 'no session',
  recentActivity: 'no session',
  // ⛔ **508 · `reads`, and it is the first task verb on this wire, so the word is argued rather
  // than inherited.** It NAMES a conversation, unlike the `no session` rows above it, so
  // `203`'s owner check has something to be about and the classification is a real choice.
  // ⚑ **`reads` for the session library's stated reason** — *"The session library shows
  // conversations this window does not own and lets you read them — that is the feature"* — and
  // the population is the same one: every window in this app is the same person's. ⚠️ **What it
  // discloses is this app's own derivation of work a conversation handed out**, and every ACT on
  // that work stays where it was: `withdraw_task` is an agent's door through `takeBackPiece`, and
  // this verb offers no act at all.
  workGivenBy: 'reads',
  // ⛔ **543 · `reads`, and it is `workGivenBy`'s argument rather than a `no session` row's.**
  // It NAMES a conversation, so `203`'s owner check has something to be about and the word is a real
  // choice — and it is the session library's stated reason again: *"the library shows conversations
  // this window does not own and lets you read them — that is the feature"*, over a population that
  // is the same person's either way. ⚠️ **What it discloses is this app's own record of which
  // conversation started which and which handed work to which**, and it offers no act at all: there
  // is no open, no take-over and no switch-window verb on this door, so there is nothing here for
  // `203` to remove. ⛔ **`no session` would have been literally FALSE** — this verb has an id.
  whoCalledWhom: 'reads',
  // ⛔ **567 · `no session`, and NOT its neighbour's `reads`.** `whoCalledWhom` NAMES a
  // conversation, so `203`'s owner check has something to be about; this names none — the answer is
  // two counts over the whole workspace, which is a question about the app. ⚑ Its five
  // `…ForAPerson` siblings carry the same word for the same reason. ⚠️ The door it does pass is the
  // quit door, where it is `refused`.
  readWorkspace: 'no session',
  // ⛔ **575 · `no session`, its neighbour's word and its neighbour's reason.** It names no
  // conversation, so `203`'s owner check has nothing to be about — the answer is about every
  // conversation this app is running, which is a question about the app. ⚠️ The door it does pass
  // is the quit door, where it is `refused`.
  whatIsBeingDone: 'no session',
  // ⛔ **621 · `no session`, its neighbour's word and its neighbour's reason.** It names no
  // conversation, so `203`'s owner check has nothing to be about — the answer is about every
  // conversation this app is running. ⚠️ The door it does pass is the quit door, where it is
  // `refused`, and there for a reason of its own: it opens four ledgers per conversation.
  whatEachConversationIsWaitingOn: 'no session',
  // ⛔ **637 · `no session`, its two neighbours' word and their reason** — it names no conversation,
  // so `203`'s owner check has nothing to be about, and it offers no act.
  theWholeForest: 'no session',
  // ⛔ **D-018 · `no session`, its neighbours' word and their reason** — it names no conversation,
  // and it offers no act: the memory of every process this app is running, for the cards.
  processMemory: 'no session',
}

/**
 * One valid command per control verb, so the table below asks the boundary the real question.
 *
 * ⚠️ **340 split the entitlement under this table and every row below is still true — for a
 * reason worth writing down rather than for luck.** Five of these verbs now ask `mayCommand` and
 * two ask `mayAnswerAsAHuman`, but the caller this file drives them with is a stranger WINDOW: it
 * owns nothing and was named as nobody's commander, so it fails the widest of the three questions
 * and `assertMayCommand` hands it back to `assertMayControl`'s one refusal. ⛔ The claim this table
 * makes is therefore unchanged and slightly stronger: *a window holding an id it was not given can
 * drive nothing*. What a caller that WAS given one may do is `340`'s own file, and the two answer
 * verbs are the pair where even being given one is not enough.
 */
const CONTROL_COMMANDS: { kind: string; build: (sessionId: string) => RuntimeCommand }[] = [
  { kind: 'send', build: (sessionId) => ({ kind: 'send', sessionId, text: 'do it' }) },
  // 523. ⚑ **A hand-back is a control for this boundary's purposes**, and the pairing below reads
  // it correctly in both halves: a stranger is told `not-yours`, and the owner is refused for a
  // different reason entirely — this session was started by a window, so there is nobody to hand it
  // back to. ⛔ That second refusal is `started-here`, and the owner half asserts only that the
  // refusal was not about ownership.
  { kind: 'release', build: (sessionId) => ({ kind: 'release', sessionId }) },
  // 296. ⛔ **The READ is in this table too**, and it is the entry worth pausing on: the two
  // child-work READERS above are classified `reads` because a file on disk answers for anybody,
  // while this one reaches the owning session's live app-server. ⚑ It is also the pair that made
  // this file earn its keep — both verbs asked the LEDGER before they asked about ownership, so a
  // stranger got `unknown-agent` instead of a refusal, and that answer disclosed whether the agent
  // was this conversation's.
  {
    kind: 'readChildState',
    build: (sessionId) => ({ kind: 'readChildState', sessionId, agentId: 'agent_1' }),
  },
  {
    kind: 'sendToChild',
    build: (sessionId) => ({ kind: 'sendToChild', sessionId, agentId: 'agent_1', text: 'hello?' }),
  },
  {
    kind: 'sendInterrupting',
    build: (sessionId) => ({ kind: 'sendInterrupting', sessionId, text: 'no, do this' }),
  },
  {
    kind: 'queueMessage',
    build: (sessionId) => ({ kind: 'queueMessage', sessionId, text: 'next' }),
  },
  {
    kind: 'cancelQueuedMessage',
    build: (sessionId) => ({ kind: 'cancelQueuedMessage', sessionId, messageId: 'msg_1' }),
  },
  {
    kind: 'takeBackAndStop',
    build: (sessionId) => ({ kind: 'takeBackAndStop', sessionId, messageId: 'msg_1' }),
  },
  {
    kind: 'respondPermission',
    build: (sessionId) => ({
      kind: 'respondPermission',
      sessionId,
      requestId: 'turn_1_perm',
      decision: { outcome: 'allow' },
    }),
  },
  {
    kind: 'respondUserInput',
    build: (sessionId) => ({
      kind: 'respondUserInput',
      sessionId,
      requestId: 'tu_q',
      response: { kind: 'reject' },
    }),
  },
  { kind: 'interrupt', build: (sessionId) => ({ kind: 'interrupt', sessionId }) },
  {
    kind: 'stopBackgroundWork',
    build: (sessionId) => ({ kind: 'stopBackgroundWork', sessionId, id: 'b6uoyo82k' }),
  },
  { kind: 'close', build: (sessionId) => ({ kind: 'close', sessionId }) },
  { kind: 'refreshConfig', build: (sessionId) => ({ kind: 'refreshConfig', sessionId }) },
  {
    kind: 'setApprovalMode',
    build: (sessionId) => ({ kind: 'setApprovalMode', sessionId, mode: 'auto' }),
  },
  {
    kind: 'setSessionSetting',
    build: (sessionId) => ({
      kind: 'setSessionSetting',
      sessionId,
      body: { kind: 'model', value: 'something-else' },
    }),
  },
  {
    kind: 'endPlanMode',
    build: (sessionId) => ({ kind: 'endPlanMode', sessionId, text: 'go ahead' }),
  },
]

describe('203 · a window refused the conversation cannot drive it (195 H1)', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  /** The surface that opened the conversation. */
  let owner: RecordingSink
  /** A second window with the id and no claim to it — 062's loser. */
  let stranger: RecordingSink
  let sessionId: string

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-authority-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
    let counter = 0
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(dir, 'provider-homes', profileId, provider),
      providerHomePath: (provider, profileId) => join(dir, 'provider-homes', profileId, provider),
      resolveCwd: (id, requested) => requested ?? join(dir, 'scratch', id),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
    })
    owner = new RecordingSink('webContents:1')
    stranger = new RecordingSink('webContents:2')
    const created = await host.createSession({ provider: 'codex', cwd: dir }, owner)
    sessionId = created.sessionId
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const ask = (who: RecordingSink, command: RuntimeCommand): Promise<unknown> =>
    executeRuntimeCommand(host, who, command)

  it('covers every command the classification calls a control — in both directions', () => {
    // ⚠️ Both directions, like `window-navigation.test.ts` asserts of its guarded events: a verb
    // classified as a control with no row below would be silently untested, and a row below for a
    // verb nobody classified would be testing something this file has not thought about.
    const classified = Object.entries(CLASSIFIED)
      .filter(([, how]) => how === 'controls')
      .map(([kind]) => kind)
      .sort()
    expect(CONTROL_COMMANDS.map((entry) => entry.kind).sort()).toEqual(classified)
    // The verbs a window may use only on a conversation it owns, counted so a new one is classified.
    expect(classified.length).toBe(17)
  })

  const NOT_YOURS = describeUnavailable('not-yours')

  it.each(CONTROL_COMMANDS)(
    'refuses $kind from a window that does not own it',
    async ({ build }) => {
      const refusal = await ask(stranger, build(sessionId)).then(
        () => null,
        (error: unknown) => error,
      )
      expect(refusal, 'the gesture was allowed').not.toBeNull()
      // The SENTENCE, because that is what crosses IPC: `refusalTranslated` logs the diagnostic —
      // which names both owners — and hands the renderer a line with no id in it (100's split).
      expect((refusal as Error).message).toBe(NOT_YOURS)
    },
  )

  it.each(CONTROL_COMMANDS)('…and lets the OWNER do $kind', async ({ build }) => {
    // The pairing for the table above. Some of these legitimately fail for reasons of their own —
    // `endPlanMode` on a session that is not planning, `respondPermission` for a card that is not
    // open — so what is asserted is that ownership is not what stopped them. The four verbs whose
    // EFFECT is asserted have tests of their own below; without those, this half would be satisfied
    // by a host that refused everything for a second reason.
    const refusal = await ask(owner, build(sessionId)).then(
      () => null,
      (error: unknown) => error,
    )
    expect(refusal === null ? '' : (refusal as Error).message).not.toBe(NOT_YOURS)
  })

  it('a refused send reaches neither the provider nor the owner', async () => {
    await expect(ask(stranger, { kind: 'send', sessionId, text: 'do it' })).rejects.toThrow(
      NOT_YOURS,
    )
    // The conversation is untouched: nothing was written to its ledger, and the window that owns it
    // was told nothing. A refusal that had already published the turn would be the same defect with
    // an error message on top.
    expect(store.events(sessionId).some((entry) => entry.event.type === 'user_turn')).toBe(false)
    expect(owner.events().some((event) => event.type === 'user_turn')).toBe(false)
    expect(stranger.messages).toHaveLength(0)

    // …and the owner's own send does all three.
    await ask(owner, { kind: 'send', sessionId, text: 'do it' })
    expect(owner.events().some((event) => event.type === 'user_turn')).toBe(true)
  })

  it('a refused close leaves the session open, rather than reporting a close it did not do', async () => {
    // ⚠️ `close` is TOLERANT by design — an unknown id is a silent no-op so the Close button stays
    // usable after a session dies on its own — so the danger here is the opposite of a leak: a
    // foreign close that resolved would tell a window the conversation was over while it ran on.
    await expect(ask(stranger, { kind: 'close', sessionId })).rejects.toThrow(NOT_YOURS)
    expect(host.sessionIds).toEqual([sessionId])

    await ask(owner, { kind: 'close', sessionId })
    expect(host.sessionIds).toEqual([])
  })

  it('an unknown id is still a silent no-op, and is not answered with somebody else’s refusal', async () => {
    // The tolerance `close` documents, kept: this is the pairing that stops the owner check being
    // written as "refuse anything not ours", which would break the Close button 062 protected.
    await expect(
      ask(stranger, { kind: 'close', sessionId: 'sess_nobody' }),
    ).resolves.toBeUndefined()
  })

  it('a refused permission answer never reaches the card', async () => {
    await ask(owner, { kind: 'send', sessionId, text: 'run something' })
    await waitFor(
      () => owner.events().some((event) => event.type === 'permission_request'),
      'the card the Fake raises mid-turn',
    )
    const card = owner.events().find((event) => event.type === 'permission_request')
    const requestId = (card as { id: string }).id

    await expect(
      ask(stranger, {
        kind: 'respondPermission',
        sessionId,
        requestId,
        decision: { outcome: 'allow' },
      }),
    ).rejects.toThrow(NOT_YOURS)
    // Still open — which is the whole point: 195's route to this is `latestHistory`, which hands a
    // non-owner the request id AND the decisions it offers. Reading them stays allowed; answering
    // does not.
    expect(owner.events().some((event) => event.type === 'tool_result')).toBe(false)

    await ask(owner, {
      kind: 'respondPermission',
      sessionId,
      requestId,
      decision: { outcome: 'allow' },
    })
    await waitFor(
      () => owner.events().some((event) => event.type === 'tool_result'),
      'the tool the owner allowed',
    )
  })

  it('a refused approval change does not move the session, and the owner’s does', async () => {
    await expect(
      ask(stranger, { kind: 'setApprovalMode', sessionId, mode: 'auto' }),
    ).rejects.toThrow(NOT_YOURS)
    expect(
      db.prepare('SELECT approval_mode AS mode FROM provider_session WHERE id = ?').get(sessionId),
    ).toMatchObject({ mode: 'ask' })

    await ask(owner, { kind: 'setApprovalMode', sessionId, mode: 'auto' })
    expect(
      db.prepare('SELECT approval_mode AS mode FROM provider_session WHERE id = ?').get(sessionId),
    ).toMatchObject({ mode: 'auto' })
  })

  it('⛔ a refused gesture writes no breadcrumb into somebody else’s ledger (203 §1)', async () => {
    // `ipc.ts` notes `interrupted`, `closed`, `left_plan_mode` and `started_the_plan` BEFORE the
    // host call they describe, and argues that a refusal afterwards is bounded because it "refuses
    // only for a session `noteUserCommand` also skips". The owner check breaks that clause — this
    // session is one `noteUserCommand` would happily write to — so the skip had to be taught the
    // same rule. Without it a stranger forges durable, ordinal-stamped `user_command` rows into a
    // conversation it may not touch, and the owning window is sent every one of them.
    await expect(ask(stranger, { kind: 'interrupt', sessionId })).rejects.toThrow(NOT_YOURS)
    await expect(ask(stranger, { kind: 'close', sessionId })).rejects.toThrow(NOT_YOURS)
    await expect(
      ask(stranger, { kind: 'endPlanMode', sessionId, text: 'go ahead' }),
    ).rejects.toThrow(NOT_YOURS)

    expect(store.events(sessionId).filter((e) => e.event.type === 'user_command')).toEqual([])
    expect(owner.events().filter((event) => event.type === 'user_command')).toEqual([])

    // …and the owner's own Close leaves the breadcrumb it always did.
    await ask(owner, { kind: 'close', sessionId })
    expect(
      store.events(sessionId).some((e) => e.event.type === 'user_command'),
      'the owner’s own breadcrumb went missing with the stranger’s',
    ).toBe(true)
  })

  it('⛔ a session that is still STARTING answers the stranger the same way — no timing oracle', async () => {
    // ⚠️ **The ORDER inside `require`, which is a claim its docblock makes and nothing asserted.**
    // 062's reserved-but-not-registered window is a real state with its own sentence — *"session is
    // still starting"* — and a foreign caller who could tell that state from a live one would be
    // reading somebody else's conversation through the refusal it gets back. Ownership is asked
    // first, so both phases answer identically.
    const stalling = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => ({
        provider,
        // ⚑ **D-042 · R1 — a Codex launch naming nothing reads `model/list` and names its
        // `isDefault` row**, at that row's own default effort; an empty list names no model, and the
        // launch was refused `nothing-names-a-model` before the slot it stalls in could hold. ⚠️ So
        // the list marks a default, as Codex's does, and the launch reaches the `start` below.
        listModels: () =>
          Promise.resolve([
            {
              id: 'fake',
              label: 'fake',
              isDefault: true as const,
              efforts: [{ id: 'medium', label: 'medium' }],
              defaultEffort: 'medium',
            },
          ]),
        // A launch that never answers: the slot is reserved and no session is ever registered.
        start: () => new Promise(() => {}),
        resume: () => Promise.reject(new Error('not used here')),
      }),
      prepareProviderHome: (provider, profileId) =>
        join(dir, 'provider-homes', profileId, provider),
      providerHomePath: (provider, profileId) => join(dir, 'provider-homes', profileId, provider),
      resolveCwd: (id, requested) => requested ?? join(dir, 'scratch', id),
      newSessionId: () => 'sess_starting',
      readProviderConfig: (_provider, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'fake',
        authNote: null,
        files: [],
      }),
      launchTimeoutMs: 60_000,
      // The launch never answers, so the quit below must not wait the default bound for it.
      closeDrainTimeoutMs: 50,
    })
    // Reserved synchronously, inside `createSession`, before its first `await`.
    const launching = stalling.createSession({ provider: 'codex', cwd: dir }, owner)
    launching.catch(() => {})

    await expect(
      executeRuntimeCommand(stalling, stranger, {
        kind: 'send',
        sessionId: 'sess_starting',
        text: 'x',
      }),
    ).rejects.toThrow(NOT_YOURS)
    // ⚑ The pairing that makes the sentence mean something: the OWNER is not refused, so the two
    // states really are distinguishable — to the owner, and only to the owner. ⚑ **D-017 · R1 — it
    // is no longer told *"still starting"***: that is never a refusal now, and the owner's words wait
    // for the start. ⚠️ Raced against a short timer, because this launch never answers.
    const ownersSend = executeRuntimeCommand(stalling, owner, {
      kind: 'send',
      sessionId: 'sess_starting',
      text: 'x',
    }).then(
      () => 'delivered',
      (error: unknown) => (error as Error).message,
    )
    const stillPending = new Promise<string>((resolve) => {
      setTimeout(() => resolve('still pending'), 100)
    })
    expect(await Promise.race([ownersSend, stillPending])).toBe('still pending')

    await stalling.closeAll()
  })

  it('062 still holds: the stranger is told, not attached', async () => {
    // The half 062 built and 203 leaves exactly as it was — asserted here because the fix reroutes
    // both of these through the same predicate the control verbs now use, so a change to it that
    // opened the control door would open this one too.
    expect(host.attachOpenSessions(stranger)).toEqual([])
    await expect(host.resumeSession(sessionId, stranger)).rejects.toThrow(
      describeUnavailable('already-open-elsewhere'),
    )
    expect(host.attachOpenSessions(owner)).toHaveLength(1)
  })

  it('the sentence a person reads names no id, no owner and no window', async () => {
    // 100's split: the diagnostic keeps the ids because that is what a log is for, and the sentence
    // is keyed by the reason alone so it cannot carry one. `send`'s rejection reaches the composer
    // as `props.error` and is rendered verbatim, so this is the line a user actually sees.
    const refusal = await ask(stranger, { kind: 'send', sessionId, text: 'x' }).catch(
      (error: unknown) => error,
    )
    const message = (refusal as Error).message
    expect(message).toBe(NOT_YOURS)
    expect(message).not.toContain(sessionId)
    expect(message).not.toContain('webContents')
    expect(message).toMatch(/another window/)
  })

  /**
   * 🔴 **336 · a verb whose rule is not `mayControl`, driven through the same door.**
   *
   * ⛔ **Both halves, because either alone is satisfiable by a mistake.** A claim that refused
   * everything would pass the first; a claim that granted everything would pass the second. What
   * makes the pair a statement is that the SAME window, asking the SAME way, is refused one session
   * and given another, and the only difference between them is whether anybody owned it.
   */
  it('336 · a stranger cannot claim a conversation this window owns', async () => {
    const refusal = await ask(stranger, { kind: 'claim', sessionId }).catch(
      (error: unknown) => error,
    )
    const message = (refusal as Error).message
    // ⚠️ **`already-open-elsewhere`, and NOT `not-yours`** — the two are different refusals of
    // different questions. `not-yours` is *"you asked to act on somebody's conversation"*; this is
    // *"you asked for one that is not going spare"*, and its sentence sends the person to the window
    // that has it, which is the only thing they can do about it.
    expect(message).toBe(describeUnavailable('already-open-elsewhere'))
    expect(message).not.toContain(sessionId)
    expect(message).not.toContain('webContents')
    // …and the conversation did not move: the owner still has it, the stranger still has nothing.
    expect(host.attachOpenSessions(owner)).toHaveLength(1)
    expect(host.attachOpenSessions(stranger)).toEqual([])
  })

  it('336 · …and the same window CAN claim one nobody owns', async () => {
    const spawned = await host.createSession({ provider: 'codex', cwd: dir }, null)
    const handed = await ask(stranger, { kind: 'claim', sessionId: spawned.sessionId })

    expect((handed as { sessionId: string }).sessionId).toBe(spawned.sessionId)
    // ⛔ **And the claim is what let it act**, which is the whole point of the door: the verb that
    // was refused above is taken now, on the conversation this window has just become the owner of.
    await expect(
      ask(stranger, { kind: 'refreshConfig', sessionId: spawned.sessionId }),
    ).resolves.toBeDefined()
    // ⚠️ The other window is unaffected — it did not gain a session and did not lose one.
    expect(host.attachOpenSessions(owner).map((entry) => entry.sessionId)).toEqual([sessionId])
  })

  it('a caller whose ownerId matches is the owner, whatever object it is', async () => {
    // The rule is the OWNER ID, not object identity — and it has to be. A window that reloads gets
    // a fresh sink over the same `WebContents`, and `attachOpen` exists precisely so that surface
    // can pick its conversations back up; identity comparison would have made every reattached
    // window a stranger to its own session.
    const sameWindowAgain = new RecordingSink(owner.ownerId)
    await expect(ask(sameWindowAgain, { kind: 'refreshConfig', sessionId })).resolves.toBeDefined()
  })
})

async function waitFor(predicate: () => boolean, what: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error(`timed out waiting for ${what}`)
}
