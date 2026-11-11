import type * as fs from 'node:fs'
import { Readable } from 'node:stream'

export function fileReader(
  io: Pick<typeof fs, 'closeSync' | 'read'>,
  fdFinal: number,
  size: number,
) {
  let closed = false
  const close = (): void => {
    if (closed) return
    closed = true
    try {
      io.closeSync(fdFinal)
    } catch {
      /* Continue without this optional result. */
    }
  }
  return {
    stream: () => {
      let position = 0
      return new Readable({
        read(): void {
          if (closed) {
            this.destroy(new Error('The file was closed before it was read.'))
            return
          }
          const length = Math.min(65536, size - position)
          if (length <= 0) {
            this.push(null)
            return
          }
          const chunk = Buffer.allocUnsafe(length)
          io.read(fdFinal, chunk, 0, length, position, (error, bytes) => {
            if (error) {
              this.destroy(error)
            } else if (bytes === 0) {
              this.push(null)
            } else {
              position += bytes
              this.push(chunk.subarray(0, bytes))
            }
          })
        },
      })
    },
    close,
  }
}
