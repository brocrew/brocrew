import { expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCodexModule } from '../src/main/providers/codex'

type KeyChange = { to: 'the-key'; apiKey: string } | { to: 'no-key' }

for (const mutation of ['remove', 'replace'] as const) {
  it(`an omitted legacy launch reads the ${mutation}d key after its home queue opens`, async () => {
    const root = mkdtempSync(join(tmpdir(), 'legacy-key-queue-'))
    const home = join(root, 'fern', 'codex')
    let current: { key: string; setAt: number } | null = { key: 'fictional-first-key', setAt: 17 }
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let preparations = 0
    let changes = 0
    let first: Promise<unknown> | undefined
    let second: Promise<unknown> | undefined
    const read = vi.fn(async () => current)
    const copy = vi.fn(() => writeFileSync(join(home, 'auth.json'), '{"auth_mode":"chatgpt"}'))
    const change = vi.fn(async (target: string, asked: KeyChange = { to: 'no-key' }) => {
      if (++changes === 1) await held
      if (asked.to === 'the-key') {
        writeFileSync(
          join(target, 'auth.json'),
          JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: asked.apiKey }),
        )
        return { ok: true as const, authMethod: 'apikey' }
      }
      rmSync(join(target, 'auth.json'), { force: true })
      return { ok: true as const, authMethod: null }
    })
    const module = createCodexModule(
      {
        managedRoot: root,
        defaultProfile: 'fern',
        homeOf: () => home,
        profiles: () => ['fern'],
        assertMayOpen: () => {},
      },
      {
        runtime: { command: () => '/fictional/codex' },
        home: {
          provisionHome: () => {
            preparations++
            mkdirSync(home, { recursive: true })
          },
          key: { current: read, change },
          provisionCodexAuth: copy,
        },
        auth: { command: () => '/fictional/codex' },
      },
    )
    try {
      first = module.prepareLaunch('fern')
      await vi.waitFor(() => expect(change).toHaveBeenCalledTimes(1))
      second = module.prepareLaunch('fern')
      await vi.waitFor(() => expect(preparations).toBe(2))
      expect(read).toHaveBeenCalledTimes(1)
      current = mutation === 'remove' ? null : { key: 'fictional-next-key', setAt: 23 }
      release()
      await Promise.all([first, second])
      expect(read).toHaveBeenCalledTimes(2)
      expect(change.mock.calls).toEqual([
        [home, { to: 'the-key', apiKey: 'fictional-first-key' }],
        [
          home,
          mutation === 'remove'
            ? { to: 'no-key' }
            : { to: 'the-key', apiKey: 'fictional-next-key' },
        ],
      ])
      const auth = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8'))
      if (mutation === 'remove') {
        expect(auth).toEqual({ auth_mode: 'chatgpt' })
        expect(existsSync(join(home, 'brobot-api-key-login.json'))).toBe(false)
        expect(copy).toHaveBeenCalledExactlyOnceWith(home)
      } else {
        expect(auth).toEqual({ auth_mode: 'apikey', OPENAI_API_KEY: 'fictional-next-key' })
        expect(JSON.parse(readFileSync(join(home, 'brobot-api-key-login.json'), 'utf8'))).toEqual({
          setAt: 23,
        })
        expect(copy).not.toHaveBeenCalled()
      }
    } finally {
      release()
      await Promise.allSettled([first, second].filter((one) => one !== undefined))
      rmSync(root, { recursive: true, force: true })
    }
  })
}
