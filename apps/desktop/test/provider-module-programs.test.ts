import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { FakeRuntime } from '@brobot2/runtime'
import {
  PROVIDER_DESCRIPTORS,
  SUPPORTED_PROVIDERS,
  type ProviderDescriptor,
  type Provider,
} from '@brobot2/shared'
import { providerVersionsFromModules } from '../src/main/providers'
import type { ProviderProgramOperations } from '@brobot2/runtime/provider-module'
import { unstartedProviderModules } from './helpers/unstarted-provider-modules'
import type { ProviderModule, ProviderModules } from '../src/main/providers/module'
import { orderedProgramVersions } from '../src/main/providers/program-policy'

// This fixture extends the registry only in this test, without widening the production provider type.
const harnessProvider = 'fern-harness' as Provider
const descriptors = PROVIDER_DESCRIPTORS as unknown as ProviderDescriptor[]
const ids = SUPPORTED_PROVIDERS as unknown as string[]
const descriptorCount = descriptors.length
const idCount = ids.length

beforeAll(() => {
  descriptors.push({ ...PROVIDER_DESCRIPTORS[0], id: 'fern-harness' })
  ids.push('fern-harness')
})
afterAll(() => {
  descriptors.splice(descriptorCount)
  ids.splice(idCount)
})

function fixture(program?: ProviderProgramOperations) {
  const unread = vi.fn((): never => {
    throw new Error('No executable or credential lookup')
  })
  const modules = unstartedProviderModules(unread, '/fictional')
  const module: ProviderModule = {
    ...modules.claude,
    ...(program === undefined ? {} : { program }),
    createRuntime: () => new FakeRuntime(harnessProvider),
    async prepareLaunch(profileId) {
      return { home: `/fictional/${profileId}`, runtime: this.createRuntime() }
    },
  }
  const bound: ProviderModules = { ...modules, [harnessProvider]: module }
  return { bound, module, unread }
}

describe('a provider with its own harness', () => {
  for (const program of [undefined, { installedPath: () => null }]) {
    it(`keeps a missing ${program === undefined ? 'program service' : 'version service'} out of launch admission`, async () => {
      const f = fixture(program)
      const read = providerVersionsFromModules(f.bound)
      const versions = await read()
      expect(versions[harnessProvider]).toEqual({
        version: null,
        reason: 'This provider does not publish a program version.',
      })
      expect(versions[harnessProvider]).not.toHaveProperty('program')
      const launch = await f.module.prepareLaunch('willow')
      const session = await launch.runtime.start({
        providerHome: launch.home,
        cwd: '/fictional/work',
      })
      try {
        expect(session.ref?.provider).toBe('fern-harness')
        expect(session.ref?.cwd).toBe('/fictional/work')
        expect(session.providerPid).toBeUndefined()
        expect(session.awaitProcessExit?.()).toBeUndefined()
        const models = await launch.runtime.listModels({ providerHome: launch.home })
        expect(models[0]?.id).toBe('fake-fern-harness-a')
      } finally {
        await session.close()
      }
      expect(f.unread).not.toHaveBeenCalled()
    })
  }

  it('retains a bound version reader receiver and its actual result', async () => {
    const program = {
      result: { version: null, reason: 'Fictional version service is offline' },
      version: vi.fn(function (this: { result: { version: null; reason: string } }) {
        return Promise.resolve(this.result)
      }),
    }
    const f = fixture(program)
    const read = providerVersionsFromModules(f.bound)
    expect(program.version).not.toHaveBeenCalled()
    expect((await read())[harnessProvider]).toBe(program.result)
    expect(program.version).toHaveBeenCalledOnce()
    expect(f.unread).not.toHaveBeenCalled()
  })

  it('starts the available reads in registry order and preserves a real reader failure', async () => {
    const calls: string[] = []
    const failure = new Error('Fictional version read failed')
    const read = orderedProgramVersions({
      claude: async () => {
        calls.push('claude')
        return { version: null, reason: 'not reported' }
      },
      codex: async () => {
        calls.push('codex')
        throw failure
      },
    })
    await expect(read()).rejects.toBe(failure)
    expect(calls).toEqual(['claude', 'codex'])
  })
})
