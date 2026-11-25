import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { providerRoster } from '../lib/app-source.mjs'
import { withMovedFiles } from '../lib/moved-state-files.mjs'
import * as upgradeRules from '../lib/upgrade-path.mjs'
import {
  A_STANDING_STOPS_SETUP,
  appExeIn,
  betaAsset,
  bundleIn,
  buildLineage,
  CHECKPOINT_LINE,
  contains,
  copiesSince,
  credentialSeen,
  draftsKept,
  FAIL_LINE,
  historyOf,
  keptTables,
  installerGuid,
  isPublishedRelease,
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
  sessionsKept,
  sha256,
  startOrder,
  makeEarlierMigrationFixture,
  stateFileNames,
  stateKept,
  theCandidateInstaller,
  transcriptsOf,
  turnOutcome,
  whatRunsIsSaid,
  APP_NAMES_BEFORE,
  keychainAttributes,
  keychainEntryFor,
} from '../lib/upgrade-path.mjs'
import { RUNNER_FILES, runnerSource } from './upgrade-runner-source.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const copy = (value) => structuredClone(value)

describe('the published release used as the old build', () => {
  const release = {
    tag_name: 'v7.2.3',
    draft: false,
    prerelease: false,
    published_at: '2026-01-02T03:04:05Z',
  }

  it('accepts a published full release', () => {
    expect(isPublishedRelease(release, 'v7.2.3')).toBe(true)
  })

  it('also accepts a published prerelease', () => {
    expect(
      isPublishedRelease(
        { ...release, tag_name: 'v7.2.3-beta.1', prerelease: true },
        'v7.2.3-beta.1',
      ),
    ).toBe(true)
  })

  it('refuses drafts, an unspecified draft status and a different tag for either release kind', () => {
    for (const prerelease of [false, true]) {
      const oldBuild = { ...release, prerelease }
      expect(isPublishedRelease({ ...oldBuild, draft: true }, 'v7.2.3')).toBe(false)
      expect(isPublishedRelease({ ...oldBuild, draft: undefined }, 'v7.2.3')).toBe(false)
      expect(isPublishedRelease(oldBuild, 'v7.2.4')).toBe(false)
    }
  })
})

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
  const sql = {
    a: "CREATE TABLE a (\n  id text\n); INSERT INTO a VALUES ('fictional');\n",
    b: 'CREATE INDEX b ON a (id);',
  }
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
  it('constructs the real earlier SQL prefix, preserving its rows when the next migration runs', () => {
    const db = new DatabaseSync(':memory:')
    try {
      expect(makeEarlierMigrationFixture(db, journal, (tag) => sql[tag])).toEqual([
        { hash: sha256(sql.a), createdAt: 10 },
      ])
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name='b'").get()).toBeUndefined()
      db.exec(sql.b)
      expect(db.prepare('SELECT id FROM a').get().id).toBe('fictional')
    } finally {
      db.close()
    }
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

const firstStart = (log, extra = {}) => startOrder(log, { checkpoint: true, ...extra })
const backgroundStart = (log, observation) =>
  firstStart(log, { completion: 'background', observation })

describe('a start’s whole log', () => {
  const first = ['booting', CHECKPOINT_LINE, 'migrations', READY_LINE].join('\n')

  it('keeps synchronous/repeated-start controls and requires real DOM evidence for background completion', () => {
    expect(firstStart(first)).toEqual({ ready: 3, checkedCopy: 1 })
    expect(startOrder(`x\r\n${READY_LINE}\r\n`, { checkpoint: false }).checkedCopy).toBeNull()
    const observation = {
      launched: 10,
      responsive: 20,
      absent: 21,
      completed: 50,
      manifestAbsent: true,
    }
    const log = `${READY_LINE}\n${CHECKPOINT_LINE}`
    expect(() => backgroundStart(log, observation)).not.toThrow()
    for (const changed of [
      null,
      { ...observation, manifestAbsent: false },
      { ...observation, responsive: 51 },
      { ...observation, completed: 20 },
      { ...observation, completed: NaN },
    ]) {
      expect(() => backgroundStart(log, changed)).toThrow('Responsive ordinary DOM')
    }
    expect(() => backgroundStart(`${log}\n${CHECKPOINT_LINE}`, observation)).toThrow('found 2')
    expect(
      firstStart(log, {
        completion: 'functional-background',
        observation: { ...observation, manifestAbsent: false },
      }).backgroundObservation,
    ).toBe('already-complete-no-overlap-credit')
    expect(
      firstStart(log, { completion: 'functional-background', observation }).backgroundObservation,
    ).toBe('witnessed-overlap')
    expect(() =>
      firstStart(log, {
        completion: 'functional-background',
        observation: { ...observation, completed: undefined },
      }),
    ).toThrow('Responsive ordinary DOM')
  })

  it('fails a failed start, a recovery-only start, two READYs, and a copy in the wrong place', () => {
    expect(() => firstStart(`${FAIL_LINE}\nThe data is newer.`)).toThrow('The data is newer.')
    expect(() => startOrder(`${RECOVERY_ONLY_LINE}\n${READY_LINE}`, { checkpoint: false })).toThrow(
      'recovery window',
    )
    expect(() => firstStart(`${READY_LINE}\n${CHECKPOINT_LINE}`)).toThrow('before READY')
    expect(() => startOrder(first, { checkpoint: false })).toThrow('another recovery copy')
    expect(() => firstStart('nothing')).toThrow('found 0')
  })

  it('fails what is said after READY: a second READY, a late copy, a late failure', () => {
    expect(() => firstStart(`${first}\nlater\n${READY_LINE}`)).toThrow('found 2')
    expect(() => firstStart(`${first}\n${CHECKPOINT_LINE}`)).toThrow('found 2')
    expect(() => firstStart(`${first}\n${FAIL_LINE}\nIt stopped.`)).toThrow('It stopped.')
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

describe('connection columns added by a candidate upgrade', () => {
  const defaults = {
    agent_identity: { connection_id: null },
    provider_session: { connection_id: null },
  }
  const before = {
    agent_identity: [{ id: 'aid:fern', slug: 'fern', model_choice: 'fictional model' }],
    provider_session: [
      { id: 'fictional-thread', external_ref: 'original-thread', cwd: '/fictional/original' },
    ],
    provider_api_key: [{ provider: 'codex', sealed: 'fictional-sealed-reference' }],
    events: [{ id: 'fictional-event', payload: 'Fictional history' }],
  }
  const keys = {
    agent_identity: ['id'],
    provider_session: ['id'],
    provider_api_key: ['provider'],
    events: ['id'],
  }
  const migrated = () => ({
    ...copy(before),
    agent_identity: before.agent_identity.map((row) => ({ ...row, connection_id: null })),
    provider_session: before.provider_session.map((row) => ({ ...row, connection_id: null })),
  })
  const compare = (after, original = before, mayMove) =>
    rowsPreserved(original, after, mayMove, keys, undefined, defaults)

  it('accepts only the declared null additions while retaining every original field', () => {
    expect(compare(migrated())).toEqual({ lost: [], added: {} })
  })

  it.each(['agent_identity', 'provider_session'])(
    'requires the new column to exist on migrated %s rows',
    (table) => {
      const after = migrated()
      delete after[table][0].connection_id
      expect(compare(after).lost).toEqual([
        { table, row: JSON.stringify([before[table][0].id]), changed: ['connection_id'] },
      ])
    },
  )

  for (const table of ['agent_identity', 'provider_session']) {
    it.each([undefined, '', 'fictional-connection', 0, false])(
      `rejects an undeclared new ${table} binding %s`,
      (value) => {
        const after = migrated()
        after[table][0].connection_id = value
        expect(compare(after).lost).toEqual([
          { table, row: JSON.stringify([before[table][0].id]), changed: ['connection_id'] },
        ])
      },
    )
  }

  it('keeps a previously recorded binding exact instead of resetting it to the migration default', () => {
    const original = migrated()
    original.provider_session[0].connection_id = 'codex:api-key'
    expect(compare(copy(original), original).lost).toEqual([])
    const changed = copy(original)
    changed.provider_session[0].connection_id = null
    expect(compare(changed, original).lost).toEqual([
      { table: 'provider_session', row: '["fictional-thread"]', changed: ['connection_id'] },
    ])
  })

  it('does not ignore new bindings even when a caller names them as movable', () => {
    const after = migrated()
    after.provider_session[0].connection_id = 'fictional-connection'
    expect(compare(after, before, { provider_session: ['connection_id'] }).lost).toHaveLength(1)
  })

  it.each([
    ['agent_identity', 'model_choice'],
    ['provider_session', 'external_ref'],
    ['provider_session', 'cwd'],
    ['provider_api_key', 'sealed'],
    ['events', 'payload'],
  ])('still refuses a changed original %s.%s', (table, column) => {
    const after = migrated()
    after[table][0][column] = 'fictional rewritten value'
    expect(compare(after).lost).toEqual([
      {
        table,
        row: JSON.stringify(keys[table].map((key) => before[table][0][key])),
        changed: [column],
      },
    ])
  })

  it('does not permit unrelated new fields or change the recovery-copy comparison', () => {
    const after = migrated()
    after.agent_identity[0].unexpected = null
    expect(compare(after).lost).toEqual([
      { table: 'agent_identity', row: '["aid:fern"]', changed: ['unexpected'] },
    ])
    expect(rowsPreserved(before, migrated(), {}, keys).lost).toHaveLength(2)
    expect(rowsPreserved(before, copy(before), {}, keys).lost).toEqual([])
  })
})

describe('standing-rule history gains an unknown author during an upgrade', () => {
  const legacy = { id: 'rules-lark-1', text: 'Keep reviews short', wrote_it: 'a-person' }
  const keys = { identity_instruction: ['id'] }
  const compare = (before, after) =>
    rowsPreserved(
      { identity_instruction: before },
      { identity_instruction: after },
      undefined,
      keys,
    )

  it('accepts only the null default added to legacy rows without masking changes', () => {
    expect(compare([legacy], [{ ...legacy, author: null }])).toEqual({ lost: [], added: {} })
    expect(compare([legacy], [{ ...legacy, author: null, text: 'Changed' }]).lost).toEqual([
      { table: 'identity_instruction', row: '["rules-lark-1"]', changed: ['text'] },
    ])
    expect(
      compare([legacy], [{ ...legacy, author: '{"profile":"wren","name":"Wren"}' }]).lost,
    ).toEqual([{ table: 'identity_instruction', row: '["rules-lark-1"]', changed: ['author'] }])
  })

  it('continues to compare an already recorded author and a missing author column exactly', () => {
    const recorded = { ...legacy, author: '{"profile":"wren","name":"Wren"}' }
    expect(compare([recorded], [{ ...recorded }]).lost).toEqual([])
    expect(compare([recorded], [{ ...recorded, author: null }]).lost).toEqual([
      { table: 'identity_instruction', row: '["rules-lark-1"]', changed: ['author'] },
    ])
    expect(compare([{ ...legacy, author: null }], [legacy]).lost).toEqual([
      { table: 'identity_instruction', row: '["rules-lark-1"]', changed: ['author'] },
    ])
    expect(compare([legacy], [{ ...legacy }]).lost).toEqual([])
  })
})

describe('memory history gains an unknown restoration source during an upgrade', () => {
  const legacy = {
    id: 'memory-lark-1',
    act: 'removed',
    text_before: 'Kept',
    text_after: null,
    by: 'person',
  }
  const compare = (before, after) =>
    rowsPreserved(
      { identity_memory_amendment: before },
      { identity_memory_amendment: after },
      undefined,
      { identity_memory_amendment: ['id'] },
    )
  it('accepts the new null source only and still reports changed text, author or a fabricated source', () => {
    expect(compare([legacy], [{ ...legacy, source_id: null }])).toEqual({ lost: [], added: {} })
    for (const field of ['text_before', 'by', 'source_id'])
      expect(compare([legacy], [{ ...legacy, source_id: null, [field]: 'changed' }]).lost).toEqual([
        { table: 'identity_memory_amendment', row: '["memory-lark-1"]', changed: [field] },
      ])
    expect(
      rowsPreserved({ other: [legacy] }, { other: [{ ...legacy, source_id: null }] }).lost,
    ).not.toEqual([])
  })
  it('continues to compare recorded sources and a missing source column exactly', () => {
    const recorded = { ...legacy, source_id: 'memory-lark-0' }
    expect(compare([recorded], [{ ...recorded }]).lost).toEqual([])
    expect(compare([recorded], [{ ...recorded, source_id: null }]).lost).toEqual([
      { table: 'identity_memory_amendment', row: '["memory-lark-1"]', changed: ['source_id'] },
    ])
    expect(compare([{ ...legacy, source_id: null }], [legacy]).lost).toEqual([
      { table: 'identity_memory_amendment', row: '["memory-lark-1"]', changed: ['source_id'] },
    ])
    expect(compare([legacy], []).lost).not.toEqual([])
  })
  it('accepts only the legacy recovery defaults and reports invented or changed observations', () => {
    const defaults = {
      source_id: null,
      outcome: 'done',
      actual: null,
      settled_by: null,
      settled_at: null,
    }
    expect(compare([legacy], [{ ...legacy, ...defaults }]).lost).toEqual([])
    for (const field of ['outcome', 'actual', 'settled_by', 'settled_at']) {
      expect(compare([legacy], [{ ...legacy, ...defaults, [field]: 'fabricated' }]).lost).toEqual([
        { table: 'identity_memory_amendment', row: '["memory-lark-1"]', changed: [field] },
      ])
      const recorded = { ...legacy, ...defaults, [field]: 'recorded' }
      expect(compare([recorded], [{ ...legacy, ...defaults }]).lost).toEqual([
        { table: 'identity_memory_amendment', row: '["memory-lark-1"]', changed: [field] },
      ])
      const missing = { ...recorded }
      delete missing[field]
      expect(compare([recorded], [missing]).lost).toEqual([
        { table: 'identity_memory_amendment', row: '["memory-lark-1"]', changed: [field] },
      ])
    }
    expect(compare([legacy], []).lost).not.toEqual([])
    expect(
      rowsPreserved({ other: [legacy] }, { other: [{ ...legacy, ...defaults }] }).lost,
    ).not.toEqual([])
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

  it('is refused with one conversation, a missing row or no Codex session', () => {
    expect(() => historyOf(tables, ['a'])).toThrow('fewer than two')
    expect(() => historyOf(tables, ['a', 'c'])).toThrow('no row for conversation c')
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

describe('a state file the candidate moved into its database', () => {
  const archived = { version: 1, archived: { a: { at: 5 } } }
  const before = { 'archived.json': Buffer.from(JSON.stringify(archived)) }
  const lostOf = (was, tables) => stateKept(was, withMovedFiles({}, tables), Object.keys(was)).lost

  it('is kept when its rows say all it said and the import is marked', () => {
    const tables = {
      imported_side_file: [{ name: 'archived.json' }],
      archived_conversation: [{ conversation_id: 'a', archived_at: 5 }],
    }
    expect(lostOf(before, tables)).toEqual([])
  })

  it('rebuilds provider usage in its rows’ order, with an empty list for a provider without one', () => {
    const usage = {
      readings: {
        claude: [
          { window: 'five_hour', usedPercent: 3, resetsAt: null, at: 2 },
          { window: 'seven_day', usedPercent: 40, resetsAt: 9, at: 2, account: 'a' },
        ],
        codex: [],
      },
      seen: { claude: [{ window: 'five_hour', first: 1, last: 2 }], codex: [] },
    }
    const row = { provider: 'claude', at: 2, resets_at: null, account: null }
    const tables = {
      imported_side_file: [{ name: 'provider-usage.json' }],
      provider_usage_reading: [
        { ...row, window: 'seven_day', position: 1, used_percent: 40, resets_at: 9, account: 'a' },
        { ...row, window: 'five_hour', position: 0, used_percent: 3 },
      ],
      provider_usage_window_seen: [
        { provider: 'claude', window: 'five_hour', position: 0, first: 1, last: 2 },
      ],
      provider_usage_read_on: [],
    }
    const was = { 'provider-usage.json': Buffer.from(JSON.stringify(usage)) }
    expect(lostOf(was, tables)).toEqual([])
  })

  it('rejects lost rows and reads native rows without an import receipt', () => {
    const marked = { imported_side_file: [{ name: 'archived.json' }], archived_conversation: [] }
    expect(lostOf(before, marked)).toEqual(['archived.json: it no longer says what the beta wrote'])
    const unmarked = { archived_conversation: [{ conversation_id: 'a', archived_at: 5 }] }
    expect(lostOf(before, unmarked)).toEqual([])
  })
})

describe('the transcript retention file is set to keep every transcript', () => {
  const name = 'transcript-retention.json'
  const earlier = {
    period: 90,
    checkedAt: 10,
    scanAfter: 'default/orchard/codex/sessions/2026/01/kept.jsonl',
    cleared: [{ at: 10, days: 90, conversations: 2, bytes: 40 }],
  }
  const check = (after, before = earlier) =>
    stateKept(
      { [name]: Buffer.from(JSON.stringify(before)) },
      { [name]: Buffer.from(JSON.stringify(after)) },
      [name],
    )
  it.each([30, 90, 365])('accepts %s becoming forever with the rest of the file kept', (period) => {
    expect(check({ ...earlier, period: 'forever', scanAfter: '' }, { ...earlier, period })).toEqual(
      { lost: [], rewritten: [name], appeared: [] },
    )
  })
  it('accepts a file that appears saying forever', () => {
    expect(
      stateKept({}, { [name]: Buffer.from(JSON.stringify({ period: 'forever' })) }, [name]),
    ).toEqual({ lost: [], rewritten: [], appeared: [name] })
  })
  it.each([30, 90, 365, '90', null])('refuses a file left at %s', (period) => {
    expect(check({ ...earlier, period, scanAfter: '' }).lost).toEqual([
      `${name}: it no longer keeps every transcript`,
    ])
  })
  it('refuses losing what the earlier version recorded', () => {
    expect(check({ period: 'forever' }).lost).toEqual([
      `${name}: it no longer says what the beta wrote`,
    ])
  })
  it('refuses a file larger than the app can read', () => {
    const after = Buffer.from(JSON.stringify({ ...earlier, period: 'forever' }) + ' '.repeat(65536))
    expect(
      stateKept({ [name]: Buffer.from(JSON.stringify(earlier)) }, { [name]: after }, [name]).lost,
    ).toEqual([`${name}: it no longer keeps every transcript`])
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

describe('the workspace registry selected for an upgrade', () => {
  const root = join('/fictional', 'app-data')
  const workspace = join(root, 'desktop')
  const packaged = join(root, 'packaged-workspaces.json')
  const legacy = join(root, 'workspaces.json')
  const book = () => ({
    version: 1,
    workspaces: [
      { path: workspace, lastOpenedAt: 10 },
      { path: join(root, 'orchard'), lastOpenedAt: 5, note: 'kept' },
    ],
  })
  const readFrom = (files, seen) => (path) => {
    seen.push(path)
    return copy(files.get(path) ?? null)
  }

  it.each([
    ['packaged', 'packaged-workspaces.json'],
    ['legacy', 'workspaces.json'],
  ])('uses the declared %s launch contract', (contract, basename) => {
    expect(upgradeRules.workspaceRegistrySnapshot(root, contract, () => book()).basename).toBe(
      basename,
    )
  })

  it('refuses an unknown build contract instead of guessing from files', () => {
    expect(() => upgradeRules.workspaceRegistrySnapshot(root, 'guess', () => book())).toThrow(
      /contract/,
    )
  })

  it('keeps the packaged filename in step with the application launch contract', () => {
    const source = readFileSync(join(ROOT, 'apps/desktop/src/main/workspace-routing.ts'), 'utf8')
    const declared = /export const PACKAGED_WORKSPACE_LIST = '([^']+)'/.exec(source)?.[1]
    expect(declared).toBeTruthy()
    expect(upgradeRules.workspaceRegistrySnapshot(root, 'packaged', () => book()).basename).toBe(
      declared,
    )
  })

  it('reads only the packaged path and retains its name, path and nonempty baseline', () => {
    const seen = []
    const expected = book()
    const files = new Map([
      [packaged, expected],
      [legacy, { version: 1, workspaces: [{ path: '/wrong', lastOpenedAt: 99 }] }],
    ])
    const read = upgradeRules.workspaceRegistrySnapshot(root, 'packaged', readFrom(files, seen))
    expect(seen).toEqual([packaged])
    expect(read).toEqual({
      contract: 'packaged',
      basename: 'packaged-workspaces.json',
      path: packaged,
      value: expected,
    })
    expect(upgradeRules.workspaceRegistryBaseline(read, workspace)).toEqual([])
  })

  it('reads the legacy path only when that build contract explicitly selects it', () => {
    const seen = []
    const files = new Map([
      [packaged, { version: 1, workspaces: [] }],
      [legacy, book()],
    ])
    const read = upgradeRules.workspaceRegistrySnapshot(root, 'legacy', readFrom(files, seen))
    expect(seen).toEqual([legacy])
    expect(read.basename).toBe('workspaces.json')
    expect(upgradeRules.workspaceRegistryBaseline(read, workspace)).toEqual([])
  })

  it('does not let a healthy legacy file hide a missing packaged registry', () => {
    const seen = []
    const read = upgradeRules.workspaceRegistrySnapshot(
      root,
      'packaged',
      readFrom(new Map([[legacy, book()]]), seen),
    )
    expect(seen).toEqual([packaged])
    expect(read.value).toBeNull()
    expect(upgradeRules.workspaceRegistryBaseline(read, workspace)).not.toEqual([])
  })

  it('retains an unreadable selected path as failure evidence without trying another name', () => {
    const seen = []
    const read = upgradeRules.workspaceRegistrySnapshot(root, 'packaged', (path) => {
      seen.push(path)
      throw new Error('fixture read refused')
    })
    expect(seen).toEqual([packaged])
    expect(read.value).toEqual({ unreadable: true })
    expect(upgradeRules.workspaceRegistryBaseline(read, workspace)).not.toEqual([])
  })

  it.each([
    ['missing', null],
    ['unreadable', { unreadable: true }],
    ['invalid format', { version: 2, workspaces: [] }],
    ['empty', { version: 1, workspaces: [] }],
    ['no current workspace', { version: 1, workspaces: [{ path: '/other', lastOpenedAt: 1 }] }],
    ['invalid opening time', { version: 1, workspaces: [{ path: workspace, lastOpenedAt: null }] }],
  ])('refuses a %s baseline, so preservation cannot pass without measuring it', (_, value) => {
    const read = upgradeRules.workspaceRegistrySnapshot(root, 'packaged', () => value)
    expect(upgradeRules.workspaceRegistryBaseline(read, workspace)).not.toEqual([])
  })

  it('keeps both candidate readings on the selected path and still detects each planted loss', () => {
    const seen = []
    const files = new Map([[packaged, book()]])
    const read = () =>
      upgradeRules.workspaceRegistrySnapshot(root, 'packaged', readFrom(files, seen))
    const before = read()
    expect(upgradeRules.workspaceRegistryBaseline(before, workspace)).toEqual([])
    for (const stage of ['first start', 'second start']) {
      const after = read()
      expect(after.path, stage).toBe(before.path)
      expect(registryKept(before.value, after.value), stage).toEqual([])
    }
    expect(seen).toEqual([packaged, packaged, packaged])
    const dropped = book()
    dropped.workspaces.pop()
    const changed = book()
    changed.workspaces[1].note = 'changed'
    const backwards = book()
    backwards.workspaces[0].lastOpenedAt = 9
    for (const value of [null, { unreadable: true }, dropped, changed, backwards]) {
      files.set(packaged, value)
      expect(registryKept(before.value, read().value)).not.toEqual([])
    }
  })

  it('connects the runner to the explicit baseline contract and packaged candidate readings', () => {
    const source = runnerSource()
    expect(source).toContain("'beta-registry': { type: 'string', default: 'packaged' }")
    expect(source).toContain("besideTheFolder(args['beta-registry'])")
    expect(source).toContain("besideTheFolder('packaged')")
    expect(source).toMatch(/workspaceRegistrySnapshot\(appRoot, contract,/)
    expect(source).toMatch(/workspaceRegistryBaseline\(\s*besideBefore\.registry,/)
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
  const cantBeRead = {
    answer: null,
    refused:
      "Error invoking remote method 'runtime:command': Error: Saved key can’t be read, save it again in Settings.",
    refusedAt: 'start',
    refusedAfterMs: 2_100,
    requests: [],
  }
  const inUse = { set: true, inUse: true }
  const unreadable = { set: true, inUse: false, readState: 'unreadable' }

  it('passes when the model answered it on the fixture key', () => {
    expect(turnOutcome(answered, inUse)).toEqual({ outcome: 'answered', ok: true })
  })

  it('fails when any request reached the model with another key or none, answered or not', () => {
    for (const auth of ['other', 'missing']) {
      const turn = { ...answered, requests: [post('expected'), post(auth)] }
      expect(turnOutcome(turn, inUse)).toEqual({
        outcome: 'asked-the-model-without-the-key',
        ok: false,
      })
    }
    const wrongKey = {
      ...cantBeRead,
      refused: 'Invalid API key',
      refusedAt: 'send',
      refusedAfterMs: 1_000,
      requests: [post('other')],
    }
    expect(turnOutcome(wrongKey, unreadable)).toEqual({
      outcome: 'asked-the-model-without-the-key',
      ok: false,
    })
    expect(turnOutcome({ ...answered, requests: [] }, inUse)).toEqual({
      outcome: 'answered-without-asking-the-model',
      ok: false,
    })
    expect(turnOutcome({ ...answered, answer: null }, inUse)).toEqual({
      outcome: 'not-answered',
      ok: false,
    })
  })

  it('passes a start the app refused because it can’t read the key an earlier version sealed', () => {
    expect(turnOutcome(cantBeRead, unreadable)).toEqual({
      outcome: 'the-saved-key-cannot-be-read',
      ok: true,
    })
  })

  it('fails that refusal whenever one part of it is missing', () => {
    const not = (turn, status = unreadable) =>
      expect(turnOutcome(turn, status)).toEqual({ outcome: 'refused', ok: false })
    not({ ...cantBeRead, refusedAt: 'send' })
    not({ ...cantBeRead, refusedAfterMs: 61_000 })
    not({ ...cantBeRead, refused: 'Invalid API key' })
    not({ ...cantBeRead, refused: 'unknown session' })
    not(cantBeRead, inUse)
    not(cantBeRead, { set: true, inUse: false, readState: 'not-checked' })
    not(cantBeRead, null)
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
    expect(resultLine({ ...summary, knownLimits: [NOTHING_RAN_LIMIT] })).toBe(
      `passed with a known limit: ${NOTHING_RAN_LIMIT}`,
    )
    expect(resultLine({ failures: ['x', 'y'], knownLimits: [NOTHING_RAN_LIMIT] })).toBe(
      'failed: 2 check(s) did not hold',
    )
  })

  it.each([['delegate', 'hand-back'], []])(
    'lists the verified candidate skill membership: %s',
    (...names) => {
      const said = jobSummary({
        ...summary,
        result: resultLine(summary),
        candidateSkills: { names },
      })
      expect(said).toContain(`- Verified candidate built-in skills: ${names.join(', ') || 'none'}.`)
    },
  )

  it('is the first thing its job’s summary says, with the limit, the key and what it left out', () => {
    const limited = { ...summary, knownLimits: [NOTHING_RAN_LIMIT] }
    const said = jobSummary({
      ...limited,
      result: resultLine(limited),
      savedKeyAfterTheUpgrade: 'not in use: Saved key can’t be read',
      checkpoint: { id: 'c1', reason: 'first-start-of-release', madeBy: { appVersion: '0.1.0' } },
      baseline: { copies: [{ folder: 'b1', madeBy: { appVersion: '0.0.0', build: 'beta' } }] },
    })
    const lines = said.split('\n')
    expect(lines[0]).toBe('### Upgrade path · mac · mac-beta-1 → 0.1.0 (8b3e150f3)')
    expect(lines[2]).toBe(`**Passed with a known limit: ${NOTHING_RAN_LIMIT}.**`)
    expect(said).toContain('- Checks: 2 held, 0 did not.')
    expect(said).toContain('- The saved key after the upgrade: not in use')
    expect(said).toContain('- Recovery copies the beta left: 1, made by 0.0.0.')
    expect(said).toContain('- Recovery copy: c1 (first-start-of-release), made by 0.1.0.')
    expect(said.indexOf('the beta left: 1')).toBeLessThan(said.indexOf('Recovery copy: c1'))
    expect(said).toContain('- the in-app update buttons')
    expect(said).not.toContain('setup at launch')
  })

  it('says what the app’s setup at launch did, at each start', () => {
    const said = jobSummary({
      ...summary,
      result: resultLine(summary),
      firstStart: { launchSetup: { opensProviders: true } },
      secondStart: { launchSetup: { opensProviders: false } },
    })
    expect(said).toContain(
      "- The app's setup at launch: first start, Settings → Providers, as no provider is ready; second start, nothing opened.",
    )
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
    expect(providerRoster()).toEqual(LAUNCH_SETUP_PROVIDERS)
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

  it('counts it not ready on a sign-in that is absent, stale or unread, or a key that was refused or can’t be read', () => {
    for (const auth of [
      { state: 'absent' },
      { state: 'absent', why: 'unreadable' },
      { state: 'stale' },
      { state: 'unknown', reason: 'could not ask' },
    ]) {
      expect(providerReady(codex({ auth })), JSON.stringify(auth)).toBe(false)
    }
    expect(providerReady(codex({ keyRefused: true }))).toBe(false)
    expect(providerReady(claude({ keyRefused: true }))).toBe(true)
    expect(providerReady(codex({ keyUnreadable: true }))).toBe(false)
    expect(providerReady(claude({ keyUnreadable: true }))).toBe(false)
  })

  it('is undecided while a fact it needs has not been read', () => {
    expect(providerReady(codex({ auth: null }))).toBeNull()
    expect(providerReady(claude({ version: null }))).toBeNull()
    expect(providerReady(claude({ auth: null }))).toBeNull()
  })

  it('goes to Settings → Providers only when no provider is ready, and opens no dialog', () => {
    const missing = claude({ version: installed('missing'), auth: { state: 'absent' } })
    const signedOut = codex({ auth: { state: 'absent' } })
    expect(launchSetupExpected([missing, codex()])).toEqual({
      opensProviders: false,
      ready: [
        { provider: 'claude', ready: false },
        { provider: 'codex', ready: true },
      ],
      undecided: false,
    })
    expect(launchSetupExpected([missing, signedOut]).opensProviders).toBe(true)
    expect(launchSetupExpected([claude(), codex()]).opensProviders).toBe(false)
    expect(
      launchSetupExpected([claude({ keyUnreadable: true }), codex({ keyUnreadable: true })])
        .opensProviders,
    ).toBe(true)
    expect(
      launchSetupExpected([
        missing,
        codex({ auth: { state: 'unknown', reason: 'could not ask' } }),
      ]),
    ).toMatchObject({ opensProviders: false, undecided: false })
    expect(launchSetupExpected([missing, codex({ auth: null })])).toMatchObject({
      opensProviders: false,
      undecided: true,
    })
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
    const unreadable = [{ ...beta, digest: null }]
    expect(copiesSince(unreadable, unreadable, '0.1.0').same).toBe(false)
  })
})

describe('the Keychain entry a Mac seals saved keys with', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'apps/desktop/package.json'), 'utf8'))
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
    expect(runnerSource()).toContain("join(REPO, 'apps', 'desktop', 'package.json')")
    expect(pkg.productName).toBeUndefined()
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
    expect(
      keychainAttributes(
        'security: SecKeychainSearchCopyNext: The specified item could not be found in the keychain.',
      ),
    ).toBeNull()
    expect(keychainAttributes('    "svce"<blob>="@brobot2/desktop Safe Storage"')).toBeNull()
    expect(keychainAttributes('')).toBeNull()
  })

  it('is asked of `security` with no password: the check never passes -w or -g', () => {
    const asked = [...RUNNER_FILES, 'lib/mac-update-test.mjs'].flatMap((path) => {
      const source = readFileSync(join(ROOT, 'scripts', path), 'utf8')
      return [...source.matchAll(/(?:spawnSync|run)\('\/usr\/bin\/security', \[([^\]]*)\]/g)]
    })
    expect(asked.map(([, argv]) => argv)).toEqual(["'find-generic-password', '-s', service"])
  })
})

describe('plugin owner quiescence across a packaged upgrade quit', () => {
  it('distinguishes no plugin flow from a proven stopped owner', () => {
    expect(upgradeRules.pluginOwnerQuiescence(null)).toBe('not-exercised')
    expect(
      upgradeRules.pluginOwnerQuiescence({
        version: 1,
        epoch: '11111111-1111-4111-8111-111111111111',
        phase: 'stopped',
      }),
    ).toBe('stopped')
  })
  it.each(['accepting', 'draining', 'blocked', 'unknown'])(
    'does not accept a %s owner just because the app exited',
    (phase) => {
      expect(
        upgradeRules.pluginOwnerQuiescence({
          version: 1,
          epoch: '11111111-1111-4111-8111-111111111111',
          phase,
        }),
      ).toBe('not-stopped')
    },
  )
  it.each([undefined, {}, { phase: 'stopped' }, { version: 1, epoch: 'bad', phase: 'stopped' }])(
    'fails closed on malformed owner evidence %j',
    (record) => {
      expect(upgradeRules.pluginOwnerQuiescence(record)).toBe('not-stopped')
    },
  )
})
