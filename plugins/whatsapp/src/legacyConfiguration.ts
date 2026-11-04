import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface LegacyConfiguration {
  directory: string
  floor: string
}
export interface ConsumedConfiguration {
  format: 1
  source: LegacyConfiguration
  installId: string | null
  consumedRevision: number
}
const invalid = (): never => {
  throw new Error('Cannot import legacy configuration boundary. Existing data was kept.')
}
const revision = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : invalid()
function optional<T>(read: () => T): T | undefined {
  try {
    return read()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
function sourceOf(value: unknown): LegacyConfiguration {
  const source = value as Partial<LegacyConfiguration> | null
  if (
    !source ||
    typeof source.directory !== 'string' ||
    !path.isAbsolute(source.directory) ||
    typeof source.floor !== 'string' ||
    !path.isAbsolute(source.floor)
  )
    return invalid()
  return { directory: source.directory, floor: source.floor }
}

/** Import only consumption. Old proposals are neither read nor executed; their bytes stay put. */
export function importLegacyConfiguration(
  home: string,
  input?: LegacyConfiguration,
): ConsumedConfiguration | undefined {
  const file = path.join(home, 'legacy-configuration.json')
  const saved = optional(() => JSON.parse(fs.readFileSync(file, 'utf8')) as ConsumedConfiguration)
  const source = input === undefined ? undefined : sourceOf(input)
  if (saved !== undefined) {
    if (saved.format !== 1 || (saved.installId !== null && typeof saved.installId !== 'string'))
      return invalid()
    revision(saved.consumedRevision)
    const original = sourceOf(saved.source)
    if (source && (source.directory !== original.directory || source.floor !== original.floor))
      return invalid()
    return saved
  }
  if (!source) return undefined
  let found = false
  let installId: string | null = null
  let consumedRevision = 0
  const associate = (value: unknown) => {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      (installId !== null && installId !== value)
    )
      return invalid()
    installId = value
  }
  const birth = optional(() => fs.readFileSync(path.join(source.directory, 'birth'), 'utf8'))
  if (birth !== undefined) {
    found = true
    associate(birth)
  }
  const boundary = (text: string) => {
    found = true
    const record = JSON.parse(text) as { format?: unknown; installId?: unknown; revision?: unknown }
    if (record.format !== 2) return invalid()
    associate(record.installId)
    consumedRevision = Math.max(consumedRevision, revision(record.revision))
  }
  const floor = optional(() => fs.readFileSync(source.floor, 'utf8'))
  if (floor !== undefined) {
    found = true
    if (/^\d+$/.test(floor.trim())) consumedRevision = revision(Number(floor.trim()))
    else boundary(floor)
  }
  const checkpoint = optional(() =>
    fs.readFileSync(path.join(source.directory, 'checkpoint.json'), 'utf8'),
  )
  if (checkpoint !== undefined) boundary(checkpoint)
  const names = optional(() => fs.readdirSync(path.join(source.directory, 'intents')))
  if (names !== undefined) found = true
  for (const name of names ?? []) {
    // Rename published a reservation before its effect; a crash never makes it replayable.
    if (/^(?:\d{8}|\d{16})\.json$/.test(name))
      consumedRevision = Math.max(consumedRevision, revision(Number(name.slice(0, -5))))
  }
  if (!found) return undefined
  const marker: ConsumedConfiguration = { format: 1, source, installId, consumedRevision }
  const stage = path.join(home, '.legacy-configuration-' + randomUUID() + '.json')
  let handle: number | undefined
  try {
    handle = fs.openSync(stage, 'wx', 0o600)
    fs.writeFileSync(handle, JSON.stringify(marker) + '\n')
    fs.fsyncSync(handle)
    fs.closeSync(handle)
    handle = undefined
    fs.renameSync(stage, file)
    if (process.platform !== 'win32') {
      const directory = fs.openSync(home, 'r')
      try {
        fs.fsyncSync(directory)
      } finally {
        fs.closeSync(directory)
      }
    }
  } finally {
    if (handle !== undefined) fs.closeSync(handle)
    fs.rmSync(stage, { force: true })
  }
  return marker
}
