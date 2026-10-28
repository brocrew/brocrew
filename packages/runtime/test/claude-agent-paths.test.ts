import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRuntime, claudeAgentPaths, type ClaudeQuery, type StartOptions } from '../src/index'
import * as homes from '../src/internal/provider-home'

describe('Claude agent state stays separate from its provider home', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brocrew-agent-paths-'))
  })
  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(root, { recursive: true, force: true })
  })

  function state(name: string, rule: string): string {
    const home = join(root, name)
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ permissions: { allow: [rule] } }))
    return home
  }

  function runtime(withManagedRoot = true, managedRoot = root) {
    const captures: Options[] = []
    const exists = vi.fn(async () => true)
    const adapter = new ClaudeRuntime(
      (params) => {
        captures.push(params.options)
        return {
          async *[Symbol.asyncIterator]() {},
          async interrupt() {},
          async supportedModels() {
            return []
          },
          close() {},
        } as ClaudeQuery
      },
      exists,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      withManagedRoot ? managedRoot : undefined,
    )
    return { adapter, captures, exists }
  }

  it('two agents can use one provider home without sharing memory or saved user rules', async () => {
    const providerHome = state('provider', 'Bash(shared-home-command)')
    const { adapter, captures } = runtime()
    for (const [name, rule] of [
      ['birch', 'Bash(birch-command)'],
      ['cedar', 'Bash(cedar-command)'],
    ]) {
      const agentStateHome = state(name!, rule!)
      const options: StartOptions & { agentStateHome: string } = {
        cwd: root,
        providerHome,
        agentStateHome,
      }
      const handle = await adapter.start(options)
      await handle.close()
      const sent = captures.at(-1)!
      expect(sent.settings).toEqual({
        autoMemoryDirectory: join(agentStateHome, 'memory'),
        permissions: { allow: [rule] },
      })
      expect(sent.env?.['CLAUDE_CONFIG_DIR']).toBe(providerHome)
      expect(sent.settingSources).toEqual([])
      expect(sent.strictMcpConfig).toBe(true)
    }
  })

  it('resume uses agent state while checking the transcript in its recorded provider home', async () => {
    const providerHome = state('recorded-provider', 'Bash(shared-home-command)')
    const agentStateHome = state('birch', 'Bash(birch-command)')
    const { adapter, captures, exists } = runtime()
    const options: StartOptions & { agentStateHome: string } = {
      cwd: root,
      providerHome,
      agentStateHome,
    }
    const handle = await adapter.resume(
      { provider: 'claude', sessionId: 'fictional-thread', cwd: root, rotation: 0 },
      options,
    )
    await handle.close()
    expect(exists).toHaveBeenCalledWith('fictional-thread', root, providerHome)
    expect(captures[0]?.resume).toBe('fictional-thread')
    expect(captures[0]?.env?.['CLAUDE_CONFIG_DIR']).toBe(providerHome)
    expect(captures[0]?.settings).toEqual({
      autoMemoryDirectory: join(agentStateHome, 'memory'),
      permissions: { allow: ['Bash(birch-command)'] },
    })
  })

  it.each(['start', 'resume'] as const)(
    'an old %s without a selector keeps the exact old paths',
    async (kind) => {
      const providerHome = state('old-home', 'Bash(legacy-command)')
      const provision = vi.spyOn(homes, 'provisionProviderHome')
      const { adapter, captures } = runtime()
      const handle =
        kind === 'start'
          ? await adapter.start({ cwd: root, providerHome })
          : await adapter.resume(
              { provider: 'claude', sessionId: 'fictional-thread', cwd: root, rotation: 0 },
              { providerHome },
            )
      await handle.close()
      expect(provision).not.toHaveBeenCalled()
      expect(captures[0]?.settings).toEqual({
        autoMemoryDirectory: join(providerHome, 'memory'),
        permissions: { allow: ['Bash(legacy-command)'] },
      })
    },
  )

  it.each(['', 'relative-agent', 'bad\0agent'])(
    'refuses an invalid explicit agent root %j before querying',
    async (agentStateHome) => {
      const { adapter, captures } = runtime()
      const options: StartOptions & { agentStateHome: string } = {
        cwd: root,
        providerHome: join(root, 'provider'),
        agentStateHome,
      }
      await expect(adapter.start(options)).rejects.toThrow(/agent state/)
      expect(captures).toEqual([])
    },
  )

  it('refuses an explicit root without the managed-folder guard', async () => {
    const { adapter, captures } = runtime(false)
    await expect(
      adapter.start({ cwd: root, providerHome: root, agentStateHome: join(root, 'birch') }),
    ).rejects.toThrow(/managed root/)
    expect(captures).toEqual([])
  })

  it.each(['', 'relative-agent', 'bad\0agent'])(
    'the canonical path reader refuses explicit root %j',
    (agentStateHome) => {
      expect(() => claudeAgentPaths(root, agentStateHome)).toThrow(/agent state/)
    },
  )

  it('refuses an agent folder outside the managed root or redirected through a symlink', async () => {
    const { adapter, captures } = runtime()
    const real = state('birch', 'Bash(birch-command)')
    const link = join(root, 'linked-agent')
    symlinkSync(real, link, 'dir')
    for (const agentStateHome of [tmpdir(), link]) {
      await expect(
        adapter.start({ cwd: root, providerHome: root, agentStateHome }),
      ).rejects.toThrow()
    }
    expect(captures).toEqual([])
  })

  it('the model list uses the same agent settings without moving its provider home', async () => {
    const providerHome = state('provider', 'Bash(shared-home-command)')
    const agentStateHome = state('birch', 'Bash(birch-command)')
    const { adapter, captures } = runtime()
    await adapter.listModels({ providerHome, agentStateHome })
    expect(captures[0]?.env?.['CLAUDE_CONFIG_DIR']).toBe(providerHome)
    expect(captures[0]?.settings).toEqual({
      autoMemoryDirectory: join(agentStateHome, 'memory'),
      permissions: { allow: ['Bash(birch-command)'] },
    })
  })

  it('keeps transcript retention bound to the provider home rather than the agent state layout', async () => {
    const managedRoot = join(root, 'provider-homes')
    const providerHome = join(managedRoot, 'default', 'shared', 'claude')
    const agentStateHome = join(managedRoot, 'agents', 'birch')
    mkdirSync(providerHome, { recursive: true })
    mkdirSync(agentStateHome, { recursive: true })
    const { adapter, captures } = runtime(true, managedRoot)
    const handle = await adapter.start({ cwd: root, providerHome, agentStateHome })
    await handle.close()
    expect(captures[0]?.settings).toEqual({
      autoMemoryDirectory: join(agentStateHome, 'memory'),
      cleanupPeriodDays: 36500,
    })
    expect(captures[0]?.env?.['CLAUDE_CONFIG_DIR']).toBe(providerHome)
  })

  it('project-local rules stay project-scoped beside the selected agent user rules', async () => {
    const providerHome = state('provider', 'Bash(shared-home-command)')
    const agentStateHome = state('birch', 'Bash(birch-command)')
    const one = join(root, 'project-one')
    const two = join(root, 'project-two')
    mkdirSync(join(one, '.claude'), { recursive: true })
    mkdirSync(two)
    writeFileSync(
      join(one, '.claude', 'settings.local.json'),
      JSON.stringify({ permissions: { allow: ['Bash(project-command)'] } }),
    )
    const { adapter, captures } = runtime()
    for (const cwd of [one, two]) {
      const handle = await adapter.start({ cwd, providerHome, agentStateHome })
      await handle.close()
    }
    expect(captures.map((sent) => sent.settings)).toEqual([
      {
        autoMemoryDirectory: join(agentStateHome, 'memory'),
        permissions: { allow: ['Bash(birch-command)', 'Bash(project-command)'] },
      },
      {
        autoMemoryDirectory: join(agentStateHome, 'memory'),
        permissions: { allow: ['Bash(birch-command)'] },
      },
    ])
  })
})
