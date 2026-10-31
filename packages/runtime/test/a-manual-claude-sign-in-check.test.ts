import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { probeClaudeCodeLogin, type RunAProgram } from '../src/internal/claude-login-renewal'

let folder: string
beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), 'fake-claude-check-'))
})
afterEach(() => {
  rmSync(folder, { recursive: true, force: true })
})

it.each([
  [{ code: 0, timedOut: false }, 'usable'],
  [{ code: 1, timedOut: false }, 'unknown'],
  [{ code: null, timedOut: false }, 'unknown'],
  [{ code: 0, timedOut: true }, 'unknown'],
] as const)('a manual Claude check reports only its measured outcome %j', async (ended, state) => {
  const run = vi.fn(async () => ended)
  const result = await probeClaudeCodeLogin({ findProgram: () => '/fake/claude', env: {}, run })
  expect(result.state).toBe(state)
  expect(run).toHaveBeenCalledOnce()
})

it('runs the installed program with no tools, MCP, hooks or history and no app credentials', async () => {
  const run = vi.fn(async () => ({ code: 0, timedOut: false }))
  await probeClaudeCodeLogin({
    findProgram: () => '/fake/claude',
    platform: 'darwin',
    env: {
      ANTHROPIC_API_KEY: 'fake-key',
      CLAUDE_CODE_OAUTH_TOKEN: 'fake-token',
      CLAUDE_CONFIG_DIR: '/fake/profile',
    },
    run,
  })
  const [program, args, options] = run.mock.calls[0] as unknown as [
    string,
    string[],
    { env: Record<string, string>; timeoutMs: number },
  ]
  expect(program).toBe('/fake/claude')
  expect(args).toEqual(
    expect.arrayContaining(['-p', '--no-session-persistence', '--strict-mcp-config']),
  )
  expect(args[args.indexOf('--tools') + 1]).toBe('')
  expect(args[args.indexOf('--mcp-config') + 1]).toBe('{"mcpServers":{}}')
  expect(args).not.toContain('--bare')
  expect(options.env).not.toHaveProperty('ANTHROPIC_API_KEY')
  expect(options.env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN')
  expect(options.env).not.toHaveProperty('CLAUDE_CONFIG_DIR')
  expect(options.timeoutMs).toBe(8_000)
})

it('does not start a cancelled or missing program, and never exposes thrown diagnostics', async () => {
  const run = vi.fn(async () => {
    throw new Error('fake secret diagnostic')
  })
  const findProgram = vi.fn(() => '/fake/claude')
  expect(
    (await probeClaudeCodeLogin({ findProgram, run, signal: AbortSignal.abort() })).state,
  ).toBe('unknown')
  expect(findProgram).not.toHaveBeenCalled()
  expect((await probeClaudeCodeLogin({ findProgram: () => null, run })).state).toBe('unknown')
  expect(run).not.toHaveBeenCalled()
  const result = await probeClaudeCodeLogin({ findProgram, run, env: {} })
  expect(result.state).toBe('unknown')
  expect(JSON.stringify(result)).not.toContain('fake secret diagnostic')
})

it.each(['darwin', 'win32'] as const)(
  'the %s probe uses the conversation environment instead of inherited backend routing',
  async (platform) => {
    const run = vi.fn<RunAProgram>(async () => ({ code: 0, timedOut: false }))
    const inherited = {
      HOME: '/fictional/home',
      Path: 'C:\\fictional\\bin',
      PATH: '/fictional/bin',
      SystemRoot: 'C:\\fictional\\Windows',
      HTTPS_PROXY: 'https://proxy.invalid',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      CLAUDE_CODE_USE_FOUNDRY: '1',
      ANTHROPIC_BASE_URL: 'https://gateway.invalid',
      claude_code_use_bedrock: '1',
      anthropic_base_url: 'https://other-gateway.invalid',
      AWS_PROFILE: 'fictional-backend',
      CLAUDE_CONFIG_DIR: '/fictional/other-login',
    }
    const result = await probeClaudeCodeLogin({
      findProgram: () => '/fictional/claude',
      platform,
      env: inherited,
      run,
    })
    expect(result.state).toBe('usable')
    const env = run.mock.calls[0]![2].env
    for (const key of Object.keys(inherited).filter((key) => /claude|anthropic|aws/i.test(key)))
      expect(env).not.toHaveProperty(key)
    expect(env.HOME).toBe('/fictional/home')
    expect(env.HTTPS_PROXY).toBe('https://proxy.invalid')
    if (platform === 'win32') expect(env.SystemRoot).toBe('C:\\fictional\\Windows')
    expect(inherited.CLAUDE_CODE_USE_BEDROCK).toBe('1')
  },
)

describe.skipIf(process.platform === 'win32')(
  'fake programs are reaped before the check returns',
  () => {
    it.each(['timeout', 'cancel'] as const)(
      '%s escalates past an ignored SIGTERM and reaps the child',
      async (how) => {
        const program = join(folder, 'fake-claude')
        const pidFile = join(folder, 'pid')
        writeFileSync(
          program,
          `#!/bin/sh\ntrap '' TERM\necho $$ > '${pidFile}'\nwhile :; do :; done\n`,
        )
        chmodSync(program, 0o700)
        const abort = new AbortController()
        const work = probeClaudeCodeLogin({
          findProgram: () => program,
          env: { PATH: '/usr/bin:/bin' },
          signal: abort.signal,
          timeLimitMs: how === 'timeout' ? 200 : 5_000,
          stopGraceMs: 20,
        })
        await vi.waitFor(() => expect(() => readFileSync(pidFile, 'utf8')).not.toThrow())
        const pid = Number(readFileSync(pidFile, 'utf8').trim())
        if (how === 'cancel') abort.abort()
        expect((await work).state).toBe('unknown')
        expect(() => process.kill(pid, 0)).toThrow()
      },
    )
  },
)
