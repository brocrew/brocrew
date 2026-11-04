import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

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

/** Import consumption metadata only. Proposals are never interpreted, retained or executed. */
export function importLegacyConfiguration(
  home: string,
  input?: LegacyConfigurationInput,
  beforePublish?: () => void,
): void {
  if (!input) return
  const marker = path.join(home, LEGACY_MARKER)
  const existing = optional(marker)
  if (existing) {
    const value: unknown = JSON.parse(existing.toString('utf8'))
    if (
      !record(value) ||
      value.format !== 1 ||
      value.consumed !== true ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 0
    )
      throw new Error('Legacy Chrome import marker is invalid.')
    return
  }
  let installId: string | undefined
  let revision = 0
  let previous: string | null = null
  let found = false
  const consume = (value: unknown, hash?: string): void => {
    if (
      !record(value) ||
      (value.format !== 1 && value.format !== 2) ||
      typeof value.installId !== 'string' ||
      !Number.isSafeInteger(value.revision) ||
      (value.revision as number) < 0 ||
      !(value.previous === null || typeof value.previous === 'string')
    )
      throw new Error('Legacy Chrome configuration metadata is invalid.')
    if (installId && installId !== value.installId)
      throw new Error('Legacy Chrome installation does not match.')
    installId = value.installId
    found = true
    if ((value.revision as number) >= revision) {
      revision = value.revision as number
      previous = hash ?? (value.previous as string | null)
    }
  }
  const birth = optional(path.join(input.directory, 'birth'))
  if (birth) {
    installId = birth.toString('utf8')
    found = true
  }
  const floor = optional(input.floor)
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
  const checkpoint = optional(path.join(input.directory, 'checkpoint.json'))
  if (checkpoint) consume(JSON.parse(checkpoint.toString('utf8')))
  let names: string[]
  try {
    names = fs.readdirSync(path.join(input.directory, 'intents'))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    names = []
  }
  for (const name of names.filter((name) => /^\d+\.json$/.test(name)).sort()) {
    const bytes = fs.readFileSync(path.join(input.directory, 'intents', name))
    consume(JSON.parse(bytes.toString('utf8')), createHash('sha256').update(bytes).digest('hex'))
  }
  if (!found) return
  const bytes = JSON.stringify({ format: 1, installId, revision, previous, consumed: true }) + '\n'
  const stage = path.join(home, '.legacy-import-' + randomUUID())
  const fd = fs.openSync(stage, 'wx', 0o600)
  try {
    fs.writeFileSync(fd, bytes)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }
  try {
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
