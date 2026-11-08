import fs from 'node:fs'
import path from 'node:path'
import { spawn as spawnChild } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { observeApp } from '../gates/plugin-packaged/probe.mjs'

afterEach(() => vi.restoreAllMocks())

function journeyStartApp(spawn) {
  const source = fs.readFileSync(
    new URL('../gates/plugin-packaged/journey.mjs', import.meta.url),
    'utf8',
  )
  const body = source.slice(
    source.indexOf('async function startApp('),
    source.indexOf('async function plugins('),
  )
  const io = {
    path,
    HIDDEN_LAUNCH_ARG: '--brobot-hidden',
    freePort: async () => 12345,
    fixtureAppEnvironment: () => ({}),
    readOwned: () => '{}',
    requireSelection: () => ({}),
    observeApp,
    probeStep: async (_name, work) => work(),
    spawn,
    registerChild: async () => {},
    phaseStep: async (_root, _phase, work) => work(),
    integrityCheckpoint: async () => {},
    waitDevtools: async () => {},
    bounded: (work) => work,
    attach: async () => ({ evaluate: async () => true }),
  }
  return Function(...Object.keys(io), 'return (' + body + ')')(...Object.values(io))
}

it('keeps every nested stdout and stderr byte, including bytes written just before exit', async () => {
  // Distinct, undecodable, newline-free payloads large enough to arrive in several chunks.
  const out = Buffer.concat([
    Buffer.from('nested-stdout:'),
    Buffer.alloc(300_000, 0xa1),
    Buffer.from([0xff, 0xfe]),
  ])
  const err = Buffer.concat([
    Buffer.from('nested-stderr:'),
    Buffer.alloc(300_000, 0xb2),
    Buffer.from('Error: fictional\n    at x (/fictional.js:1:1)'),
  ])
  // The child builds the same bytes itself, so no payload crosses a platform command-line limit.
  const script = `
    const out = Buffer.concat([Buffer.from('nested-stdout:'), Buffer.alloc(300000, 0xa1), Buffer.from([0xff, 0xfe])])
    const err = Buffer.concat([Buffer.from('nested-stderr:'), Buffer.alloc(300000, 0xb2), Buffer.from('Error: fictional\\n    at x (/fictional.js:1:1)')])
    let pending = 2
    const written = () => {
      if (--pending === 0) process.exit(0)
    }
    process.stderr.write(err, written)
    process.stdout.write(out, written)
  `
  const captured = []
  const write = process.stderr.write.bind(process.stderr)
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk, ...rest) => {
    if (Buffer.isBuffer(chunk)) {
      captured.push(Buffer.from(chunk))
      return true
    }
    return write(chunk, ...rest)
  })
  let options
  const startApp = journeyStartApp((_exe, _args, given) => {
    options = given
    return spawnChild(process.execPath, ['-e', script], { stdio: given.stdio })
  })
  const processes = []
  const run = await startApp(
    '/fictional/root',
    { app: '/fictional/app', argv: ['--brobot-hidden'] },
    '/fictional/workspace',
    '/fictional/global',
    processes,
  )
  await run.closed
  expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
  const all = Buffer.concat(captured)
  const count = (byte) => all.reduce((sum, one) => sum + (one === byte ? 1 : 0), 0)
  expect(count(0xa1)).toBe(300_000)
  expect(count(0xb2)).toBe(300_000)
  expect(all.length).toBe(out.length + err.length)
  expect(all.includes(Buffer.from([0xff, 0xfe]))).toBe(true)
  expect(all.includes(Buffer.from('Error: fictional\n    at x (/fictional.js:1:1)'))).toBe(true)
  // The existing stderr classifier still observes the app's stderr.
  expect(run.stderrClass()).toBeDefined()
})
