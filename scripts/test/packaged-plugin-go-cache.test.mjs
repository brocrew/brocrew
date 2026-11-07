import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { buildWhatsAppPackage, GO_VERSION } from '../../plugins/whatsapp/build.mjs'

vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))

const appRequire = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const builderRequire = createRequire(appRequire.resolve('electron-builder/package.json'))
const libRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const { load } = libRequire('js-yaml')
const workflow = load(
  fs.readFileSync(
    new URL('../../.github/workflows/packaged-plugin-smoke.yml', import.meta.url),
    'utf8',
  ),
)
const step = workflow.jobs['packaged-plugin-smoke'].steps.find(
  (entry) => entry.name === 'Build the real plugin packages',
)

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetAllMocks()
})

it('passes the smoke runner temp cache to Go without LocalAppData', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'packaged-plugin-go-cache-'))
  const cache = step.env?.GOCACHE?.replace('${{ runner.temp }}', root)
  vi.stubEnv('LocalAppData', undefined)
  vi.stubEnv('LOCALAPPDATA', undefined)
  vi.stubEnv('GOCACHE', cache)
  const stopped = new Error('stop before bundling')
  execFileSync.mockImplementation((_go, args, options) => {
    if (args[0] === 'env') return GO_VERSION
    expect(args[0]).toBe('build')
    expect(options.env.GOCACHE).toBe(`${root}/brocrew-go-cache`)
    expect(path.isAbsolute(options.env.GOCACHE)).toBe(true)
    fs.mkdirSync(options.env.GOCACHE, { recursive: true })
    fs.writeFileSync(path.join(options.env.GOCACHE, 'cache-probe'), 'writable')
    throw stopped
  })
  try {
    await expect(
      buildWhatsAppPackage(path.join(root, 'output'), 'a'.repeat(40), path.join(root, 'go.exe'), {
        os: 'win32',
        cpu: 'x64',
      }),
    ).rejects.toBe(stopped)
    expect(execFileSync).toHaveBeenCalledTimes(2)
    expect(
      path.win32.isAbsolute(step.env.GOCACHE.replace('${{ runner.temp }}', 'D:\\a\\_temp')),
    ).toBe(true)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
