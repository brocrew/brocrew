import { readSync } from 'node:fs'

// The caller admits and closes the file; reads start at byte zero and stop at the supplied size.
export function readSizedUtf8Sync(fd: number, size: number): string {
  const buffer = Buffer.alloc(size)
  let read = 0
  while (read < size) {
    const got = readSync(fd, buffer, read, size - read, read)
    if (got === 0) break
    read += got
  }
  return buffer.subarray(0, read).toString('utf8')
}
