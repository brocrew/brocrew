import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor, type AgentToolHost } from '../../src/main/runtime/agent-tools'
import { themeAssetResponse } from '../../src/main/themes/asset-protocol'
import {
  BUILT_IN_THEME_IDS,
  DEFAULT_THEME_ID,
  HIDDEN_BASE_THEME_IDS,
} from '../../src/main/themes/defaults'
import { ThemeStore } from '../../src/main/themes/store'
import { ACTIVE_THEME_FILE, themeRoots, writeActiveTheme } from '../../src/main/themes/state'
import { themeProblem } from '../../src/main/themes/words'
import { readingAssetUrl } from '../../src/renderer/src/lib/window-theme'
import type { ThemeReading } from '../../src/shared/theme-library'
import { themeCss } from '../../src/shared/themes/css'
import { putTheme } from './host-fixtures'
import { pngSamples } from './png-samples'

/**
 * The BroCrew sample ships only as a base. A saved theme that extends it, as one duplicated from
 * the sample does, still loads and applies with its base's colours and pictures. The sample
 * itself is listed nowhere and can't be chosen, and a workspace that had it chosen opens on the
 * default look, says so in the existing words, and keeps its choice on disk.
 */
let root: string
let store: ThemeStore | undefined
let roots: ReturnType<typeof themeRoots>

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'brobot-brocrew-sample-')))
  roots = themeRoots({
    appData: join(root, 'app-data'),
    userData: join(root, 'workspace'),
    resources: join(__dirname, '../../resources'),
    hidden: false,
  })
  await mkdir(roots.userData, { recursive: true })
  await mkdir(roots.library, { recursive: true })
})

afterEach(async () => {
  await store?.close()
  store = undefined
  await rm(root, { recursive: true, force: true })
})

/**
 * The store as the app makes it, over the built-ins as they ship; with `unreadBuiltIns`, the
 * system refuses to let the built-ins folder be looked at.
 */
function shippedStore(unreadBuiltIns = false): ThemeStore {
  store = new ThemeStore({
    ...roots,
    files: {
      rename,
      readdir: (path) => readdir(path),
      lstat: async (path) => {
        if (unreadBuiltIns && path === roots.builtIns)
          throw Object.assign(new Error('held'), { code: 'EPERM' })
        return lstat(path)
      },
    },
    defaultTheme: DEFAULT_THEME_ID,
    builtInIds: BUILT_IN_THEME_IDS,
    hiddenBases: HIDDEN_BASE_THEME_IDS,
    loader: { sample: (bytes, facts) => (facts.type === 'png' ? pngSamples(bytes) : null) },
    problem: themeProblem,
    trash: async () => undefined,
    openFolder: async () => undefined,
    watch: () => () => {},
  })
  return store
}

function agentTools(themes: ThemeStore) {
  const boundary = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'themes') return themes
        if (key === 'mayReachAtAll') return () => null
        if (key === 'whatToCallTheConversation') return () => 'Ada'
        if (key === 'noteRefusal') return () => undefined
        throw new Error(`unexpected host read ${String(key)}`)
      },
    },
  ) as AgentToolHost
  const tools = agentToolsFor(boundary, 'fictional-conversation').tools
  return (name: string, args: Record<string, unknown>) =>
    tools.find((one) => one.name === name)!.call(args)
}

describe('the BroCrew sample ships only as a hidden base', () => {
  it('a saved theme that extends it loads, applies and paints its base', async () => {
    await putTheme(roots.library, 'my-crew', {
      format: 1,
      id: 'my-crew',
      name: 'My crew',
      extends: 'brocrew',
    })
    const themes = shippedStore()
    await themes.start()
    expect(themes.snapshot().themes).toContainEqual(
      expect.objectContaining({ id: 'my-crew', source: 'mine', status: 'ok' }),
    )
    expect(await themes.set('my-crew')).toMatchObject({ outcome: 'ok', active: 'my-crew' })
    const reading = themes.reading() as ThemeReading
    expect(reading.theme).toMatchObject({
      id: 'my-crew',
      frame: { paper: '#14173a', accent: '#ff8a5c' },
      content: { accent: '#e8572a' },
    })
    const painted = `brobot-theme://brocrew/assets/network.png?v=${reading.assetVersions.brocrew}`
    const css = themeCss(reading.theme!, { assetUrl: readingAssetUrl(reading) })
    expect(css).toContain(`--rail-bg-image: url("${painted}");`)
    expect((await themeAssetResponse(painted, themes))?.bytes).toEqual(
      await readFile(join(__dirname, '../../resources/themes/brocrew/assets/network.png')),
    )
  })

  it('is not listed, to a person or an agent, and can’t be chosen', async () => {
    const themes = shippedStore()
    await themes.start()
    expect(themes.snapshot().themes.map((row) => row.id)).not.toContain('brocrew')
    expect(await themes.set('brocrew')).toMatchObject({ outcome: 'refused', rail: 'theme-unknown' })
    expect(themes.reading('brocrew')).toMatchObject({ outcome: 'refused' })
    expect(await themes.duplicate('brocrew', 'Copy')).toMatchObject({ outcome: 'refused' })
    const call = agentTools(themes)
    const listed = await call('list_themes', {})
    expect(listed.text).not.toMatch(/brocrew/)
    expect((await call('list_themes', { catalogue: true })).text).not.toMatch(/brocrew/)
    expect((await call('list_themes', { id: 'brocrew' })).text).not.toMatch(/"id": ?"brocrew"/)
    const set = await call('set_theme', { id: 'brocrew' })
    expect(set.text).toMatch(/refused/)
    expect(themes.snapshot().active).toBe(DEFAULT_THEME_ID)
  })

  it('a workspace that chose it opens on the default look, with the fallback words', async () => {
    await writeActiveTheme(roots.userData, 'brocrew')
    const snapshot = await shippedStore().start()
    expect(snapshot.themes.map((row) => row.id)).not.toContain('brocrew')
    expect(snapshot.active).toBe(DEFAULT_THEME_ID)
    expect(snapshot.reason).toBe(
      "This theme is missing or can't be used, so the default look is shown.",
    )
    expect(await readFile(join(roots.userData, ACTIVE_THEME_FILE), 'utf8')).toBe(
      '{"theme":"brocrew"}\n',
    )
  })

  it('chosen, with a built-ins folder that can’t be read, it is still listed nowhere', async () => {
    await writeActiveTheme(roots.userData, 'brocrew')
    const themes = shippedStore(true)
    const snapshot = await themes.start()
    expect(snapshot.themes).toContainEqual(
      expect.objectContaining({ id: 'defined', source: 'built-in', status: 'refused' }),
    )
    expect(snapshot.themes.map((row) => row.id)).not.toContain('brocrew')
    // With no built-in readable, the default look is the one drawn without a file: classic.
    expect(snapshot.active).toBe('classic')
    expect(snapshot.reason).toBe(
      "This theme is missing or can't be used, so the default look is shown.",
    )
    expect((await agentTools(themes)('list_themes', {})).text).not.toMatch(/brocrew/)
  })

  it('an unknown base is refused with the bases a person can see, not the hidden one', async () => {
    const themes = shippedStore()
    await themes.start()
    const saved = await agentTools(themes)('save_theme', {
      theme: { format: 1, id: 'my-crew', name: 'My crew', extends: 'missing' },
    })
    expect(saved.text).toMatch(/`extends` names “missing”, which isn’t a built-in theme\./)
    expect(saved.text).toContain('“defined”')
    expect(saved.text).toContain('“synthwave”')
    expect(saved.text).not.toMatch(/brocrew/)
    expect(themes.snapshot().themes.map((row) => row.id)).not.toContain('my-crew')
  })
})
