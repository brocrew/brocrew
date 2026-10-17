import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeProviderSessions, FakeRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { agentCallerId, agentToolsFor } from '../src/main/runtime/agent-tools'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  MOST_BYTES_OF_ANY_FORM,
  RESOURCE_RAILS,
  refuseResource,
  resourcesRoot,
} from '../src/main/resources/resources'
import type { ResourceReading, RuntimeEventMessage } from '../src/shared/runtime-ipc'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsFolder = join(here, '../src/main/db/migrations')
const mainRoot = join(here, '../src/main')

/**
 * # 🔴 517 · one rule, one place, and both doors narrow
 *
 * **HO-043 §1, ruled from `510` F1:**
 *
 * > ⛔ *"After `510`, the person's door is bounded and the agent's is not — so an agent may read
 * > what a person may not, on the same column, through the same function. That is the inverse of
 * > every ruling this project has made about who may do what, and it arrived by accident rather
 * > than by decision."*
 *
 * ⚑ **`510` bounded the person's door and reported the other half.** This file is the half: the
 * placement lives in ONE reader, which `read_document` and the person's window both read through,
 * so `169` §1's *one rule in two places drifts* stops applying to the READERS because there is one
 * place for them.
 *
 * ⚑ **D-016 · documents became RESOURCES, and the rule moved with them.** The one reader is
 * `resourceBytes` (`main/resources/resources.ts`), the agent's door is `RuntimeHost.readResource`
 * and the person's is `readResourceForAPerson`. ⛔ A row is placed from two columns now — its
 * `sha256` and its `name`, at `<resources>/<sha256>/<name>` — and a row out of the tree is no longer
 * a word of its own: `resource-bytes-unreadable` says it, at the agent's door, and `unreadable` at
 * the person's.
 *
 * ⚠️ **521 · and one rule turned out to need a second place, for a different question.** The
 * WRITER's placement is `keepResource`, which cannot be this call: the reader refuses a path that
 * does not resolve, and every path a write is about to create is one of those. ⛔ **Two places is
 * not two rules** — it is one root, asked of a path that must already exist and of a path that must
 * not.
 *
 * ## ⛔ Why every refusal below is paired with an admission in the SAME sample
 *
 * ⚠️ **A refusal suite with no admitted case measures a broken function equally well.** Every
 * section here plants its hazard against a resource that a real reply kept, and reads a second,
 * untouched one through both doors in the same `it`.
 *
 * ## ⚑ And why the hazard is planted in the COLUMN
 *
 * ⛔ `put-the-hazard-on-the-path-the-code-walks`: the bad value goes into `work_resource.name` with
 * a raw `UPDATE`, never into an argument. Neither door takes a path — the id is a primary key — so
 * an argument-shaped plant would measure a door that does not exist.
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

/** ⚠️ Prose quotes code, so a census that reads source has to read the code only. */
const codeOnly = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ')

describe('517 · one rule, one place, and both doors narrow', () => {
  let userData: string
  let work: string
  let outside: string
  let db: AppDatabase
  let store: SessionStore
  let host: RuntimeHost
  let sessions: FakeProviderSessions
  let counter: number
  let clock: number
  let window: RecordingSink
  const tick = (): number => clock++
  const kept = (): string => resourcesRoot(userData)

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-517-'))
    work = mkdtempSync(join(tmpdir(), 'brobot2-517-work-'))
    outside = mkdtempSync(join(tmpdir(), 'brobot2-517-outside-'))
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    clock = Date.UTC(2030, 0, 1)
    store = createSessionStore(db, tick)
    counter = 0
    sessions = new FakeProviderSessions()
    host = new RuntimeHost(deps())
    window = new RecordingSink('webContents:1')
  })

  /**
   * ⛔ **The dependency literal, as a FUNCTION** — `549` needed a second host with one member
   * removed, and a literal written twice is two hosts that drift.
   */
  const deps = (): ConstructorParameters<typeof RuntimeHost>[0] =>
    ({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      resourcesRoot: () => resourcesRoot(userData),
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
    }) satisfies ConstructorParameters<typeof RuntimeHost>[0]

  afterEach(async () => {
    await host.closeAll()
    db.close()
    for (const dir of [userData, work, outside]) rmSync(dir, { recursive: true, force: true })
  })

  const personOpens = async (cwd = work): Promise<string> => {
    const { sessionId } = await host.createSession(
      { provider: 'claude', profileId: 'default', cwd, approvalMode: 'ask' },
      window,
    )
    return sessionId
  }

  /**
   * One resource, kept through the real doors — ⚑ **D-016**: a person's conversation gives a piece
   * with `giveWork`, and the conversation it reaches replies with the file through `replyToParent`.
   * ⛔ Nothing here writes a `work_resource` row by hand: the row, the kept bytes and the id are the
   * ones a reply makes.
   *
   * ⚠️ **549 · the SESSION still comes back with it and no longer has to.** What it is used for now
   * is planting a SECOND conversation beside a resource, which is what §2 needs to show the
   * difference.
   */
  const aResource = async (
    text = 'the whole answer\n',
    name = 'r.md',
  ): Promise<{ resource: string; session: string }> => {
    const giver = await personOpens()
    const given = await host.giveWork(
      {
        definition_of_done: 'The requested result and its checks are recorded.',
        profile: 'default',
        title: 'Write the answer',
        brief: 'write the answer',
      },
      { ownerId: agentCallerId(giver) },
    )
    if (!given.ok) throw new Error(`expected a give, got ${given.refusal.rail}`)
    const folder = store.recordedOne(given.owner)?.cwd
    if (folder === undefined) throw new Error('the conversation the give reached has no folder')
    writeFileSync(join(folder, name), text)
    const replied = await host.replyToParent(
      {
        piece: given.label,
        outcome: 'done',
        summary: 'done it',
        resourcePaths: [name],
        needsUserAction: false,
      },
      { ownerId: agentCallerId(given.owner) },
    )
    if (!replied.ok) throw new Error(`expected a reply, got ${replied.refusal.rail}`)
    const [resource] = replied.resources
    if (resource === undefined) throw new Error('the reply kept no resource')
    return { resource, session: given.owner }
  }

  /**
   * The AGENT's door, as a word: its rail, or `ok`.
   *
   * ⛔ **549 · it took a CALLER until HO-057 and takes none now.** The argument is gone rather than
   * ignored: a parameter no branch reads is a claim that something does.
   */
  const agentReads = (resource: string): string => {
    const seen = host.readResource(resource)
    return seen.ok ? 'ok' : seen.refusal.rail
  }

  /** The PERSON's door, as a word: its reason, or `ok`. */
  const personReads = (resource: string): string => {
    const seen: ResourceReading = host.readResourceForAPerson(resource)
    return seen.ok ? 'ok' : seen.reason
  }

  /** Where a kept resource's bytes actually are — `<root>/<sha256>/<name>`, off its own row. */
  const keptFile = (resource: string): string => {
    const row = store.resource(resource)
    if (row === null) throw new Error(`no row for ${resource}`)
    return join(kept(), row.sha256, row.name)
  }

  /** Point a kept resource's row at `target`, exactly as a bad writer would. */
  const pointRowAt = (resource: string, target: string): string => {
    const row = store.resource(resource)
    if (row === null) throw new Error(`no row for ${resource}`)
    const spelling = relative(join(kept(), row.sha256), target)
    db.prepare('UPDATE work_resource SET name = ? WHERE id = ?').run(spelling, resource)
    return spelling
  }

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §1 · the plant — one row out of the tree, both doors, one sample
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§1 · a row that spells its way out of the tree', () => {
    it('🔴 BOTH doors refuse it, and a legitimate resource goes through both in the same sample', async () => {
      const escaping = await aResource('the real one\n')
      const fine = await aResource('the untouched one\n', 'second.md')
      const stranger = join(outside, 'secrets.md')
      writeFileSync(stranger, 'not a resource at all\n')
      const spelled = pointRowAt(escaping.resource, stranger)

      // ⚑ **The premise, asserted** — the row really says what this test thinks it says, and the
      // file it points at really exists, so a refusal is about the boundary and not about absence.
      expect(spelled).toContain('..')
      expect(readFileSync(stranger, 'utf8')).toBe('not a resource at all\n')

      // ⛔ **The agent's door, which `510` could not touch and HO-043 §1 ruled onto.** ⚑ D-016 · a
      // row out of the tree is `resource-bytes-unreadable`: somebody has to look at what it names.
      expect(agentReads(escaping.resource)).toBe('resource-bytes-unreadable')
      // ⛔ **The person's door** — its four words fold this into `unreadable`.
      expect(personReads(escaping.resource)).toBe('unreadable')

      // 🔴 **The control, in the same sample.** Same doors, same disk, same tree; the only
      // difference is a `name` that stays inside it.
      expect(agentReads(fine.resource)).toBe('ok')
      expect(personReads(fine.resource)).toBe('ok')

      // ⛔ **And the bytes never left the process, at either door.** A refusal that still read the
      // file would be a door that refuses its answer rather than its question.
      expect(JSON.stringify(host.readResource(escaping.resource))).not.toContain(
        'not a resource at all',
      )
      expect(JSON.stringify(host.readResourceForAPerson(escaping.resource))).not.toContain(
        'not a resource at all',
      )
    })

    it('⚠️ …and a SYMLINK at the kept name is refused by the same rail, at both doors', async () => {
      // ⛔ **This is the arm `O_NOFOLLOW` cannot answer.** `readOwnFile` guards the FINAL component
      // only; what catches a name inside the tree pointing out of it is the real-path arm of
      // `resourceBytes`, measured before the open. A guard that normalised and then trusted the walk
      // would pass here.
      const linked = await aResource('the real one\n')
      const fine = await aResource('the untouched one\n', 'second.md')
      const stranger = join(outside, 'secrets.md')
      writeFileSync(stranger, 'not a resource at all\n')
      const at = keptFile(linked.resource)
      rmSync(at)
      symlinkSync(stranger, at)

      // ⚑ **The premise**: the column is still perfectly ordinary — there is no `..` to catch
      // lexically, which is what makes this the real arm's row and not the lexical arm's.
      expect(store.resource(linked.resource)?.name).not.toContain('..')

      expect(agentReads(linked.resource)).toBe('resource-bytes-unreadable')
      expect(personReads(linked.resource)).toBe('unreadable')
      expect(agentReads(fine.resource)).toBe('ok')
      expect(personReads(fine.resource)).toBe('ok')
    })

    it('⛔ the refusal a MODEL receives carries the rail, the permanence and no path', async () => {
      const escaping = await aResource('the real one\n')
      const stranger = join(outside, 'secrets.md')
      writeFileSync(stranger, 'not a resource at all\n')
      const spelled = pointRowAt(escaping.resource, stranger)

      const set = agentToolsFor(host, escaping.session)
      const tool = set.tools.find((one) => one.name === 'read_document')
      if (tool === undefined) throw new Error('no read_document tool')
      const answered = (await tool.call({ resource: escaping.resource })).structured as Record<
        string,
        unknown
      >

      // ⚑ **Through the published tool, not only through the host** — `read_document` spreads the
      // refusal unchanged, so the rail this door produces reaches a model.
      expect(answered.outcome).toBe('refused')
      expect(answered.rail).toBe('resource-bytes-unreadable')
      expect(answered.permanence).toBe('until-a-person-changes-it')
      expect(answered.retryable).toBe(false)
      expect(answered.remedy).toBe(null)
      expect(answered.detail).toEqual({ resource: escaping.resource })

      // 🔴 **`380`'s rule, asserted at the door that gained a refusal**: a resource is reached by
      // its id and never by the tree's spelling, so a refusal ABOUT it does not quote one.
      const whole = JSON.stringify(answered)
      expect(whole).not.toContain(spelled)
      expect(whole).not.toContain(outside)
      expect(whole).not.toContain(userData)
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §2 · 549 · the fold is GONE, and the containment word is said to everybody
  // ───────────────────────────────────────────────────────────────────────────────────────────

  /**
   * 🔴 **RE-AIMED at `549`, not stripped** (standing rule 26: *strip AND re-aim*).
   *
   * ⛔ **What this section asserted from `517` to `549`** was the ORDERING that protected a fold:
   * *"a stranger gets the no-such word for the tampered row, not the containment word"*, because
   * the bytes were reached only after an entitlement admitted the caller. ⚠️ **HO-057 withdrew that
   * predicate**, so there is no stranger left to protect the ordering from — and a test that kept the
   * old assertion would have been measuring a door that refuses everybody.
   *
   * ⚑ **The new subject is the same two facts read the other way round**: the word a row's own
   * spelling earns is said to ANY caller, and *there is no such resource* is said only about a
   * resource that is not there. ⛔ **Those two answers used to be byte-identical and this section is
   * where that stopped being true.**
   */
  describe('§2 · 549 · two callers, one row, and the answers no longer hide each other', () => {
    it('🔴 a conversation that kept nothing gets the containment word, and an absent id does not', async () => {
      const escaping = await aResource('the real one\n')
      // ⚑ **A SECOND conversation, which is the whole control** — it kept nothing, it gave nothing
      // and nothing gave it anything, so under the rule this file shipped with it was refused both
      // of the reads below.
      const stranger = await personOpens()
      expect(stranger).not.toBe(escaping.session)
      const target = join(outside, 'secrets.md')
      writeFileSync(target, 'not a resource at all\n')
      pointRowAt(escaping.resource, target)

      // 🔴 **The row that exists earns the word its own column earned.**
      const foreign = host.readResource(escaping.resource)
      // ⛔ **And an id nothing kept gets the OTHER word** — `549` unpicked the fold, so these two are
      // no longer the same refusal.
      const absent = host.readResource('res_nothing-kept-this')
      if (foreign.ok || absent.ok) throw new Error('expected two refusals')
      expect(foreign.refusal.rail).toBe('resource-bytes-unreadable')
      expect(absent.refusal.rail).toBe('no-such-resource')
      expect(foreign.refusal.reason).not.toBe(absent.refusal.reason)

      // ⚠️ **And the sentence stops promising what HO-057 withdrew.** The rail said *"A document
      // registered by you, or by an agent you spawned, is one you may read"* until `549`.
      expect(absent.refusal.reason).not.toContain('you may read')
      expect(absent.refusal.reason).not.toContain('spawned')

      // 🔴 **The control that plants TWO** — the conversation that kept it meets the same word for
      // the same row, or this test would pass over a door that refuses nobody anything useful.
      expect(agentReads(escaping.resource)).toBe('resource-bytes-unreadable')
      // ⛔ **Still no path on the wire** (380), whoever is asking.
      expect(JSON.stringify(foreign.refusal)).not.toContain(outside)
    })

    it('⚑ a host this app gave no resources tree is its OWN word, and not `no-such-resource`', async () => {
      const real = await aResource('bytes that exist\n')
      // ⛔ **The same host with the resources root taken away.** ⚑ HO-057 §3.2: *with nothing
      // unentitled, knowing a resource exists costs nothing.*
      const rootless = new RuntimeHost({ ...deps(), resourcesRoot: undefined })
      const answered = rootless.readResource(real.resource)
      if (answered.ok) throw new Error('expected a refusal with no resources root')
      expect(answered.refusal.rail).toBe('resource-store-unavailable')
      // 🔴 **The control**: the host that HAS a root answers the bytes for the same id.
      expect(agentReads(real.resource)).toBe('ok')
      await rootless.closeAll()
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §3 · the split — *gone* stops being said about a file that is sitting there
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§3 · absent, and present-but-unreadable, are two answers', () => {
    it('🔴 a file that is GONE is `resource-bytes-missing`, and its sentence is true of it', async () => {
      const gone = await aResource('vanishing\n')
      const fine = await aResource('the untouched one\n', 'second.md')
      rmSync(keptFile(gone.resource))

      expect(agentReads(gone.resource)).toBe('resource-bytes-missing')
      expect(agentReads(fine.resource)).toBe('ok')
      // ⚑ **The person's door folds it to `unreadable` and that has not moved** (510).
      expect(personReads(gone.resource)).toBe('unreadable')
      expect(personReads(fine.resource)).toBe('ok')
    })

    it('⛔ a file that is TOO LARGE is not told it is gone — the defect HO-043 §1.5 named', async () => {
      // ⚠️ **The PO's own case**: *"the file is gone about a file that is sitting there sends a
      // person looking for something that is not lost."* ⛔ Before 517 this answered the missing
      // word, whose words are *its file is no longer where this app keeps it* — said about a file
      // with the app's own name on it.
      const fat = await aResource('small enough\n')
      const fine = await aResource('the untouched one\n', 'second.md')
      writeFileSync(keptFile(fat.resource), Buffer.alloc(MOST_BYTES_OF_ANY_FORM + 1, 'x'))

      expect(agentReads(fat.resource)).toBe('resource-bytes-unreadable')
      const seen = host.readResource(fat.resource)
      if (seen.ok) throw new Error('expected a refusal')
      // 🔴 **Standing rule 5: the load-bearing clause, BY NAME.** The word is only worth adding if
      // the sentence beside it stops making the claim that was false.
      expect(seen.refusal.reason).toContain('what stands where this app keeps it')
      expect(seen.refusal.reason).not.toContain('no longer where this app keeps it')
      expect(seen.refusal.permanence).toBe('until-a-person-changes-it')
      expect(seen.refusal.retryable).toBe(false)
      expect(agentReads(fine.resource)).toBe('ok')
      // ⚑ **And the person's window still folds the two**, deliberately — its words are 510's.
      expect(personReads(fat.resource)).toBe('unreadable')
    })

    it('⚠️ a DIRECTORY and an inside-pointing symlink take the same word, and that is the grouping', async () => {
      // ⛔ **The causes share one word because a caller acts on all of them identically**: stop,
      // and have somebody look at the name. ⚑ Telling a model *it is a FIFO* is a description of
      // this app's own disk, which is the disclosure `no-such-resource` folds to avoid.
      const shaped = await aResource('replaced by a directory\n')
      const linked = await aResource('replaced by a link\n', 'second.md')
      const fine = await aResource('the untouched one\n', 'third.md')

      const at = keptFile(shaped.resource)
      rmSync(at)
      mkdirSync(at)
      expect(agentReads(shaped.resource)).toBe('resource-bytes-unreadable')

      // ⚑ **A symlink that stays INSIDE the tree passes the real arm and dies on `O_NOFOLLOW`** —
      // which is the pair that proves the two guards answer different questions.
      const inside = keptFile(linked.resource)
      const neighbour = join(kept(), 'neighbour.md')
      writeFileSync(neighbour, 'a file inside the tree\n')
      rmSync(inside)
      symlinkSync(neighbour, inside)
      expect(agentReads(linked.resource)).toBe('resource-bytes-unreadable')

      expect(agentReads(fine.resource)).toBe('ok')
      expect(personReads(fine.resource)).toBe('ok')
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §4 · the vocabulary the words joined
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§4 · the words, priced against the table that owns them', () => {
    it('🔴 both are members, both are silent, and neither promises a retry', () => {
      for (const rail of ['resource-bytes-missing', 'resource-bytes-unreadable'] as const) {
        expect(RESOURCE_RAILS, rail).toContain(rail)
        const built = refuseResource(rail, { resource: 'res_1' })
        expect(built.remedy, rail).toBe(null)
        expect(built.retryable, rail).toBe(false)
        expect(built.permanence, rail).not.toBe('while-this-holds')
      }
      // ⛔ **They are priced DIFFERENTLY, and a pair that agreed would mean one of them is
      // unargued.** A file that is gone is nobody's to repair through this app; a name with
      // something standing on it — or a row that names a place outside the tree — is a person's.
      expect(refuseResource('resource-bytes-missing').permanence).toBe('permanent')
      expect(refuseResource('resource-bytes-unreadable').permanence).toBe(
        'until-a-person-changes-it',
      )
      // ⚑ **The control**: the same reader sees a rail that IS retryable, so *neither is* is a
      // fact about these two rather than about `refuseResource`.
      expect(refuseResource('resource-empty').retryable).toBe(true)
    })

    it('⛔ neither reuses an offered-path rail, whose sentence is false at this door', () => {
      // 🔴 **The choice §2 of the brief forced, asserted rather than described.** An offered-path
      // rail says *nothing was kept and nothing was recorded* about a path a conversation offered
      // (D-016: at any of the three doors that keep a file) — and at `read_document` that is false:
      // no path was named, no conversation offered anything, and the resource IS kept. ⚠️ Reusing
      // one would also hand a model its remedy, *write a file and offer that path instead*, at a
      // door that takes no path.
      const offered = refuseResource('resource-unreadable')
      const recorded = refuseResource('resource-bytes-unreadable')
      expect(offered.reason).toContain('nothing was kept and nothing was recorded')
      expect(recorded.reason).not.toContain('nothing was kept and nothing was recorded')
      expect(offered.reason).toContain('Write a file and offer that path instead')
      expect(recorded.reason).not.toContain('offer that path')
      expect(offered.reason).not.toBe(recorded.reason)
      // ⚑ And the unreadable word carries `424`'s second clause for the same reason — the whole
      // sentence, object and all, because *looked at it* became *looked at what stands where this
      // app keeps it* when the bytes stopped being a document's.
      expect(recorded.reason).toContain(
        'Asking again will not help until a person has looked at what stands where this app keeps it.',
      )
    })
  })

  // ───────────────────────────────────────────────────────────────────────────────────────────
  // §5 · one rule, one place — asserted rather than described
  // ───────────────────────────────────────────────────────────────────────────────────────────

  describe('§5 · the placement exists once, and the doors reach it', () => {
    const sourceOf = (relPath: string): string =>
      codeOnly(readFileSync(join(mainRoot, relPath), 'utf8'))

    it('🔴 `resourceBytes` places, and the host does not', () => {
      const resources = sourceOf('resources/resources.ts')
      const hostSource = sourceOf('runtime/runtime-host.ts')
      // ⛔ **The one rule, at the one place** — its lexical arm and its real-path arm, once each.
      expect(resources.split('within(lexicalRoot, lexicalPath)')).toHaveLength(2)
      expect(resources.split('within(filesystemSpelling(lexicalRoot), realPath)')).toHaveLength(2)
      // ⚑ **The writer resolves the file it is offered and never places it** (`726` · R92: the
      // conversation's folder is only a base for a relative path). ⚠️ **521 · its own placement is
      // `keepResource`**, a different function, because the reader refuses a path that does not
      // resolve — and each is called once, in the one writer.
      expect(hostSource.split('resolveResource(folder, path)')).toHaveLength(2)
      expect(hostSource.split('keepResource(root, file)')).toHaveLength(2)
      // 🔴 **And zero in the host.** `169` §1 is that one rule in two places drifts; the copy that
      // drifts is the one further from the thing it is about.
      expect(hostSource).not.toContain('within(')
      expect(hostSource).not.toContain('realpathSync')
      // ⚠️ **Non-vacuity — the sweep CAN find things in that file.** Both doors read through the
      // one reader: the agent's and the person's — ⚑ and, since F046, the pass that titles the files
      // kept before titles were taken, and since W4.98 its second half, which titles again the files
      // an older reader titled (by their name, or by a heading before front matter was read).
      expect(hostSource.split('resourceBytes(root, row)')).toHaveLength(5)
    })

    it('⛔ which files may SPELL each word, pinned — another one is a rule spelled twice', () => {
      const spelling = (needle: string): string[] => {
        const found: string[] = []
        const walk = (dir: string): void => {
          for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
            a.name < b.name ? -1 : 1,
          )) {
            const full = join(dir, entry.name)
            if (entry.isDirectory()) walk(full)
            else if (entry.name.endsWith('.ts')) {
              if (codeOnly(readFileSync(full, 'utf8')).includes(needle)) {
                found.push(relative(mainRoot, full).replaceAll('\\', '/'))
              }
            }
          }
        }
        walk(mainRoot)
        return found.sort()
      }

      // ⛔ **`resource-bytes-unreadable` and `resource-bytes-missing` are spelled where they are
      // DEFINED and RAISED — one module — and nowhere else.** The person's window never names them:
      // it folds every rail but `changed` to one word, which is the fold `510` ruled.
      expect(spelling("'resource-bytes-unreadable'")).toEqual(['resources/resources.ts'])
      expect(spelling("'resource-bytes-missing'")).toEqual(['resources/resources.ts'])
      // ⚑ **The changed word is spelled in TWO, and the second has a named job**: the person's door
      // reads it to answer `changed`. ⛔ A third file spelling it is a second reader of one rule,
      // which is what `169` §1 is about — so it goes red here.
      expect(spelling("'resource-bytes-changed'")).toEqual([
        'resources/resources.ts',
        'runtime/runtime-host.ts',
      ])
      // ⚠️ **And exactly once in the host** — a second occurrence is a second decision, however it
      // is spelled.
      const hostSource = sourceOf('runtime/runtime-host.ts')
      expect(hostSource.split("'resource-bytes-changed'")).toHaveLength(2)

      // 🔴 **The control that plants TWO** (standing rule 12). ⛔ A needle assembled at run time
      // so the sweep cannot find it in this file's own source, and a broad one that must come back
      // with far more than the pins — a census that can only ever answer small is not a census.
      // ⚠️ The broad needle is a SPECIFIC spelling — the refusal type every rail word is built
      // into, spelled in code by the module that defines it, the host, the tools and the reply's
      // rails — never the bare word `resource`, which a census would find almost anywhere.
      expect(spelling(`'resource-${String.fromCodePoint(0x1f41f)}-unreadable'`)).toEqual([])
      const broad = spelling('ResourceRefusal')
      expect(broad.length).toBeGreaterThan(2)
      expect(broad).toContain('runtime/runtime-host.ts')
    })
  })
})
