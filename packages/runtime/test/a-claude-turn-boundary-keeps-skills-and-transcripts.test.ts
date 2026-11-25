import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent, type SessionHandle } from '../src/index'
import { ClaudeRuntime, ClaudeSessionHandle } from '../src/claude'
import { FakeQuery, init, collect } from './fake-claude-query'

describe('managed transcript cleanup', () => {
  it('keeps the flag on managed starts and resumes and leaves a personal home unchanged', async () => {
    const folder = realpathSync(mkdtempSync(join(tmpdir(), 'brocrew-retention-flags-')))
    const managedRoot = join(folder, 'provider-homes')
    const managedHome = join(managedRoot, 'default', 'fictional.agent', 'claude')
    const personalHome = join(folder, 'fictional-personal')
    mkdirSync(managedHome, { recursive: true })
    mkdirSync(personalHome)
    const built: Options[] = []
    const runtime = new ClaudeRuntime(
      (params) => {
        const fq = new FakeQuery()
        built.push(params.options)
        fq.cli.listen(params.prompt)
        return fq
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
    let handle: SessionHandle | undefined
    try {
      handle = await runtime.start({ cwd: folder, providerHome: managedHome })
      expect(built.at(-1)!.settings).toMatchObject({ cleanupPeriodDays: 36500 })
      await handle.close()
      handle = await runtime.resume(
        {
          provider: 'claude',
          sessionId: '11111111-1111-4111-8111-111111111111',
          cwd: folder,
          rotation: 0,
        },
        { providerHome: managedHome },
      )
      expect(built.at(-1)!.settings).toMatchObject({ cleanupPeriodDays: 36500 })
      await handle.close()
      handle = await runtime.start({ cwd: folder, providerHome: personalHome })
      expect(built.at(-1)!.settings).not.toHaveProperty('cleanupPeriodDays')
      expect(built).toHaveLength(3)
    } finally {
      await handle?.close()
      rmSync(folder, { recursive: true, force: true })
    }
  })
})

describe('shared skills at a Claude turn boundary', () => {
  let home: string
  let unmock: () => void
  beforeEach(() => {
    home = realpathSync(mkdtempSync(join(tmpdir(), 'fictional-shared-claude-')))
    // Repository discovery is unrelated to skills and would start git; keep that seam fictional.
    const note = vi
      .spyOn(ClaudeSessionHandle.prototype, 'noteAlwaysRulesFile')
      .mockImplementation(() => {})
    const files = vi.spyOn(ClaudeSessionHandle.prototype, 'launchLocalFiles').mockReturnValue([])
    unmock = () => {
      note.mockRestore()
      files.mockRestore()
    }
  })
  afterEach(() => {
    unmock()
    rmSync(home, { recursive: true, force: true })
  })
  it.each(['start', 'resume'] as const)(
    'keeps the shared plugin live on %s and reloads before each prompt',
    async (opening) => {
      const fq = new FakeQuery()
      const reload = vi.fn(async () => ({}))
      Object.assign(fq, { reloadPlugins: reload })
      let options: Options | undefined
      const runtime = new ClaudeRuntime(
        (params) => {
          options = params.options
          fq.cli.listen(params.prompt)
          return fq
        },
        async () => true,
        undefined,
        undefined,
        undefined,
        undefined,
        process.platform,
        undefined,
        '/fictional/claude',
        undefined,
        undefined,
        join(home, 'kept'),
      )
      const builtInSkills = { root: join(home, 'built-in-skills'), skills: [] }
      const context = {
        providerHome: home,
        builtInSkills,
        sharedSkillsRoot: join(home, 'skills'),
        approvalMode: 'ask' as const,
      }
      const handle =
        opening === 'start'
          ? await runtime.start({ ...context, cwd: home })
          : await runtime.resume(
              { provider: 'claude', sessionId: 'sess_shared', cwd: home, rotation: 0 },
              context,
            )
      expect(options?.plugins).toEqual([
        { type: 'local', path: builtInSkills.root },
        { type: 'local', path: context.sharedSkillsRoot },
      ])
      expect(
        (options?.settings as { permissions?: { additionalDirectories?: string[] } })?.permissions
          ?.additionalDirectories,
      ).toContain(context.sharedSkillsRoot)
      // Card 483: in Ask, the kept-files folder is readable at launch, apart from the work folders.
      expect(handle.approval.effective).toBe('ask')
      expect(options?.additionalDirectories).toEqual([join(home, 'kept')])
      fq.emit({
        ...init('sess_shared', home),
        plugins: [{ name: 'brobot', path: builtInSkills.root }],
        skills: [],
      })
      await vi.waitFor(() => expect(handle.ref).not.toBeNull())
      await handle.send('Check the recipe.')
      expect(reload).toHaveBeenCalledTimes(1)
      await expect(handle.send('A concurrent turn.')).rejects.toThrow()
      expect(reload).toHaveBeenCalledTimes(1)
      fq.emit({ type: 'result', subtype: 'success', is_error: false })
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      reload.mockRejectedValueOnce(new Error('fictional reload failure'))
      await expect(handle.send('An unread refresh.')).rejects.toThrow('fictional reload failure')
      expect(handle.status()).toBe('idle')
      await handle.send('Check the edited recipe.')
      expect(reload).toHaveBeenCalledTimes(3)
      fq.emit({ type: 'result', subtype: 'success', is_error: false })
      await vi.waitFor(() => expect(handle.status()).toBe('idle'))
      let release!: () => void
      reload.mockImplementationOnce(
        () =>
          new Promise((done) => {
            release = () => done({})
          }),
      )
      const pending = handle.send('A turn stopped during refresh.')
      const refused = expect(pending).rejects.toThrow('stopped before its message')
      await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(4))
      await handle.close()
      release()
      await refused
    },
  )

  it('keeps a message queued through a slow plugin reload and sends it exactly once', async () => {
    const fq = new FakeQuery()
    let finishReload!: () => void
    const reload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReload = resolve
        }),
    )
    Object.assign(fq, { reloadPlugins: reload })
    const sent: SDKUserMessage[] = []
    const runtime = new ClaudeRuntime(
      (params) => {
        fq.cli.listen(
          (async function* () {
            for await (const message of params.prompt) {
              sent.push(message)
              yield message
            }
          })(),
        )
        return fq
      },
      async () => true,
      undefined,
      undefined,
      undefined,
      undefined,
      process.platform,
      undefined,
      '/fictional/claude',
    )
    const handle = await runtime.start({
      cwd: home,
      providerHome: home,
      builtInSkills: { root: join(home, 'built-in-skills'), skills: [] },
      sharedSkillsRoot: join(home, 'skills'),
    })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    fq.emit({
      ...init('sess_slow_reload', home),
      plugins: [{ name: 'brobot', path: join(home, 'built-in-skills') }],
      skills: [],
    })
    await vi.waitFor(() => expect(handle.ref).not.toBeNull())
    vi.useFakeTimers()
    try {
      const sending = handle.send('Keep this message while the plugins reload.')
      await vi.advanceTimersByTimeAsync(30_000)
      expect(sent).toHaveLength(0)
      expect(fq.closeCount).toBe(0)
      expect(
        events.filter((event) => event.type === 'turn' && event.state === 'failed'),
      ).toHaveLength(0)
      await expect(handle.send('A concurrent message.')).rejects.toThrow()
      finishReload()
      await sending
      await vi.advanceTimersByTimeAsync(0)
      expect(sent).toHaveLength(1)
      expect(JSON.stringify(sent[0])).toContain('Keep this message while the plugins reload.')
      expect(reload).toHaveBeenCalledOnce()
      expect(fq.closeCount).toBe(0)
    } finally {
      vi.useRealTimers()
      await handle.close()
      await consumer
    }
  })

  it('retires a query whose reload timed out, without sending or retrying on that query', async () => {
    const fq = new FakeQuery()
    let finishReload!: () => void
    let finishExit!: () => void
    const reload = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishReload = resolve
        }),
    )
    Object.assign(fq, { reloadPlugins: reload })
    fq.holdReturn = new Promise<void>((resolve) => {
      finishExit = resolve
    })
    let sent = 0
    let nextQuery = fq
    const runtime = new ClaudeRuntime(
      (params) => {
        const query = nextQuery
        query.cli.listen(
          (async function* () {
            for await (const message of params.prompt) {
              sent++
              yield message
            }
          })(),
        )
        return query
      },
      async () => true,
      undefined,
      undefined,
      undefined,
      undefined,
      process.platform,
      undefined,
      '/fictional/claude',
    )
    const context = {
      providerHome: home,
      builtInSkills: { root: join(home, 'built-in-skills'), skills: [] },
      sharedSkillsRoot: join(home, 'skills'),
    }
    const handle = await runtime.start({ ...context, cwd: home })
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    fq.emit({
      ...init('sess_reload_timeout', home),
      plugins: [{ name: 'brobot', path: join(home, 'built-in-skills') }],
      skills: [],
    })
    await vi.waitFor(() => expect(handle.ref).not.toBeNull())

    vi.useFakeTimers()
    try {
      const sending = handle.send('A message awaiting plugin refresh.')
      sending.catch(() => {})
      await vi.advanceTimersByTimeAsync(60_000)
      await expect(sending).rejects.toThrow('reloadPlugins did not answer within 60000ms')
      expect(events.filter((event) => event.type === 'turn')).toHaveLength(1)
      expect(events.filter((event) => event.type === 'turn').at(-1)).toMatchObject({
        state: 'failed',
      })
      expect(sent).toBe(0)
      expect(fq.closeCount).toBe(1)
      expect(fq.returnCount).toBe(1)
      expect(handle.status()).toBe('idle')
      expect(handle.isRetiring?.()).toBe(true)

      await expect(handle.send('Retry while old query exits.')).rejects.toThrow()
      expect(reload).toHaveBeenCalledTimes(1)
      finishReload()
      await vi.advanceTimersByTimeAsync(0)
      await expect(handle.send('Retry after late reload answer.')).rejects.toThrow()
      expect(reload).toHaveBeenCalledTimes(1)
      expect(sent).toBe(0)
    } finally {
      finishExit()
      await handle.close()
      expect(handle.isRetiring?.()).toBe(false)
      expect(handle.status()).toBe('ended')
      vi.useRealTimers()
      await consumer
    }

    const fresh = new FakeQuery()
    const freshReload = vi.fn(async () => ({}))
    Object.assign(fresh, { reloadPlugins: freshReload })
    nextQuery = fresh
    const retry = await runtime.resume(
      { provider: 'claude', sessionId: 'sess_reload_timeout', cwd: home, rotation: 0 },
      context,
    )
    try {
      fresh.emit({
        ...init('sess_reload_timeout', home),
        plugins: [{ name: 'brobot', path: context.builtInSkills.root }],
        skills: [],
      })
      await vi.waitFor(() => expect(retry.ref).not.toBeNull())
      await retry.send('Retry on a fresh query.')
      await vi.waitFor(() => expect(sent).toBe(1))
      expect(freshReload).toHaveBeenCalledTimes(1)
      expect(reload).toHaveBeenCalledTimes(1)
    } finally {
      await retry.close()
    }
  })
})
