import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isRef, unref } from 'vue'
import { FakeRuntime } from '@brobot2/runtime'
import { appClosing } from '../src/renderer/src/lib/app-closing'
import {
  executeRuntimeCommand,
  refusedDuringAQuit,
  runtimeCommandSchema,
} from '../src/main/runtime/ipc'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type { RuntimeCommand, RuntimeCommandKind } from '../src/shared/runtime-ipc'

/**
 * 🔴 **The door that closes before the room** (273, from `272` finding 1).
 *
 * ## ⛔ What was measured, twice, on a clean quit
 *
 * > *"After `close its database`, the old process logged one failed `runtime:command` query for
 * > resumable sessions and one for unresumable sessions. Both failed with `The database connection
 * > is not open`."*
 *
 * Neither of those two commands is unusual and neither was doing anything wrong. The quit itself is
 * what asks: `closeAll()` ends every conversation, each emits its terminal event, `RuntimeScreen`
 * watches the open list's length, and both closed-conversation lists re-read themselves — and the
 * fourth ordered step has by then closed the connection they read through.
 *
 * ## ⚑ What this file holds, and why each part is not decoration
 *
 *  1. **The ruling is TOTAL.** Every kind on the wire is driven through the boundary, from a sample
 *     table typed `Record<RuntimeCommandKind, RuntimeCommand>` — so a command added to the union
 *     does not compile until somebody has decided what it does during a quit. The samples are
 *     checked against the real schema first, because a sample that never parsed would make every
 *     refusal below true for the wrong reason.
 *  2. **The exemptions are named HERE as well as in the source.** `ANSWERED_DURING_A_QUIT` is a
 *     second, independent statement of the same decision: flipping a command to `answered` in
 *     `ipc.ts` and nowhere else fails this file. ⚠️ That is 193 M5's rule — an old ruling is never
 *     quietly changed — applied to a table rather than to an assertion.
 *  3. **Nothing reaches the host.** The refusal is asserted by what the host was NOT asked, not only
 *     by the sentence: 273 §1 refuses a try/catch around the query in as many words, because that
 *     *"hides the call instead of stopping it"*.
 *  4. **The door is shut BEFORE the database closes**, which is the ordering the whole defect is.
 *     Its far end — that the fourth step really does find it shut — is in
 *     `shutdown-ownership.test.ts`, against a real SQLite connection and the real `createAppLifetime`.
 */

const SESSION = 'sess_1'
const REQUEST = 'req_1'

/**
 * One valid payload per command kind — total by TYPE, so the union cannot grow past this file.
 *
 * ⚠️ **Minimal on purpose.** These are checked against `runtimeCommandSchema` below and then driven
 * through the boundary against a host that records rather than acts, so what matters about each one
 * is only that it is a real, parseable command of that kind.
 */
const SAMPLES: Record<RuntimeCommandKind, RuntimeCommand> = {
  resolveLink: { kind: 'resolveLink', target: 'W1' },
  createSession: { kind: 'createSession', provider: 'codex' },
  send: { kind: 'send', sessionId: SESSION, text: 'hello' },
  sendInterrupting: { kind: 'sendInterrupting', sessionId: SESSION, text: 'hello' },
  queueMessage: { kind: 'queueMessage', sessionId: SESSION, text: 'hello' },
  cancelQueuedMessage: { kind: 'cancelQueuedMessage', sessionId: SESSION, messageId: 'msg_1' },
  takeBackAndStop: { kind: 'takeBackAndStop', sessionId: SESSION, messageId: 'msg_1' },
  respondPermission: {
    kind: 'respondPermission',
    sessionId: SESSION,
    requestId: REQUEST,
    decision: { outcome: 'cancel' },
  },
  decideMoveRequest: {
    kind: 'decideMoveRequest',
    sessionId: 's',
    requestId: 'r',
    decision: 'move',
  },
  respondUserInput: {
    kind: 'respondUserInput',
    sessionId: SESSION,
    requestId: REQUEST,
    response: { kind: 'reject' },
  },
  answerAction: { kind: 'answerAction', sessionId: SESSION, request: REQUEST, done: true },
  interrupt: { kind: 'interrupt', sessionId: SESSION },
  stopBackgroundWork: { kind: 'stopBackgroundWork', sessionId: SESSION, id: 'bg_1' },
  readCommandOutput: { kind: 'readCommandOutput', sessionId: SESSION, toolCallId: 'exec_1' },
  readToolAnswer: { kind: 'readToolAnswer', sessionId: SESSION, toolCallId: 'exec_1' },
  // 510. ⛔ **No session, and the sample says so** — the only read on this union addressed to a
  // row in the app's own `work_resource` table rather than to a conversation.
  readResource: { kind: 'readResource', resourceId: 'res_1' },
  searchWork: { kind: 'searchWork', conversation: SESSION, query: { scope: 'all' } },
  // D-032 · the same id, for a picture's bytes and for Finder.
  drawResource: { kind: 'drawResource', resourceId: 'res_1' },
  revealResource: { kind: 'revealResource', resourceId: 'res_1' },
  resolveMessagePaths: { kind: 'resolveMessagePaths', sessionId: SESSION, texts: ['notes.md'] },
  openMessagePath: { kind: 'openMessagePath', sessionId: SESSION, text: 'notes.md' },
  revealMessagePath: { kind: 'revealMessagePath', sessionId: null, text: '/tmp' },
  // ⚑ D-026 · a piece by its label; the three scopes share one kind, and one ruling.
  filesKept: { kind: 'filesKept', scope: 'piece', piece: 'W1' },
  close: { kind: 'close', sessionId: SESSION },
  refreshConfig: { kind: 'refreshConfig', sessionId: SESSION },
  setApprovalMode: { kind: 'setApprovalMode', sessionId: SESSION, mode: 'ask' },
  setSessionSetting: {
    kind: 'setSessionSetting',
    sessionId: SESSION,
    body: { kind: 'model', value: 'a-model' },
  },
  endPlanMode: { kind: 'endPlanMode', sessionId: SESSION, text: 'go ahead' },
  listResumable: { kind: 'listResumable' },
  listUnresumable: { kind: 'listUnresumable' },
  adoptSessions: { kind: 'adoptSessions' },
  exportSession: { kind: 'exportSession', sessionId: SESSION, exportKind: 'bundle' },
  importBundleFile: { kind: 'importBundleFile', path: '/tmp/one.brobot-session.json' },
  resume: { kind: 'resume', sessionId: SESSION },
  // ⚑ **D-017b** · a person's press opens a conversation through this door, and starts nothing.
  look: { kind: 'look', sessionId: SESSION, claim: true },
  stopLooking: { kind: 'stopLooking', sessionId: SESSION },
  startAndSend: { kind: 'startAndSend', sessionId: SESSION, text: 'hello' },
  cancelLaunch: { kind: 'cancelLaunch', launchKey: 'launch_1' },
  attachOpen: { kind: 'attachOpen' },
  claim: { kind: 'claim', sessionId: SESSION },
  release: { kind: 'release', sessionId: SESSION },
  // 398 · no arguments: a person is not inside one family, so there is no id that narrows it.
  questionsForAPerson: { kind: 'questionsForAPerson' },
  // 403 · no arguments either, and for the same reason: a person is not inside one family.
  decisionsForAPerson: { kind: 'decisionsForAPerson' },
  // 533 · no arguments either, and for a reason of its own: a wall is a fact about a PROVIDER's
  // account, so there is no conversation, no project and no instant that narrows it.
  limitsForAPerson: { kind: 'limitsForAPerson' },
  readLimitsDisplay: { kind: 'readLimitsDisplay' },
  // D-017 · R19 · no arguments either, for its neighbours' reason: a person is not inside one
  // family, and an identity's instructions are asked about from any conversation.
  instructionAsksForAPerson: { kind: 'instructionAsksForAPerson' },
  mcpServerRequestsForAPerson: { kind: 'mcpServerRequestsForAPerson' },
  stalledWorkForAPerson: { kind: 'stalledWorkForAPerson' },
  stoppedWorkForAPerson: { kind: 'stoppedWorkForAPerson' },
  workIncidentsForAPerson: { kind: 'workIncidentsForAPerson' },
  // F097 · no arguments either, for its neighbours' reason: a person is not inside one family.
  waitingOnWhoWroteForAPerson: { kind: 'waitingOnWhoWroteForAPerson' },
  digest: { kind: 'digest', from: 0, to: 1 },
  recentActivity: { kind: 'recentActivity', from: 0, to: 1 },
  workGivenBy: { kind: 'workGivenBy', sessionId: SESSION },
  whoCalledWhom: { kind: 'whoCalledWhom', sessionId: SESSION },
  // 567 · no arguments at all: the answer is about the whole workspace, so a project, a session or
  // a window here would narrow the question rather than ask it.
  readWorkspace: { kind: 'readWorkspace' },
  // 575 · no arguments at all, and for a stronger reason than the line above: the answer is every
  // conversation this app is RUNNING, and a set the caller named would bound the answer by the
  // question it happened to ask.
  whatIsBeingDone: { kind: 'whatIsBeingDone' },
  // 621 · no arguments at all, for the line above's reason exactly: the answer is every
  // conversation this app is RUNNING and what it is waiting on, and a set the caller named would
  // bound the answer by the question it happened to ask.
  whatEachConversationIsWaitingOn: { kind: 'whatEachConversationIsWaitingOn' },
  theWholeForest: { kind: 'theWholeForest' },
  // D-018 · no arguments, for `whatIsBeingDone`'s reason: the answer is every conversation this app
  // is RUNNING, by the pid of the process it started.
  processMemory: { kind: 'processMemory' },
  listLibrary: { kind: 'listLibrary' },
  importRecordedSession: { kind: 'importRecordedSession', sessionId: SESSION },
  importUserHomeSession: {
    kind: 'importUserHomeSession',
    provider: 'claude',
    providerSessionId: 'provider_1',
  },
  rebuildLedger: { kind: 'rebuildLedger', sessionId: SESSION },
  readWorkflowOutput: { kind: 'readWorkflowOutput', sessionId: SESSION, taskId: 'task_1' },
  readInstructionSource: { kind: 'readInstructionSource', sessionId: SESSION, index: 0 },
  // ⚠️ The nested target is walked by the same descent this table's `readChildWork` row needs — see
  // the union walk below, which is why a sample rather than a bare kind is what this map holds.
  revealPath: { kind: 'revealPath', sessionId: SESSION, target: { of: 'cwd' } },
  readConfigFile: { kind: 'readConfigFile', sessionId: SESSION, name: 'config.toml' },
  readChildWork: {
    kind: 'readChildWork',
    sessionId: SESSION,
    part: 'transcript',
    agentId: 'agent_1',
  },
  readChildState: { kind: 'readChildState', sessionId: SESSION, agentId: 'agent_1' },
  sendToChild: {
    kind: 'sendToChild',
    sessionId: SESSION,
    agentId: 'agent_1',
    // ⚠️ Non-blank, because `childMessage` holds this verb to `hasSomethingToSend` like every other
    // message on this wire — a `''` here would fail the parse pass for the wrong reason.
    text: 'how is it going',
  },
  earlierHistory: { kind: 'earlierHistory', sessionId: SESSION, before: 3 },
  latestHistory: { kind: 'latestHistory', sessionId: SESSION },
  capabilities: { kind: 'capabilities' },
  profiles: { kind: 'profiles' },
  checkProviderAuth: { kind: 'checkProviderAuth', provider: 'claude' },
  reprovisionProviderAuth: { kind: 'reprovisionProviderAuth', provider: 'claude' },
  signInProvider: { kind: 'signInProvider', provider: 'claude' },
  cancelProviderSignIn: { kind: 'cancelProviderSignIn', provider: 'claude' },
  checkCwd: { kind: 'checkCwd', path: '/tmp' },
  // 355 · the capability door. ⚠️ The grant names every field, always — the wire refuses a payload
  // that drops one — so this sample is the whole schema at its ruled defaults, which is the shape a
  // sheet with nothing touched sends.
  skills: { kind: 'skills', request: { operation: 'list', offset: 0 } },
  agentIdentities: { kind: 'agentIdentities' },
  // 419 · ⚠️ **A name nothing has created**: a sample that got PAST the quit door would still be a
  // legal creation rather than a collision, and a sample that could fail for a second reason cannot
  // say which one stopped it.
  createAgent: {
    kind: 'createAgent',
    slug: 'a-second-agent',
    displayName: null,
    provider: null,
  },
  // 433. ⚠️ **A slug nothing has created**, `createAgent`'s rule two rows up: a sample that got past
  // the quit door would still answer `null` from the store's own criterion-12 refusal rather than
  // writing anything, so a sample that could fail for a second reason cannot say which one stopped
  // it. ⛔ `null` for the provider, which is the *use the app's fallback* gesture and the value that
  // changes nothing if it ever did land.
  setAgentProvider: { kind: 'setAgentProvider', profileId: 'pm', provider: null },
  setAgentDisplayName: { kind: 'setAgentDisplayName', profileId: 'pm', displayName: null },
  // D-016 · R4 · ⚠️ **A label no piece can have** — numbering starts at 1, so `W0` names nothing in any
  // store — `createAgent`'s rule: a sample that got past the quit door would still be refused
  // `no-piece-by-that-name` rather than writing a title anywhere.
  retitleWork: { kind: 'retitleWork', piece: 'W0', title: 'Build the pages' },
  takeBackWork: { kind: 'takeBackWork', piece: 'W0.1' },
  setAgentModelAndEffort: {
    kind: 'setAgentModelAndEffort',
    profileId: 'pm',
    provider: null,
    model: null,
    effort: null,
  },
  agentModelAndEffort: { kind: 'agentModelAndEffort', profileId: 'pm' },
  // ⚑ **D-042 · R3 — the model list's three doors**, every one `refused` during a quit (see
  // `DURING_A_QUIT`: each reads or writes the database a quit closes). ⚠️ `createAgent`'s rule for
  // the writes: a model nothing has added — an add that got past the quit door would be a legal
  // add, and a delete would take nothing off the list.
  modelList: { kind: 'modelList', provider: 'claude' },
  addHandAddedModel: { kind: 'addHandAddedModel', provider: 'claude', model: 'nobody-added-this' },
  deleteHandAddedModel: {
    kind: 'deleteHandAddedModel',
    provider: 'claude',
    model: 'nobody-added-this',
  },
  // 🔒 The API-key doors. ⚠️ A fake key, never a real one: a set that got past the quit door would
  // keep it, and a remove would forget nothing.
  apiKeyStatus: { kind: 'apiKeyStatus', provider: 'claude' },
  setApiKey: { kind: 'setApiKey', provider: 'claude', key: 'sk-ant-fake-for-tests' },
  removeApiKey: { kind: 'removeApiKey', provider: 'claude' },
  checkApiKey: { kind: 'checkApiKey', provider: 'claude' },
  providerVersions: { kind: 'providerVersions' },
  providerSetup: { kind: 'providerSetup' },
  providerUsage: { kind: 'providerUsage' },
  providerResources: { kind: 'providerResources' },
  keptRules: { kind: 'keptRules' },
  removeKeptRule: {
    kind: 'removeKeptRule',
    provider: 'claude',
    file: '/tmp/x/.claude/settings.local.json',
    kept: 'Bash(make build *)',
  },
  // 582 · ⚑ Three doors onto the `configured` layer, every one of them `refused` during a quit —
  // see `DURING_A_QUIT`, where each says why in its own words.
  instructAgent: { kind: 'instructAgent', profileId: 'pm', text: 'never force-push' },
  agentInstructions: { kind: 'agentInstructions', profileId: 'pm' },
  agentMethods: { kind: 'agentMethods', profileId: 'lark' },
  agentMethodBody: { kind: 'agentMethodBody', profileId: 'lark', key: 'method:review.md' },
  agentMethodChanges: { kind: 'agentMethodChanges', profileId: 'lark' },
  removeAgentMethod: {
    kind: 'removeAgentMethod',
    profileId: 'lark',
    selection: {
      confirmed: true,
      key: 'method:review.md',
      fingerprint: null,
      indexState: 'absent',
      indexFingerprint: null,
    },
  },
  undoAgentMethod: { kind: 'undoAgentMethod', profileId: 'lark', changeId: 'method-change-one' },
  checkInterruptedAgentMethods: {
    kind: 'checkInterruptedAgentMethods',
    profileId: 'lark',
    confirmed: true,
  },
  agentOwnNotes: { kind: 'agentOwnNotes', profileId: 'pm' },
  agentOwnNotesUnread: { kind: 'agentOwnNotesUnread', profileId: 'pm' },
  saveOwnNotes: {
    kind: 'saveOwnNotes',
    profileId: 'pm',
    expectedVersion: 0,
    currentText: '',
    text: 'Keep scope.',
    why: 'Person edit.',
  },
  undoOwnNotes: { kind: 'undoOwnNotes', profileId: 'pm', expectedVersion: 1 },
  markOwnNotesSeen: { kind: 'markOwnNotesSeen', profileId: 'pm', throughVersion: 1 },
  agentRulesUnread: { kind: 'agentRulesUnread', profileId: 'pm' },
  undoAgentRules: { kind: 'undoAgentRules', profileId: 'pm', expectedVersion: 1 },
  markAgentRulesSeen: { kind: 'markAgentRulesSeen', profileId: 'pm', throughVersion: 1 },
  // 625 · ⚑ Two doors onto an agent's MEMORY, both `refused` during a quit — see `DURING_A_QUIT`.
  // ⛔ The write is the sharper case there: it is not transactional with its record, so a quit
  // landing between the file and the row leaves a store short an entry and nothing saying why.
  agentMemory: { kind: 'agentMemory', profileId: 'pm' },
  whatThisAgentWasGiven: { kind: 'whatThisAgentWasGiven', sessionId: SESSION },
  whatTheModelGot: { kind: 'whatTheModelGot', sessionId: SESSION, ordinal: 0 },
  amendAgentMemory: {
    kind: 'amendAgentMemory',
    fingerprint: '0'.repeat(64),
    confirmed: true,
    profileId: 'pm',
    provider: 'claude',
    entry: '/nowhere/memory/MEMORY.md',
    act: 'removed',
    text: '',
  },
  undoAgentMemory: {
    kind: 'undoAgentMemory',
    profileId: 'lark',
    sourceId: 'mem:lark:1',
    confirmed: true,
  },
  checkInterruptedMemory: { kind: 'checkInterruptedMemory', profileId: 'lark', confirmed: true },
  decideInstruction: { kind: 'decideInstruction', askId: 'iprop_1', approve: true },
  decideMcpServerRequest: { kind: 'decideMcpServerRequest', requestId: 'msreq_1', approve: true },
  removeAgent: { kind: 'removeAgent', profileId: 'pm' },
  archiveConversation: { kind: 'archiveConversation', sessionId: 's' },
  restoreConversation: { kind: 'restoreConversation', sessionId: 's' },
  checkDeleteConversation: { kind: 'checkDeleteConversation', sessionId: 's' },
  deleteConversation: { kind: 'deleteConversation', sessionId: 's', parts: ['records'] },
  setCapabilities: {
    kind: 'setCapabilities',
    profileId: 'pm',
    grant: {
      maxDepth: null,
      canMessage: null,
      canAssignWork: null,
      canCreateAgents: null,
      // ⚑ **582 · nobody has chosen** — the whole grant on this fixture is nulls.
      canWriteRules: null,
    },
    // ⚑ **516 · required on this command, and EMPTY is the sample that changes nothing.** The wire
    // carries the complete set, so `[]` is *this identity reaches no external server* — which is
    // what every identity holds until somebody ticks a box, and therefore the sample that cannot
    // fail for a second reason.
    externalMcpServerIds: [],
  },
  // 🔴 **516 · the registry's two writes.** ⚠️ **A name and an address nothing has registered**,
  // which is `createAgent`'s rule three rows up: a sample that got past the quit door would still be
  // refused — the register verb opens a socket to an address with nothing listening on it, and the
  // remove verb answers `false` for a row that is not there — so neither sample can be confused
  // about which door stopped it. ⛔ The address is loopback on a port nothing in this repo binds.
  registerExternalMcpServer: {
    kind: 'registerExternalMcpServer',
    name: 'nothing-listens-here',
    url: 'http://127.0.0.1:9/mcp',
    // ⚑ **524 · the WIDE value, on purpose.** This sample exists to be stopped by the quit door, and
    // seeding it `'restricted'` would have made the row the one this dispatch's ruling does not
    // reach — so if the door ever stopped stopping it, what got through would be the registration
    // that grants everybody rather than the one that grants nobody.
    reach: 'everyone',
  },
  removeExternalMcpServer: {
    kind: 'removeExternalMcpServer',
    serverId: 'ems:nothing-listens-here',
  },
  setSpawningEnabled: { kind: 'setSpawningEnabled', enabled: false },
  setServicesOn: { kind: 'setServicesOn', on: false },
  setDefaultApprovalMode: { kind: 'setDefaultApprovalMode', mode: 'auto' },
}

/**
 * ⛔ **The nine commands the door lets through, restated away from the source that decides it.**
 *
 * ⚠️ **Two reasons, and the difference matters** — see `DURING_A_QUIT` in `ipc.ts`:
 *
 *  - **eight touch no database at all** — `providerUsage` among them, readings held in memory —
 *    and, where they should refuse a quit, already do it in their own better vocabulary
 *    (`checkProviderAuth`'s `unknown`);
 *  - **`createSession` refuses FIRST** — `reserve()` is its opening statement and throws
 *    `SessionUnavailable('shutting-down')`, which reaches a person as *"BroCrew is shutting down, so
 *    this conversation was not opened."*
 *
 * ⚑ **`resume` is deliberately NOT in this set**, and it is the row worth staring at: it looks like
 * `createSession` and is not, because `resumeSession` reaches `attachHeldSession` — `store.findLive`
 * plus a history window — before it ever reaches `reserve`.
 */
const ANSWERED_DURING_A_QUIT: ReadonlySet<RuntimeCommandKind> = new Set([
  'capabilities',
  'profiles',
  'checkCwd',
  'checkProviderAuth',
  'reprovisionProviderAuth',
  'signInProvider',
  'cancelProviderSignIn',
  'createSession',
  // ⚑ The newest usage readings, held in memory: no database, no process.
  'providerUsage',
  // ⚑ Which window looks at a conversation, held in memory.
  'stopLooking',
])

const KINDS = Object.keys(SAMPLES) as RuntimeCommandKind[]

class RecordingSink implements RuntimeEventSink {
  // ⚠️ Annotated rather than inferred, so `WindowSink` below can override it — an inferred `false`
  // is the literal type and nothing may be assigned to it.
  readonly aPersonIsBehindIt: boolean = false
  readonly alive = true
  readonly ownerId = 'owner:1'
  send(): void {}
  sendLiveness(): void {}
}

/**
 * ⛔ **The same sink, declaring what a real window declares** (355, on 349).
 *
 * `355`'s three capability verbs are refused at the door unless the channel they arrived on says a
 * person is behind it — the first reader of `RuntimeEventSink.aPersonIsBehindIt` at the IPC layer.
 * ⚠️ **The refusal is not this file's subject**, and the test below would otherwise fail for a
 * reason that has nothing to do with a quit: *"changes nothing at all while the app is running"* is
 * about the SHUTDOWN door, and the only channel these commands really arrive on is a window, which
 * declares `true`.
 *
 * ⚑ **Two sinks rather than flipping the one**, so the difference stays visible: every other verb is
 * still driven by a sink that claims nothing, and the person gate itself is performed — refused and
 * allowed at the same moment — in `the-grant-nobody-can-give.test.ts` §3.
 */
class WindowSink extends RecordingSink {
  override readonly aPersonIsBehindIt = true
}

/** The verbs `ipc.ts` refuses unless a person is asking. */
const NEEDS_A_PERSON = new Set<RuntimeCommandKind>([
  'skills',
  'agentIdentities',
  'setCapabilities',
  // 🔴 **433's provider door, gated with the capability three and NOT because provider is a
  // capability.** ⛔ It is not one — no rail reads it (`419` §3) — and the gate is `createAgent`'s
  // argument instead: this verb configures an identity, and *"the human is unrestricted"* is a
  // statement about a human, so the channel has to declare one.
  'setAgentProvider',
  'setSpawningEnabled',
  // A person's services switch: which agents may run as services.
  'setServicesOn',
  // 🔴 **500's launch default, gated with the four above and on `setAgentProvider`'s argument.**
  // ⛔ It is not a capability either — no rail reads it — and what it decides is what the NEXT
  // conversation a person opens asks before acting. ⚑ `noPersonBehindIt`'s own sentence is true of
  // it without stretching: it changes what agents are allowed to do, one launch later.
  'setDefaultApprovalMode',
  // ⚑ A kept rule is removed from a file of the person's only on a person's press.
  'removeKeptRule',
  // 🔴 **419's creation door, gated with the capability three.** ⛔ This verb brings into existence
  // the thing every capability is a fact ABOUT, so the channel has to declare a person behind it.
  'decideMoveRequest',
  'createAgent',
  // 🔴 **516 · the registry's two writes, gated with the five above.** ⛔ **Not because a registry
  // row is a capability** — it is not, and it grants nobody — but because this door decides what an
  // agent may be GIVEN, and `noPersonBehindIt`'s own sentence is true of both directions: adding a
  // server is what makes a grant possible, and removing one takes a capability away from every
  // identity that held it.
  'registerExternalMcpServer',
  'removeExternalMcpServer',
  // 🔴 **558 · the rename and the removal, gated with the seven above** (`HO-063` gaps 1 and 2).
  // ⛔ The rename is `setAgentProvider`'s argument word for word: it configures an identity, and
  // *"the human is unrestricted"* is a statement about a human. ⚠️ The removal is the strongest
  // case on this list — an agent that could remove an identity could remove the one holding the
  // grant that refuses it.
  'setAgentDisplayName',
  'removeAgent',
  'archiveConversation',
  'restoreConversation',
  'checkDeleteConversation',
  'deleteConversation',
  // 🔴 **582 · the three doors onto the `configured` layer, gated with the nine above**
  // (`HO-063` gap 4, `HO-009` §2.2). ⛔ **The write and the decision are the strongest cases after
  // the removal**: what they write is what another agent is TOLD at every launch from now on, and
  // `a-person` is the authority this door records. ⚠️ **618 · this said *"`HO-009` §2.2 gives the
  // layer exactly three authorities"*** — `HO-078` §4 added `its-creator`, which reaches no door on
  // this wire at all, so the list below is unchanged and only the count was wrong. ⚠️ **The READ is on this list too, which is rarer** — an agent already receives
  // its own rules in its bundle, so the gate is not secrecy: this payload carries every ask made
  // against the identity and the verb lives on the window wire for the sheet that draws them.
  'instructAgent',
  'agentInstructions',
  'agentMethods',
  'agentMethodBody',
  'agentMethodChanges',
  'removeAgentMethod',
  'undoAgentMethod',
  'checkInterruptedAgentMethods',
  'agentOwnNotes',
  'agentOwnNotesUnread',
  'saveOwnNotes',
  'undoOwnNotes',
  'markOwnNotesSeen',
  'agentRulesUnread',
  'undoAgentRules',
  'markAgentRulesSeen',
  'decideInstruction',
  // Approving registers a server agents may then use.
  'decideMcpServerRequest',
  // 🔴 **625 · the two doors onto an agent's MEMORY** (`EXT-015` §3.3). ⛔ **The write is the only
  // authority this table has for that verb, and that is the ruling rather than a gate somebody
  // chose**: `identity_memory_amendment` carries no `wrote_it` column BECAUSE exactly one kind of
  // caller can reach it, and `A_PERSON_DID_THIS` is the sentence that says so. ⚠️ **The READ is
  // gated too** — it carries another agent's memory verbatim, and an agent reading one is not
  // something anybody has asked for.
  'agentMemory',
  'amendAgentMemory',
  'undoAgentMemory',
  'checkInterruptedMemory',
  // F093 · ⚑ **The agent-input popup's read, gated for `agentMemory`'s reason**: it carries an
  // agent's memory verbatim, and its own instructions.
  'whatThisAgentWasGiven',
  // F093 · C9 d · ⚑ **One message as the model got it, gated for the same reason**: it carries the
  // agent's own instructions, and each message as it was handed over.
  'whatTheModelGot',
  // 🔴 **677 · an identity's model and effort, and its read** (`R25`). ⛔ **The gate IS the ruling
  // here** — ⚑ D-042 · R2 moved its reason: the write sets the agent's DEFAULT, what its new
  // conversations start on (no longer a rail a give could not cross), and an agent reaching this
  // door could change any agent's; `create_agent` names only the default of the agent it makes.
  // ⚠️ The read is gated with the roster it sits beside — the sheet that draws it is a person's.
  'setAgentModelAndEffort',
  'agentModelAndEffort',
  // 🔴 **D-042 · R3 — the model list's three doors, gated with the two above** (`ipc.ts`'
  // `requireAPerson`). ⚠️ The list read is gated too: it carries the person's own models and last
  // pick, and only the person adds or deletes a model by hand.
  'modelList',
  'addHandAddedModel',
  'deleteHandAddedModel',
  // 🔒 **Only a person keeps or removes an API key** (`ipc.ts`' `requireAPerson`). ⚑ Whether one is
  // set is not gated: it is not the key.
  'setApiKey',
  'removeApiKey',
  // ⚑ …and only a person's press checks one, which asks the provider over the network.
  'checkApiKey',
  // 🔴 **D-016 · R4 · a person's rename of a piece a person gave**, gated on `setAgentDisplayName`'s
  // argument — `ipc.ts`' `requireAPerson`, with that rename as its precedent. ⛔ An agent names its
  // own work with `update_work`, whose rails are its own; no toolset carries this verb.
  'retitleWork',
  'takeBackWork',
])

const sinkFor = (kind: RuntimeCommandKind): RuntimeEventSink =>
  NEEDS_A_PERSON.has(kind) ? new WindowSink() : new RecordingSink()

/**
 * A host that records which method the boundary reached and answers nothing.
 *
 * ⚠️ **A Proxy rather than a hand-written double**, because the assertion this file needs is *"the
 * host was not touched"* — a stub with forty named methods would have to be kept in step with the
 * host to keep meaning that, and a method it had forgotten would read as "not touched".
 */
function recordingHost(closing: boolean): { host: RuntimeHost; touched: string[] } {
  const touched: string[] = []
  const host = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === 'closing') return closing
        if (typeof property !== 'string') return undefined
        // Takes no parameters and is called with several: JavaScript does not mind, and a signature
        // that listed them would be a claim about forty different call shapes.
        return (): undefined => {
          touched.push(property)
          return undefined
        }
      },
    },
  ) as RuntimeHost
  return { host, touched }
}

describe('the shutdown door (273)', () => {
  it('every sample is a command the real wire schema accepts', () => {
    // ⛔ The non-vacuity line for this whole file. A sample the schema rejects would be refused with
    // `invalid runtime command` in both directions, and every assertion below would pass over it.
    for (const kind of KINDS) {
      const parsed = runtimeCommandSchema.safeParse(SAMPLES[kind])
      expect(parsed.success, `${kind}: ${parsed.success ? '' : parsed.error.message}`).toBe(true)
    }
  })

  it('the samples cover exactly the kinds the wire declares — no more, no fewer', () => {
    /** Walk the union, descending into the nested one `readChildWork` is built from. */
    const kindsIn = (schema: unknown): string[] => {
      const options = (schema as { options?: unknown[] }).options
      if (!Array.isArray(options)) return []
      return options.flatMap((option) => {
        const shape = (option as { shape?: Record<string, { value?: unknown }> }).shape
        const literal = shape?.kind?.value
        return typeof literal === 'string' ? [literal] : kindsIn(option)
      })
    }
    const onTheWire = [...new Set(kindsIn(runtimeCommandSchema))].sort()
    // ⚑ The sample table is `Record<RuntimeCommandKind, …>`, so this pins the TYPE against the
    // SCHEMA as well: a command in one and not the other fails here rather than at a user.
    expect(onTheWire).toEqual([...KINDS].sort())
    // Said out loud, because a comparison of two empty arrays is also `toEqual`.
    expect(onTheWire.length).toBeGreaterThan(30)
  })

  it('changes nothing at all while the app is running', async () => {
    // ⛔ The paired positive. Without it, "refused during a quit" would be satisfied by a boundary
    // that refused everything always.
    for (const kind of KINDS) {
      const { host, touched } = recordingHost(false)
      await executeRuntimeCommand(host, sinkFor(kind), SAMPLES[kind])
      expect(touched, `${kind} did not reach the host`).not.toEqual([])
    }
  })

  it('refuses every database-reaching command once a quit has begun, and asks the host nothing', async () => {
    for (const kind of KINDS) {
      if (ANSWERED_DURING_A_QUIT.has(kind)) continue
      const { host, touched } = recordingHost(true)
      await expect(executeRuntimeCommand(host, new RecordingSink(), SAMPLES[kind])).rejects.toThrow(
        refusedDuringAQuit(kind),
      )
      // 273 §1: *"A try/catch around the query is not the fix — it hides the call instead of
      // stopping it."* So the host is not asked, at all, and that is what is asserted.
      expect(touched, `${kind} reached the host during a quit`).toEqual([])
    }
  })

  it('still answers the nine that touch no database, or refuse themselves better', async () => {
    for (const kind of ANSWERED_DURING_A_QUIT) {
      const { host, touched } = recordingHost(true)
      await executeRuntimeCommand(host, new RecordingSink(), SAMPLES[kind])
      expect(touched, `${kind} was refused at the door`).not.toEqual([])
    }
  })

  it('refuses the exact pair 272 measured, by name', async () => {
    // The two in the finding, spelled out rather than left to the loops above — a regression that
    // exempted only these would otherwise fail in a sentence nobody could connect back to `272`.
    for (const kind of ['listResumable', 'listUnresumable'] as const) {
      const { host } = recordingHost(true)
      await expect(executeRuntimeCommand(host, new RecordingSink(), { kind })).rejects.toThrow(
        `BroCrew is shutting down, so ${kind} was not asked of its database`,
      )
    }
  })

  it('an unparseable command is still told it is unparseable, quit or no quit', async () => {
    // ⚠️ The door is AFTER the parse deliberately: there is no kind to rule on until the wire has
    // been checked, and "we are shutting down" is a worse answer than "that is not a command".
    const { host } = recordingHost(true)
    await expect(
      executeRuntimeCommand(host, new RecordingSink(), { kind: 'nonsense' }),
    ).rejects.toThrow(/invalid runtime command/)
  })

  it('the refusal is in the same family as every other shutdown sentence', () => {
    // 070/098/100/202 all say "BroCrew is shutting down, so …". A refusal that broke the pattern
    // would read as a different kind of failure in the one place they are all read together: a log.
    for (const kind of KINDS) {
      expect(refusedDuringAQuit(kind)).toMatch(/^BroCrew is shutting down, so /)
      expect(refusedDuringAQuit(kind)).toContain(kind)
    }
  })
})

describe('when the door shuts (273 §1)', () => {
  let userData: string
  let host: RuntimeHost

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-door-'))
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => 'sess_door',
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: `${provider} config model`,
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  it('is open until a quit, and shut before closeAll awaits anything', async () => {
    expect(host.closing).toBe(false)
    const closing = host.closeAll()
    // ⛔ **Not `await`ed first, and that is the assertion.** `closeAdmission()` is `closeAll`'s
    // opening statement, so the door is shut synchronously — a whole ordered step before
    // `close its database`. A door that shut anywhere later would leave exactly the race `272`
    // reported, and this line is the only thing that can tell the two apart.
    expect(host.closing).toBe(true)
    await closing
    expect(host.closing).toBe(true)
  })
})

describe('the closing announcement has more than one reader (273 §2)', () => {
  const renderer = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/src')
  const read = (path: string): string => readFileSync(join(renderer, path), 'utf8')

  it('both closed-conversation lists stop asking once the app is closing', () => {
    // ⛔ **The half that makes an ordinary quit SILENT**, which the door alone cannot do: Electron
    // `console.error`s every rejected `ipcMain.handle` with a stack, so a refused refresh still
    // prints. These are the two surfaces `RuntimeScreen`'s open-list watcher drives, and they are
    // the two commands `272` caught.
    for (const component of ['components/SideRail.vue', 'components/ResumableSessions.vue']) {
      const source = read(component)
      expect(source, `${component} does not read the closing flag`).toContain(
        "from '../lib/app-closing'",
      )
      expect(source, `${component} does not return early`).toMatch(
        /if \(appClosing\.value\) return/,
      )
      // ⛔ **BEFORE the ask, not after it**, which is the whole of the guard. Checked as an ordering
      // over the source rather than as a pattern, because a guard written under the `await` matches
      // every regex above and stops nothing at all.
      expect(source.indexOf('if (appClosing.value) return')).toBeLessThan(
        source.indexOf('window.api.runtime.listResumable()'),
      )
      expect(source.indexOf('window.api.runtime.listResumable()')).toBeGreaterThan(-1)
    }
  })

  it('the flag is still a REF, so a template unwraps it rather than testing an object', () => {
    // ⛔ **The one thing a source scan cannot see, and the failure would be silent and total.**
    // `v-if="appClosing"` reads through Vue's `proxyRefs`, which unwraps a ref and hands anything
    // else straight to the truthiness test — so a `readonly()` that returned a plain proxy would
    // make the shade appear the moment the app started and never come off. `isRef` is exactly the
    // predicate that unwrapping turns on.
    expect(isRef(appClosing)).toBe(true)
    expect(unref(appClosing)).toBe(false)
  })

  it('the flag is set only by the announcement, and never cleared', () => {
    const module = read('lib/app-closing.ts')
    // Exported readonly, so no surface can put this window into a state main is not in.
    expect(module).toContain('export const appClosing = readonly(closing)')
    // ⚑ One writer, and it only ever writes `true` — a quit that has begun cannot be cancelled.
    expect(module.match(/closing\.value = /g)).toEqual(['closing.value = '])
    expect(module).toContain('closing.value = true')
    // And the one subscriber is still `App.vue`, which is where 271 put it.
    expect(read('App.vue')).toContain('watchClosing(beginClosing)')
  })
})
