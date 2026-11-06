import { afterEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import {
  NODE_VERSION,
  NODE_TARGETS,
  preparePluginNode,
  verifyNodeArchive,
} from '../prepare-plugin-node.mjs'

vi.mock('node:timers/promises', () => ({ setTimeout: async () => {} }))
const scratch = []
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((folder) => rm(folder, { recursive: true, force: true })))
})
async function outputFolder() {
  const root = await mkdtemp(join(tmpdir(), 'plugin-node-test-'))
  scratch.push(root)
  return join(root, 'runtime')
}
const downloadUrl = `https://nodejs.org/download/release/v${NODE_VERSION}/node-v${NODE_VERSION}-darwin-arm64.tar.gz`

it('reports the HTTP status and URL without retrying a missing archive', async () => {
  const fetcher = vi.fn(async () => new Response('missing', { status: 404 }))
  await expect(preparePluginNode(await outputFolder(), fetcher, 'darwin-arm64')).rejects.toThrow(
    `HTTP 404: ${downloadUrl}`,
  )
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it.each(['HTTP', 'network', 'body'])(
  'retries a transient %s failure and still verifies the archive digest',
  async (kind) => {
    const fetcher = vi.fn()
    if (kind === 'HTTP') fetcher.mockResolvedValueOnce(new Response('busy', { status: 503 }))
    else if (kind === 'network') fetcher.mockRejectedValueOnce(new Error('connection reset'))
    else
      fetcher.mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error('body reset'))
            },
          }),
        ),
      )
    fetcher.mockResolvedValue(new Response('altered archive'))
    await expect(preparePluginNode(await outputFolder(), fetcher, 'darwin-arm64')).rejects.toThrow(
      'plugin-node-archive-digest',
    )
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0][1].signal).toBeUndefined()
  },
)

it('stops ordinary retries and reports the last status and URL', async () => {
  const fetcher = vi.fn(async () => new Response('busy', { status: 503 }))
  await expect(preparePluginNode(await outputFolder(), fetcher, 'darwin-arm64')).rejects.toThrow(
    `HTTP 503: ${downloadUrl}`,
  )
  expect(fetcher).toHaveBeenCalledTimes(3)
})
it('pins both the release archive and executable per target, and refuses altered bytes before extraction', () => {
  expect(NODE_VERSION).toMatch(/^24\.\d+\.\d+$/)
  expect(Object.keys(NODE_TARGETS).sort()).toEqual(['darwin-arm64', 'win32-x64'])
  for (const [name, target] of Object.entries(NODE_TARGETS)) {
    expect(target.archiveSha256).toMatch(/^[a-f0-9]{64}$/)
    expect(target.binarySha256).toMatch(/^[a-f0-9]{64}$/)
    expect(() => verifyNodeArchive(Buffer.from('fictional substituted archive'), name)).toThrow(
      'plugin-node-archive-digest',
    )
  }
  expect(NODE_TARGETS['win32-x64'].file).toBe('node.exe')
  expect(() => verifyNodeArchive(Buffer.alloc(0), 'linux-x64')).toThrow(
    'plugin-node-unsupported-target',
  )
})
it('packages Node and the guardian on Mac and Windows through explicit build steps, never an install hook', () => {
  const file = JSON.parse(readFileSync('apps/desktop/package.json', 'utf8'))
  for (const name of ['package', 'package:mac-beta', 'package:win'])
    expect(file.scripts[name]).toContain('prepare-plugin-node.mjs &&')
  expect(file.scripts.postinstall).not.toContain('prepare-plugin-node')
  const config = readFileSync('apps/desktop/electron-builder.yml', 'utf8')
  expect(config).toContain('beforePack: ./build/before-pack.cjs')
  expect(config).toContain('from: resources/plugin-node')
  expect(config).toContain('from: resources/plugin-host')
  expect(config).toContain("'plugin-node/node$'")
})

it('the in-app hook delegates to the shared build-time implementation', () => {
  const require = createRequire(import.meta.url)
  expect(require('../../apps/desktop/build/before-pack.cjs')).toBe(
    require('../prepare-plugin-node-before-pack.cjs'),
  )
})
