import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  FakeProviderSessions,
  FakeRuntime,
  type AgentToolset,
  type StartOptions,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { composeProfileBundle, type InstructionContext } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import {
  OWN_INSTRUCTIONS_CHARS,
  WHO_WROTE_IT,
  WROTE_IT_MEANS,
  configuredLayerOf,
  whatIsInForce,
} from '../src/shared/own-instructions'
import { CAPABILITY_FIELDS } from '../src/shared/capabilities'
import { DEFAULT_PROFILE_ID, type RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const srcRoot = join(here, '../src')

/**
 * 🔴 **618 · creation carries instructions** (`HO-078` §4, boarded by `HO-093` §3).
 *
 * ## ⛔ The ruling, and the whole of what this file measures
 *
 * > ⚑ **`create_agent` takes the new identity's own instructions** — *"what it is for, the
 * > operating model it works under, whatever scoping the creator can give it."*
 * > ⛔ **And a person's edits survive**: *"The creator writes the initial text; after that it is
 * > the person's, and an agent wanting to change it PROPOSES."* (`HO-078` §1.1)
 *
 * ## 🔴 The design question this dispatch was, and where its answer is asserted
 *
 * ⛔ **`WHO_WROTE_IT` had three members and a creator is none of them**, so the whole cost of the
 * ruling was a fourth word in a vocabulary an exhaustive `Record` renders and a database CHECK
 * closes. ⚑ **§1 is that question answered by measurement rather than by argument**: each existing
 * sentence is held up against a creator and shown false, and the one new sentence is pinned by the
 * clause that makes it honest.
 *
 * ## ⚠️ What it drives, and why nothing here calls the composer directly
 *
 * ⛔ **Real host, real SQLite ledger, real migrations, real rails, real tool.** Every creation
 * below goes through the toolset a launch was handed — the one a model actually calls — and every
 * reading of what was written comes off the store or off the bundle a later launch composed. ⚠️ A
 * test that called `writeOwnInstructions` itself would measure the store and not the door, which
 * is the state `377` left `InstructionContext.configured` in for five months.
 */

class PersonsWindow implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

/** ⚑ **419's device** — the toolset each launch was handed, so a call below is a model's call. */
class WatchingRuntime extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly handed: AgentToolset[],
    sessions: FakeProviderSessions,
  ) {
    super(provider, { sessions })
  }
  override async start(options: StartOptions): ReturnType<FakeRuntime['start']> {
    const handle = await super.start(options)
    if (options.agentTools) this.handed.push(options.agentTools)
    return handle
  }
}

describe('618 · creation carries instructions', () => {
  let userData: string
  let work: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let handed: AgentToolset[]
  /** ⚑ **582's device** — what the host handed the instruction reader, verbatim, per launch. */
  let seen: InstructionContext[]
  /** ⚑ The composed bytes, per launch — what the provider was actually given. */
  let bundles: string[]
  let counter: number
  let clock: number
  let window: PersonsWindow
  const tick = (): number => clock++

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-618-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-618-work-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2031, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    handed = []
    seen = []
    bundles = []
    sessions = new FakeProviderSessions()
    host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => join(userData, 'resources'),
      createRuntime: (provider: Provider) => new WatchingRuntime(provider, handed, sessions),
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
        const read = readSessionInstructions({ provider, cwd, providerHome, bundle })
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

  const toolsOfLastLaunch = (): AgentToolset => {
    const one = handed.at(-1)
    if (one === undefined) throw new Error('no launch was handed a toolset')
    return one
  }

  const callOn = async (
    toolset: AgentToolset,
    name: string,
    args: Record<string, unknown>,
  ): Promise<Record<string, unknown>> => {
    const tool = toolset.tools.find((one) => one.name === name)
    if (tool === undefined) throw new Error(`no such tool: ${name}`)
    return (await tool.call(args)).structured as Record<string, unknown>
  }

  /**
   * ⚑ **A live BroBot and its toolset.** ⛔ It holds the one default set every agent holds —
   * `canCreateAgents: 'any'` and `canWriteRules: 'none'` — which is the ordinary state §6 measures
   * and the state every section but that one runs in.
   */
  const brobot = async (): Promise<{ me: string; tools: AgentToolset }> => {
    const me = await personOpens(DEFAULT_PROFILE_ID)
    return { me, tools: toolsOfLastLaunch() }
  }

  const problemsOf = (refused: Record<string, unknown>): string[] =>
    (refused['detail'] as { problems?: string[] }).problems ?? []

  const versionRows = (slug: string): Record<string, unknown>[] =>
    db
      .prepare(
        `SELECT v.* FROM identity_instruction v JOIN agent_identity i ON i.id = v.identity_id
          WHERE i.slug = ? ORDER BY v.version`,
      )
      .all(slug) as Record<string, unknown>[]

  const identityRow = (slug: string): Record<string, unknown> | undefined =>
    db.prepare('SELECT * FROM agent_identity WHERE slug = ?').get(slug) as
      Record<string, unknown> | undefined

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the word — a creator is a FOURTH authority, and each of the three is false of it
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · why a creator needed a word of its own', () => {
    /**
     * 🔴 **`workspace-reading.ts`' rule, applied rather than quoted**: *a walk needs a word of its
     * own when no existing word's sentence is TRUE of it.*
     *
     * ⛔ **Each clause is pinned BY NAME** (standing rule 5), because the argument for the fourth
     * member lives entirely in what the other three SAY — and a sentence nothing asserts is a
     * sentence that can be reworded into truth after the fact.
     */
    it('🔴 none of the three inherited sentences is true of a creator, clause by clause', () => {
      const creator = WROTE_IT_MEANS['its-creator']

      // ⛔ **`a-person` — *"you wrote this"*.** An agent wrote it; the person may never have seen
      // it, so the creator's sentence must not claim the person's hand.
      expect(WROTE_IT_MEANS['a-person']).toBe('you wrote this')
      expect(creator).not.toContain('you wrote')

      // ⛔ **`an-agents-proposal` — *"an agent proposed this and you approved it"*.** This is the
      // trap `HO-078` §3.2 names: recording a creation as a proposal ENDED `approved` would be a
      // claim about an act nobody performed.
      expect(WROTE_IT_MEANS['an-agents-proposal']).toContain('you approved it')
      expect(creator).not.toContain('approved')
      expect(creator).not.toContain('proposed')

      // ⛔ **`relayed-from-user` — *"saying you had given it the rule"*.** A creator makes no claim
      // about the person at all, so this word would invent evidence in the agent's mouth.
      expect(WROTE_IT_MEANS['relayed-from-user']).toContain('saying you had given it')
      expect(creator).not.toContain('saying you')
      expect(creator).not.toContain('given it')

      // ⚑ **And what it DOES say** — who, when, and the thing the other three each have an answer
      // for and this one does not: nobody was asked.
      expect(creator).toContain('the agent that created this one wrote this')
      expect(creator).toContain('before this agent had ever run')
      expect(creator).toContain('nobody asked you')
    })

    /**
     * 🔴 **Relay 1 §5: does the fourth member make any EXISTING sentence read differently?**
     *
     * ⚑ **A vocabulary's members are read as a SET** — `609` renamed `asking` for exactly that
     * reason. ⛔ **The answer is no, and this is the reading that establishes it**: the set was
     * already partitioned by *what the PERSON did*, and the fourth member is the first row whose
     * honest answer on that axis is *nothing*. ⚠️ **It sharpens the other three rather than
     * blurring them** — `you wrote this` and `you approved it` stop being the background and
     * become the distinguishing fact.
     *
     * 🔴 **The one pair that had to be checked is the two AGENT-written members**, because before
     * `618` there was only one. ⛔ They differ on the CLAIM: a relay names the person as the
     * source of the rule and this app says it did not check; a creator names nobody at all.
     */
    it('🔴 the set is partitioned by what the PERSON did, and the fourth is the only *nothing*', () => {
      // ⛔ **Each clause pinned BY NAME**, so a reword that collapsed two rows into one reading
      // goes red here rather than on a surface.
      const namesAnActThePersonPerformed = WHO_WROTE_IT.filter((who) =>
        /you wrote|you approved/.test(WROTE_IT_MEANS[who]),
      )
      expect([...namesAnActThePersonPerformed]).toEqual(['a-person', 'an-agents-proposal'])

      const saysAnAgentWroteIt = WHO_WROTE_IT.filter((who) =>
        /an agent wrote this|agent that created this one wrote this/.test(WROTE_IT_MEANS[who]),
      )
      expect([...saysAnAgentWroteIt]).toEqual(['relayed-from-user', 'its-creator'])

      // ⚑ **And those two differ on the CLAIM, which is the only thing that tells them apart.**
      expect(WROTE_IT_MEANS['relayed-from-user']).toContain('this app did not check that')
      expect(WROTE_IT_MEANS['its-creator']).not.toContain('did not check')
      expect(WROTE_IT_MEANS['its-creator']).toContain('nobody asked you')
      expect(
        WHO_WROTE_IT.filter((who) => WROTE_IT_MEANS[who].includes('nobody asked you')),
      ).toHaveLength(1)
    })

    it('⛔ every member still reads differently from every other, and the table cannot go short', () => {
      // ⚑ **Derived from the vocabulary rather than counted**, so this moves with a fifth member
      // instead of going quiet — `582`'s own assertion, which is why it needed no repair here.
      const said = WHO_WROTE_IT.map((who) => WROTE_IT_MEANS[who])
      expect(new Set(said).size).toBe(WHO_WROTE_IT.length)
      expect(WHO_WROTE_IT).toContain('its-creator')
      for (const sentence of said) expect(sentence.length).toBeGreaterThan(10)
    })

    /**
     * 🔴 **The vocabulary is closed in the DATABASE, so the fourth word cost a table rebuild** —
     * `0042`, SQLite's 12-step form.
     *
     * ⛔ **Put the hazard on the path the code walks**: the refusal is measured by INSERTing a word
     * that is not a member, beside a control that is.
     */
    it('⛔ the `wrote_it` CHECK admits the new word and still refuses one nobody declared', async () => {
      const { tools } = await brobot()
      expect((await callOn(tools, 'create_agent', { profile_slug: 'archivist' }))['outcome']).toBe(
        'ok',
      )
      const identity = identityRow('archivist')?.['id'] as string
      const insert = (id: string, version: number, wroteIt: string): void => {
        db.prepare(
          `INSERT INTO identity_instruction
             (id, identity_id, version, text, wrote_it, by, conversation_id, said, brought_back, created_at)
           VALUES (?, ?, ?, 'x', ?, '{"who":"a-person"}', NULL, NULL, NULL, 1)`,
        ).run(id, identity, version, wroteIt)
      }
      // ⚑ **The control fires**: the word this dispatch added is accepted at version 1.
      expect(() => {
        insert('ins:archivist:1', 1, 'its-creator')
      }).not.toThrow()
      // ⛔ **And a word nobody declared is refused by the database rather than by a reader.**
      expect(() => {
        insert('ins:archivist:2', 2, 'an-agent-decided')
      }).toThrow(/CHECK/i)
    })

    /**
     * 🔴 **`HO-078` §4.1 — *one write, at creation, and never again* — as a DATABASE fact.**
     *
     * ⛔ **The rail that makes it true in the product is `agent-name-taken`** (§3 measures that).
     * ⚠️ **This is the same sentence where no door can get past it**: whatever code runs, a version
     * numbered 2 or higher cannot claim a creator wrote it.
     */
    it('🔴 `its-creator` is refused on any version but the first, by the schema', async () => {
      const { me, tools } = await brobot()
      await callOn(tools, 'create_agent', { profile_slug: 'archivist', rules: 'The first rules.' })
      expect(versionRows('archivist')).toHaveLength(1)

      // ⛔ **The store's own door, with the bad input on the path it walks** — not a raw INSERT,
      // because the question is whether the CHECK stands behind the method this app writes with.
      expect(() =>
        store.writeOwnInstructions(
          {
            profileSlug: 'archivist',
            text: 'A second one, claiming the creator wrote it.',
            whoWroteIt: 'its-creator',
            by: { who: 'an-agent', agent: me },
            conversation: me,
            said: null,
            broughtBack: null,
          },
          clock,
        ),
      ).toThrow(/CHECK/i)
      // ⚑ **The paired control one fact over**: the same second version under any other word is
      // written, so the refusal is about the WORD and not about writing a second version.
      expect(
        store.writeOwnInstructions(
          {
            profileSlug: 'archivist',
            text: 'A second one, relayed.',
            whoWroteIt: 'relayed-from-user',
            by: { who: 'an-agent', agent: me },
            conversation: me,
            said: 'the person told me',
            broughtBack: null,
          },
          clock,
        )?.version,
      ).toBe(2)
    })

    /**
     * ⚠️ **The fold's DIRECTION, and `618` had to ask it again** — `foldWhoWroteIt` narrows an
     * unreadable stored word to the sentence that promises the LEAST.
     *
     * ⛔ **`its-creator` must not become that fallback.** Its sentence says *nobody asked you*,
     * which is a stronger claim than `an-agents-proposal`'s *you approved it* is weak — but the
     * direction that matters is the one `086` named: an unreadable row must never be folded into a
     * word that reassures, and it must never be folded into one that ACCUSES either.
     */
    it('⚠️ an unreadable provenance still folds to `an-agents-proposal`, never to the new word', async () => {
      const { tools } = await brobot()
      await callOn(tools, 'create_agent', { profile_slug: 'archivist', rules: 'Rules.' })
      db.pragma('ignore_check_constraints = ON')
      try {
        db.prepare(
          `UPDATE identity_instruction SET wrote_it = 'a-word-from-a-later-build'
             WHERE id = 'ins:archivist:1'`,
        ).run()
      } finally {
        db.pragma('ignore_check_constraints = OFF')
      }
      expect(store.ownInstructionsOf('archivist').versions[0]?.whoWroteIt).toBe(
        'an-agents-proposal',
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · what a creation writes, and what reaches the agent
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§2 · the rules a creator sends', () => {
    it('🔴 they are version 1, attributed to the creator, and the FIRST launch composes them', async () => {
      const { me, tools } = await brobot()
      const made = await callOn(tools, 'create_agent', {
        profile_slug: 'archivist',
        rules: 'Never force-push. Ask before deleting anything.',
      })
      expect(made['outcome'], JSON.stringify(made)).toBe('ok')
      expect(made['rules']).toBe('written')

      const held = store.ownInstructionsOf('archivist')
      expect(held.versions).toHaveLength(1)
      const one = whatIsInForce(held)
      expect([one?.version, one?.whoWroteIt, one?.text]).toEqual([
        1,
        'its-creator',
        'Never force-push. Ask before deleting anything.',
      ])
      // ⚑ **The ACTOR is the conversation that called, and the CONVERSATION column names it too**
      // — `proposeAgentRules`' own pair, one door over.
      expect(one?.by).toEqual({ who: 'an-agent', agent: me })
      expect(one?.conversation).toBe(me)
      // ⛔ **No claim and no revert**: a creator makes no case to anybody and brings nothing back.
      expect([one?.said, one?.broughtBack]).toEqual([null, null])

      // 🔴 **The whole of the ruling: the agent is TOLD.** ⚠️ Asserted on the bytes a launch
      // composed rather than on the store, because the store agreeing with itself proves nothing
      // about the seam.
      const first = await personOpens('archivist')
      expect(seen.at(-1)?.configured).toBe('Never force-push. Ask before deleting anything.')
      expect(bundles.at(-1)).toContain(
        '## Your own instructions\n\nNever force-push. Ask before deleting anything.',
      )
      await host.close(first, window)
    })

    /**
     * 🔴 **618 · `by` is the only thing that says WHICH conversation wrote a version**, and it was
     * unreadable.
     *
     * ⛔ **Measured:** `identity_instruction.by` is `mode: 'json'` in `schema.ts` and this store
     * reads with raw `better-sqlite3` statements, so the column arrives as TEXT and `actedByFrom`'s
     * first line — `typeof stored !== 'object'` — folded every row to `the-app-itself`. ⚠️ **Since
     * `582`, for every version, whoever wrote it.** ⚑ **Nothing a person saw was wrong**:
     * `OwnInstructions.vue` draws the provenance WORD and never this field, which is why no
     * instrument went red.
     *
     * ⚑ **The control is what makes this a measurement rather than an echo**: two versions of one
     * identity, written by two different actors, must read back as two different answers.
     */
    it('🔴 the ACTOR reads back as the one who wrote it — an agent, then the person', async () => {
      const { me, tools } = await brobot()
      await callOn(tools, 'create_agent', {
        profile_slug: 'archivist',
        rules: 'What its maker said.',
      })
      host.instructAgent('archivist', 'The person’s own.', undefined, window)
      expect(
        store.ownInstructionsOf('archivist').versions.map((v) => [v.whoWroteIt, v.by]),
      ).toEqual([
        ['a-person', { who: 'a-person' }],
        ['its-creator', { who: 'an-agent', agent: me }],
      ])
    })

    /**
     * ⛔ **`HO-078` §4.3 — creating without rules is the ORDINARY case and must stay ordinary.**
     *
     * ⚠️ **Absent is not `''`**, and the two are measured apart here rather than described apart:
     * one writes no row, the other writes a row that says *there are none*.
     */
    it('⚑ omitting them writes NO version at all, and the first launch has no such heading', async () => {
      const { tools } = await brobot()
      const made = await callOn(tools, 'create_agent', { profile_slug: 'archivist' })
      expect(made['outcome']).toBe('ok')
      // ⛔ **The key is ALWAYS there** — *nothing was written* said rather than left to be read off
      // an absent field (`an-unenumerated-state-counts-as-success`).
      expect(made['rules']).toBe('none-given')
      expect(store.ownInstructionsOf('archivist').versions).toEqual([])
      expect(versionRows('archivist')).toEqual([])

      const first = await personOpens('archivist')
      expect(seen.at(-1)?.configured).toBeNull()
      expect(bundles.at(-1)).not.toContain('## Your own instructions')
      await host.close(first, window)
    })

    it('⛔ an EMPTY string writes a version that says *there are none*, with a date and an author', async () => {
      const { tools } = await brobot()
      expect(
        (await callOn(tools, 'create_agent', { profile_slug: 'archivist', rules: '' }))['rules'],
      ).toBe('written')
      const held = store.ownInstructionsOf('archivist')
      expect(held.versions.map((v) => [v.version, v.text, v.whoWroteIt])).toEqual([
        [1, '', 'its-creator'],
      ])
      // ⚑ **And the LAUNCH renders no heading for it**, exactly as for an identity nobody wrote
      // for — `configuredLayerOf` is the one place that decides, and it decides on the text.
      expect(configuredLayerOf(held)).toBeNull()
      const first = await personOpens('archivist')
      expect(seen.at(-1)?.configured).toBeNull()
      await host.close(first, window)
    })

    it('⚑ the success answer says which of the two happened, in the payload AND in the sentence', async () => {
      const { tools } = await brobot()
      const tool = tools.tools.find((one) => one.name === 'create_agent')
      const withRules = await tool?.call({ profile_slug: 'archivist', rules: 'Be careful.' })
      expect((withRules?.structured as Record<string, unknown>)['rules']).toBe('written')
      expect(withRules?.text).toContain('Its rules are saved.')
      // The sentence echoes neither the rules nor the slug the call sent.
      expect(withRules?.text).not.toContain('Be careful.')
      expect(withRules?.text).not.toContain('archivist')

      const without = await tool?.call({ profile_slug: 'auditor' })
      expect((without?.structured as Record<string, unknown>)['rules']).toBe('none-given')
      expect(without?.text).not.toContain('Its rules are saved.')
      expect(without?.text).not.toContain('version')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · one write, at creation, and never again — and then it is the person's
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · a second call for the same identity', () => {
    /**
     * 🔴 **`HO-078` §4.1 asked *refused or a no-op — say which, and why*. It is REFUSED, and by a
     * rail that was already there.**
     *
     * ⛔ **`agent-name-taken` is asked BEFORE anything is written**, so the second call's rules are
     * never read at all. ⚑ **That is the answer's whole shape**: there is no second write path to
     * guard, because there is no second creation.
     */
    it('🔴 it is REFUSED by `agent-name-taken`, and the first version is untouched', async () => {
      const { tools } = await brobot()
      await callOn(tools, 'create_agent', { profile_slug: 'archivist', rules: 'The first rules.' })

      const again = await callOn(tools, 'create_agent', {
        profile_slug: 'archivist',
        rules: 'Rules the creator would rather have written.',
      })
      expect(again['outcome']).toBe('refused')
      expect(again['rail']).toBe('agent-name-taken')
      expect(again['permanence']).toBe('permanent')
      expect(again['retryable']).toBe(false)
      // ⛔ **Nothing was written and nothing was replaced** — one version, and it is the first one.
      expect(store.ownInstructionsOf('archivist').versions.map((v) => v.text)).toEqual([
        'The first rules.',
      ])
    })

    /**
     * 🔴 **`HO-078` §1.1: *after that it is the person's*.**
     *
     * ⛔ **A person's save APPENDS over the creator's** — the creator's version is history, not a
     * floor — and the launch composes the person's.
     */
    it('🔴 a person writes over them, the creator’s version stays as history, and the launch takes the person’s', async () => {
      const { tools } = await brobot()
      await callOn(tools, 'create_agent', {
        profile_slug: 'archivist',
        rules: 'What its maker said.',
      })

      host.instructAgent('archivist', 'What I say now.', undefined, window)
      const held = store.ownInstructionsOf('archivist')
      expect(held.versions.map((v) => [v.version, v.whoWroteIt, v.text])).toEqual([
        [2, 'a-person', 'What I say now.'],
        [1, 'its-creator', 'What its maker said.'],
      ])
      expect(whatIsInForce(held)?.whoWroteIt).toBe('a-person')

      const first = await personOpens('archivist')
      expect(seen.at(-1)?.configured).toBe('What I say now.')
      await host.close(first, window)
    })

    /**
     * 🔴 **The BOUNDARY of the widening, measured from both sides in one test.**
     *
     * ⛔ **`canCreateAgents` buys the creating write. It buys nothing afterwards.** BroBot holds
     * the ruled `canWriteRules: 'none'` like every agent — and the same caller that just wrote an
     * identity's first rules cannot ask to change them.
     */
    it('🔴 the same caller cannot touch those rules again: `propose_agent_rules` is refused', async () => {
      const { tools } = await brobot()
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canWriteRules).toBe('none')
      expect(
        (await callOn(tools, 'create_agent', { profile_slug: 'archivist', rules: 'Mine.' }))[
          'rules'
        ],
      ).toBe('written')

      const asked = await callOn(tools, 'propose_agent_rules', {
        agent: 'archivist',
        rules: 'Something I thought better of.',
        why: 'I changed my mind.',
      })
      expect(asked['outcome']).toBe('refused')
      expect(asked['rail']).toBe('may-not-write-rules')
      expect(store.ownInstructionsOf('archivist').versions.map((v) => v.text)).toEqual(['Mine.'])
    })

    it('⚑ …and with the grant a person gave it, the same call ASKS rather than writing', async () => {
      const { tools } = await brobot()
      await callOn(tools, 'create_agent', { profile_slug: 'archivist', rules: 'Mine.' })
      // ⚠️ **A person at the sheet, which is the only thing that moves this column** (rule 32: a
      // value a person set is a rail; an argument a model passes is a habit).
      expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canWriteRules: 'propose' })).toBe(true)
      const second = await personOpens(DEFAULT_PROFILE_ID)
      const asked = await callOn(toolsOfLastLaunch(), 'propose_agent_rules', {
        agent: 'archivist',
        rules: 'A second thought.',
        why: 'because',
      })
      expect(asked['outcome']).toBe('ok')
      expect(asked['wrote']).toBe('a-request')
      // ⛔ **A proposal writes NOTHING**: the creator's version is still the only one.
      expect(store.ownInstructionsOf('archivist').versions.map((v) => v.text)).toEqual(['Mine.'])
      void tools
      await host.close(second, window)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the bound, and it is asked before anything is minted
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · 16,000 characters', () => {
    /**
     * ⛔ **LITERALS, deliberately** — `a-bound-written-as-the-constant-cannot-pin-it`. ⚑ A test
     * written as `OWN_INSTRUCTIONS_CHARS + 1` moves with whatever the constant becomes and can
     * never say what the bound IS; these two numbers pin 16,000 and go red when it moves, which is
     * the moment somebody should be looking.
     */
    it('⚑ exactly 16,000 characters is taken whole, and the launch carries all of it', async () => {
      const { tools } = await brobot()
      const long = 'x'.repeat(16_000)
      expect(
        (await callOn(tools, 'create_agent', { profile_slug: 'archivist', rules: long }))['rules'],
      ).toBe('written')
      expect(store.ownInstructionsOf('archivist').versions[0]?.text).toHaveLength(16_000)
      const first = await personOpens('archivist')
      expect(seen.at(-1)?.configured).toHaveLength(16_000)
      await host.close(first, window)
    })

    it('🔴 16,001 is refused with a reason a model can classify — and NOTHING is created', async () => {
      const { tools } = await brobot()
      const refused = await callOn(tools, 'create_agent', {
        profile_slug: 'archivist',
        rules: 'x'.repeat(16_001),
      })
      expect(refused['outcome']).toBe('refused')
      // ⛔ **A RAIL word and a permanence, never a transport error** (`307`): a model can tell
      // *this call can never work* from *the world is busy*.
      expect(refused['rail']).toBe('malformed-request')
      expect(refused['permanence']).toBe('permanent')
      expect(refused['retryable']).toBe(false)
      const problems = problemsOf(refused)
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain('rules')
      expect(problems[0]).toContain('16000')

      // 🔴 **The half that matters most**: the bound is asked ABOVE the mint, so a refused
      // creation leaves no durable identity behind — criterion 12's own failure mode, arriving
      // through the argument that was meant to enrich it.
      expect(identityRow('archivist')).toBeUndefined()
      expect(store.agentIdentities().map((one) => one.slug)).not.toContain('archivist')
    })

    it('⛔ a `rules` that is not a string is refused, and every problem arrives at once', async () => {
      const { tools } = await brobot()
      const refused = await callOn(tools, 'create_agent', {
        profile_slug: 'NOT A SLUG',
        rules: { paste: 'an object' },
      })
      expect(refused['rail']).toBe('malformed-request')
      // ⛔ **Both, never the first one** (`325`) — a model fixing one argument per round trip is a
      // model spending two turns on one call.
      const problems = problemsOf(refused)
      expect(problems).toHaveLength(2)
      expect(problems.join(' ')).toContain('profile_slug')
      expect(problems.join(' ')).toContain('rules')
      expect(identityRow('not a slug')).toBeUndefined()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · the spawn rails still fire first
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · entitlement before the argument, with the argument at its worst', () => {
    /**
     * 🔴 **`HO-078` §4.4, and HO-031 §2.5 is the order.**
     *
     * ⛔ **Tested where the two readings DIVERGE** (standing rule 3): the SAME call, over the
     * bound, meets a different word depending only on the caller's grant. ⚠️ A test that sent a
     * well-formed call would have been a comparison where both readings agree, which is what
     * `341`'s three surviving rows were.
     */
    it('🔴 an unentitled caller sending 20,000 characters meets the GRANT, not the bound', async () => {
      // ⚠️ **A person narrows the grant at the sheet** — the only thing that moves it. ⛔ **After a
      // launch, because `setCapabilities` REFUSES to create the row** (criterion 12 from the other
      // side): an identity nobody has run as has nothing to narrow.
      const opened = await brobot()
      await host.close(opened.me, window)
      expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canCreateAgents: 'none' })).toBe(true)
      const { tools } = await brobot()
      const refused = await callOn(tools, 'create_agent', {
        profile_slug: 'archivist',
        rules: 'x'.repeat(20_000),
      })
      expect(refused['rail']).toBe('may-not-create-agents')
      expect(refused['permanence']).toBe('until-a-person-changes-it')
      // ⛔ **It never learns that this field has a bound**, which is the trade HO-031 §2.5 asks
      // for: a caller that may not create has no use for the arguments it would have needed.
      expect(problemsOf(refused)).toEqual([])
      expect(identityRow('archivist')).toBeUndefined()

      // ⚑ **The pair, one fact over**: widen the grant and the identical call meets the bound.
      expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canCreateAgents: 'any' })).toBe(true)
      const second = await personOpens(DEFAULT_PROFILE_ID)
      const now = await callOn(toolsOfLastLaunch(), 'create_agent', {
        profile_slug: 'archivist',
        rules: 'x'.repeat(20_000),
      })
      expect(now['rail']).toBe('malformed-request')
      expect(problemsOf(now)[0]).toContain('rules')
      await host.close(second, window)
    })

    it('⛔ the kill switch is asked in front of it too, and writes nothing either', async () => {
      const { tools } = await brobot()
      store.setSpawningEnabled(false)
      const refused = await callOn(tools, 'create_agent', {
        profile_slug: 'archivist',
        rules: 'A perfectly good rule set.',
      })
      expect(refused['rail']).toBe('spawning-disabled')
      expect(identityRow('archivist')).toBeUndefined()
      expect(db.prepare('SELECT COUNT(*) AS n FROM identity_instruction').get()).toEqual({ n: 0 })
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §6 · what the optionality is doing, and the grant nothing seeds
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§6 · the optional argument, and the measurement behind it', () => {
    /**
     * 🔴 **`a-default-no-call-site-reaches`, asked in both directions** (`HO-078` §4.3).
     *
     * ⛔ **At the HOST the parameter is REQUIRED**, so no call site falls through to a default
     * nobody chose — the compiler is what enforces that, and this census is what says the door is
     * the only place the value can come from.
     */
    it('⛔ the tool is the ONLY caller of `createAgentFor` in `src/`, and it computes the value', () => {
      const strip = (source: string): string =>
        source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')
      const tools = strip(readFileSync(join(srcRoot, 'main/runtime/agent-tools.ts'), 'utf8'))
      const host = strip(readFileSync(join(srcRoot, 'main/runtime/runtime-host.ts'), 'utf8'))
      // ⚑ **One declaration in the host, one call in the tool layer, and nothing else** — a census
      // over what the code SAYS, with the stripper making it a claim about code.
      expect(host.match(/createAgentFor\(/g)).toHaveLength(1)
      expect(tools.match(/host\.createAgentFor\(/g)).toHaveLength(1)
      // ⛔ **And the value is DERIVED from the argument**, never a literal: a door that passed a
      // constant would make the optional field unreachable while the schema went on advertising it.
      expect(tools).toContain('rules === undefined ? null : (rules as string)')
      const quoted = '/** `host.createAgentFor(` is named here. */'
      expect(strip(quoted)).not.toContain('createAgentFor(')
    })

    /**
     * 🔴 **The measurement the tool's own description rests on** (`456`'s defect, avoided).
     *
     * ⛔ **Nothing in this app seeds a grant** (D-014) — not the app's own row, not any other — so
     * on a fresh install EVERY identity holds the ruled `'none'` and `propose_agent_rules`
     * refuses every caller. ⚠️ **That is why the `rules` field's description names no sibling
     * verb**: a clause sending a caller there would send it to a refusal, which is the exact shape
     * `456` measured costing eleven of twelve live arms.
     *
     * ⛔ **It is also why the creating write is not gated on that column**: gating it would have
     * shipped `HO-078` §4 dark on every install.
     */
    it('🔴 nothing seeds `canWriteRules`, so a fresh install holds the ruled `none` everywhere', () => {
      const field = CAPABILITY_FIELDS.find((one) => one.key === 'canWriteRules')
      expect(field?.ruled).toBe('none')
    })

    it('🔴 …and BroBot’s OWN row holds it, as a first launch leaves it', async () => {
      // ⚑ **Measured on the shipped row rather than read off the table** — the identity this app
      // launches first, after the launch that brings it into being.
      const { me } = await brobot()
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canCreateAgents).toBe('any')
      expect(store.capabilitiesOf(DEFAULT_PROFILE_ID)?.canWriteRules).toBe('none')
      void me
    })

    /**
     * ⚠️ **The person-facing sentence this ruling made false, pinned BY NAME** (standing rules 5
     * and 8.1).
     *
     * ⛔ **`canCreateAgents`' help read *"a name, and nothing else"*** and was rendered directly
     * beside the control a person sets. ⚑ This is the repaired clause and the withdrawn one, so a
     * later edit that quietly put the old sentence back goes red here.
     */
    it('⚠️ the grant’s own help says what creation now carries, and its BOUND', () => {
      const help = CAPABILITY_FIELDS.find((one) => one.key === 'canCreateAgents')?.help ?? ''
      expect(help).toContain('the standing rules that new agent starts with')
      expect(help).toContain('only as it creates the agent and never again')
      expect(help).not.toContain('a name, and nothing else')
      // ⚑ **The control that makes the negative mean something**: the OLD sentence really is the
      // one that would have matched.
      expect('a name, and nothing else. It does not start that agent').toContain(
        'a name, and nothing else',
      )
    })

    it('⛔ the bound the shared constant carries is the one the door refuses on', () => {
      // ⚠️ **Not a tautology**: the door spells the number into a sentence a model reads, and this
      // is the one place the two are compared.
      expect(OWN_INSTRUCTIONS_CHARS).toBe(16_000)
    })
  })
})
