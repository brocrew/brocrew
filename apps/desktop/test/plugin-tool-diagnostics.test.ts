import { afterEach, expect, it } from 'vitest'
import {
  mkdtempSync,
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
  const root = mkdtempSync(
    join(process.platform === 'win32' ? tmpdir() : '/tmp', 'fictional-plugin-diagnostic-'),
  )
  roots.push(root)
  return { root, path: join(root, 'plugin-tool-failures.log') }
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
it('persists every fixed failure reason with UTC time and a private file, with no arbitrary fields', () => {
  const f = fixture()
  recordPluginToolFailure(f.root, 'garden', 'proof-rejected')
  recordPluginToolFailure(f.root, 'garden', 'cancelled')
  recordPluginToolFailure(f.root, 'garden', 'proof-rejected')
  const log = readFileSync(f.path, 'utf8')
  expect(log.trim().split('\n')).toHaveLength(3)
  expect(log).toMatch(
    /^\d{4}-\d{2}-\d{2}T[\d:.]+Z \[plugins\] tool-failure plugin=garden reason=proof-rejected/m,
  )
  recordPluginToolFailure(f.root, 'garden', 'fictional-private-error' as never)
  expect(readFileSync(f.path, 'utf8')).toBe(log)
  if (process.platform !== 'win32') expect(lstatSync(f.path).mode & 0o777).toBe(0o600)
})
it('records arbitrary installed plugin IDs without permitting extra log lines', () => {
  const f = fixture()
  recordPluginToolFailure(f.root, 'fictional-garden/rose\nfern', 'transport-call-failed')
  const log = readFileSync(f.path, 'utf8')
  expect(log.trim().split('\n')).toHaveLength(1)
  expect(log).toContain('plugin=fictional-garden%2Frose%0Afern reason=transport-call-failed')
})
it('keeps the diagnostic bounded and records the newest failure after reaching capacity', () => {
  const f = fixture()
  writeFileSync(f.path, 'x'.repeat(1024 * 1024), { mode: 0o600 })
  recordPluginToolFailure(f.root, 'garden', 'proof-timeout')
  expect(lstatSync(f.path).size).toBeLessThanOrEqual(1024 * 1024)
  expect(readFileSync(f.path, 'utf8')).toContain('reason=proof-timeout')
})
it.skipIf(process.platform === 'win32')(
  'does not write through symbolic or hard links or a public file',
  () => {
    for (const kind of ['symlink', 'hardlink', 'public'] as const) {
      const f = fixture(),
        target = join(f.root, 'fictional-target')
      writeFileSync(target, 'fictional-original', { mode: 0o600 })
      if (kind === 'symlink') symlinkSync(target, f.path)
      else if (kind === 'hardlink') linkSync(target, f.path)
      else writeFileSync(f.path, 'fictional-original', { mode: 0o644 })
      recordPluginToolFailure(f.root, 'garden', 'proof-rejected')
      expect(readFileSync(target, 'utf8')).toBe('fictional-original')
      expect(readFileSync(f.path, 'utf8')).toBe('fictional-original')
    }
  },
)
