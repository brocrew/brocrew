import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

export interface LegacyConfigurationInput {
  directory: string
  floor: string
}
export const LEGACY_MARKER = 'legacy-configuration-import.json'
function optional(file: string): Buffer | undefined {
  try {
    return fs.readFileSync(file)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** Import consumption metadata only. Intent command bodies are never opened or executed. */
export function importLegacyConfiguration(
  home: string,
  input?: LegacyConfigurationInput,
  beforePublish?: () => void,
): void {
  if (!input) return
  const source = { directory: path.resolve(input.directory), floor: path.resolve(input.floor) }
  const marker = path.join(home, LEGACY_MARKER)
  const existing = optional(marker)
  if (existing) {
    const value: unknown = JSON.parse(existing.toString('utf8'))
    if (
      !record(value) ||
      value.format !== 1 ||
      value.consumed !== true ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 0 ||
      !record(value.source) ||
      (value.installId !== undefined &&
        (typeof value.installId !== 'string' || !value.installId.trim()))
    )
      throw new Error('Legacy Chrome import marker is invalid.')
    if (value.source.directory !== source.directory || value.source.floor !== source.floor)
      throw new Error('Legacy Chrome import source does not match.')
  }
  let installId: string | undefined
  let revision = 0
  let previous: string | null = null
  let found = false
  const rememberInstall = (id: string): void => {
    if (!id.trim()) throw new Error('Legacy Chrome installation metadata is invalid.')
    if (installId !== undefined && installId !== id)
      throw new Error('Legacy Chrome installation does not match.')
    installId = id
  }
  const consume = (value: unknown): void => {
    if (
      !record(value) ||
      value.format !== 2 ||
      typeof value.installId !== 'string' ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 0 ||
      !(
        value.previous === null ||
        (typeof value.previous === 'string' && /^[a-f0-9]{64}$/.test(value.previous))
      ) ||
      (value.revision === 0) !== (value.previous === null)
    )
      throw new Error('Legacy Chrome configuration metadata is invalid.')
    rememberInstall(value.installId)
    found = true
    if ((value.revision as number) >= revision) {
      revision = value.revision as number
      previous = value.previous as string | null
    }
  }
  const birth = optional(path.join(source.directory, 'birth'))
  if (birth) {
    rememberInstall(birth.toString('utf8'))
    found = true
  }
  const floor = optional(source.floor)
  if (floor) {
    const text = floor.toString('utf8')
    if (/^\d+$/.test(text)) {
      const value = Number(text)
      if (!Number.isSafeInteger(value))
        throw new Error('Legacy Chrome consumption boundary is invalid.')
      revision = value
      found = true
    } else consume(JSON.parse(text))
  }
  const checkpoint = optional(path.join(source.directory, 'checkpoint.json'))
  if (checkpoint) consume(JSON.parse(checkpoint.toString('utf8')))
  if (existing) {
    const value = JSON.parse(existing.toString('utf8')) as { installId?: string }
    if (installId !== undefined && value.installId !== installId)
      throw new Error('Legacy Chrome installation does not match.')
    return
  }
  let names: string[]
  try {
    names = fs.readdirSync(path.join(source.directory, 'intents'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    names = []
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue // Unpublished staging names are not consumed reservations.
    if (!/^(?:\d{8}|\d{16})\.json$/.test(name))
      throw new Error('Legacy Chrome intent filename is invalid.')
    const publishedRevision = Number(name.slice(0, -5))
    if (!Number.isSafeInteger(publishedRevision) || publishedRevision < 1)
      throw new Error('Legacy Chrome intent filename is invalid.')
    found = true
    if (publishedRevision > revision) {
      revision = publishedRevision
      previous = null
    }
  }
  if (!found) return
  const bytes =
    JSON.stringify({ format: 1, source, installId, revision, previous, consumed: true }) + '\n'
  const stage = path.join(home, '.legacy-import-' + randomUUID())
  try {
    const fd = fs.openSync(stage, 'wx', 0o600)
    try {
      fs.writeFileSync(fd, bytes)
      fs.fsyncSync(fd)
    } finally {
      fs.closeSync(fd)
    }
    beforePublish?.()
    fs.renameSync(stage, marker)
    if (process.platform !== 'win32') {
      const directory = fs.openSync(home, 'r')
      try {
        fs.fsyncSync(directory)
      } finally {
        fs.closeSync(directory)
      }
    }
  } finally {
    fs.rmSync(stage, { force: true })
  }
}
