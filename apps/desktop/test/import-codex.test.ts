import { mkdtempSync, readFileSync, rmSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { FakeRuntime } from '@brobot2/runtime'
import { importCodexRollout } from '../src/main/archive/import-codex'
import { splitCodexMessage } from '../src/main/archive/codex-injected'
import { NORMALIZER_VERSION } from '../src/main/archive/normalizer'

/**
 * Codex import (Slice 2 · 043) — the asymmetry that blocked this since 088.
 *
 * 088 deferred it with *"importing it would mean a second normalizer written against a format
 * nothing else here reads"*. 036 wrote that normalizer. This is the proof it closes.
 *
 * The synthetic fixture matches shapes verified against 1,811 real rollouts. Personal
 * rollouts contain sensitive content and must never be committed.
 */

const here = dirname(fileURLToPath(import.meta.url))
const ROLLOUT = join(here, 'fixtures/codex-rollout.jsonl')
const migrations = join(here, '../src/main/db/migrations')

describe('importing a Codex rollout', () => {
  let dir: string
  let db: AppDatabase
  let store: SessionStore
  let lines: string[]

  const SESSION = 'sess_codex_import'

  const host = (): RuntimeHost =>
    new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(dir, 'exports'),
      createRuntime: (provider) => new FakeRuntime(provider),
      prepareProviderHome: (provider) => join(dir, 'homes', provider),
      providerHomePath: (provider) => join(dir, 'homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(dir, sessionId),
      newSessionId: () => SESSION,
      readProviderConfig: (_p, home) => ({
        home,
        homeEnv: 'CODEX_HOME',
        model: 'programmatic',
        authNote: null,
        files: [],
      }),
    })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'brobot2-codex-import-'))
    db = openDatabase(join(dir, 'db.sqlite'))
    applyMigrations(db, migrations)
    store = createSessionStore(db)
    lines = readFileSync(ROLLOUT, 'utf8').split('\n').filter(Boolean)
    store.create({
      id: SESSION,
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  /**
   * The private import path, reached the way `adoptSessions` reaches it — including the
   * cancellation predicate it is now required to carry (073, 068 finding 6). "Carry on" is what the
   * coordinator answers while the gate is open, which is the state this pass runs in.
   */
  const importTranscript = (id: string, path: string): Promise<unknown> =>
    (
      host() as unknown as {
        importTranscript(
          id: string,
          p: 'codex',
          path: string,
          cancelled: () => boolean,
        ): Promise<unknown>
      }
    ).importTranscript(id, 'codex', path, () => false)
  const runImport = (): Promise<unknown> => importTranscript(SESSION, ROLLOUT)

  it('produces a ledger of the same shape a live Codex session produces', async () => {
    expect(await runImport()).toBe('imported')
    const types = store.events(SESSION).map((e) => e.event.type)
    // Exactly the neutral vocabulary the live path emits — no Codex-specific variant anywhere.
    expect(types).toEqual([
      'user_turn',
      'thinking',
      'tool_call',
      'tool_result',
      'assistant_message',
    ])
  })

  it('keeps the PROVIDER’s times, not the moment we imported', async () => {
    await runImport()
    const first = store.events(SESSION)[0]
    expect(first?.at).toBe(Date.parse('2026-04-22T15:48:57.000Z'))
    // Non-vacuous: the import is happening now, so a wrong implementation would say ~today.
    expect(first!.at).toBeLessThan(Date.now())
  })

  it('is idempotent — importing twice does not double the conversation', async () => {
    expect(await runImport()).toBe('imported')
    const after = store.events(SESSION).length
    expect(await runImport()).toBe('skipped')
    expect(store.events(SESSION)).toHaveLength(after)
  })

  it('does not leave the imported session claiming to be running (045)', async () => {
    // A rollout records what was SAID, not our turn brackets — so every turn it opens would stay
    // open and hold a long-dead session at `working` forever.
    await runImport()
    const turns = store.turns(SESSION)
    expect(turns.length).toBeGreaterThan(0)
    expect(turns.every((t) => t.closedAt !== null)).toBe(true)
    expect(turns.at(-1)?.endReason, 'we never watched it end').toBe('unknown')
    // Read the column directly: `find()` returns null for a session with no provider ref, and an
    // imported one has never run.
    const row = db.prepare('SELECT status FROM provider_session WHERE id = ?').get(SESSION) as {
      status: string
    }
    expect(row.status).toBe('idle')
  })

  /**
   * 🔴 **On the ADOPTION path, not on the parser** (214 §2, acceptance 4).
   *
   * `213` reached this through *"Check homes"* — `adoptSessions` → `importTranscript` →
   * `importCodexRollout` → the ledger the transcript renders from. ⛔ **The parser's own tests are
   * one layer short of the finding**: they prove what the reader returns, not what the DATABASE
   * ends up holding, and the ledger is what a person opens. So this drives the private import the
   * coordinator drives, and reads the answer back out of the store.
   */
  it('🔴 the ADOPTED ledger holds no user turn for injected context (214 §2)', async () => {
    const ADOPTED = 'sess_codex_injected'
    const line = (role: string, text: string): string =>
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-08-25T09:00:00.000Z',
        payload: { type: 'message', role, content: [{ type: 'input_text', text }] },
      })
    store.create({
      id: ADOPTED,
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    const rollout = join(dir, 'adopted.jsonl')
    const planted = [
      lines[0]!,
      line('developer', '<skills_instructions>\n## Skills\nA skill is a set of instructions…'),
      line(
        'user',
        '<recommended_plugins>\n- Airtable\n</recommended_plugins>\n' +
          '<environment_context>\n  <current_date>2026-08-25</current_date>\n</environment_context>',
      ),
      line(
        'user',
        '<in-app-browser-context source="ambient-ui-state">\nnot part of the request\n' +
          '</in-app-browser-context>\n\n## My request for Codex:\nread the README',
      ),
      line('user', 'and then commit it'),
    ]
    writeFileSync(rollout, `${planted.join('\n')}\n`)

    await importTranscript(ADOPTED, rollout)

    const spoken = store
      .events(ADOPTED)
      .map((entry) => entry.event)
      .filter((event): event is { type: 'user_turn'; text: string } => event.type === 'user_turn')

    // ⛔ **Two turns, and they are the two things a person typed.** Before 214 this was five, and
    // the one-line prompt was the last of them.
    expect(spoken.map((event) => event.text)).toEqual(['read the README', 'and then commit it'])
    // Keep harness words in the ledger as chatter so injected text stays visible and
    // identifiable as injection.
    const chatter = store
      .events(ADOPTED)
      .map((entry) => entry.event)
      .filter((event) => event.type === 'unknown' && event.category === 'echo')
    expect(chatter.length).toBe(3)
  })

  it('⛔ …so a ledger derived by the PREVIOUS importer reads stale, which is what offers a Rebuild', () => {
    // ⚑ **Through the real store**, because the value the Library's `canRebuild` reads is what
    // matters — not a private helper's return. Without the bump this row reads `current` and no
    // Rebuild is offered for a conversation that needs one.
    const before = 'sess_old_normalizer'
    store.create({
      id: before,
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    const oldGen = store.beginGeneration(before)
    // ⚠️ A generation with nothing in it is not a stale projection, it is no projection — see
    // `derivedStateOf`'s own note. One entry is what makes this the axis under test.
    store.appendGeneration(before, oldGen, [
      { ordinal: 0, event: { type: 'user_turn', text: 'hi' }, at: 1 },
    ])
    store.promoteGeneration(before, oldGen, {
      normalizerVersion: NORMALIZER_VERSION - 1,
      derivedThrough: lines.length,
    })

    expect(store.recordedOne(before)?.derived).toBe('stale')

    // ⚑ The paired positive: a ledger derived by THIS importer is current, so the bump does not
    // simply mark the whole corpus stale forever.
    const now = 'sess_this_normalizer'
    store.create({
      id: now,
      provider: 'codex',
      cwd: dir,
      approvalMode: 'ask',
      profileId: 'default',
    })
    const newGen = store.beginGeneration(now)
    store.appendGeneration(now, newGen, [
      { ordinal: 0, event: { type: 'user_turn', text: 'hi' }, at: 1 },
    ])
    store.promoteGeneration(now, newGen, {
      normalizerVersion: NORMALIZER_VERSION,
      derivedThrough: lines.length,
    })

    expect(store.recordedOne(now)?.derived).toBe('current')
  })
})

/**
 * # Adoption must not attribute harness text to the person
 *
 * `213` adopted a **one-line** provider-only Codex session with *"Check homes"* and opened it.
 * Ahead of the one line, BroBot drew `<skills_instructions>`, `<permissions instructions>`,
 * app/plugin material, `<recommended_plugins>` and `<environment_context>` as
 * ⛔ **`"You (per the transcript)"` messages**. Its words: *"the provenance qualifier is useful, but
 * 'You' still falsely identifies the speaker and buries the human prompt."*
 *
 * ## ⚠️ Every fixture below is a real shape, measured
 *
 * 120 rollouts under `~/.codex/sessions`, 7,305 `message` lines: **822** `role:'developer'`,
 * **484** `role:'user'` ending `</environment_context>`, **220** `role:'user'` carrying Codex's own
 * `## My request for Codex:` separator, **0** overlap between the last two, and **2,084** plain
 * human prompts. The strings here are trimmed copies of those lines, not invented ones.
 *
 * ⚑ **Run through the shipped classifier over that same corpus**: 822 + 704 stop being `You`, and
 * every one of the 220 splits keeps the person's request — *"OK cool. commit."*, *"there is
 * windows 98 setup now. should I click continue or something?"*.
 */
describe('214 §2 · injected provider context is not the user speaking', () => {
  const AT = Date.parse('2026-08-25T09:00:00.000Z')

  const line = (role: string, text: string): string =>
    JSON.stringify({
      type: 'response_item',
      timestamp: '2026-08-25T09:00:00.000Z',
      payload: { type: 'message', role, content: [{ type: 'input_text', text }] },
    })

  const eventsOf = (...frames: string[]): { type: string; text?: string; category?: string }[] =>
    importCodexRollout(frames, AT).entries.map(
      (entry) => entry.event as { type: string; text?: string; category?: string },
    )

  it('🔴 a `developer` line is chatter, not a user bubble — 822 of them in the corpus', () => {
    const events = eventsOf(
      line('developer', '<skills_instructions>\n## Skills\nA skill is a set of instructions…'),
      line('developer', '<permissions instructions>\nFilesystem sandboxing defines which files…'),
    )

    // ⛔ The whole point: nothing here speaks in the user's name.
    expect(events.every((event) => event.type !== 'user_turn')).toBe(true)
    // ⚑ And it is KEPT, in the category `import-claude.ts` has used since 074 — out of both
    // transcript modes, whole in the Events tab. Dropping it would be the other kind of dishonesty.
    expect(events.map((event) => event.type)).toEqual(['unknown', 'unknown'])
    expect(events.every((event) => event.category === 'echo')).toBe(true)
  })

  it('🔴 a `user` preamble the CLI closed with <environment_context> is chatter — 484 of them', () => {
    const events = eventsOf(
      line(
        'user',
        '<recommended_plugins>\nHere is a list of plugins that are available but not installed.\n' +
          '- Airtable (airtable@openai-curated-remote)\n</recommended_plugins>\n' +
          '<environment_context>\n  <current_date>2026-08-25</current_date>\n</environment_context>',
      ),
      line(
        'user',
        '# AGENTS.md instructions\n\n<INSTRUCTIONS>\nPlease prioritize the use the MCP tools…\n' +
          '</INSTRUCTIONS>\n<environment_context>\n  <timezone>Etc/UTC</timezone>\n' +
          '</environment_context>',
      ),
    )

    expect(events.every((event) => event.type !== 'user_turn')).toBe(true)
    expect(events.every((event) => event.category === 'echo')).toBe(true)
  })

  it('🔴 the human’s request is shown ONCE, split out from the block above it — 220 of them', () => {
    // ⛔ 213: *"it buries the human's actual prompt underneath it"*. This is that message: the
    // ambient block declares itself *"not part of the user's request"*, and Codex's own separator is
    // where the person starts speaking.
    const events = eventsOf(
      line(
        'user',
        '\n<in-app-browser-context source="ambient-ui-state">\n' +
          "This block is automatically supplied ambient UI state, not part of the user's request.\n" +
          '# In app browser:\n- The user has the in-app browser open with 2 tabs.\n' +
          '</in-app-browser-context>\n\n## My request for Codex:\nOK cool. commit.',
      ),
    )

    expect(events.map((event) => event.type)).toEqual(['unknown', 'user_turn'])
    // ⛔ The bubble holds the person's words and NOTHING above them.
    expect(events[1]?.text).toBe('OK cool. commit.')
    expect(events[1]?.text).not.toContain('ambient-ui-state')
    expect(events[1]?.text).not.toContain('in-app browser')
  })

  it('🔴 a message that IS one wrapped element is the harness — 292 in the corpus, up to 22 KB', () => {
    // ⛔ **These fell through the first version of this module**, which was built from a 120-rollout
    // sample. Over the whole corpus — 2,345 rollouts — 542 harness messages did, and an adversarial
    // review reproduced 213's exact sentence with one of them: a 22,018-character `<skill>` block
    // rendered as "You" ahead of a 99-character prompt.
    const events = eventsOf(
      line(
        'user',
        '<turn_aborted>\nThe user interrupted the previous turn on purpose.\n</turn_aborted>',
      ),
      line('user', '<skill>\n<name>skill-creator</name>\n<path>/x/SKILL.md</path>\n</skill>'),
      line(
        'user',
        '<heartbeat><automation_id>a</automation_id><instructions>go</instructions></heartbeat>',
      ),
      line('user', '<subagent_notification>{"agent_path":"x"}</subagent_notification>'),
    )

    expect(events.every((event) => event.type !== 'user_turn')).toBe(true)
    expect(events.every((event) => event.category === 'echo')).toBe(true)
    expect(events).toHaveLength(4)
  })

  it('🔴 …but an `<image>` a PERSON attached is still theirs — the one exemption', () => {
    // ⛔ **The failure this exemption prevents is worse than the one the rule fixes**: it would not
    // misattribute the message, it would DELETE it. Two such messages are wholly wrapped in the
    // corpus, and more carry the person's own words after the tag.
    const events = eventsOf(
      line('user', '<image name=[Image #1]></image>'),
      line('user', '<image name=[Image #1]></image>I ran the command, it took very long'),
    )

    expect(events.map((event) => event.type)).toEqual(['user_turn', 'user_turn'])
    expect(events[1]?.text).toContain('I ran the command')
  })

  it('🔴 the AGENTS.md preamble with no environment block behind it is still the harness', () => {
    // 107 of them — about 8% of that preamble's occurrences arrive without the tail rule 3 reads.
    const events = eventsOf(
      line(
        'user',
        '# AGENTS.md instructions for /Users/x\n\n<INSTRUCTIONS>\nPrefer MCP tools.\n</INSTRUCTIONS>',
      ),
    )
    expect(events.map((event) => event.type)).toEqual(['unknown'])

    // ⚑ The paired negative, and it is a REAL message from the corpus: a person's own heading that
    // happens to start with `#` is not this, and anchoring on the exact preamble is what keeps it.
    const mine = eventsOf(
      line('user', '# Client startup failure — analysis & status\n\nwhat do you think?'),
    )
    expect(mine.map((event) => event.type)).toEqual(['user_turn'])
  })

  it('⚠️ a message that is ONLY the separator and the prompt keeps no second copy of it', () => {
    // ⛔ `injected` reports what is ABOVE the marker, not that the marker was there. Reporting one
    // put a second full copy of the person's words in the Events tab labelled "injected context".
    const events = eventsOf(line('user', '## My request for Codex:\nrun the tests'))

    expect(events.map((event) => event.type)).toEqual(['user_turn'])
    expect(events[0]?.text).toBe('run the tests')
  })

  it('⚑ THE PAIRED POSITIVE — what the person actually typed is still theirs', () => {
    // 2,084 of the corpus's 2,788 `role:'user'` lines are this, and a fix that quietened them would
    // have replaced a misattribution with a disappearance. Two of the three rules could each do it
    // on their own, so each is given a prompt it must leave alone.
    const events = eventsOf(
      line('user', 'M4/031'),
      line('user', 'http://localhost:8099/ is already open in a Chrome tab, us it.'),
      // ⚠️ Opens with a heading and mentions the environment — neither is a rule, and a marker test
      // that anchored on either would swallow this.
      line('user', '# Files\n\nplease read the environment_context docs and summarise them'),
    )

    expect(events.map((event) => event.type)).toEqual(['user_turn', 'user_turn', 'user_turn'])
    expect(events[0]?.text).toBe('M4/031')
    expect(events[1]?.text).toBe('http://localhost:8099/ is already open in a Chrome tab, us it.')
    expect(events[2]?.text).toContain('please read the environment_context docs')
  })

  it('⚠️ …and the mark that says a FILE claimed it survives on the turns that are the user’s', () => {
    // 074's disclosure is orthogonal to this and must not be lost with the misattribution: the app
    // still did not watch these being typed, and the bubble still says so.
    const entries = importCodexRollout([line('user', 'M4/031')], AT).entries
    expect(entries[0]?.event).toEqual({
      type: 'user_turn',
      text: 'M4/031',
      attribution: 'provider_transcript',
    })
  })

  it('an assistant line is untouched by every rule here', () => {
    // Non-vacuity for the whole block: a classifier that answered "injected" to everything would
    // pass every negative above.
    const events = eventsOf(line('assistant', 'Done — committed as 7bfe813.'))
    expect(events.map((event) => event.type)).toEqual(['assistant_message'])
    expect(events[0]?.text).toBe('Done — committed as 7bfe813.')
  })
})

describe('the user’s own provider directories are never written to', () => {
  /**
   * The import path is reachable only through the store and injected `nativeTranscriptPath`
   * seam. Assert structurally that no source names a path in the user’s home, preventing a
   * stray write to personal transcript history.
   */
  it('no main-process source writes under ~/.claude or ~/.codex', () => {
    const roots = [join(here, '../src/main')]
    const offenders: string[] = []
    const walk = (path: string): void => {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        const child = join(path, entry.name)
        if (entry.isDirectory()) {
          walk(child)
          continue
        }
        if (!entry.name.endsWith('.ts')) continue
        // COMMENTS STRIPPED FIRST. The first version of this check flagged `workspace.ts` for a
        // comment explaining why we do NOT load `.claude/settings.json` — prose about the risk read
        // as the risk itself. A check that fires on its own documentation trains people to silence it.
        const code = readFileSync(child, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '')
        // The user's real homes are only reachable by naming them, and every app-owned path is built
        // from `userData` instead. So: does this file construct such a path AND write?
        const namesUserHome = /homedir\(\)|['"`]~\/\.(claude|codex)|\.(claude|codex)['"`]/.test(
          code,
        )
        // `new Database(` is in here because of 046: opening a provider's WAL-mode SQLite index
        // with `{readonly: true}` CREATES its `-shm` sidecar when one is missing — measured — so a
        // "read" through better-sqlite3 is a write to the directory. The regex above catches none
        // of that, because the write happens in C. Reads now go through `readProviderDatabase`,
        // which copies first; naming a user home AND opening a database directly is the shape this
        // has to keep catching.
        const writes =
          /\bwriteFileSync\b|\bappendFileSync\b|\bmkdirSync\b|\brmSync\b|\bunlinkSync\b|\bcpSync\b|new Database\(/.test(
            code,
          )
        // ⚠️ What this AND cannot see, said out loud so a green run is not read as more than it is:
        // a file that RECEIVES a user-home path instead of naming one is never flagged, whatever it
        // goes on to do with it. `runtime-host.ts` is exactly that file — 047 gave it paths from
        // `deps.userHomeSessions()` — so its archive and import paths are covered by the
        // BEHAVIOURAL tests in `user-homes.test.ts` and by review, not by this scan.
        if (namesUserHome && writes) offenders.push(child)
      }
    }
    walk(roots[0]!)
    expect(offenders, 'a file both names a provider home and writes').toEqual([])
  })
})

/**
 * # 🔴 The version has to MOVE when the importer's output does (214 §2)
 *
 * ⛔ **A mutation survived the first run of 214's table and this is why it exists.** Setting
 * `NORMALIZER_VERSION` back to `2` broke nothing — because nothing tied the constant to the
 * behaviour it describes. ⚠️ **And the consequence is the whole fix evaporating**: every Codex
 * ledger already in the database keeps the misattribution, never reads `stale`, is never offered a
 * Rebuild, and `213`'s adopted session looks exactly the same after upgrading. The repair would
 * reach only conversations adopted for the first time on a later build.
 *
 * `normalizer.ts` states the rule — *"bump when the importers would produce a DIFFERENT ledger from
 * the same frames"* — and a rule nothing enforces is a note.
 */
describe('214 §2 · the normalizer version tracks the importer', () => {
  it('🔴 an importer that classifies injected context declares version 3 or later', () => {
    // ⚑ **Coupled to the BEHAVIOUR, not asserted as a magic number.** This reads what the importer
    // actually does today and requires the constant to have moved for it. A build that classifies
    // and still says `2` is telling every existing ledger it is current when it is not.
    const classifies =
      splitCodexMessage('developer', '<skills_instructions>x</skills_instructions>').injected &&
      splitCodexMessage('user', '<skill>\n<name>x</name>\n</skill>').injected

    expect(classifies, 'this test describes a build that does not classify — retire it').toBe(true)
    expect(NORMALIZER_VERSION).toBeGreaterThanOrEqual(3)
  })
})
