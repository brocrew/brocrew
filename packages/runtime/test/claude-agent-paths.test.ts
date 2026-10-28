import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClaudeRuntime, type ClaudeQuery, type StartOptions } from '../src/index'

describe('Claude agent state stays separate from its provider home', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brocrew-agent-paths-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  function state(name: string, rule: string): string {
    const home = join(root, name)
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ permissions: { allow: [rule] } }))
    return home
  }

  function runtime() {
    const captures: Options[] = []
    const exists = vi.fn(async () => true)
    const adapter = new ClaudeRuntime((params) => {
      captures.push(params.options)
      return {
        async *[Symbol.asyncIterator]() {},
        async interrupt() {},
        close() {},
      } as ClaudeQuery
    }, exists)
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
      { provider: 'claude', sessionId: 'fictional-thread', cwd: root },
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
      const { adapter, captures } = runtime()
      const handle =
        kind === 'start'
          ? await adapter.start({ cwd: root, providerHome })
          : await adapter.resume(
              { provider: 'claude', sessionId: 'fictional-thread', cwd: root },
              { providerHome },
            )
      await handle.close()
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
})
