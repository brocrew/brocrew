import { openSync, writeFileSync, fsyncSync, closeSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
// Only the guardian writes while it is alive. No token, environment or plugin log is retained.
export function writeReceipt(root, name, value) {
  const temporary = join(root, `${name}.${process.pid}.new`)
  const fd = openSync(temporary, 'wx', 0o600)
  try {
    writeFileSync(fd, JSON.stringify(value) + '\n')
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  try {
    renameSync(temporary, join(root, name))
  } catch (e) {
    unlinkSync(temporary)
    throw e
  }
  // Windows opens no directory to fsync it, and NTFS journals the rename itself.
  if (process.platform === 'win32') return
  const directory = openSync(root, 'r')
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}
