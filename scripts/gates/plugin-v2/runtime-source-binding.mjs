import path from 'node:path'
import { BASE, demand, readFile, hash, below } from './contract.mjs'

export function verifyRuntimeSource(repository, pins) {
  demand(pins && Object.keys(pins).sort().join(',') === 'baseline,files,schema')
  demand(pins.schema === 1 && pins.baseline === BASE)
  demand(Array.isArray(pins.files) && pins.files.length === 20)
  const seen = new Set()
  for (const entry of pins.files) {
    demand(entry && Object.keys(entry).sort().join(',') === 'bytes,path,sha256')
    demand(typeof entry.path === 'string' && !entry.path.includes('\\'))
    demand(entry.path.split('/').every((part) => part !== '' && part !== '.' && part !== '..'))
    demand(!path.isAbsolute(entry.path) && below(repository, path.resolve(repository, entry.path)))
    demand(!seen.has(entry.path) && /^[a-f0-9]{64}$/.test(entry.sha256))
    demand(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= 16 * 1024 * 1024)
    seen.add(entry.path)
    const bytes = readFile(path.resolve(repository, entry.path), entry.bytes)
    demand(bytes.length === entry.bytes && hash(bytes) === entry.sha256)
  }
  return hash(Buffer.from(JSON.stringify(pins)))
}
