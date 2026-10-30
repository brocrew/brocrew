import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  renameSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { claudeAutoMemoryDir } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { type AppDatabase, openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore, type SessionStore } from '../src/main/db/session-store'
import {
  accessEntries,
  ADMINISTRATORS_SID,
  othersLetIn,
  SYSTEM_SID,
  windowsAccessLists,
  type AccessLists,
} from '../src/main/recovery/windows-privacy'
import {
  amendAgentMemory,
  readAgentMemory,
  type MemoryWriteSeams,
} from '../src/main/runtime/agent-memory'
import {
  AMENDMENT_MEANS,
  AMENDMENT_REFUSED,
  A_PERSON_DID_THIS,
  MEMORY_AMENDMENT,
  REFUSAL_MEANS,
} from '../src/shared/agent-memory'
import { INSTRUCTION_FILE_CAP } from '../src/main/runtime/instructions'

/**
 * # 🔴 A person may take a false memory out, and the record says they did (625, `EXT-015` §3)
 *
 * A person can find and remove a false memory note. `memory-without-a-conversation.test.ts`
 * checks discovery; this file checks removal, including §3.3’s record of who removed the
 * entry and when. A person’s edit must never look like an agent’s.
 *
 * ## ⚠️ The rail this file exists for, and it is NOT the obvious one
 *
 * ⛔ **The READ follows a symlink out of the store and the WRITE must not**, and the two decisions
 * look contradictory until the polarity is named. `170` §2 ruled that refusing a link on the READ
 * removed the row from the panel and removed nothing from the model's prompt — *"no visibility and
 * no protection, which is strictly worse than either."* 🔴 **Refusing it on the WRITE removes a
 * `rm` on a file outside BroBot's folders**, which is the one thing `EXT-015` §5 forbids by name.
 * ⚑ §2 is that rail, with the negative control the brief's criterion 5 asks for.
 *
 * ## ⛔ Why the record is a TABLE and not a derivation
 *
 * ⚠️ **After a removal the file is gone**, so *what it said* exists nowhere except in the row —
 * `a-derivation-cannot-answer-what-its-ledger-does-not-contain`, arriving literally. §4 is that.
 */

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

let root: string
let homesRoot: string
let outside: string
let db: AppDatabase
let store: SessionStore

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-amend-memory-'))
  homesRoot = join(root, 'provider-homes')
  // ⛔ **A directory OUTSIDE the managed root.** It stands in for `~/.claude`, which `EXT-015` §5
  // names and which no test here may go near — the property under test is *outside the root*, and
  // this directory has it exactly as much as his does.
  outside = join(root, 'not-ours')
  mkdirSync(outside, { recursive: true })
  db = openDatabase(join(root, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  store = createSessionStore(db)
})

afterEach(() => {
  db.close()
  rmSync(root, { recursive: true, force: true })
})

const homeOf =
  (profileId: string) =>
  (provider: Provider): string =>
    join(homesRoot, 'default', profileId, provider)

const inputs = (profileId: string) => ({
  profileId,
  homeOf: homeOf(profileId),
  homesRoot,
})

/** A Claude store with an index and one topic file — the shape BroBot's own memory has. */
const plantStore = (profileId: string, files: Record<string, string>): string => {
  const dir = claudeAutoMemoryDir(homeOf(profileId)('claude'))
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
  return dir
}

const THE_FALSE_NOTE =
  'a deliberately parked agent is indistinguishable from a broken one in this app\n'

const plantTheNight = (profileId = 'brobot'): { dir: string; note: string; index: string } => {
  const dir = plantStore(profileId, {
    'MEMORY.md': '- [A parked agent](parked.md) — cannot be told from a broken one\n',
    'parked.md': THE_FALSE_NOTE,
  })
  return { dir, note: join(dir, 'parked.md'), index: join(dir, 'MEMORY.md') }
}

const amend = (
  profileId: string,
  over: { entry: string; act?: 'removed' | 'corrected'; text?: string },
) =>
  amendAgentMemory({
    ...inputs(profileId),
    provider: 'claude',
    act: over.act ?? 'removed',
    text: over.text ?? '',
    entry: over.entry,
  })

describe('§1 · ⛔ the act itself — and it is the acceptance test', () => {
  it('🔴 a person removes the false note, and it is gone from the store and from the reading', async () => {
    const { note } = plantTheNight()
    expect(readAgentMemory(inputs('brobot')).stores[0]?.entries.map((e) => e.path)).toContain(note)

    const outcome = await amend('brobot', { entry: note })
    expect(outcome.done).toBe(true)
    // ⚑ **The BYTES come back on the done arm**, and this is what the record is written from — read
    // inside the same guarded walk that decided the path, not handed in by a caller who read it a
    // minute ago.
    expect(outcome.done && outcome.textBefore).toBe(THE_FALSE_NOTE)
    expect(existsSync(note)).toBe(false)
    expect(readAgentMemory(inputs('brobot')).stores[0]?.entries.map((e) => e.path)).not.toContain(
      note,
    )
  })

  it('⚠️ …and the INDEX still points at it, because this app does not parse an agent’s prose', async () => {
    // 🔴 **The honest cost of `EXT-015` §5's second clause**, asserted rather than left implied:
    // *"Do not infer anything from the text of a memory entry. Show it; do not interpret it."*
    // ⛔ Finding the `- [A parked agent](parked.md)` line would mean parsing the index, and
    // `D17` / `HO-088` §5.1 ruled against prose detection.
    const { note, index } = plantTheNight()
    await amend('brobot', { entry: note })
    expect(readFileSync(index, 'utf8')).toContain('parked.md')
    // ⚑ **And the remedy is a SECOND act by the same person, not a guess by this app.** The index
    // is itself an entry in the reading, so correcting it is one more press.
    const done = await amend('brobot', { entry: index, act: 'corrected', text: '' })
    expect(done.done).toBe(true)
    expect(readFileSync(index, 'utf8')).toBe('')
  })

  it('⛔ a correction replaces the bytes and leaves the entry standing', async () => {
    const { note } = plantTheNight()
    const outcome = await amend('brobot', {
      entry: note,
      act: 'corrected',
      text: 'BROBOT-625-CORRECTED\n',
    })
    expect(outcome.done).toBe(true)
    expect(readFileSync(note, 'utf8')).toBe('BROBOT-625-CORRECTED\n')
    // ⚠️ **Renamed over its name**, so the entry stands where it was and a reader that opens the
    // path mid-write sees the old file or the new one, never it absent.
    expect(readAgentMemory(inputs('brobot')).stores[0]?.entries.map((e) => e.path)).toContain(note)
  })

  it('⚑ an empty correction is a real act — and it is NOT a removal', async () => {
    // ⛔ **The same distinction `OwnInstructionsVersion.text` makes**: *nobody ever wrote one* and
    // *somebody wrote one and emptied it* are different facts, and only one of them has an author.
    const { note } = plantTheNight()
    expect((await amend('brobot', { entry: note, act: 'corrected', text: '' })).done).toBe(true)
    expect(existsSync(note)).toBe(true)
    expect(readFileSync(note, 'utf8')).toBe('')
  })
})

describe('§2 · 🔒 the rail — a write follows NO link, which is the opposite of the read', () => {
  it('🔴 an entry that is a symlink OUT of the store is REFUSED, and the target is untouched', async () => {
    // ⛔ **The hazard on the path the code walks.** Without this refusal, removing a memory entry
    // would `unlink` — or `O_TRUNC` — a file `EXT-015` §5 says this app may never write.
    const theirs = join(outside, 'CLAUDE.md')
    writeFileSync(theirs, 'MONTHS-OF-HIS-OWN-HISTORY\n')
    const dir = plantStore('linked', { 'MEMORY.md': '- [x](x.md)\n' })
    symlinkSync(theirs, join(dir, 'linked.md'))

    const outcome = await amend('linked', { entry: join(dir, 'linked.md') })
    expect(outcome.done).toBe(false)
    expect(!outcome.done && outcome.refused).toBe('somewhere-else')
    // 🔴 **The target is still there, byte for byte.** This is the assertion the whole rail is for.
    expect(readFileSync(theirs, 'utf8')).toBe('MONTHS-OF-HIS-OWN-HISTORY\n')
    expect(existsSync(join(dir, 'linked.md'))).toBe(true)
  })

  it('⛔ …and a CORRECTION through the same link is refused too — not only the removal', async () => {
    // ⚠️ **Two acts, one rail, and asking about only one of them is
    // `one-failure-is-not-the-failure-shape`**: `unlink` and `O_TRUNC` are different syscalls
    // reached by different branches, and a guard that covered the first would leave the second
    // writing a person's text into a file outside BroBot's folders.
    const theirs = join(outside, 'CLAUDE.md')
    writeFileSync(theirs, 'MONTHS-OF-HIS-OWN-HISTORY\n')
    const dir = plantStore('linked2', { 'MEMORY.md': '- [x](x.md)\n' })
    symlinkSync(theirs, join(dir, 'linked.md'))

    const outcome = await amend('linked2', {
      entry: join(dir, 'linked.md'),
      act: 'corrected',
      text: 'OVERWRITTEN\n',
    })
    expect(!outcome.done && outcome.refused).toBe('somewhere-else')
    expect(readFileSync(theirs, 'utf8')).toBe('MONTHS-OF-HIS-OWN-HISTORY\n')
  })

  it('🔴 …and the POSITIVE control: an ordinary entry in the SAME store is removed', async () => {
    // ⚑ **Without this the rail above is satisfied by a guard that refuses everything**
    // (`a-positive-assertion-must-differ-from-the-default`), and a broken derivation would read as
    // a working refusal.
    const theirs = join(outside, 'CLAUDE.md')
    writeFileSync(theirs, 'THEIRS\n')
    const dir = plantStore('both', { 'MEMORY.md': '- [x](x.md)\n', 'ours.md': 'OURS\n' })
    symlinkSync(theirs, join(dir, 'linked.md'))

    expect(!(await amend('both', { entry: join(dir, 'linked.md') })).done).toBe(true)
    expect((await amend('both', { entry: join(dir, 'ours.md') })).done).toBe(true)
    expect(existsSync(join(dir, 'ours.md'))).toBe(false)
  })

  it('⛔ a path this app never derived reaches no filesystem call at all', async () => {
    // 🔴 **The house ruling: the renderer never supplies a path.** The caller's string is looked up
    // in a store main re-derives, so a traversal is not refused by a validator — it simply matches
    // nothing, which is a stronger property than a check somebody has to keep correct.
    const victim = join(outside, 'passwd')
    writeFileSync(victim, 'ROOT\n')
    const dir = plantStore('probe', { 'MEMORY.md': 'x\n' })
    for (const entry of [
      victim,
      join(dir, '..', '..', '..', 'not-ours', 'passwd'),
      '/etc/passwd',
    ]) {
      const outcome = await amend('probe', { entry })
      expect(!outcome.done && outcome.refused, entry).toBe('no-such-entry')
    }
    expect(readFileSync(victim, 'utf8')).toBe('ROOT\n')
  })

  it('⚠️ an entry the agent changed under the person answers `no-such-entry`, not a silent miss', async () => {
    const { note } = plantTheNight()
    rmSync(note)
    expect(!(await amend('brobot', { entry: note })).done).toBe(true)
    expect(REFUSAL_MEANS['no-such-entry']).toContain('Look again')
  })

  it('🔴 an entry this app could not read WHOLE is refused rather than destroyed', async () => {
    // ⛔ **A removal whose record cannot say what was removed is a removal this app must not
    // perform.** ⚠️ The guarded reader caps at `INSTRUCTION_FILE_CAP` and flags `truncated`; a file
    // past it would be recorded as the part we read, and the row would then be a claim about bytes
    // nobody has.
    const dir = plantStore('huge', { 'MEMORY.md': 'x'.repeat(INSTRUCTION_FILE_CAP + 10) })
    const entry = join(dir, 'MEMORY.md')
    expect(readAgentMemory(inputs('huge')).stores[0]?.entries[0]?.truncated).toBe(true)
    const outcome = await amend('huge', { entry })
    expect(!outcome.done && outcome.refused).toBe('unreadable')
    expect(existsSync(entry)).toBe(true)
  })

  // Windows chmod cannot construct a POSIX permission denial.
  it.skipIf(process.platform === 'win32')(
    '⚑ a store this app cannot write answers `write-failed`, and changes nothing',
    async () => {
      const dir = plantStore('sealed', { 'MEMORY.md': 'SEALED\n', 'x.md': 'X\n' })
      chmodSync(dir, 0o500)
      try {
        const outcome = await amend('sealed', { entry: join(dir, 'x.md') })
        expect(!outcome.done && outcome.refused).toBe('write-failed')
        expect(existsSync(join(dir, 'x.md'))).toBe(true)
      } finally {
        chmodSync(dir, 0o700)
      }
    },
  )

  it('⛔ every refusal has a sentence, and every sentence names what to do next', () => {
    expect(Object.keys(REFUSAL_MEANS).sort()).toEqual([...AMENDMENT_REFUSED].sort())
    for (const word of AMENDMENT_REFUSED) {
      expect(REFUSAL_MEANS[word].length, `${word} has no sentence`).toBeGreaterThan(20)
    }
  })
})

describe('§3 · 🔴 the record — and it is written at the moment of the act', () => {
  const identity = (slug: string): void => {
    const made = store.createAgentIdentity(
      { slug, displayName: null, provider: 'claude' },
      { by: 'a-person' },
    )
    // ⛔ **Non-vacuity.** Every assertion below rests on the row existing, and a creation that
    // answered `null` would make `writeMemoryAmendment`'s criterion-12 refusal look like the thing
    // under test — which is `34`'s shape: a broken fixture's silence reads as a clean result.
    expect(made, `no identity row for ${slug}`).not.toBeNull()
  }

  it('⛔ a removal records WHO, WHEN and WHAT WAS THERE — and the text survives the file', async () => {
    identity('brobot')
    const { note } = plantTheNight()
    const outcome = await amend('brobot', { entry: note })
    expect(outcome.done).toBe(true)

    const written = store.writeMemoryAmendment(
      {
        profileSlug: 'brobot',
        provider: 'claude',
        entry: outcome.done ? outcome.entry : '',
        act: 'removed',
        by: { who: 'a-person' },
        textBefore: outcome.done ? outcome.textBefore : '',
        textAfter: null,
      },
      1_790_000_000_000,
    )
    expect(written?.id).toBe('mem:brobot:1')
    // 🔴 **The bytes are in the row and the file is not on disk** — the whole reason this is a
    // table rather than a derivation.
    expect(existsSync(note)).toBe(false)
    expect(store.memoryAmendmentsOf('brobot')[0]?.textBefore).toBe(THE_FALSE_NOTE)
    expect(store.memoryAmendmentsOf('brobot')[0]?.by).toEqual({ who: 'a-person' })
    expect(store.memoryAmendmentsOf('brobot')[0]?.at).toBe(1_790_000_000_000)
  })

  it('⚑ the sequence is allocated by the STORE and never reissued', () => {
    identity('brobot')
    const write = (n: number) =>
      store.writeMemoryAmendment(
        {
          profileSlug: 'brobot',
          provider: 'claude',
          entry: `/x/${String(n)}.md`,
          act: 'removed',
          by: { who: 'a-person' },
          textBefore: 'x',
          textAfter: null,
        },
        n,
      )
    expect([write(1)?.seq, write(2)?.seq, write(3)?.seq]).toEqual([1, 2, 3])
    // ⚠️ **Newest first**, which is the order a person reads a history in.
    expect(store.memoryAmendmentsOf('brobot').map((one) => one.seq)).toEqual([3, 2, 1])
  })

  it('⛔ a slug with no identity row records NOTHING — criterion 12 at this door', () => {
    expect(
      store.writeMemoryAmendment(
        {
          profileSlug: 'nobody',
          provider: 'claude',
          entry: '/x/a.md',
          act: 'removed',
          by: { who: 'a-person' },
          textBefore: 'x',
          textAfter: null,
        },
        1,
      ),
    ).toBeNull()
    expect(store.memoryAmendmentsOf('nobody')).toEqual([])
  })

  it('🔴 the DATABASE refuses a removal that claims an "after", and a correction with none', () => {
    // ⛔ **`identity_memory_amendment_after_matches_act_ck`** — the two columns cannot come apart in
    // a rule a writer has to keep, which is `identity_instruction_person_said_nothing_ck`'s own
    // shape one table over. ⚑ **A rule is proven by VIOLATING it** (standing rule 20).
    identity('brobot')
    const write = (act: 'removed' | 'corrected', textAfter: string | null) =>
      store.writeMemoryAmendment(
        {
          profileSlug: 'brobot',
          provider: 'claude',
          entry: '/x/a.md',
          act,
          by: { who: 'a-person' },
          textBefore: 'x',
          textAfter,
        },
        1,
      )
    expect(() => write('removed', 'something')).toThrow(/CHECK constraint/i)
    expect(() => write('corrected', null)).toThrow(/CHECK constraint/i)
    // ⚑ **Both controls**: each act is accepted in its own shape, so the throws above are the CHECK
    // and not a broken fixture.
    expect(write('removed', null)?.act).toBe('removed')
    expect(write('corrected', 'y')?.act).toBe('corrected')
  })

  it('⚠️ every act has a sentence, and every sentence names a PERSON', () => {
    expect(Object.keys(AMENDMENT_MEANS).sort()).toEqual([...MEMORY_AMENDMENT].sort())
    for (const act of MEMORY_AMENDMENT) {
      expect(AMENDMENT_MEANS[act], `${act} does not name a person`).toContain('a person')
    }
    // 🔴 **And the reason there is no `wrote_it` column, asserted by name** (`EXT-015` §3.3).
    // ⛔ `identity_instruction` carries a provenance vocabulary because four authorities can write
    // a version; exactly one can reach this door. ⚠️ **The day that stops being true this constant
    // is what goes red**, which is what makes the missing column a decision rather than an
    // omission.
    expect(A_PERSON_DID_THIS).toContain('Only a person')
    expect(A_PERSON_DID_THIS).toContain('No agent has a tool')
  })
})

describe('§4 · ⛔ a RUNNING conversation does not move under it', () => {
  it('🔴 a conversation’s own reading still names an entry a person removed after its launch', async () => {
    // ⛔ **`EXT-015` §2.1 and §2's fourth row**: a change reaches the agent *from its next
    // conversation*, and the conversation's copy *"is a record; never; it is this conversation's"*.
    // ⚑ `readSessionInstructions` takes that copy at ITS launch, so the invariant is structural —
    // and this is the assertion that says the memory door does nothing to break it.
    const { note } = plantTheNight()
    // ⚠️ **The conversation's reading, taken BEFORE the removal and held**, which is exactly what a
    // live host holds in `SessionRecord.instructions`.
    const launched = readAgentMemory(inputs('brobot'))
    const wasGiven = JSON.parse(JSON.stringify(launched.stores)) as unknown

    expect((await amend('brobot', { entry: note })).done).toBe(true)

    // 🔴 **The held copy is unchanged**, object for object — the removal mutated nothing it points
    // at, so a running conversation goes on reporting what it was given.
    expect(launched.stores).toEqual(wasGiven)
    expect(JSON.stringify(launched.stores)).toContain(THE_FALSE_NOTE.trim())
    // ⚑ **And a FRESH read sees the removal**, which is what makes the assertion above a property
    // of the held copy rather than of a reader that answers nothing.
    expect(JSON.stringify(readAgentMemory(inputs('brobot')).stores)).not.toContain(
      THE_FALSE_NOTE.trim(),
    )
  })
})

describe('§5 · 🔒 a correction never widens who may read the entry', () => {
  const ME = 'S-1-5-21-1111111111-2222222222-3333333333-1001'
  const USERS = 'S-1-5-32-545'

  const correct = (entry: string, seams: MemoryWriteSeams) =>
    amendAgentMemory(
      { ...inputs('brobot'), provider: 'claude', act: 'corrected', text: 'CORRECTED\n', entry },
      seams,
    )

  /** The data hierarchy is already private; no ACL mutation may create that assumption. */
  const fakeLists = (entry: string, fail?: Error) => {
    const asked: { file: string; held: string; entryHeld: string }[] = []
    const folders: string[][] = []
    const lists: AccessLists = {
      userSid: () => Promise.resolve(ME),
      machineSid: () => Promise.resolve(null),
      read: (path) => {
        if (path === root || path === homesRoot) {
          return Promise.resolve(`D:PAI(A;OICI;FA;;;${ME})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`)
        }
        if (path.endsWith('.brobot-stage')) {
          folders.push(readdirSync(path))
          if (fail !== undefined) return Promise.reject(fail)
        } else {
          asked.push({
            file: path,
            held: readFileSync(path, 'utf8'),
            entryHeld: readFileSync(entry, 'utf8'),
          })
        }
        return Promise.resolve(`D:PAI(A;OICI;FA;;;${ME})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`)
      },
      restrict: () => {
        return Promise.reject(new Error('An existing hierarchy must already be private'))
      },
    }
    return { lists, asked, folders }
  }

  it('on Windows, a stage is born in the verified private folder before any text goes in', async () => {
    const { note } = plantTheNight()
    const { lists, asked, folders } = fakeLists(note)

    expect((await correct(note, { platform: 'win32', lists })).done).toBe(true)

    expect(folders).toEqual([[], []])
    expect(asked).toEqual([
      {
        file: expect.stringMatching(/\.parked\.md\.brobot-[0-9a-f]{24}$/),
        held: '',
        entryHeld: THE_FALSE_NOTE,
      },
    ])
    expect(dirname(asked[0]?.file ?? '')).toBe(join(homesRoot, '.brobot-stage'))
    expect(readFileSync(note, 'utf8')).toBe('CORRECTED\n')
  })

  it('on Windows, a staging folder that cannot be made private stages beside the entry instead', async () => {
    const { note } = plantTheNight()
    const { lists } = fakeLists(note, new Error('Access is denied.'))

    expect((await correct(note, { platform: 'win32', lists, warn: () => {} })).done).toBe(true)

    expect(readFileSync(note, 'utf8')).toBe('CORRECTED\n')
    expect(readdirSync(join(homesRoot, '.brobot-stage'))).toEqual([])
  })

  it('on Windows, an inherited file ACL that is still broad is corrected all the same', async () => {
    const { note } = plantTheNight()
    const { lists } = fakeLists(note)
    const outcome = await correct(note, {
      platform: 'win32',
      warn: () => {},
      lists: {
        ...lists,
        read: (path) =>
          path === root || path === homesRoot || path.endsWith('.brobot-stage')
            ? lists.read(path)
            : Promise.resolve(`D:AI(A;;FA;;;${ME})(A;;FR;;;${USERS})`),
      },
    })
    expect(outcome.done).toBe(true)
    expect(readFileSync(note, 'utf8')).toBe('CORRECTED\n')
  })

  it('on Windows, a correction leaves private crash stages and unrelated files untouched', async () => {
    const { note } = plantTheNight()
    const stage = join(homesRoot, '.brobot-stage')
    mkdirSync(stage)
    writeFileSync(join(stage, '.parked.md.brobot-99999-0'), 'HALF A CORRECTION')
    writeFileSync(join(stage, 'leave.txt'), 'OTHER')
    const { lists } = fakeLists(note)
    expect((await correct(note, { platform: 'win32', lists })).done).toBe(true)
    expect(readdirSync(stage).sort()).toEqual(['.parked.md.brobot-99999-0', 'leave.txt'])
  })

  it.each(['shared data', 'shared homes', 'unreadable data'] as const)(
    'on Windows, %s is corrected all the same',
    async (kind) => {
      const { note } = plantTheNight()
      const { lists } = fakeLists(note)
      const refusedPath = kind === 'shared homes' ? homesRoot : root
      const outcome = await correct(note, {
        platform: 'win32',
        warn: () => {},
        lists: {
          ...lists,
          read: (path) => {
            if (path !== refusedPath) return lists.read(path)
            return kind === 'unreadable data'
              ? Promise.reject(new Error('The ACL could not be read'))
              : Promise.resolve(`D:AI(A;;FA;;;${ME})(A;;FR;;;${USERS})`)
          },
        },
      })
      expect(outcome.done).toBe(true)
      expect(readFileSync(note, 'utf8')).toBe('CORRECTED\n')
    },
  )

  it('a staging directory replaced by a junction before creation refuses without touching the target', async () => {
    const { note } = plantTheNight()
    const { lists, asked } = fakeLists(note)
    const outsideStage = join(outside, '.kept.md.brobot-99999-0')
    writeFileSync(outsideStage, 'OUTSIDE')
    const outcome = await correct(note, {
      platform: 'win32',
      lists,
      beforeStageCreate: (stage) => {
        renameSync(stage, `${stage}.kept`)
        symlinkSync(outside, stage, 'junction')
      },
    })
    expect(!outcome.done && outcome.refused).toBe('write-failed')
    expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
    expect(asked).toEqual([])
    expect(readdirSync(outside)).toEqual(['.kept.md.brobot-99999-0'])
    expect(readFileSync(outsideStage, 'utf8')).toBe('OUTSIDE')
  })

  it('elsewhere the mode does it, and no access list is asked for', async () => {
    const { note } = plantTheNight()
    const { lists, asked } = fakeLists(note)

    expect((await correct(note, { platform: 'darwin', lists })).done).toBe(true)

    expect(asked).toEqual([])
  })

  it('a POSIX correction sweeps old adjacent stages; Windows corrections preserve them', async () => {
    const { dir, note } = plantTheNight()
    // Random names, and the pid-and-counter ones builds before them left.
    const left = [
      `.parked.md.brobot-${'a'.repeat(24)}`,
      '.MEMORY.md.brobot-0123456789abcdef01234567',
      '.parked.md.brobot-99999-0',
      '.MEMORY.md.brobot-1-3',
    ]
    const kept = [
      `parked.md.brobot-${'a'.repeat(24)}`,
      '.parked.md.brobot-x',
      `.parked.md.brobot-${'a'.repeat(24)}.md`,
      '.parked.md.brobot-1-0.md',
    ]
    for (const name of [...left, ...kept]) writeFileSync(join(dir, name), 'HALF A CORRECTION')
    mkdirSync(join(dir, `.a-folder.brobot-${'a'.repeat(24)}`))

    expect((await correct(note, {})).done).toBe(true)

    expect(readdirSync(dir).sort()).toEqual(
      [
        'MEMORY.md',
        'parked.md',
        `.a-folder.brobot-${'a'.repeat(24)}`,
        ...kept,
        ...(process.platform === 'win32' ? left : []),
      ].sort(),
    )
  })

  it.runIf(process.platform === 'win32')(
    'on Windows real disk, a stage inherits owner-only access at creation and stays private after rename',
    async () => {
      const { dir, note } = plantTheNight()
      const icacls = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe')
      const user = await windowsAccessLists.userSid()
      const machine = await windowsAccessLists.machineSid()
      const others = async (path: string) =>
        othersLetIn(accessEntries(await windowsAccessLists.read(path), machine), user)
      // The folder lets every user read what is made in it; the entry is kept from them.
      execFileSync(icacls, [dir, '/grant', `*${USERS}:(OI)(CI)R`, '/Q'])
      execFileSync(icacls, [
        note,
        '/grant:r',
        `*${user}:F`,
        `*${SYSTEM_SID}:F`,
        `*${ADMINISTRATORS_SID}:F`,
        '/Q',
      ])
      execFileSync(icacls, [note, '/inheritance:r', '/Q'])
      const fresh = join(dir, 'made-now.txt')
      writeFileSync(fresh, 'x')
      expect(await others(fresh)).toContain(USERS)
      expect(await others(note)).toEqual([])

      const created: { others: string[]; text: string; path: string }[] = []
      const lists: AccessLists = {
        ...windowsAccessLists,
        read: async (path) => {
          // This is the first file ACL read after open, before any file ACL mutation or text write.
          const sddl = await windowsAccessLists.read(path)
          if (path !== root && path !== homesRoot && path !== join(homesRoot, '.brobot-stage')) {
            created.push({
              others: othersLetIn(accessEntries(sddl, machine), user),
              text: readFileSync(path, 'utf8'),
              path,
            })
          }
          return sddl
        },
      }
      expect((await correct(note, { lists })).done).toBe(true)
      expect(created).toEqual([{ others: [], text: '', path: expect.any(String) }])
      expect(dirname(created[0]?.path ?? '')).toBe(join(homesRoot, '.brobot-stage'))

      expect(readFileSync(note, 'utf8')).toBe('CORRECTED\n')
      expect(await others(note)).toEqual([])
      expect(readdirSync(join(homesRoot, '.brobot-stage'))).toEqual([])
    },
  )

  it.runIf(process.platform === 'win32')(
    'on Windows real disk, a shared data folder refuses without changing ACLs or the note',
    async () => {
      const { note } = plantTheNight()
      const icacls = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'icacls.exe')
      execFileSync(icacls, [root, '/grant', `*${USERS}:R`, '/Q'])
      const before = await windowsAccessLists.read(root)
      const outcome = await correct(note, {})
      expect(!outcome.done && outcome.refused).toBe('write-failed')
      expect(await windowsAccessLists.read(root)).toBe(before)
      expect(readFileSync(note, 'utf8')).toBe(THE_FALSE_NOTE)
      expect(existsSync(join(homesRoot, '.brobot-stage'))).toBe(false)
    },
  )
})
