import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import { Readable, Transform, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { promisify } from 'node:util'
import { createGunzip, gzip } from 'node:zlib'
import { syncFolder, type RecoveryFs, type RecoveryFileHandle } from './files'

export interface PlainDatabaseFacts {
  readonly bytes: number
  readonly sha256: string
}

const PIECE_BYTES = 16 * 1024 * 1024
/** Matches Node's default thread pool, where zlib compresses. */
const PIECES_AT_ONCE = 4
const gzipPiece = promisify(gzip)

/**
 * Streams the closed source into its compressed checkpoint; no plain staging copy. Pieces are
 * compressed side by side and written in order as separate gzip members, which is one gzip file.
 */
export function gzipCheckpoint(
  source: string,
  target: string,
  fs: RecoveryFs,
  signal?: AbortSignal,
): Promise<PlainDatabaseFacts> {
  return withFiles(source, target, fs, signal, async (input, output) => {
    const hash = createHash('sha256')
    let bytes = 0
    let ended = false
    const compressing: Promise<Buffer>[] = []
    try {
      for (;;) {
        while (!ended && compressing.length < PIECES_AT_ONCE) {
          signal?.throwIfAborted()
          const buffer = Buffer.allocUnsafe(PIECE_BYTES)
          const { bytesRead } = await input.read(buffer, 0, buffer.length, null)
          if (bytesRead === 0) ended = true
          else {
            const piece = buffer.subarray(0, bytesRead)
            bytes += bytesRead
            hash.update(piece)
            const compressed = gzipPiece(piece, { level: 1 })
            // A piece that fails while an earlier one is written is reported when its turn comes.
            compressed.catch(() => undefined)
            compressing.push(compressed)
          }
        }
        const next = compressing.shift()
        if (next === undefined) break
        const written = await next
        signal?.throwIfAborted()
        await output.writeFile(written)
      }
    } finally {
      // A gzip already started cannot be stopped; the files close only once none is running.
      await Promise.allSettled(compressing)
    }
    return { bytes, sha256: hash.digest('hex') }
  })
}

export function gunzipCheckpoint(
  source: string,
  target: string,
  expectedBytes: number,
  fs: RecoveryFs,
  signal?: AbortSignal,
): Promise<PlainDatabaseFacts> {
  return withFiles(source, target, fs, signal, async (input, destination) => {
    const hash = createHash('sha256')
    let bytes = 0
    const inspect = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        bytes += chunk.length
        if (bytes > expectedBytes) {
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
    await pipeline([Readable.from(chunks()), createGunzip(), inspect, sink], { signal })
    if (bytes !== expectedBytes)
      throw new Error('The recovery copy does not hold its recorded database size.')
    return { bytes, sha256: hash.digest('hex') }
  })
}

/** Opens both files, runs `work`, makes the target durable, and closes both whatever happens. */
async function withFiles(
  source: string,
  target: string,
  fs: RecoveryFs,
  signal: AbortSignal | undefined,
  work: (input: RecoveryFileHandle, output: RecoveryFileHandle) => Promise<PlainDatabaseFacts>,
): Promise<PlainDatabaseFacts> {
  signal?.throwIfAborted()
  const input = await fs.open(source, 'r')
  let output: RecoveryFileHandle | undefined
  let failed = false
  let failure: unknown
  let result!: PlainDatabaseFacts
  try {
    output = await fs.open(target, 'wx', 0o600)
    result = await work(input, output)
    await output.sync()
    await syncFolder(dirname(target), fs)
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
