import { afterEach, expect, it } from 'vitest'
import {
  mkdtempSync,
  chmodSync,
  readFileSync,
  rmSync,
  writeFileSync,
  lstatSync,
  symlinkSync,
  linkSync,
} from 'node:fs'
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
it.skipIf(process.platform === 'win32')('does not write through symbolic or hard links', () => {
  for (const kind of ['symlink', 'hardlink'] as const) {
    const f = fixture(),
      target = join(f.root, 'fictional-target')
    writeFileSync(target, 'fictional-original', { mode: 0o600 })
    if (kind === 'symlink') symlinkSync(target, f.path)
    else linkSync(target, f.path)
    recordPluginToolFailure(f.root, 'chrome', 'proof-rejected')
    expect(readFileSync(target, 'utf8')).toBe('fictional-original')
    expect(readFileSync(f.path, 'utf8')).toBe('fictional-original')
  }
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
