import { readFileSync } from 'node:fs'
import { mkdir, readFile, readdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor, type AgentToolHost } from '../../src/main/runtime/agent-tools'
import { ACTIVE_THEME_FILE } from '../../src/main/themes/state'
import type { ThemeStore } from '../../src/main/themes/store'
import { themeProblem } from '../../src/main/themes/words'
import { createHostFixture, putTheme, type HostFixture } from './host-fixtures'
import { pngSamples } from './png-samples'

/**
 * A person's own theme was accepted when it was saved. An update that makes the readability check
 * stricter must not take it away: it still loads and applies, and what the check now says about it
 * is shown as notes. Saving it again is still held to the check, and a broken or unsafe theme of
 * one's own is still refused.
 */

/** BroCrew as it shipped before its accent text and second accent were made readable. */
const OLD = JSON.parse(readFileSync(join(__dirname, 'old-brocrew.theme.json'), 'utf8')) as Record<
  string,
  unknown
>
/** A person's copy of it, as Duplicate makes one. */
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
    loader: { sample: (bytes, facts) => (facts.type === 'png' ? pngSamples(bytes) : null) },
  })
})
afterEach(async () => {
  await fixture.cleanup()
})

const row = (id: string) => store.snapshot().themes.find((one) => one.id === id)

describe('a person’s saved theme, after the readability check has grown', () => {
  it('loads and applies, with what the check now says as its notes', async () => {
    await putTheme(fixture.library, 'my-brocrew', COPY, await pictures())
    await store.start()
    const mine = row('my-brocrew')
    expect(mine).toMatchObject({ source: 'mine', status: 'ok' })
    expect(mine!.problems?.length, 'the check has something to say').toBeGreaterThan(0)
    for (const note of mine!.problems!) expect(note.says).toMatch(/ would be too faint: /)
    expect(mine!.reason).toBe(mine!.problems![0]!.says)
    expect(await store.set('my-brocrew')).toMatchObject({ outcome: 'ok', active: 'my-brocrew' })
    expect(store.reading()).toMatchObject({ active: 'my-brocrew' })
    expect(store.reading('my-brocrew')).toHaveProperty('theme.id', 'my-brocrew')
  })

  it('saved again, the same theme is held to the check and refused', async () => {
    await store.start()
    const assets = await Promise.all(
      PICTURES.map(async (name) => ({ name, base64: (await shipped(name)).toString('base64') })),
    )
    const saved = await store.save({ theme: COPY, assets })
    expect(saved).toMatchObject({ outcome: 'refused', rail: 'theme-invalid' })
    if (saved.outcome !== 'refused') return
    expect(saved.problems.length).toBeGreaterThan(0)
    for (const problem of saved.problems) expect(problem.says).toMatch(/ would be too faint: /)
    expect(row('my-brocrew')).toBeUndefined()
  })

  it('saved over, or duplicated, the noted theme is refused, and nothing it had changes', async () => {
    const folder = await putTheme(fixture.library, 'my-brocrew', COPY, await pictures())
    await store.start()
    expect(await store.set('my-brocrew')).toMatchObject({ outcome: 'ok' })
    /** Every file of the theme, and the active choice, as bytes. */
    const files = async (): Promise<Record<string, string>> => {
      const out: Record<string, string> = {}
      for (const path of ['theme.json', ...PICTURES.map((name) => `assets/${name}`)])
        out[path] = (await readFile(join(folder, path))).toString('base64')
      out.active = await readFile(join(fixture.userData, ACTIVE_THEME_FILE), 'utf8')
      return out
    }
    const before = await files()
    const assets = await Promise.all(
      PICTURES.map(async (name) => ({ name, base64: (await shipped(name)).toString('base64') })),
    )
    // The same theme saved over itself with only its name changed.
    expect(
      await store.save({ theme: { ...COPY, name: 'My BroCrew, renamed' }, assets, replace: true }),
    ).toMatchObject({ outcome: 'refused', rail: 'theme-invalid' })
    expect(await store.duplicate('my-brocrew', 'My BroCrew again')).toMatchObject({
      outcome: 'refused',
    })
    expect(await files()).toEqual(before)
    expect((await readdir(fixture.library)).sort()).toEqual(['my-brocrew'])
    expect(store.snapshot()).toMatchObject({ active: 'my-brocrew' })
  })

  it('after a restart, the noted theme is still the one in use, and still applies', async () => {
    await putTheme(fixture.library, 'my-brocrew', COPY, await pictures())
    await store.start()
    expect(await store.set('my-brocrew')).toMatchObject({ outcome: 'ok' })
    await store.close()
    const restarted = fixture.store({
      problem: themeProblem,
      loader: { sample: (bytes, facts) => (facts.type === 'png' ? pngSamples(bytes) : null) },
    })
    const snapshot = await restarted.start()
    expect(snapshot.active).toBe('my-brocrew')
    expect(snapshot.reason).toBeUndefined()
    expect(restarted.reading()).toHaveProperty('theme.id', 'my-brocrew')
  })

  it('repaired as its notes say, it loads with no notes', async () => {
    // What BroCrew itself now sets by hand for its accent text, document links, second accent and
    // solid fill.
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

  it('an agent is told it is usable, with its notes, and can set it', async () => {
    await putTheme(fixture.library, 'my-brocrew', COPY, await pictures())
    await store.start()
    const boundary = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === 'themes') return store
          if (key === 'mayReachAtAll') return () => null
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
    const note = row('my-brocrew')!.reason!
    expect(listed.text).toContain(`my-brocrew · My BroCrew · mine · ok · ${note}`)
    const set = await call('set_theme', { id: 'my-brocrew' })
    expect(set.text).not.toMatch(/refused|can’t|can't/i)
    expect(store.snapshot().active).toBe('my-brocrew')
  })
})
