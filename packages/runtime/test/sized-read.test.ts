import { afterEach, expect, it, vi } from 'vitest'
import { readSizedUtf8Sync } from '../src/sized-read'

const { read } = vi.hoisted(() => ({
  read: vi.fn<
    (fd: number, buffer: Buffer, offset: number, length: number, position: number) => number
  >(),
}))
vi.mock('node:fs', () => ({ readSync: read }))
afterEach(() => read.mockReset())

it('returns empty text without reading a zero-sized file', () => {
  expect(readSizedUtf8Sync(41, 0)).toBe('')
  expect(read).not.toHaveBeenCalled()
})

it('joins short positional reads before decoding split UTF-8 characters', () => {
  const bytes = Buffer.from('A€😀B')
  read.mockImplementation((_fd, buffer, offset, length, position) => {
    const end = Math.min(position + 2, bytes.length)
    return bytes.copy(buffer, offset, position, Math.min(end, position + length))
  })
  expect(readSizedUtf8Sync(41, bytes.length)).toBe('A€😀B')
  expect(
    read.mock.calls.map(([fd, , offset, length, position]) => [fd, offset, length, position]),
  ).toEqual([
    [41, 0, 9, 0],
    [41, 2, 7, 2],
    [41, 4, 5, 4],
    [41, 6, 3, 6],
    [41, 8, 1, 8],
  ])
})

it('stops on EOF after a file shrinks and decodes only bytes actually read', () => {
  read.mockImplementationOnce((_fd, buffer) => buffer.write('kept')).mockReturnValueOnce(0)
  expect(readSizedUtf8Sync(41, 20)).toBe('kept')
  expect(read).toHaveBeenCalledTimes(2)
})

it('does not read bytes appended beyond the admitted size', () => {
  const bytes = Buffer.from('first appended')
  read.mockImplementation((_fd, buffer, offset, length, position) =>
    bytes.copy(buffer, offset, position, position + length),
  )
  expect(readSizedUtf8Sync(41, 5)).toBe('first')
  expect(read).toHaveBeenCalledTimes(1)
})

it('passes the original read failure to the caller', () => {
  const failure = new Error('read failed')
  read.mockImplementation(() => {
    throw failure
  })
  expect(() => readSizedUtf8Sync(41, 8)).toThrow(failure)
})
