import { agentCallerId } from '../src/main/runtime/agent-tools'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  composeProfileBundle,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { BUNDLE_LEAF, publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import {
  OWN_INSTRUCTIONS_CHARS,
  WHO_WROTE_IT,
  WROTE_IT_MEANS,
  configuredLayerOf,
  whatIsInForce,
} from '../src/shared/own-instructions'
import { type RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')

/**
 * 🔴 **582 · the layer that compiled and nothing fed** (`HO-063` gap 4, `HO-009` §2).
 *
 * ## ⛔ What this file is measuring, and why the first section is the whole dispatch
 *
 * A personal rule is composed into the next conversation; the one already running never sees
 * it. This verifies that the configured instruction layer is fed rather than merely declared.
 *
 * ⚠️ **Every section drives the real store through the real host.** The seam is fed inside
 * `RuntimeHost.instructionContext`, which runs on both the create and the resume path, so a test
 * that called `composeProfileBundle` directly would measure the renderer of the layer and not the
 * feeder — which is exactly the state `377` left and `552` found.
 */

class PersonsWindow implements RuntimeEventSink {
  /** ⛔ **A PERSON, and it is load-bearing**: every door in this file stands behind `requireAPerson`. */
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

describe('582 · the layer a person writes', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let host: RuntimeHost
  let store: SessionStore
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  /**
   * ⚑ **What the host handed the instruction reader, captured verbatim** —
   * `who-exists-and-what-they-were-told.test.ts`' device, and the reason it is the right one here:
   * the question is what the LAUNCH composed, and the context is the launch's own input.
   */
  let seen: InstructionContext[]
  /** ⚑ **The composed bytes, per launch** — what the provider was actually handed. */
  let bundles: string[]
  /** ⚑ **665 · what the app READ BACK per launch** — for Claude, the source of its system prompt. */
  let reads: ReturnType<typeof readSessionInstructions>[]
  let window: PersonsWindow
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-582-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-582-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2031, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    seen = []
    bundles = []
    reads = []
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => join(userData, 'resources'),
      createRuntime: (provider: Provider) => new FakeRuntime(provider, { sessions }),
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
      readInstructions: (provider, cwd, providerHome, ctx) => {
        seen.push(ctx)
        const composed = composeProfileBundle(ctx)
        bundles.push(composed)
        const bundle = publishProfileBundle(provider, providerHome, composed)
        const read = readSessionInstructions({
          provider,
          cwd,
          providerHome,
          bundle,
          thisConversation: thisConversationSpans(ctx),
        })
        reads.push(read)
        return { instructions: read.instructions, systemHint: undefined, memoryLoaded: null }
      },
    })
    window = new PersonsWindow('webContents:1')
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, work]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (profileId: string): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId, cwd: work, approvalMode: 'auto' },
      window,
    )
    return sessionId
  }

  /** ⚑ An identity exists once a conversation has run as it — 341 criterion 12. */
  const bringIdentityIntoBeing = async (profileId: string): Promise<void> => {
    const id = await personOpens(profileId)
    await host.close(id, window)
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · a rule a person writes survives a relaunch — the dispatch, in one section
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · the seam, fed', () => {
    it('🔴 a rule a person writes is in the NEXT launch’s bundle, and was in no earlier one', async () => {
      await bringIdentityIntoBeing('worker')
      // ⛔ **The control, and it is the state `HO-073` §2 describes**: before anybody writes
      // anything, the heading is absent from the bytes the provider was handed.
      expect(bundles.at(-1)).not.toContain('## Your own instructions')
      expect(seen.at(-1)?.configured).toBeNull()

      const saved = host.instructAgent('worker', 'Never force-push.', undefined, window)
      expect(saved?.own.versions.map((one) => one.version)).toEqual([1])

      const second = await personOpens('worker')
      // 🔴 **The whole of gap 4**: the launch composed the rule, from the database, without anybody
      // passing it in.
      expect(seen.at(-1)?.configured).toBe('Never force-push.')
      expect(bundles.at(-1)).toContain('## Your own instructions\n\nNever force-push.')
      await host.close(second, window)
    })

    it('🔴 the NEWEST version is what a launch composes, not the first one ever written', async () => {
      await bringIdentityIntoBeing('worker')
      host.instructAgent('worker', 'The first thing I said.', undefined, window)
      host.instructAgent('worker', 'What I say now.', undefined, window)
      const second = await personOpens('worker')
      // ⛔ **The half `M1` cannot measure**: the seam is fed, the editor works and the history is
      // right, and what the agent is told is a rule the person has already replaced. ⚑ *In force*
      // is defined by the VERSION NUMBER — see `whatIsInForce`, which this and the launch share.
      expect(seen.at(-1)?.configured).toBe('What I say now.')
      expect(bundles.at(-1)).not.toContain('The first thing I said.')
      await host.close(second, window)
    })

    it('⛔ a conversation already running is NOT changed by a save, which is what the sentence says', async () => {
      await bringIdentityIntoBeing('worker')
      const live = await personOpens('worker')
      const composedAtLaunch = bundles.length
      host.instructAgent('worker', 'Never force-push.', undefined, window)
      // ⚑ **Nothing recomposed**, which is what makes `TAKES_EFFECT_AT_THE_NEXT_LAUNCH` true of the
      // thing it describes rather than a sentence somebody wrote (standing rule 8.2).
      expect(bundles).toHaveLength(composedAtLaunch)
      await host.close(live, window)
    })

    it('⚠️ writing rules for a slug with NO identity row writes nothing and says so', () => {
      // ⛔ **Criterion 12 through a fourth configuration door** — a person may not configure an
      // identity into existence, and `null` is how this door refuses.
      expect(host.instructAgent('nobody-has-run-as-this', 'anything', undefined, window)).toBeNull()
      expect(store.ownInstructionsOf('nobody-has-run-as-this').versions).toEqual([])
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · versioned and revertable — HO-009 §1.2
  // ───────────────────────────────────────────────────────────────────────────────────────────

  it.each(['none', 'propose', 'relay', null] as const)(
    'launches with the fixed rule policy under dormant value %s',
    async (held) => {
      await bringIdentityIntoBeing('worker')
      expect(store.setCapabilities('worker', { canWriteRules: held })).toBe(true)
      const opened = await personOpens('worker')
      expect(reads.at(-1)?.instructions.composed).toContain(
        "- You can read any agent's standing rules and propose a replacement; the person decides. A BroBot conversation the person started may also save one directly, but never its own. Each version keeps its author and reason, and the person can undo it.",
      )
      expect(reads.at(-1)?.instructions.composed).not.toContain(
        "save a person's rule for another agent",
      )
      await host.close(opened, window)
    },
  )

  describe('§2 · nothing is ever replaced', () => {
    it('🔴 a second save APPENDS, and the first version is still readable', async () => {
      await bringIdentityIntoBeing('worker')
      host.instructAgent('worker', 'Rule one.', undefined, window)
      const after = host.instructAgent('worker', 'Rule two.', undefined, window)
      expect(after?.own.versions.map((one) => [one.version, one.text])).toEqual([
        [2, 'Rule two.'],
        [1, 'Rule one.'],
      ])
      // ⛔ **`HO-009` §1.2's property, asserted as a property**: *what the rule used to be* is
      // recoverable, which is what makes instruction drift recoverable at all.
      expect(configuredLayerOf(after!.own)).toBe('Rule two.')
    })

    it('⚑ CLEARING writes an empty version rather than deleting one', async () => {
      await bringIdentityIntoBeing('worker')
      host.instructAgent('worker', 'Rule one.', undefined, window)
      const after = host.instructAgent('worker', '', undefined, window)
      expect(after?.own.versions).toHaveLength(2)
      // ⛔ **The seam renders NOTHING**, and the history still holds what was taken away — the two
      // facts `configuredLayerOf`'s own note keeps apart.
      expect(configuredLayerOf(after!.own)).toBeNull()
      expect(after!.own.versions.at(-1)?.text).toBe('Rule one.')
    })

    it('🔴 a REVERT appends the old text forward and says which version it brought back', async () => {
      await bringIdentityIntoBeing('worker')
      host.instructAgent('worker', 'Rule one.', undefined, window)
      host.instructAgent('worker', 'Rule two.', undefined, window)
      const after = host.instructAgent('worker', 'Rule one.', 1, window)
      const inForce = whatIsInForce(after!.own)
      expect([inForce?.version, inForce?.text, inForce?.broughtBack]).toEqual([3, 'Rule one.', 1])
      // ⛔ **Version 2 is untouched**, so reverting the revert is available — which is what makes
      // this an append rather than an undo.
      expect(after!.own.versions.map((one) => one.version)).toEqual([3, 2, 1])
    })

    it('⛔ the SCHEMA refuses a version that claims to bring back one after it', async () => {
      await bringIdentityIntoBeing('worker')
      host.instructAgent('worker', 'Rule one.', undefined, window)
      expect(
        store.writeOwnInstructions(
          {
            profileSlug: 'worker',
            text: 'x',
            whoWroteIt: 'a-person',
            by: { who: 'a-person' },
            conversation: null,
            said: null,
            broughtBack: 9,
          },
          clock,
        ),
      ).toBeNull()
      // The database also refuses a bypass of the store's earlier guard.
      expect(() =>
        db
          .prepare(
            `INSERT INTO identity_instruction
        (id, identity_id, version, text, wrote_it, by, brought_back, created_at)
        VALUES ('bad-restore', 'aid:worker', 2, 'x', 'a-person', ?, 9, ?)`,
          )
          .run(JSON.stringify({ who: 'a-person' }), clock),
      ).toThrow(/identity_instruction_brought_back_ck|CHECK/)
    })

    it('⛔ the SCHEMA refuses a person’s version that names a conversation or a claim', async () => {
      await bringIdentityIntoBeing('worker')
      // 🔴 **Two provenance columns that cannot disagree** — the same shape
      // `document_ingest_registered_names_it_ck` had (D-016 dropped that table), and for its reason.
      expect(() =>
        store.writeOwnInstructions(
          {
            profileSlug: 'worker',
            text: 'x',
            whoWroteIt: 'a-person',
            by: { who: 'a-person' },
            conversation: null,
            said: 'a person does not make a case to anybody',
            broughtBack: null,
          },
          clock,
        ),
      ).toThrow(/identity_instruction_person_said_nothing_ck|CHECK/)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the vocabulary is closed, and every member says something different
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · who wrote it', () => {
    it('⛔ every provenance has a sentence, and no two of them are the same', () => {
      const said = WHO_WROTE_IT.map((who) => WROTE_IT_MEANS[who])
      expect(new Set(said).size).toBe(WHO_WROTE_IT.length)
      for (const one of said) expect(one.length).toBeGreaterThan(10)
    })

    it('🔴 a provenance this build cannot read folds to the word that CLAIMS LEAST', async () => {
      await bringIdentityIntoBeing('worker')
      host.instructAgent('worker', 'Rule one.', undefined, window)
      // ⛔ **A hand-edited database, which is the only thing this fold is for** — the column carries
      // a CHECK, so nothing this app's own writers can do reaches it. ⚑ `ignore_check_constraints`
      // is how a test reaches the state a person with a sqlite shell can reach, and without it the
      // fold would be `a-line-no-mutation-can-kill-is-not-carrying-its-rule`.
      db.pragma('ignore_check_constraints = ON')
      db.prepare(
        `UPDATE identity_instruction SET wrote_it = 'something-later' WHERE version = 1`,
      ).run()
      db.pragma('ignore_check_constraints = OFF')
      // ⚑ **The premise, asserted** — the planted row really is the one in force, so the fold
      // below is being asked about something rather than about an empty history.
      const read = whatIsInForce(store.ownInstructionsOf('worker'))
      expect([read?.version, read?.text]).toEqual([1, 'Rule one.'])
      // Keep `an-agents-proposal` as its own origin. Folding it to `a-person` would falsely
      // claim that the person wrote words they may never have seen.
      expect(read?.whoWroteIt).toBe('an-agents-proposal')
      expect(WROTE_IT_MEANS[read!.whoWroteIt]).not.toContain('you wrote')
    })

    it('⚠️ the relay’s sentence says this app did NOT check the claim', () => {
      // 🔴 **`HO-009` §2.2 makes provenance *relayed from user* the authorization**, and the only
      // honest thing to render beside it is that nobody verified it. ⛔ A sentence reading *you said
      // this* would be the app asserting a fact it cannot hold.
      expect(WROTE_IT_MEANS['relayed-from-user']).toContain('did not check')
      expect(WROTE_IT_MEANS['a-person']).not.toContain('agent')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · an agent PROPOSES, and only approval writes — HO-009 §2.2
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the agent’s ask', () => {
    /** Legacy grant values remain stored but do not authorize these requests. */
    const anAgentThatMayAsk = async (held: 'propose' | 'relay'): Promise<string> => {
      await bringIdentityIntoBeing('worker')
      await bringIdentityIntoBeing('asker')
      expect(store.setCapabilities('asker', { canWriteRules: held })).toBe(true)
      return personOpens('asker')
    }

    it('🔴 a PROPOSAL writes no version, and approving it writes one', async () => {
      const asking = await anAgentThatMayAsk('propose')
      const asked = host.proposeAgentRules(
        asking,
        {
          about: 'worker',
          text: 'Never force-push.',
          why: 'it keeps coming up',
          relaying: false,
          expectedVersion: 0,
        },
        { ownerId: agentCallerId(asking) },
      )
      expect(asked.ok && asked.wrote).toBe('a-request')
      // ⛔ **`HO-009` §2.2's gate, measured**: the ask exists and the rules do not.
      expect(store.ownInstructionsOf('worker').versions).toEqual([])
      expect(host.agentInstructions('worker').waiting).toHaveLength(1)

      const askId = asked.ok && asked.wrote === 'a-request' ? asked.askId : ''
      expect(host.decideInstruction(askId, true, window)).toEqual({ outcome: 'taken' })
      const now = host.agentInstructions('worker')
      expect(now.own.versions.map((one) => [one.text, one.whoWroteIt, one.conversation])).toEqual([
        ['Never force-push.', 'an-agents-proposal', asking],
      ])
      // ⚑ **Settled, so it is not in front of the person twice.**
      expect(now.waiting).toEqual([])
      await host.close(asking, window)
    })

    it('⛔ REFUSING writes nothing at all, and takes the ask down', async () => {
      const asking = await anAgentThatMayAsk('propose')
      const asked = host.proposeAgentRules(
        asking,
        {
          about: 'worker',
          text: 'Never force-push.',
          why: 'it keeps coming up',
          relaying: false,
          expectedVersion: 0,
        },
        { ownerId: agentCallerId(asking) },
      )
      const askId = asked.ok && asked.wrote === 'a-request' ? asked.askId : ''
      expect(host.decideInstruction(askId, false, window)).toEqual({ outcome: 'taken' })
      expect(store.ownInstructionsOf('worker').versions).toEqual([])
      expect(host.agentInstructions('worker').waiting).toEqual([])
      await host.close(asking, window)
    })

    it('refuses the historical relay shortcut even with its old grant', async () => {
      const asking = await anAgentThatMayAsk('relay')
      const refused = host.proposeAgentRules(
        asking,
        {
          about: 'worker',
          text: 'Never force-push.',
          why: 'The person said so',
          relaying: true,
          expectedVersion: 0,
        },
        { ownerId: agentCallerId(asking) },
      )
      expect(!refused.ok && refused.rail).toBe('malformed-request')
      expect(host.agentInstructions('worker').own.versions).toEqual([])
      expect(host.agentInstructions('worker').waiting).toEqual([])
      await host.close(asking, window)
    })

    it('refuses a relay claim and allows the same replacement as a proposal', async () => {
      const asking = await anAgentThatMayAsk('propose')
      const said = {
        about: 'worker',
        text: 'Never force-push.',
        why: 'The person said so',
      }
      const refused = host.proposeAgentRules(
        asking,
        { ...said, relaying: true, expectedVersion: 0 },
        { ownerId: agentCallerId(asking) },
      )
      expect(refused.ok).toBe(false)
      expect(!refused.ok && refused.rail).toBe('malformed-request')
      // ⛔ **Nothing was written, which is what makes this a refusal rather than a downgrade.**
      expect(store.ownInstructionsOf('worker').versions).toEqual([])
      expect(host.agentInstructions('worker').waiting).toEqual([])
      // ⚑ **ONE FACT OVER — the identical call without the claim — is ALLOWED.** This is the pair
      // that makes the rail measured rather than asserted: the two readings diverge here and
      // nowhere else.
      const allowed = host.proposeAgentRules(
        asking,
        { ...said, relaying: false, expectedVersion: 0 },
        { ownerId: agentCallerId(asking) },
      )
      expect(allowed.ok && allowed.wrote).toBe('a-request')
      await host.close(asking, window)
    })

    it('a known agent without a rule grant still receives the target lookup result', async () => {
      await bringIdentityIntoBeing('worker')
      await bringIdentityIntoBeing('asker')
      const asking = await personOpens('asker')
      const refused = host.proposeAgentRules(
        asking,
        { about: 'nobody-at-all', text: 'x', why: 'y', relaying: false, expectedVersion: 0 },
        { ownerId: agentCallerId(asking) },
      )
      expect(!refused.ok && refused.rail).toBe('no-such-agent')
      await host.close(asking, window)
    })

    it('⚠️ a granted caller naming an identity that does not exist is told THAT', async () => {
      const asking = await anAgentThatMayAsk('propose')
      const refused = host.proposeAgentRules(
        asking,
        { about: 'nobody-at-all', text: 'x', why: 'y', relaying: false, expectedVersion: 0 },
        { ownerId: agentCallerId(asking) },
      )
      expect(!refused.ok && refused.rail).toBe('no-such-agent')
      await host.close(asking, window)
    })

    it('🔴 a person’s own save SUPERSEDES an ask waiting about that identity', async () => {
      const asking = await anAgentThatMayAsk('propose')
      host.proposeAgentRules(
        asking,
        {
          about: 'worker',
          text: 'The agent’s idea.',
          why: 'mine',
          relaying: false,
          expectedVersion: 0,
        },
        { ownerId: agentCallerId(asking) },
      )
      host.instructAgent('worker', 'The person’s own rule.', undefined, window)
      // ⛔ **Otherwise a person answers a card describing a world that moved** — they write their
      // rules and then approve an older proposal on top of them.
      expect(host.agentInstructions('worker').waiting).toEqual([])
      expect(configuredLayerOf(host.agentInstructions('worker').own)).toBe('The person’s own rule.')
      await host.close(asking, window)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the bound
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the bound', () => {
    it('⚑ a rule set at the bound is saved whole, and the bundle carries all of it', async () => {
      await bringIdentityIntoBeing('worker')
      // ⛔ **`OWN_INSTRUCTIONS_CHARS` and not a literal**, so this moves with the constant — and
      // `a-bound-written-as-the-constant-cannot-pin-it` is why the NEXT assertion is about the
      // bundle rather than about the length coming back unchanged.
      const long = 'x'.repeat(OWN_INSTRUCTIONS_CHARS)
      host.instructAgent('worker', long, undefined, window)
      const second = await personOpens('worker')
      expect(seen.at(-1)?.configured).toHaveLength(OWN_INSTRUCTIONS_CHARS)
      await host.close(second, window)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // 665 · R14 — the carrier the live matrix uses, proven here for $0
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('665 · §6 through this door arrives byte for byte, for both providers', () => {
    /**
     * ⚑ **The exact bytes the live matrix writes** — `scripts/lib/security-block.txt`, today's §6:
     * emoji, tables, backticks and all. ⛔ The live run reads each launch's bundle back for them;
     * this pins, for no spend, that nothing between the door and the provider's file can trim,
     * wrap or cap them (`OWN_INSTRUCTIONS_CHARS` included: the block is under it, and this says so).
     */
    const block = readFileSync(join(here, '../../../scripts/lib/security-block.txt'), 'utf8')

    it.each(['claude', 'codex'] as const)(
      '🔴 %s: the next launch composes it, publishes it, and it is in what the provider is given',
      async (provider) => {
        expect(block.length).toBeLessThan(OWN_INSTRUCTIONS_CHARS)
        const first = await host.createSession(
          { provider, profileId: 'project-manager', cwd: work, approvalMode: 'auto' },
          window,
        )
        await host.close(first.sessionId, window)
        const saved = host.instructAgent('project-manager', block, undefined, window)
        expect(saved?.own.versions[0]?.text).toBe(block)
        const second = await host.createSession(
          { provider, profileId: 'project-manager', cwd: work, approvalMode: 'auto' },
          window,
        )
        expect(seen.at(-1)?.configured).toBe(block)
        expect(bundles.at(-1)).toContain(`## Your own instructions\n\n${block}`)
        const leaf = readFileSync(
          join(userData, 'provider-homes', 'project-manager', provider, BUNDLE_LEAF[provider]),
          'utf8',
        )
        expect(leaf).toContain(block)
        // ⚑ Codex reads that file itself. Claude never does: the app reads it BACK and hands the
        // result over as the system prompt (`index.ts`: `systemHint: read.instructions.composed`),
        // through a per-file cap and a budget that sheds the app's own bundle first — so for Claude
        // the proof is the read-back, not the file.
        if (provider === 'claude') expect(reads.at(-1)?.instructions.composed).toContain(block)
        await host.close(second.sessionId, window)
      },
    )
  })
})
