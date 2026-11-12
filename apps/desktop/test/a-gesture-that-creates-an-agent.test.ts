import { withoutProse } from './lib/source-without-prose'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { CAPABILITY_FIELDS, DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import { NONE_STARTED, theProviderOfAnAgent } from '../src/shared/agent-roster'
import {
  createAgentStore,
  identityIn,
  providerForALaunch,
} from '../src/renderer/src/lib/agent-store'
import { providerIsFixed } from '../src/renderer/src/lib/front-door-words'
import {
  DEFAULT_PROFILE_ID,
  type AgentIdentities,
  type AgentIdentity,
  type NewAgent,
  type RuntimeBridge,
} from '../src/shared/runtime-ipc'

/**
 * # 🔴 423 · the gesture that brings an agent into existence, and the provider it decides
 *
 * `417` deleted `+ New profile…`; `419` built a `createAgent` command, a store transaction and a
 * preload member and shipped **no caller**. HO-023 §3 holds `417` and `420` on the one gesture a
 * person can press, so this file is about two things and they are the same thing twice:
 *
 *  - **§0–§2** the renderer half of the creation — the store verb, the sentence a person reads, and
 *    what crosses the wire;
 *  - **§3–§4** `DEFAULT_PROVIDER` demoted from *the answer* to *the fallback for an identity that
 *    has not said*, and — the part worth more than the repair — **a measurement of which writers
 *    can ever put a value in the slot that fallback defers to.**
 *
 * ⚠️ **What is NOT here**: everything the door itself does. `creating-an-agent.test.ts` is 419's and
 * owns the rails, the fold, the migration and the two doors. This file asserts the parts
 * `419` could not, because they did not exist: a caller, and a launch that consults the column.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '../src')
const migrationsFolder = join(SRC, 'main/db/migrations')

const identity = (over: Partial<AgentIdentity> = {}): AgentIdentity => ({
  id: `aid:${over.slug ?? 'worker'}`,
  slug: 'worker',
  displayName: null,
  createdAt: 1_700_000_000_000,
  // ⚑ **598 · who brought it into being** — null is *nobody recorded it*; see `AgentIdentity.createdBy`.
  createdBy: null,
  provider: null,
  // ⚑ **516** — presence IS the grant, so an empty list is *granted none*, not *not chosen*.
  externalMcpServerIds: [],
  capabilities: {
    // ⚑ **D-014 · the one default set** — six levels below the root.
    maxDepth: 6,
    // ⚑ **549** — HO-058 §1's ruled word, and the one that is NOT `same-project` any more.

    // ⚑ **D-014** — the ruled word, which is *a conversation you started*.

    canCreateAgents: 'any',
    // ⚑ **582 · the ruled default, which is the narrowest** — an identity nobody has spoken about
    // may not reach into what another agent is told.
    canWriteRules: 'none',
  },
  chosen: {
    maxDepth: 'default',

    canCreateAgents: 'default',
    canWriteRules: 'default',
  },
  ...over,
})

// ⚑ Each identity's use says what it runs on, as the host folds it: its saved provider, and no
// conversation behind any of them.
const roster = (identities: AgentIdentity[], orphans: string[] = []): AgentIdentities => ({
  identities,
  foldersWithoutARow: orphans,
  use: identities.map((one) => ({
    slug: one.slug,
    conversations: 0,
    thisAppMintsIt: false,
    isLaunching: false,
    isStarting: false,
    runsOn: theProviderOfAnAgent(one.provider, NONE_STARTED),
  })),
  spawningEnabled: true,
  // 500 · required on `AgentIdentities`; this file is about creating an identity, not about the
  // mode a launch begins in.
  defaultApprovalMode: 'ask',
  // ⚑ **516** — the global registry, carried on the same read; empty is a real answer.
  externalMcpServers: [],
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §0 · the store verb `419` did not ship
// ─────────────────────────────────────────────────────────────────────────────────────────────

interface Fake {
  created: unknown[]
  reads: number
  list: AgentIdentities
  refuseWith: Error | null
  /** What the NEXT roster read throws, if anything — the re-read after a successful create. */
  readFailsWith: Error | null
}

function storeOver(fake: Fake): ReturnType<typeof createAgentStore> {
  const bridge = {
    agentIdentities: async () => {
      fake.reads += 1
      if (fake.readFailsWith !== null) throw fake.readFailsWith
      return fake.list
    },
    createAgent: async (input: unknown) => {
      // 🔴 **Cloned the way the REAL bridge clones** — `capabilities-sheet.dom.test.ts`'s rule and
      // `218`'s measurement. `ipcRenderer.invoke` structured-clones its payload and the algorithm
      // REFUSES a Vue Proxy; an in-process fake passes one straight through, so a form that handed
      // its own `ref`-backed object over would be green here and throw in the shipped app.
      structuredClone(input)
      fake.created.push(input)
      if (fake.refuseWith !== null) throw fake.refuseWith
      // ⚑ **712 · the row FOR the slug it was asked to create** — main reads back the row it wrote,
      // and since `712` the store names a new agent off that answer (R41). ⛔ A row for another slug
      // is a world production cannot build (`a-test-double-can-build-a-world-production-cannot`).
      return identity({ slug: (input as { slug: string }).slug })
    },
  } as unknown as RuntimeBridge
  return createAgentStore(bridge)
}

describe('§0 · AgentStore.create — the caller 419 left for this dispatch', () => {
  let fake: Fake
  beforeEach(() => {
    fake = { created: [], reads: 0, list: roster([]), refuseWith: null, readFailsWith: null }
  })

  it('⛔ puts exactly the three fields of NewAgent on the wire, and nothing of its own', async () => {
    const store = storeOver(fake)
    expect(await store.create({ slug: 'worker', displayName: 'W', provider: 'claude' })).toBeNull()
    // ⚠️ **`toEqual` on the WHOLE object, not three `toHaveProperty`s.** A fourth field — a
    // `projectSlug`, a `cwd`, a capability, a role — is precisely what `RuntimeHost.createAgent`'s
    // docblock spends four paragraphs refusing, and only an equality can see one arrive.
    expect(fake.created).toEqual([{ slug: 'worker', displayName: 'W', provider: 'claude' }])
  })

  it('⚑ a blank display name and provider are NULL on the wire and never absent', async () => {
    const store = storeOver(fake)
    await store.create({ slug: 'worker', displayName: null, provider: null })
    // 339 / HO-005 criterion 10: an absent key and an explicit null are the same value to a
    // `Partial` and are not the same intent, so the schema takes `.nullable()` and never
    // `.optional()`. A payload that dropped them would fail by name — which is the point.
    expect(Object.keys(fake.created[0] as object).sort()).toEqual([
      'displayName',
      'provider',
      'slug',
    ])
    expect(fake.created[0]).toMatchObject({ displayName: null, provider: null })
  })

  it('⛔ re-reads the roster on success, so a sheet that closes closes over a list that has the row', async () => {
    const store = storeOver(fake)
    await store.load()
    expect(fake.reads).toBe(1)
    fake.list = roster([identity()])
    expect(await store.create({ slug: 'worker', displayName: null, provider: null })).toBeNull()
    // ⚑ **Re-read and not pushed.** `listIdentities` is `ORDER BY slug`; appending the returned
    // row would make this store a second authority on where it goes.
    expect(fake.reads).toBe(2)
    expect(identityIn(store.identities.value, 'worker')).not.toBeNull()
  })

  it('🔴 a create whose RE-READ failed is not reported as a plain success', async () => {
    // ⛔ **`load` swallows its own failure by design** — 086's rule: a read that could not be made
    // has not learned there are no identities. ⚠️ So `await load()` alone answered null, the sheet
    // closed, the row existed and the rail still showed the list from before: a surface reporting
    // work it did not do, in the one direction nobody looks.
    //
    // ⚑ **`save` cannot hit this** — it patches the row it already holds before re-reading. A
    // creation has nowhere to patch, because the ORDER is the database's.
    const store = storeOver(fake)
    await store.load()
    fake.readFailsWith = new Error('BroBot2 is shutting down, so agentIdentities was not asked')
    const said = await store.create({ slug: 'archivist', displayName: null, provider: null })
    expect(said).toContain('archivist was created')
    expect(said).toContain('BroBot2 is shutting down')
    // ⚑ The pairing: the same call with a re-read that works answers null.
    fake.readFailsWith = null
    expect(await store.create({ slug: 'archivist', displayName: null, provider: null })).toBeNull()
  })

  it('⛔ …and does NOT re-read when the door refused — the list has not changed', async () => {
    const store = storeOver(fake)
    await store.load()
    fake.refuseWith = new Error('There is already an agent called worker.')
    expect(await store.create({ slug: 'worker', displayName: null, provider: null })).toBe(
      'There is already an agent called worker.',
    )
    expect(fake.reads).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §1 · the sentence a person actually reads
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§1 · the refusal reaches a person as the app wrote it', () => {
  /**
   * 🔴 **The defect this fixes, and why no test in the repo could see it.**
   *
   * `ipcMain.handle` rejections arrive wrapped: Electron prefixes
   * `Error invoking remote method 'runtime:command': Error: `. ⛔ Every refusal this store has ever
   * surfaced went to the screen with that in front of it — `setCapabilities`' *"who may ask"*, the
   * kill switch's, and now `419`'s collision sentence. ⚠️ **A fake bridge rejects with a plain
   * `Error`**, so the wrapper exists only in the shipped app: the fixture that would have caught it
   * is the one nobody writes. `session-record.ts`'s `readableError` has owned the strip since
   * `221`, `session-store.ts` has called it in two places since `090` and `CommandPalette` since
   * `249 M20`; this store did not, and neither do five other renderer sites `423` reports.
   */
  it('🔴 an Electron-wrapped rejection is stripped to the host’s own words', async () => {
    const fake: Fake = {
      created: [],
      reads: 0,
      list: roster([]),
      refuseWith: null,
      readFailsWith: null,
    }
    const store = storeOver(fake)
    const hostSaid =
      "There is already an agent called worker. An agent's name is its identity, so it cannot be " +
      'reused — and names are compared without case, because a profile is its folder.'
    fake.refuseWith = new Error(
      `Error invoking remote method 'runtime:command': Error: ${hostSaid}`,
    )
    expect(await store.create({ slug: 'Worker', displayName: null, provider: null })).toBe(hostSaid)
  })

  it('⚑ …and the control: a sentence that was never wrapped is not trimmed', async () => {
    // ⛔ Without this, `readableError` could be replaced by anything that shortens a string.
    const fake: Fake = {
      created: [],
      reads: 0,
      list: roster([]),
      refuseWith: null,
      readFailsWith: null,
    }
    const store = storeOver(fake)
    fake.refuseWith = new Error(
      'BroBot2 is shutting down, so createAgent was not asked of its database',
    )
    expect(await store.create({ slug: 'worker', displayName: null, provider: null })).toBe(
      'BroBot2 is shutting down, so createAgent was not asked of its database',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §2 · one value decides the launch and says so
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§2 · the provider the front door runs on, resolved', () => {
  it('⛔ BroBot’s identity wins, and the constant is what is left when it has not said', () => {
    const said = roster([identity({ slug: DEFAULT_PROFILE_ID, provider: 'claude' })])
    const silent = roster([identity({ slug: DEFAULT_PROFILE_ID, provider: null })])
    // 🔴 The measurement: the SAME fallback argument, two identities, two answers.
    expect(providerForALaunch(said, DEFAULT_PROFILE_ID, 'codex')).toBe('claude')
    expect(providerForALaunch(silent, DEFAULT_PROFILE_ID, 'codex')).toBe('codex')
  })

  it('⚑ nobody has asked yet, and no such identity, both fall back — and they are different facts', () => {
    // ⚠️ `null` is *the roster read has not landed*; an empty roster is *it landed and BroBot has
    // no row*. This function folds them on purpose, and the fold is what `RuntimeScreen`'s docblock
    // names as the one window where the answer could be the constant for the wrong reason.
    expect(providerForALaunch(null, DEFAULT_PROFILE_ID, 'codex')).toBe('codex')
    expect(providerForALaunch(roster([]), DEFAULT_PROFILE_ID, 'codex')).toBe('codex')
    // …and it is really reading the slug, not the first row.
    expect(
      providerForALaunch(roster([identity({ provider: 'claude' })]), DEFAULT_PROFILE_ID, 'codex'),
    ).toBe('codex')
  })

  it('⚑ …and the two providers really do produce different words, so the sentence is a measurement', () => {
    // `151`'s rule: a provider named in running prose is spelled the way a person reads it.
    expect(providerIsFixed('claude')).toContain('Claude')
    expect(providerIsFixed('codex')).toContain('Codex')
    expect(providerIsFixed('claude')).not.toBe(providerIsFixed('codex'))
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §3 · 🔴 what can ever put a value in the slot the fallback defers to
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§3 · the identity’s default provider — every writer, measured', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-423-'))
    db = openDatabase(join(dir, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    store = createSessionStore(db)
  })
  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const providerColumn = (slug: string): unknown =>
    (
      db.prepare('SELECT provider FROM agent_identity WHERE slug = ?').get(slug) as
        { provider: unknown } | undefined
    )?.provider ?? null

  it('⛔ only the default-provider door updates identity defaults; no writer changes a conversation provider', () => {
    // ⚠️ **Search shape** (standing rule 4): a value reaches that column through an
    // `INSERT … INTO agent_identity` or an `UPDATE agent_identity SET`, and through nothing else —
    // there is no other DML against this table. ⛔ **Both kinds are enumerated, in `.ts` AND in
    // `.sql`.** The first draft searched only the UPDATE, in `.ts` only, while its own comment
    // claimed it searched both — `a-filter-can-blind-the-instrument-that-justifies-it`, written
    // into a census.
    const files: string[] = []
    const walk = (at: string): void => {
      for (const name of readdirSync(at)) {
        const path = join(at, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (path.endsWith('.ts') || path.endsWith('.sql')) files.push(path)
      }
    }
    walk(join(SRC, 'main'))
    expect(files.length, 'the walk found nothing, so this census measures nothing').toBeGreaterThan(
      30,
    )

    /**
     * ⛔ **Each STATEMENT, cut at a boundary the language gives** — never a fixed slice and never
     * *"up to the next `;`"* in TypeScript, where a SQL string is a template literal and the next
     * semicolon is fifty lines away (`a-fixed-width-slice-runs-into-the-next-region`, and the
     * defect the first draft of this test actually had).
     *
     * In `.sql` a statement ends at `;`. In `.ts` every SQL string in this app is the argument of
     * `db.prepare(`, so the call's own parentheses are the bound — counted, so an inner `)` in
     * `${…}` does not end it early.
     */
    const chunks = (file: string, source: string): string[] => {
      const code = withoutProse(source)
      if (file.endsWith('.sql')) return code.replace(/--.*$/gm, '').split(';')
      const out: string[] = []
      for (const call of code.matchAll(/db\.prepare\(/g)) {
        let depth = 1
        let at = (call.index ?? 0) + call[0].length
        const from = at
        while (at < code.length && depth > 0) {
          if (code[at] === '(') depth += 1
          else if (code[at] === ')') depth -= 1
          at += 1
        }
        out.push(code.slice(from, at - 1))
      }
      return out
    }

    const writers = files.flatMap((file) =>
      chunks(file, readFileSync(file, 'utf8'))
        .filter((sql) => /(INSERT[^;]*INTO|UPDATE)\s+`?agent_identity`?\b/i.test(sql))
        .map((sql) => ({ file: file.slice(SRC.length + 1).replaceAll('\\', '/'), sql })),
    )
    const inserts = writers.filter((each) => /INSERT/i.test(each.sql))
    const updates = writers.filter((each) => /UPDATE\s+`?agent_identity`?\s+SET/i.test(each.sql))
    // ⛔ **The control plants TWO** (standing rule 12): the enumeration must find BOTH kinds and
    // BOTH file types, or a cutter that produced nothing would satisfy every claim below over an
    // empty list.
    expect(inserts.length).toBeGreaterThan(0)
    expect(updates.length).toBeGreaterThan(0)
    expect(updates.some((each) => each.file.endsWith('.ts'))).toBe(true)
    // ⚑ **D-016 · the one migration writes no identity row** — `0000_the_tree.sql` creates the table
    // and inserts only the policy row — so the `.sql` half of the control is that the cutter really
    // reads that file: it finds the policy row's INSERT, and the `.sql` claim below is not a claim
    // over a file nobody cut.
    const sqlFiles = files.filter((file) => file.endsWith('.sql'))
    expect(sqlFiles.length).toBeGreaterThan(0)
    expect(
      sqlFiles
        .flatMap((file) => chunks(file, readFileSync(file, 'utf8')))
        .some((sql) => /INSERT OR IGNORE INTO `app_policy`/.test(sql)),
    ).toBe(true)

    // 🔴 **THE MEASUREMENT, re-pointed at 433 and NOT weakened.** It read *"not one UPDATE
    // anywhere names `provider`"* and that was the honest claim while the column had one writer.
    // ⛔ **433 gave it a second one on purpose** — `setAgentProvider`, the verb HO-024 §2.2 calls
    // *required, not planned* — so the claim becomes the one that was always the point: **every
    // statement that can move this column names `agent_identity`, and no statement anywhere moves
    // it on a SESSION.** ⚑ That second half is `a-front-door-that-asks-nothing.test.ts` §1's census
    // over `UPDATE provider_session`, and it is still green; this is the same fact from the
    // identity's side.
    expect(
      updates
        .filter((each) => /\bprovider\b/.test(each.sql))
        .map((each) => each.file)
        .sort(),
      'a statement that moves `provider` arrived somewhere new — say which door it is',
    ).toEqual(['main/db/session-store.ts'])
    // ⛔ **No MIGRATION moves it, and that is 433's own decision rather than an accident.** A
    // migration filling BroBot's NULL would move what `RuntimeScreen.frontDoorProvider` starts —
    // that column is its FIRST term — on a database whose owner never asked. `SEEDED_PROVIDERS`
    // carries the measurement; this is the line that keeps it true.
    expect(
      updates.filter((each) => each.file.endsWith('.sql') && /\bprovider\b/.test(each.sql)),
    ).toEqual([])
    // ⚠️ **The app's `.ts` UPDATEs are one per question**, which is why `provider` is not a
    // sixth `?` on the capability writer: that statement's SET list is `CAPABILITY_COLUMNS` and
    // provider is not one of them, so a shared writer would have had to answer two questions.
    //
    // 🔴 **558 · a THIRD one arrived and the rule held**: `display_name` got its own statement for
    // the same reason `provider` did — it is not a capability, no rail reads it, and it would have
    // been a seventh `?` on a writer whose column list is derived from the schema. ⛔ The count
    // moved because the world did; the *one per question* claim is what it measures, so it is
    // spelled out below rather than left to a length.
    //
    // 🔴 **677 · a FOURTH, and the door is `setAgentModelAndEffort`** (`R25`) — a person's model and
    // effort for an identity, behind `requireAPerson`. ⛔ Its own statement for the reason the two
    // above have theirs: it is not a capability (it grants nothing; the rail that reads it refuses a
    // spawner's argument), and it would have been another `?` on a writer whose column list is
    // derived from the capability schema. ⚑ It writes `model_choice` and never `provider`, which is
    // what the rest of this section is about.
    expect(updates.filter((each) => each.file.endsWith('.ts')).map((each) => each.file)).toEqual([
      'main/db/session-store.ts',
      'main/db/session-store.ts',
      'main/db/session-store.ts',
      'main/db/session-store.ts',
    ])
    const setList = (sql: string): string => sql.slice(sql.indexOf('SET'))
    expect(
      updates
        .filter((each) => each.file.endsWith('.ts'))
        .map((each) => setList(each.sql).split(' WHERE')[0]?.trim())
        .sort(),
      'an UPDATE on agent_identity answers a question one of the others already answers',
    ).toEqual([
      "SET ${CAPABILITY_COLUMNS.map((column) => `${column} = ?`).join(', ')}",
      'SET display_name = ?',
      'SET model_choice = ?',
      'SET provider = ?',
    ])
    // …and `provider` is not one of those columns, which is the claim `AgentIdentity.provider`'s
    // own docblock makes — *"not a capability, and it is on this record rather than inside
    // capabilities for that reason."* ⚑ The positive control is that the list is real.
    expect(CAPABILITY_FIELDS.map((field) => field.column)).toContain('max_depth')
    expect(CAPABILITY_FIELDS.map((field) => field.column)).not.toContain('provider')

    // ⚑ So the only statement in the product that can put a provider on an identity inserts a NEW
    // row — `ensureIdentityRow`, which every creation and every first launch goes through.
    expect([
      ...new Set(inserts.filter((each) => /\bprovider\b/.test(each.sql)).map((each) => each.file)),
    ]).toEqual(['main/db/session-store.ts'])
  })

  it('🔴 THE FINDING · `agent_identity` is EMPTY on a fresh database, so a person CAN name BroBot', () => {
    // ⛔ **Measured, not assumed.** The one migration, `0000_the_tree.sql`, seeds no identity. So a
    // freshly migrated database holds no identities at all.
    expect(db.prepare('SELECT slug FROM agent_identity').all()).toEqual([])

    const made = store.createAgentIdentity(
      {
        slug: DEFAULT_PROFILE_ID,
        displayName: null,
        provider: 'claude',
      },
      { by: 'a-person' },
    )
    expect(made?.slug).toBe(DEFAULT_PROFILE_ID)
    expect(store.providerOf(DEFAULT_PROFILE_ID)).toBe('claude')
    // 🔴 …and THAT is the only state in which `frontDoorProvider`'s first term can fire.
    expect(providerForALaunch(roster([made as AgentIdentity]), DEFAULT_PROFILE_ID, 'codex')).toBe(
      'claude',
    )
  })

  it('⛔ …and on every app where a conversation has run, the same gesture is refused', () => {
    // 🔴 **`null` here is a PERSON picking *Nobody has said*, and 433 is why that is worth saying.**
    // The creation door does NOT resolve `SEEDED_PROVIDERS` — only a launch does — so this column
    // stays empty, which is what `NewAgent.vue` promises the person who picked it.
    store.createAgentIdentity(
      {
        slug: DEFAULT_PROFILE_ID,
        displayName: null,
        provider: null,
      },
      { by: 'a-person' },
    )
    expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()
    // ⚠️ The second create is the one a person makes on an app that has been used. It answers null,
    // and `RuntimeHost.createAgent` turns that into the sentence naming the folded name.
    expect(
      store.createAgentIdentity(
        {
          slug: DEFAULT_PROFILE_ID,
          displayName: null,
          provider: 'codex',
        },
        { by: 'a-person' },
      ),
    ).toBeNull()
    // 🔴 **The column did not move**, which is what makes the refusal a refusal rather than a skip.
    // ⚑ **The second create names a WORD and the first named none**, so the two readings diverge: a
    // create that had written would leave `codex` here.
    expect(providerColumn(DEFAULT_PROFILE_ID)).toBeNull()
  })

  it('⚑ creating `default` mints the SAME row a first launch would — the one default set, nothing chosen', () => {
    // ⛔ **D-014 · no name carries grants of its own.** A person who names BroBot gets exactly what a
    // first launch of any name writes: every capability column NULL, which reads as the one default
    // set with `chosen` saying *nobody has said*.
    const made = store.createAgentIdentity(
      { slug: DEFAULT_PROFILE_ID, displayName: 'BroBot', provider: 'claude' },
      { by: 'a-person' },
    )
    store.create({
      id: 'sess_launch',
      provider: 'claude',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'worker',
    })
    const columns = CAPABILITY_FIELDS.map((field) => field.column)
    const rowOf = (slug: string): unknown =>
      db.prepare(`SELECT ${columns.join(', ')} FROM agent_identity WHERE slug = ?`).get(slug)
    const allNull = Object.fromEntries(columns.map((column) => [column, null]))
    expect(rowOf('worker'), 'the launch row').toEqual(allNull)
    expect(rowOf(DEFAULT_PROFILE_ID), 'the created row').toEqual(allNull)
    expect(made?.capabilities).toEqual(DEFAULT_CAPABILITIES)
    for (const field of CAPABILITY_FIELDS) {
      expect(made?.chosen[field.key], field.key).toBe('default')
    }
    // ⚑ **The control that makes `chosen` a measurement**: a column a person sets reads `chosen`,
    // so a reader that stamped `default` on everything fails here.
    expect(store.setCapabilities(DEFAULT_PROFILE_ID, { canCreateAgents: 'none' })).toBe(true)
    const edited = store.agentIdentities().find((one) => one.slug === DEFAULT_PROFILE_ID)
    expect(edited?.chosen.canCreateAgents).toBe('chosen')
    expect(edited?.capabilities.canCreateAgents).toBe('none')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// §4 · the form asks for what the wire takes, and for nothing else
// ─────────────────────────────────────────────────────────────────────────────────────────────

describe('§4 · the form and the wire agree about what a creation is', () => {
  const form = withoutProse(readFileSync(join(SRC, 'renderer/src/components/NewAgent.vue'), 'utf8'))

  it('⛔ the display-name control carries the SCHEMA’s own number (221 §3), and the name box carries none', () => {
    expect(form).toContain(':maxlength="AGENT_DISPLAY_NAME_CHARS"')
    // ⚠️ **A slug is bounded by its ALPHABET, not by a length** — `wire-bounds.test.ts`'s own
    // ruling, which calls `isPathSegment` the stronger guard. A `maxlength` on the name box would
    // be a second, weaker rule beside it.
    const nameBox = form.slice(
      form.indexOf('data-cy="new-agent-slug"') - 400,
      form.indexOf('data-cy="new-agent-slug"'),
    )
    expect(nameBox).not.toContain('maxlength')
    expect(form).toContain('isPathSegment(folded.value)')
  })

  it('⛔ neither provider is typed into the renderer — the options come from the table', () => {
    // `provider-neutrality.test.ts` owns the tree-wide rule; this is the same rule asked of the one
    // file that has to OFFER both, where the temptation to type them is highest.
    expect(form).not.toMatch(/'(claude|codex)'/)
    expect(form).toContain('Object.keys(PROVIDER_NAME) as Provider[]')
  })
})

/** Unused-import guard for the fixture builder above — kept honest rather than deleted. */
export type { NewAgent }
