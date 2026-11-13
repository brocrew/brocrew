import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import * as native from '@brobot2/runtime/codex'
import { createCodexModule } from '../src/main/providers/codex'
import { codexDesktopInputs } from '../src/main/providers/codex/desktop'
import { isReady } from '../src/renderer/src/lib/provider-setup-steps'
import { ScriptedAppServer } from './lib/scripted-codex-host'

it('a saved Codex key remains usable to a fresh startup probe after its launch child closes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'brocrew-startup-key-'))
  const home = join(root, 'fern', 'codex')
  const authFile = join(home, 'auth.json')
  const children: ScriptedAppServer[] = []
  const closed = new Set<ScriptedAppServer>()
  const factory: native.TransportFactory = (context) => {
    const child = new ScriptedAppServer(context.providerHome)
    children.push(child)
    const close = child.close.bind(child)
    child.close = () => {
      closed.add(child)
      close()
    }
    let childKey = false
    const request = child.request.bind(child)
    child.request = async (method, params) => {
      const answered = await request(method, params)
      if (method === 'account/login/start' && params != null && typeof params === 'object') {
        expect(Reflect.get(params, 'type')).toBe('apiKey')
        expect(Reflect.get(params, 'apiKey')).toBe('fictional-fern-key')
        childKey = true
        if (Reflect.get(context, 'apiKeyBound') !== true) {
          writeFileSync(
            authFile,
            JSON.stringify({
              auth_mode: 'apikey',
              OPENAI_API_KEY: 'fictional-fern-key',
            }),
          )
        }
        return { type: 'apiKey' }
      }
      if (method === 'getAuthStatus' || method === 'account/read') {
        const diskKey =
          existsSync(authFile) && readFileSync(authFile, 'utf8').includes('fictional-fern-key')
        const onKey = childKey || diskKey
        return method === 'getAuthStatus'
          ? { authMethod: onKey ? 'apikey' : null }
          : { account: onKey ? { type: 'apiKey' } : null }
      }
      return answered
    }
    return child
  }
  vi.spyOn(native, 'createSpawnTransportFactory').mockReturnValue(factory)
  try {
    const paths = {
      managedRoot: root,
      defaultProfile: 'fern',
      homeOf: () => home,
      profiles: () => ['fern'],
      assertMayOpen: () => {},
    }
    const bindings = codexDesktopInputs(
      {
        isPackaged: false,
        resourcesPath: join(root, 'resources'),
        platform: 'darwin',
        arch: 'arm64',
        managedRoot: root,
        signal: new AbortController().signal,
        commandLine: { hasSwitch: () => false, getSwitchValue: () => '' },
        keys: {
          read: async () => 'fictional-fern-key',
          current: async () => ({ key: 'fictional-fern-key', setAt: 17 }),
          status: () => ({ set: true }),
        },
      },
      {
        resolveProgram: () => ({ path: join(root, 'codex'), from: 'carried' }),
        transportFactory: () => factory,
      },
    )
    const module = createCodexModule(paths, {
      ...bindings,
      home: {
        ...bindings.home,
        provisionHome: (_root, target) => {
          mkdirSync(target, { recursive: true })
        },
        provisionCodexAuth: () => {
          throw new Error('No OAuth copy belongs in this API-key fixture')
        },
      },
      auth: {
        ...bindings.auth,
        machineAuthPath: () => join(root, 'absent-machine-login.json'),
      },
    })
    expect(await module.auth.check('fern')).toMatchObject({ state: 'absent' })
    const prepared = await module.prepareLaunch('fern')
    const choices = await prepared.runtime.listModels?.({ providerHome: home })
    expect(choices?.length).toBeGreaterThan(0)
    expect(children.every((child) => closed.has(child))).toBe(true)
    const beforeRestart = children.length
    const restarted = createCodexModule(paths, {
      ...bindings,
      auth: {
        ...bindings.auth,
        machineAuthPath: () => join(root, 'absent-machine-login.json'),
      },
    })
    const auth = await restarted.auth.check('fern')
    expect(children).toHaveLength(beforeRestart + 1)
    expect(auth).toMatchObject({ state: 'usable', login: 'api-key' })
    expect(
      isReady({
        version: {
          version: '0.160.0',
          program: {
            standing: 'tested',
            from: 'carried',
            path: join(root, 'codex'),
            version: '0.160.0',
            tested: null,
            said: 'Fictional carried Codex 0.160.0.',
            help: null,
            update: null,
            others: [],
            updatedFrom: null,
          },
        },
        setup: null,
        auth,
        keyRefused: false,
      }),
    ).toBe(true)
    expect(readFileSync(authFile, 'utf8')).toContain('fictional-fern-key')
    expect(children.at(-1)?.requests.map((one) => one.method)).toEqual([
      'initialize',
      'getAuthStatus',
      'account/read',
    ])
  } finally {
    await Promise.all(children.map((child) => child.close()))
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  }
})
