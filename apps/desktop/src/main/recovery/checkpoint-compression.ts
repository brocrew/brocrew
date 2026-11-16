import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { syncFolder, type RecoveryFs, type RecoveryFileHandle } from './files'

export interface PlainDatabaseFacts {
  readonly bytes: number
  readonly sha256: string
}

/** Streams the closed source directly into its compressed checkpoint; no plain staging copy. */
export function gzipCheckpoint(
  source: string,
  target: string,
  fs: RecoveryFs,
  signal?: AbortSignal,
): Promise<PlainDatabaseFacts> {
  return transcode(source, target, fs, true, undefined, signal)
}

export function gunzipCheckpoint(
  source: string,
  target: string,
  expectedBytes: number,
  fs: RecoveryFs,
  signal?: AbortSignal,
): Promise<PlainDatabaseFacts> {
  return transcode(source, target, fs, false, expectedBytes, signal)
}

async function transcode(
  source: string,
  target: string,
  fs: RecoveryFs,
  compress: boolean,
  expectedBytes?: number,
  signal?: AbortSignal,
): Promise<PlainDatabaseFacts> {
  signal?.throwIfAborted()
  const input = await fs.open(source, 'r')
  let output: RecoveryFileHandle | undefined
  let failed = false
  let failure: unknown
  let result!: PlainDatabaseFacts
  try {
    output = await fs.open(target, 'wx', 0o600)
    const destination = output
    const hash = createHash('sha256')
    let bytes = 0
    const inspect = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length
        if (expectedBytes !== undefined && bytes > expectedBytes) {
          done(new Error('The recovery copy expands beyond its recorded database size.'))
          return
        }
        hash.update(chunk)
        done(null, chunk)
      },
    })
    async function* chunks() {
      for (;;) {
        signal?.throwIfAborted()
        const buffer = Buffer.allocUnsafe(256 * 1024)
        const { bytesRead } = await input.read(buffer, 0, buffer.length, null)
        if (bytesRead === 0) return
        yield buffer.subarray(0, bytesRead)
      }
    }
    const sink = new Writable({
      write(chunk: Buffer, _encoding, done) {
        void destination.writeFile(chunk).then(
          () => done(),
          (error: Error) => done(error),
        )
      },
    })
    const stages = compress ? [inspect, createGzip({ level: 1 })] : [createGunzip(), inspect]
    await pipeline([Readable.from(chunks()), ...stages, sink], { signal })
    if (expectedBytes !== undefined && bytes !== expectedBytes)
      throw new Error('The recovery copy does not hold its recorded database size.')
    await destination.sync()
    await syncFolder(dirname(target), fs)
    result = { bytes, sha256: hash.digest('hex') }
  } catch (error) {
    failed = true
    failure = error
  }
  const closed = await Promise.allSettled([input.close(), ...(output ? [output.close()] : [])])
  const errors = closed.flatMap((one) => (one.status === 'rejected' ? [one.reason] : []))
  if (errors.length > 0)
    throw new AggregateError(
      failed ? [failure, ...errors] : errors,
      'Recovery stream close failed.',
    )
  if (failed) throw failure
  return result
}
