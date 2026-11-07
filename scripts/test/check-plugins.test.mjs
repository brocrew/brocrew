import { afterEach, expect, it, vi } from 'vitest'

const fake = vi.hoisted(() => ({
  readdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
  lstatSync: vi.fn(() => ({ isFile: () => true })),
  mkdtempSync: vi.fn(() => '/fictional/plugin-ci'),
  rmSync: vi.fn(),
  spawnSync: vi.fn(),
  execFileSync: vi.fn(() => 'fictional-sha'),
}))
vi.mock('node:fs', () => ({ default: fake }))
vi.mock('node:child_process', () => fake)
const exitCode = process.exitCode
afterEach(() => {
  process.exitCode = exitCode
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

async function runCheck() {
  vi.resetModules()
  vi.stubEnv('GITHUB_ACTIONS', 'true')
  vi.stubEnv('PLUGIN_CI_NODE_VERSION', process.versions.node)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  await import('../check-plugins.mjs')
  return errors.mock.calls.flat().join('\n')
}

it('prints the discovery exception and its path in CI', async () => {
  fake.readdirSync.mockImplementation(() => {
    throw new Error('EACCES: /fictional/plugins')
  })
  expect(await runCheck()).toContain('EACCES: /fictional/plugins')
  expect(process.exitCode).toBe(1)
  expect(fake.spawnSync).not.toHaveBeenCalled()
})

it('prints the child spawn exception with the failing plugin stage', async () => {
  fake.readdirSync
    .mockReturnValueOnce([
      {
        name: 'sample',
        isSymbolicLink: () => false,
        isDirectory: () => true,
      },
    ])
    .mockReturnValue([])
  fake.existsSync.mockReturnValue(true)
  fake.lstatSync.mockReturnValue({ isFile: () => true })
  fake.mkdtempSync.mockReturnValue('/fictional/plugin-ci')
  fake.execFileSync.mockReturnValue('fictional-sha')
  fake.spawnSync.mockReturnValueOnce({ status: 0 }).mockReturnValue({
    status: null,
    error: Object.assign(new Error('spawn npm ENOENT'), { code: 'ENOENT' }),
  })
  const said = await runCheck()
  expect(said).toContain('spawn npm ENOENT')
  expect(said).toContain('"plugin":"sample","stage":"install"')
  expect(process.exitCode).toBe(1)
})
