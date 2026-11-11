import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { buffer } from 'node:stream/consumers'
import { afterEach, expect, it } from 'vitest'
import { fileReader } from '../../shared/file-reader.js'
import { openGuardedFile } from '../src/localFileGuard.js'

const cleanup: (() => void)[] = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
})
function fixture(data: Buffer) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-reader-'))
  cleanup.push(() => fs.rmSync(home, { recursive: true, force: true }))
  const file = path.join(home, 'fictional.txt')
  fs.writeFileSync(file, data)
  const fd = fs.openSync(file, 'r')
  const reader = fileReader(fs, fd, data.length)
  cleanup.push(reader.close)
  return { home, file, fd, reader }
}
it('streams multiple chunks from the beginning each time and leaves closing to its owner', async () => {
  const data = Buffer.alloc(140000, 'fictional bytes ')
  const { fd, reader } = fixture(data)
  expect(await buffer(reader.stream())).toEqual(data)
  expect(await buffer(reader.stream())).toEqual(data)
  expect(fs.fstatSync(fd).size).toBe(data.length)
  reader.close()
  reader.close()
  expect(() => fs.fstatSync(fd)).toThrow(/EBADF/)
  await expect(buffer(reader.stream())).rejects.toThrow('The file was closed before it was read.')
})
it('forwards a native read error and tolerates an already closed descriptor', async () => {
  const { fd, reader } = fixture(Buffer.from('fictional bytes'))
  fs.closeSync(fd)
  await expect(buffer(reader.stream())).rejects.toMatchObject({ code: 'EBADF' })
  expect(() => reader.close()).not.toThrow()
})
it('keeps Chrome home expansion and readAll short reads with the same close owner', () => {
  const { home, file } = fixture(Buffer.from('fictional original bytes'))
  const guarded = openGuardedFile('~/fictional.txt', {
    roots: ['~'],
    hostHome: home,
    mount: '',
    maxBytes: 1024,
  })
  cleanup.push(guarded.close)
  expect(guarded.realPath).toBe(fs.realpathSync(file))
  expect(guarded.name).toBe('fictional.txt')
  expect(guarded.extension).toBe('txt')
  fs.truncateSync(file, 3)
  expect(guarded.readAll()).toEqual(Buffer.from('fic'))
  guarded.close()
  expect(() => fs.fstatSync(guarded.fd)).toThrow(/EBADF/)
})
