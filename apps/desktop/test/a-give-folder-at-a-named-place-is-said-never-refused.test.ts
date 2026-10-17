import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { aProtectedPlace, type ThePlaces } from '../src/main/protected-places'
import { protectedPlaceSaid } from '../src/shared/work-folders'

/**
 * # 🔴 W4.189 · D — a give's folder at one of the places this app names is SAID, never refused
 *
 * A folder at, inside, or containing `~/.claude`, `~/.codex`, a provider home, this app’s
 * data folder, another workspace’s data, the home folder, or `/` is disclosed to the giver
 * and the person rather than refused for its location.
 *
 * ⛔ **Synthetic places only**: a scratch home with its own `.claude` and `.codex`, a scratch data
 * folder, a scratch second workspace. Nothing here names this computer's real folders.
 */
describe('W4.189 · D — the places a folder is said to meet', () => {
  let root: string
  let home: string
  let places: ThePlaces

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-w4189-places-'))
    home = join(root, 'home')
    const userData = join(home, 'Library', 'Application Support', '@brobot2', 'desktop')
    const other = join(home, 'BroBot workspaces', 'Research')
    for (const folder of [
      join(home, '.claude', 'projects'),
      join(home, '.codex', 'sessions'),
      join(home, 'dev', 'project'),
      join(userData, 'provider-homes', 'default', 'claude'),
      join(userData, 'brobot-workspace', 'projects', 'one'),
      join(other, 'brobot-workspace'),
      join(root, 'redirected-codex'),
    ]) {
      mkdirSync(folder, { recursive: true })
    }
    places = {
      home,
      claudeConfigHomes: [join(home, '.claude')],
      codexConfigHomes: [join(home, '.codex'), join(root, 'redirected-codex')],
      providerHomesRoot: join(userData, 'provider-homes'),
      appData: { folder: userData, workspace: join(userData, 'brobot-workspace') },
      otherWorkspaces: [{ folder: other, workspace: join(other, 'brobot-workspace') }],
    }
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('🔴 a provider’s own folder: at it, inside it, and holding it', () => {
    expect(aProtectedPlace(join(home, '.claude'), places)).toEqual({
      kind: 'claude-config-home',
      place: join(home, '.claude'),
      stands: 'is',
    })
    expect(aProtectedPlace(join(home, '.codex', 'sessions'), places)).toMatchObject({
      kind: 'codex-config-home',
      stands: 'inside',
    })
    // ⚑ A redirected CODEX_HOME is one too.
    expect(aProtectedPlace(join(root, 'redirected-codex'), places)).toMatchObject({
      kind: 'codex-config-home',
      stands: 'is',
    })
  })

  it('🔴 the provider homes and this app’s data folder — but never its workspace folder', () => {
    const providerHome = join(places.providerHomesRoot, 'default', 'claude')
    expect(aProtectedPlace(providerHome, places)).toMatchObject({
      kind: 'profile-homes',
      stands: 'inside',
    })
    expect(aProtectedPlace(places.appData.folder, places)).toMatchObject({
      kind: 'app-data-folder',
      stands: 'is',
    })
    // ⚑ Where agents work today: the workspace, and a project inside it, are not named.
    expect(aProtectedPlace(places.appData.workspace, places)).toBeNull()
    expect(aProtectedPlace(join(places.appData.workspace, 'projects', 'one'), places)).toBeNull()
    // ⚑ A folder holding the data folder holds the database too.
    expect(aProtectedPlace(join(home, 'Library'), places)).toMatchObject({
      kind: 'app-data-folder',
      stands: 'holds',
    })
  })

  it('🔴 another listed workspace’s data folder, but for its own workspace folder', () => {
    const other = places.otherWorkspaces[0]!
    expect(aProtectedPlace(other.folder, places)).toMatchObject({
      kind: 'another-workspace-data-folder',
      stands: 'is',
    })
    expect(aProtectedPlace(other.workspace, places)).toBeNull()
  })

  it('🔴 the home folder itself and `/` — never a folder inside home', () => {
    expect(aProtectedPlace(home, places)).toEqual({
      kind: 'home-folder',
      place: home,
      stands: 'is',
    })
    // ⚑ With no provider folders inside it, home is named as home.
    const bare = { ...places, claudeConfigHomes: [], codexConfigHomes: [] }
    const elsewhere = { ...bare, providerHomesRoot: join(root, 'nowhere'), otherWorkspaces: [] }
    const away = {
      ...elsewhere,
      appData: { folder: join(root, 'nowhere-data'), workspace: join(root, 'nowhere-data', 'w') },
    }
    expect(aProtectedPlace(home, away)).toEqual({ kind: 'home-folder', place: home, stands: 'is' })
    expect(aProtectedPlace(root, away)).toMatchObject({ kind: 'home-folder', stands: 'holds' })
    // ⚑ `/` IS the top of the disk, which outranks holding the home folder.
    expect(aProtectedPlace('/', away)).toEqual({
      kind: 'filesystem-root',
      place: '/',
      stands: 'is',
    })
    expect(aProtectedPlace('/', { ...away, home: join(root, 'no-home') })).toEqual({
      kind: 'filesystem-root',
      place: '/',
      stands: 'is',
    })
    // ⛔ An ordinary folder in home is not named.
    expect(aProtectedPlace(join(home, 'dev', 'project'), places)).toBeNull()
  })

  it('🔴 by what a folder IS: a link to one, and a link holding one', () => {
    const link = join(root, 'link-to-claude')
    symlinkSync(join(home, '.claude'), link)
    expect(aProtectedPlace(link, places)).toMatchObject({
      kind: 'claude-config-home',
      stands: 'is',
    })
    const linkedHome = join(root, 'linked-home')
    symlinkSync(home, linkedHome)
    expect(aProtectedPlace(join(linkedHome, '.codex', 'sessions'), places)).toMatchObject({
      kind: 'codex-config-home',
      stands: 'inside',
    })
    // ⚑ A link INTO a place is inside it (the W4.189 review).
    const into = join(home, 'dev', 'sessions-link')
    symlinkSync(join(home, '.codex', 'sessions'), into)
    expect(aProtectedPlace(into, places)).toMatchObject({
      kind: 'codex-config-home',
      stands: 'inside',
    })
    // ⚑ …and a place that is itself a link is held by what holds where it really is.
    const dotfiles = join(root, 'dotfiles')
    mkdirSync(join(dotfiles, 'claude'), { recursive: true })
    const linked = { ...places, claudeConfigHomes: [join(root, 'claude-link')] }
    symlinkSync(join(dotfiles, 'claude'), join(root, 'claude-link'))
    expect(aProtectedPlace(dotfiles, linked)).toMatchObject({
      kind: 'claude-config-home',
      stands: 'holds',
    })
    // ⛔ …and a link to an ordinary folder is ordinary.
    const ordinary = join(root, 'link-to-project')
    symlinkSync(join(home, 'dev', 'project'), ordinary)
    expect(aProtectedPlace(ordinary, places)).toBeNull()
  })

  it.runIf(process.platform === 'darwin')(
    '🔴 macOS: another case, and the /System/Volumes/Data spelling, name the same place',
    () => {
      // ⚑ A case-blind disk: the same folder by another spelling (skipped where it is not).
      const upper = join(home, '.CLAUDE')
      if (existsSync(upper)) {
        expect(aProtectedPlace(upper, places)).toMatchObject({ kind: 'claude-config-home' })
      }
      const data = join('/System/Volumes/Data', join(home, '.codex'))
      if (existsSync(data)) {
        expect(aProtectedPlace(data, places)).toMatchObject({
          kind: 'codex-config-home',
          stands: 'is',
        })
      }
    },
  )

  it.runIf(process.platform !== 'win32' && process.getuid?.() !== 0)(
    '⛔ a folder that cannot be compared is said so — never quietly passed',
    () => {
      const locked = join(root, 'locked')
      mkdirSync(join(locked, 'inside'), { recursive: true })
      chmodSync(locked, 0o000)
      try {
        expect(aProtectedPlace(join(locked, 'inside'), places)).toEqual({ kind: 'could-not-check' })
      } finally {
        chmodSync(locked, 0o755)
      }
    },
  )

  it('⚑ the words: what the place is, and that nothing was refused', () => {
    const notice = aProtectedPlace(join(home, '.codex', 'sessions'), places)
    if (notice === null) throw new Error('no notice')
    const said = protectedPlaceSaid(join(home, '.codex', 'sessions'), notice)
    expect(said).toBe(
      `${join(home, '.codex', 'sessions')} is inside Codex’s own folder, where its sign-in and settings are (${join(home, '.codex')}). It was used all the same: nothing here refuses a folder.`,
    )
    expect(protectedPlaceSaid('/x', { kind: 'could-not-check' })).toMatch(/could not be checked/)
  })
})
