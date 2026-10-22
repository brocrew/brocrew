import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { reactive, ref } from 'vue'
import { createAgentStore } from '../src/renderer/src/lib/agent-store'
import { createSessionStore } from '../src/renderer/src/lib/session-store'
import { DEFAULT_CAPABILITIES, type CapabilityGrant } from '../src/shared/capabilities'
import { NOT_THE_WIRE, asTheWireWouldCarry, everythingOverTheWire } from './lib/the-wire'
import type { AgentIdentities, RuntimeBridge, RuntimeCommandKind } from '../src/shared/runtime-ipc'

/**
 * # 🔴 The bridge that clones nothing (361)
 *
 * `355`'s review found a capability grant crossing the wire as a Vue reactive `Proxy`. Two of its
 * four fields would have thrown at the bridge in the shipped app and two would have saved fine.
 * ⛔ **The sentence this file is about is the one after the dash:** *"and no test in this repo could
 * see it, because every one of them injects an in-process bridge that clones nothing."*
 *
 * ## ⚠️ It is the fourth, not the first
 *
 * | dispatch | the call | what a person saw |
 * |---|---|---|
 * | `121` | `listLibrary({ filters: filters.value })` | every filter press showed a read error |
 * | `218` | `send({ attachments })` off a `reactive(new Map())` | *"An object could not be cloned."*, no turn |
 * | `355` | `setCapabilities({ grant })` | two fields save, two throw |
 * | `361` | `cancelProviderSignIn(authFor.value)` | Cancel does nothing, silently |
 *
 * ⛔ **Four sites, three fixes, no guard.** Each was repaired where it was found, and the repair
 * taught the next site nothing — which is what `§2` means by *a convention nothing enforces decays*.
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

/* --------------------------------------------- §2 · every verb, enumerated by the compiler (361 §1) */

/**
 * How a renderer builds the payload for one verb.
 *
 *  - `nothing` — the command is parameterless. There is no payload to refuse.
 *  - `plain-by-construction` — the ONE call site writes the object literal itself, or copies a
 *    caller's fields into a fresh one. A proxy cannot survive the way in.
 *  - `handed-over` — the call site passes a value it did not build. ⛔ **These are the verbs
 *    that can carry a proxy**, and each one's note says what was traced to its producer.
 *
 * ⚠️ **A field handed in is only `handed-over` when it could hold a proxy.** `send` takes
 * `sessionId` and `text` from its caller and is `plain-by-construction`, because a string is a
 * string however it was read. ⛔ **The question the label answers is: does the call site build the
 * outer object literal, and is every field it did NOT build a primitive?** `cancelProviderSignIn`
 * failed the first half — two strings, and the whole payload handed over — and `setCapabilities`
 * fails the second: it writes its own wrapper and `grant` is an object somebody else made (363).
 */
type HowThePayloadIsBuilt = 'nothing' | 'plain-by-construction' | 'handed-over'

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
    note: 'The Skills page builds a list request and a toggle request from primitive folder/enabled fields; neither hands over a reactive skill object. The DOM controls exercise structured clone before each fake reply.',
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
      'never looked like a bridge fault. Fixed in `NewConversation.cancelSignIn`.',
    producers: [
      {
        at: 'src/renderer/src/components/NewConversation.vue',
        builds: 'provider: running.provider,\n      profileId: running.profileId,',
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
  readChildWork: { how: 'plain-by-construction' },
  readChildState: { how: 'plain-by-construction' },
  sendToChild: { how: 'plain-by-construction' },
  earlierHistory: { how: 'plain-by-construction' },
  latestHistory: { how: 'plain-by-construction' },
  // ── what the app can run, and where ──────────────────────────────────────────────────────────
  capabilities: { how: 'nothing' },
  profiles: { how: 'nothing' },
  checkProviderAuth: { how: 'plain-by-construction' },
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
  // is measured rather than claimed, because this row is the value 84 others carry.
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
}

/** The ten `app:*` invokes, which are not in `RuntimeCommand` and are a wire all the same. */
const THE_APP_CHANNELS: Record<string, HowThePayloadIsBuilt> = {
  getAppInfo: 'nothing',
  // 🔴 D-031 — the Mac's time zone, asked for before the window draws: nothing goes out.
  localZone: 'nothing',
  // 🔴 744 · R100 — the kept drafts asked for before the window draws: nothing goes out.
  savedDrafts: 'nothing',
  // 🔴 744 · R100 — ⛔ **`plain-by-construction`, on BOTH halves** (363): `kept-drafts.ts`'
  // `draftsToSave` writes the outer `{ drafts }` literal and each `{ slot, text, attached }` itself,
  // and copies every attached path field by field (`plainHanded`) — the book holds Vue proxies, and
  // a proxy is exactly the field somebody else made. `a-draft-survives-a-restart.test.ts` §1
  // structured-clones what it builds.
  saveDrafts: 'plain-by-construction',
  chooseCwd: 'nothing',
  chooseBundle: 'nothing',
  chooseAttachment: 'plain-by-construction',
  classifyAttachments: 'plain-by-construction',
  handDroppedPaths: 'plain-by-construction',
  pasteImage: 'plain-by-construction',
}

describe('§2 · every renderer→main verb is accounted for (361 §1)', () => {
  it('⛔ the table really enumerates the union, rather than a subset somebody typed', () => {
    // Non-vacuity for the compile-time half above: an `as` anywhere in the chain would let the
    // record be short, and this is the number that would notice.
    // ⚑ 86 → 87 at `733`: `readConfigFile`.
    // ⚑ 87 → 88 at `735`: `startAndSend`.
    // ⚑ 88 → 89 at D-017 · R19: `instructionAsksForAPerson`.
    // ⚑ 89 → 88 at D-017b: `look` in; `libraryEntry` and `readArchived` out.
    // ⚑ 88 → 80 at D-016: `decideProposal`, `proposalsForAPerson`, `conversationsInProject`,
    // `documentsInProject`, `project`, `projects`, `createProject` and `saveProject` out.
    // ⚑ 80 → 81 at D-016 · R4: `retitleWork`.
    // ⚑ 81 → 82 at D-018: `processMemory`.
    // ⚑ 82 → 83 at D-026: `filesKept`.
    // ⚑ 83 → 87 at D-042: `modelList`, `addHandAddedModel`, `deleteHandAddedModel`,
    // `setAgentModelLimit`.
    // ⚑ 87 → 86 at D-050: `setAgentModelLimit` out.
    // ⚑ 86 → 90 with the API keys: `apiKeyStatus`, `setApiKey`, `removeApiKey`, `checkApiKey`.
    // ⚑ 90 → 93 with the Providers screen's reads: `providerVersions`, `providerUsage`,
    // `providerResources`.
    // ⚑ 93 → 92 at D-049: `providerModels` out — the window asks the list door.
    // ⚑ 92 → 94 at D-032: `drawResource`, `revealResource`.
    // ⚑ 94 → 95 at F093: `whatThisAgentWasGiven`. 95 → 96 at C9 d: `whatTheModelGot`.
    // ⚑ 96 → 97 at F097: `waitingOnWhoWroteForAPerson`.
    // ⚑ 97 → 96 at D-049's rest: `models` out — no window asked it.
    // ⚑ 96 → 97: `providerSetup`.
    // ⚑ Among them, a message's paths: `resolveMessagePaths`, `openMessagePath`, `revealMessagePath`.
    // ⚑ 100 → 102: the kept rules, `keptRules` and `removeKeptRule`.
    // ⚑ 102 → 106: archiving, restoring and deleting a conversation, and the delete's check.
    // ⚑ 106 → 107: `stopLooking`.
    // ⚑ 108 → 110: an agent's request to register an MCP server, read and decided.
    // Move, the held stop word and work search each add their own payload: 110 → 113.
    // ⚑ And `takeBackWork`, a person's take-back of the piece a service is on: 113 → 114.
    // ⚑ And `setServicesOn`, a person's services switch: 114 → 115.
    // ⚑ And `stoppedWorkForAPerson`, the pieces whose helper stopped: 115 → 116.
    // Link resolution, both typed-wait verbs and recent activity are present in the same bridge.
    expect(Object.keys(HOW_EACH_VERB_IS_BUILT)).toHaveLength(130)
    // ⚑ 8 → 10 at `744`: `savedDrafts`, `saveDrafts`. 10 → 9 at D-016: `getDemoSeed` out.
    // ⚑ 9 → 10 at D-031: `localZone`.
    expect(Object.keys(THE_APP_CHANNELS)).toHaveLength(10)
    // ⛔ **The split, pinned, because two comments quote it** (363). `§7` exists for the rows that
    // carry the commonest answer, and *"the value 84 others carry"* is a claim about this number —
    // an unasserted one is a sentence that goes quietly wrong on the next merge.
    const split = (how: HowThePayloadIsBuilt): number =>
      Object.values(HOW_EACH_VERB_IS_BUILT).filter((entry) => entry.how === how).length
    expect([split('plain-by-construction'), split('nothing'), split('handed-over')]).toEqual([
      // ⚑ **398 added `questionsForAPerson` to the MIDDLE number, and `403` added
      // `decisionsForAPerson` to it too.** Neither touched the first, which is what kept
      // *"the value 38 others carry"* true through two merges that never mentioned it. 🔴 **419's
      // `createAgent` DID touch it**, so the first number moved and the three sentences quoting it
      // moved with it, in the same commit — `a-number-can-survive-the-death-of-its-derivation`.
      // ⚑ **433's `setAgentProvider` moved it again**, and it is the same lesson twice: a verb whose
      // payload is two primitives lands in the first number, and the sentence four lines up is the
      // one that would otherwise have gone quietly wrong.
      // ⚑ **438's `digest` moved the FIRST number**, for `433`'s reason exactly: a window is
      // two primitive fields written at the call site.
      // ⚑ **441's `decideProposal` moves it again**, and it is the same lesson a fourth time: two
      // strings and a boolean, built at the call site.
      // ⚑ **446's `proposalsForAPerson` moves the MIDDLE number**, joining its two siblings there:
      // it carries no payload at all, so there is nothing for the call site to build or hand over.
      // ⚑ **462's `readToolAnswer` moves the FIRST number**, for `433`'s reason a fifth time: the
      // call site writes `{ sessionId, toolCallId }` itself and both fields are strings. ⛔ **And it
      // moved the two sentences that quote it, in this commit** — that is the whole of the rule
      // `a-number-can-survive-the-death-of-its-derivation` states.
      // ⚑ **467's `conversationsInProject` moves the FIRST number**, for `433`'s reason a sixth
      // time: the call site writes `{ projectSlug }` itself and the field is a string. ⛔ **And it
      // moved the two sentences that quote it, in this commit** — the row above this assertion and
      // `setSpawningEnabled`'s, which both say how many others carry this value.
      // ⚑ **500's `setDefaultApprovalMode` moves the FIRST number**, for `433`'s reason a seventh
      // time: the call site writes `{ mode }` itself and a word is a primitive. ⛔ **And it moved
      // the two sentences that quote it, in this commit** — the row above this assertion and
      // `setSpawningEnabled`'s. ⚠️ `446` found that pair one short because a dispatch moved the
      // number and not the sentences; this is the rule being followed rather than re-learned.
      // ⚑ **508's `tasksAssignedBy` moves the FIRST number**, for `433`'s reason an eighth time:
      // the call site writes `{ sessionId }` itself and a session id is a string. ⛔ **And it moved
      // the two sentences that quote it, in this commit** — the row above this assertion and
      // `setSpawningEnabled`'s.
      // ⚑ **510's `readCanonicalDocument` moves the FIRST number**, for `433`'s reason a sixth
      // time — one string, written as an object literal at the call site. ⛔ **And it moved the
      // THIRD sentence quoting this number, in §7, which had said 38 since `363`** and which five
      // previous dispatches walked past.
      // 🔴 **THE INTEGRATION: both of the two above moved this number by one, so it moved by TWO.**
      // ⚠️ **Each branch wrote the identical literal, so `toHaveLength` auto-merged with NO conflict
      // and was wrong by one on a tree neither dispatch gated** — the only conflict git raised was in
      // the prose four lines up. ⛔ Resolved by COUNTING the merged record (65 verbs, 48/11/6) rather
      // than by adding one to one; `a-number-can-survive-the-death-of-its-derivation` has a merge
      // shape, and this is it.
      // ⚑ **516's two registry writes move the FIRST number by TWO**, for `433`'s reason a ninth
      // and tenth time: each call site writes its own literal and every field is a string. ⛔ **And
      // they moved all THREE sentences quoting this number, in this commit** — the row above this
      // assertion, `setSpawningEnabled`'s, and §7's, which is the one five dispatches walked past.
      // ⚑ **533's `limitsForAPerson` moves the MIDDLE number**, joining its three siblings there:
      // it carries no payload at all, so there is nothing for the call site to build or hand over.
      // ⛔ **The FIRST number does not move, so the three sentences quoting it — the row above this
      // assertion, `setSpawningEnabled`'s, and §7's — are untouched**, and that was CHECKED rather
      // than assumed: `a-number-can-survive-the-death-of-its-derivation` costs the same whether a
      // dispatch moves a number it should not or leaves one it should.
      // ⚑ **543's `whoCalledWhom` moves the FIRST number**, for `433`'s reason an eleventh time:
      // the call site writes `{ sessionId }` itself and a session id is a string. ⛔ **And it moved
      // all THREE sentences quoting this number, in this commit** — the row above this assertion,
      // `setSpawningEnabled`'s, and §7's, which is the one five dispatches walked past.
      // ⚑ **550's `documentsInProject` moves the FIRST number**, for `433`'s reason a twelfth
      // time: the call site writes `{ projectSlug }` itself and the field is a string off a
      // `project` row. ⛔ **And it moved all THREE sentences quoting this number, in this commit**
      // — the row above this assertion, `setSpawningEnabled`'s, and §7's.
      // ⚑ **557's `stalledWorkForAPerson` moves the MIDDLE number**, joining its four siblings
      // there: `{ kind: 'stalledWorkForAPerson' }` carries no payload at all, so there is nothing
      // for the call site to build or hand over. ⛔ **The FIRST number does not move, so the three
      // sentences quoting it — the row above this assertion, `setSpawningEnabled`'s, and §7's —
      // are untouched**, and that was CHECKED rather than assumed, which is `533`'s own note and
      // costs the same either way.
      // ⚑ **567's `readWorkspace` moves the MIDDLE number**, joining its five siblings there:
      // `{ kind: 'readWorkspace' }` carries no payload at all, so there is nothing for the call
      // site to build or hand over. ⛔ **The FIRST number does not move, so the three sentences
      // quoting it — the row above this assertion, `setSpawningEnabled`'s, and §7's — are
      // untouched**, and that was CHECKED rather than assumed. ⚠️ **The three are not spelled the
      // same, which is why a single grep would have missed one**: `<n> others` twice (the
      // `setSpawningEnabled` row and §2's own note) and `<n> other rows` once, in §7 — the copy five
      // dispatches walked past. ⛔ **582 took the NUMBER out of this sentence**, because the
      // sentence is about the three SPELLINGS and a number written into it goes stale every time
      // the count it is warning about moves — which it had, twice, before anybody noticed. 🔴 **None of the three names the MIDDLE number**, which is quoted
      // only by the assertion — where a count belongs, and where `621` had to put it back after
      // this sentence spelled it out and went stale by one.
      // ⚑ **558 moved the FIRST number by two**, for `433`'s reason exactly: `setAgentDisplayName`
      // and `removeAgent` both carry primitives a window typed, so both land in
      // `plain-by-construction`. ⛔ **The three sentences quoting the first number are corrected in
      // this commit** — the row above this assertion, `setSpawningEnabled`'s, and §7's — because
      // `a-number-can-survive-the-death-of-its-derivation` is what happens when they are not.
      // ⚑ **575's `whatIsBeingDone` moves the MIDDLE number**, joining its six siblings there:
      // `{ kind: 'whatIsBeingDone' }` carries no payload at all, so there is nothing for the call
      // site to build or hand over. ⛔ **The FIRST number does not move, so the three sentences
      // quoting it — the row above this assertion, `setSpawningEnabled`'s, and §7's — are
      // untouched**, and that was CHECKED rather than assumed (`533`'s note, and it costs the same
      // either way).
      // ⚑ **582 moves the FIRST number by THREE** — `instructAgent`, `agentInstructions` and
      // `decideInstruction` each carry primitives a window typed, so all three land in
      // `plain-by-construction`. ⛔ **The three sentences quoting the first number are corrected in
      // this commit** — the row above this assertion, `setSpawningEnabled`'s, and §7's — which is
      // `558`'s own discipline and the rule `a-number-can-survive-the-death-of-its-derivation`
      // states.
      // ⚑ **625 moves the FIRST number by TWO** — `agentMemory` and `amendAgentMemory` both carry
      // primitives a window typed or chose from a closed vocabulary, so both land in
      // `plain-by-construction`. ⛔ **The three sentences quoting the first number are corrected in
      // this commit** — the row above this assertion, `setSpawningEnabled`'s, and §7's — and they
      // were found by grepping the three SPELLINGS rather than the assertion, which is the note six
      // paragraphs up saying a single grep would have missed one.
      // ⚑ **621's `whatEachConversationIsWaitingOn` moves the MIDDLE number**, joining its seven
      // siblings there: `{ kind: 'whatEachConversationIsWaitingOn' }` carries no payload at all,
      // so there is nothing for the call site to build or hand over. ⛔ **The FIRST number is not
      // `621`'s to move, so the three sentences quoting it are 625's above and are untouched by
      // this row** — CHECKED on the MERGED tree and not assumed.
      // 🔴 **And one number in PROSE was already stale and is corrected here**: the sentence four
      // lines up said the middle number *"is quoted only by the assertion"* and then quoted it,
      // at `14`, while the assertion said `15`. ⛔ It is the very defect that sentence exists to
      // warn about, so the repair is to take the number OUT rather than to bump it —
      // `a-number-can-survive-the-death-of-its-derivation`.
      // 🔴 **THE INTEGRATION, and this file's own rule for it**: `625` moved the FIRST number and
      // `621` the MIDDLE, on two branches neither of which saw the other. ⛔ **Resolved by COUNTING
      // the merged record — 82 verbs, 60/16/6 — rather than by adding one to one**, which is the
      // merge shape `516`'s note records and which auto-merged wrong once before.
      // ⚑ **637's `theWholeForest` moves the MIDDLE number**, joining its eight siblings there:
      // `{ kind: 'theWholeForest' }` carries no payload at all — the answer is rooted at the person
      // and the bound is a constant rather than a page — so there is nothing for the call site to
      // build or hand over. ⛔ **The FIRST number is not 637's to move, so the three sentences
      // quoting it are untouched** — CHECKED by grepping all three SPELLINGS, not assumed.
      // ⚑ **677 moves the FIRST number by TWO** — `setAgentModelAndEffort` and
      // `agentModelAndEffort` each carry primitives a window chose, so both land in
      // `plain-by-construction`. ⛔ **The three sentences quoting the first number are corrected in
      // this commit** — the row above this assertion, `setSpawningEnabled`'s, and §7's — found by
      // grepping the three SPELLINGS, as the note above says to.
      // ⚑ **689's `providerModels` moves the FIRST number**, for `433`'s reason once more: the
      // preload writes `{ kind, provider, profileId }` itself and both fields are primitives.
      // ⛔ **The three sentences quoting the first number are corrected in this commit** — the row
      // above this assertion, `setSpawningEnabled`'s, and §7's — found by grepping the three
      // SPELLINGS.
      // ⚑ **733's `readConfigFile` moves the FIRST number**, for `433`'s reason again: the call site
      // writes `{ sessionId, name }` itself and both are strings. ⛔ **The three sentences quoting
      // it are corrected in this commit** — the row above this assertion, `setSpawningEnabled`'s,
      // and §7's — found by grepping the three SPELLINGS.
      // ⚑ **735's `startAndSend` moves the FIRST number**, for `send`'s reason: the preload writes
      // the outer literal and every field is `send`'s. ⛔ **The three sentences quoting it are
      // corrected in this commit** — found by grepping the three SPELLINGS.
      // ⚑ **D-017 · R19's `instructionAsksForAPerson` moves the MIDDLE number**, joining its
      // siblings there: `{ kind: 'instructionAsksForAPerson' }` carries no payload at all.
      // ⛔ **The FIRST number does not move, so the three sentences quoting it are untouched** —
      // CHECKED by grepping the three SPELLINGS, not assumed.
      // ⚑ **D-017b moves the FIRST number down by ONE** — `look` in (`{ sessionId, claim }`, written
      // by `store.look`), `libraryEntry` and `readArchived` out. ⛔ **The three sentences quoting it
      // are corrected in this commit** — found by grepping the three SPELLINGS.
      // ⚑ **D-016 moves the FIRST number down by SIX and the MIDDLE by TWO** — `decideProposal`,
      // `conversationsInProject`, `documentsInProject`, `project`, `createProject` and
      // `saveProject` out of the first; `proposalsForAPerson` and `projects` out of the middle.
      // ⛔ **The three sentences quoting the first number are corrected in this commit** — found by
      // grepping the three SPELLINGS.
      // ⚑ **D-016 · R4's `retitleWork` moves the FIRST number**, for `433`'s reason again: the call
      // site writes `{ piece, title }` itself and both are strings. ⛔ **The three sentences quoting
      // it are corrected with it** — found by grepping the three SPELLINGS.
      // ⚑ **D-018's `processMemory` moves the MIDDLE number**, joining its siblings there:
      // `{ kind: 'processMemory' }` carries no payload at all. ⛔ **The FIRST number does not move,
      // so the three sentences quoting it are untouched** — CHECKED by grepping the three SPELLINGS.
      // ⚑ **D-026's `filesKept` moves the FIRST number**: the preload writes `{ kind, ...input }`
      // itself and every field is a string. ⛔ **The three sentences quoting it are corrected with
      // it** — found by grepping the three SPELLINGS.
      // ⚑ **D-042 moves the FIRST number by FOUR** — `modelList`, `addHandAddedModel`,
      // `deleteHandAddedModel` and `setAgentModelLimit`: the preload writes each literal itself
      // (copying the limit's array), and no window calls any of them yet.
      // ⛔ **The three sentences quoting it are corrected with it** — found by grepping the three
      // SPELLINGS.
      // ⚑ **D-050 moves the FIRST number down by ONE** — `setAgentModelLimit` out, with the agents'
      // limit. ⛔ **The three sentences quoting it are corrected with it** — found by grepping the
      // three SPELLINGS.
      // ⚑ **The API keys move the FIRST number by FOUR** — `apiKeyStatus`, `setApiKey`,
      // `removeApiKey` and `checkApiKey` are each built by the preload. ⛔ **The three
      // sentences quoting the first are corrected with it** — found by grepping the three SPELLINGS.
      // ⚑ **The Providers screen's three reads move the MIDDLE number by THREE**: no payload at
      // all. ⛔ The FIRST number does not move, so the sentences quoting it are untouched.
      // ⚑ **D-049 moves the FIRST number down by ONE** — `providerModels` out. ⛔ **The three
      // sentences quoting it are corrected with it** — found by grepping the three SPELLINGS.
      // ⚑ **D-032 moves the FIRST number by TWO** — `drawResource` and `revealResource`, each
      // `{ kind, resourceId }` written by the preload. ⛔ **The three sentences quoting it are
      // corrected with it** — found by grepping the three SPELLINGS.
      // ⚑ **F093's C9 d moves the FIRST number by ONE** — `whatTheModelGot`. ⛔ **The three
      // sentences quoting it are corrected with it.**
      // ⚑ **F097's `waitingOnWhoWroteForAPerson` moves the MIDDLE number**, joining its siblings
      // there: `{ kind: 'waitingOnWhoWroteForAPerson' }` carries no payload at all. ⛔ **The FIRST
      // number does not move, so the three sentences quoting it are untouched** — CHECKED by
      // grepping the three SPELLINGS, not assumed.
      // ⚑ **D-049's rest moves the FIRST number down by ONE** — `models` out. ⛔ **The three
      // sentences quoting it are corrected with it** — found by grepping the three SPELLINGS.
      // ⚑ `providerSetup` carries no payload: the middle number, 21 → 22.
      // ⚑ A message's three path verbs are in the FIRST number: the preload writes each literal.
      // ⚑ `removeKeptRule` is in the FIRST number (three strings the preload writes), `keptRules`
      // in the middle one (no payload).
      // ⚑ Archive, restore, the delete and its check move the FIRST number by four; the three
      // sentences quoting it are corrected with it.
      // ⚑ `stopLooking` moves the FIRST number by one (`{ kind, sessionId }` written by the
      // preload); the three sentences quoting it are corrected with it.
      // ⚑ `decideMcpServerRequest` moves the FIRST number by one and `mcpServerRequestsForAPerson`
      // the middle one; the three sentences quoting the first are corrected with it.
      // The held stop and Move add plain payloads; work search hands over its query.
      // ⚑ `takeBackWork` moves the FIRST number by one (`{ kind, piece }` written by the preload);
      // the three sentences quoting it are corrected with it.
      // ⚑ So does `setServicesOn` (`{ kind, on }` written by the preload).
      // ⚑ `stoppedWorkForAPerson` moves the MIDDLE number by one: it carries no payload.
      // Link resolution and action answers build literals; incident reads carry no payload.
      // Recent activity adds one plain packet, built from two numeric window bounds.
      95, 27, 8,
    ])
  })

  it('🔴 the handed-over verbs are independently named', () => {
    const handed = Object.entries(HOW_EACH_VERB_IS_BUILT)
      .filter(([, entry]) => entry.how === 'handed-over')
      .map(([kind]) => kind)
      .sort()
    expect(handed).toEqual([
      'cancelProviderSignIn',
      'respondPermission',
      'respondUserInput',
      'revealPath',
      'searchWork',
      'setCapabilities',
      'setSessionSetting',
      'skills',
    ])
  })

  it('⚠️ and each says what was traced to its producer', () => {
    for (const [kind, entry] of Object.entries(HOW_EACH_VERB_IS_BUILT)) {
      if (entry.how !== 'handed-over') continue
      expect(
        entry.note,
        `${kind} is handed over and says nothing about why that is safe`,
      ).toBeTruthy()
      expect(entry.note?.length ?? 0).toBeGreaterThan(80)
    }
  })

  /**
   * ⛔ **The bound this table cannot cross, written down rather than implied** (`361` §1's *"correct
   * me"*). It records how each call site builds its payload TODAY. It is not a guard: a component
   * that starts handing a reactive value to `close` tomorrow makes this row stale and nothing here
   * goes red. ⚑ **The guard is the wire** — the DOM setup file and `throughTheWire` — and this table
   * is the enumeration that says the guard was pointed at EVERY one of them.
   *
   * ⚠️ **This said *"all 59 of them"* and had been wrong since `355`** (found at `403`). `365`
   * wrote it when the two counts below were 51 and 8; three verbs have been added since and the
   * sentence went with none of them. ⛔ **A number in prose outlives the derivation that produced
   * it** — `a-number-can-survive-the-death-of-its-derivation` — so this now points at the two
   * counts §2 ASSERTS rather than restating their sum, which is the only version of the claim a
   * gate can keep true.
   */
  it('⚑ nothing but a `handed-over` row carries a note, so the notes stay the exception', () => {
    const noisy = Object.entries(HOW_EACH_VERB_IS_BUILT).filter(
      ([, entry]) => entry.how !== 'handed-over' && entry.note !== undefined,
    )
    expect(noisy).toEqual([])
  })
})

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
  expect(surface.get('plugins')).toMatch(/^ {2}plugins: pluginsBridge\(ipcRenderer\),/)
  surface.delete('plugins')
  const plugins = membersOf(
    withoutProse(source('src/preload/plugins.ts')).replace(/^ {4}(?=\w)/gm, '  '),
  )
  expect([...plugins.keys()].sort()).toEqual(['onClosed', 'request'])
  expect(plugins.get('onClosed')).toContain('ipc.on(PLUGIN_SCREEN_CLOSED, notify)')
  expect(plugins.get('onClosed')).toContain('ipc.off(PLUGIN_SCREEN_CLOSED, notify)')
  for (const [name, body] of plugins)
    surface.set(name, body.replace('ipc.invoke', 'ipcRenderer.invoke'))
  return surface
}

describe('§3 · what is exempt is derived from the preload, not written down (361 §2)', () => {
  const surface = preloadSurface()
  /** A member reaches the wire if its own body invokes, or goes through the `command` helper. */
  const invokes = (body: string): boolean =>
    body.includes('ipcRenderer.invoke') || /(?:^|[^\w.])command\(/.test(body)

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

  /**
   * ⛔ **The stripper's own killer, and it needs one.** Measured today: stripping the prose changes
   * the roster not at all — both readings give `onClosing`, `onEvent`, `onLiveness`,
   * `pathForDroppedFile` — so the `withoutProse` call is a line no mutation of the preload could
   * make red, and a line no mutation can kill is not carrying its rule. ⚑ **This is the rule**: a
   * docblock that quotes the call is not the call. The preload is the most heavily commented file
   * in the app and `pathForDroppedFile`'s own docblock is three paragraphs about `invoke` and bytes;
   * it is one edit away from saying the word.
   */
  it('🔴 prose that quotes the call is not the call', () => {
    const planted = [
      '  /**',
      '   * Never crosses the wire — there is no `ipcRenderer.invoke` here and no `command(` either.',
      '   */',
      '  pathForDroppedFile: (file: File): string => webUtils.getPathForFile(file),',
    ].join('\n')
    expect(invokes(planted), 'the fixture is not one the raw reading would wave through').toBe(true)
    expect(invokes(withoutProse(planted))).toBe(false)
    // ⚑ …and the stripper does not eat the code beside the comment.
    expect(withoutProse(planted)).toContain('webUtils.getPathForFile(file)')
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

/* --------------------------------------------------- §4 · a guard nothing registers is dark (310) */

describe('§4 · the DOM project really runs the wire (361 §3)', () => {
  it('⛔ `vitest.dom.config.ts` registers the setup file that arms it', () => {
    const config = source('vitest.dom.config.ts')
    expect(config).toContain("setupFiles: ['test/dom/setup/the-window-is-a-wire.ts']")
  })

  /**
   * ⛔ **The trap is on the PROTOTYPE, and this is the assertion that keeps it there.** Ten DOM
   * tests `delete window.api` in an `afterEach`; an own accessor is removed by that delete and every
   * later test in the file runs unguarded, with the suite still green. Moving it back to `window`
   * would be a one-word edit that nothing else in the repo would notice.
   */
  it('⛔ and the trap is installed where `delete window.api` cannot remove it', () => {
    const setup = source('test/dom/setup/the-window-is-a-wire.ts')
    expect(setup).toContain("Object.defineProperty(Object.getPrototypeOf(window) as object, 'api'")
    expect(setup).toContain('everythingOverTheWire(stub)')
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

/* ------------------------ §6 · the node project's own doubles, derived from the import (361 §2) */

/**
 * ⛔ **Every test that builds a RENDERER store, found by the import that builds one.**
 *
 * ⚠️ **`readdirSync`, not `grep`.** `grep -rn` prints nothing at all for
 * `whole-session-reads.test.ts` in this tree — measured, repeatedly — so any census of this
 * directory built on a shell search is short by at least one file before it starts.
 *
 * ⛔ **It matches the FACTORY import, not the module.** `handed-path-send.test.ts` imports
 * `overTheWire` from the same file and builds no store at all; a module-shaped match would put it in
 * the set and then be held there by a sentence saying it did not belong (`345`'s lesson, where a
 * roster admitted a file on the strength of a comment). ⚑ The alias form
 * `createSessionStore as createRendererStore` is what the two demo tests use, and it is matched.
 */
const BUILDS_A_RENDERER_STORE =
  /import \{[^}]*\bcreate(?:Session|Project)Store\b[^}]*\} from '(?:\.\.?\/)+src\/renderer\/src\/lib\/(?:session|project)-store'/

const IMPORTS_THE_WIRE = /from '(?:\.\.?\/)*lib\/the-wire'/

/**
 * ⛔ **And CALLS it, which is the half the import alone cannot say.** Measured while verifying this
 * table's rows: deleting the call and leaving the import behind kept four rows green — an unused
 * import is a lint error and lint is not a gate the mutation harness runs, so the census has to ask
 * for the call itself. ⚑ `throughTheWire` is `session-store.test.ts`'s own name for the wrapper it
 * builds out of `asTheWireWouldCarry`, so all three spellings are one thing.
 */
const RUNS_THE_WIRE = /\b(?:asTheWireWouldCarry|everythingOverTheWire|throughTheWire)\s*\(/

const storeBuilders = readdirSync(HERE)
  .filter((name) => name.endsWith('.test.ts'))
  .filter((name) => BUILDS_A_RENDERER_STORE.test(readFileSync(join(HERE, name), 'utf8')))
  .sort()

describe('§6 · every double the renderer store runs on is a wire (361 §2)', () => {
  it('⛔ the roster is derived, non-empty, and is exactly the files that build one', () => {
    // ⚑ Derived AND pinned, which is not a contradiction: the derivation does the covering, and
    // the equality makes a file JOINING or LEAVING the set a red somebody acknowledges in a diff.
    expect(storeBuilders).toEqual([
      // 🔴 **This file, from `739`.** It builds a real `createSessionStore` over the wire to measure
      // `737` F-6: a command with no answer lets go of `busy` at its bound, and its late answer lands.
      'a-command-that-has-no-answer.test.ts',
      // ⚑ **`701`** — the real renderer store over the real host's commands, through the wire's
      // clone: a first message to a conversation the quit left open is what starts it, and End
      // reaches the host with no record in the window.
      'a-conversation-a-quit-left-open-starts-on-its-first-message.test.ts',
      // 🔴 **D-004 · R101.** It builds a real `createSessionStore` over the wire, cloning the
      // ANSWER as `653`'s does, to measure a window taking back a conversation the host reopened on
      // a renewed sign-in — the hand-over it adopts is IN the answer.
      'a-conversation-reopens-on-a-renewed-sign-in.test.ts',
      // ⚑ **Landing D-017b · both new suites build a real renderer store over the wire** — the look
      // door, and the first message from a conversation's view.
      'a-look-takes-what-a-press-may-take-and-nothing-else.test.ts',
      'a-message-from-a-conversations-view-goes-where-the-host-ruled.test.ts',
      // 🔴 **This file, from `725`.** It builds a real `createSessionStore` over the wire to measure
      // `716` F-1: a start ASKS main for its refusal's word, and the store keeps it beside the sentence.
      'a-refusal-that-said-why-is-not-asked-again.test.ts',
      // 🔴 **This file, from `678`.** It builds a real `createSessionStore` over the wire and a
      // real draft book beside it, to measure R26 in the gap between a reopen's close and its
      // resume — the one place a conversation is out of `store.live` while its draft must stay.
      'a-reopen-keeps-the-draft.test.ts',
      // 🔴 **This file, from `653`.** It builds a real `createSessionStore` over the wire to
      // measure what a person is shown when they take over a conversation whose running life was
      // itself a reopen — and, like `479`'s, it clones the ANSWER as well as the arguments,
      // because the field it adds (`ResumedSession.liveFrom`) is IN the answer, and a claim's
      // answer read by reference would pass whether or not the field survived the trip.
      'a-woken-conversation-drawn-as-ended.test.ts',
      'an-agent-gives-work-a-person-decides.demo.test.ts',
      // ⚑ **This file, from `718`.** §5 builds a real `createSessionStore` over the wire to measure
      // `710` F-9: a start from the StartAsAgent sheet is its OWN launch — its own key, its own
      // error ref and its own Cancel — so the launcher is neither put into `starting` by it nor
      // handed its refusal.
      'compact-now-and-what-main-now-carries.render.test.ts',
      'host-renderer-agreement.test.ts',
      // ⚑ **This file, from `401`.** §7 builds a real `createSessionStore` over the wire to
      // measure the one store read whose refusal is a VALUE rather than a rejection, so the
      // derivation picks it up — and it passes both halves below, which is what joining this
      // roster is for.
      'persons-queue.test.ts',
      // The store reads host failures and recovery answers through the same cloned wire as the app.
      'session-store-reading-failures.test.ts',
      'session-store.test.ts',
      // ⚑ **This file, from `365`.** §8 builds a real `createSessionStore` over the wire to measure
      // `356`'s two verbs, so the derivation correctly picks it up — and it passes both halves
      // below, which is the point: the roster is derived, and a file that joins it says so here.
      'the-bridge-that-clones-nothing.test.ts',
      'the-conversation-nobody-asked-for.demo.test.ts',
      // ⚑ **Landing D-018** — a real renderer store over the wire, to read a running agent's memory
      // as the window asks for it, and a refused read as null.
      'the-memory-a-running-agent-holds-is-read-by-pid-and-never-kept.test.ts',
      // ⚑ **Landing D-017b** — a real renderer store over the wire, to see where the person is taken
      // when a message goes to a conversation that took a recorded one's place.
      'the-person-is-taken-to-the-conversation-that-took-a-recorded-ones-place.test.ts',
      // 🔴 **This file, from `473`.** §2 builds a real `createSessionStore` over the wire AND a
      // real `createPersonsQueue` beside it, because the defect it measures is born in the queue's
      // deep `ref` and only becomes visible at the clone. ⛔ It is the first file in this roster
      // whose subject is a PRODUCER rather than a door — see §9.
      'the-press-that-cloned-nothing.test.ts',
      // 🔴 **This file, from `468`.** §1 builds a real `createSessionStore` over a bridge whose
      // answer it HOLDS OPEN, so the assertion lands between `markSent` and `noteAnswer` — the
      // gap the whole dispatch is about. ⛔ Its first draft did not go over the wire and this
      // census is what said so, which is the second time the derived half has caught a file on
      // the day it joined.
      'the-press-that-shows-nothing.test.ts',
      // ⚑ **This file, from `418`.** It builds a real `createSessionStore` over the wire to measure
      // what a person's rail says about a conversation an agent started — so the derivation picks
      // it up, and it passes both halves below, which is what joining this roster is for.
      // ⚑ **This file, from `508`.** §2 builds a real `createSessionStore` over the wire to measure
      // the one thing a store double can answer and the host cannot: that a dropped IPC call
      // becomes `null` rather than an empty walk. ⛔ Its first draft did NOT go over the wire, and
      // this census is what said so — the third time the derived half has caught a file on the day
      // it joined. ⚠️ It also asserted the answer by IDENTITY, which the double allows and the wire
      // does not; that is now a `toEqual`.
      'the-work-this-conversation-gave-out.test.ts',
      'two-sessions-of-one-agent.demo.test.ts',
      // ⚠️ **D-016** deleted `a-list-that-notices.test.ts`, `project-store.test.ts` and
      // `what-approving-a-proposal-actually-does.test.ts` with the project store and proposals.
    ])
  })

  it('🔴 and each of them clones its payload the way `ipcRenderer.invoke` does', () => {
    for (const name of storeBuilders) {
      const code = readFileSync(join(HERE, name), 'utf8')
      const why = `${name} builds a renderer store over a double that clones nothing`
      expect(IMPORTS_THE_WIRE.test(code), why).toBe(true)
      expect(RUNS_THE_WIRE.test(code), why).toBe(true)
    }
  })

  it('⚑ …and the two halves of that really are two halves', () => {
    // ⛔ The pair. An import with no call is exactly what a row that deleted the call leaves
    // behind, and it is the shape four of this dispatch's own mutation rows survived as.
    const importOnly = "import { everythingOverTheWire } from './lib/the-wire'\nreturn ({})"
    expect(IMPORTS_THE_WIRE.test(importOnly)).toBe(true)
    expect(RUNS_THE_WIRE.test(importOnly)).toBe(false)
  })

  it('⚑ a file that merely imports the module is not treated as building a store', () => {
    // The control for the derivation's shape: `handed-path-send.test.ts` takes `overTheWire` from
    // the very same module and is correctly outside the set. Without this, widening the regex to
    // the module path would go unnoticed.
    const neighbour = readFileSync(join(HERE, 'handed-path-send.test.ts'), 'utf8')
    expect(neighbour).toContain("from '../src/renderer/src/lib/session-store'")
    expect(BUILDS_A_RENDERER_STORE.test(neighbour)).toBe(false)
    expect(storeBuilders).not.toContain('handed-path-send.test.ts')
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

  /**
   * ⛔ **What the `plain-by-construction` rows are actually claiming, asserted where a change
   * would break it.** Neither `projectSlug` nor `enabled` nor `mode` can be a Proxy — a `string` is
   * a string, a `boolean` is a boolean and a word out of a two-member union is a word, however they
   * were read — so the ONLY way one of these verbs joins `cancelProviderSignIn` is the store handing
   * the whole payload over instead of writing the wrapper. ⚑ That is a one-word edit, it is what
   * `361` found at the fourth site, and this is the line that would go red for it.
   *
   * ⚠️ **Prose stripped first** (`345`): `agent-store.ts` names all four verbs in its docblocks.
   */
  it('⛔ the store writes each wrapper itself rather than handing a payload over', () => {
    const code = withoutProse(source('src/renderer/src/lib/agent-store.ts'))
    expect(code).toContain('bridge.agentIdentities()')
    // ⚑ **516 · the wrapper grew a third field and the assertion moved with it rather than being
    // relaxed to a prefix.** ⛔ The array is REBUILT here — `[...externalMcpServerIds]` — for the
    // same reason the sheet's `grant()` builds a fresh object: the caller is a Vue component and its
    // ids come off a `reactive`, so forwarding its array would put a `Proxy` on the wire. ⚠️ That is
    // what keeps this row `handed-over` honest about which field is the hazard.
    expect(code).toContain('externalMcpServerIds: [...externalMcpServerIds],')
    expect(code).toContain('bridge.setSpawningEnabled({ enabled })')
    // ⛔ **516 · the registry's two writes, each wrapper written here** — `500`'s rule one verb over:
    // a `plain-by-construction` label with no line in this census is a label.
    // ⚑ **524 · three fields now, and the third is a literal out of a closed vocabulary** — still a
    // primitive, so the `plain-by-construction` verdict on this verb is unchanged and this line is
    // what says so rather than a memory of it.
    expect(code).toContain('reach: said.reach,')
    expect(code).toContain('bridge.removeExternalMcpServer({ serverId })')
    // 500. ⛔ **The fourth, and the row above cannot be its own evidence** — a `plain-by-construction`
    // label with no line here is a label, which is the defect this section exists for.
    expect(code).toContain('bridge.setDefaultApprovalMode({ mode })')
    // ⚑ The pair: the stripper is what makes the three above a claim about code. A docblock that
    // quoted the call would satisfy the raw reading and must not satisfy this one.
    const quoted = [
      '/**',
      ' * `bridge.setSpawningEnabled({ enabled })` is what this does.',
      ' */',
    ].join('\n')
    expect(quoted).toContain('bridge.setSpawningEnabled({ enabled })')
    expect(withoutProse(quoted)).not.toContain('bridge.setSpawningEnabled({ enabled })')
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

  /**
   * ⛔ **The line that would go red for the one-word edit that changes either answer** — the store
   * handing a payload over instead of writing the wrapper, which is what `361` found at the fourth
   * site. ⚠️ **Prose stripped first** (`345`): `session-store.ts` names both verbs in its docblocks.
   */
  it('⛔ the store writes each wrapper itself rather than handing a payload over', () => {
    const code = withoutProse(source('src/renderer/src/lib/session-store.ts'))
    expect(code).toContain('bridge.readInstructionSource({ sessionId, index })')
    expect(code).toContain('bridge.revealPath({ sessionId, target })')
    // ⚑ The pair, as §7 has it: a docblock that quoted the call satisfies the raw reading and must
    // not satisfy this one.
    const quoted = [
      '/**',
      ' * `bridge.revealPath({ sessionId, target })` is what this does.',
      ' */',
    ].join('\n')
    expect(quoted).toContain('bridge.revealPath({ sessionId, target })')
    expect(withoutProse(quoted)).not.toContain('bridge.revealPath({ sessionId, target })')
  })

  /**
   * ⛔ **And the four producers really are literals**, which is what the `handed-over` note claims.
   * ⚑ **Source rather than a DOM mount, and that is not a shortcut**: both components take the
   * reveal as a CALLBACK PROP, so mounting either one reaches no bridge at all — the payload is
   * assembled one hop above, in `session-store.ts`, which is exactly where the four tests above
   * drive it. ⚠️ Prose stripped: both files discuss these shapes in their docblocks.
   */
  it('⛔ every `SessionPathTarget` the app builds is an object literal at the press', () => {
    const info = withoutProse(source('src/renderer/src/components/SessionInfo.vue'))
    const instructions = withoutProse(source('src/renderer/src/components/SessionInstructions.vue'))
    expect(info).toContain("reveal('cwd', { of: 'cwd' })")
    expect(info).toContain("reveal('home', { of: 'home' })")
    expect(info).toContain("{ of: 'config-file', name: file.name }")
    expect(instructions).toContain("ask({ of: 'instruction-source', index })")
    // ⚑ W4.162 · the agent panel's Open folder builds the cwd target at its press too.
    const agentPanel = withoutProse(source('src/renderer/src/composables/useAgentPanel.ts'))
    expect(agentPanel).toContain("revealPath({ of: 'cwd' })")

    // ⛔ **And the four are ALL of them, which the four assertions above cannot say.** A negative is
    // only as strong as its search shape, so this walks the whole renderer rather than the two files
    // the note happens to name — `readdirSync`, never a shell search, for §6's reason. ⚑ The counts
    // are here too: a fifth target built in either of these files is as invisible to a file-name
    // roster as one built in a third.
    const renderer = join(HERE, '..', 'src/renderer')
    const builders = readdirSync(renderer, { recursive: true, encoding: 'utf8' })
      .filter((name) => name.endsWith('.ts') || name.endsWith('.vue'))
      .map(
        (name) => [name.replaceAll('\\', '/'), readFileSync(join(renderer, name), 'utf8')] as const,
      )
      .map(([name, code]) => [name, code.split(/\bof: '/).length - 1] as const)
      .filter(([, count]) => count > 0)
      .sort()
    expect(builders).toEqual([
      ['src/components/SessionInfo.vue', 3],
      ['src/components/SessionInstructions.vue', 1],
      ['src/composables/useAgentPanel.ts', 1],
    ])
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
    expect(handed.reduce((so, [, entry]) => so + entry.producers.length, 0)).toBe(17)
  })

  it('🔴 and each producer really builds it, in the file the row names', () => {
    for (const [kind, entry] of handed) {
      for (const producer of entry.producers) {
        // ⚠️ **Prose stripped first** (`345`): every one of these files discusses the shape it
        // builds in its own docblocks, and three of them quote the call itself.
        const code = withoutProse(source(producer.at))
        expect(
          code.includes(producer.builds),
          `${kind}: ${producer.at} no longer builds \`${producer.builds}\``,
        ).toBe(true)
      }
    }
  })

  it('⚑ …and the check can fail, in both readings', () => {
    // ⛔ The pair, for §3's reason: a predicate that answered `true` for everything would pass the
    // loop above no matter what the six rows said.
    const real = withoutProse(source('src/renderer/src/lib/permission-offer.ts'))
    expect(real.includes('permissionDecisionFor')).toBe(true)
    // ⛔ **The producer this dispatch MOVED, checked where it used to live** — `PermissionCard.vue`
    // held `function toDecision`, and asserting its absence from `permission-offer.ts` would be a
    // line no edit could ever redden (found by this dispatch's own review).
    const card = withoutProse(source('src/renderer/src/components/PermissionCard.vue'))
    expect(card.includes('permissionDecisionFor(outcome)')).toBe(true)
    expect(card.includes('function toDecision'), 'the second producer is back').toBe(false)
    // ⚠️ …and a docblock that quotes a producer is not that producer.
    const quoted = ['/**', ` * \`${THE_SHEETS_GRANT}\` is what the sheet does.`, ' */'].join('\n')
    expect(quoted.includes(THE_SHEETS_GRANT)).toBe(true)
    expect(withoutProse(quoted).includes(THE_SHEETS_GRANT)).toBe(false)
  })
})
