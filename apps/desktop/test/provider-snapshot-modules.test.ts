import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { build } from 'vite'
import { describe, expect, it, vi } from 'vitest'
import { createSnapshotPolicy, type SnapshotPolicy } from '../src/main/providers/snapshot-policy'
import { providerKnowledge } from '../src/main/providers/knowledge-definitions'
import claudeMac from '../src/main/provider-snapshots/claude-code.json'
import codexMac from '../src/main/provider-snapshots/codex.json'
import claudeLinux from '../src/main/provider-snapshots/linux/claude-code.json'
import codexLinux from '../src/main/provider-snapshots/linux/codex.json'

describe('provider snapshot modules preserve the shipped captures', () => {
  it.each([
    ['claude', 'linux', claudeLinux],
    ['claude', 'darwin', claudeMac],
    ['codex', 'linux', codexLinux],
    ['codex', 'darwin', codexMac],
  ] as const)('keeps every capture field for %s on %s', (provider, platform, expected) => {
    const snapshot = Reflect.get(providerKnowledge[provider], 'snapshot') as
      { fileFor(platform: NodeJS.Platform): unknown } | undefined
    expect(snapshot).toBeDefined()
    if (snapshot === undefined) throw new Error('Provider snapshot policy is absent')
    expect(snapshot.fileFor(platform)).toEqual(expected)
    expect(snapshot.fileFor(platform)).toBe(snapshot.fileFor(platform))
  })

  it('leaves both sources inert until requested, then decodes each platform once', () => {
    const linux = vi.fn(() => '{"version":"sample-linux"}')
    const mac = vi.fn(() => '{"version":"sample-mac"}')
    const policy = createSnapshotPolicy(linux, mac)
    expect(linux).not.toHaveBeenCalled()
    expect(mac).not.toHaveBeenCalled()
    const first = policy.fileFor('linux')
    expect(first.version).toBe('sample-linux')
    expect(policy.fileFor('linux')).toBe(first)
    expect(linux).toHaveBeenCalledTimes(1)
    expect(mac).not.toHaveBeenCalled()
    const other = policy.fileFor('darwin')
    expect(other.version).toBe('sample-mac')
    expect(policy.fileFor('win32')).toBe(other)
    expect(mac).toHaveBeenCalledTimes(1)
  })

  it('throws for damaged capture text instead of falling back or returning an empty capture', () => {
    const mac = vi.fn(() => '{"version":"sample-mac"}')
    const policy = createSnapshotPolicy(() => '{damaged', mac)
    expect(() => policy.fileFor('linux')).toThrow(SyntaxError)
    expect(mac).not.toHaveBeenCalled()
  })

  it.each([
    ['claude', claudeLinux, claudeMac],
    ['codex', codexLinux, codexMac],
  ] as const)(
    'bundles both platform captures for %s with the desktop compiler',
    async (provider, linux, mac) => {
      const result = await build({
        configFile: false,
        root: fileURLToPath(new URL('../../../', import.meta.url)),
        logLevel: 'silent',
        build: {
          lib: {
            entry: fileURLToPath(
              new URL(`../src/main/providers/${provider}/snapshot.ts`, import.meta.url),
            ),
            formats: ['cjs'],
          },
          write: false,
          minify: false,
          reportCompressedSize: false,
        },
      })
      const builds = Array.isArray(result) ? result : [result]
      const chunks = builds.flatMap((one) =>
        'output' in one ? one.output.filter((item) => item.type === 'chunk') : [],
      )
      expect(chunks).toHaveLength(1)
      const module = { exports: {} as { snapshot?: SnapshotPolicy } }
      runInNewContext(chunks[0]!.code, { module, exports: module.exports })
      const policy = module.exports.snapshot
      expect(policy).toBeDefined()
      if (policy === undefined) throw new Error('Bundled snapshot policy is absent')
      expect(policy.fileFor('linux')).toEqual(linux)
      expect(policy.fileFor('darwin')).toEqual(mac)
      expect(policy.fileFor('win32')).toBe(policy.fileFor('darwin'))
    },
    20_000,
  )
})
