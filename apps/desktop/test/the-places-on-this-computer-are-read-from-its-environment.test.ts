import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { userProviderHomePath } from '../src/main/adopt/user-homes'
import { aProtectedPlace, thePlacesOnThisComputer } from '../src/main/protected-places'

/**
 * # The places a give's folder is compared with, as this computer has them
 *
 * `thePlacesOnThisComputer` is what the app hands the places check at every give: the providers'
 * own folders where they usually are AND where the environment redirects them, this app's data
 * folder, and every other listed workspace's. The places tests build that list by hand and never
 * call this function, so none of these reach it:
 *
 *  - §1 🔴 a redirected `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are named beside `~/.claude` and
 *    `~/.codex`, read from the environment the function is handed — and a folder inside the
 *    redirected one is then said to be inside Claude's folder. Without it a grant on a sign-in
 *    folder that was moved is not said.
 *  - §1 ⛔ this app's own data folder, listed in the workspace file (by its path or through a
 *    link), is never "another workspace"; the other listed one is.
 *  - §2 ⚑ with nothing redirected, each provider's folder is named once, under the home folder
 *    this process has.
 *
 * Every folder is a scratch one. HOME, `CLAUDE_CONFIG_DIR` and `CODEX_HOME` are pointed at a
 * scratch home for each test and put back after, so a function that read this process's
 * environment instead of the one handed to it still never reaches the real home; the test refuses
 * to run if they resolve anywhere else.
 */

const ENV_KEYS = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'] as const

describe.sequential(
  'the places on this computer, from the environment and the workspace list',
  () => {
    let root: string
    /** The throwaway home folder this process is given while a test runs. */
    let theirs: string
    let saved: Record<(typeof ENV_KEYS)[number], string | undefined>

    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'brobot2-places-on-this-computer-'))
      theirs = mkdtempSync(join(tmpdir(), 'brobot2-their-home-'))
      saved = {
        HOME: process.env['HOME'],
        USERPROFILE: process.env['USERPROFILE'],
        CODEX_HOME: process.env['CODEX_HOME'],
        CLAUDE_CONFIG_DIR: process.env['CLAUDE_CONFIG_DIR'],
      }
      process.env['HOME'] = theirs
      process.env['USERPROFILE'] = theirs
      process.env['CODEX_HOME'] = join(theirs, '.codex')
      process.env['CLAUDE_CONFIG_DIR'] = join(theirs, '.claude')
    })

    afterEach(() => {
      for (const key of ENV_KEYS) {
        const value = saved[key]
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      rmSync(root, { recursive: true, force: true })
      rmSync(theirs, { recursive: true, force: true })
    })

    /**
     * ⛔ SAFETY — the person's Codex folder, only when it is the throwaway one. Throws before
     * anything is written or read when it resolves anywhere else.
     */
    const theirCodex = (): string => {
      const home = userProviderHomePath('codex')
      if (!home.startsWith(`${theirs}${sep}`) || homedir() !== theirs) {
        throw new Error(`refusing to run: the codex home resolves to ${home}, outside ${theirs}`)
      }
      return home
    }

    const workspaceOf = (dataFolder: string): string => join(dataFolder, 'brobot-workspace')

    /** A workspace list naming `paths`, in the file format this app writes. */
    const aWorkspaceList = (paths: readonly string[]): string => {
      const file = join(root, 'workspaces.json')
      writeFileSync(
        file,
        JSON.stringify({
          version: 1,
          workspaces: paths.map((path, index) => ({ path, lastOpenedAt: 1_000 + index })),
        }),
      )
      return file
    }

    it('§1 · 🔴 a redirected Claude and Codex folder are named beside the usual ones, and said — ⛔ this app’s own data folder is never another workspace', () => {
      theirCodex()
      const home = join(root, 'home')
      const userData = join(root, 'userData')
      const other = join(root, 'Other')
      const redirectedClaude = join(root, 'redirected-claude')
      const redirectedCodex = join(root, 'redirected-codex')
      for (const folder of [
        join(home, '.claude'),
        join(home, '.codex'),
        workspaceOf(userData),
        workspaceOf(other),
        join(redirectedClaude, 'sub'),
        redirectedCodex,
      ]) {
        mkdirSync(folder, { recursive: true })
      }
      const userDataByALink = join(root, 'link-to-userData')
      symlinkSync(userData, userDataByALink)

      const places = thePlacesOnThisComputer({
        home,
        userData,
        providerHomesRoot: join(userData, 'provider-homes'),
        workspaceList: aWorkspaceList([userData, other, userDataByALink]),
        workspaceOf,
        env: { CLAUDE_CONFIG_DIR: redirectedClaude, CODEX_HOME: redirectedCodex },
      })

      expect(places.home).toBe(home)
      // 🔴 The usual folder and the redirected one, each provider.
      expect(places.providerConfigHomes.claude).toEqual([join(home, '.claude'), redirectedClaude])
      expect(places.providerConfigHomes.codex).toEqual([join(home, '.codex'), redirectedCodex])
      expect(places.providerHomesRoot).toBe(join(userData, 'provider-homes'))
      expect(places.appData).toEqual({ folder: userData, workspace: workspaceOf(userData) })
      // ⛔ This data folder, by its path or through a link, is not another workspace; ⚑ Other is.
      expect(places.otherWorkspaces).toEqual([{ folder: other, workspace: workspaceOf(other) }])

      // 🔴 …and a folder at or inside a redirected one is said to be there.
      expect(aProtectedPlace(join(redirectedClaude, 'sub'), places)).toEqual({
        kind: 'claude-config-home',
        place: redirectedClaude,
        stands: 'inside',
      })
      expect(aProtectedPlace(redirectedCodex, places)).toEqual({
        kind: 'codex-config-home',
        place: redirectedCodex,
        stands: 'is',
      })
      // ⚑ Other's data folder is named as another workspace's; this one as this app's own.
      expect(aProtectedPlace(other, places)).toMatchObject({
        kind: 'another-workspace-data-folder',
        stands: 'is',
      })
      expect(aProtectedPlace(userData, places)).toMatchObject({
        kind: 'app-data-folder',
        stands: 'is',
      })
    })

    it('§2 · ⚑ nothing redirected: each provider’s folder is named once, under this process’s home folder', () => {
      theirCodex()
      const userData = join(root, 'userData')
      mkdirSync(workspaceOf(userData), { recursive: true })
      const places = thePlacesOnThisComputer({
        userData,
        providerHomesRoot: join(userData, 'provider-homes'),
        workspaceList: join(root, 'no-list-here.json'),
        workspaceOf,
        env: {},
      })
      expect(places.home).toBe(theirs)
      expect(places.providerConfigHomes.claude).toEqual([join(theirs, '.claude')])
      expect(places.providerConfigHomes.codex).toEqual([join(theirs, '.codex')])
      // ⛔ A list that is not there names no other workspace.
      expect(places.otherWorkspaces).toEqual([])
    })
  },
)
