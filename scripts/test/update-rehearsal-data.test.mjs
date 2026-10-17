import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  CHECKPOINT_LINE,
  FAIL_LINE,
  OPENED_FOR_RECOVERY_LINE,
  READY_LINE,
} from '../../apps/desktop/src/main/recovery/log-lines.ts'
import {
  checkpointsIn,
  compareData,
  copyHoldsTheData,
  dataOf,
  firstStartProblems,
  sameData,
  verifyCheckpoint,
  whatTheDataLacks,
} from '../lib/update-rehearsal-data.mjs'
import { STATE_FILES } from '../lib/update-rehearsal.mjs'

/**
 * The update rehearsal's data checks, held on files made here: what a data folder holds read from
 * outside, whether B kept what A made, and whether a recovery copy is what its manifest says.
 */

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
let root
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot-rehearsal-data-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

/** A data folder with two conversations, their events and frames, a transcript and a draft. */
function aDataFolder(name = 'data') {
  const folder = join(root, name)
  mkdirSync(folder, { recursive: true })
  const database = new DatabaseSync(join(folder, 'brobot2.sqlite'))
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE provider_session (id TEXT PRIMARY KEY, external_ref TEXT, status TEXT, updated_at INTEGER);
    CREATE TABLE events (id TEXT PRIMARY KEY, session_id TEXT, ordinal INTEGER, type TEXT, payload TEXT);
    CREATE TABLE agent_identity (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE work (id TEXT PRIMARY KEY, number INTEGER, owner_session_id TEXT, given_by_session_id TEXT);
    CREATE TABLE work_sequence (scope TEXT PRIMARY KEY, last INTEGER);
    INSERT INTO work VALUES ('w1', 1, 's1', NULL), ('w2', 2, 's2', NULL);
    INSERT INTO work_sequence VALUES ('root', 2);
    INSERT INTO provider_session VALUES ('s1', '{"sessionId":"thread-1"}', 'idle', 1), ('s2', '{"sessionId":"thread-2"}', 'idle', 1);
    INSERT INTO events VALUES ('e1', 's1', 1, 'user_turn', '{"text":"hello"}'), ('e2', 's1', 2, 'assistant_message', '{"text":"hi"}'), ('e3', 's2', 1, 'user_turn', '{"text":"ü"}');
    INSERT INTO agent_identity VALUES ('a1', 'Ada');
  `)
  database.close()
  const sessions = join(
    folder,
    'provider-homes',
    'default',
    'brobot',
    'codex',
    'sessions',
    '2026',
    '10',
    '07',
  )
  mkdirSync(sessions, { recursive: true })
  writeFileSync(join(sessions, 'rollout-2026-10-07T10-00-00-thread-1.jsonl'), '{"a":1}\n')
  writeFileSync(join(sessions, 'rollout-2026-10-07T10-00-01-thread-2.jsonl'), '{"b":2}\n')
  writeFileSync(
    join(folder, 'drafts.json'),
    JSON.stringify({ version: 1, drafts: [{ slot: 'new', text: 'unsent', attached: [] }] }),
  )
  writeFileSync(join(folder, 'workspace.json'), '{\n  "name": "Team"\n}\n')
  return folder
}
const run = (folder, sql) => {
  const database = new DatabaseSync(join(folder, 'brobot2.sqlite'))
  database.exec(sql)
  database.close()
}

describe('what B kept of what A made', () => {
  it('a folder read twice, untouched, differs in nothing', () => {
    const folder = aDataFolder()
    expect(compareData(dataOf(folder), dataOf(folder)).problems).toEqual([])
  })

  it('⛔ a changed payload, a lost row, a changed transcript or state file is named', () => {
    const folder = aDataFolder()
    const before = dataOf(folder)
    run(
      folder,
      `UPDATE events SET payload = '{"text":"hullo"}' WHERE id = 'e1'; DELETE FROM agent_identity;`,
    )
    writeFileSync(
      join(
        folder,
        'provider-homes',
        'default',
        'brobot',
        'codex',
        'sessions',
        '2026',
        '10',
        '07',
        'rollout-2026-10-07T10-00-01-thread-2.jsonl',
      ),
      '{"b":3}\n',
    )
    writeFileSync(join(folder, 'workspace.json'), '{"name":"Other"}\n')
    const problems = compareData(before, dataOf(folder)).problems
    expect(problems.some((one) => one.startsWith('events: a row A made is changed or gone'))).toBe(
      true,
    )
    expect(problems.some((one) => one.startsWith('events: 1 new row(s) nothing explains'))).toBe(
      true,
    )
    expect(
      problems.some((one) => one.startsWith('agent_identity: a row A made is changed or gone')),
    ).toBe(true)
    expect(problems.some((one) => /rollout-.*thread-2\.jsonl changed$/.test(one))).toBe(true)
    expect(problems).toContain('workspace.json changed')
  })

  it('⛔ a new row in a conversation nobody went on with is named; a new conversation’s rows are not', () => {
    const folder = aDataFolder()
    const before = dataOf(folder)
    run(folder, `INSERT INTO events VALUES ('e9', 's2', 2, 'notice', '{}');`)
    expect(compareData(before, dataOf(folder)).problems).toEqual([
      expect.stringMatching(/^events: 1 new row\(s\) nothing explains/),
    ])
    run(
      folder,
      `DELETE FROM events WHERE id = 'e9';
      INSERT INTO provider_session VALUES ('s3', '{"sessionId":"thread-3"}', 'idle', 5);
      INSERT INTO events VALUES ('e10', 's3', 1, 'user_turn', '{}');`,
    )
    expect(compareData(before, dataOf(folder)).problems).toEqual([])
  })

  it('a new conversation’s work, and the counter moved by it, are explained; nothing else of the kind', () => {
    const folder = aDataFolder()
    const before = dataOf(folder)
    run(
      folder,
      `INSERT INTO provider_session VALUES ('s3', '{"sessionId":"thread-3"}', 'idle', 5);
      INSERT INTO work VALUES ('w3', 3, 's3', NULL);
      UPDATE work_sequence SET last = 3;`,
    )
    expect(compareData(before, dataOf(folder)).problems).toEqual([])
    run(folder, `UPDATE work_sequence SET last = 5;`)
    expect(compareData(before, dataOf(folder)).problems).toEqual([
      expect.stringMatching(/^work_sequence: a row A made is changed or gone/),
      expect.stringMatching(/^work_sequence: 1 new row\(s\) nothing explains/),
    ])
    run(folder, `UPDATE work_sequence SET last = 3; INSERT INTO work VALUES ('w4', 4, 's3', 's1');`)
    expect(compareData(before, dataOf(folder)).problems).toEqual([
      expect.stringMatching(/^work: 1 new row\(s\) nothing explains/),
    ])
  })

  it('a conversation that went on may grow at its end, and its own row move; nothing before its end', () => {
    const folder = aDataFolder()
    const before = dataOf(folder)
    const transcript = join(
      folder,
      'provider-homes',
      'default',
      'brobot',
      'codex',
      'sessions',
      '2026',
      '10',
      '07',
      'rollout-2026-10-07T10-00-00-thread-1.jsonl',
    )
    run(
      folder,
      `INSERT INTO events VALUES ('e4', 's1', 3, 'user_turn', '{}'); UPDATE provider_session SET updated_at = 9, status = 'working' WHERE id = 's1';`,
    )
    writeFileSync(transcript, '{"a":1}\n{"c":3}\n')
    expect(compareData(before, dataOf(folder), { goneOn: ['s1'] }).problems).toEqual([])
    expect(compareData(before, dataOf(folder)).problems).not.toEqual([])
    writeFileSync(transcript, '{"a":2}\n{"c":3}\n')
    expect(compareData(before, dataOf(folder), { goneOn: ['s1'] }).problems).toEqual([
      expect.stringMatching(/thread-1\.jsonl changed before its end$/),
    ])
  })

  it('⛔ read either way, two readings are the same only when nothing at all was added', () => {
    const folder = aDataFolder()
    const before = dataOf(folder)
    expect(sameData(before, dataOf(folder))).toEqual([])
    run(
      folder,
      `INSERT INTO provider_session VALUES ('s3', '{"sessionId":"thread-3"}', 'idle', 5);
      INSERT INTO events VALUES ('e10', 's3', 1, 'user_turn', '{}');`,
    )
    expect(compareData(before, dataOf(folder)).problems).toEqual([])
    expect(sameData(before, dataOf(folder))).toEqual([
      expect.stringMatching(/^the other way round: events: a row A made is changed or gone/),
      expect.stringMatching(
        /^the other way round: provider_session: a row A made is changed or gone/,
      ),
    ])
  })

  it('⛔ a reading is worth comparing only if it holds what A made: events, a transcript, the draft', () => {
    const data = dataOf(aDataFolder())
    const draft = { slot: 'new', text: 'unsent' }
    expect(whatTheDataLacks(data, { conversations: ['s1'], draft })).toEqual([])
    expect(
      whatTheDataLacks(data, {
        conversations: ['s2', 's9'],
        draft: { slot: 'new', text: 'other' },
      }),
    ).toEqual([
      's2 has no assistant_message event',
      's9 has no user_turn event',
      's9 has no assistant_message event',
      's9 has no native transcript',
      'the draft is not saved',
    ])
  })

  it('drafts are compared by what they say: the draft A left must still be there', () => {
    const folder = aDataFolder()
    const before = dataOf(folder)
    writeFileSync(
      join(folder, 'drafts.json'),
      JSON.stringify({ version: 1, drafts: [{ attached: [], text: 'unsent', slot: 'new' }] }),
    )
    expect(compareData(before, dataOf(folder)).problems).toEqual([])
    writeFileSync(join(folder, 'drafts.json'), JSON.stringify({ version: 1, drafts: [] }))
    expect(compareData(before, dataOf(folder)).problems).toEqual(['the draft in new is gone'])
  })
})

/** A recovery copy of `folder`'s database, made as the app makes one, with its manifest. */
function aCopy(folder, version = '0.0.99', id = '0b5e2a3c-1d4f-4a6b-8c9d-0e1f2a3b4c5d') {
  const backups = join(folder, 'backups')
  const dir = join(backups, id)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(backups, 'workspace-id'), 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee\n')
  const source = new DatabaseSync(join(folder, 'brobot2.sqlite'))
  source.exec(`VACUUM INTO '${join(dir, 'database.sqlite').replace(/'/g, "''")}'`)
  source.close()
  const copy = new DatabaseSync(join(dir, 'database.sqlite'))
  copy.exec(`PRAGMA journal_mode = DELETE;
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC);
    INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h0', 100), ('h1', 200);`)
  copy.close()
  const files = STATE_FILES.map((name) => {
    try {
      const bytes = readFileSync(join(folder, name))
      writeFileSync(join(dir, name), bytes)
      return { name, present: true, bytes: bytes.length, sha256: sha256(bytes) }
    } catch {
      return { name, present: false }
    }
  })
  const database = readFileSync(join(dir, 'database.sqlite'))
  writeFileSync(
    join(dir, 'manifest.json'),
    `${JSON.stringify(
      {
        format: 'brobot-checkpoint',
        version: 1,
        id,
        createdAt: '2026-10-07T10:00:00.000Z',
        workspaceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
        reason: 'first-start-of-release',
        madeBy: { appVersion: version, build: null },
        database: {
          file: 'database.sqlite',
          bytes: statSync(join(dir, 'database.sqlite')).size,
          sha256: sha256(database),
          migrations: [
            { createdAt: 100, hash: 'h0' },
            { createdAt: 200, hash: 'h1' },
          ],
        },
        files,
      },
      null,
      2,
    )}\n`,
  )
  return dir
}

describe('a recovery copy, checked against its manifest', () => {
  it('a copy made as the app makes one holds what its manifest says, and is found with who made it', () => {
    const folder = aDataFolder()
    aCopy(folder)
    const [copy] = checkpointsIn(folder)
    expect(copy).toMatchObject({ madeBy: '0.0.99', reason: 'first-start-of-release' })
    expect(verifyCheckpoint(copy).problems).toEqual([])
  })

  it('⛔ a changed database, a changed state file, a marker left, or another workspace’s copy is named', () => {
    const folder = aDataFolder()
    const dir = aCopy(folder)
    const [copy] = checkpointsIn(folder)
    writeFileSync(join(dir, 'drafts.json'), '{}')
    writeFileSync(join(dir, 'unfinished'), '')
    writeFileSync(join(folder, 'backups', 'workspace-id'), 'another\n')
    const bytes = readFileSync(join(dir, 'database.sqlite'))
    bytes[bytes.length - 1] ^= 1
    writeFileSync(join(dir, 'database.sqlite'), bytes)
    const problems = verifyCheckpoint(copy).problems
    expect(problems).toContain('drafts.json is not as its manifest says')
    expect(problems).toContain('unfinished is left in it')
    expect(problems).toContain('its workspace is not this folder’s')
    expect(problems).toContain('the database is not the one its manifest hashed')
  })

  it('a copy made before B changed anything holds exactly the data B opened', () => {
    const folder = aDataFolder()
    aCopy(folder)
    const [copy] = checkpointsIn(folder)
    // ⚑ The live database carries the same migrations the copy names.
    run(
      folder,
      `CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT, created_at NUMERIC);
      INSERT INTO __drizzle_migrations (hash, created_at) VALUES ('h0', 100), ('h1', 200);`,
    )
    expect(copyHoldsTheData(copy, dataOf(folder))).toEqual([])
    // ⛔ …and each state file byte for byte: one changed, or one that appeared, is named.
    writeFileSync(join(folder, 'workspace.json'), '{"name":"Other"}\n')
    writeFileSync(join(folder, 'provider-usage.json'), '{}')
    expect(copyHoldsTheData(copy, dataOf(folder))).toEqual([
      'provider-usage.json in the copy is not the one that was left',
      'workspace.json in the copy is not the one that was left',
    ])
    writeFileSync(join(folder, 'workspace.json'), '{\n  "name": "Team"\n}\n')
    rmSync(join(folder, 'provider-usage.json'))
    run(folder, `INSERT INTO agent_identity VALUES ('a2', 'Grace');`)
    expect(copyHoldsTheData(copy, dataOf(folder))).toEqual([
      expect.stringMatching(/^agent_identity: 1 new row\(s\) nothing explains/),
      expect.stringMatching(/^the copy lacks: agent_identity: a row A made is changed or gone/),
    ])
  })
})

describe('what a start said about its recovery copy', () => {
  it('a first start: the copy once, before ready', () => {
    expect(firstStartProblems(`x\n${CHECKPOINT_LINE}\ny\n${READY_LINE}\n`).problems).toEqual([])
    expect(firstStartProblems(`${READY_LINE}\n${CHECKPOINT_LINE}\n`).problems).toEqual([
      'it made its recovery copy after it was ready',
    ])
    expect(firstStartProblems(`${READY_LINE}\n`).problems).toEqual(['it made no recovery copy'])
  })

  it('⛔ a later start makes no copy; a failure or a recovery window is named on any start', () => {
    expect(firstStartProblems(`${READY_LINE}\n`, { expectCopy: false }).problems).toEqual([])
    expect(
      firstStartProblems(`${CHECKPOINT_LINE}\n${READY_LINE}\n`, { expectCopy: false }).problems,
    ).toEqual(['it made a recovery copy again'])
    expect(
      firstStartProblems(`${FAIL_LINE}\n${OPENED_FOR_RECOVERY_LINE}\n`, { expectCopy: false })
        .problems,
    ).toEqual([
      'it never said it was ready',
      'it said it did not start',
      'it opened only its recovery window',
    ])
  })
})
