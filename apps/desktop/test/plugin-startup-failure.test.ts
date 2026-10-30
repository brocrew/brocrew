import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import {
  PluginStartupError,
  pluginStartupReason,
  recordPluginStartupFailure,
} from '../src/main/plugins/startup-failure'
import { PluginSupervisorError } from '../src/main/plugins/supervisor/protocol'
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
it('retains the failed phase through supervisor wrappers without exposing arbitrary messages', () => {
  const error = new PluginSupervisorError('unavailable', {
    cause: new PluginStartupError('runtime', new Error('fictional secret')),
  })
  expect(pluginStartupReason(error, 'service-start')).toBe('runtime')
  expect(pluginStartupReason({ code: 'busy' }, 'service-start')).toBe('cleanup-pending')
  expect(pluginStartupReason({ code: 'incompatible' }, 'service-start')).toBe('service-version')
  expect(pluginStartupReason(new Error('fictional secret'), 'connection')).toBe('connection')
})
it('keeps a readable bounded log with an errno and no raw message or configuration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fictional-plugin-diagnostic-'))
  roots.push(root)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await recordPluginStartupFailure(root, 'service-start', {
    cause: { code: 'EACCES', message: 'fictional-secret-key-and-path' },
  })
  const log = await readFile(join(root, 'plugin-startup.log'), 'utf8')
  expect(log).toContain("service-start: BroCrew couldn't start the plugin service.")
  expect(log).toContain('(EACCES)')
  expect(log).not.toContain('fictional-secret-key-and-path')
  expect(log.length).toBeLessThan(1024)
  expect(warn).toHaveBeenCalledOnce()
  await recordPluginStartupFailure(root, 'connection')
  expect(await readFile(join(root, 'plugin-startup.log'), 'utf8')).not.toContain('(EACCES)')
})
it.skipIf(process.platform === 'win32')(
  'replaces a diagnostic symlink without writing its target',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'fictional-plugin-diagnostic-'))
    roots.push(root)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const target = join(root, 'untouched')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(target, 'fictional existing file')
    await symlink(target, join(root, 'plugin-startup.log'))
    await recordPluginStartupFailure(root, 'runtime')
    expect(await readFile(target, 'utf8')).toBe('fictional existing file')
    expect(await readFile(join(root, 'plugin-startup.log'), 'utf8')).toContain('runtime')
  },
)
it('a log write failure does not replace the original startup failure or prevent Retry', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await expect(
    recordPluginStartupFailure(join(tmpdir(), 'fictional-absent', 'no-parent'), 'storage'),
  ).resolves.toBeUndefined()
})
