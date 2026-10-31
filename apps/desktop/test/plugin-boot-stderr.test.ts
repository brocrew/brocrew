import { expect, it, vi } from 'vitest'
import { readBootWitness } from '../resources/plugin-host/boot-witness.mjs'

const output = vi.hoisted(() => ({ stdout: '12345678-1234-1234-1234-123456789abc\n', stderr: '' }))
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  const execFile = Object.assign(
    () => {
      throw new Error('Expected the promisified reader')
    },
    {
      [Symbol.for('nodejs.util.promisify.custom')]: async () => output,
    },
  )
  return { ...actual, execFile }
})

it.each(['', 'fictional native reader warning'])(
  'requires successful native output without error text: %j',
  async (stderr) => {
    output.stderr = stderr
    expect(await readBootWitness({ platform: 'darwin' })).toEqual(
      stderr
        ? null
        : {
            kind: 'darwin-boot-session-v1',
            value: output.stdout.trim(),
          },
    )
  },
)
