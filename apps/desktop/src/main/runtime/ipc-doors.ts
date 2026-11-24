import type { RuntimeCommandKind } from '../../shared/runtime-ipc'
import type { RuntimeEventSink } from './runtime-host'

/**
 * Who may ask and when: the shutdown door ({@link DURING_A_QUIT}) and the person door
 * ({@link requireAPerson}) that `executeRuntimeCommand` applies before it dispatches. Split out
 * of `ipc.ts` (card 73); every declaration is unchanged.
 */

/**
 * What the shutdown door does with one command. See {@link DURING_A_QUIT}.
 *
 * ⚠️ Named for what the DOOR does, not for what the command is — `answered` never means "safe", it
 * means "this door is not the thing that stops it", and each entry below says which of the two
 * reasons applies to it.
 */
type QuitRuling = 'refused' | 'answered'

/**
 * 🔴 **What every renderer command does once a quit has begun** (273 §2, from `272` finding 1).
 *
 * ## ⛔ The defect this table is the answer to
 *
 * `272` used `271`'s new shutdown report to catch what `271` had left as a stated residual, twice,
 * on clean quits: *"After `close its database`, the old process logged one failed `runtime:command`
 * query for resumable sessions and one for unresumable sessions. Both failed with `The database
 * connection is not open`."* Reproduced here on the shipped entry point by `app-closes-check.mjs`,
 * which now asks for both lists across the quit and fails on that sentence.
 *
 * The two arrive together and not by chance: `closeAll()` ends every conversation, each emits its
 * terminal event, `RuntimeScreen` watches the open list's length, and both surfaces re-read their
 * closed list. So the quit itself is what asks the question the quit then cannot answer.
 *
 * ## ⚠️ Why a table and not a flag in two handlers
 *
 * 273 §2 asks the wider question once: *"the two it found are a floor, not the set"*. A `Record` over
 * {@link RuntimeCommandKind} is the only form of that answer that cannot go stale — a command added
 * to the union does not compile until somebody rules on it here, which is the same reason
 * `ProviderCapabilities` is a closed table.
 *
 * ⛔ **The default is `refused`, and the burden of proof is on the exemptions.** Being wrong in the
 * `refused` direction costs an intentional sentence for a command nobody sends during a quit; being
 * wrong in the other direction is the defect. So `answered` is claimed only where one of exactly two
 * things was checked in the source:
 *
 *  - **it touches no database at all** — `capabilities` returns a constant table, `profiles` is a
 *    `readdir`, `checkCwd` is a path check, `providerUsage` hands back readings held in memory, and
 *    the four credential commands work on provider homes on disk. None of them reads
 *    `deps.store`, directly or below.
 *  - **the host refuses it FIRST, in a better sentence than this door has** — `createSession`, whose
 *    very first statement is `reserve()`, which throws `SessionUnavailable('shutting-down')` before
 *    anything is read. That reason names the conversation and reaches the person as *"BroBot is
 *    shutting down, so this conversation was not opened."*
 *
 * ⚠️ **And the question was asked of the other channels too, once, so it does not have to be asked
 * again.** `runtime:command` is the only one that reaches SQLite: `app:info` reads the packaged
 * version, the three pickers open a dialog and `stat`,
 * `app:classify-attachments` and `app:hand-dropped-paths` `stat`, and `app:paste-image` reads the
 * clipboard and writes a PNG. None of them touches `deps.store`, so none of them needs a door.
 * ⚠️ **Except one, since `744`**: `app:saved-drafts` asks `store.recordedOne` whether each kept
 * draft's conversation still exists — and answers *keep it* once the database is closed
 * (`main/index.ts`' `recordedConversation`), so a window that reloads during a quit gets its drafts
 * rather than a closed connection. `app:save-drafts` writes a file and touches no store.
 *
 * ⚑ **`resume` looks like `createSession` and is NOT it**, which is the one asymmetry worth stating:
 * `resumeSession` reaches `attachHeldSession` before `reserve`, and that reads `store.findLive` and a
 * history window. Two sibling commands, one exempt and one refused, for a difference four call
 * frames down — which is exactly why this is a table somebody had to fill in rather than a rule
 * about "read commands".
 *
 * ## ⚠️ What this door is NOT
 *
 * ⛔ **It is not the reason a clean quit is quiet.** Electron `console.error`s every rejected
 * `ipcMain.handle` with a full stack — measured, not assumed — so a refusal thrown here still prints.
 * What stops the app printing anything on an ordinary quit is the renderer no longer ASKING once it
 * has been told (271's `app:closing`, now read by both closed-conversation lists). This door is the
 * boundary's own guarantee, for the window that did not stop, the surface added later, and the rule
 * that main never depends on a renderer behaving.
 */
const DURING_A_QUIT: Record<RuntimeCommandKind, QuitRuling> = {
  // ── Touches no database ────────────────────────────────────────────────────────────────────────
  capabilities: 'answered',
  providerCatalogue: 'answered',
  profiles: 'answered',
  checkCwd: 'answered',
  // ⚑ Forgets which window looks at a conversation, held in memory only.
  stopLooking: 'answered',

  // Connection names and references are database records, not build-time capabilities.
  providerConnections: 'refused',

  // ⛔ **The capability door, refused for its neighbours' reason** (355). Both statements are the
  // ledger's. The READ is worth nothing — the surface asking is on a window that is going — and the
  // WRITE is a person widening what an agent may do, which is not a thing to accept in the moment
  // the app stops being able to act on it.
  skills: 'refused',
  agentIdentities: 'refused',
  setExternalMcpServers: 'refused',
  // 🔴 **516 · refused, with the capability door above as the precedent and one reason of its own.**
  // ⛔ The statement is the ledger's, and it writes a row only a later LAUNCH could use — and there
  // are no later launches, because `createSession` is already refused by the host. ⚠️ **The reason
  // of its own is that this verb opens a SOCKET**: a registration during a quit would hold the
  // shutdown open on a handshake with a server that may never answer, which is exactly the shape
  // `273` §1 built this door to stop. ⚑ `removeExternalMcpServer` is refused in the same breath and
  // for the capability switch's reason: the narrowing direction is not an exemption either, because
  // nothing is left running for it to narrow.
  registerExternalMcpServer: 'refused',
  removeExternalMcpServer: 'refused',
  // 433. ⛔ **Refused with the capability door it sits beside, and on that door's own argument**: the
  // statement is the ledger's, and the write is a person saying what the NEXT conversation should
  // start on — while there are no next conversations, because `createSession` is already refused by
  // the host. ⚑ A person told the choice took effect would be told about a row nothing will read
  // before the process ends.
  setAgentProvider: 'refused',
  // 500. ⛔ **Refused, and `setAgentProvider` above is the precedent word for word**: this is a
  // person saying what their NEXT conversation should start in, and there are no next conversations
  // — `createSession` is already refused by the host. ⚑ A person told their default took effect, in
  // the moment nothing will ever read it again, would be told about a write rather than about a
  // consequence. ⚠️ And the OFF direction is not an exemption worth making either: nothing is
  // running that this value could narrow, because it has never described a running conversation.
  setDefaultApprovalMode: 'refused',
  // 419. ⛔ **Refused, with the capability door above as the precedent and its argument**: the
  // statement is the ledger's, and it writes a row that only a later LAUNCH could use — and there
  // are no later launches, because `createSession` is already refused by the host. ⚑ An identity
  // created in the moment the app stops being able to act on it would be a person told a creation
  // took effect that nothing will read before the process ends.
  createAgent: 'refused',
  // 558. ⛔ **Refused, with `setAgentProvider` as the precedent word for word**: this is a person
  // configuring an identity, and the surfaces that would re-read the new name are going away with
  // the process. ⚑ A person told their rename took effect, in the moment nothing will draw it
  // again, would be told about a write rather than about a consequence.
  setAgentDisplayName: 'refused',
  // D-016 · commit 7 · R4. ⛔ **Refused, with `setAgentDisplayName` as the precedent**: a person
  // naming work, while the surfaces that would draw the new title are going away with the process.
  retitleWork: 'refused',
  readConversationIdentity: 'refused',
  readConversationIdentities: 'refused',
  readConversationTasks: 'refused',
  readAllConversationTasks: 'refused',
  readConversationTitleHistory: 'refused',
  renameConversation: 'refused',
  // ⛔ Refused, with `retitleWork` as the precedent: a person acting on work, while the service that
  // would go on to its next piece is closing with the process.
  takeBackWork: 'refused',
  // ⛔ Refused, with `takeBackWork` as the precedent: a person ending work while the conversations
  // that would be told are closing with the process.
  closeWork: 'refused',
  // 677. ⛔ **Refused, with `setAgentProvider` as the precedent word for word**: a person configuring
  // an identity's NEXT conversations, while there are no next launches — `createSession` is already
  // refused by the host. ⚠️ And the door asks a provider for its catalogue, which is a launch of its
  // own, in the moment launches are being closed.
  setAgentModelAndEffort: 'refused',
  // 677. ⛔ **Refused, and a READ**: it touches the database, which is `agentInstructions`' reason one
  // door over — a quit closes the ledger this would read from.
  agentModelAndEffort: 'refused',
  // ⚑ **D-042 · the model list's three doors — refused, `agentModelAndEffort`'s reason**: each reads
  // or writes the database a quit closes, and the list read may ask a provider, which is a launch.
  modelList: 'refused',
  providerLaunchChoices: 'refused',
  resolveProviderLaunch: 'refused',
  addHandAddedModel: 'refused',
  deleteHandAddedModel: 'refused',
  // 🔒 **The API-key doors — refused, `modelList`'s reason**: each reads or writes the database a
  // quit closes.
  apiKeyStatus: 'refused',
  setApiKey: 'refused',
  removeApiKey: 'refused',
  // ⚑ …and the check, which also asks a provider over the network: nothing a quit should start.
  checkApiKey: 'refused',
  // ⚑ **The Providers screen's reads.** `providerUsage` is held in memory and touches nothing a quit
  // closes, so it is answered. ⛔ The other two start a process — `codex --version`, one process
  // listing — and nothing a quit is ending should start one.
  providerVersions: 'refused',
  // Refused, the default: nothing a person needs from it while the app quits.
  providerSetup: 'refused',
  providerUsage: 'answered',
  providerResources: 'refused',
  // ⚑ The kept rules: a list a person reads and edits from the Providers page — nothing a quit
  // should start.
  keptRules: 'refused',
  removeKeptRule: 'refused',
  // 582. ⛔ **Refused, with `setAgentDisplayName` directly above as the precedent word for word**:
  // this is a person configuring an identity, and the sheet that would re-read the new version is
  // going away with the process. ⚑ And the sharper reason here: what this writes takes effect at
  // the NEXT LAUNCH, so a person told it landed while the app is closing has been told about a
  // write whose consequence they cannot see until the thing that would show it has restarted.
  instructAgent: 'refused',
  // 582. ⛔ **Refused, and it is a READ, which is where it parts company with `capabilities` and
  // `profiles` above.** Those touch no database; this one does — and `DURING_A_QUIT`'s line is the
  // database rather than the direction, because a read that opens a statement against a store the
  // quit is tearing down is the same hazard as a write.
  agentInstructions: 'refused',
  agentMethods: 'refused',
  agentMethodBody: 'refused',
  agentMethodChanges: 'refused',
  removeAgentMethod: 'refused',
  undoAgentMethod: 'refused',
  checkInterruptedAgentMethods: 'refused',
  agentOwnNotes: 'refused',
  agentOwnNotesUnread: 'refused',
  saveOwnNotes: 'refused',
  undoOwnNotes: 'refused',
  markOwnNotesSeen: 'refused',
  agentRulesUnread: 'refused',
  undoAgentRules: 'refused',
  markAgentRulesSeen: 'refused',
  // 625. ⛔ **Refused, with `agentInstructions` directly above as the precedent**, and one reason
  // more: this read walks two provider homes, and a quit that is tearing the app down is the worst
  // moment to start a filesystem walk whose answer nothing will draw.
  agentMemory: 'refused',
  // F093. ⛔ **Refused, with `agentMemory` directly above as the precedent**: it reads the ledger,
  // the files a launch named and the memory stores — the same walk, and more of it.
  whatThisAgentWasGiven: 'refused',
  // F093 · C9 d. ⛔ **Refused, with `whatThisAgentWasGiven` directly above as the precedent**: a read
  // whose answer nothing will draw while the app is going away.
  whatTheModelGot: 'refused',
  // Refused during quit: no new memory change may start while its service is closing.
  amendAgentMemory: 'refused',
  undoAgentMemory: 'refused',
  checkInterruptedMemory: 'refused',
  // 582. ⛔ **Refused**: a decision answered during a quit settles a card nobody will see settle, and the person presses it again on the
  // next launch where the sheet can show them what happened.
  decideInstruction: 'refused',
  // Refused: an approval asks the server what it offers, and a decision during a quit settles a card
  // nobody will see settle. The request waits for the next launch.
  decideMcpServerRequest: 'refused',
  // 558. ⛔ **Refused, and the DESTRUCTIVE direction is not an exemption worth making** — which is
  // `removeExternalMcpServer`'s own ruling above, read at a higher price. ⚠️ A removal answered
  // during a quit is the one write in this app that cannot be looked at afterwards to see whether
  // it landed: the window that asked is closing, and the row it would have re-read is gone. ⚑ A
  // person presses it again on the next launch, where they can see what happened.
  removeAgent: 'refused',
  // ⛔ Refused, for `removeAgent`'s reason: what a person archives or deletes during a quit is
  // pressed again on the next launch, where they can see what happened.
  archiveConversation: 'refused',
  restoreConversation: 'refused',
  checkDeleteConversation: 'refused',
  deleteConversation: 'refused',
  // The credential four (098, 202). They live on provider homes, not in the ledger — and each is
  // already refused during a quit by `launches.open`, `checkProviderAuth` in its own `unknown`
  // vocabulary. ⚑ Left to say so themselves rather than being flattened into one sentence here.
  checkProviderAuth: 'answered',
  reprovisionProviderHomes: 'answered',
  reprovisionProviderAuth: 'answered',
  signInProvider: 'answered',
  cancelProviderSignIn: 'answered',

  // ── Refused first by the host, in a sentence that names the conversation ───────────────────────
  createSession: 'answered',

  // ── Everything else: refused at this door ──────────────────────────────────────────────────────
  // The pair `272` measured. They are the reason this table exists and they are ordinary rows in it.
  listResumable: 'refused',
  listUnresumable: 'refused',
  send: 'refused',
  sendInterrupting: 'refused',
  queueMessage: 'refused',
  cancelQueuedMessage: 'refused',
  takeBackAndStop: 'refused',
  respondPermission: 'refused',
  respondUserInput: 'refused',
  resolveLink: 'refused',
  // ⛔ `refused`, for its neighbour's reason: an answer whose asker the quit is ending.
  answerAction: 'refused',
  decideMoveRequest: 'refused',
  interrupt: 'refused',
  stopBackgroundWork: 'refused',
  close: 'refused',
  refreshConfig: 'refused',
  compact: 'refused',
  setApprovalMode: 'refused',
  setSessionSetting: 'refused',
  endPlanMode: 'refused',
  adoptSessions: 'refused',
  exportSession: 'refused',
  importBundleFile: 'refused',
  // See the asymmetry with `createSession` above — this one reads before it refuses.
  resume: 'refused',
  // ⚑ **D-017b** · refused with `resume`: it reads the ledger and the row before it answers, and a
  // conversation drawn into a window that is closing is worth nothing.
  look: 'refused',
  // 🔴 **735** · `resume` and a send in one act, refused for both their reasons: it reads and writes
  // the ledger, and it would start a provider into a quit.
  startAndSend: 'refused',
  cancelLaunch: 'refused',
  attachOpen: 'refused',
  // 336. ⚑ Refused for the reason `resume` is, and it is the same reason exactly: it reads
  // `store.findLive` and a history window before it decides anything. ⚠️ And it would be refused on
  // the merits anyway — during a quit every unclaimed session is already being closed by
  // `closeAll`, so a take-over could only hand somebody a conversation that is going away.
  claim: 'refused',
  // 523. ⛔ Refused, and NOT because a hand-back is a read — it touches no database at all, which
  // is the first of the two grounds this table allows. ⚑ It is refused on the SECOND ground: during
  // a quit `closeAll` is already ending every session this host holds, so the only thing a release
  // could do is take a window's name off a conversation that is going away — and it would report
  // `unwatched` for a slot one step from `not-running`, which is a truthful answer to a question
  // nobody should be able to ask. ⚠️ `refused` is also the cheap side to be wrong on.
  release: 'refused',
  // ⛔ **398 · `refused`, and it is the reading that costs nothing to be wrong about.** It reads
  // `deps.store` — three statements and two folds — which is the one thing this door exists to keep
  // out of a quit. ⚠️ The `answered` case would have to be argued from *"a read is harmless"*, and
  // this table's own note says why that argument is not available here: the ruling is per COMMAND
  // and per what the source was checked to touch, never per a category like "read commands".
  questionsForAPerson: 'refused',
  // ⛔ **403 · `refused`, for its neighbour's reason exactly.** One `SELECT DISTINCT` and a fold
  // per candidate ledger — a store read, which is the one thing this door exists to keep out of a
  // quit. ⚠️ And there is nothing a person could do with the answer during a quit: the window that
  // asked is going away, and the row it names is durable and will be there at the next launch.
  decisionsForAPerson: 'refused',
  // ⛔ **533 · `refused`, for its two neighbours' reason exactly.** One indexed read over the
  // error rows of the last month plus a count — a store read, which is the one thing this door
  // exists to keep out of a quit. ⚠️ And there is nothing a person could do with the answer while
  // the window is going away: a wall ends on the provider's own word — its clock, or its next
  // answer (`586`) — the rows it was read from are durable, and the next launch reads the same ones.
  limitsForAPerson: 'refused',
  readLimitsDisplay: 'refused',
  // ⛔ **D-017 · R19 · `refused`, for its neighbours' reason exactly**: a store read, and the asks
  // are durable rows the next launch reads again.
  instructionAsksForAPerson: 'refused',
  // Refused for its neighbours' reason: a store read of durable rows the next launch reads again.
  mcpServerRequestsForAPerson: 'refused',
  // ⛔ **557 · `refused`, for its four neighbours' reason exactly.** It reads `deps.store` — one
  // indexed candidate query plus a piece fold per ledger — which is the one thing this door exists
  // to keep out of a quit. ⚠️ And nothing is lost by refusing it during one: the rows are durable,
  // nothing about a stall changes because a window went away, and the next launch reads the same
  // ones.
  stalledWorkForAPerson: 'refused',
  // ⛔ `refused`, for its neighbour's reason: a store walk, over rows the next launch reads again.
  stoppedWorkForAPerson: 'refused',
  // ⛔ `refused`, for its neighbours' reason: store walks the next launch reads again.
  personsQueue: 'refused',
  // ⛔ `refused`, for the listing pair's reason; answered at its stamp, as the queue is.
  listConversations: 'refused',
  listRecentConversations: 'refused',
  // Answered: it reads nothing but what this run is called.
  currentEpoch: 'answered',
  // ⛔ `refused`, for its neighbour's reason: a store walk, over rows the next launch reads again.
  workIncidentsForAPerson: 'refused',
  // ⛔ **F097 · `refused`, for its neighbour's reason exactly**: one indexed candidate query plus a
  // piece fold per ledger — a store read — and the wait is durable rows the next launch reads again.
  waitingOnWhoWroteForAPerson: 'refused',
  // ⛔ **438 · `refused`, and its two neighbours' reading exactly.** It reads `deps.store` — one
  // statement plus a count — which is the one thing this door exists to keep out of a
  // quit. ⚠️ Ruled per COMMAND and on what the source was checked to touch, never on the category
  // *"it is only a read"*.
  digest: 'refused',
  recentActivity: 'refused',
  // ⛔ **`refused`, on the default rather than on an argument** (508): it reads `deps.store`, which
  // is the one thing this door's own rule says earns the word without further discussion.
  workGivenBy: 'refused',
  // ⛔ **543 · `refused`, on the default rather than on an argument** — `workGivenBy`'s reading
  // exactly: it reads `deps.store`, which is the one thing this door exists to keep out of a quit.
  // ⚠️ And there is nothing a person could do with the answer while the window is going away: every
  // edge it names is durable and the next launch reads the same rows.
  whoCalledWhom: 'refused',
  // ⛔ **567 · `refused`, on the default rather than on an argument** — `whoCalledWhom`'s reading
  // exactly: it reads `deps.store`, which is the one thing this door exists to keep out of a quit.
  // ⚠️ And a COUNT is the least useful thing to answer during one: the window that asked is going
  // away, the number would be about a workspace that is closing, and the next launch reads the same
  // rows. ⛔ **And it would be actively wrong to answer**: `closeAll` is ending sessions while the
  // quit runs, so an `open` count taken mid-teardown is a reading of a moment nobody was in.
  readWorkspace: 'refused',
  // ⛔ **575 · `refused`, and this one does not even reach the store.** It reads the SLOT MAP,
  // which `closeAll` is emptying while the quit runs — so the answer would be a picture of a
  // teardown rather than of the app, which is `readWorkspace`'s last clause with the population
  // changed. ⚠️ And there is nothing a person could do with it: the window that asked is going
  // away and every conversation it names is being closed.
  whatIsBeingDone: 'refused',
  // ⛔ **621 · `refused`, for the line above's reason plus one of its own.** ⚑ It walks the SLOT
  // MAP that `closeAll` is emptying, AND it opens three ledgers per conversation — so during a quit
  // it would be a picture of a teardown bought with reads the app is shutting down around.
  whatEachConversationIsWaitingOn: 'refused',
  // Refused for the line above's reason: they walk the slot map `closeAll` is emptying, and fold
  // a ledger per drawn conversation, a costly picture of a teardown.
  forestReading: 'refused',
  forestNodes: 'refused',
  // ⛔ **D-018 · `refused`, for `whatIsBeingDone`'s reason**: it walks the SLOT MAP that `closeAll`
  // is emptying, and would fork a `ps` about the very processes the quit is stopping. ⚠️ And the
  // window that asked is going away: a figure for a process on its way out is worth nothing.
  processMemory: 'refused',
  listLibrary: 'refused',
  importRecordedSession: 'refused',
  importUserHomeSession: 'refused',
  rebuildLedger: 'refused',
  readWorkflowOutput: 'refused',
  // 356. Refused with its neighbours — it goes through the session store, and a document opened on a
  // window that is closing is worth nothing.
  readInstructionSource: 'refused',
  // 356. ⛔ Refused, and this one for a reason of its own: a reveal raises a FILE MANAGER WINDOW, and
  // a quit that scattered Finder windows behind itself would be the app arguing with the gesture
  // that ended it.
  revealPath: 'refused',
  // 733. Refused with `readInstructionSource`, for its reason: a file opened on a window that is
  // closing is worth nothing — and it reads the slot map and then the disk, which is what a quit
  // keeps out.
  readConfigFile: 'refused',
  // 300. Refused for the reason `readChildState` is, and with less to weigh: it is a buffer read on
  // a window that is closing, and a tail nobody will see is worth nothing.
  readCommandOutput: 'refused',
  // 462. Refused with it, and the weighing is the same one: a panel raised on a window that is
  // closing is a panel nobody reads. ⚠️ **And the answer is not durable**, so there is nothing a
  // refusal here can cost a person that the quit was not already going to cost them.
  readToolAnswer: 'refused',
  // ⛔ **510 · `refused`, and its five neighbours' reading exactly.** It reads `deps.store` — one
  // primary-key lookup — and then the disk, which is the one thing this door exists to keep out
  // of a quit. ⚠️ Ruled per COMMAND and on what the source was checked to touch, never on the
  // category *"it is only a read"*. ⚑ And a resource opened on a window that is closing is worth
  // nothing: the row is durable and will be there at the next launch.
  readResource: 'refused',
  // ⛔ **D-032 · `refused`, `readResource`'s reading**: a store lookup, then up to 16 MiB off the
  // disk, for a viewer on a window that is closing.
  drawResource: 'refused',
  // ⛔ **D-032 · `refused`, `revealPath`'s reason**: a quit that raised a Finder window behind
  // itself would be arguing with the gesture that ended it.
  revealResource: 'refused',
  // A quit is no moment to stat files for a message, open an app or raise a file manager window.
  resolveMessagePaths: 'refused',
  openMessagePath: 'refused',
  revealMessagePath: 'refused',
  // ⛔ **D-026 · `refused`, on the default rather than on an argument** — `whoCalledWhom`'s reading:
  // it reads `deps.store`, the one thing this door exists to keep out of a quit, and every file it
  // lists is durable and read the same at the next launch.
  filesKept: 'refused',
  filesLibrary: 'refused',
  teamProfileGraph: 'refused',
  searchWork: 'refused',
  readChildWork: 'refused',
  // 296. Both refused, and the send is the easier of the two to rule on: a quit is the moment this
  // app stops starting work, and a message to a child starts a turn. ⚠️ The READ is refused for the
  // ordinary reason its neighbours are — it goes through the session store — and it would be a poor
  // trade anyway: the viewer that polls it is on a window that is closing.
  readChildState: 'refused',
  sendToChild: 'refused',
  earlierHistory: 'refused',
  latestHistory: 'refused',
}

/**
 * The one sentence a refused command gets, in the family every other shutdown refusal is already in
 * — *"BroBot2 is shutting down, so X was not Y"* (070, 098, 100, 202).
 *
 * ⚠️ **It names the command**, because this string reaches two readers with opposite needs: a
 * developer reading a quit's output, who has to know WHICH request was still in flight, and a person
 * whose list shows its `loadError` for the fraction of a second before the window goes. The wire word
 * is the cheapest thing that serves the first without lying to the second.
 */
export function refusedDuringAQuit(kind: RuntimeCommandKind): string {
  return `BroCrew is shutting down, so ${kind} was not asked of its database`
}

export function noPersonBehindIt(kind: RuntimeCommandKind): string {
  const does = WHAT_A_PERSONS_VERB_DOES[kind] ?? 'changes what agents are allowed to do'
  return `${kind} ${does}, so it is refused unless a person is asking`
}

const WHAT_A_PERSONS_VERB_DOES: Partial<Record<RuntimeCommandKind, string>> = {
  agentIdentities: 'reads every agent and what each may do',
  agentInstructions: 'reads an agent’s own instructions',
  agentMethods: 'reads saved methods',
  agentMethodBody: 'reads a saved method',
  agentMethodChanges: 'reads saved-method history',
  agentOwnNotes: 'reads an agent’s own notes',
  agentOwnNotesUnread: 'reads unread own-notes changes',
  agentRulesUnread: 'reads unread standing-rule changes',
  undoAgentRules: 'undoes the latest standing-rule change',
  agentMemory: 'reads an agent’s own memory',
  agentModelAndEffort: 'reads the model an agent starts on',
  modelList: 'reads the models a provider offers',
  providerLaunchChoices: 'reads a provider’s readiness and launch choices',
  resolveProviderLaunch: 'reads the provider a launch resolves to',
  whatThisAgentWasGiven:
    'reads everything an agent was given: its instructions, its tools and its memory',
  whatTheModelGot: 'reads a message as the model got it, with the agent’s own instructions',
  instructAgent: 'changes an agent’s own instructions',
  decideInstruction: 'approves or declines rules proposed for an agent',
}

/** Throw {@link noPersonBehindIt} unless the channel this arrived on declares a person behind it. */
function requireAPerson(sink: RuntimeEventSink, kind: RuntimeCommandKind): void {
  if (!sink.aPersonIsBehindIt) throw new Error(noPersonBehindIt(kind))
}

export { DURING_A_QUIT, requireAPerson }
