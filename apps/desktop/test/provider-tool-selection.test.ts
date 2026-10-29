import { expect, it, vi } from 'vitest'
import { createProviderModules } from '../src/main/providers'

function fixture() {
  const command = vi.fn(() => '/fictional/codex')
  const program = vi.fn(() => '/fictional/claude')
  const key = vi.fn(() => null)
  const paths = () => ({
    managedRoot: '/fictional/homes',
    defaultProfile: 'maple',
    homeOf: () => '/fictional/homes/maple',
    profiles: () => ['maple'],
    assertMayOpen() {},
  })
  const modules = createProviderModules(() => paths(), {
    claude: {
      runtime: { program, key },
      home: { key },
      auth: { key, keyStatus: () => ({ set: false }) },
    },
    codex: { runtime: { command }, home: {}, auth: { command } },
  })
  return { modules, command, program, key }
}

it('the bound Codex tools member reports an unsupported exact-source request without starting a runtime', () => {
  const { modules, command, program, key } = fixture()
  const policy = Reflect.get(modules.codex, 'tools') as
    { describe?: (...args: unknown[]) => unknown } | undefined
  expect(policy?.describe?.({ inheritedSources: 'exclude' }, {})).toEqual({
    status: 'unsupported',
    unsupportedSources: ['home-mcp', 'project-mcp', 'native-plugins'],
    message: 'Exact inherited MCP source exclusion is not supported by this Codex adapter.',
  })
  for (const operation of [command, program, key]) expect(operation).not.toHaveBeenCalled()
})

it('the bound Claude tools member describes selected inputs without accepting extra requested grants', () => {
  const { modules } = fixture()
  const policy = Reflect.get(modules.claude, 'tools') as
    { describe?: (...args: unknown[]) => unknown } | undefined
  const selected = { externalMcp: { servers: [], reservedToolNames: [] } }
  expect(
    policy?.describe?.(
      {
        inheritedSources: 'exclude',
        externalMcp: { servers: [{ name: 'ungranted', url: 'http://127.0.0.1:8126/mcp' }] },
      },
      selected,
    ),
  ).toMatchObject({
    status: 'supported',
    catalog: { selected: { appTools: [], externalServers: [], pluginServers: [] } },
  })
})

it('a legacy Codex description separates selected names from unproved inherited sources', () => {
  const { modules } = fixture()
  const policy = Reflect.get(modules.codex, 'tools') as {
    describe: (...args: unknown[]) => unknown
  }
  expect(
    policy.describe(undefined, {
      externalMcp: {
        servers: [{ name: 'maple', url: 'http://127.0.0.1:8124/mcp' }],
        reservedToolNames: [],
      },
    }),
  ).toEqual({
    status: 'supported',
    catalog: {
      selected: { appTools: [], externalServers: ['maple'], pluginServers: [] },
      inheritedSources: {
        mcp: 'not-established',
        uncovered: ['home-mcp', 'project-mcp', 'native-plugins'],
      },
      knownRestrictions: { excludedServers: [], filteredTools: [] },
      discovery: { appTools: 'declared', externalTools: 'not-established' },
    },
  })
})
