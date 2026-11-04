import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type ResumeOptions,
  type SessionRef,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { CAPABILITY_FIELDS, capabilityField } from '../src/shared/capabilities'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { composeProfileBundle, thisConversationSpans } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { conversationsToReopen, REOPENING_SAYS } from '../src/renderer/src/lib/reopening'
import { createSessionRecord, type SessionRecord } from '../src/renderer/src/lib/session-record'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const SRC = join(here, '../src')
const SHEET = join(SRC, 'renderer/src/components/CapabilitiesSheet.vue')
const PANE = join(SRC, 'renderer/src/components/ConversationPane.vue')
const SCREEN = join(SRC, 'renderer/src/components/RuntimeScreen.vue')

/**
 * Real host, SQLite and tool rails with a recording fake provider. Messaging changes affect
 * the next call while launch text changes only after reopening. Standing-rule authority is
 * fixed for every legacy grant value. The dormant descriptor remains schema metadata, and
 * the renderer's generic Reopen, draft and cost contracts are checked separately below.
 */

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/**
 * One launch, as the provider saw it.
 *
 * ⛔ **`who` is read out of the provider HOME and not passed in**, because the launch object is
 * the only thing this double is handed — which is the point of the double. `prepareProviderHome`
 * below lays every home down at `<userData>/provider-homes/<profileId>/<provider>`, so the
 * second-to-last segment is the identity this launch runs as.
 */
interface Launched {
  kind: 'start' | 'resume'
  who: string
  /** The instructions carried by this start or resume. */
  hint: string
}

const whoLaunched = (providerHome: string): string => {
  const parts = providerHome.split(sep)
  return parts[parts.length - 2] ?? '?'
}

class WatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly launches: Launched[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    this.launches.push({
      kind: 'start',
      who: whoLaunched(options.providerHome),
      hint: options.systemHint ?? '',
    })
    return handle
  }
  override async resume(
    ref: SessionRef,
    options: ResumeOptions,
  ): ReturnType<FakeRuntime['resume']> {
    const handle = await super.resume(ref, options)
    this.launches.push({
      kind: 'resume',
      who: whoLaunched(options.providerHome),
      hint: options.systemHint ?? '',
    })
    return handle
  }
}

const RETIRED_RELAY =
  "- You may propose rules for approval, or save a person's rule for another agent when they " +
  'gave it in this conversation.'
const RETIRED_RULE_DENIAL = "- You may not change or propose other agents' standing rules."
const FIXED_RULES =
  "- You can read any agent's standing rules and propose a replacement; the person decides. " +
  'A BroBot conversation the person started may also save one directly, but never its own. ' +
  'Each version keeps its author and reason, and the person can undo it.'
const MAY_MESSAGE = '- You may message any conversation.'
const MAY_NOT_MESSAGE = '- You may not send messages to other conversations.'

function expectFixedRules(hint: string): void {
  expect(hint).toContain(FIXED_RULES)
  expect(hint).not.toContain(RETIRED_RELAY)
  expect(hint).not.toContain(RETIRED_RULE_DENIAL)
}

/** Prose stripped from a component, both grammars — `464`'s rule, on `464`'s reason. */
function withoutProse(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
}

describe('470 · a grant that waits for the next launch', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let launches: Launched[]
  let counter: number
  let window: RecordingSink
  let clock: number
  const tick = (): number => clock++

  const buildHost = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => new WatchingRuntime('claude', launches, sessions),
      prepareProviderHome: (provider: Provider, profileId?: string) => {
        const home = join(userData, 'provider-homes', profileId ?? 'default', provider)
        mkdirSync(home, { recursive: true })
        return home
      },
      providerHomePath: (provider: Provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      now: tick,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
      // ⚑ **The composition root's own order** — compose, publish into the profile's home, read
      // with this conversation's own text — and the hint goes out as `index.ts` sends it.
      readInstructions: (provider, cwd, providerHome, context) => {
        const bundle = publishProfileBundle(provider, providerHome, composeProfileBundle(context))
        if (!bundle.ok) throw new Error(`the bundle was not published: ${bundle.reason}`)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          bundle,
          thisConversation: thisConversationSpans(context),
        })
        return {
          instructions: read.instructions,
          systemHint: read.systemHint ?? undefined,
          memoryLoaded: null,
        }
      },
    })

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-470-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-470-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = 5_000_000
    store = createSessionStore(db, tick)
    counter = 0
    launches = []
    sessions = new FakeProviderSessions()
    host = buildHost()
    window = new RecordingSink('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
    rmSync(work, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  /** An identity exists only once a person has run a conversation as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  const grant = (profileId: string, canWriteRules: 'none' | 'propose' | 'relay' | null): void => {
    expect(store.setCapabilities(profileId, { canWriteRules })).toBe(true)
  }

  /** The retired relay request shape must remain refused, including after a reopen. */
  const askToRelayARule = async (caller: string): Promise<string> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === 'propose_agent_rules')
    if (tool === undefined) throw new Error('no such tool: propose_agent_rules')
    const answered = (
      await tool.call({
        agent: 'worker',
        current_version: 0,
        rules: 'Keep the changelog current.',
        why: 'A person asked for it in this conversation.',
        already_agreed: true,
      })
    ).structured as Record<string, unknown>
    // ⛔ **The RAIL and not its sentence.** `425` gave every refusal a remedy and a permanence, so
    // the prose moves when the remedy does; the rail name is the identity of the decision.
    return String(answered.outcome === 'ok' ? 'ok' : answered.rail)
  }

  const callOn = async (
    caller: string,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = agentToolsFor(host, caller).tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  const messageWorker = (caller: string, worker: string): Promise<Record<string, unknown>> =>
    callOn(caller, 'message_agent', {
      agent: worker,
      kind: 'note',
      text: 'A fictional fixture note.',
    })

  /** Every launch this app has made for one identity, oldest first. */
  const launchesFor = (who: string): Launched[] => launches.filter((one) => one.who === who)

  /** A person ends a conversation and opens it again — `RuntimeScreen.closeAndReopen`. */
  const closeAndReopen = async (sessionId: string): Promise<void> => {
    await host.close(sessionId, window)
    await host.resumeSession(sessionId, window)
  }

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the schema declares WHEN, so the sentence cannot be attached to the wrong grant
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · dormant disclosure metadata stays intact without granting live authority', () => {
    it('⛔ every capability answers the question, and exactly one of them has something to say', () => {
      // 🔴 **Required and not optional, which is the whole forcing function.** HO-008 §3's promise
      // is that a new capability costs one entry in `CAPABILITY_FIELDS`; ⛔ a capability whose
      // grant is read at LAUNCH is one whose disclosure is load-bearing (`460` F2), and an
      // optional property is one the next author never has to think about.
      for (const field of CAPABILITY_FIELDS) {
        expect(field, field.key).toHaveProperty('whenItTakesEffect')
        const said = field.whenItTakesEffect
        expect(said === null || typeof said === 'string', field.key).toBe(true)
        if (said !== null) expect(said.length, field.key).toBeGreaterThan(80)
      }
      const speaking = CAPABILITY_FIELDS.filter((field) => field.whenItTakesEffect !== null)
      // The legacy descriptor is preserved even though the field is hidden and authority is fixed.
      expect(speaking.map((field) => field.key)).toEqual(['canWriteRules'])
    })

    it('🔴 no sentence names a grant’s label, so none has a literal to go stale — `464`’s hole, closed by shape', () => {
      // 🔴 **511 · every SPEAKING field, not one alone.** ⛔ A census that read one field by name
      // would go on measuring it the day a second one gained a sentence — *a category defined by
      // the pipe leaves everything outside the pipe unguarded* (rule 20), with the pipe being a
      // hard-coded key. ⚑ The subject is derived from the same filter the test above names.
      const speaking = CAPABILITY_FIELDS.filter((field) => field.whenItTakesEffect !== null)
      expect(speaking.length, 'nothing speaks, so the sweep below reads nothing').toBeGreaterThan(0)
      const said = capabilityField('canWriteRules').whenItTakesEffect ?? ''
      // ⛔ **`464`'s finding, in one line**: a sentence keyed on a grant by spelling its label went
      // on pointing at the field one row down after a rename. ⚑ **This sentence is keyed by WHERE
      // IT LIVES.** A rename cannot move it, and there is no label in it to be renamed — asserted
      // for every field, including its own.
      for (const speaker of speaking) {
        const sentence = (speaker.whenItTakesEffect ?? '').toLowerCase()
        for (const field of CAPABILITY_FIELDS) {
          expect(sentence, `${speaker.key} spells ${field.key}'s label`).not.toContain(
            field.label.toLowerCase(),
          )
        }
      }
      // ⚑ **The control — the sweep can see a label when one is there.** ⛔ **Planted INTO the
      // subject and not beside it**, which is the correction review made: a concatenation is a
      // tautology that never reads a byte of `said`, so an empty sentence passed the rows above
      // AND their control.
      const other = capabilityField('canCreateAgents').label
      const planted = said.replace(' ', ` ${other} `)
      expect(planted.toLowerCase(), 'the sentence failed to load').toContain(other.toLowerCase())
    })

    it('⚠️ the dormant descriptor retains both clocks without promising what a running model knows', () => {
      const said = capabilityField('canWriteRules').whenItTakesEffect ?? ''
      // Preserve the stored descriptor's wording without treating it as current launch policy.
      expect(said).toContain('A conversation reads this when it starts')
      expect(said).toContain('one already running keeps what it was told')
      expect(said).toContain('Narrowing it stops new requests')
      expect(said).toContain('never removes rules that are already saved')
      // 3 · ⛔ **and the thing it must not say.** The dispatch's §3: *"Do not write a sentence
      //     promising that a grant reaches a running conversation."* `460` F3 is unclosed, so no
      //     verb of telling appears here — `told` only in the clause above, which says the
      //     running one keeps what it had.
      expect(said).not.toMatch(/\b(tell|tells|notif\w*|inform\w*|let it know|picks? up)\b/i)
      // 4 · ⚑ **and it names no provider**, so it stays true of both adapters — `317`'s rule, and
      //     the reason `SPAWN_RAIL_MEANS` carries the same one.
      expect(said).not.toMatch(/claude|codex/i)
    })

    it('⛔ the app’s word for the gesture is REOPEN, and 470 did not invent a second one', () => {
      // 🔴 **Measured before a control was drawn.** The dispatch's own brief says *relaunch*; the
      // app says *Reopen on the current sign-in*, *Reopening keeps the transcript*, and
      // `Reopen ${row.label}` in the palette. ⛔ **`relaunch` is rendered nowhere in this app**,
      // and the first one would be a second word for a gesture that already has one.
      for (const field of CAPABILITY_FIELDS.filter((one) => one.whenItTakesEffect !== null)) {
        expect((field.whenItTakesEffect ?? '').toLowerCase(), field.key).not.toContain('relaunch')
      }
      const sheet = withoutProse(readFileSync(SHEET, 'utf8'))
      expect(sheet.toLowerCase()).not.toContain('relaunch')
      expect(sheet).toContain('>\n                Reopen\n              </button>')
      // ⚑ …and the offer under the grant says the same word.
      expect(sheet).toContain('Reopening one gives it what this row says now.')
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §2 · the boundary and the sentence, measured together — HO-028 §3's own requirement
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · legacy rules stay fixed; live messaging changes wait only in the launch snapshot', () => {
    it('a legacy grant change cannot reactivate the relay or relaunch a conversation', async () => {
      await bringIdentityIntoBeing('lead')
      await bringIdentityIntoBeing('worker')

      // An unconfigured legacy value receives the same fixed policy.
      const lead = await personOpens('lead')
      expect(launchesFor('lead').at(-1)?.kind).toBe('start')
      expectFixedRules(launchesFor('lead').at(-1)?.hint ?? '')
      const atLaunch = launchesFor('lead').length

      // The retired shortcut is refused regardless of this legacy value.
      expect(await askToRelayARule(lead)).toBe('malformed-request')

      // Changing the stored legacy value launches nothing and grants no new authority.
      // ⚑ **Compared against the SAME population**: `atLaunch` counts `lead`'s launches and this
      // counts every launch.
      const everyLaunch = launches.length
      grant('lead', 'relay')
      expect(launches.length, 'the write launched something').toBe(everyLaunch)

      // Changing the stored legacy value does not authorize a relay.
      expect(await askToRelayARule(lead)).toBe('malformed-request')
      expect(store.ownInstructionsOf('worker').versions).toHaveLength(0)

      // 5 · 🔴 **…and `lead`'s own provider handle was never re-launched**, so the words it was
      //     started with are still the ones it has — the first clause of the sentence, measured.
      expect(launchesFor('lead')).toHaveLength(atLaunch)
      expectFixedRules(launchesFor('lead').at(-1)?.hint ?? '')
      expect(capabilityField('canWriteRules').whenItTakesEffect).toContain(
        'A conversation reads this when it starts, so one already running keeps what it was told.',
      )

      // Reopening refreshes the launch object without granting the retired shortcut.
      await closeAndReopen(lead)
      expect(launchesFor('lead')).toHaveLength(atLaunch + 1)
      expect(launchesFor('lead').at(-1)?.kind).toBe('resume')
      expectFixedRules(launchesFor('lead').at(-1)?.hint ?? '')
      expect(await askToRelayARule(lead)).toBe('malformed-request')
      expect(store.ownInstructionsOf('worker').versions).toHaveLength(0)
    })

    it('changing a legacy grant leaves person rules saved and keeps the relay refused', async () => {
      await bringIdentityIntoBeing('lead')
      await bringIdentityIntoBeing('worker')
      host.instructAgent('worker', 'A person rule.', undefined, window)
      grant('lead', 'relay')

      const lead = await personOpens('lead')
      expectFixedRules(launchesFor('lead').at(-1)?.hint ?? '')
      const atLaunch = launchesFor('lead').length
      expect(await askToRelayARule(lead)).toBe('malformed-request')
      expect(store.ownInstructionsOf('worker').versions).toHaveLength(1)

      grant('lead', 'none')
      // The fixed host rule does not change with the old grant.
      expect(await askToRelayARule(lead)).toBe('malformed-request')
      expect(capabilityField('canWriteRules').whenItTakesEffect).toContain(
        'Narrowing it stops new requests',
      )
      // ⛔ …and the rule already written is still there: a version is text a person owns.
      expect(store.ownInstructionsOf('worker').versions).toHaveLength(1)
      expect(capabilityField('canWriteRules').whenItTakesEffect).toContain(
        'never removes rules that are already saved',
      )
      // the words it was launched with: unchanged, because nothing re-launched this handle.
      expect(launchesFor('lead')).toHaveLength(atLaunch)
      expectFixedRules(launchesFor('lead').at(-1)?.hint ?? '')

      await closeAndReopen(lead)
      expect(launchesFor('lead')).toHaveLength(atLaunch + 1)
      expect(launchesFor('lead').at(-1)?.kind).toBe('resume')
      expectFixedRules(launchesFor('lead').at(-1)?.hint ?? '')
      expect(await askToRelayARule(lead)).toBe('malformed-request')
      expect(store.ownInstructionsOf('worker').versions).toHaveLength(1)
    })

    it.each(['none', 'propose', 'relay', null] as const)(
      'legacy %s keeps the fixed launch policy and cannot reactivate relay',
      async (legacy) => {
        await bringIdentityIntoBeing('lead')
        await bringIdentityIntoBeing('worker')
        grant('lead', legacy)
        const lead = await personOpens('lead')
        expectFixedRules(launchesFor('lead').at(-1)?.hint ?? '')
        const atLaunch = launchesFor('lead').length
        expect(await askToRelayARule(lead)).toBe('malformed-request')
        const direct = {
          agent: 'worker',
          current_version: 0,
          current_rules: '',
          rules: 'A fictional direct write.',
          why: 'A fixture checks the fixed caller boundary.',
        }
        expect(agentToolsFor(host, lead).tools.map((one) => one.name)).not.toContain(
          'write_agent_rules',
        )
        expect(
          host.writeAgentRules(
            lead,
            {
              about: direct.agent,
              expectedVersion: direct.current_version,
              currentText: direct.current_rules,
              text: direct.rules,
              why: direct.why,
            },
            { ownerId: agentCallerId(lead) },
          ),
        ).toMatchObject({ ok: false, rail: 'may-not-write-rules' })
        expect(store.ownInstructionsOf('worker').versions).toHaveLength(0)
        await closeAndReopen(lead)
        expect(launchesFor('lead')).toHaveLength(atLaunch + 1)
        expect(launchesFor('lead').at(-1)?.kind).toBe('resume')
        expectFixedRules(launchesFor('lead').at(-1)?.hint ?? '')
        expect(await askToRelayARule(lead)).toBe('malformed-request')
        expect(agentToolsFor(host, lead).tools.map((one) => one.name)).not.toContain(
          'write_agent_rules',
        )
        expect(
          host.writeAgentRules(
            lead,
            {
              about: direct.agent,
              expectedVersion: direct.current_version,
              currentText: direct.current_rules,
              text: direct.rules,
              why: direct.why,
            },
            { ownerId: agentCallerId(lead) },
          ),
        ).toMatchObject({ ok: false, rail: 'may-not-write-rules' })
        expect(
          await callOn(lead, 'propose_agent_rules', {
            agent: 'worker',
            current_version: 0,
            rules: 'A fictional proposal.',
            why: 'A fixture checks the person decision boundary.',
          }),
        ).toMatchObject({ outcome: 'ok', wrote: 'a-request' })
        expect(store.ownInstructionsOf('worker').versions).toHaveLength(0)
      },
    )

    it('a real message grant widens at the rail while launch text changes only on reopen', async () => {
      await bringIdentityIntoBeing('lead')
      const worker = await personOpens('worker')
      expect(store.setCapabilities('lead', { canMessage: 'none' })).toBe(true)
      const lead = await personOpens('lead')
      const snapshot = launchesFor('lead').at(-1)?.hint ?? ''
      expect(snapshot).toContain(MAY_NOT_MESSAGE)
      expect(snapshot).not.toContain(MAY_MESSAGE)
      expectFixedRules(snapshot)
      const atLaunch = launchesFor('lead').length
      expect(await messageWorker(lead, worker)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
      const everyLaunch = launches.length
      expect(store.setCapabilities('lead', { canMessage: 'any' })).toBe(true)
      expect(launches.length, 'the write launched something').toBe(everyLaunch)
      expect(await messageWorker(lead, worker)).toMatchObject({ outcome: 'ok' })
      expect(launchesFor('lead')).toHaveLength(atLaunch)
      expect(launchesFor('lead').at(-1)?.hint).toBe(snapshot)
      await closeAndReopen(lead)
      expect(launchesFor('lead')).toHaveLength(atLaunch + 1)
      expect(launchesFor('lead').at(-1)?.kind).toBe('resume')
      const refreshed = launchesFor('lead').at(-1)?.hint ?? ''
      expect(refreshed).toContain(MAY_MESSAGE)
      expect(refreshed).not.toContain(MAY_NOT_MESSAGE)
      expectFixedRules(refreshed)
    })

    it('a real message grant narrows at the rail while the provider keeps its earlier launch text', async () => {
      await bringIdentityIntoBeing('lead')
      const worker = await personOpens('worker')
      expect(store.setCapabilities('lead', { canMessage: 'any' })).toBe(true)
      const lead = await personOpens('lead')
      const snapshot = launchesFor('lead').at(-1)?.hint ?? ''
      expect(snapshot).toContain(MAY_MESSAGE)
      expect(snapshot).not.toContain(MAY_NOT_MESSAGE)
      expectFixedRules(snapshot)
      const atLaunch = launchesFor('lead').length
      expect(await messageWorker(lead, worker)).toMatchObject({ outcome: 'ok' })
      const everyLaunch = launches.length
      expect(store.setCapabilities('lead', { canMessage: 'none' })).toBe(true)
      expect(launches.length, 'the write launched something').toBe(everyLaunch)
      expect(await messageWorker(lead, worker)).toMatchObject({
        outcome: 'refused',
        rail: 'may-not-message',
      })
      expect(launchesFor('lead')).toHaveLength(atLaunch)
      expect(launchesFor('lead').at(-1)?.hint).toBe(snapshot)
      await closeAndReopen(lead)
      expect(launchesFor('lead')).toHaveLength(atLaunch + 1)
      expect(launchesFor('lead').at(-1)?.kind).toBe('resume')
      const refreshed = launchesFor('lead').at(-1)?.hint ?? ''
      expect(refreshed).toContain(MAY_NOT_MESSAGE)
      expect(refreshed).not.toContain(MAY_MESSAGE)
      expectFixedRules(refreshed)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §3 · one rule and one cost sentence, read by both surfaces that offer the gesture
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · the reopen offer is not a second vocabulary', () => {
    it('🔴 the sign-in bar no longer spells the rule or the cost — both come from `lib/reopening`', () => {
      const pane = withoutProse(readFileSync(PANE, 'utf8'))
      expect(pane).toContain(`import { reopeningHeldBy, reopeningSays } from '../lib/reopening'`)
      // ⛔ **Both halves** (`a-census-that-asks-for-the-import-must-ask-for-the-call`): imported AND
      // called, because an unused import satisfies an import census.
      expect(pane).toContain('reopeningHeldBy(control.value)')
      // ⚑ **678 · one sentence again** — R26: the draft survives every reopen, so no arm is passed
      // (`672` passed *the selected conversation* here, and the grant sheet passed the other one).
      expect(pane).toContain('reopeningSays(signInHeldBy.value)')
      expect(pane).not.toContain('the-selected-conversation')
      // 🔴 **The rule is gone from the component**, so the two surfaces cannot drift apart on what
      // a reopen would destroy.
      expect(pane).not.toContain("if (panel.value.waiting > 0) return 'question'")
      expect(pane).not.toContain('Reopening keeps the transcript')
      // ⚑ **Non-vacuity**: the file was really read and it really still draws the bar.
      expect(pane).toContain('data-cy="sign-in-cost"')
    })

    it('⛔ the grant sheet shares the table and names the dormant key only to hide it', () => {
      const sheet = withoutProse(readFileSync(SHEET, 'utf8'))
      expect(sheet).toContain(
        `import { reopeningSays, type AConversationToReopen } from '../lib/reopening'`,
      )
      // ⚑ **516 · the guard widened from `moved` to `anythingMoved`**, and the assertion moved with
      // it rather than being relaxed. ⛔ **That widening is standing rule 20's shape**: `moved` is
      // defined by the PIPE — the capability fields — so a grant outside that pipe (the external MCP
      // servers, which are rows in another table and not a `CapabilityField`) left the offer live
      // over an unsaved tick. ⚠️ A reopen re-reads the WHOLE row, so any unsaved edit makes *what
      // this row says now* something other than what is on the screen.
      expect(sheet).toContain(
        'anythingMoved ? SAVE_FIRST : reopeningSays(one.heldBy) + actThere(one)',
      )
      expect(sheet).toContain('moved.value.size > 0 || externalMcpMoved.value')
      expect(sheet).toContain('{{ field.whenItTakesEffect }}')
      // Allow only the explicit dormant-field filter; all rendering and disclosure stay generic.
      const hiddenRulesFilter = "props.fields.filter((field) => field.key !== 'canWriteRules')"
      expect(sheet.split(hiddenRulesFilter)).toHaveLength(2)
      const genericSheet = sheet.replace(hiddenRulesFilter, 'props.fields')
      for (const field of CAPABILITY_FIELDS) {
        expect(genericSheet, `${field.key} is spelled outside the dormant filter`).not.toContain(
          field.key,
        )
        expect(sheet, `${field.column} is spelled in the sheet`).not.toContain(field.column)
      }
      // ⚑ …and the hooks are built from the field rather than typed out.
      expect(sheet).toContain('`grant-${field.key}-when`')
      expect(sheet).toContain('`grant-${field.key}-open-now`')
    })

    it('⚑ the screen owns the gesture and both callers reach ONE close-then-reopen', () => {
      const screen = withoutProse(readFileSync(SCREEN, 'utf8'))
      expect(screen).toContain(
        'async function closeAndReopen(sessionId: string, show = true): Promise<boolean> {',
      )
      // ⛔ **`147`'s two-part gesture, and both halves still awaited in order** — a resume on top of
      // a failed close attaches to the very session it is trying to leave behind.
      // ⚠️ **678 · re-aimed, not stripped**: the two halves now run INSIDE the draft hold (R26 —
      // `sweepDrafts.reopening`), so their indentation moved and the hold is asserted with them.
      expect(screen).toContain('return draftSweep.reopening(sessionId, async () => {')
      // ⚑ **D-017b · the reopen half is inlined** — the screen's own `reopen` went with the kept-open
      // pane — and it is still the store's resume, awaited only after a close that took.
      expect(screen).toContain(
        'const closed = await store.close(sessionId)\n    if (!closed) return false\n    const opened = await store.resume(sessionId)',
      )
      expect(screen).toContain('await closeAndReopen(sessionId)')
      // 🔴 **The sheet's caller does NOT move the window and DOES say a refusal**, because it is
      // the one caller that is not standing where the reopen lands.
      expect(screen).toContain('@reopen="(sessionId) => void reopenForGrant(sessionId)"')
      expect(screen).toContain('if (await closeAndReopen(sessionId, false)) return')
      expect(screen).toContain('overlays.notify(said)')
      // ⚑ **The paired positive**: `147`'s caller keeps the default and still moves.
      expect(screen).toContain('if (opened !== null && show) showConversation(opened, from)')
      expect(screen).toContain(':open-as="openAsForSheet"')
      // 🔴 **The screen holds no rule of its own** — `conversationsToReopen` is a function in
      // `lib/` precisely because nothing mounts `RuntimeScreen`, so a rule written inside it could
      // only ever be pinned by a line census (§4 is what replaces that).
      // ⚑ **678** — and no longer which of them is the selected one: every draft survives (R26).
      // ⚑ **D-017b** — the store's `open` is `live` now: the conversations this window runs.
      expect(screen).toContain(
        'return conversationsToReopen(store.live.value, overlay.profileSlug)',
      )
      expect(screen).not.toContain('record.meta?.profileId === profileSlug')
      // ⚑ **Lazy, and read in one place** — the walk is a pass over each open conversation's
      // items, so it must not run on every render of a screen that re-renders on every event.
      expect(screen).toContain('const openAsForSheet = computed<readonly AConversationToReopen[]>')
      expect(screen.match(/openAsForSheet/g) ?? []).toHaveLength(2)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────────────────
  // §4 · which conversations the offer is about — the derivation, not the census
  // ─────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · `conversationsToReopen` answers about ONE identity', () => {
    /**
     * ⛔ **The app's own record, not a shape that looks like one.** `sessionPanel` reads a
     * conversation's background registry, its cards and its plan as well as its status, and a
     * hand-rolled literal that happened to satisfy today's reader would stop satisfying it the
     * next time the panel grows a field — `a-fixture-must-plant-what-the-subject-eats`, met
     * while writing this file.
     */
    const record = (
      sessionId: string,
      profileId: string | null,
      over: { cwd?: string; busy?: boolean; working?: boolean } = {},
    ): SessionRecord => {
      const one = createSessionRecord(sessionId)
      one.phase = 'open'
      if (profileId !== null) {
        one.meta = {
          profileId,
          cwd: over.cwd ?? `/tmp/work/${profileId}-place`,
        } as unknown as SessionRecord['meta']
      }
      one.busy = over.busy ?? false
      if (over.working === true) one.control.status = 'working'
      return one
    }

    it('🔴 it keeps this identity’s conversations and drops every other', () => {
      const open = [record('a', 'pm'), record('b', 'worker'), record('c', 'pm')]
      expect(conversationsToReopen(open, 'pm').map((one) => one.sessionId)).toEqual(['a', 'c'])
      // ⚑ **The control, and it is not optional**: a filter that kept everything passes the first
      // assertion by accident on a roster where the head happens to match.
      expect(conversationsToReopen(open, 'worker').map((one) => one.sessionId)).toEqual(['b'])
      expect(conversationsToReopen(open, 'nobody')).toEqual([])
    })

    it('⛔ the identity is compared FOLDED, because the two sides come from different namespaces', () => {
      // 🔴 **`agent_identity.slug` is written through `foldProfileName`; `meta.profileId` is the
      // launch's verbatim directory spelling** — the store's own invariant is *"which keeps every
      // spelling verbatim"*. ⚠️ A first `spawn_agent {profile_slug: 'Worker'}` makes a `Worker/`
      // home and a `worker` identity row, so a strict compare drops exactly the conversation the
      // offer is for — and an empty list claims nothing, so the miss reads as nothing being open.
      expect(conversationsToReopen([record('a', 'Worker')], 'worker')).toHaveLength(1)
      // ⛔ **And the other side, because there are two folds and each defends its own.** ⚠️ The
      // row for the parameter SURVIVED against the record-side case alone — the slug this app
      // hands in is already folded, so only a caller passing an unfolded one can tell the two
      // apart. `a-line-no-mutation-can-kill-is-not-carrying-its-rule`, met twice in this dispatch.
      expect(conversationsToReopen([record('a', 'worker')], 'Worker')).toHaveLength(1)
      // ⚑ …and neither fold is a filter that keeps everything.
      expect(conversationsToReopen([record('a', 'Worker')], 'lead')).toHaveLength(0)
    })

    it('⛔ a record the host has not answered for yet carries no identity, so it is not offered', () => {
      // ⚠️ **Naming it on the strength of a null would be inventing an identity** — `SideRail.who`'s
      // refusal, made again here.
      expect(conversationsToReopen([record('a', null), record('b', 'pm')], 'pm')).toHaveLength(1)
    })

    it('⚑ it carries the folder, the double-click guard, and what a reopen would destroy', () => {
      const [one] = conversationsToReopen([record('a', 'pm', { busy: true, working: true })], 'pm')
      expect(one?.where).toBe('pm-place')
      expect(one?.busy).toBe(true)
      // 🔴 **The same rule the sign-in bar spends**, read here rather than re-derived in the sheet.
      expect(one?.heldBy).toBe('turn')
      // ⚠️ …and an idle one is free, so the line above is a measurement and not a constant.
      const [idle] = conversationsToReopen([record('b', 'pm')], 'pm')
      expect(idle?.heldBy).toBe(null)
    })

    it('🔴 678 · no row carries which conversation is selected — every draft survives the reopen', () => {
      // ⚠️ **Re-aimed from `672`'s per-row ARM** (rule 26): `672` measured that only the selected
      // conversation's draft survived and marked each row with it; R26 ruled the draft survives on
      // every row (`sweepDrafts.reopening`), so the row has nothing to say about it.
      const open = [record('a', 'pm'), record('b', 'pm')]
      for (const one of conversationsToReopen(open, 'pm')) {
        expect(Object.keys(one).sort()).toEqual(['busy', 'heldBy', 'sessionId', 'where'])
      }
    })

    it('⚠️ no path means no place, and the surface falls back to the id rather than to an empty row', () => {
      const [one] = conversationsToReopen([record('a', 'pm', { cwd: '' })], 'pm')
      expect(one?.where).toBe(null)
    })
  })

  describe('§5 · one cost table, read by both surfaces', () => {
    it('⚠️ the three sentences are one table, and the two waiting ones are surface-neutral', () => {
      // ⛔ **The deixis is the thing that had to move.** `149` wrote *"Answer the question ABOVE
      // first"* and *"THIS conversation is still working"* for a bar bolted to one conversation;
      // a row in a list of conversations is the second surface, and both sentences are now about
      // `It`. ⚑ The cost sentence did not move at all — it was already about the act.
      expect(REOPENING_SAYS.question).not.toContain('above')
      expect(REOPENING_SAYS.turn).not.toContain('This conversation')
      expect(REOPENING_SAYS.question.startsWith('It ')).toBe(true)
      expect(REOPENING_SAYS.turn.startsWith('It ')).toBe(true)
      // 🔴 **`149`'s measurement survived word for word until `656`**, which added the one cost
      // it had never named: work left running in the background, which the provider child takes
      // with it. ⚑ The whole list now lives in `REOPEN_COSTS` and `what-a-reopen-costs.test.ts`
      // holds this sentence to it; this pin stays as the exact wording a person reads.
      // ⚑ **678 · *"or attached"*** — R26: the draft survives every reopen, attachments with it.
      // ⚑ **741 · *"leaves plan mode"*** — R99 (corrected): a reopen does not resume planning.
      // ⚠️ **739 · re-aimed, not stripped** (rule 26): *"and what you chose to always allow stays
      // where it was kept"* — `736` F-1, *"add a `kept` row to `REOPEN_COSTS`"*: R95's grant outlives
      // the conversation, and the sentence a person reads says where it stays. The pin is still the
      // exact wording, and the rest of it is 741's.
      // ⚑ **D-017 · R3 — re-aimed, not stripped**: a message waiting to be sent is handed on at the
      // teardown and sent once the conversation has reopened, so *"comes back as text for you to
      // send again"* became false and the last clause says what is true now.
      expect(REOPENING_SAYS.free).toBe(
        'Reopening keeps the transcript and whatever you have typed or attached, and what you chose to ' +
          'always allow stays where it was kept. It forgets its “Allow for this conversation” ' +
          'approvals, leaves plan mode and stops anything still running in the background, and a ' +
          'message waiting to be sent is sent once it has reopened.',
      )
    })
  })
})
