import { readFileSync } from 'node:fs'
import { mkdir, readFile, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor, type AgentToolHost } from '../../src/main/runtime/agent-tools'
import type { ThemeStore } from '../../src/main/themes/store'
import { themeProblem } from '../../src/main/themes/words'
import { createHostFixture, putTheme, type HostFixture } from './host-fixtures'
const OLD = JSON.parse(readFileSync(join(__dirname, 'old-brocrew.theme.json'), 'utf8')) as Record<
  string,
  unknown
>
const COPY = { ...OLD, id: 'my-brocrew', name: 'My BroCrew' }
const PICTURES = ['network.png', 'network-light.png', 'crew.png']
const shipped = (name: string): Promise<Buffer> =>
  readFile(join(__dirname, '../../resources/themes/brocrew/assets', name))
const pictures = async (): Promise<Record<string, Buffer>> =>
  Object.fromEntries(
    await Promise.all(PICTURES.map(async (name) => [`assets/${name}`, await shipped(name)])),
  )

let fixture: HostFixture
let store: ThemeStore
beforeEach(async () => {
  fixture = await createHostFixture()
  store = fixture.store({
    problem: themeProblem,
    loader: { sample: () => true },
  })
})
afterEach(async () => {
  await fixture.cleanup()
})

const row = (id: string) => store.snapshot().themes.find((one) => one.id === id)

describe('a person’s low-contrast theme', () => {
  it('loads and applies without contrast notes', async () => {
    await putTheme(fixture.library, 'my-brocrew', COPY, await pictures())
    await store.start()
    const mine = row('my-brocrew')
    expect(mine).toMatchObject({ source: 'mine', status: 'ok' })
    expect(mine!.problems).toBeUndefined()
    expect(mine!.reason).toBeUndefined()
    expect(await store.set('my-brocrew')).toMatchObject({ outcome: 'ok', active: 'my-brocrew' })
    expect(store.reading()).toMatchObject({ active: 'my-brocrew' })
    expect(store.reading('my-brocrew')).toHaveProperty('theme.id', 'my-brocrew')
  })

  it('saves and can be selected', async () => {
    await store.start()
    const assets = await Promise.all(
      PICTURES.map(async (name) => ({ name, base64: (await shipped(name)).toString('base64') })),
    )
    const saved = await store.save({ theme: COPY, assets })
    expect(saved).toMatchObject({ outcome: 'ok' })
    expect(row('my-brocrew')).toMatchObject({ status: 'ok' })
    expect(await store.set('my-brocrew')).toMatchObject({ outcome: 'ok', active: 'my-brocrew' })
  })

  it('can be replaced and duplicated while retaining the active choice', async () => {
    const folder = await putTheme(fixture.library, 'my-brocrew', COPY, await pictures())
    await store.start()
    expect(await store.set('my-brocrew')).toMatchObject({ outcome: 'ok' })
    const assets = await Promise.all(
      PICTURES.map(async (name) => ({ name, base64: (await shipped(name)).toString('base64') })),
    )
    expect(
      await store.save({ theme: { ...COPY, name: 'My BroCrew, renamed' }, assets, replace: true }),
    ).toMatchObject({ outcome: 'ok' })
    expect(JSON.parse(await readFile(join(folder, 'theme.json'), 'utf8')).name).toBe(
      'My BroCrew, renamed',
    )
    expect(await store.duplicate('my-brocrew', 'My BroCrew again')).toMatchObject({
      outcome: 'ok',
    })
    expect(store.snapshot().themes.some((theme) => theme.name === 'My BroCrew again')).toBe(true)
    expect(store.snapshot()).toMatchObject({ active: 'my-brocrew' })
  })

  it('remains selected after restart', async () => {
    await putTheme(fixture.library, 'my-brocrew', COPY, await pictures())
    await store.start()
    expect(await store.set('my-brocrew')).toMatchObject({ outcome: 'ok' })
    await store.close()
    const restarted = fixture.store({
      problem: themeProblem,
      loader: { sample: () => true },
    })
    const snapshot = await restarted.start()
    expect(snapshot.active).toBe('my-brocrew')
    expect(snapshot.reason).toBeUndefined()
    expect(restarted.reading()).toHaveProperty('theme.id', 'my-brocrew')
  })

  it('also accepts explicit paint overrides', async () => {
    const repaired = {
      ...COPY,
      tokens: {
        content: {
          'accent-text': '#b13c0b',
          'paper-link': '#b13c0b',
          'accent-2-text': '#565bb5',
          'accent-solid-bg': '#cf4719',
        },
      },
    }
    await putTheme(fixture.library, 'my-brocrew', repaired, await pictures())
    await store.start()
    const mine = row('my-brocrew')
    expect(mine).toMatchObject({ source: 'mine', status: 'ok' })
    expect(mine!.problems).toBeUndefined()
    expect(mine!.reason).toBeUndefined()
  })

  it('a broken or unsafe theme of one’s own is still refused', async () => {
    await putTheme(fixture.library, 'unknown-setting', { ...COPY, id: 'unknown-setting', glow: 1 })
    const linked = await putTheme(
      fixture.library,
      'linked-picture',
      { ...COPY, id: 'linked-picture' },
      await pictures(),
    )
    await mkdir(join(linked, 'assets', 'more'), { recursive: true })
    await symlink(join(fixture.outside), join(linked, 'assets', 'more', 'elsewhere'))
    await store.start()
    expect(row('unknown-setting')).toMatchObject({ source: 'mine', status: 'refused' })
    expect(row('linked-picture')).toMatchObject({ source: 'mine', status: 'refused' })
    expect(await store.set('unknown-setting')).toMatchObject({ outcome: 'refused' })
  })

  it('an agent is told it is usable and can select it', async () => {
    await putTheme(fixture.library, 'my-brocrew', COPY, await pictures())
    await store.start()
    const boundary = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === 'themes') return store
          if (key === 'whatToCallTheConversation') return () => 'Ada'
          if (key === 'noteRefusal') return () => undefined
          throw new Error(`unexpected host read ${String(key)}`)
        },
      },
    ) as AgentToolHost
    const tools = agentToolsFor(boundary, 'fictional-conversation').tools
    const call = (name: string, args: Record<string, unknown>) =>
      tools.find((one) => one.name === name)!.call(args)
    const listed = await call('list_themes', {})
    expect(listed.text).toContain('my-brocrew · My BroCrew · mine · ok')
    expect(listed.text).not.toContain('would be too faint')
    const set = await call('set_theme', { id: 'my-brocrew' })
    expect(set.text).not.toMatch(/refused|can’t|can't/i)
    expect(store.snapshot().active).toBe('my-brocrew')
  })
})
