import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseGate,
  parseJournal,
  parseManifest,
  parseWorkspaceId,
  serializeGate,
  serializeJournal,
  serializeManifest,
  STEPS,
  type CheckpointManifest,
  type HistoryOnlyGate,
  type Parsed,
  type Participant,
  type RestoreJournal,
} from '../../src/main/recovery/contract'
import { fromRecorded, isSafeName, isUuid, participantPlaces } from '../../src/main/recovery/layout'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const SHA_C = 'c'.repeat(64)
const CHECKPOINT = '4f1c2a0e-6d4b-4a59-9d2e-1c0f3b6a7e81'
const RESTORE = '9b8e7d6c-5a4b-4c3d-8e2f-0a1b2c3d4e5f'
const WORKSPACE = '0c3a9f7e-2b1d-4e6f-a8c9-5d4e3f2a1b0c'

const manifest: CheckpointManifest = {
  format: 'brobot-checkpoint',
  version: 1,
  id: CHECKPOINT,
  createdAt: '2026-10-10T09:00:00.000Z',
  workspaceId: WORKSPACE,
  reason: 'first-start-of-release',
  madeBy: { appVersion: '0.1.0', build: null },
  database: {
    file: 'database.sqlite',
    bytes: 123_456,
    sha256: SHA_A,
    migrations: [
      { createdAt: 1_790_000_000_000, hash: SHA_B },
      { createdAt: 1_790_000_001_000, hash: SHA_C },
      { createdAt: 1_790_000_002_000, hash: SHA_A },
    ],
  },
  files: [
    { name: 'drafts.json', present: true, bytes: 12, sha256: SHA_B },
    { name: 'sign-in-changes.json', present: false },
  ],
}

function participant(
  live: string,
  role: Participant['role'],
  was: Participant['was'],
  becomes: Participant['becomes'],
  kind: 'restore' | 'return' = 'restore',
): Participant {
  return { live, role, ...participantPlaces(kind, RESTORE, live), was, becomes }
}

const journal: RestoreJournal = {
  format: 'brobot-restore',
  version: 1,
  id: RESTORE,
  kind: 'restore',
  checkpointId: CHECKPOINT,
  startedAt: '2026-10-11T08:00:00.000Z',
  step: 'staged',
  participants: [
    participant(
      'brobot2.sqlite',
      'database',
      { present: true, sha256: SHA_B },
      { present: true, sha256: SHA_A },
    ),
    participant(
      'brobot2.sqlite-wal',
      'sidecar',
      { present: true, sha256: SHA_C },
      { present: false },
    ),
    participant('brobot2.sqlite-shm', 'sidecar', { present: false }, { present: false }),
    participant('brobot2.sqlite-journal', 'sidecar', { present: false }, { present: false }),
    participant('drafts.json', 'state', { present: false }, { present: true, sha256: SHA_C }),
  ],
}

const gate: HistoryOnlyGate = {
  format: 'brobot-history-only',
  version: 1,
  restoreId: RESTORE,
  checkpointId: CHECKPOINT,
  checkpointCreatedAt: '2026-10-10T09:00:00.000Z',
  installed: [
    { live: 'brobot2.sqlite', present: true, sha256: SHA_A },
    { live: 'brobot2.sqlite-wal', present: false },
    { live: 'brobot2.sqlite-shm', present: false },
    { live: 'brobot2.sqlite-journal', present: false },
    { live: 'drafts.json', present: true, sha256: SHA_C },
  ],
  preserved: `recovery/preserved/${RESTORE}`,
  preservedFiles: [
    { live: 'brobot2.sqlite', present: true, sha256: SHA_B },
    { live: 'brobot2.sqlite-wal', present: true, sha256: SHA_C },
    { live: 'brobot2.sqlite-shm', present: false },
    { live: 'brobot2.sqlite-journal', present: false },
    { live: 'drafts.json', present: false },
  ],
}

const REMOVED = Symbol('removed')

/**
 * The record as JSON text with each change made: a `.`-separated path (array items by index) set
 * to a value, or taken out with {@link REMOVED}.
 */
function changed(record: object, ...changes: [path: string, value: unknown][]): string {
  const copy = JSON.parse(JSON.stringify(record)) as Record<string, unknown>
  for (const [path, value] of changes) {
    const keys = path.split('.')
    const last = keys.pop() ?? ''
    let at = copy
    for (const key of keys) at = at[key] as Record<string, unknown>
    if (value === REMOVED) delete at[last]
    else at[last] = value
  }
  return JSON.stringify(copy)
}

function reasonFor(parsed: Parsed<unknown>): string {
  expect(parsed.ok, 'the record was read').toBe(false)
  return parsed.ok ? '' : parsed.reason
}

interface Kind {
  readonly what: string
  readonly record: object
  readonly parse: (text: string) => Parsed<unknown>
  readonly format: string
  /** An object inside the record, to plant an unknown field in. */
  readonly inner: string
}

const KINDS: readonly Kind[] = [
  {
    what: 'manifest',
    record: manifest,
    parse: parseManifest,
    format: 'brobot-checkpoint',
    inner: 'database',
  },
  {
    what: 'journal',
    record: journal,
    parse: parseJournal,
    format: 'brobot-restore',
    inner: 'participants.0.was',
  },
  {
    what: 'gate',
    record: gate,
    parse: parseGate,
    format: 'brobot-history-only',
    inner: 'installed.0',
  },
]

for (const { what, record, parse, format, inner } of KINDS) {
  describe(`the ${what}, read strictly`, () => {
    it('reads a well-formed record as it was written', () => {
      expect(parse(JSON.stringify(record))).toEqual({ ok: true, value: record })
    })

    it('refuses text that is not JSON, or JSON that is not an object', () => {
      expect(reasonFor(parse('{"format":'))).toBe('it is not JSON')
      expect(reasonFor(parse('[]'))).toContain('not an object')
      expect(reasonFor(parse('null'))).toContain('not an object')
    })

    it('refuses an unknown format, including the other records’', () => {
      expect(reasonFor(parse(changed(record, ['format', 'brobot-something'])))).toContain(format)
      for (const other of KINDS.filter((one) => one.what !== what)) {
        expect(reasonFor(parse(JSON.stringify(other.record)))).toContain(format)
      }
    })

    it('refuses version 2, a version written as text, and no version', () => {
      expect(reasonFor(parse(changed(record, ['version', 2])))).toContain('version is 2')
      expect(reasonFor(parse(changed(record, ['version', '1'])))).toContain('version is "1"')
      expect(reasonFor(parse(changed(record, ['version', REMOVED])))).toBe('it has no version')
    })

    it('refuses a record missing any field it knows', () => {
      const known = Object.keys(record).filter((key) => key !== 'format' && key !== 'version')
      expect(known.length).toBeGreaterThan(4)
      for (const key of known) {
        expect(reasonFor(parse(changed(record, [key, REMOVED]))), key).toContain(
          `.${key} is missing`,
        )
      }
    })

    it('reads a record holding fields it does not know, and keeps them on what it returns', () => {
      const text = changed(
        record,
        ['addedLater', { note: 'from a newer build' }],
        [`${inner}.addedLater`, true],
      )
      const parsed = parse(text)
      expect(parsed.ok).toBe(true)
      expect(parsed.ok && JSON.stringify(parsed.value)).toBe(text)
    })
  })
}

describe('the manifest', () => {
  it('refuses a missing or ill-typed field inside it', () => {
    for (const [path, value, said] of [
      ['database.sha256', REMOVED, 'database.sha256'],
      ['database.sha256', 'ABC', 'database.sha256'],
      ['database.bytes', '12', 'database.bytes'],
      ['database.migrations', REMOVED, 'database.migrations'],
      ['database.migrations.0.hash', REMOVED, 'migrations[0].hash'],
      ['database.migrations.0.hash', 'not a hash', 'migrations[0].hash'],
      ['database.migrations.1.createdAt', 1.5, 'migrations[1].createdAt'],
      ['madeBy.build', REMOVED, 'madeBy.build'],
      ['files.0.sha256', REMOVED, 'files[0].sha256'],
      ['files.0.present', 'yes', 'files[0].present'],
      ['files.1.present', REMOVED, 'files[1].present'],
    ] as const) {
      expect(reasonFor(parseManifest(changed(manifest, [path, value]))), path).toContain(said)
    }
  })

  it('refuses migrations that are not oldest first', () => {
    const reversed = [...manifest.database.migrations].reverse()
    expect(
      reasonFor(parseManifest(changed(manifest, ['database.migrations', reversed]))),
    ).toContain('oldest first')
  })

  it('refuses ids it did not make, a copy not named database.sqlite, and names that leave their folder', () => {
    expect(parseManifest(changed(manifest, ['database.file', 'brobot2.sqlite'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['id', '../elsewhere'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['id', 'before-upgrade'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['id', CHECKPOINT.toUpperCase()])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['workspaceId', 'CON'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['files.0.name', '../drafts.json'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['files.0.name', 'nul.json'])).ok).toBe(false)
  })

  it('refuses an unknown reason, a date that is not ISO and a state file named twice', () => {
    expect(parseManifest(changed(manifest, ['reason', 'because'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['reason', 'existing-data'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['createdAt', 'yesterday'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['createdAt', 'Oct 10 2026'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['createdAt', '2026-10-10'])).ok).toBe(false)
    expect(parseManifest(changed(manifest, ['createdAt', '2026-10-10T11:00:00+02:00'])).ok).toBe(
      true,
    )
    expect(parseManifest(changed(manifest, ['files.1.name', 'drafts.json'])).ok).toBe(false)
  })

  it('reads a state file recorded as absent without a size or hash, and a build named', () => {
    expect(parseManifest(changed(manifest, ['madeBy.build', 'abc1234'])).ok).toBe(true)
    expect(parseManifest(changed(manifest, ['files.0.present', false])).ok).toBe(true)
  })
})

describe('the journal', () => {
  it('reads every step, both kinds, and a return’s own places', () => {
    for (const step of STEPS) {
      expect(parseJournal(changed(journal, ['step', step])).ok, step).toBe(true)
    }
    const returning: RestoreJournal = {
      ...journal,
      kind: 'return',
      participants: journal.participants.map((one) => ({
        ...one,
        ...participantPlaces('return', RESTORE, one.live),
      })),
    }
    expect(parseJournal(JSON.stringify(returning))).toEqual({ ok: true, value: returning })
    expect(returning.participants[0]).toMatchObject({
      aside: `recovery/preserved/${RESTORE}-restored/database.sqlite`,
      incoming: `recovery/preserved/${RESTORE}/database.sqlite`,
    })
  })

  it('records each participant’s places as this build computes them', () => {
    expect(
      journal.participants.map(({ live, aside, incoming }) => [live, aside, incoming]),
    ).toEqual([
      [
        'brobot2.sqlite',
        `recovery/preserved/${RESTORE}/database.sqlite`,
        `recovery/staged/${RESTORE}/database.sqlite`,
      ],
      [
        'brobot2.sqlite-wal',
        `recovery/preserved/${RESTORE}/database.sqlite-wal`,
        `recovery/staged/${RESTORE}/database.sqlite-wal`,
      ],
      [
        'brobot2.sqlite-shm',
        `recovery/preserved/${RESTORE}/database.sqlite-shm`,
        `recovery/staged/${RESTORE}/database.sqlite-shm`,
      ],
      [
        'brobot2.sqlite-journal',
        `recovery/preserved/${RESTORE}/database.sqlite-journal`,
        `recovery/staged/${RESTORE}/database.sqlite-journal`,
      ],
      [
        'drafts.json',
        `recovery/preserved/${RESTORE}/drafts.json`,
        `recovery/staged/${RESTORE}/drafts.json`,
      ],
    ])
  })

  it('refuses an unknown step or kind, and an id it did not make', () => {
    expect(parseJournal(changed(journal, ['step', 'half-way'])).ok).toBe(false)
    expect(parseJournal(changed(journal, ['step', 'newer-preserved'])).ok).toBe(false)
    expect(parseJournal(changed(journal, ['kind', 'undo'])).ok).toBe(false)
    expect(parseJournal(changed(journal, ['id', 'r1'])).ok).toBe(false)
    expect(parseJournal(changed(journal, ['checkpointId', 'COM1'])).ok).toBe(false)
  })

  it('refuses a place other than the one this build computes', () => {
    for (const [path, value] of [
      ['participants.0.aside', '../../elsewhere/database.sqlite'],
      ['participants.0.aside', `recovery/preserved/${RESTORE}/brobot2.sqlite`],
      ['participants.0.incoming', `backups/${CHECKPOINT}/database.sqlite`],
      ['participants.4.incoming', `recovery/staged/${RESTORE}/drafts.json/../x`],
    ] as const) {
      expect(reasonFor(parseJournal(changed(journal, [path, value]))), value).toMatch(
        /\.(aside|incoming) is not recovery\//,
      )
    }
  })

  it('refuses a role that is not what the file is, a name twice, and a family member left out', () => {
    expect(parseJournal(changed(journal, ['participants.1.role', 'state'])).ok).toBe(false)
    expect(parseJournal(changed(journal, ['participants.4.role', 'sidecar'])).ok).toBe(false)
    const twice = [...journal.participants, journal.participants[4]]
    expect(reasonFor(parseJournal(changed(journal, ['participants', twice])))).toContain('twice')
    const withoutShm = journal.participants.filter((one) => one.live !== 'brobot2.sqlite-shm')
    expect(reasonFor(parseJournal(changed(journal, ['participants', withoutShm])))).toContain(
      'leaves out brobot2.sqlite-shm',
    )
    expect(parseJournal(changed(journal, ['participants.4.live', 'aux.json'])).ok).toBe(false)
  })

  it('refuses a database absent on either side, an absent file with a hash, and a present one without', () => {
    expect(
      reasonFor(parseJournal(changed(journal, ['participants.0.was', { present: false }]))),
    ).toContain('must be there before and after')
    expect(
      reasonFor(parseJournal(changed(journal, ['participants.0.becomes', { present: false }]))),
    ).toContain('must be there before and after')
    expect(
      reasonFor(
        parseJournal(changed(journal, ['participants.2.was', { present: false, sha256: SHA_A }])),
      ),
    ).toContain('absent and has a sha256')
    expect(
      reasonFor(parseJournal(changed(journal, ['participants.1.was', { present: true }]))),
    ).toContain('was.sha256 is missing')
  })
})

describe('the gate', () => {
  it('refuses a preserved folder other than the one its restore names', () => {
    const another = 'recovery/preserved/another'
    expect(parseGate(changed(gate, ['preserved', another])).ok).toBe(false)
    expect(parseGate(changed(gate, ['preserved', '/Users/someone/elsewhere'])).ok).toBe(false)
  })

  it('refuses a sidecar installed, a database absent or left out, and a name twice', () => {
    const withWal = changed(gate, [
      'installed.1',
      { live: 'brobot2.sqlite-wal', present: true, sha256: SHA_B },
    ])
    expect(reasonFor(parseGate(withWal))).toContain('restored copy is one file')
    expect(
      reasonFor(
        parseGate(changed(gate, ['installed.0', { live: 'brobot2.sqlite', present: false }])),
      ),
    ).toContain('database')
    expect(reasonFor(parseGate(changed(gate, ['installed', gate.installed.slice(1)])))).toContain(
      'leaves out brobot2.sqlite',
    )
    expect(
      reasonFor(parseGate(changed(gate, ['installed', [...gate.installed, gate.installed[4]]]))),
    ).toContain('twice')
    expect(parseGate(changed(gate, ['restoreId', 'restore'])).ok).toBe(false)
  })

  it('records what the restore set aside, sidecars with data included', () => {
    const parsed = parseGate(JSON.stringify(gate))
    expect(parsed.ok && parsed.value.preservedFiles).toEqual(gate.preservedFiles)
  })

  it('refuses a set-aside list without the database, with the database absent, or a name twice', () => {
    expect(
      reasonFor(parseGate(changed(gate, ['preservedFiles', gate.preservedFiles.slice(1)]))),
    ).toContain('preservedFiles leaves out brobot2.sqlite')
    expect(
      reasonFor(
        parseGate(changed(gate, ['preservedFiles.0', { live: 'brobot2.sqlite', present: false }])),
      ),
    ).toContain('preservedFiles[0] is the database')
    expect(
      reasonFor(
        parseGate(
          changed(gate, ['preservedFiles', [...gate.preservedFiles, gate.preservedFiles[1]]]),
        ),
      ),
    ).toContain('twice')
    expect(
      reasonFor(parseGate(changed(gate, ['preservedFiles.1', { live: 'brobot2.sqlite-wal' }]))),
    ).toContain('preservedFiles[1].present')
    expect(
      reasonFor(
        parseGate(changed(gate, ['preservedFiles.4', { live: '../drafts.json', present: false }])),
      ),
    ).toContain('preservedFiles[4].live')
    expect(parseGate(changed(gate, ['preservedFiles', 'all of them'])).ok).toBe(false)
  })
})

describe('writing a record', () => {
  it('writes text this build reads back as the same record', () => {
    expect(parseManifest(serializeManifest(manifest))).toEqual({ ok: true, value: manifest })
    expect(parseJournal(serializeJournal(journal))).toEqual({ ok: true, value: journal })
    expect(parseGate(serializeGate(gate))).toEqual({ ok: true, value: gate })
    expect(serializeGate(gate).endsWith('}\n')).toBe(true)
  })

  it('keeps fields it does not know when a record it read is written again', () => {
    const parsed = parseJournal(
      changed(journal, ['addedLater', 'kept'], ['participants.0.addedLater', 1]),
    )
    if (!parsed.ok) throw new Error(parsed.reason)
    const rewritten = JSON.parse(serializeJournal({ ...parsed.value, step: 'installed' })) as {
      step: string
      addedLater: string
      participants: { addedLater?: number }[]
    }
    expect(rewritten.step).toBe('installed')
    expect(rewritten.addedLater).toBe('kept')
    expect(rewritten.participants[0]?.addedLater).toBe(1)
  })

  it('refuses to write a record it would refuse to read', () => {
    expect(() => serializeJournal({ ...journal, step: 'half-way' as never })).toThrow(
      'would not be read back',
    )
  })
})

describe('the workspace id', () => {
  it('is the file’s one line, or nothing when the file holds something else', () => {
    expect(parseWorkspaceId(`${WORKSPACE}\n`)).toBe(WORKSPACE)
    expect(parseWorkspaceId('')).toBeNull()
    expect(parseWorkspaceId('../x')).toBeNull()
    expect(parseWorkspaceId('two words')).toBeNull()
    expect(parseWorkspaceId('another-one')).toBeNull()
  })
})

describe('names and ids', () => {
  it('takes as ids only the lowercase version-4 UUIDs the app makes', () => {
    expect(isUuid(RESTORE)).toBe(true)
    expect(isUuid(randomUUID())).toBe(true)
    expect(isUuid(RESTORE.toUpperCase())).toBe(false)
    expect(isUuid('9b8e7d6c-5a4b-1c3d-8e2f-0a1b2c3d4e5f')).toBe(false)
    expect(isUuid(`${RESTORE}-restored`)).toBe(false)
    expect(isUuid('before-upgrade')).toBe(false)
  })

  it('refuses Windows device names, with or without an extension, and a name ending in a dot', () => {
    for (const name of [
      'CON',
      'con',
      'PRN.txt',
      'aux.json',
      'NUL',
      'nul.tar.gz',
      'COM1',
      'com9.log',
      'LPT1',
      'lpt9.json',
      'drafts.',
      'drafts ',
      '../drafts.json',
      'a/b',
      'a\\b',
      '.hidden',
    ]) {
      expect(isSafeName(name), name).toBe(false)
    }
    for (const name of [
      'drafts.json',
      'console.json',
      'nullable',
      'COM10',
      'database.sqlite-wal',
    ]) {
      expect(isSafeName(name), name).toBe(true)
    }
  })

  it('reads a recorded place only inside recovery/', () => {
    const userData = join('/', 'data')
    expect(fromRecorded(userData, `recovery/staged/${RESTORE}/database.sqlite`)).toBe(
      join(userData, 'recovery', 'staged', RESTORE, 'database.sqlite'),
    )
    expect(() => fromRecorded(userData, 'backups/x/database.sqlite')).toThrow('inside recovery/')
    expect(() => fromRecorded(userData, 'recovery/../brobot2.sqlite')).toThrow()
  })
})
