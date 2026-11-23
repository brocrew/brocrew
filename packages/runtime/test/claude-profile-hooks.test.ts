import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeRuntime } from '../src/claude/claude-runtime'
import { AsyncQueue } from '../src/internal/async-queue'

const PROFILE_HOOKS = {
  PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo profile-read' }] }],
}
const LOCAL_HOOKS = {
  PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'echo local-read' }] }],
}
const PROFILE_RULES = {
  allow: ['Read(/profile-allowed.txt)'],
  deny: ['Read(/profile-denied.txt)'],
  ask: ['Edit(/profile-ask.txt)'],
}
const LOCAL_RULES = {
  allow: ['Read(/local-allowed.txt)'],
  deny: ['Read(/local-denied.txt)'],
  ask: ['Edit(/local-ask.txt)'],
}

type Launch = 'start' | 'resume' | 'model list'

let root: string
let managedRoot: string
let cwd: string
let providerHome: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'claude-profile-hooks-'))
  managedRoot = join(root, 'provider-homes')
  cwd = join(root, 'notes')
  providerHome = join(managedRoot, 'default', 'fictional-writer', 'claude')
  mkdirSync(join(cwd, '.claude'), { recursive: true })
  mkdirSync(providerHome, { recursive: true })
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function settingsFile(path: string, document: object): void {
  writeFileSync(path, JSON.stringify(document))
}

async function launch(kind: Launch, home = providerHome): Promise<Options> {
  let captured: Options | undefined
  const runtime = new ClaudeRuntime(
    ({ options }) => {
      captured = options
      const messages = new AsyncQueue<SDKMessage>()
      return {
        close: () => messages.close(),
        interrupt: async () => undefined,
        supportedModels: async () => [],
        [Symbol.asyncIterator]: () => messages[Symbol.asyncIterator](),
      }
    },
    async () => true,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    managedRoot,
  )
  const context = { providerHome: home }
  if (kind === 'model list') {
    await runtime.listModels(context)
  } else {
    const handle =
      kind === 'start'
        ? await runtime.start({ cwd, ...context })
        : await runtime.resume({ provider: 'claude', sessionId: 'fictional', cwd, rotation: 0 }, context)
    await handle.close()
  }
  if (!captured) throw new Error('No launch options reached Claude.')
  return captured
}

describe('Claude profile settings hooks', () => {
  it.each(['start', 'resume'] as const)('passes hooks from a hooks-only profile on %s', async (kind) => {
    settingsFile(join(providerHome, 'settings.json'), { hooks: PROFILE_HOOKS })

    const options = await launch(kind)

    expect(options.settings).toMatchObject({ hooks: PROFILE_HOOKS })
    expect(options.settings).not.toHaveProperty('permissions')
    expect(options.settingSources).toEqual([])
    expect(options.hooks?.PreToolUse).toHaveLength(2)
    expect(options.hooks?.PostToolUse).toBeDefined()
    expect(options.hooks?.Stop).toBeDefined()
  })

  it('keeps all three selected local rule lists and takes hooks only from the profile', async () => {
    settingsFile(join(providerHome, 'settings.json'), {
      hooks: PROFILE_HOOKS,
      permissions: PROFILE_RULES,
    })
    settingsFile(join(cwd, '.claude', 'settings.local.json'), {
      hooks: LOCAL_HOOKS,
      permissions: LOCAL_RULES,
    })

    expect((await launch('start')).settings).toMatchObject({
      hooks: PROFILE_HOOKS,
      permissions: {
        allow: [...PROFILE_RULES.allow, ...LOCAL_RULES.allow],
        deny: [...PROFILE_RULES.deny, ...LOCAL_RULES.deny],
        ask: [...PROFILE_RULES.ask, ...LOCAL_RULES.ask],
      },
    })
  })

  it('does not use profile hooks for a model lookup, but keeps the profile rules', async () => {
    settingsFile(join(providerHome, 'settings.json'), {
      hooks: PROFILE_HOOKS,
      permissions: PROFILE_RULES,
    })

    const options = await launch('model list')

    expect(options.settings).toMatchObject({ permissions: PROFILE_RULES })
    expect(options.settings).not.toHaveProperty('hooks')
    expect(options.settingSources).toEqual([])
  })

  it('keeps a no-hook launch free of native hooks even with project-local hooks', async () => {
    settingsFile(join(providerHome, 'settings.json'), { permissions: PROFILE_RULES })
    settingsFile(join(cwd, '.claude', 'settings.local.json'), { hooks: LOCAL_HOOKS })

    const options = await launch('start')

    expect(options.settings).toMatchObject({ permissions: PROFILE_RULES })
    expect(options.settings).not.toHaveProperty('hooks')
    expect(options.settingSources).toEqual([])
  })

  it('does not turn an unmanaged home into a profile hook source', async () => {
    const unmanaged = join(root, 'unmanaged')
    mkdirSync(unmanaged)
    settingsFile(join(unmanaged, 'settings.json'), { hooks: PROFILE_HOOKS })

    const options = await launch('start', unmanaged)

    expect(options.settings).not.toHaveProperty('hooks')
    expect(options.settingSources).toEqual([])
  })
})
