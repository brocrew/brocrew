import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  A_STANDING_STOPS_SETUP,
  appExeIn,
  betaAsset,
  bundleIn,
  buildLineage,
  CHECKPOINT_LINE,
  CLOSE_LIMIT,
  contains,
  copiesSince,
  credentialSeen,
  dialogsAreAsDue,
  draftsKept,
  FAIL_LINE,
  historyOf,
  keptTables,
  installerGuid,
  jobSummary,
  lastResortStop,
  LAUNCH_SETUP_PROVIDERS,
  launchSetupExpected,
  lineageFits,
  packagingNames,
  providerReady,
  READY_LINE,
  RECOVERY_ONLY_LINE,
  NOTHING_RAN_LIMIT,
  recordedLineage,
  recordedWith,
  registryKept,
  resultLine,
  rowsPreserved,
  SAVED_KEY_LIMIT,
  sessionsKept,
  sha256,
  startOrder,
  stateFileNames,
  stateKept,
  theCandidateInstaller,
  transcriptsOf,
  turnOutcome,
  whatRunsIsSaid,
  verifyCheckpoint,
  APP_NAMES_BEFORE,
  keychainAttributes,
  keychainEntryFor,
} from '../lib/upgrade-path.mjs'
import {
  CLAUDE_CODE_VERSION,
  CLAUDE_FIXTURE_KEY,
  JOB_NOTICE,
  MANAGED_SETTINGS_PATH,
  conversationOf,
  dailyCron,
  jobIdIn,
  jobNoticesIn,
  minuteOf,
  namesTheJob,
  receiptsIn,
  stampingOf,
  startEvidence,
  toolResultText,
  anthropicEvents,
  claudeKeySeen,
  managedSettingsFor,
  offersTool,
  oneShotCron,
  sseOf,
  toolResultsIn,
  userTextsIn,
} from '../lib/scripted-claude.mjs'

/**
 * The upgrade-path check's own rules, on planted inputs: each comparison passes what the beta left
 * unchanged and fails each kind of loss, so a run that reports nothing lost has measured something.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const copy = (value) => structuredClone(value)

describe('the beta installer a release offers', () => {
  const digest = `sha256:${'a'.repeat(64)}`
  const assets = [
    { name: 'BroBot-Setup-0.0.0-x64-windows-beta-12.exe', size: 300, digest },
    { name: 'BroBot-0.0.0-arm64-mac-beta-1.dmg', size: 200, digest },
  ]

  it('is the one file for the OS, with the SHA-256 the release publishes', () => {
    expect(betaAsset(assets, 'windows')).toEqual({
      name: 'BroBot-Setup-0.0.0-x64-windows-beta-12.exe',
      size: 300,
      sha256: 'a'.repeat(64),
    })
    expect(betaAsset(assets, 'mac').name).toBe('BroBot-0.0.0-arm64-mac-beta-1.dmg')
  })

  it('is refused when there is none, two, or one with no size', () => {
    expect(() => betaAsset([], 'windows')).toThrow('exactly one windows installer')
    expect(() =>
      betaAsset([...assets, { name: 'BroBot-Setup-0.0.1-x64.exe', size: 1, digest }], 'windows'),
    ).toThrow('holds 2')
    expect(() => betaAsset([{ name: 'BroBot-0.0.0-arm64.dmg', size: 0, digest }], 'mac')).toThrow(
      'no size',
    )
  })

  it('is found under whatever name the beta was built, and never as its blockmap or archive', () => {
    const renamed = [
      { name: 'BroCrew-Setup-0.1.0-x64.exe', size: 300, digest },
      { name: 'BroCrew-Setup-0.1.0-x64.exe.blockmap', size: 3, digest },
      { name: 'BroCrew-0.1.0-arm64.dmg', size: 200, digest },
      { name: 'BroCrew-0.1.0-arm64.dmg.blockmap', size: 2, digest },
      { name: 'BroCrew-0.1.0-arm64-mac.zip', size: 2, digest },
    ]
    expect(betaAsset(renamed, 'windows').name).toBe('BroCrew-Setup-0.1.0-x64.exe')
    expect(betaAsset(renamed, 'mac').name).toBe('BroCrew-0.1.0-arm64.dmg')
  })

  it('is refused with no published SHA-256, or one that is not a SHA-256', () => {
    const [windows] = assets
    for (const published of [undefined, null, '', 'sha256:abc', `sha512:${'a'.repeat(64)}`]) {
      expect(() => betaAsset([{ ...windows, digest: published }], 'windows')).toThrow(
        'publishes no SHA-256',
      )
    }
  })
})

describe('the names each build goes by', () => {
  const yaml = [
    '# a comment that says productName: Other',
    'appId: com.brobot2.desktop',
    'productName: BroCrew',
    'directories:',
    '  output: dist',
    'nsis:',
    '  artifactName: ${productName}-Setup-${version}-x64.${ext}',
  ].join('\n')

  it('reads the app id and the product name from the build’s packaging', () => {
    expect(packagingNames(yaml)).toEqual({ appId: 'com.brobot2.desktop', productName: 'BroCrew' })
    const real = readFileSync(join(ROOT, 'apps', 'desktop', 'electron-builder.yml'), 'utf8')
    expect(packagingNames(real).appId).toBe('com.brobot2.desktop')
  })

  it('refuses packaging with no name, or one the lane can’t put in a path or a pattern', () => {
    expect(() => packagingNames('appId: com.brobot2.desktop')).toThrow('no product name')
    expect(() => packagingNames(`${yaml}\n`.replace('BroCrew', "Bro'Crew"))).toThrow(
      'no product name',
    )
    expect(() => packagingNames('productName: BroCrew')).toThrow('no app id')
  })

  it('finds a Windows install by the key electron-builder makes from the app id, whatever its name', () => {
    // The key a recorded run of the Windows update test shows for this app id.
    expect(installerGuid('com.brobot2.desktop')).toBe('19c3cbeb-8425-54f9-a9f1-9d170d16fc83')
    expect(installerGuid('com.example.other')).not.toBe('19c3cbeb-8425-54f9-a9f1-9d170d16fc83')
  })

  it('takes the candidate’s one installer of its version from the build’s output, under any name', () => {
    const dist = [
      'BroCrew-Setup-0.1.0-x64.exe',
      'BroCrew-Setup-0.1.0-x64.exe.blockmap',
      'BroCrew-0.1.0-arm64.dmg',
      'BroCrew-0.1.0-arm64.dmg.blockmap',
      'builder-debug.yml',
      'win-unpacked',
      'mac-arm64',
    ]
    expect(theCandidateInstaller(dist, 'windows', '0.1.0')).toBe('BroCrew-Setup-0.1.0-x64.exe')
    expect(theCandidateInstaller(dist, 'mac', '0.1.0')).toBe('BroCrew-0.1.0-arm64.dmg')
    expect(() => theCandidateInstaller(dist, 'windows', '0.1.1')).toThrow('holds 0')
    // The version's dots are dots, not any character.
    expect(() =>
      theCandidateInstaller(['BroCrew-Setup-0x1y0-x64.exe'], 'windows', '0.1.0'),
    ).toThrow('holds 0')
    expect(() =>
      theCandidateInstaller([...dist, 'BroBot-Setup-0.1.0-x64.exe'], 'windows', '0.1.0'),
    ).toThrow('holds 2')
  })

  it('reads the product name a Windows install was made under from its one program', () => {
    expect(
      appExeIn([
        'BroCrew.exe',
        'Uninstall BroCrew.exe',
        'ffmpeg.dll',
        'resources',
        'LICENSES.chromium.html',
      ]),
    ).toEqual({ exe: 'BroCrew.exe', productName: 'BroCrew' })
    expect(() => appExeIn(['Uninstall BroBot.exe'])).toThrow('holds 0')
    expect(() => appExeIn(['BroBot.exe', 'BroCrew.exe', 'Uninstall BroCrew.exe'])).toThrow(
      'holds 2',
    )
  })

  it('reads the product name a Mac build was made under from the one app in its disk image', () => {
    expect(bundleIn(['.background', '.DS_Store', 'Applications', 'BroCrew.app'])).toEqual({
      bundle: 'BroCrew.app',
      productName: 'BroCrew',
    })
    expect(() => bundleIn(['Applications'])).toThrow('holds 0')
    expect(() => bundleIn(['BroBot.app', 'BroCrew.app'])).toThrow('holds 2')
  })
})

describe('the migrations a build carries', () => {
  const journal = {
    entries: [
      { idx: 0, when: 10, tag: 'a' },
      { idx: 1, when: 20, tag: 'b' },
    ],
  }
  const sql = { a: 'CREATE TABLE a (\n  id text\n);\n', b: 'CREATE INDEX b ON a (id);' }
  const built = buildLineage(journal, (tag) => sql[tag])
  const crlf = (text) => sha256(text.replace(/\n/g, '\r\n'))

  it('are the journal’s, each with its SQL’s hash with either line ending, in order', () => {
    expect(built).toEqual([
      { createdAt: 10, hash: sha256(sql.a), lf: sha256(sql.a), crlf: crlf(sql.a) },
      { createdAt: 20, hash: sha256(sql.b), lf: sha256(sql.b), crlf: sha256(sql.b) },
    ])
    expect(() => buildLineage({ entries: [{ idx: 1, when: 1, tag: 'a' }] }, () => '')).toThrow(
      'out of order',
    )
    // A checkout that holds the files with CRLF carries the same two hashes for each.
    const fromCrlf = buildLineage(journal, (tag) => sql[tag].replace(/\n/g, '\r\n'))
    expect(fromCrlf.map(({ lf, crlf: other }) => [lf, other])).toEqual(
      built.map(({ lf, crlf: other }) => [lf, other]),
    )
  })

  it('fit a database that recorded them with either line ending, as the app’s start reads it', () => {
    const asLf = [
      { createdAt: 10, hash: sha256(sql.a) },
      { createdAt: 20, hash: sha256(sql.b) },
    ]
    const asCrlf = [{ createdAt: 10, hash: crlf(sql.a) }, asLf[1]]
    expect(lineageFits(asLf, built)).toBe(true)
    expect(lineageFits(asCrlf, built)).toBe(true)
    expect(lineageFits(asCrlf.slice(0, 1), built)).toBe(true)
    expect(recordedWith(asLf, built)).toEqual(['LF', 'either'])
    expect(recordedWith(asCrlf, built)).toEqual(['CRLF', 'either'])
  })

  it('do not fit a changed file, a moved time, or a migration the build does not carry', () => {
    const changed = [{ createdAt: 10, hash: sha256(`${sql.a} `) }]
    expect(lineageFits(changed, built)).toBe(false)
    expect(recordedWith(changed, built)).toEqual(['not this build’s'])
    expect(lineageFits([{ createdAt: 11, hash: sha256(sql.a) }], built)).toBe(false)
    const more = [...built, { createdAt: 30, hash: 'x' }].map(({ createdAt, hash }) => ({
      createdAt,
      hash,
    }))
    expect(lineageFits(more, built)).toBe(false)
    expect(recordedWith(more, built).at(-1)).toBe('not this build’s')
  })

  it('read the same way from the repository and from a database', () => {
    const real = JSON.parse(
      readFileSync(join(ROOT, 'apps/desktop/src/main/db/migrations/meta/_journal.json'), 'utf8'),
    )
    const lineage = buildLineage(real, (tag) =>
      readFileSync(join(ROOT, `apps/desktop/src/main/db/migrations/${tag}.sql`), 'utf8'),
    )
    expect(lineage.length).toBe(real.entries.length)
    const recorded = recordedLineage(
      lineage.map(({ createdAt, hash }) => ({ hash, created_at: String(createdAt) })),
    )
    expect(recorded).toEqual(lineage.map(({ createdAt, hash }) => ({ createdAt, hash })))
    expect(lineageFits(recorded, lineage)).toBe(true)
  })
})

describe('the state files a build copies', () => {
  it('are read from its registry, and include the drafts', () => {
    const names = stateFileNames(
      readFileSync(join(ROOT, 'apps/desktop/src/main/recovery/state-files.ts'), 'utf8'),
    )
    expect(names).toContain('drafts.json')
    expect(names).not.toContain('resources')
  })
})

describe('a start’s whole log', () => {
  const first = ['booting', CHECKPOINT_LINE, 'migrations', READY_LINE].join('\n')

  it('says one checked copy, then READY, on a first start, and READY alone on a second', () => {
    expect(startOrder(first, { checkpoint: true })).toEqual({ ready: 3, checkedCopy: 1 })
    expect(startOrder(`x\r\n${READY_LINE}\r\n`, { checkpoint: false }).checkedCopy).toBeNull()
  })

  it('fails a failed start, a recovery-only start, two READYs, and a copy in the wrong place', () => {
    expect(() => startOrder(`${FAIL_LINE}\nThe data is newer.`, { checkpoint: true })).toThrow(
      'The data is newer.',
    )
    expect(() => startOrder(`${RECOVERY_ONLY_LINE}\n${READY_LINE}`, { checkpoint: false })).toThrow(
      'recovery window',
    )
    expect(() => startOrder(`${READY_LINE}\n${CHECKPOINT_LINE}`, { checkpoint: true })).toThrow(
      'before READY',
    )
    expect(() => startOrder(first, { checkpoint: false })).toThrow('another recovery copy')
    expect(() => startOrder('nothing', { checkpoint: true })).toThrow('found 0')
  })

  it('fails what is said after READY: a second READY, a late copy, a late failure', () => {
    expect(() => startOrder(`${first}\nlater\n${READY_LINE}`, { checkpoint: true })).toThrow(
      'found 2',
    )
    expect(() => startOrder(`${first}\n${CHECKPOINT_LINE}`, { checkpoint: true })).toThrow(
      'found 2',
    )
    expect(() => startOrder(`${first}\n${FAIL_LINE}\nIt stopped.`, { checkpoint: true })).toThrow(
      'It stopped.',
    )
  })
})

describe('the rows the beta left', () => {
  const before = {
    provider_session: [{ id: 's1', status: 'idle', updated_at: 1, title: 'café ☕' }],
    events: [
      { id: 1, session_id: 's1', at: 100, payload: '{"text":"café ☕"}' },
      { id: 2, session_id: 's1', at: 101, payload: '{"text":"日本語"}' },
    ],
    raw_frame: [{ id: 1, session_id: 's1', bytes: new Uint8Array([1, 2, 3]) }],
  }
  const keys = { provider_session: ['id'], events: ['id'], raw_frame: ['id'] }

  it('are all there when nothing changed, and rows the candidate added are counted', () => {
    expect(rowsPreserved(before, copy(before))).toEqual({ lost: [], added: {} })
    const after = copy(before)
    after.events.push({ id: 3, session_id: 's1', at: 102, payload: '{}' })
    after.provider_session[0].status = 'closed'
    after.provider_session[0].updated_at = 9
    expect(rowsPreserved(before, after)).toEqual({ lost: [], added: { events: 1 } })
  })

  it('fail one changed byte, a moved timestamp and a changed title, naming the column', () => {
    const byte = copy(before)
    byte.raw_frame[0].bytes = new Uint8Array([1, 2, 4])
    expect(rowsPreserved(before, byte, undefined, keys).lost).toEqual([
      { table: 'raw_frame', row: '[1]', changed: ['bytes'] },
    ])
    const moved = copy(before)
    moved.events[0].at = 99
    expect(rowsPreserved(before, moved, undefined, keys).lost).toEqual([
      { table: 'events', row: '[1]', changed: ['at'] },
    ])
    const titled = copy(before)
    titled.provider_session[0].title = 'cafe'
    expect(rowsPreserved(before, titled, undefined, keys).lost).toEqual([
      { table: 'provider_session', row: '["s1"]', changed: ['title'] },
    ])
  })

  it('fail a lost row and a gone table', () => {
    const lost = copy(before)
    lost.events.pop()
    expect(rowsPreserved(before, lost, undefined, keys).lost).toEqual([
      { table: 'events', row: '[2]', gone: 'the row' },
    ])
    const gone = copy(before)
    delete gone.raw_frame
    expect(rowsPreserved(before, gone).lost).toEqual([{ table: 'raw_frame', gone: 'the table' }])
  })

  it('hold a candidate to every table but those a migration retires', () => {
    const gone = copy(before)
    delete gone.raw_frame
    expect(Object.keys(keptTables(before))).toEqual(['provider_session', 'events'])
    expect(rowsPreserved(keptTables(before), gone).lost).toEqual([])
    // ⚑ The control: a table that is not retired is still held, gone or not.
    delete gone.events
    expect(rowsPreserved(keptTables(before), gone).lost).toEqual([
      { table: 'events', gone: 'the table' },
    ])
  })

  it('count a duplicated row once: two equal rows need two', () => {
    const twice = { notes: [{ text: 'same' }, { text: 'same' }] }
    expect(rowsPreserved(twice, { notes: [{ text: 'same' }] }).lost).toHaveLength(1)
  })

  it('with no column allowed to move, fail a moved status: the rule for the recovery copy', () => {
    const after = copy(before)
    after.provider_session[0].status = 'closed'
    expect(rowsPreserved(before, after, {}, keys).lost).toEqual([
      { table: 'provider_session', row: '["s1"]', changed: ['status'] },
    ])
  })
})

describe('the rows the beta left, after its conversations carried on', () => {
  const ref = (sessionId) =>
    JSON.stringify({ provider: 'codex', sessionId, cwd: '/w', rotation: 0 })
  const before = {
    provider_session: [
      {
        id: 'a',
        status: 'idle',
        updated_at: 1,
        closed_by_the_quit_at: null,
        external_ref: ref('codex-a'),
        title: 'W1',
      },
      {
        id: 'b',
        status: 'idle',
        updated_at: 1,
        closed_by_the_quit_at: null,
        external_ref: ref('codex-b'),
        title: 'W2',
      },
    ],
    events: [{ id: 1, session_id: 'a' }],
  }
  const keys = { provider_session: ['id'], events: ['id'] }
  const history = [
    { conversation: 'a', codexSession: 'codex-a' },
    { conversation: 'b', codexSession: 'codex-b' },
  ]
  const carriedOn = () => {
    const after = copy(before)
    after.events.push({ id: 2, session_id: 'a' })
    Object.assign(after.provider_session[0], {
      status: 'closed',
      updated_at: 9,
      closed_by_the_quit_at: 9,
    })
    return after
  }

  it('are kept when only new rows came and a conversation’s own state moved', () => {
    const after = carriedOn()
    expect(rowsPreserved(before, after, undefined, keys)).toEqual({
      lost: [],
      added: { events: 1 },
    })
    expect(sessionsKept(history, after)).toEqual([])
  })

  it('are not kept when a row names another session, none, or changed a durable field', () => {
    const elsewhere = carriedOn()
    elsewhere.provider_session[1].external_ref = ref('codex-other')
    expect(rowsPreserved(before, elsewhere, undefined, keys).lost).toEqual([
      { table: 'provider_session', row: '["b"]', changed: ['external_ref'] },
    ])
    expect(sessionsKept(history, elsewhere)).toEqual([
      'b: its row no longer names the Codex session the beta recorded',
    ])
    const nowhere = carriedOn()
    nowhere.provider_session[1].external_ref = null
    expect(rowsPreserved(before, nowhere, undefined, keys).lost).toHaveLength(1)
    expect(sessionsKept(history, nowhere)).toHaveLength(1)
    const retitled = carriedOn()
    retitled.provider_session[1].title = 'something else'
    expect(rowsPreserved(before, retitled, undefined, keys).lost).toEqual([
      { table: 'provider_session', row: '["b"]', changed: ['title'] },
    ])
    expect(sessionsKept(history, { provider_session: [before.provider_session[0]] })).toEqual([
      'b: its row is gone',
    ])
  })
})

describe('the history the beta made', () => {
  const ref = (sessionId) => JSON.stringify({ provider: 'codex', sessionId, cwd: '/w' })
  const tables = {
    provider_session: [
      { id: 'a', external_ref: ref('codex-a') },
      { id: 'b', external_ref: ref('codex-b') },
    ],
    events: [
      { id: 1, session_id: 'a' },
      { id: 2, session_id: 'b' },
    ],
    provider_api_key: [{ provider: 'codex' }],
  }

  it('is each conversation’s own events and Codex session', () => {
    expect(historyOf(tables, ['a', 'b'])).toEqual([
      { conversation: 'a', events: 1, codexSession: 'codex-a' },
      { conversation: 'b', events: 1, codexSession: 'codex-b' },
    ])
  })

  it('is refused when one conversation has no events, though the other has many', () => {
    const onlyA = { ...tables, events: [tables.events[0], { id: 3, session_id: 'a' }] }
    expect(() => historyOf(onlyA, ['a', 'b'])).toThrow('no events for conversation b')
  })

  it('is refused with one conversation, a missing row, no saved key or no Codex session', () => {
    expect(() => historyOf(tables, ['a'])).toThrow('fewer than two')
    expect(() => historyOf(tables, ['a', 'c'])).toThrow('no row for conversation c')
    expect(() => historyOf({ ...tables, provider_api_key: [] }, ['a', 'b'])).toThrow(
      'no Codex API key',
    )
    // Another provider's key beside it is not the Codex one, and does not stand in for it.
    expect(() =>
      historyOf({ ...tables, provider_api_key: [{ provider: 'claude' }] }, ['a', 'b']),
    ).toThrow('no Codex API key')
    expect(() =>
      historyOf({ ...tables, provider_api_key: [{ provider: 'codex' }, { provider: 'claude' }] }, [
        'a',
        'b',
      ]),
    ).not.toThrow()
    const unnamed = copy(tables)
    unnamed.provider_session[1].external_ref = null
    expect(() => historyOf(unnamed, ['a', 'b'])).toThrow('names no Codex session')
  })

  it('has one transcript per conversation, by its Codex session, and ignores any other file', () => {
    const history = historyOf(tables, ['a', 'b'])
    const files = [
      'sessions/2026/10/07/rollout-2026-10-07T10-00-00-codex-a.jsonl',
      'sessions/2026/10/07/rollout-2026-10-07T10-01-00-codex-b.jsonl',
      'sessions/2026/10/07/rollout-2026-10-07T10-02-00-someone-else.jsonl',
    ]
    expect(transcriptsOf(history, files)).toEqual({ a: files[0], b: files[1] })
    // An unrelated file cannot stand in for the second conversation's, and two cannot be one.
    expect(() => transcriptsOf(history, [files[0], files[2]])).toThrow(
      'Conversation b has 0 Codex transcripts',
    )
    expect(() =>
      transcriptsOf(history, [...files, 'sessions/archived/rollout-x-codex-a.jsonl']),
    ).toThrow('Conversation a has 2 Codex transcripts')
  })
})

describe('what a newer build may do to what an older one wrote', () => {
  it('may add, and may not drop or change', () => {
    const was = { version: 1, names: ['a', 'b'], set: { on: false } }
    expect(contains(copy(was), was)).toBe(true)
    expect(contains({ ...was, savedAt: 5, names: ['z', 'a', 'm', 'b'] }, was)).toBe(true)
    expect(contains({ ...was, names: ['a'] }, was)).toBe(false)
    expect(contains({ version: 1 }, was)).toBe(false)
    expect(contains({ ...was, version: 2 }, was)).toBe(false)
    expect(contains({ ...was, set: { on: true } }, was)).toBe(false)
  })

  it('may not reorder a list, nor make two of its items one', () => {
    expect(contains(['b', 'a'], ['a', 'b'])).toBe(false)
    expect(contains(['a'], ['a', 'a'])).toBe(false)
    expect(contains(['a', 'x', 'a'], ['a', 'a'])).toBe(true)
  })
})

describe('the drafts the beta left, as the app reads them', () => {
  const draft = { slot: 'new', text: 'café ☕', attached: [] }
  const was = { version: 1, drafts: [draft] }

  it('are kept when rewritten as they were, with new fields or a draft for another slot', () => {
    expect(draftsKept(was, copy(was))).toEqual([])
    const more = {
      version: 1,
      savedBy: 'a newer build',
      drafts: [
        { slot: 'session:s1', text: 'another', attached: [] },
        { ...draft, seenAt: 5 },
      ],
    }
    expect(draftsKept(was, more)).toEqual([])
  })

  it('are not kept behind a wrong first draft for the same slot: the app reads the first', () => {
    const shadowed = { version: 1, drafts: [{ ...draft, text: 'wrong' }, draft] }
    expect(draftsKept(was, shadowed)).toEqual([
      'it holds two drafts for new, and the app reads only the first',
      'the draft for new changed',
    ])
    // Even with the right one first, a second draft for one slot is not what the beta left.
    expect(draftsKept(was, { version: 1, drafts: [draft, { ...draft, text: 'wrong' }] })).toEqual([
      'it holds two drafts for new, and the app reads only the first',
    ])
  })

  it('are not kept when one went, lost a word, lost an attached path, or the list went', () => {
    expect(draftsKept(was, { version: 1, drafts: [] })).toEqual(['the draft for new is gone'])
    expect(draftsKept(was, { version: 1, drafts: [{ ...draft, text: 'cafe' }] })).toEqual([
      'the draft for new changed',
    ])
    const attached = {
      version: 1,
      drafts: [{ ...draft, attached: [{ path: '/a', kind: 'file' }] }],
    }
    expect(draftsKept(attached, was)).toEqual(['the draft for new changed'])
    expect(draftsKept(was, { version: 1 })).toEqual(['it holds no list of drafts'])
    expect(draftsKept(was, { ...was, version: 2 })).toEqual(['its format version changed'])
  })
})

describe('the state files the beta left', () => {
  const names = ['drafts.json', 'workspace.json', 'archived.json']
  const drafts = { version: 1, drafts: [{ slot: 'new', text: 'café ☕', attached: [] }] }
  const before = {
    'drafts.json': Buffer.from(JSON.stringify(drafts)),
    'workspace.json': Buffer.from('{"name":"Fictional café lab"}'),
  }

  it('are kept when untouched, rewritten with all they said, or joined by a new one', () => {
    expect(stateKept(before, { ...before }, names)).toEqual({
      lost: [],
      rewritten: [],
      appeared: [],
    })
    const after = {
      'drafts.json': Buffer.from(JSON.stringify({ ...drafts, savedBy: 'a newer build' }, null, 2)),
      'workspace.json': Buffer.from('{"name":"Fictional café lab","renamedAt":5}'),
      'archived.json': Buffer.from('{"version":1,"archived":{}}'),
    }
    expect(stateKept(before, after, names)).toEqual({
      lost: [],
      rewritten: ['drafts.json', 'workspace.json'],
      appeared: ['archived.json'],
    })
  })

  it('are lost when one went, changed a word, or stopped being readable', () => {
    const gone = stateKept(before, { 'drafts.json': before['drafts.json'] }, names)
    expect(gone.lost).toEqual(['workspace.json: it is gone'])
    const renamed = { ...before, 'workspace.json': Buffer.from('{"name":"Default"}') }
    expect(stateKept(before, renamed, names).lost).toEqual([
      'workspace.json: it no longer says what the beta wrote',
    ])
    const unreadable = { ...before, 'drafts.json': Buffer.from('not json') }
    expect(stateKept(before, unreadable, names).lost).toEqual([
      'drafts.json: it no longer says what the beta wrote',
    ])
  })

  it('hold the drafts file to the drafts’ own rule, not to what it still contains', () => {
    const [draft] = drafts.drafts
    const shadowed = { version: 1, drafts: [{ ...draft, text: 'wrong' }, draft] }
    const after = { ...before, 'drafts.json': Buffer.from(JSON.stringify(shadowed)) }
    expect(stateKept(before, after, names).lost).toEqual([
      'drafts.json: it holds two drafts for new, and the app reads only the first; the draft for new changed',
    ])
  })
})

describe('the transcript retention choice and mutable cleanup progress', () => {
  const name = 'transcript-retention.json'
  const earlier = {
    period: 90,
    checkedAt: 10,
    cleared: [{ at: 10, days: 90, conversations: 2, bytes: 40 }],
  }
  const next = {
    period: 90,
    checkedAt: 20,
    scanAfter: 'default/orchard/codex/sessions/2026/01/kept.jsonl',
    cleared: [{ at: 20, days: 90, conversations: 0, bytes: 0, stoppedEarly: true }],
  }
  const check = (after, before = earlier) =>
    stateKept(
      { [name]: Buffer.from(JSON.stringify(before)) },
      { [name]: Buffer.from(JSON.stringify(after)) },
      [name],
    )
  it('accepts a new check, cursor and bounded history while keeping the exact choice', () => {
    expect(check(next)).toEqual({ lost: [], rewritten: [name], appeared: [] })
    expect(
      check({
        ...next,
        scanAfter: '',
        cleared: Array.from({ length: 100 }, (_, i) => ({
          at: i,
          days: 30,
          conversations: 1,
          bytes: 20,
        })),
      }).lost,
    ).toEqual([])
    for (const period of [30, 90, 365, 'forever'])
      expect(check({ ...next, period }, { ...earlier, period }).lost).toEqual([])
  })
  it.each([30, 365, 'forever', '90', null])(
    'refuses changing the person’s choice to %s',
    (period) => {
      expect(check({ ...next, period }).lost).toEqual([
        `${name}: its transcript retention choice changed`,
      ])
    },
  )
  it.each([
    { checkedAt: -1 },
    { checkedAt: '20' },
    { checkedAt: null },
    { scanAfter: 7 },
    { scanAfter: null },
    { scanAfter: '/outside' },
    { scanAfter: '../outside' },
    { scanAfter: 'default/../outside' },
    { scanAfter: 'default/./outside' },
    { scanAfter: 'default\\outside' },
    { scanAfter: 'x'.repeat(4097) },
  ])('refuses invalid progress %j', (changed) => {
    expect(check({ ...next, ...changed }).lost).toEqual([
      `${name}: its transcript cleanup progress is invalid`,
    ])
  })
  it.each(
    [
      null,
      {},
      Array(101).fill(next.cleared[0]),
      [null],
      [{ at: 20, days: 90, conversations: 0, bytes: 0 }],
      [{ at: 20, days: -1, conversations: 1, bytes: 20 }],
      [{ at: 20, days: 90, conversations: 1, bytes: -1 }],
      [{ at: 20, days: 90, conversations: 1.5, bytes: 20 }],
      [{ at: 20, days: 90, conversations: 1, bytes: 20, stoppedEarly: false }],
    ].map((cleared) => [cleared]),
  )('refuses invalid history %j', (cleared) => {
    expect(check({ ...next, cleared }).lost).toEqual([
      `${name}: its transcript cleanup history is invalid`,
    ])
  })
  it('refuses a file larger than the app can read, even if its parsed fields are valid', () => {
    const before = { [name]: Buffer.from(JSON.stringify(earlier)) }
    const after = { [name]: Buffer.from(JSON.stringify(next) + ' '.repeat(65536)) }
    expect(stateKept(before, after, [name]).lost).toEqual([
      `${name}: its transcript cleanup progress is invalid`,
    ])
  })
  it('still refuses a missing or unreadable retention file', () => {
    const before = { [name]: Buffer.from(JSON.stringify(earlier)) }
    expect(stateKept(before, {}, [name]).lost).toEqual([`${name}: it is gone`])
    expect(stateKept(before, { [name]: Buffer.from('unreadable') }, [name]).lost).toHaveLength(1)
  })
})

describe('the computer’s list of workspaces', () => {
  const before = {
    version: 1,
    workspaces: [
      { path: '/data/desktop', lastOpenedAt: 10 },
      { path: '/other', lastOpenedAt: 5, note: 'unopened' },
    ],
  }

  it('is kept when only an opening time moved forward, or a workspace was added', () => {
    const after = copy(before)
    after.workspaces[0].lastOpenedAt = 99
    after.workspaces.push({ path: '/new', lastOpenedAt: 100 })
    expect(registryKept(before, after)).toEqual([])
  })

  it('is not kept when a workspace left it, changed, went back in time, or the list went', () => {
    const dropped = { ...before, workspaces: before.workspaces.slice(0, 1) }
    expect(registryKept(before, dropped)).toEqual(['/other: no longer listed'])
    const changed = copy(before)
    changed.workspaces[1].note = 'opened'
    expect(registryKept(before, changed)).toEqual(['/other: its row changed'])
    const earlier = copy(before)
    earlier.workspaces[0].lastOpenedAt = 1
    expect(registryKept(before, earlier)).toEqual([
      '/data/desktop: its last opening moved backwards',
    ])
    expect(registryKept(before, null)).toEqual(['the list of workspaces is gone or unreadable'])
    expect(registryKept(before, { ...before, version: 2 })).toEqual(['its format version changed'])
    expect(registryKept(null, before)).toEqual(['the beta left no list of workspaces'])
    const twice = { ...before, workspaces: [...before.workspaces, before.workspaces[1]] }
    expect(registryKept(before, twice)).toEqual(['/other: listed more than once'])
  })
})

describe('what the candidate says of the agents it runs', () => {
  const AT = 1_791_400_000_000
  const figure = { running: 1, rssBytes: 210_000_000, cpuPercent: 1.5, at: AT }
  const none = (reason) => ({ running: 1, rssBytes: null, cpuPercent: null, at: AT, reason })
  const read = (codex, memory) => ({
    resources: { claude: { running: 0, rssBytes: 0, cpuPercent: 0, at: AT }, codex },
    memory,
  })
  const drawn = { conversations: [{ conversation: 'sess_1', bytes: 190_000_000 }] }
  const NOT_LISTED = 'This computer did not list its processes just now.'

  it('🔴 a figure in both answers passes', () => {
    expect(whatRunsIsSaid(read(figure, drawn))).toEqual({ outcome: 'measured', ok: true })
  })

  it.each([
    ['a plain one', 'BroCrew can’t measure its agents’ memory and CPU on Windows yet.'],
    ['a promise to ask again', `${NOT_LISTED.slice(0, -1)}; it is asked again in a moment.`],
    ['none', undefined],
  ])('⛔ no figure fails on either system, whatever its reason: %s', (_, reason) => {
    const said = read(none(reason), { conversations: [], unmeasured: reason })
    expect(whatRunsIsSaid(said)).toEqual({ outcome: 'no-figure', ok: false })
  })

  it.each([
    ['list no conversation', { conversations: [] }],
    ['say they could not measure', { ...drawn, unmeasured: NOT_LISTED }],
    ['carry an empty figure', { conversations: [{ conversation: 'sess_1', bytes: 0 }] }],
    ['were not read', null],
  ])('⛔ a figure on Providers and cards that %s fail', (_, memory) => {
    expect(whatRunsIsSaid(read(figure, memory))).toEqual({
      outcome: 'measured-on-one-and-not-the-other',
      ok: false,
    })
  })

  it('⚑ a run with nothing running says what it did not show', () => {
    expect(resultLine({ failures: [], knownLimits: [NOTHING_RAN_LIMIT] })).toBe(
      `passed with a known limit: ${NOTHING_RAN_LIMIT}`,
    )
    expect(NOTHING_RAN_LIMIT).toContain('does not show')
  })

  it('⚑ nothing running is said and passes; answers that were not read fail', () => {
    const idle = read({ running: 0, rssBytes: 0, cpuPercent: 0, at: AT }, { conversations: [] })
    expect(whatRunsIsSaid(idle)).toEqual({ outcome: 'nothing-was-running', ok: true })
    for (const unread of [null, {}, { resources: {} }, read({ running: '1' }, drawn)]) {
      expect(whatRunsIsSaid(unread)).toEqual({ outcome: 'not-read', ok: false })
    }
  })
})

describe('a turn on the saved key after the upgrade', () => {
  const post = (auth) => ({ method: 'POST', auth })
  const answered = {
    answer: 'resp_1',
    refused: null,
    refusedAt: null,
    refusedAfterMs: null,
    requests: [post('expected')],
  }
  const notHandedOver = {
    answer: null,
    refused:
      "Error invoking remote method 'runtime:command': Error: BroCrew can’t read the API key saved for Codex on this computer. macOS may be waiting for permission to read its saved key.",
    refusedAt: 'start',
    refusedAfterMs: 12_100,
    requests: [],
  }
  const inUse = { set: true, inUse: true }
  const unreadable = { set: true, inUse: false, readState: 'unreadable' }

  it('passes anywhere when the model answered it on the fixture key', () => {
    for (const os of ['windows', 'mac']) {
      expect(turnOutcome(answered, os, inUse)).toEqual({ outcome: 'answered', ok: true })
    }
  })

  it('fails when any request reached the model with another key or none, answered or not', () => {
    for (const auth of ['other', 'missing']) {
      const turn = { ...answered, requests: [post('expected'), post(auth)] }
      expect(turnOutcome(turn, 'mac', inUse)).toEqual({
        outcome: 'asked-the-model-without-the-key',
        ok: false,
      })
    }
    // The model said the key was wrong: words about an API key, but not macOS withholding ours.
    const wrongKey = {
      ...notHandedOver,
      refused: 'Invalid API key',
      refusedAt: 'send',
      refusedAfterMs: 1_000,
      requests: [post('other')],
    }
    expect(turnOutcome(wrongKey, 'mac', unreadable)).toEqual({
      outcome: 'asked-the-model-without-the-key',
      ok: false,
    })
    expect(turnOutcome({ ...answered, requests: [] }, 'windows', inUse)).toEqual({
      outcome: 'answered-without-asking-the-model',
      ok: false,
    })
    expect(turnOutcome({ ...answered, answer: null }, 'mac', inUse)).toEqual({
      outcome: 'not-answered',
      ok: false,
    })
  })

  it('on a Mac, passes a start the app refused because macOS did not hand the key over', () => {
    expect(turnOutcome(notHandedOver, 'mac', unreadable)).toEqual({
      outcome: 'the-saved-key-was-not-handed-over',
      ok: true,
    })
  })

  it('fails that refusal on Windows, and on a Mac whenever one part of it is missing', () => {
    expect(turnOutcome(notHandedOver, 'windows', unreadable)).toEqual({
      outcome: 'the-saved-key-was-not-handed-over',
      ok: false,
    })
    const not = (turn, status = unreadable) =>
      expect(turnOutcome(turn, 'mac', status)).toEqual({ outcome: 'refused', ok: false })
    // The message was refused, not the start.
    not({ ...notHandedOver, refusedAt: 'send' })
    // Too slow to be the bounded wait.
    not({ ...notHandedOver, refusedAfterMs: 61_000 })
    // Other words, even ones that mention an API key.
    not({ ...notHandedOver, refused: 'Invalid API key' })
    not({ ...notHandedOver, refused: 'unknown session' })
    // The app's own status does not say the key is unreadable.
    not(notHandedOver, inUse)
    not(notHandedOver, { set: true, inUse: false, readState: 'not-checked' })
    not(notHandedOver, null)
  })
})

describe('how the app closed, from its own log', () => {
  it('is by itself, or by its last-resort stop after the time it says', () => {
    expect(
      lastResortStop("BroCrew shut down in 8ms\nBroCrew reached Electron's quit at +138ms\n"),
    ).toBeNull()
    expect(
      lastResortStop(
        'BroCrew asked Electron to exit 2000ms ago and is still running; everything of ours is closed, so it is being stopped now',
      ),
    ).toBe(2000)
  })
})

describe('a run’s result', () => {
  const summary = {
    os: 'mac',
    betaTag: 'mac-beta-1',
    candidateVersion: '0.1.0',
    sourceSha: '8b3e150f306bd21a9038bd3ca19b44e0de00181c',
    outsideThisCheck: ['the in-app update buttons'],
    checks: [
      { name: 'a', ok: true },
      { name: 'b', ok: true },
    ],
    failures: [],
    knownLimits: [],
  }

  it('is passed, failed, or passed with the limit it passed with, never a bare pass then', () => {
    expect(resultLine(summary)).toBe('passed')
    expect(resultLine({ ...summary, knownLimits: [SAVED_KEY_LIMIT] })).toBe(
      `passed with a known limit: ${SAVED_KEY_LIMIT}`,
    )
    // A failure outranks a limit: a run that failed did not pass with anything.
    expect(resultLine({ failures: ['x', 'y'], knownLimits: [SAVED_KEY_LIMIT] })).toBe(
      'failed: 2 check(s) did not hold',
    )
    expect(resultLine({ failures: [], knownLimits: [SAVED_KEY_LIMIT, CLOSE_LIMIT] })).toBe(
      `passed with a known limit: ${SAVED_KEY_LIMIT}; ${CLOSE_LIMIT}`,
    )
    // The limit says what was seen and what was not shown, and promises no remedy.
    expect(SAVED_KEY_LIMIT).toContain('macOS did not hand over the saved key')
    expect(SAVED_KEY_LIMIT).toContain('does not show the key working')
  })

  it('is the first thing its job’s summary says, with the limit, the key and what it left out', () => {
    const limited = { ...summary, knownLimits: [SAVED_KEY_LIMIT] }
    const said = jobSummary({
      ...limited,
      result: resultLine(limited),
      savedKeyAfterTheUpgrade: 'not handed over: BroCrew can’t read the API key',
      checkpoint: { id: 'c1', reason: 'first-start-of-release', madeBy: { appVersion: '0.1.0' } },
      baseline: { copies: [{ folder: 'b1', madeBy: { appVersion: '0.0.0', build: 'beta' } }] },
    })
    const lines = said.split('\n')
    expect(lines[0]).toBe('### Upgrade path · mac · mac-beta-1 → 0.1.0 (8b3e150f3)')
    expect(lines[2]).toBe(`**Passed with a known limit: ${SAVED_KEY_LIMIT}.**`)
    expect(said).toContain('- Checks: 2 held, 0 did not.')
    expect(said).toContain('- The saved key after the upgrade: not handed over')
    expect(said).toContain('- Recovery copies the beta left: 1, made by 0.0.0.')
    expect(said).toContain('- Recovery copy: c1 (first-start-of-release), made by 0.1.0.')
    expect(said.indexOf('the beta left: 1')).toBeLessThan(said.indexOf('Recovery copy: c1'))
    expect(said).toContain('- the in-app update buttons')
    expect(said).not.toContain('setup at launch')
  })

  it('says what was due of the app’s setup at launch, at each start', () => {
    const said = jobSummary({
      ...summary,
      result: resultLine(summary),
      firstStart: { launchSetup: { due: 'claude', dismissed: false } },
      secondStart: { launchSetup: { due: null, dismissed: true } },
    })
    expect(said).toContain(
      "- The app's setup at launch: first start, due for claude, which is not ready on this computer; second start, none due: a person closed it before.",
    )
    expect(
      jobSummary({
        ...summary,
        result: resultLine(summary),
        firstStart: { launchSetup: { due: null, dismissed: false } },
      }),
    ).toContain("- The app's setup at launch: first start, none due: every provider is ready.")
  })

  it('names each check that did not hold, when it failed before any copy or turn', () => {
    const failed = {
      ...summary,
      failures: ['the start did not fail'],
      checks: [{ name: 'a', ok: false }],
    }
    const said = jobSummary({ ...failed, result: resultLine(failed) })
    expect(said).toContain('**Failed: 1 check(s) did not hold.**')
    expect(said).toContain('- Did not hold: the start did not fail')
    expect(said).not.toContain('Recovery copy')
    expect(said).not.toContain('Recovery copies')
  })

  it('says the beta left no recovery copy when it predates them', () => {
    const said = jobSummary({ ...summary, result: resultLine(summary), baseline: { copies: [] } })
    expect(said).toContain('- Recovery copies the beta left: none.')
  })
})

describe('the app’s setup at launch, as the check expects it', () => {
  const installed = (standing) => ({ version: '2.1.0', program: { from: 'found', standing } })
  const carried = { version: '0.133.0', program: { from: 'carried', standing: 'tested' } }
  const install = { tool: 'Claude Code', install: null, signInCommand: 'claude', platform: 'macOS' }
  const account = { state: 'usable', login: 'account' }
  const onAKey = { state: 'usable', login: 'api-key' }
  const claude = (over = {}) => ({
    provider: 'claude',
    version: installed('tested'),
    setup: install,
    auth: account,
    keyRefused: false,
    ...over,
  })
  const codex = (over = {}) => ({
    provider: 'codex',
    version: carried,
    setup: null,
    auth: onAKey,
    keyRefused: false,
    ...over,
  })

  it('asks about the app’s own providers in its order, and stops on the standings the app warns of', () => {
    const shared = readFileSync(join(ROOT, 'apps/desktop/src/shared/runtime-ipc.ts'), 'utf8')
    const names = /export const PROVIDER_NAME: Record<Provider, string> = \{([^}]*)\}/.exec(shared)
    expect(names, 'PROVIDER_NAME is no longer where this reads it').not.toBeNull()
    expect(
      [...names[1].matchAll(/(\w+): '([^']+)'/g)].map(([, provider, name]) => ({ provider, name })),
    ).toEqual(LAUNCH_SETUP_PROVIDERS)
    const warns = /export const A_STANDING_WARNS:[^=]*= \{([^}]*)\}/.exec(shared)
    expect(warns, 'A_STANDING_WARNS is no longer where this reads it').not.toBeNull()
    expect(
      Object.fromEntries(
        [...warns[1].matchAll(/'?([\w-]+)'?: (true|false)/g)].map(([, standing, stops]) => [
          standing,
          stops === 'true',
        ]),
      ),
    ).toEqual(A_STANDING_STOPS_SETUP)
  })

  it('counts a provider ready on a program that runs and a usable sign-in, with no refused key', () => {
    expect(providerReady(claude())).toBe(true)
    expect(providerReady(claude({ version: installed('newer-than-tested') }))).toBe(true)
    expect(providerReady(codex())).toBe(true)
    // A program the app carries, or nothing to set up outside the app, has no install to pass.
    expect(providerReady(codex({ setup: undefined }))).toBe(true)
    expect(providerReady(claude({ setup: null, version: installed('missing') }))).toBe(true)
  })

  it('counts it not ready on a missing, unread, old or unreadable program, whatever its sign-in', () => {
    for (const version of [
      installed('missing'),
      installed('older-than-tested'),
      installed('unreadable'),
      { version: null, reason: 'could not look' },
    ]) {
      expect(providerReady(claude({ version })), JSON.stringify(version)).toBe(false)
      expect(providerReady(claude({ version, auth: null })), JSON.stringify(version)).toBe(false)
    }
  })

  it('counts it not ready on a sign-in that is absent, stale or unread, or a key that was refused', () => {
    for (const auth of [
      { state: 'absent' },
      { state: 'absent', why: 'unreadable' },
      { state: 'stale' },
      { state: 'unknown', reason: 'could not ask' },
    ]) {
      expect(providerReady(codex({ auth })), JSON.stringify(auth)).toBe(false)
    }
    expect(providerReady(codex({ keyRefused: true }))).toBe(false)
    // A refused key matters only to a sign-in that is the key.
    expect(providerReady(claude({ keyRefused: true }))).toBe(true)
  })

  it('is undecided while a fact it needs has not been read', () => {
    expect(providerReady(codex({ auth: null }))).toBeNull()
    expect(providerReady(claude({ version: null }))).toBeNull()
    expect(providerReady(claude({ auth: null }))).toBeNull()
  })

  it('opens for the first provider that is not ready, and for none once a person closed it', () => {
    const missing = claude({ version: installed('missing'), auth: { state: 'absent' } })
    const signedOut = codex({ auth: { state: 'absent' } })
    expect(launchSetupExpected(false, [missing, codex()])).toEqual({
      opens: { provider: 'claude', name: 'Claude' },
      ready: [
        { provider: 'claude', ready: false },
        { provider: 'codex', ready: true },
      ],
      undecided: false,
    })
    expect(launchSetupExpected(false, [missing, signedOut]).opens?.provider).toBe('claude')
    expect(launchSetupExpected(false, [claude(), signedOut]).opens).toEqual({
      provider: 'codex',
      name: 'Codex',
    })
    expect(launchSetupExpected(false, [claude(), codex()]).opens).toBeNull()
    // Closed before: nothing opens, and what is ready is still said.
    expect(launchSetupExpected(true, [missing, signedOut])).toMatchObject({
      opens: null,
      undecided: false,
      ready: [
        { provider: 'claude', ready: false },
        { provider: 'codex', ready: false },
      ],
    })
    // The app opens nothing until every provider's readiness is known.
    expect(launchSetupExpected(false, [missing, codex({ auth: null })])).toMatchObject({
      opens: null,
      undecided: true,
    })
  })

  it('holds the window to exactly that setup, or to no dialog at all', () => {
    const forClaude = {
      label: 'Set up Claude',
      provider: 'claude',
      step: 'install',
      kind: 'missing',
    }
    const due = { provider: 'claude', name: 'Claude' }
    expect(dialogsAreAsDue([forClaude], due)).toBe(true)
    expect(dialogsAreAsDue([], null)).toBe(true)
    // Not open when due, open when not due, another provider's, another dialog, or one beside it.
    expect(dialogsAreAsDue([], due)).toBe(false)
    expect(dialogsAreAsDue([forClaude], null)).toBe(false)
    expect(dialogsAreAsDue([{ ...forClaude, label: 'Set up Codex', provider: 'codex' }], due)).toBe(
      false,
    )
    expect(dialogsAreAsDue([{ label: 'Set up Claude', provider: null }], due)).toBe(false)
    expect(dialogsAreAsDue([{ label: 'Delete this conversation?', provider: null }], null)).toBe(
      false,
    )
    expect(dialogsAreAsDue([forClaude, { label: 'What’s new', provider: null }], due)).toBe(false)
  })
})

describe('the key a request to the model carried', () => {
  it('is the fixture’s only when the whole header is', () => {
    expect(credentialSeen('Bearer sk-fixture', 'sk-fixture')).toBe('expected')
    expect(credentialSeen('Bearer sk-other', 'sk-fixture')).toBe('other')
    expect(credentialSeen('Bearer sk-fixture-and-more', 'sk-fixture')).toBe('other')
    expect(credentialSeen('sk-fixture', 'sk-fixture')).toBe('other')
    expect(credentialSeen(undefined, 'sk-fixture')).toBe('missing')
    expect(credentialSeen('  ', 'sk-fixture')).toBe('missing')
  })
})

describe('the candidate’s first recovery copy', () => {
  const database = Buffer.from('the beta database')
  const drafts = Buffer.from('{"version":1,"drafts":[]}')
  const lineage = [{ createdAt: 1, hash: 'h1' }]
  const id = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
  const workspaceId = '9a8b7c6d-1e2f-4a3b-8c4d-5e6f7a8b9c0d'
  const manifest = {
    format: 'brobot-checkpoint',
    version: 1,
    id,
    workspaceId,
    createdAt: '2026-10-07T12:00:00.000Z',
    reason: 'first-start-of-release',
    madeBy: { appVersion: '0.1.0', build: 'abc' },
    database: {
      file: 'database.sqlite',
      bytes: database.length,
      sha256: sha256(database),
      migrations: lineage,
    },
    files: [
      { name: 'drafts.json', present: true, bytes: drafts.length, sha256: sha256(drafts) },
      { name: 'workspace.json', present: false },
    ],
  }
  const expected = {
    folder: id,
    workspaceId,
    reason: 'first-start-of-release',
    version: '0.1.0',
    build: 'abc',
    lineage,
    stateFiles: ['drafts.json', 'workspace.json'],
    state: { 'drafts.json': drafts },
  }
  const files = { 'database.sqlite': database, 'drafts.json': drafts }
  const fails = (words, change = {}, shape = (m) => m, onFiles = files) =>
    expect(() =>
      verifyCheckpoint(shape(copy(manifest)), onFiles, { ...expected, ...change }),
    ).toThrow(words)

  it('is the candidate’s, for this workspace and this start, of exactly what the beta left', () => {
    expect(verifyCheckpoint(manifest, files, expected)).toEqual({
      id,
      workspaceId,
      reason: 'first-start-of-release',
      madeBy: { appVersion: '0.1.0', build: 'abc' },
    })
  })

  it('fails a copy for no workspace, for another one, or kept in a folder of another name', () => {
    fails('not this one', {}, (m) => ({ ...m, workspaceId: undefined }))
    fails('not this one', { workspaceId: '0a0b0c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d' })
    fails('not this one', { workspaceId: null })
    fails('says it is', { folder: '2c5e28ba-2fa1-41d2-883f-0016d3cca427' })
  })

  it('fails another maker, another reason and another lineage', () => {
    fails('not the candidate', { version: '0.0.0' })
    fails('not the candidate', { build: 'other' })
    fails('not before-migration', { reason: 'before-migration' })
    fails('lineage', { lineage: [{ createdAt: 1, hash: 'h2' }] })
  })

  it('fails a changed database, a changed draft, a missing entry and a file listed absent', () => {
    fails('is not the one its manifest describes', {}, (m) => m, {
      ...files,
      'database.sqlite': Buffer.from('the beta databasE'),
    })
    fails('changed drafts.json', { state: { 'drafts.json': Buffer.from('other') } })
    fails('registry is', {}, (m) => ({ ...m, files: m.files.slice(0, 1) }))
    fails('listed absent', {}, (m) => m, { ...files, 'workspace.json': Buffer.from('{}') })
    fails('the beta left it present', {
      state: { 'drafts.json': drafts, 'workspace.json': drafts },
    })
  })
})

describe('the recovery copies, told apart by the version that made each', () => {
  const copy = (folder, appVersion, digest = `bytes of ${folder}`) => ({
    folder,
    manifest: appVersion === undefined ? null : { madeBy: { appVersion, build: 'b' } },
    digest,
  })
  const beta = copy('b1', '0.0.0')
  const none = { made: [], others: [], unread: [], gone: [], changed: [] }

  it('finds the candidate’s one copy beside the one the beta left, which stays as it was', () => {
    const candidate = copy('c1', '0.1.0')
    expect(copiesSince([beta], [beta, candidate], '0.1.0')).toEqual({
      ...none,
      made: ['c1'],
      same: false,
    })
    // Listed in any order: a folder is found by its name, not its place.
    expect(copiesSince([beta], [candidate, beta], '0.1.0').made).toEqual(['c1'])
  })

  it('reads the copies the beta left as the beta’s, by its own version', () => {
    expect(copiesSince([], [beta], '0.0.0')).toEqual({ ...none, made: ['b1'], same: false })
    expect(copiesSince([], [], '0.0.0')).toEqual({ ...none, same: true })
  })

  it('counts every copy the version made, so two are not taken for one', () => {
    expect(
      copiesSince([beta], [beta, copy('c1', '0.1.0'), copy('c2', '0.1.0')], '0.1.0').made,
    ).toEqual(['c1', 'c2'])
  })

  it('keeps apart a copy another version made and one that names no version', () => {
    const since = copiesSince(
      [beta],
      [
        beta,
        copy('c1', '0.1.0'),
        copy('o1', '0.0.9'),
        copy('u1'),
        { folder: 'u2', manifest: { madeBy: { appVersion: '' } }, digest: 'x' },
        { folder: 'u3', manifest: { madeBy: null }, digest: 'x' },
      ],
      '0.1.0',
    )
    expect(since).toEqual({
      ...none,
      made: ['c1'],
      others: ['o1'],
      unread: ['u1', 'u2', 'u3'],
      same: false,
    })
  })

  it('finds a copy that went, one whose bytes changed and one that can no longer be read', () => {
    const kept = copy('k1', '0.1.0')
    const before = [beta, kept, copy('g1', '0.1.0')]
    expect(
      copiesSince(
        before,
        [
          { ...beta, digest: 'other bytes' },
          { ...kept, digest: null },
        ],
        '0.1.0',
      ),
    ).toEqual({ ...none, gone: ['g1'], changed: ['b1', 'k1'], same: false })
  })

  it('is the same only when nothing came, went or changed', () => {
    const before = [beta, copy('c1', '0.1.0')]
    expect(
      copiesSince(
        before,
        before.map((one) => ({ ...one })),
        '0.1.0',
      ),
    ).toEqual({
      ...none,
      same: true,
    })
    // A copy that could not be read before and still cannot is not the same: nothing says it is.
    const unreadable = [{ ...beta, digest: null }]
    expect(copiesSince(unreadable, unreadable, '0.1.0').same).toBe(false)
  })
})

describe('the Keychain entry a Mac seals saved keys with', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'apps/desktop/package.json'), 'utf8'))
  // What `security find-generic-password -s <service>` prints when asked for no password.
  const printed = (service, account) =>
    [
      'keychain: "/Users/runner/Library/Keychains/login.keychain-db"',
      'version: 512',
      'class: "genp"',
      'attributes:',
      `    0x00000007 <blob>="${service}"`,
      '    0x00000008 <blob>=<NULL>',
      `    "acct"<blob>="${account}"`,
      '    "cdat"<timedate>=0x32303236313030383031323334355A00  "20261008012345Z\\000"',
      '    "crtr"<uint32>=<NULL>',
      '    "mdat"<timedate>=0x32303236313030383031323334365A00  "20261008012346Z\\000"',
      `    "svce"<blob>="${service}"`,
      '    "type"<uint32>=<NULL>',
    ].join('\n')

  it('is named after the app, which the candidate reads from the package: no name is set', () => {
    const runner = readFileSync(join(ROOT, 'scripts/upgrade-path.mjs'), 'utf8')
    expect(runner).toContain("join(REPO, 'apps', 'desktop', 'package.json')")
    expect(pkg.productName).toBeUndefined()
    // The name every build so far has had, as a runner's Keychain listed the entry a beta made.
    expect(APP_NAMES_BEFORE).toEqual([pkg.name])
    expect(keychainEntryFor(APP_NAMES_BEFORE[0])).toEqual({
      service: '@brobot2/desktop Safe Storage',
      account: '@brobot2/desktop Key',
    })
  })

  it('is described by its attributes only: its service, account and dates', () => {
    expect(
      keychainAttributes(printed('@brobot2/desktop Safe Storage', '@brobot2/desktop Key')),
    ).toEqual({
      service: '@brobot2/desktop Safe Storage',
      account: '@brobot2/desktop Key',
      created: '20261008012345Z',
      modified: '20261008012346Z',
    })
    // Nothing found, or something that is no entry: no description, never a guess.
    expect(
      keychainAttributes(
        'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.',
      ),
    ).toBeNull()
    expect(keychainAttributes('    "svce"<blob>="@brobot2/desktop Safe Storage"')).toBeNull()
    expect(keychainAttributes('')).toBeNull()
  })

  it('is asked of `security` with no password: the check never passes -w or -g', () => {
    const runner = readFileSync(join(ROOT, 'scripts/upgrade-path.mjs'), 'utf8')
    const asked = [...runner.matchAll(/spawnSync\('\/usr\/bin\/security', \[([^\]]*)\]/g)].map(
      ([, argv]) => argv,
    )
    // The second forgets the beta's entry before the Mac's new Claude start; it reads no secret.
    expect(asked).toEqual([
      "'find-generic-password', '-s', service",
      "'delete-generic-password', '-s', service, '-a', account",
    ])
  })
})

describe('the scripted Claude model the runner’s Claude Code is sent to', () => {
  it('is named to Claude Code in its managed settings, on loopback, and nothing else is reached', () => {
    expect(managedSettingsFor(9360)).toEqual({
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:9360',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        DISABLE_AUTOUPDATER: '1',
      },
    })
    expect(() => managedSettingsFor(Number.NaN)).toThrow()
    expect(MANAGED_SETTINGS_PATH.mac).toBe(
      '/Library/Application Support/ClaudeCode/managed-settings.json',
    )
    expect(MANAGED_SETTINGS_PATH.windows).toBe(
      'C:\\Program Files\\ClaudeCode\\managed-settings.json',
    )
    // The workflow installs the version the scheduling shapes were measured on.
    const workflow = readFileSync(join(ROOT, '.github/workflows/upgrade-path.yml'), 'utf8')
    expect(workflow).toContain('node scripts/lib/scripted-claude.mjs version')
    expect(CLAUDE_CODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('answers only the fixture key, by either header Claude Code may send it in', () => {
    expect(claudeKeySeen({ 'x-api-key': CLAUDE_FIXTURE_KEY })).toBe('expected')
    expect(claudeKeySeen({ authorization: `Bearer ${CLAUDE_FIXTURE_KEY}` })).toBe('expected')
    expect(claudeKeySeen({ 'x-api-key': 'sk-ant-another' })).toBe('other')
    expect(claudeKeySeen({})).toBe('none')
  })

  it('reads what a request already answered and what a person asked, wherever it sits', () => {
    const body = {
      tools: [{ name: 'CronCreate' }],
      messages: [
        { role: 'user', content: 'first words' },
        { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_a' }] },
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_a', content: 'ok' },
            { type: 'text', text: 'next words' },
          ],
        },
      ],
    }
    expect([...toolResultsIn(body)]).toEqual(['toolu_a'])
    expect(userTextsIn(body)).toEqual(['first words', 'next words'])
    expect(offersTool(body, 'CronCreate')).toBe(true)
    expect(offersTool(body, 'CronDelete')).toBe(false)
    expect([...toolResultsIn(null)]).toEqual([])
  })

  it('schedules a one-shot for a local minute, as CronCreate takes it', () => {
    expect(oneShotCron(new Date(2026, 9, 8, 17, 31))).toBe('31 17 8 10 *')
  })

  it('streams an answer or a tool call in the Messages API’s event order', () => {
    const text = anthropicEvents('m', { kind: 'text', text: 'hi' }, 'msg_1').map((one) => one.type)
    expect(text).toEqual([
      'message_start',
      'content_block_start',
      'content_block_delta',
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])
    const call = anthropicEvents(
      'm',
      { kind: 'tool_use', id: 'toolu_x', name: 'CronCreate', input: { cron: '1 2 3 4 *' } },
      'msg_2',
    )
    expect(call.at(-2).delta.stop_reason).toBe('tool_use')
    expect(call[2].delta.partial_json).toBe('{"cron":"1 2 3 4 *"}')
    expect(sseOf(call.slice(0, 1))).toMatch(/^event: message_start\ndata: \{.*\}\n\n$/)
  })
})

describe('what a conversation’s ledger holds of the words about its jobs', () => {
  const row = (ordinal, type, payload, session = 'sess_c') => ({
    session_id: session,
    ordinal,
    type,
    payload: JSON.stringify(payload),
  })
  const words = 'Your job at an unknown time runs at a time this app cannot tell, so …'

  it('reads the words held and said, and why each job of the app’s own level is not started', () => {
    const events = [
      row(3, 'user_turn', { text: words, authorship: { appNotice: JOB_NOTICE } }),
      row(1, 'scheduled_work', { source: 'hook/PostToolUse', receipt: {} }),
      row(2, 'message_queued', { text: words, authorship: { appNotice: JOB_NOTICE } }),
      row(4, 'scheduled_work', {
        source: 'app/receipts',
        jobs: [{ id: 'a', notStarted: 'time-not-known' }, { id: 'b' }],
      }),
      row(5, 'user_turn', { text: 'A person’s own words' }),
      row(
        1,
        'message_queued',
        { text: words, authorship: { appNotice: JOB_NOTICE } },
        'sess_other',
      ),
    ]
    expect(jobNoticesIn(events, 'sess_c')).toEqual({
      queued: [words],
      said: [words],
      appLevels: [['time-not-known', null]],
      appJobs: [
        { id: 'a', notStarted: 'time-not-known', nominalAt: null },
        { id: 'b', notStarted: null, nominalAt: null },
      ],
    })
  })

  it('counts a second start’s words as a second, so a double start cannot pass as one', () => {
    const told = { text: words, authorship: { appNotice: JOB_NOTICE } }
    const events = [
      row(1, 'message_queued', told),
      row(2, 'user_turn', told),
      row(3, 'user_turn', told),
    ]
    expect(jobNoticesIn(events, 'sess_c').said).toHaveLength(2)
  })

  it('reads nothing from a conversation it was not asked about, or from no rows', () => {
    expect(jobNoticesIn(undefined, 'sess_c')).toEqual({
      queued: [],
      said: [],
      appLevels: [],
      appJobs: [],
    })
  })
})

describe('the jobs a conversation made, as the beta recorded their scheduling calls', () => {
  const receipt = (ordinal, receipt, session = 'sess_c') => ({
    session_id: session,
    ordinal,
    type: 'scheduled_work',
    payload: JSON.stringify({ type: 'scheduled_work', receipt, source: 'hook/PostToolUse' }),
  })

  it('reads each call, the job its result names and the job it was asked about', () => {
    const events = [
      receipt(1, {
        toolUseId: 'toolu_a',
        tool: 'CronCreate',
        input: { cron: '1 2 * * *', recurring: true },
        result: { id: '3c5840ec', recurring: true, durable: false },
      }),
      receipt(2, {
        toolUseId: 'toolu_b',
        tool: 'CronDelete',
        input: { id: '3c5840ec' },
        result: { id: '3c5840ec' },
      }),
      // A call the provider refused leaves no result: what it was asked is still read.
      receipt(3, { toolUseId: 'toolu_c', tool: 'CronDelete', input: { id: 'feedf00d' } }),
      { session_id: 'sess_c', ordinal: 4, type: 'scheduled_work', payload: '{"jobs":[]}' },
      receipt(
        5,
        { toolUseId: 'toolu_d', tool: 'CronCreate', result: { id: 'aaaaaaaa' } },
        'sess_other',
      ),
    ]
    expect(receiptsIn(events, 'sess_c')).toEqual([
      { toolUseId: 'toolu_a', tool: 'CronCreate', job: '3c5840ec', asked: null, stamped: false },
      {
        toolUseId: 'toolu_b',
        tool: 'CronDelete',
        job: '3c5840ec',
        asked: '3c5840ec',
        stamped: false,
      },
      { toolUseId: 'toolu_c', tool: 'CronDelete', job: null, asked: 'feedf00d', stamped: false },
    ])
  })

  it('finds the id a call answered in its result, however the request carries it', () => {
    const body = {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_a', content: 'Scheduled job 3c5840ec.' },
            {
              type: 'tool_result',
              tool_use_id: 'toolu_b',
              content: [{ type: 'text', text: '{"id":"6a314a86"}' }],
            },
          ],
        },
      ],
    }
    expect(jobIdIn(toolResultText(body, 'toolu_a'))).toBe('3c5840ec')
    expect(jobIdIn(toolResultText(body, 'toolu_b'))).toBe('6a314a86')
    expect(toolResultText(body, 'toolu_c')).toBeNull()
    expect(jobIdIn('no id here')).toBeNull()
  })

  it('repeats a job daily at a local minute, as CronCreate takes it', () => {
    expect(dailyCron(new Date(2026, 9, 8, 17, 31))).toBe('31 17 * * *')
  })
})

describe('a beta that stamps the receipts of the jobs it makes, and one that does not', () => {
  const made = (stamp) => ({
    session_id: 'sess_c',
    ordinal: 1,
    type: 'scheduled_work',
    payload: JSON.stringify({
      type: 'scheduled_work',
      receipt: {
        toolUseId: 'toolu_a',
        tool: 'CronCreate',
        result: { id: 'aaaaaaaa' },
        ...(stamp === undefined ? {} : { stamp }),
      },
    }),
  })

  it('reads the stamp a build with the scheduling switch writes, and none from an earlier one', () => {
    const stamp = { calendar: 'Europe/Paris', version: '2026a' }
    expect(receiptsIn([made(stamp)], 'sess_c')[0]?.stamped).toBe(true)
    expect(receiptsIn([made(undefined)], 'sess_c')[0]?.stamped).toBe(false)
    expect(receiptsIn([made(null)], 'sess_c')[0]?.stamped).toBe(false)
  })

  it('tells the two kinds of beta apart by the jobs they made, and says when it cannot', () => {
    const one = (tool, stamped) => ({ toolUseId: 't', tool, job: 'j', asked: null, stamped })
    expect(stampingOf([one('CronCreate', true), one('CronCreate', true)])).toBe('stamped')
    expect(stampingOf([one('CronCreate', false), one('CronDelete', false)])).toBe('unstamped')
    // A cancellation's receipt is not one of the jobs made.
    expect(stampingOf([one('CronCreate', true), one('CronDelete', false)])).toBe('stamped')
    expect(stampingOf([one('CronCreate', true), one('CronCreate', false)])).toBe('mixed')
    expect(stampingOf([])).toBe('none')
  })

  it('places a moment in its minute', () => {
    expect(minuteOf(new Date(2026, 9, 9, 22, 41, 37, 500))).toBe(
      new Date(2026, 9, 9, 22, 41).getTime(),
    )
  })
})

describe('each start the candidate owes, told apart from the others', () => {
  const FIRST = 'Fictional Claude conversation: schedule three jobs and cancel one'
  const DUE = 'Fictional Claude conversation: schedule a job for a few minutes from now'
  const firsts = { claude: FIRST, due: DUE }
  const firstJobs = [
    'A fictional repeating job of the upgrade path',
    'A fictional job of the upgrade path',
  ]
  const dueJobs = ['A fictional job that comes due while the app is closed']
  const firstWords =
    'Your scheduled jobs (“A fictional repeating job of the upgrade path”) and (“A fictional job of the upgrade path”) run at times this app cannot tell, so once this conversation stops this app will not start it for those jobs.'
  const dueWords =
    'Your scheduled job (“A fictional job that comes due while the app is closed”) runs at a time this app cannot tell, so once this conversation stops this app will not start it for that job.'
  const request = (id, of, notices, extra = {}) => ({
    id,
    stage: 'candidate-first',
    auth: 'expected',
    of,
    notices,
    ...extra,
  })
  const started = (conversation) => `runtime host: starting ${conversation} for its scheduled jobs`
  const waits = (conversation) =>
    `runtime host: ${conversation}'s start for its scheduled jobs waits until its saved claude key is saved again or removed: the key could not be read`
  const retried = (conversation) =>
    `runtime host could not start ${conversation} for its scheduled jobs, and tries again in 60000ms: refused`
  const evidence = (requests, log, conversation, of, prompts) =>
    startEvidence({ requests, log, stage: 'candidate-first', conversation, of, prompts })

  it('knows a request’s conversation by the first words it was asked, and says when it cannot', () => {
    expect(conversationOf(['Notice', FIRST], firsts)).toBe('claude')
    expect(conversationOf([DUE, 'more'], firsts)).toBe('due')
    expect(conversationOf(['A title request'], firsts)).toBeNull()
    expect(conversationOf([FIRST, DUE], firsts)).toBeNull()
  })

  it('reads a job as named only where its prompt stands in quotes, as the app’s words put it', () => {
    expect(namesTheJob(firstWords, firstJobs[1])).toBe(true)
    expect(namesTheJob('A fictional job of the upgrade path, unquoted', firstJobs[1])).toBe(false)
    expect(namesTheJob(firstWords, dueJobs[0])).toBe(false)
  })

  it('counts each conversation’s words as told to it alone, whichever start goes first', () => {
    const log = [started('sess_due'), started('sess_first')].join('\n')
    for (const requests of [
      [request('m1', 'due', [dueWords]), request('m2', 'claude', [firstWords])],
      [request('m1', 'claude', [firstWords]), request('m2', 'due', [dueWords])],
    ]) {
      const first = evidence(requests, log, 'sess_first', 'claude', firstJobs)
      const due = evidence(requests, log, 'sess_due', 'due', dueJobs)
      expect(first).toMatchObject({ outcome: 'told', started: 1, refused: false, retried: [] })
      expect(due).toMatchObject({ outcome: 'told', started: 1, refused: false, retried: [] })
      expect(first.told).toHaveLength(1)
      expect(due.told).toHaveLength(1)
      expect(first.told).not.toEqual(due.told)
    }
  })

  it('does not take one conversation’s words for another’s: the second start, still owed, is pending', () => {
    const requests = [request('m1', 'due', [dueWords])]
    const log = started('sess_due')
    expect(evidence(requests, log, 'sess_due', 'due', dueJobs).outcome).toBe('told')
    const first = evidence(requests, log, 'sess_first', 'claude', firstJobs)
    expect(first).toMatchObject({ outcome: 'pending', started: 0, told: [], refused: false })
  })

  it('does not count words that name only some of a conversation’s jobs, or reach it from elsewhere', () => {
    const some =
      'Your scheduled job (“A fictional job of the upgrade path”) runs at a time this app cannot tell.'
    const requests = [
      request('m1', 'claude', [some]),
      request('m2', 'claude', [firstWords], { stage: 'candidate-second' }),
      request('m3', 'claude', [firstWords], { auth: 'other' }),
      request('m4', null, [firstWords]),
    ]
    expect(evidence(requests, '', 'sess_first', 'claude', firstJobs).outcome).toBe('pending')
  })

  it('reads a start that waits for its unreadable key as refused, and a timed retry as one', () => {
    const refused = evidence(
      [],
      [started('sess_first'), waits('sess_first')].join('\n'),
      'sess_first',
      'claude',
      firstJobs,
    )
    expect(refused).toMatchObject({ outcome: 'refused', started: 1, refused: true, retried: [] })
    // The next start owed waits for the key without being started.
    const next = evidence([], waits('sess_due'), 'sess_due', 'due', dueJobs)
    expect(next).toMatchObject({ outcome: 'refused', started: 0, refused: true, retried: [] })
    const again = evidence(
      [],
      [started('sess_first'), retried('sess_first'), waits('sess_first')].join('\n'),
      'sess_first',
      'claude',
      firstJobs,
    )
    expect(again.outcome).toBe('refused')
    expect(again.retried).toHaveLength(1)
    // Another conversation's lines are not its own.
    expect(evidence([], waits('sess_due'), 'sess_first', 'claude', firstJobs).outcome).toBe(
      'pending',
    )
  })

  it('reads words told and a wait for the key together as a start that cannot be', () => {
    const both = evidence(
      [request('m1', 'claude', [firstWords])],
      waits('sess_first'),
      'sess_first',
      'claude',
      firstJobs,
    )
    expect(both.outcome).toBe('both')
  })
})
