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

/** Prose stripped, so a docblock quoting a shape is never mistaken for the shape. */
const withoutProse = (code: string): string =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')

/**
 * ⚑ **Source with its line breaks taken out** (435) — so a census pins a CALL and not a layout.
 *
 * ⛔ **`prettier` decides where a four-argument call wraps**, and it broke `frontDoorProvider`'s
 * across five lines the moment the fourth argument landed. A census that reads the formatted bytes
 * is a census of the formatter — the failure `429 M15` paid for on a mutation anchor.
 */
const flat = (code: string): string =>
  code
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/,\s*\)/g, ')')
    .replace(/\s+\)/g, ')')

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
    canMessage: 'any',
    // ⚑ **D-014** — the ruled word, which is *a conversation you started*.
    canAssignWork: 'any',
    canCreateAgents: 'any',
    // ⚑ **582 · the ruled default, which is the narrowest** — an identity nobody has spoken about
    // may not reach into what another agent is told.
    canWriteRules: 'none',
  },
  chosen: {
    maxDepth: 'default',
    canMessage: 'default',
    canAssignWork: 'default',
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

  it('⛔ the host composes that sentence, and this file is not a second copy of it', () => {
    // ⚠️ 423 §2: *"Render the app's sentence; do not compose a second one."* The bytes above are
    // asserted to be the host's by finding them IN the host, rather than by trusting the fixture.
    const host = withoutProse(readFileSync(join(SRC, 'main/runtime/runtime-host.ts'), 'utf8'))
    expect(host).toContain('There is already an agent called ${foldProfileName(slug)}.')
    // …and the renderer must not have grown its own. `NewAgent.vue` refuses a name for exactly one
    // reason of its own — the alphabet — and leaves collisions to the door.
    const form = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/NewAgent.vue'), 'utf8'),
    )
    expect(form).not.toContain('There is already an agent')
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

  it('⛔ it is `admitGive`’s order with the giver term removed — asserted, not shared', () => {
    // 🔴 **Two doors, one order, and they agree because somebody argued it.** `spawn-rails.ts`'s
    // expression is the anchor of `419 M17` and `419 M18`; folding it into `providerForALaunch`
    // would retire both rows to buy a deduplication neither door asked for. So the agreement is
    // what is checked here.
    //
    // ⚑ **D-016 · `admitSpawn` became `admitGive`, and a give names NO provider** (plan ruling 3),
    // so the asked term is the front door's alone. ⚑ An agent keeps its own provider: the give reads
    // it first, and only where nothing names one its default's, the named model's, then the
    // giver's — `identity ?? giver`, the front door's `identity ?? fallback` one term over.
    const rails = withoutProse(readFileSync(join(SRC, 'main/runtime/spawn-rails.ts'), 'utf8'))
    // 🔴 **499 · the expression MOVED and did not change.** It was written inline in the
    // admitted token as `provider: asked.provider ?? …`; `wider-than-its-parent` has to compare on
    // the child's provider, so it is computed into a `const` above that rail and the token reads it
    // back. ⛔ **Computing it twice is what this row exists to stop**, and one binding is the
    // stronger form of that — so the assertion follows the expression rather than the keyword.
    // 🔴 **682 · `R31a` put a FIRST term on the agent's side, and only there**: a person's choice in
    // force holds an agent-started launch, and a person's own launch never reads it (`R25` §1.4) — so
    // the front door below must NOT gain it. ⚑ Below that term the order is `identity ?? giver`, the
    // identity's term read once into `itsProvider`.
    expect(rails).toContain('if (its.provider !== null) return its.provider')
    expect(rails).toContain('return chosen?.provider ?? theNamedModels ?? giving.provider')
    const store = withoutProse(readFileSync(join(SRC, 'renderer/src/lib/agent-store.ts'), 'utf8'))
    // 🔴 **THREE terms since `435`, and the asked one is first** (HO-025 §4). `417` removed the
    // front door's provider control and HO-025 §5 reversed that half of the ruling, so a person
    // names a provider again — and the ORDER that decides gained the term rather than the surface
    // that asks growing a second spelling of it. ⛔ `435 §4`: *"a second spelling of
    // `asked ?? identity ?? fallback` is the drift this repo keeps paying for."*
    expect(store).toContain('asked ?? runsOnIn(list, slug)?.provider ?? fallback')
  })

  it('🔴 the SENTENCE and the PAYLOAD read one value, so the screen cannot name a provider the launch did not use', () => {
    const screen = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/RuntimeScreen.vue'), 'utf8'),
    )
    // The one binding, from the one resolution.
    expect(screen).toContain(':default-provider="frontDoorProvider"')
    // ⚠️ **Whitespace-flattened, because `prettier` owns the line breaks and not this test** (435):
    // the front-door call gained a fourth argument and formatting broke it across five lines.
    expect(flat(screen)).toContain(
      // 🔴 **The person's answer is the FIRST term** (HO-025 §4) — ahead of BroBot's identity and
      // ahead of the app frame's constant.
      'providerForALaunch(agentStore.identities.value, DEFAULT_PROFILE_ID, DEFAULT_PROVIDER, launchChoices.value.provider)',
    )
    // ⛔ **`DEFAULT_PROVIDER` is read by the two RESOLUTIONS and by nothing else.** This is what
    // "demoted from the answer to the fallback" means as a checkable fact: a third reader would be
    // a place the constant could still BE the answer rather than the last term of an order.
    // ⚑ **And the PLACED door passes no asked term**, which is what makes the widening opt-in at
    // the call site rather than something every caller inherits: `423`'s resolution is unchanged.
    expect(flat(screen)).toContain(
      'providerForALaunch(agentStore.identities.value, profileSlug, DEFAULT_PROVIDER)',
    )
    const reads = [...screen.matchAll(/\bDEFAULT_PROVIDER\b/g)]
    expect(reads.length, 'DEFAULT_PROVIDER is declared once and read by two doors').toBe(3)

    const door = withoutProse(
      readFileSync(join(SRC, 'renderer/src/components/NewConversation.vue'), 'utf8'),
    )
    // …and on the far side of the prop, one name feeds both the words and the wire.
    expect(door).toContain('providerIsFixed(props.defaultProvider)')
    expect(door).toContain('provider: props.defaultProvider,')
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

describe('§3 · the identity’s provider — every writer, measured', () => {
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

  it('⛔ NO statement anywhere can move that column on a row that exists — both kinds, enumerated', () => {
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

  it('⛔ a LAUNCH writes NULL into it, on purpose — so running on Claude never means choosing it', () => {
    // ⚠️ **Asserted at the SOURCE, and the behavioural half is 419's.** `profileRowFor` is a
    // module-local function with no seam this harness can reach, and
    // `creating-an-agent.test.ts:648` already drives a real launch and reads the column back. What
    // this adds is that the null is WRITTEN rather than merely absent — `419 M19` is the mutation
    // that flips it, and the line it anchors on is this one.
    //
    // 🔴 **538 · RE-AIMED, and standing rule 26's three questions are answered here rather than in
    // a commit message.** ⛔ **(1) It read CODE** — `withoutProse` is applied above and the literal
    // is a source expression, not a docblock. ⚑ **(2) The FACT moved**: `538` gave this call site a
    // seeded DISPLAY NAME beside the seeded provider, so a launch no longer passes a bare `null`
    // for the first argument. ⚠️ **(3) What it pins NOW is unchanged in subject**: *this door
    // resolves the app's own seeds and never the CALLER's* — which is why the assertion below is
    // the whole call rather than one line of it, and why the control beneath it is the creation
    // door passing `said.provider` straight through.
    //
    // 🔴 **584 · RE-AIMED AGAIN, one argument over, and the three questions again** (`HO-078` §5).
    // ⛔ **(1) CODE**, for the reason above and unchanged. ⚑ **(2) The FACT moved and did not merely
    // get renamed**: `SEEDED_DISPLAY_NAMES` and `seededDisplayNameFor` are DELETED, not spelled
    // differently — `538` held ONE hand-written name for the ONE other identity this app shipped,
    // `HO-078` §1 retired that identity, and the name is now GENERATED by `nameForANewIdentity`
    // against every slug AND display name already in the roster. ⚠️ **(3) What
    // it pins NOW is still *the launch resolves the app's own answers and never the caller's*** —
    // the subject is untouched — **plus the ruling that made it true of every identity rather than
    // of one**: `HO-078` §5, *the app assigns a human name to every identity it mints; the agent
    // never chooses and never asks*. ⛔ **Still the WHOLE call**, so a caller's value arriving in
    // any of the three slots goes red rather than one of them.
    const store = withoutProse(readFileSync(join(SRC, 'main/db/session-store.ts'), 'utf8'))
    expect(store).toContain(
      // 🔴 **598 · the call grew a FOURTH argument and this anchor moved with it** (`HO-084` §1).
      // ⛔ **Re-aimed rather than loosened**: the claim is *a launch passes the caller's provider
      // as NULL*, and the creator beside it is the same claim about a second fact — a launch says
      // `this-app` rather than naming whoever was in the conversation.
      "writeIdentityRow(\n      profileSlug,\n      at,\n      {\n        displayName: nameForANewIdentity(profileSlug),\n        provider: seededProviderFor(profileSlug),\n      },\n      { by: 'this-app' },\n    )",
    )
    // ⚑ The positive control: the creation door DOES pass one through, so the null above is a
    // decision about launches rather than a store that cannot write the column at all.
    expect(store).toContain('provider: said.provider')
    // ⛔ **And the same control for the column `538` added, re-aimed at `584`'s divergence.** The
    // control was *the creation door hands the CALLER's display name over untouched*, and that is
    // now only half the line: a person who TYPED a name still wins — `??` never reaches past their
    // string — and a caller who said nothing falls through to **the same generator the launch
    // above spends**. ⚠️ **So the whole expression is pinned rather than its first term**: a census
    // that stopped at `blankToNull(said.displayName)` would pass over a door that had lost the
    // fallback entirely, which is the one byte `HO-078` §5 turns on.
    expect(store).toContain(
      'displayName: blankToNull(said.displayName) ?? nameForANewIdentity(slug)',
    )
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

  it('⛔ every field of NewAgent has a control, and the form carries no field the wire has not got', () => {
    // ⚑ **Derived from the interface** rather than listed here, so a fourth field added to `NewAgent`
    // fails this test instead of shipping a control-less fact.
    const wire = withoutProse(readFileSync(join(SRC, 'shared/runtime-ipc.ts'), 'utf8'))
    const declaration = wire.slice(wire.indexOf('export interface NewAgent {'))
    const fields = [
      ...declaration.slice(0, declaration.indexOf('}')).matchAll(/readonly (\w+):/g),
    ].map((each) => each[1] as string)
    expect(fields).toEqual(['slug', 'displayName', 'provider'])
    // The payload the form builds, read out of its own `store.create({ … })` call.
    const call = form.slice(form.indexOf('store.create({'))
    const sent = [...call.slice(0, call.indexOf('})')).matchAll(/^\s{4}(\w+):/gm)].map(
      (each) => each[1] as string,
    )
    expect(sent.sort()).toEqual([...fields].sort())
  })

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
