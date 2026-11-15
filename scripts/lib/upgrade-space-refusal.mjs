import { createHash, randomBytes } from 'node:crypto'
import {
  closeSync,
  cpSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeSync,
} from 'node:fs'
import { join, relative } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createSafetyVolume } from './upgrade-space-volume.mjs'
import { requireEvidence } from './upgrade-path.mjs'
import { until } from './update-rehearsal-app.mjs'

const hash = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')
export function backupFacts(folder) {
  const root = join(folder, 'backups')
  const files = []
  const walk = (path) => {
    if (!existsSync(path)) return
    for (const name of readdirSync(path)) {
      const file = join(path, name)
      const stat = lstatSync(file)
      requireEvidence(!stat.isSymbolicLink(), 'The fictional backup contains a symbolic link.')
      if (stat.isDirectory()) walk(file)
      else files.push({ name: relative(root, file), bytes: stat.size, sha256: hash(file) })
    }
  }
  walk(root)
  return files.sort((a, b) => a.name.localeCompare(b.name))
}

export function fillForRefusal(folder, volume, compact = false) {
  const file = join(volume.root, 'owned-space-filler')
  const db = new DatabaseSync(join(folder, 'brobot2.sqlite'), { readOnly: true })
  let needed
  try {
    const size = Number(db.prepare('PRAGMA page_size').get().page_size)
    const pages = Number(db.prepare('PRAGMA page_count').get().page_count)
    const free = compact ? Number(db.prepare('PRAGMA freelist_count').get().freelist_count) : 0
    needed = Math.ceil((pages - free) * size * 1.1) + 64 * 1024 ** 2
  } finally {
    db.close()
  }
  const block = randomBytes(1024 ** 2)
  const fd = openSync(file, 'wx')
  let written = 0
  try {
    while (volume.free() > 33 * 1024 ** 2) {
      requireEvidence(written < 768 * 1024 ** 2, 'The bounded filler exceeded its volume budget.')
      let offset = 0
      while (offset < block.length) {
        const count = writeSync(fd, block, offset, block.length - offset)
        requireEvidence(count > 0, 'The filler write made no progress.')
        offset += count
      }
      written += block.length
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  const free = volume.free()
  const backups = backupFacts(folder)
  const estimate = backups.reduce((sum, entry) => sum + entry.bytes, 0)
  requireEvidence(
    free + estimate < needed,
    'This fixture does not establish a preliminary space refusal.',
  )
  return {
    file,
    written,
    free,
    needed,
    eligibleBackupEstimateUpperBound: estimate,
    backups,
    release: () => rmSync(file),
  }
}

export async function proveMigrationSpaceRefusal({
  os,
  baseline,
  launch,
  evaluate,
  ready,
  quit,
  settle,
  keep,
}) {
  const volume = createSafetyVolume(os, keep)
  const folder = join(volume.root, 'workspace')
  mkdirSync(folder)
  cpSync(baseline, folder, { recursive: true })
  const file = join(folder, 'brobot2.sqlite')
  const before = hash(file)
  const sourceDatabaseBytes = lstatSync(file).size
  const filler = fillForRefusal(folder, volume)
  const samples = []
  let sampler
  keep('migration-space-input.json', { ...filler, release: undefined })
  try {
    await launch('migration-space-refusal', folder, true)
    const verdict = await until(
      async () => {
        const value = await evaluate('return window.recovery?.verdict()')
        return value?.kind === 'working' ? null : value
      },
      120_000,
      100,
    )
    requireEvidence(
      verdict?.kind === 'failed' &&
        verdict.reason === 'checkpoint-failed' &&
        /^BroCrew needs about .+ more space to replace its recovery copy\. Existing recovery files were kept\.$/.test(
          verdict.detail ?? '',
        ),
      'The nearly-full migration did not give the expected recovery space refusal.',
    )
    await quit('migration space refusal')
    requireEvidence(hash(file) === before, 'The refused migration changed the live database bytes.')
    requireEvidence(
      JSON.stringify(backupFacts(folder)) === JSON.stringify(filler.backups),
      'The preliminary space refusal changed an existing backup.',
    )
    filler.release()
    samples.push({ at: Date.now(), free: volume.free() })
    sampler = setInterval(() => samples.push({ at: Date.now(), free: volume.free() }), 10)
    await launch('migration-space-retry', folder, false)
    await ready()
    await quit('migration after space was freed')
    const copies = readdirSync(join(folder, 'backups')).filter((name) =>
      existsSync(join(folder, 'backups', name, 'manifest.json')),
    )
    requireEvidence(
      copies.length === 1,
      'The admitted migration did not leave exactly one completed backup.',
    )
    samples.push({ at: Date.now(), free: volume.free() })
    const result = {
      before,
      afterRefusal: before,
      verdict,
      freeAtRefusal: filler.free,
      needed: filler.needed,
      backupCountAfterRetry: copies.length,
      sourceDatabaseBytes,
      liveDatabaseBytes: lstatSync(file).size,
      fillerBytes: filler.written,
      sampledVolumeBytesSinceAttach:
        volume.record.freeAtAttach - Math.min(...samples.map((entry) => entry.free)),
      sampleCount: samples.length,
      peakScope: 'sampled volume allocation lower bound; filler removed before sampling',
    }
    keep('migration-space-refusal.json', result)
    keep('migration-space-samples.json', samples)
    return result
  } finally {
    clearInterval(sampler)
    await settle()
    volume.dispose()
  }
}
