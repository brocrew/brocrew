import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, chmodSync, readFileSync, rmSync, writeFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordPluginToolFailure } from '../src/main/plugins/tool-diagnostics'

const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'fictional-plugin-diagnostic-'))
  roots.push(root)
  return { root, path: join(root, 'plugin-tool-failures.log') }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
it('persists every fixed failure reason with UTC time and no arbitrary fields', () => {
  const f = fixture()
  recordPluginToolFailure(f.root, 'chrome', 'proof-rejected')
  recordPluginToolFailure(f.root, 'chrome', 'cancelled')
  recordPluginToolFailure(f.root, 'chrome', 'proof-rejected')
  const log = readFileSync(f.path, 'utf8')
  expect(log.trim().split('\n')).toHaveLength(3)
  expect(log).toMatch(
    /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[plugins\] tool-failure plugin=chrome reason=proof-rejected/m,
  )
  recordPluginToolFailure(f.root, 'fictional-private-page', 'proof-rejected')
  recordPluginToolFailure(f.root, 'chrome', 'fictional-private-error' as never)
  expect(readFileSync(f.path, 'utf8')).toBe(log)
  expect(lstatSync(f.path).isFile()).toBe(true)
})
it('keeps the diagnostic bounded and records the newest failure after reaching capacity', () => {
  const f = fixture()
  writeFileSync(f.path, 'x'.repeat(1024 * 1024), { mode: 0o600 })
  recordPluginToolFailure(f.root, 'chrome', 'proof-timeout')
  expect(lstatSync(f.path).size).toBeLessThanOrEqual(1024 * 1024)
  expect(readFileSync(f.path, 'utf8')).toContain('reason=proof-timeout')
})
it('persists a fixed origin stage and correlation but refuses arbitrary diagnostic fields', () => {
  const f = fixture()
  const correlation = '11111111-2222-4333-8444-555555555555'
  recordPluginToolFailure(f.root, 'chrome', 'binding-failed', {
    stage: 'binding-inventory',
    cause: 'timeout',
    correlation,
  })
  const log = readFileSync(f.path, 'utf8')
  expect(log).toContain(`stage=binding-inventory cause=timeout correlation=${correlation}`)
  recordPluginToolFailure(f.root, 'chrome', 'route-open-failed', {
    stage: 'fictional-private-text' as never,
    cause: 'raw-body' as never,
    correlation,
  })
  expect(readFileSync(f.path, 'utf8')).not.toMatch(/fictional-private-text|raw-body/)
  expect(readFileSync(f.path, 'utf8')).toContain('stage=route-open cause=unknown')
})
it('writes the real error messages on the same single line', () => {
  const f = fixture()
  recordPluginToolFailure(f.root, 'chrome', 'binding-failed', {
    stage: 'binding-connect',
    cause: 'io-denied',
    correlation: '11111111-2222-4333-8444-555555555555',
    reason: 'fictional connect refused\n    at line two <- inner fictional cause',
  })
  const lines = readFileSync(f.path, 'utf8').trimEnd().split('\n')
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain(
    'stage=binding-connect cause=io-denied correlation=11111111-2222-4333-8444-555555555555 error="fictional connect refused\\n    at line two <- inner fictional cause"',
  )
})

it('appends a diagnostic to an OS-writable file without changing its earlier bytes or mode', () => {
  const f = fixture()
  writeFileSync(f.path, 'fictional-original')
  chmodSync(f.path, 0o666)
  const before = lstatSync(f.path).mode
  recordPluginToolFailure(f.root, 'chrome', 'proof-rejected')
  expect(readFileSync(f.path, 'utf8')).toMatch(
    /^fictional-original\d{4}-\d{2}-\d{2}T[\d:.]+Z \[plugins\] tool-failure plugin=chrome reason=proof-rejected\n$/,
  )
  expect(lstatSync(f.path).mode).toBe(before)
})
