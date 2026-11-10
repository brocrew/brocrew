import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import { createAgentStore } from '../src/renderer/src/lib/agent-store'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import { DEFAULT_CAPABILITIES, type CapabilityGrant } from '../src/shared/capabilities'
import { NOT_THE_WIRE, asTheWireWouldCarry, everythingOverTheWire } from './lib/the-wire'
import type { AgentIdentities, RuntimeBridge, RuntimeCommandKind } from '../src/shared/runtime-ipc'
import { storageBridge } from '../src/preload/storage'
import { STORAGE_CHANNELS } from '../src/shared/storage'

/**
 * # 🔴 The bridge that clones nothing (361)
 *
 * Reactive payloads crossed the bridge in library filters, attachments, capability grants
 * and provider sign-in cancellation. Every renderer-to-main verb is checked below.
 *
 * ## ⚑ What is asserted here, and what is asserted where it can be
 *
 *  - **§1** the walk can fail, and it fails where it says it does — the plant-and-find half.
 *  - **§2** every renderer→main verb, enumerated BY THE COMPILER, with how its payload is built.
 *  - **§3** the exempt roster is derived from the preload's own source, not written down.
 *  - **§4** the DOM project really runs the wire — a guard nothing registers is dark.
 *  - **§5** the node-side double refuses a payload the wire refuses, and still carries a listener.
 *
 * ⚠️ **The gesture itself is in `test/dom/the-bridge-that-clones-nothing.dom.test.ts`**, because
 * pressing Cancel on a running sign-in needs a component, a click and a real reactive `ref` — none
 * of which this project has.
 */

const HERE = dirname(fileURLToPath(import.meta.url))
const source = (relative: string): string => readFileSync(join(HERE, '..', relative), 'utf8')

/* ------------------------------------------------------------- §1 · the walk, planted and found */

describe('§1 · the clone can fail, and it says where (361 §2)', () => {
  it('⚑ carries a plain payload — and hands back a COPY, the way the far side of a wire holds one', () => {
    const payload = { sessionId: 's1', text: 'hello', attachments: [{ path: '/a', kind: 'file' }] }
    const carried = asTheWireWouldCarry('send', payload)
    expect(carried).toEqual(payload)
    // ⛔ The half that says this is a WIRE and not a passthrough. A double that returned the
    // original would still let a test observe a mutation the shipped app can never see.
    expect(carried).not.toBe(payload)
    expect(carried.attachments[0]).not.toBe(payload.attachments[0])
  })

  /**
   * ⛔ **Every one of these is a shape a renderer really produces**, and each is paired below with
   * the plain twin it is one fact away from — `355`'s rule, because an assertion that only ever
   * sees the refusable shape is measuring the thrower rather than the payload.
   */
  const REFUSED = [
    ['a reactive object', () => reactive({ provider: 'codex', profileId: 'work' })],
    ['a `ref` holding an object, read through `.value`', () => ref({ provider: 'codex' }).value],
    ['a `ref` holding an array, read through `.value`', () => ref(['worker']).value],
    ['a member of a `reactive(new Map())`', () => reactive(new Map([['k', { a: 1 }]])).get('k')],
    ['a proxy nested one level down', () => ({ grant: reactive({ canMessage: 'any' }) })],
    ['a proxy inside an array', () => ({ attachments: [reactive({ path: '/a' })] })],
    ['a function', () => ({ onDone: (): void => {} })],
  ] as const

  it.each(REFUSED)('🔴 refuses %s', (_what, build) => {
    expect(() => asTheWireWouldCarry('setCapabilities', build())).toThrow(
      /would not survive ipcRenderer\.invoke/,
    )
  })

  /**
   * ⚑ **The paired positive, and it is the same seven shapes with the reactivity taken off.** Six of
   * the seven are literally the same fields; the function's twin is the value a listener would be
   * replaced by. Without this, `REFUSED` would pass just as well against a wire that refused
   * everything — which is the guard-waves-nothing-through direction, and it is just as dead.
   */
  const CARRIED = [
    ['a plain object', () => ({ provider: 'codex', profileId: 'work' })],
    ['a copy of what a `ref` holds', () => ({ ...ref({ provider: 'codex' }).value })],
    ['a copy of an array a `ref` holds', () => [...ref(['worker']).value]],
    ['a copy of a map member', () => ({ ...reactive(new Map([['k', { a: 1 }]])).get('k') })],
    ['a plain value one level down', () => ({ grant: { canMessage: 'any' } })],
    ['plain members of an array', () => ({ attachments: [{ path: '/a' }] })],
    ['no function at all', () => ({ onDone: 'done' })],
  ] as const

  it.each(CARRIED)('⚑ carries %s', (_what, build) => {
    expect(() => asTheWireWouldCarry('setCapabilities', build())).not.toThrow()
  })

  it('⚠️ names a `ref` as a `ref`, because the fix for one is not the fix for the other', () => {
    // ⛔ A live branch, not decoration: `ref({ … })` is itself unclonable — measured — so a payload
    // that forgot the `.value` reaches this and would otherwise be reported as an anonymous object.
    let said = ''
    try {
      asTheWireWouldCarry('setSessionSetting', { body: ref({ kind: 'model' }) })
    } catch (error) {
      said = error instanceof Error ? error.message : String(error)
    }
    expect(said).toContain('body is a Vue `ref`')
  })

  it('⛔ names WHERE it broke, so the failure is a diagnosis and not a category', () => {
    let said = ''
    try {
      // ⚑ `218`'s shape: the second attachment is the proxy, so the path must carry its index.
      asTheWireWouldCarry('startAndSend', {
        sessionId: 's1',
        attachments: [{ path: '/a' }, reactive({ path: '/b' })],
      })
    } catch (error) {
      said = error instanceof Error ? error.message : String(error)
    }
    expect(said).toContain('attachments[1]')
    expect(said).toContain('Vue reactive Proxy')
    // ⚠️ The label the caller passed is in the sentence too — a failure that does not name the verb
    // sends the reader to look for a proxy in every call the test made.
    expect(said).toContain('startAndSend')
  })

  /**
   * ⛔ **The cycle is the FIRST key, and that ordering is the whole test.** Written the other way
   * round — `{ onDone, self }` — the walk finds the function at the first child and returns before
   * it ever reaches the loop, so the guard is a line no mutation can make red. ⚑ Measured: with
   * `seen` disabled, this fixture recurses until the stack goes and the `RangeError` replaces the
   * refusal; the same fixture with the keys swapped stays green with the guard deleted.
   *
   * ⚠️ A pure cycle CLONES FINE — `structuredClone` supports one — so the function is what makes
   * the walk run at all, and the cycle is what it has to survive on the way to naming it.
   */
  it('⛔ the walk survives a cycle rather than replacing the diagnosis with its own stack overflow', () => {
    const loop: Record<string, unknown> = {}
    loop.self = loop
    loop.onDone = (): void => {}
    expect(Object.keys(loop)).toEqual(['self', 'onDone'])
    expect(() => asTheWireWouldCarry('send', loop)).toThrow(/would not survive/)
  })
})

/**
 * 🔴 **Where a `handed-over` payload is actually BUILT** (473, from `469` F3).
 *
 * ⛔ **The row above says which DOOR a value goes through; this says who made the value.** `469`
 * found the difference the expensive way: `respondPermission` was classified `handed-over` and its
 * note named `PermissionCard.toDecision`, which was right about that producer and silent about the
 * second one — `attention.ts`' `answerFor`, reached from Home and from the person's queue, handing
 * over an object a deep `ref` had turned into a `Proxy`. ⚠️ *"That is why a known class of bridge
 * defect still passed the census."*
 *
 * ⚑ **A payload census must read CALL SITES, not types** — two questions, and the table had only
 * ever asked one of them.
 */
interface Producer {
  /** The file it is built in, relative to `apps/desktop/`. */
  at: string
  /** The construction as that file really writes it — asserted over prose-stripped source. */
  builds: string
}

/**
 * ⛔ **A `handed-over` verb cannot be written down without its producers**, which is the half `469`
 * asked for: the note is prose and this is a list the source has to agree with.
 */
type VerbRow =
  | { how: 'nothing' | 'plain-by-construction'; note?: string }
  | { how: 'handed-over'; note: string; producers: readonly Producer[] }

/**
 * 🔴 **`361` §1's answer, and the compiler is what keeps it complete.**
 *
 * ⛔ **`Record<RuntimeCommandKind, …>` — a verb added to the union with no row here is a COMPILE
 * ERROR**, which is the only form of enumeration this dispatch would accept: *"my counts of the N
 * places that do X have been short every single time"*, and `grep -rn` prints nothing at all for
 * `whole-session-reads.test.ts`, so a grep census over this tree is short by at least one file
 * before it starts.
 *
 * ⚠️ **The classification is about the CALL SITE, not the type.** `cancelProviderSignIn` takes
 * `{ provider, profileId? }` — two strings, no nested object anywhere in its declared shape — and it
 * is the one that threw, because what was handed over was the whole payload: a `ref` holding those
 * two strings is still a `Proxy`. ⛔ **A type-shaped census would have cleared the defect.**
 */
/** ⚑ The line in `CapabilitiesSheet.grant()` that builds each field of the grant. */
const THE_SHEETS_GRANT = '[field.key, set[field.key] === true ? value[field.key] : null]'

const HOW_EACH_VERB_IS_BUILT: Record<RuntimeCommandKind, VerbRow> = {
  skills: {
    how: 'handed-over',
    note: 'Settings builds list and toggle requests from primitive fields; the agent book builds a profile metadata request from a primitive profile and offset. None hands over a reactive skill object. The DOM controls exercise structured clone before each fake reply.',
    producers: [
      {
        at: 'src/renderer/src/components/SkillsSection.vue',
        builds: "callSkills()({ operation: 'shared-list' })",
      },
      {
        at: 'src/renderer/src/components/SkillsSection.vue',
        builds:
          "operation: 'shared-toggle',\n      folder: skill.folder,\n      enabled: !skill.enabled,",
      },
      {
        at: 'src/renderer/src/components/ProfileSkills.vue',
        builds: "operation: 'profile-list',\n      profileId: profile,",
      },
    ],
  },
  // ── the launcher and the conversation ────────────────────────────────────────────────────────
  createSession: { how: 'plain-by-construction' },
  send: { how: 'plain-by-construction' },
  sendInterrupting: { how: 'plain-by-construction' },
  queueMessage: { how: 'plain-by-construction' },
  cancelQueuedMessage: { how: 'plain-by-construction' },
  takeBackAndStop: { how: 'plain-by-construction' },
  interrupt: { how: 'plain-by-construction' },
  stopBackgroundWork: { how: 'plain-by-construction' },
  close: { how: 'plain-by-construction' },
  refreshConfig: { how: 'plain-by-construction' },
  setApprovalMode: { how: 'plain-by-construction' },
  endPlanMode: { how: 'plain-by-construction' },
  resume: { how: 'plain-by-construction' },
  // ⚑ **D-017b · `resume`'s row**: `store.look` writes `{ sessionId, claim }` itself — a string and a
  // boolean, nothing nested.
  look: { how: 'plain-by-construction' },
  stopLooking: { how: 'plain-by-construction' },
  // 🔴 **735 · `send`'s row, because it carries `send`'s fields** — the preload writes
  // `{ kind, ...input }` itself; `sessionId`, `text` and `launchKey` are strings, and `attachments`
  // is the array `send` carries. ⚑ **737 · its call site is `store.startAndSend`** (⚑ D-017b: a
  // send from the full view of a conversation this window does not run), which sends
  // `overTheWire`'s copy of the attachments, as `store.send` does — never the composer's own array,
  // a `Proxy` over staged paths (`735` F-5).
  startAndSend: { how: 'plain-by-construction' },
  cancelLaunch: { how: 'plain-by-construction' },
  attachOpen: { how: 'nothing' },
  claim: { how: 'plain-by-construction' },
  release: { how: 'plain-by-construction' },
  // ⛔ **398 · `nothing`, and both halves of `363`'s question are answered by the same fact.** The
  // command is `{ kind: 'questionsForAPerson' }` and carries no payload at all: the call site builds
  // the whole literal, and there is no field it did not build because there are no fields. ⚠️ **Not
  // `plain-by-construction`**, which is the answer that would compile — that word claims a payload
  // exists and is primitive, and here the honest statement is that none crosses.
  questionsForAPerson: { how: 'nothing' },
  // ⛔ **403 · `nothing`, its neighbour's answer for its neighbour's reason.** The command is
  // `{ kind: 'decisionsForAPerson' }` and carries no payload at all — the call site builds the
  // whole literal, and there is no field it did not build because there are no fields.
  decisionsForAPerson: { how: 'nothing' },
  // ⛔ **533 · its third sibling, and the same answer**: `{ kind: 'limitsForAPerson' }` carries no
  // payload at all, so the call site builds the whole object literal and there is nothing to clone.
  // ⚠️ **Not `plain-by-construction`**, which is the answer that would compile: that word claims a
  // payload exists and is primitive, and here the honest statement is that none crosses.
  limitsForAPerson: { how: 'nothing' },
  readLimitsDisplay: { how: 'nothing' },
  // ⛔ **557 · its fourth sibling, and the same answer**: `{ kind: 'stalledWorkForAPerson' }` carries
  // no payload at all, so the call site builds the whole object literal and there is nothing to
  // clone. ⚠️ **Not `plain-by-construction`**, for `limitsForAPerson`'s stated reason: that word
  // claims a payload exists and is primitive, and here none crosses.
  stalledWorkForAPerson: { how: 'nothing' },
  // Work whose holder stopped with it: `{ kind: 'stoppedWorkForAPerson' }` carries no payload either.
  stoppedWorkForAPerson: { how: 'nothing' },
  // This run's publisher and the stamped queue: `{ kind }` alone, no payload either.
  currentEpoch: { how: 'nothing' },
  personsQueue: { how: 'nothing' },
  listConversations: { how: 'nothing' },
  // Open work no other list shows: `{ kind: 'workIncidentsForAPerson' }` carries no payload either.
  workIncidentsForAPerson: { how: 'nothing' },
  // ⛔ **F097 · its sixth sibling, and the same answer**: the preload writes
  // `{ kind: 'waitingOnWhoWroteForAPerson' }` and nothing else, so the call site builds the whole
  // object literal and there is nothing to clone.
  waitingOnWhoWroteForAPerson: { how: 'nothing' },
  // ⛔ **D-017 · R19 · its fifth sibling, and the same answer**: the preload writes
  // `{ kind: 'instructionAsksForAPerson' }` and nothing else, so the call site builds the whole
  // object literal and there is nothing to clone. ⚠️ **Not `plain-by-construction`**, for
  // `limitsForAPerson`'s stated reason: that word claims a payload exists, and here none crosses.
  instructionAsksForAPerson: { how: 'nothing' },
  // The agents' requests to register an MCP server: `{ kind }` and nothing else, the same answer.
  mcpServerRequestsForAPerson: { how: 'nothing' },
  // ⛔ **567 · `nothing`, and it is the cleanest case in this table**: `{ kind: 'readWorkspace' }`
  // has no field at all beyond the discriminant, so there is nothing for the call site to build and
  // nothing for it to hand over.
  readWorkspace: { how: 'nothing' },
  // ⛔ **575 · its sixth sibling, and the same answer for a reason of its own**:
  // `{ kind: 'whatIsBeingDone' }` has no field at all because the answer is the WHOLE population
  // this app is running — a set the caller named would have been an array, which is both a payload
  // to clone and a bound somebody owes. ⚑ Neither exists, so there is nothing to build and nothing
  // to hand over.
  whatIsBeingDone: { how: 'nothing' },
  // ⛔ **621 · its seventh sibling, and the same answer for the same reason**:
  // `{ kind: 'whatEachConversationIsWaitingOn' }` has no field at all because the answer is the
  // WHOLE population this app is running. ⚑ Nothing to build and nothing to hand over.
  whatEachConversationIsWaitingOn: { how: 'nothing' },
  // ⚑ **637 · `{ kind: 'theWholeForest' }` carries no field at all**, for its neighbour's reason:
  // the answer is rooted at the person and the BOUND is a constant rather than a page a caller
  // chooses — so there is nothing for a call site to build or to hand over.
  theWholeForest: { how: 'nothing' },
  // ⚑ **D-018 · `{ kind: 'processMemory' }` carries no field at all**, for `whatIsBeingDone`'s
  // reason: the answer is every conversation this app is running.
  processMemory: { how: 'nothing' },
  // ⚑ **438 · `plain-by-construction`, and BOTH halves of `363`'s question answered.** The call
  // site builds the outer literal — `{ kind: 'digest', from, to }` — and the two fields it did
  // not build are numbers. ⛔ A window is two primitives, which is why this lands in the first
  // number and not in `nothing` beside its two neighbours.
  digest: { how: 'plain-by-construction' },
  // The preload writes a fresh outer packet and reads only the numeric from/to fields;
  // it carries primitives, with no caller-built object or extra field crossing the bridge.
  recentActivity: { how: 'plain-by-construction' },
  /**
   * ⚑ **508 · `plain-by-construction`, and both halves of `363`'s question answered.** The call
   * site builds the outer literal — `{ kind: 'workGivenBy', sessionId }` (`tasksAssignedBy` until
   * D-016) — and the one field
   * it did not build is a session id, a string however it was read. ⛔ Not `nothing`: it has a
   * field, unlike its queue neighbours, which is the distinction this row records.
   */
  workGivenBy: { how: 'plain-by-construction' },
  /**
   * ⚑ **543 · `plain-by-construction`, and both halves of `363`'s question answered.** The call
   * site — `preload/index.ts` — writes the outer literal itself (`{ kind: 'whoCalledWhom',
   * sessionId }`), and the one field it did not build is a `string`. ⛔ **`plain-by-construction` is
   * the wrong answer that compiles**, so both halves are stated rather than the label assumed: the
   * ANSWER is an object of objects, and this row is about the payload that goes OUT.
   */
  whoCalledWhom: { how: 'plain-by-construction' },
  // ── the six the call site does not build ─────────────────────────────────────────────────────
  respondPermission: {
    how: 'handed-over',
    note:
      '🔴 THE VERB `469` FOUND, and this note is why the census missed it. It used to read ' +
      '“`decision` comes from `PermissionCard.toDecision(outcome)`, an object literal” — true of ' +
      'that producer and silent about the SECOND one. `attention.ts`’ `answerFor` returned ' +
      '`decision.decision`, the nested object, and the person’s queue keeps its world in a deep ' +
      '`ref`: pressing Deny on a spawned child rejected at the bridge, wrote no `user_decision`, ' +
      'and left the provider on `waiting_permission` under a card that read settled. ⛔ Since ' +
      '`473` there is ONE construction — `permissionDecisionFor` — and both surfaces call it. ⚑ ' +
      'The one field that could hold an object, `updatedInput`, is never set from either.',
    producers: [
      { at: 'src/renderer/src/lib/permission-offer.ts', builds: "case 'allow_for_session':" },
      {
        at: 'src/renderer/src/components/PermissionCard.vue',
        builds: 'permissionDecisionFor(outcome)',
      },
      {
        at: 'src/renderer/src/lib/attention.ts',
        builds: 'permissionDecisionFor(decision.decision.outcome)',
      },
    ],
  },
  resolveLink: { how: 'plain-by-construction' },
  decideMoveRequest: { how: 'plain-by-construction' },
  // A person's answer to a to-do: two strings, a boolean and a note, written by the preload.
  answerAction: { how: 'plain-by-construction' },
  respondUserInput: {
    how: 'handed-over',
    note:
      '`response.answers` is built by `UserInputCard.answer()` on `Object.create(null)`, and each ' +
      'value comes out of `chosen()`, which returns `value.filter(…)` — a FRESH plain array, even ' +
      'when the draft holding it is a `reactive(new Map())`. Measured, not assumed. ⚠️ **And it ' +
      'has a second producer too** (473): `answerFor`’s three user-input arms, reached from the ' +
      "overview and the person’s queue. Two of them are closed literals — `{kind:'reject'}` and " +
      "`{kind:'answer', answers:{}}` — and the third keys a STRING by a STRING " +
      '(`questionId`/`option`), so none of the three can carry an object. That is why this verb ' +
      'survived what `respondPermission` did not, and exactly why the row has to name both ' +
      'producers rather than the one somebody happened to look at.',
    producers: [
      {
        at: 'src/renderer/src/components/UserInputCard.vue',
        builds: "emit('respond', props.item.request.id, { kind: 'answer', answers: payload })",
      },
      {
        at: 'src/renderer/src/lib/attention.ts',
        builds:
          "return { userInput: { kind: 'answer', answers: { [decision.questionId]: decision.option } } }",
      },
    ],
  },
  setSessionSetting: {
    how: 'handed-over',
    note:
      '`body` is one of three object literals over primitives: the model and the effort built by ' +
      "`pickInAConversation` from the picker's pick (UI-012), and plan mode built by " +
      '`useConversationControls` for the agent card and relayed unchanged through `SessionPanel` → ' +
      '`SessionDrawer`/`ConversationPane`.',
    producers: [
      {
        at: 'src/renderer/src/composables/useConversationControls.ts',
        builds: "sources.setSessionSetting({ kind: 'planMode', on: true })",
      },
      {
        at: 'src/renderer/src/lib/model-lists.ts',
        builds: "{ kind: 'model', value: pick.model }",
      },
      {
        at: 'src/renderer/src/lib/model-lists.ts',
        builds: "{ kind: 'reasoningEffort', value: pick.effort }",
      },
    ],
  },
  cancelProviderSignIn: {
    how: 'handed-over',
    note:
      '🔴 THE DEFECT. `authFor` is a `ref` holding an object, so `authFor.value` is a Proxy and ' +
      'every cancel of a sign-in that was really running threw at the bridge. The `?? { provider }' +
      '` fallback is a literal, so cancelling with nothing in flight worked — which is why it ' +
      'never looked like a bridge fault. Fixed in the shared sign-in gesture: every payload it sends ' +
      'is rebuilt field by field by its `literal`, the running pair included.',
    producers: [
      {
        at: 'src/renderer/src/lib/sign-in-gesture.ts',
        builds: 'provider: pair.provider,\n    profileId: pair.profileId,',
      },
    ],
  },
  setCapabilities: {
    how: 'handed-over',
    note:
      '🔴 THE VERB `355` FIXED, and `plain-by-construction` here would re-open the hole it closed. ' +
      '`agentStore.save` writes the wrapper `{ profileId, grant }` itself, but `grant` ' +
      'is handed in whole: `CapabilitiesSheet.grant()` builds a FRESH object with ' +
      '`Object.fromEntries`, each field `value[field.key]` read out of a `reactive({})`, or ' +
      '`null`. ⚑ Every capability value is a number or a word, so what it reads out is a ' +
      'primitive. ⛔ Handing the reactive itself, or a field whose value is an array or an ' +
      'object, crosses as a Proxy and throws at the bridge. ⚑ Measured rather than read: §7 ' +
      'drives the store over a wire, with the proxy planted back.',
    producers: [
      {
        at: 'src/renderer/src/components/CapabilitiesSheet.vue',
        builds: THE_SHEETS_GRANT,
      },
    ],
  },
  revealPath: {
    how: 'handed-over',
    note:
      '⚑ THE VERB `356` ADDED, and `plain-by-construction` here is the wrong answer that compiles ' +
      '(365). `session-store.revealPath` writes the wrapper `{ sessionId, target }` itself — but ' +
      '`target` is a `SessionPathTarget`, an OBJECT handed in whole, which is the half ' +
      '`setCapabilities` fails. All four producers are literals written at the press: `{ of: ' +
      "'cwd' }`, `{ of: 'home' }` and `{ of: 'config-file', name: file.name }` in `SessionInfo`, " +
      "and `{ of: 'instruction-source', index }` in `SessionInstructions`. 🔴 A proxy here would " +
      'be SILENT rather than loud — the store catches and answers `no-path`, which the panel ' +
      'renders as *this conversation does not report that file*. ⚑ Measured in §8, planted.',
    producers: [
      { at: 'src/renderer/src/components/SessionInfo.vue', builds: "reveal('cwd', { of: 'cwd' })" },
      {
        at: 'src/renderer/src/components/SessionInfo.vue',
        builds: "reveal('home', { of: 'home' })",
      },
      {
        at: 'src/renderer/src/components/SessionInfo.vue',
        builds: "{ of: 'config-file', name: file.name }",
      },
      {
        at: 'src/renderer/src/components/SessionInstructions.vue',
        builds: "ask({ of: 'instruction-source', index })",
      },
    ],
  },
  // ── the library, the history and the reads ───────────────────────────────────────────────────
  listResumable: { how: 'nothing' },
  listUnresumable: { how: 'nothing' },
  adoptSessions: { how: 'nothing' },
  exportSession: { how: 'plain-by-construction' },
  importBundleFile: { how: 'plain-by-construction' },
  listLibrary: { how: 'plain-by-construction' },
  importRecordedSession: { how: 'plain-by-construction' },
  importUserHomeSession: { how: 'plain-by-construction' },
  rebuildLedger: { how: 'plain-by-construction' },
  readWorkflowOutput: { how: 'plain-by-construction' },
  // ⛔ **`356` deliberately made this an INDEX and not a path**, following its two neighbours:
  // `workflow-output.ts` says *"the renderer never supplies a path"* and keys on a task id, and
  // `child-work.ts` keys on the agent. So the payload is `{ sessionId, index }` — a string and a
  // NUMBER, and a number is a number however it was read. ⚑ §8 drives that rather than claiming it.
  readInstructionSource: { how: 'plain-by-construction' },
  // ⛔ **733 · `plain-by-construction` on both halves**: `session-store.ts` writes the literal
  // `{ sessionId, name }` itself, and both are strings — the name is the one `ProviderConfigFile`
  // gave the row. Nothing nested crosses.
  readConfigFile: { how: 'plain-by-construction' },
  readCommandOutput: { how: 'plain-by-construction' },
  // ⛔ **`plain-by-construction` on both halves** (462): `session-store.ts` writes the literal
  // `{ sessionId, toolCallId }` itself, and both fields are strings however they were read — the
  // call id comes off a transcript row this window rendered. ⚑ Nothing nested crosses in either
  // direction; what comes BACK is a `ToolAnswer`, and a result is not this table's question.
  readToolAnswer: { how: 'plain-by-construction' },
  // ⛔ **`plain-by-construction`, and BOTH halves of standing rule 2 are easy here** (510):
  // `session-store.ts` writes the literal `{ resourceId }` itself (`readCanonicalDocument`'s
  // `{ documentId }` until D-016), and the one field it did not build is a string — the id a
  // transcript row already rendered. ⚑ There is nothing nested in
  // either direction for a `ref` to hide in, which is the failure `cancelProviderSignIn` was.
  readResource: { how: 'plain-by-construction' },
  searchWork: {
    how: 'handed-over',
    note: 'SessionWork hands over the successful strict-schema parse, which creates a fresh query record containing only primitive fields.',
    producers: [
      {
        at: 'src/renderer/src/components/SessionWork.vue',
        builds: 'const parsed = workSearchQuery.safeParse(query)',
      },
    ],
  },
  // ⚑ **D-032 · `plain-by-construction`, both**: the preload writes `{ kind, resourceId }` itself,
  // and the id is a string. ⚠️ What comes BACK carries bytes, and a result is not this table's question.
  drawResource: { how: 'plain-by-construction' },
  revealResource: { how: 'plain-by-construction' },
  // The preload writes each literal itself, copying the texts.
  resolveMessagePaths: { how: 'plain-by-construction' },
  openMessagePath: { how: 'plain-by-construction' },
  revealMessagePath: { how: 'plain-by-construction' },
  // ⚑ **D-026 · `plain-by-construction`**, `whoCalledWhom`'s reading: the preload writes the outer
  // literal `{ kind: 'filesKept', ...input }` itself, and every field of every scope is a string.
  filesKept: { how: 'plain-by-construction' },
  filesLibrary: { how: 'plain-by-construction' },
  teamProfileGraph: { how: 'plain-by-construction' },
  readChildWork: { how: 'plain-by-construction' },
  readChildState: { how: 'plain-by-construction' },
  sendToChild: { how: 'plain-by-construction' },
  earlierHistory: { how: 'plain-by-construction' },
  latestHistory: { how: 'plain-by-construction' },
  // ── what the app can run, and where ──────────────────────────────────────────────────────────
  capabilities: { how: 'nothing' },
  providerConnections: { how: 'nothing' },
  profiles: { how: 'nothing' },
  checkProviderAuth: { how: 'plain-by-construction' },
  reprovisionProviderHomes: { how: 'plain-by-construction' },
  reprovisionProviderAuth: { how: 'plain-by-construction' },
  signInProvider: { how: 'plain-by-construction' },
  checkCwd: { how: 'plain-by-construction' },
  // 419. ⛔ **`plain-by-construction`, and it earns the label on BOTH halves** (363, 365): the
  // preload builds the outer literal itself (`{ kind, ...input }`), and every field it did not build
  // — `slug`, `displayName`, `provider` — is a `string | null`. ⚠️ A fourth field of some other kind
  // would make it `handed-over`, and the label is what somebody has to look at to notice.
  createAgent: { how: 'plain-by-construction' },
  // ⚑ **516 · the registry's two writes** (HO-040 §4.2). ⛔ **`plain-by-construction`, and they earn
  // the label on BOTH halves** (363, 365): the preload builds the outer literal itself
  // (`{ kind, ...input }`), and every field it did not build — `name`, `url`, `serverId` — is a
  // string however it was read. ⚠️ **`createAgent` above is the shape, not `setCapabilities`**: what
  // makes a row `handed-over` is a field somebody ELSE made, and three strings are not one. ⛔ **Not
  // `nothing` either** — both carry a payload, unlike the queue verbs.
  //
  // 🔴 **And `registerExternalMcpServer` is the one verb in this table that opens a SOCKET.** That
  // is orthogonal to what this table classifies — it asks how the PAYLOAD is built — and it is
  // named here because a reader scanning for *which verbs are cheap* would otherwise have nothing
  // telling them this one waits on a stranger's answer.
  registerExternalMcpServer: { how: 'plain-by-construction' },
  removeExternalMcpServer: { how: 'plain-by-construction' },
  // ── who may spawn whom (355) ─────────────────────────────────────────────────────────────────
  // 🔴 **`agentIdentities` MOVED from `plain-by-construction` to `nothing` in 369**, and the move is
  // the row doing its job: it carried a project slug, an identity is global, and the field is gone —
  // taking the verb's only argument with it, so the call now passes nothing at all.
  // ⛔ A payload with no fields cannot carry a proxy at all, which is a stronger statement than the
  // one it replaces — and §7 asserts the empty object arrives rather than trusting this line.
  agentIdentities: { how: 'nothing' },
  // 433. ⛔ **`plain-by-construction`, and it earns the label on BOTH halves** (363, 365): the
  // preload builds the outer literal itself (`{ kind, ...input }`), and every field it did not build
  // — `profileId`, `provider` — is a `string | null`. ⚑ It is `setSpawningEnabled`'s shape below
  // rather than `setCapabilities`' above: the grant is an OBJECT somebody else made, which is what
  // makes that row the one `handed-over` in this neighbourhood, and a provider is a word.
  setAgentProvider: { how: 'plain-by-construction' },
  // 558. ⛔ **`plain-by-construction`, and it earns the label on both halves for
  // `setAgentProvider`'s reason directly above**: the preload builds `{ kind, ...input }` itself,
  // and the two fields it did not build — `profileId`, `displayName` — are each a `string | null`.
  setAgentDisplayName: { how: 'plain-by-construction' },
  // 582. ⛔ **`plain-by-construction` on both halves**, for `setAgentDisplayName`'s reason directly
  // above: the preload builds `{ kind, ...input }` itself, and the three fields it did not build —
  // `profileId`, `text`, `broughtBack` — are a string, a string and a number. ⚠️ **`text` can be
  // 16,000 characters and that changes nothing here**: `363`'s question is who BUILT the value, not
  // how big it is, and a long primitive is still a primitive.
  instructAgent: { how: 'plain-by-construction' },
  // 582. ⛔ **`plain-by-construction` and not `nothing`**: the payload carries one string, so the
  // preload's own literal is the outer object and the field it did not build is a primitive.
  // ⚠️ **The ANSWER carries two arrays, and this table does not ask about it** — `removeAgent`'s own
  // note two rows down, and `363`'s question is who builds what goes THROUGH the door.
  agentInstructions: { how: 'plain-by-construction' },
  agentMethods: { how: 'plain-by-construction' },
  agentMethodBody: { how: 'plain-by-construction' },
  agentMethodChanges: { how: 'plain-by-construction' },
  removeAgentMethod: { how: 'plain-by-construction' },
  undoAgentMethod: { how: 'plain-by-construction' },
  checkInterruptedAgentMethods: { how: 'plain-by-construction' },
  agentOwnNotes: { how: 'plain-by-construction' },
  agentOwnNotesUnread: { how: 'plain-by-construction' },
  saveOwnNotes: { how: 'plain-by-construction' },
  undoOwnNotes: { how: 'plain-by-construction' },
  markOwnNotesSeen: { how: 'plain-by-construction' },
  agentRulesUnread: { how: 'plain-by-construction' },
  undoAgentRules: { how: 'plain-by-construction' },
  markAgentRulesSeen: { how: 'plain-by-construction' },
  // 677. ⛔ **`plain-by-construction` on both halves**, for `setAgentProvider`'s reason: the preload
  // builds `{ kind, ...input }` itself, and the four fields it did not build — `profileId`,
  // `provider`, `model`, `effort` — are each a `string | null`. ⚠️ **Flat ON PURPOSE**: a nested
  // `choice` object would have been a field this call site did not build, and the row would be
  // `handed-over` with `setCapabilities`.
  setAgentModelAndEffort: { how: 'plain-by-construction' },
  // 677. ⛔ **`plain-by-construction` and not `nothing`**: one string, `agentInstructions`' shape.
  agentModelAndEffort: { how: 'plain-by-construction' },
  // ⚑ **D-042 · R3 — the model list's read and its two hand-added writes.** ⛔
  // **`plain-by-construction` on both halves**: the preload writes `{ kind, ...input }` itself, and
  // every field it did not build — `provider`, `profileId`, `model` — is a string. ⚠️ No window
  // calls any of them yet: UI-012 draws the picker.
  modelList: { how: 'plain-by-construction' },
  addHandAddedModel: { how: 'plain-by-construction' },
  deleteHandAddedModel: { how: 'plain-by-construction' },
  // 🔒 The API-key doors: each is built by the preload from `{ kind, ...input }`, every field a
  // string.
  apiKeyStatus: { how: 'plain-by-construction' },
  setApiKey: { how: 'plain-by-construction' },
  removeApiKey: { how: 'plain-by-construction' },
  checkApiKey: { how: 'plain-by-construction' },
  // ⚑ The Providers screen's four reads carry no payload: `{ kind }` alone.
  providerVersions: { how: 'nothing' },
  providerSetup: { how: 'nothing' },
  providerUsage: { how: 'nothing' },
  providerResources: { how: 'nothing' },
  // ⚑ The kept rules: the list carries no payload; a removal, three strings the preload writes.
  keptRules: { how: 'nothing' },
  removeKeptRule: { how: 'plain-by-construction' },
  // ⚑ **D-050** — `setAgentModelLimit`'s row went with the agents' limit.
  // 625. ⛔ **`plain-by-construction` and not `nothing`**: the payload carries one string, so the
  // preload's own literal is the outer object and the field it did not build is a primitive —
  // `agentInstructions` directly above, word for word. ⚠️ **The ANSWER carries the stores and every
  // amendment, and this table does not ask about it.**
  agentMemory: { how: 'plain-by-construction' },
  // F093 · ⚑ One string, written as an argument at the call site, like `look`.
  whatThisAgentWasGiven: { how: 'plain-by-construction' },
  // F093 · C9 d · ⚑ One string and one number, written as arguments at the call site.
  whatTheModelGot: { how: 'plain-by-construction' },
  // 625. ⛔ **`plain-by-construction`, and `363`'s SECOND half is the one worth stating here.** The
  // payload is `{ profileId, provider, entry, act, text }` — five fields, every one a primitive the
  // window typed or chose from a closed vocabulary — so nothing reactive and no descriptor reaches
  // this door. ⚠️ **`entry` is a string this app produced in a previous reading**, which makes it a
  // primitive the call site did not author; it is still a primitive, and what stops it being an
  // authority is that main looks it up rather than opening it.
  amendAgentMemory: { how: 'plain-by-construction' },
  undoAgentMemory: { how: 'plain-by-construction' },
  checkInterruptedMemory: { how: 'plain-by-construction' },
  // 582. ⛔ **`plain-by-construction`** — a string and a boolean, written as an object literal at
  // the call site (the shape `decideProposal` had until D-016 took it).
  decideInstruction: { how: 'plain-by-construction' },
  // A string and a boolean, written as an object literal at the call site.
  decideMcpServerRequest: { how: 'plain-by-construction' },
  // 558. ⛔ **`plain-by-construction` and not `nothing`**: the payload carries one string, so the
  // preload's own literal is the outer object and the field it did not build is a primitive.
  // ⚠️ **The ANSWER is a union with an array in one arm, and this table does not ask about it** —
  // `363`'s question is who builds what goes THROUGH the door, not what comes back.
  removeAgent: { how: 'plain-by-construction' },
  // The preload writes each literal: a session id, and for the delete a copy of the ticked ids.
  archiveConversation: { how: 'plain-by-construction' },
  restoreConversation: { how: 'plain-by-construction' },
  checkDeleteConversation: { how: 'plain-by-construction' },
  deleteConversation: { how: 'plain-by-construction' },
  // ⛔ **Not `nothing`.** `setSpawningEnabled` carries a boolean; the wrapper is an object literal
  // written by `agent-store.ts` and a `boolean` is a primitive however it was read. §7 is where that
  // is measured rather than claimed, because this row is the value 105 others carry.
  // ⚠️ **It said *41* and the assertion below said 43** (found by `446`, which moved neither). The
  // first number went 42 → 43 at `438`'s `digest` and this sentence did not, so it was one short
  // before this dispatch opened the file — `a-number-can-survive-the-death-of-its-derivation`, and
  // the reason the split is asserted at all is that a prose count has nothing holding it.
  setSpawningEnabled: { how: 'plain-by-construction' },
  // A person's services switch: a boolean, in a literal the preload writes, as the switch above.
  setServicesOn: { how: 'plain-by-construction' },
  // 500. ⛔ **`plain-by-construction`, and it earns the label on BOTH halves** (363, 365): the
  // preload builds the outer literal itself (`{ kind, ...input }`), `agent-store.ts` writes
  // `{ mode }` at its own call site, and `mode` is a WORD — a primitive however it was read.
  // ⚠️ **`setSpawningEnabled` above is the shape, not `setCapabilities`**: the thing that makes a
  // row `handed-over` is a field somebody ELSE made, and a two-member union is not one. ⛔ It is
  // also the reason `ipc.ts` takes a `z.enum` rather than a `z.string()` — the vocabulary is this
  // app's own code on both sides of the wire.
  setDefaultApprovalMode: { how: 'plain-by-construction' },
  // D-016 · R4. ⛔ **`plain-by-construction` on both halves**, for `setAgentDisplayName`'s reason:
  // the preload builds `{ kind, ...input }` itself, and the one call site — `RuntimeScreen`'s rename
  // in place — writes `{ piece: named.label, title }` itself, a label read off the row and the title
  // the field held: two strings.
  retitleWork: { how: 'plain-by-construction' },
  takeBackWork: { how: 'plain-by-construction' },
  closeWork: { how: 'plain-by-construction' },
}

/* ------------------------------------------- §3 · the exempt roster comes from the preload itself */

/**
 * ⛔ **Prose stripped BEFORE anything is asserted** (`a-source-census-must-strip-prose-before-it-
 * asserts`). The preload is the most heavily commented file in the app and several of its docblocks
 * quote `ipcRenderer.invoke` while explaining a member that does not call it — `pathForDroppedFile`
 * says *"the `File` never reaches anything that could call it"* three lines above `webUtils`. A
 * census that read the comments would exempt nothing and pass.
 */
function withoutProse(code: string): string {
  return (
    code
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // ⚑ **473 · and template comments**, because §9 reads `.vue` producers as well as the
      // preload, and a `<!-- … -->` quoting a construction is no more a construction than a
      // docblock is.
      .replace(/<!--[\s\S]*?-->/g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
  )
}

/**
 * The members of one object literal, sliced ⛔ **to the NEXT member rather than by a fixed width** —
 * a member's body runs until the next one begins, and a fixed slice reads the neighbour's code.
 */
function membersOf(objectSource: string): Map<string, string> {
  const anchors = [...objectSource.matchAll(/^ {2}([A-Za-z_$][\w$]*)\s*:/gm)]
  const members = new Map<string, string>()
  anchors.forEach((anchor, index) => {
    const from = anchor.index ?? 0
    const to = anchors[index + 1]?.index ?? objectSource.length
    const name = anchor[1]
    if (name !== undefined) members.set(name, objectSource.slice(from, to))
  })
  return members
}

function preloadSurface(): Map<string, string> {
  const preload = withoutProse(source('src/preload/index.ts'))
  const runtimeAt = preload.indexOf('const runtime: RuntimeBridge = Object.freeze({')
  const apiAt = preload.indexOf('const api = Object.freeze({')
  const exposeAt = preload.indexOf('contextBridge.exposeInMainWorld')
  expect(
    runtimeAt,
    'the preload no longer declares `runtime` the way this census reads it',
  ).toBeGreaterThan(-1)
  expect(apiAt).toBeGreaterThan(runtimeAt)
  expect(exposeAt).toBeGreaterThan(apiAt)
  const surface = new Map([
    ...membersOf(preload.slice(runtimeAt, apiAt)),
    ...membersOf(preload.slice(apiAt, exposeAt)),
  ])
  expect(surface.get('themes')).toMatch(/^ {2}themes: themesBridge\(ipcRenderer\),/)
  // This member is an object of verbs, read separately below, not a subscription exemption.
  surface.delete('themes')
  surface.set(
    'runtime.providerSetup',
    membersOf(preload.slice(runtimeAt, apiAt)).get('providerSetup')!,
  )
  expect(surface.get('providerSetup')).toMatch(
    /^ {2}providerSetup: providerSetupBridge\(ipcRenderer\),/,
  )
  surface.delete('providerSetup')
  const setup = membersOf(
    withoutProse(source('src/preload/provider-setup.ts'))
      .split('return Object.freeze({')[1]!
      .replace(/^ {4}(?=\w)/gm, '  '),
  )
  expect([...setup.keys()].sort()).toEqual(['cancel', 'install', 'onState', 'signIn', 'state'])
  for (const [name, body] of setup)
    surface.set(
      name === 'onState' ? name : `providerSetup.${name}`,
      body.replaceAll('ipc.invoke', 'ipcRenderer.invoke'),
    )
  expect(surface.get('plugins')).toMatch(/^ {2}plugins: pluginsBridge\(ipcRenderer\),/)
  surface.delete('plugins')
  const plugins = membersOf(
    withoutProse(source('src/preload/plugins.ts')).replace(/^ {4}(?=\w)/gm, '  '),
  )
  expect([...plugins.keys()].sort()).toEqual([
    'onClosed',
    'onReviewInvalidated',
    'onReviewProgress',
    'request',
  ])
  expect(plugins.get('onClosed')).toContain('ipc.on(PLUGIN_SCREEN_CLOSED, notify)')
  expect(plugins.get('onClosed')).toContain('ipc.off(PLUGIN_SCREEN_CLOSED, notify)')
  expect(plugins.get('onReviewInvalidated')).toContain('ipc.on(PLUGIN_REVIEW_INVALIDATED, notify)')
  expect(plugins.get('onReviewInvalidated')).toContain('ipc.off(PLUGIN_REVIEW_INVALIDATED, notify)')
  expect(plugins.get('onReviewInvalidated')).not.toContain('ipc.invoke')
  expect(plugins.get('onReviewProgress')).toContain('ipc.on(PLUGIN_REVIEW_PROGRESS, notify)')
  expect(plugins.get('onReviewProgress')).toContain('ipc.off(PLUGIN_REVIEW_PROGRESS, notify)')
  expect(plugins.get('onReviewProgress')).not.toContain('ipc.invoke')
  for (const [name, body] of plugins)
    surface.set(name, body.replace('ipc.invoke', 'ipcRenderer.invoke'))
  expect(surface.get('storage')).toMatch(/^ {2}storage: storageBridge\(ipcRenderer\),/)
  surface.delete('storage')
  const storage = membersOf(
    withoutProse(source('src/preload/storage.ts')).replace(/^ {4}(?=\w)/gm, '  '),
  )
  expect([...storage.keys()].sort()).toEqual([
    'children',
    'clearCache',
    'measure',
    'pruneBackups',
    'reveal',
  ])
  for (const [name, body] of storage)
    surface.set(`storage.${name}`, body.replaceAll('ipc.invoke', 'ipcRenderer.invoke'))
  expect(surface.get('voice')).toMatch(/^ {2}voice: voiceBridge\(ipcRenderer, process.platform\),/)
  surface.delete('voice')
  const voice = membersOf(
    withoutProse(source('src/preload/voice.ts'))
      .split('return Object.freeze({')[1]!
      .replace(/^ {4}(?=\w)/gm, '  '),
  )
  expect([...voice.keys()].sort()).toEqual([
    'cancel',
    'onState',
    'openSettings',
    'start',
    'stop',
    'supported',
  ])
  expect(voice.get('supported')).toContain("platform === 'darwin'")
  expect(voice.get('onState')).toContain('ipc.on(VOICE_CHANNELS.state, receive)')
  expect(voice.get('onState')).toContain('ipc.removeListener(VOICE_CHANNELS.state, receive)')
  expect(voice.get('onState')).not.toContain('ipc.invoke')
  expect(NOT_THE_WIRE.has('onState')).toBe(true)
  for (const name of ['start', 'stop', 'cancel', 'openSettings'])
    surface.set(`voice.${name}`, voice.get(name)!.replaceAll('ipc.invoke', 'ipcRenderer.invoke'))
  return surface
}

describe('§3 · what is exempt is derived from the preload, not written down (361 §2)', () => {
  const surface = preloadSurface()
  /** A member reaches the wire if its own body invokes, or goes through the `command` helper. */
  const invokes = (body: string): boolean =>
    body.includes('ipcRenderer.invoke') || /(?:^|[^\w.])command\(/.test(body)

  it('every Storage factory method is an invoke member, with no namespace exemption', () => {
    expect(surface.has('storage')).toBe(false)
    const storage = [...surface].filter(([name]) => name.startsWith('storage.'))
    expect(storage.map(([name]) => name).sort()).toEqual([
      'storage.children',
      'storage.clearCache',
      'storage.measure',
      'storage.pruneBackups',
      'storage.reveal',
    ])
    for (const [name, body] of storage) {
      expect(invokes(body), name).toBe(true)
      expect(NOT_THE_WIRE.has(name), name).toBe(false)
    }
  })

  it('the real Storage factory carries plain arguments and refuses reactive locations over the wire', async () => {
    const seen: { channel: string; arguments: unknown[] }[] = []
    const bridge = storageBridge({
      invoke: async (channel: string, ...args: unknown[]) => {
        seen.push({ channel, arguments: asTheWireWouldCarry(channel, args) })
        return { ok: true }
      },
    })
    const location = { part: 'workspace' as const, segments: ['one'] }
    await bridge.measure()
    await bridge.children(location)
    await bridge.reveal(location)
    await bridge.clearCache()
    await bridge.pruneBackups()
    expect(seen).toEqual([
      { channel: STORAGE_CHANNELS.measure, arguments: [] },
      { channel: STORAGE_CHANNELS.children, arguments: [location] },
      { channel: STORAGE_CHANNELS.reveal, arguments: [location] },
      { channel: STORAGE_CHANNELS.clearCache, arguments: [] },
      { channel: STORAGE_CHANNELS.pruneBackups, arguments: [] },
    ])
    expect(seen[1]!.arguments[0]).not.toBe(location)
    await expect(bridge.children(reactive(location))).rejects.toThrow(
      /would not survive ipcRenderer\.invoke/,
    )
    await expect(bridge.reveal(reactive(location))).rejects.toThrow(
      /would not survive ipcRenderer\.invoke/,
    )
    expect(seen).toHaveLength(5)
  })

  it('the separate theme surface classifies each verb and exempts only its subscription', () => {
    const themeSource = withoutProse(source('src/preload/themes.ts'))
    const members = membersOf(themeSource.replace(/^ {4}(?=\w)/gm, '  '))
    expect([...members.keys()].sort()).toEqual([
      'delete',
      'duplicate',
      'list',
      'onChanged',
      'openFolder',
      'read',
      'set',
    ])
    const invokesTheme = (body: string): boolean => body.includes('ipc.invoke')
    expect([...members].filter(([, body]) => !invokesTheme(body)).map(([name]) => name)).toEqual([
      'onChanged',
    ])
    expect(NOT_THE_WIRE.has('onChanged')).toBe(true)
    expect(members.get('onChanged')).toContain('ipc.on(THEMES_CHANNELS.changed, forward)')
    expect(members.get('onChanged')).toContain('ipc.off(THEMES_CHANNELS.changed, forward)')
    expect(invokesTheme('ipc.invoke(THEMES_CHANNELS.read)')).toBe(true)
    expect(invokesTheme('ipc.on(THEMES_CHANNELS.changed, forward)')).toBe(false)
  })

  it('setup actions all invoke; only the passive setup subscription is exempt', () => {
    for (const name of ['state', 'install', 'signIn', 'cancel']) {
      expect(invokes(surface.get(`providerSetup.${name}`)!)).toBe(true)
      expect(NOT_THE_WIRE.has(`providerSetup.${name}`)).toBe(false)
    }
    const body = surface.get('onState')!
    expect(body).toContain('ipc.on(PROVIDER_SETUP_CHANNELS.changed, forward)')
    expect(body).toContain('ipc.off(PROVIDER_SETUP_CHANNELS.changed, forward)')
  })

  it.each(['onState', 'onReviewInvalidated', 'onReviewProgress'])(
    'the %s subscription alone is exempt; planting any invoke makes it a wire member',
    (name) => {
      const body = surface.get(name)!
      expect(NOT_THE_WIRE.has(name)).toBe(true)
      expect(invokes(body)).toBe(false)
      const planted =
        body +
        (name === 'onState'
          ? "\nipcRenderer.invoke('planted-setup-command')"
          : "\nif (false) ipcRenderer.invoke('planted-review-command')")
      expect(invokes(planted)).toBe(true)
      expect(
        [...surface]
          .filter(([key, member]) => !invokes(key === name ? planted : member))
          .map(([name]) => name)
          .sort(),
      ).not.toEqual([...NOT_THE_WIRE].sort())
      expect(NOT_THE_WIRE.has('request')).toBe(false)
    },
  )

  it('⛔ the census really read the preload — the surface is the size the app has', () => {
    // Non-vacuity: a path typo, a rename or a regex that matched nothing all produce an empty map,
    // and an empty map satisfies every `for` loop below without asserting anything at all.
    // ⚑ **A FLOOR, not an equality, and the roster below is the equality.** Re-measured at 365:
    // 63 members across the two frozen objects — 52 runtime verbs, two runtime subscriptions, and
    // the ten on `api` itself. (58 at 361; 61 at 363, before `356`'s two arrived on this merge.) A
    // verb added later should not redden this file; a verb added later and wrongly exempted should,
    // and that is what `NOT_THE_WIRE` is compared against.
    expect(surface.size).toBeGreaterThanOrEqual(63)
    for (const named of [
      'send',
      'setSessionSetting',
      'onEvent',
      'pathForDroppedFile',
      'pasteImage',
    ]) {
      expect(surface.has(named), `${named} is not in the derived surface`).toBe(true)
    }
  })

  it('🔴 every member that invokes is carried over the wire, and every one that does not is exempt', () => {
    const shouldBeExempt = [...surface].filter(([, body]) => !invokes(body)).map(([name]) => name)
    const shouldNotBe = [...surface].filter(([, body]) => invokes(body)).map(([name]) => name)
    expect([...shouldBeExempt].sort()).toEqual([...NOT_THE_WIRE].sort())
    for (const name of shouldNotBe) {
      expect(
        NOT_THE_WIRE.has(name),
        `${name} reaches ipcRenderer.invoke and is exempt from the clone`,
      ).toBe(false)
    }
  })

  it('⚑ and the derivation can tell the two apart — the pair, one fact over', () => {
    // ⛔ Both halves, because a predicate that answered `true` for everything would pass the
    // equality above only by accident of the roster being empty, and one that answered `false` for
    // everything would pass it only if the roster were the whole surface.
    expect(invokes("command({ kind: 'send', ...input })")).toBe(true)
    expect(invokes("ipcRenderer.invoke('app:info')")).toBe(true)
    expect(invokes('ipcRenderer.on(RUNTIME_EVENT_CHANNEL, forward)')).toBe(false)
    expect(invokes('webUtils.getPathForFile(file)')).toBe(false)
  })
})

/* ------------------------------------------- §5 · the node-side double, planted and found (361 §2) */

describe('§5 · a bridge double refuses what the wire refuses (361 §2)', () => {
  /** A double shaped like the real thing, with only what these two assertions reach. */
  function doubleBridge(): { wired: RuntimeBridge; seen: unknown[]; listeners: unknown[] } {
    const seen: unknown[] = []
    const listeners: unknown[] = []
    const wired = everythingOverTheWire({
      send: async (input: unknown): Promise<void> => void seen.push(input),
      onEvent: (listener: unknown): (() => void) => {
        listeners.push(listener)
        return () => {}
      },
    }) as unknown as RuntimeBridge
    return { wired, seen, listeners }
  }

  it('🔴 a send whose attachments are proxies is refused, the way 218 was refused in production', async () => {
    const { wired, seen } = doubleBridge()
    const book = reactive(new Map([['/a', { path: '/a', kind: 'file', outsideCwd: false }]]))
    await expect(
      wired.send({ sessionId: 's1', text: 'read this', attachments: [...book.values()] as never }),
    ).rejects.toThrow(/would not survive ipcRenderer\.invoke/)
    expect(seen, 'the double answered a payload the wire would never have delivered').toEqual([])
  })

  it('⚑ …and the same send one fact over, with the members copied, is delivered', async () => {
    const { wired, seen } = doubleBridge()
    const book = reactive(new Map([['/a', { path: '/a', kind: 'file', outsideCwd: false }]]))
    const attachments = [...book.values()].map(({ path, kind, outsideCwd }) => ({
      path,
      kind,
      outsideCwd,
    }))
    await wired.send({ sessionId: 's1', text: 'read this', attachments: attachments as never })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toEqual({
      sessionId: 's1',
      text: 'read this',
      attachments: [{ path: '/a', kind: 'file', outsideCwd: false }],
    })
  })

  it('⛔ it REJECTS rather than throwing, because that is how the refusal really travels', () => {
    const { wired } = doubleBridge()
    const proxied = { sessionId: 's1', text: 'x', attachments: [reactive({ path: '/a' })] }
    // ⚠️ The distinction is not pedantry: `ipcRenderer.invoke` is an `async` function, so the
    // refusal arrives as a rejected promise. A double that threw synchronously would take a caller
    // that forgot to `await` down a different path than the app does — and `218`'s report is a
    // sentence that reached the screen through a `catch`, which a synchronous throw would have
    // walked straight past.
    let threwSynchronously = false
    let promise: unknown
    try {
      promise = wired.send(proxied as never)
    } catch {
      threwSynchronously = true
    }
    expect(threwSynchronously).toBe(false)
    expect(promise).toBeInstanceOf(Promise)
    return expect(promise).rejects.toThrow(/would not survive/)
  })

  it('⛔ a subscription still takes its listener — an exemption that stopped working would be silent', () => {
    const { wired, listeners } = doubleBridge()
    const listener = (): void => {}
    wired.onEvent(listener as never)
    // ⚠️ `toBe`, not `toEqual`: what makes this exemption real is that the SAME function arrives.
    // A clone of a listener is not a listener, and structured clone refuses one outright.
    expect(listeners[0]).toBe(listener)
  })
})

const IMPORTS_THE_WIRE = /from '(?:\.\.?\/)*(?:lib\/)?the-wire'/

/**
 * ⛔ **And CALLS it, which is the half the import alone cannot say.** Measured while verifying this
 * table's rows: deleting the call and leaving the import behind kept four rows green — an unused
 * import is a lint error and lint is not a gate the mutation harness runs, so the census has to ask
 * for the call itself. ⚑ `throughTheWire` is `session-store.test.ts`'s own name for the wrapper it
 * builds out of `asTheWireWouldCarry`, so all three spellings are one thing.
 */
const RUNS_THE_WIRE = /\b(?:asTheWireWouldCarry|everythingOverTheWire|throughTheWire)\s*\(/

describe('§6 · every double the renderer store runs on is a wire (361 §2)', () => {
  it('⚑ …and the two halves of that really are two halves', () => {
    // ⛔ The pair. An import with no call is exactly what a row that deleted the call leaves
    // behind, and it is the shape four of this dispatch's own mutation rows survived as.
    const importOnly = "import { everythingOverTheWire } from './lib/the-wire'\nreturn ({})"
    expect(IMPORTS_THE_WIRE.test(importOnly)).toBe(true)
    expect(RUNS_THE_WIRE.test(importOnly)).toBe(false)
  })
})

/* ---------------------- §7 · the three verbs `355` added, measured rather than labelled (363) */

/**
 * 🔴 **`355` and `361` were built in parallel off one base and neither could see the other**, so
 * `agentIdentities`, `setCapabilities` and `setSpawningEnabled` reached the table above by way of a
 * compile error on the merge. ⛔ **The table cannot earn their rows on its own** — §2 says in as
 * many words that it records how a call site builds its payload TODAY and is not a guard — and two
 * of the three carry the value 84 other rows carry. This section is what those two are worth.
 *
 * ⚠️ **That number said 38 and had said 38 since `363`** — through `419`, `433`, `438`, `441` and
 * `462`, each of which moved the first number and moved the two sentences beside the assertion and
 * not this one. ⛔ It is corrected here by `510` because `510` moved the number again, and it is
 * recorded rather than quietly fixed: a sentence three sections away from the assertion it quotes
 * is exactly where `a-number-can-survive-the-death-of-its-derivation` keeps happening.
 *
 * ⚠️ **`setCapabilities` is the verb `355` FIXED**, and `plain-by-construction` for it would have
 * been a label that agreed with itself: the sheet's `grant()` is what makes the payload cloneable,
 * and a table that called the wrapper plain would have gone green with the fix removed. ⛔ Here it
 * does not: the proxy is planted back and the store answers with the wire's own sentence.
 *
 * ⚑ **The store, not a component.** `createAgentStore` takes the bridge as an argument — the shape
 * `session-store.ts` has — so the three call sites can be driven in the node project with the wire
 * in the middle, which is where `361` put every other renderer store's double.
 */

const A_ROW: AgentIdentities = {
  identities: [
    {
      id: 'aid:pm',
      slug: 'pm',
      displayName: null,
      createdAt: 1_700_000_000_000,
      // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
      createdBy: null,
      provider: null,
      // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
      externalMcpServerIds: [],
      capabilities: DEFAULT_CAPABILITIES,
      chosen: {
        maxDepth: 'default',
        canMessage: 'default',
        canAssignWork: 'default',
        canCreateAgents: 'default',
        // ⚑ **582 · nobody has chosen**, like every other field on this row.
        canWriteRules: 'default',
      },
    },
  ],
  foldersWithoutARow: [],
  use: [],
  spawningEnabled: true,
  // 500 · required on `AgentIdentities`; this row is the wire's, and the launch default rides it.
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
}

/** A store over a bridge whose every verb crosses the wire, and the payloads that got through. */
function agentStoreOverTheWire(): {
  store: ReturnType<typeof createAgentStore>
  seen: { verb: string; input: unknown }[]
} {
  const seen: { verb: string; input: unknown }[] = []
  const bridge = everythingOverTheWire({
    agentIdentities: async (input: unknown) => {
      seen.push({ verb: 'agentIdentities', input })
      return A_ROW
    },
    setCapabilities: async (input: unknown) => {
      seen.push({ verb: 'setCapabilities', input })
      return A_ROW.identities[0] ?? null
    },
    setSpawningEnabled: async (input: unknown) => {
      seen.push({ verb: 'setSpawningEnabled', input })
      return { spawningEnabled: false }
    },
  }) as unknown as RuntimeBridge
  return { store: createAgentStore(bridge), seen }
}

const PLAIN_GRANT: CapabilityGrant = {
  maxDepth: 4,
  canMessage: 'none',
  canAssignWork: null,
  canCreateAgents: null,
  canWriteRules: null,
}

describe('§7 · the agent store crosses a wire, and one of its three verbs can be broken (363)', () => {
  it('⚑ all three payloads survive the clone, and each arrives as a COPY', async () => {
    const { store, seen } = agentStoreOverTheWire()
    await store.load()
    // ⚑ **516 · the third argument is the COMPLETE set of registered servers**, and empty is the
    // sample that changes nothing: it is what every identity holds until somebody ticks a box.
    expect(await store.save('pm', PLAIN_GRANT, [])).toBeNull()
    expect(await store.setSpawning(false)).toBeNull()

    // ⛔ `save` re-reads, so `agentIdentities` is here twice — the order is the store's, not this
    // test's, and pinning it is what would notice a save that stopped refreshing the list.
    expect(seen.map(({ verb }) => verb)).toEqual([
      'agentIdentities',
      'setCapabilities',
      'agentIdentities',
      'setSpawningEnabled',
    ])
    // ⚑ **`undefined` since 369, and that is the strongest reading of the `nothing` row**: the
    // store calls `bridge.agentIdentities()` with no argument at all, so the far side is handed
    // nothing rather than an empty wrapper. ⛔ Asserted rather than skipped — a verb whose row says
    // `nothing` must be SHOWN to send nothing, or the row is a label. `seen` proves the call
    // happened; this proves what it carried.
    expect(seen[0]).toBeDefined()
    expect(seen[0]?.input).toBeUndefined()
    expect(seen[1]?.input).toEqual({
      profileId: 'pm',
      grant: PLAIN_GRANT,
      externalMcpServerIds: [],
    })
    expect(seen[3]?.input).toEqual({ enabled: false })
    // ⚠️ The half that says this really went over a wire rather than past one: the far side holds a
    // copy. Without it every assertion above would pass just as well against a passthrough.
    expect((seen[1]?.input as { grant: unknown }).grant).not.toBe(PLAIN_GRANT)
  })

  /**
   * 🔴 **The plant, and it is `355`'s own defect put back.** `value` in `CapabilitiesSheet` is a
   * `reactive({})`, so a grant that IS that state, rather than `grant()`'s fresh object, crosses as
   * a Proxy. ⛔ **This is what makes `setCapabilities`'s `handed-over` row a measurement**: the
   * wrapper is an object literal `agent-store.ts` writes itself, and the payload is refused anyway.
   */
  it('🔴 a grant that is the sheet’s reactive state is refused, naming the field', async () => {
    const { store, seen } = agentStoreOverTheWire()
    const editing = reactive<Record<string, unknown>>({ ...PLAIN_GRANT })
    const refusal = await store.save('pm', editing as unknown as CapabilityGrant, [])
    expect(refusal).toContain('would not survive ipcRenderer.invoke')
    expect(refusal).toContain('grant is a Vue reactive Proxy')
    expect(refusal).toContain('setCapabilities')
    expect(seen, 'the wire delivered a payload the shipped app would have refused').toEqual([])
  })

  /**
   * ⚑ **The paired positive, one fact over** — the same state read field by field into a fresh
   * object, which is what the sheet's `grant()` really does.
   */
  it('⚑ …and the same grant built fresh out of the proxy is delivered', async () => {
    const { store, seen } = agentStoreOverTheWire()
    const editing = reactive<Record<string, unknown>>({ ...PLAIN_GRANT })
    const fresh = Object.fromEntries(Object.keys(PLAIN_GRANT).map((key) => [key, editing[key]]))
    expect(await store.save('pm', fresh as unknown as CapabilityGrant, [])).toBeNull()
    expect(seen.map(({ verb }) => verb)).toEqual(['setCapabilities', 'agentIdentities'])
    // ⛔ …and it arrived whole. A pair that only counted the calls would be satisfied by a wire
    // that carried an empty grant, which is the shape `355` reported: two fields save, two do not.
    expect(seen[0]?.input).toEqual({
      profileId: 'pm',
      grant: PLAIN_GRANT,
      // ⚑ **516 · the third field the wrapper carries**, and `toEqual` over the WHOLE payload is
      // what makes it visible: a version of this assertion written as `toMatchObject` would have
      // let a field arrive on the wire with nothing in this file saying so.
      externalMcpServerIds: [],
    })
  })
})

/* -------------------- §8 · the two verbs `356` added, measured rather than labelled (365 §1) */

/**
 * 🔴 **`356` was built off `main` @ `14d75f3`, before `361`'s guard landed**, so `readInstructionSource`
 * and `revealPath` reached the table above by way of a compile error on the integration — the second
 * time in a day, and the reason `365` §2 makes the classification part of the commit that adds a verb.
 *
 * ⛔ **The two answers are not the same answer**, and that is the whole of this section:
 *
 *  - `readInstructionSource` sends `{ sessionId, index }`. ⚑ `356` made the second field an INDEX
 *    into the list the provider itself reported rather than a path, so the payload is a string and
 *    a number and there is no shape for a proxy to hide in.
 *  - `revealPath` sends `{ sessionId, target }`, and `target` is an OBJECT the store did not build.
 *    That is `setCapabilities`'s half of the rule, so it is `handed-over`.
 *
 * 🔴 **And the consequence is worse here than at any of the four sites `361` found.** Every one of
 * those was LOUD: a read error on screen, a turn that never started, two fields that would not save,
 * a Cancel that did nothing. ⛔ **A proxy in `target` is SILENT** — `session-store.revealPath`
 * catches, and the only refusal it can honestly return says nothing about disk, so the panel would
 * render *"this conversation does not report that file"* about a file it is displaying the path of.
 * ⚠️ **That catch is right for a channel that failed and is not being changed here**; what this
 * section does is pin the shape, so the day a producer starts handing a reactive target over, the
 * red is in this file rather than in a bug report about a button that does nothing.
 */

/** A session store whose two `356` verbs cross the wire, and the payloads that got through. */
function sessionStoreOverTheWire(): {
  store: ReturnType<typeof createSessionStore>
  seen: { verb: string; input: unknown }[]
} {
  const seen: { verb: string; input: unknown }[] = []
  const bridge = everythingOverTheWire({
    // ⚠️ The store subscribes at construction, so these two have to be here. Both are in
    // `NOT_THE_WIRE` and are handed through unwrapped — which §5 is the assertion for.
    onEvent: () => () => {},
    onLiveness: () => () => {},
    readInstructionSource: async (input: unknown) => {
      seen.push({ verb: 'readInstructionSource', input })
      return {
        ok: true,
        path: '/p/AGENTS.md',
        name: 'AGENTS.md',
        text: '# hi',
        truncated: false,
        bytes: 4,
      }
    },
    revealPath: async (input: unknown) => {
      seen.push({ verb: 'revealPath', input })
      return { ok: true, path: '/p/AGENTS.md' }
    },
  }) as unknown as RuntimeBridge
  return { store: createSessionStore(bridge), seen }
}

describe('§8 · the session store crosses a wire, and one of its two verbs can be broken (365)', () => {
  it('⚑ both payloads survive the clone, and the one with an object in it arrives as a COPY', async () => {
    const { store, seen } = sessionStoreOverTheWire()
    const target = { of: 'config-file', name: 'auth.json' } as const

    expect((await store.readInstructionSource('s1', 2)).ok).toBe(true)
    expect((await store.revealPath('s1', target)).ok).toBe(true)

    expect(seen.map(({ verb }) => verb)).toEqual(['readInstructionSource', 'revealPath'])
    expect(seen[0]?.input).toEqual({ sessionId: 's1', index: 2 })
    expect(seen[1]?.input).toEqual({ sessionId: 's1', target })
    // ⚠️ The half that says a wire ran rather than a passthrough — and it is only askable of the
    // second, because the first payload has nothing in it that a copy could differ from.
    expect((seen[1]?.input as { target: unknown }).target).not.toBe(target)
  })

  /**
   * ⚑ **What the `plain-by-construction` row is claiming, driven rather than described.** Both of
   * `readInstructionSource`'s fields are read here off a `reactive` — the very gesture that made
   * `cancelProviderSignIn` throw — and both cross, because a string is a string and a number is a
   * number however they were read. ⛔ The ONLY way this verb joins the other list is the store
   * handing the whole payload over instead of writing `{ sessionId, index }` itself.
   */
  it('⚑ a row read straight off reactive state still crosses, because both its fields are primitives', async () => {
    const { store, seen } = sessionStoreOverTheWire()
    const box = reactive({ id: 's1', at: 2 })
    expect((await store.readInstructionSource(box.id, box.at)).ok).toBe(true)
    expect(seen[0]?.input).toEqual({ sessionId: 's1', index: 2 })
  })

  /**
   * 🔴 **The plant: `355`'s defect in the shape `revealPath` would take it.** A component that kept
   * the row it last revealed — a `ref`, a `reactive`, a member of a `reactive(new Map())` — and
   * handed it back is one edit away, and this is what the app would do about it.
   */
  it('🔴 a target read out of reactive state is refused, and the panel is told the path is missing', async () => {
    const { store, seen } = sessionStoreOverTheWire()
    const remembered = reactive({ of: 'config-file', name: 'auth.json' })

    const said = await store.revealPath('s1', remembered as never)

    // ⛔ Nothing reached the far side…
    expect(seen, 'the wire delivered a payload the shipped app would have refused').toEqual([])
    // …and this is the sentence the panel gets instead, which names no proxy and no wire.
    expect(said).toEqual({ ok: false, reason: 'no-path' })
  })

  /** ⚑ The pair, one fact over: the same target as the literal the template really writes. */
  it('⚑ …and the same target written as a literal is delivered', async () => {
    const { store, seen } = sessionStoreOverTheWire()
    expect(await store.revealPath('s1', { of: 'config-file', name: 'auth.json' })).toEqual({
      ok: true,
      path: '/p/AGENTS.md',
    })
    expect(seen[0]?.input).toEqual({
      sessionId: 's1',
      target: { of: 'config-file', name: 'auth.json' },
    })
  })
})

/* ───────────────── §9 · who BUILDS what goes through the door (473, from 469 F3) ──────────── */

/**
 * 🔴 **`469`'s third finding, and the one that outlives its own fix.**
 *
 * > ⚠️ *"The existing clone census already classifies `respondPermission` as handed-over, **but its
 * > note says the decision comes from `PermissionCard.toDecision`.** It does not enumerate the
 * > PersonsQueue producer or plant a reactive queue-origin permission. **That is why a known class
 * > of bridge defect still passed the census."***
 *
 * ⛔ **So §2 asked one of two questions.** *Which door does this go through* was enumerated by the
 * compiler and is complete; *who built what goes through it* was a sentence in a note, written by
 * whoever last looked, and a note cannot notice a producer arriving. ⚑ **This section is the second
 * question**: every `handed-over` verb carries a list, the list is required by the type, and each
 * entry has to be findable in the file it names.
 *
 * ⚠️ **It is not a guard either, and saying so is `365`'s rule.** A THIRD producer of a permission
 * value does not redden this section by existing. ⛔ **What this is, is the enumeration that makes
 * the omission visible in a diff**: a verb whose producers say `PermissionCard` and nothing else,
 * next to a surface that plainly also answers permissions, is a question somebody has to answer.
 *
 * ⚑ **Where the guard actually is, stated rather than gestured at** (473, corrected after this
 * dispatch's own adversarial read said the first draft of this paragraph over-claimed):
 *
 *  - a new CONSTRUCTION of a permission decision — a literal, the shorthand, a computed value or a
 *    cast — reddens `the-press-that-cloned-nothing.test.ts` §4, which walks every `.ts` and `.vue`
 *    under `src/renderer` for the shape rather than for a spelling;
 *  - 🔴 **a new HAND-OVER constructs nothing and no source search can see it.** §1 of that file
 *    drives every arm of `answerFor` — the one hand-over this app has — out of a genuinely reactive
 *    queue and over a real `structuredClone`. ⛔ **A surface that reaches `respondPermission`
 *    without going through `answerFor` is covered by neither, and needs its own press.**
 */
describe('§9 · every handed-over verb names its producers, and they exist (473)', () => {
  const handed = Object.entries(HOW_EACH_VERB_IS_BUILT).flatMap(([kind, entry]) =>
    entry.how === 'handed-over' ? [[kind, entry] as const] : [],
  )

  it('⛔ each names its producers, with their independently pinned total', () => {
    // ⚑ Non-vacuity: an empty list would satisfy every `for` below without asserting anything.
    expect(handed.map(([kind]) => kind).sort()).toEqual([
      'cancelProviderSignIn',
      'respondPermission',
      'respondUserInput',
      'revealPath',
      'searchWork',
      'setCapabilities',
      'setSessionSetting',
      'skills',
    ])
    for (const [kind, entry] of handed) {
      expect(
        entry.producers.length,
        `${kind} is handed a payload nobody is named for`,
      ).toBeGreaterThan(0)
    }
    // 🔴 **The count, asserted rather than left to the rows.** `469`'s finding was a MISSING
    // producer, and a missing one is invisible to every assertion that walks the list it is not in.
    // ⚑ UI-012 · `setSessionSetting`'s one producer became two: the picker's model, then its effort.
    // ⚑ …and three: plan mode is built where the agent card asks for it, not relayed from a tab.
    expect(handed.reduce((so, [, entry]) => so + entry.producers.length, 0)).toBe(18)
  })
})
