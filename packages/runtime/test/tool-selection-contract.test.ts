import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ClaudeRuntime, CodexRuntime, type ClaudeQuery } from '../src/index'

const request = { inheritedSources: 'exclude' as const }
const appTools = {
  server: 'brobot',
  tools: [
    {
      name: 'read_note',
      description: 'Read a fictional note',
      beyondItsRails: 'nothing-its-rails-do-not-cover' as const,
      input: { note: z.string() },
      call: async () => ({ text: 'fictional note' }),
    },
  ],
}

describe('an explicit tool selection is enforced or refused', () => {
  let root: string
  let home: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'fictional-tool-selection-'))
    home = join(root, 'home')
    mkdirSync(home)
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it.each(['start', 'resume'] as const)(
    'Codex %s refuses unknown inherited-source exclusion before any child starts',
    async (kind) => {
      const factory = vi.fn((_context: unknown) => {
        throw new Error('The fictional transport would start')
      })
      const adapter = new CodexRuntime(factory)
      const context = { cwd: root, providerHome: home, toolSelection: request }
      const opening =
        kind === 'start'
          ? adapter.start(context)
          : adapter.resume(
              { provider: 'codex', sessionId: 'fictional-thread', cwd: root, rotation: 0 },
              context,
            )
      await expect(opening).rejects.toMatchObject({
        name: 'ToolSelectionUnsupportedError',
        unsupportedSources: ['home-mcp', 'project-mcp', 'native-plugins'],
      })
      expect(factory).not.toHaveBeenCalled()
    },
  )

  it.each(['start', 'resume'] as const)(
    'Claude %s declares only selected servers and keeps a truthful catalog receipt',
    async (kind) => {
      const sent: Options[] = []
      const adapter = new ClaudeRuntime(
        (params) => {
          sent.push(params.options)
          return {
            async *[Symbol.asyncIterator]() {},
            async interrupt() {},
            close() {},
          } as ClaudeQuery
        },
        async () => true,
      )
      const context = {
        cwd: root,
        providerHome: home,
        toolSelection: request,
        agentTools: appTools,
        externalMcp: {
          servers: [{ name: 'maple', url: 'http://127.0.0.1:8124/mcp' }],
          reservedToolNames: ['read_note'],
        },
        managedPluginMcp: [
          { name: 'plugin-birch', url: 'http://127.0.0.1:8125/mcp', capability: 'a'.repeat(64) },
        ],
      }
      const handle =
        kind === 'start'
          ? await adapter.start(context)
          : await adapter.resume(
              { provider: 'claude', sessionId: 'fictional-thread', cwd: root, rotation: 0 },
              context,
            )
      try {
        expect(sent[0]?.strictMcpConfig).toBe(true)
        expect(sent[0]?.settingSources).toEqual([])
        expect(Object.keys(sent[0]?.mcpServers ?? {}).sort()).toEqual([
          'brobot',
          'maple',
          'plugin-birch',
        ])
        expect(Reflect.get(handle, 'toolCatalog')).toEqual({
          selected: {
            appTools: ['read_note'],
            externalServers: ['maple'],
            pluginServers: ['plugin-birch'],
          },
          inheritedSources: { mcp: 'excluded-by-explicit-config', uncovered: [] },
          knownRestrictions: { excludedServers: [], filteredTools: [] },
          discovery: { appTools: 'declared', externalTools: 'not-established' },
        })
        expect(JSON.stringify(Reflect.get(handle, 'toolCatalog'))).not.toContain('Bearer')
        expect(JSON.stringify(Reflect.get(handle, 'toolCatalog'))).not.toContain('a'.repeat(64))
      } finally {
        await handle.close()
      }
    },
  )

  it('an omitted request keeps the Codex transport path and does not claim an exact catalog', async () => {
    const factory = vi.fn((_context: unknown) => {
      throw new Error('The fictional transport would start')
    })
    const adapter = new CodexRuntime(factory)
    await expect(adapter.start({ cwd: root, providerHome: home })).rejects.toThrow(
      'The fictional transport would start',
    )
    expect(factory).toHaveBeenCalledTimes(1)
    expect(factory.mock.calls[0]?.[0]).not.toHaveProperty('toolSelection')
  })
})
