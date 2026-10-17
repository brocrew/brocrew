import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { ClaudeRuntime } from '../src/claude/claude-runtime'
import type { ClaudeQuery } from '../src/claude/claude-runtime'

/**
 * Every Claude child is started by this app's own spawn, whatever program it runs: the spawn hands
 * the CLI an API key by descriptor, keeps its stderr and owns its exit. All three launches must go
 * through it.
 */
describe('261 · every query this adapter builds starts its child through this app', () => {
  /**
   * ⛔ **All THREE query paths, because the reviewer named three and the adapter had two.**
   *
   * `start` and `resume` each write `spawnClaudeCodeProcess` onto their own options; the model
   * probe did not, so it used the SDK's private spawn and had the same spelling with none of the
   * repair. A fix applied to the two session paths would have left the model menu broken in the
   * packaged app — silently, because a failed probe is reported as "no menu for this provider".
   */
  describe('every query this adapter builds spawns through THIS app', () => {
    /** Records whether the SDK was handed our spawn, and what command it was called with. */
    function runtimeRecording(commands: string[], models: unknown[] = []): ClaudeRuntime {
      return new ClaudeRuntime(
        (params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
          // The real `ProcessTransport` spawns synchronously inside `query()`; a stand-in that did
          // not call the hook would let every assertion below pass over nothing (196's rule).
          params.options.spawnClaudeCodeProcess?.({
            command: 'claude',
            args: [],
            env: {},
            signal: new AbortController().signal,
          })
          return {
            close: () => undefined,
            interrupt: async () => undefined,
            supportedModels: async () => models,
          } as unknown as ClaudeQuery
        },
        async () => true,
        undefined,
        undefined,
        (options) => {
          commands.push(options.command)
          const stderr = Object.assign(new EventEmitter(), { setEncoding: () => {} })
          return Object.assign(new EventEmitter(), { pid: 9001, stderr }) as never
        },
      )
    }

    it('start hands the SDK our spawn', async () => {
      const commands: string[] = []
      await runtimeRecording(commands).start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' })
      expect(commands).toEqual(['claude'])
    })

    it('resume hands the SDK our spawn', async () => {
      const commands: string[] = []
      await runtimeRecording(commands).resume(
        { provider: 'claude', sessionId: 'sess_1', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/tmp/x/home' },
      )
      expect(commands).toEqual(['claude'])
    })

    it('🔴 …and so does the MODEL PROBE, which until 261 did not', async () => {
      const commands: string[] = []
      const models = await runtimeRecording(commands, [
        { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku' },
      ]).listModels({ providerHome: '/tmp/x/home' })
      expect(commands, 'the probe spawned through this app, not through the SDK').toEqual([
        'claude',
      ])
      // …and it is still a working probe, not merely an instrumented one.
      expect(models.map((m) => m.id)).toEqual(['haiku'])
    })
  })
})
