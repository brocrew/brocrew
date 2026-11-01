import { afterEach, expect, it, vi } from 'vitest'
import { readBootWitness } from '../resources/plugin-host/boot-witness.mjs'

const output = vi.hoisted(() => ({
  stdout: '12345678-1234-1234-1234-123456789abc\n',
  stderr: '',
  fail: false,
}))
afterEach(() => {
  output.stderr = ''
  output.fail = false
})
vi.mock('node:child_process', async (original) => {
  const actual = await original<typeof import('node:child_process')>()
  const execFile = Object.assign(
    () => {
      throw new Error('Expected the promisified reader')
    },
    {
      [Symbol.for('nodejs.util.promisify.custom')]: async () => {
        if (output.fail)
          throw Object.assign(new Error('Fictional nonzero native exit'), {
            code: 1,
            stdout: output.stdout,
            stderr: '',
          })
        return output
      },
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
it('refuses a nonzero native exit even with valid-looking stdout', async () => {
  output.fail = true
  expect(await readBootWitness({ platform: 'darwin' })).toBeNull()
})
