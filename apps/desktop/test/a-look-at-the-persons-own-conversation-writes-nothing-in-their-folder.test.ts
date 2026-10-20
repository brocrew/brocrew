import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { userProviderHomePath } from '../src/main/adopt/user-homes'
import { BUNDLE_MARKER } from '../src/main/runtime/factory-text'
import { BUNDLE_LEAF } from '../src/main/runtime/profile-bundle'
import { F093World } from './lib/f093-host'

/**
 * # ⛔ F093 · HIGH — a look at a conversation from the person's own `~/.codex` / `~/.claude` writes
 * # nothing into that folder
 *
 * ⚑ **The seam**: `RuntimeHost.providerHomeFor` sends a row adopted with no profile to
 * `userProviderHomePath(provider)`, which reads `CODEX_HOME` / `CLAUDE_CONFIG_DIR` and else
 * `homedir()`. ⛔ **This file never touches the real home**: `HOME`, `CODEX_HOME` and
 * `CLAUDE_CONFIG_DIR` are pointed at a throwaway folder before anything runs, and every test asks
 * {@link theirFolder} — which THROWS before any host call when the seam resolves anywhere but a
 * throwaway folder.
 *
 * ⚑ **What is measured**: the whole tree under the person's folder, path → size, mtime and sha256,
 * before and after — no file new, none changed. ⚑ **The pair**: a conversation adopted from a home
 * BroBot made (`profileId` set) IS composed into, and its rules file is written there — the design.
 */

/** Every file and folder under `root`: its size, mtime and fingerprint. */
function treeOf(root: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      const rel = relative(root, path)
      if (entry.isDirectory()) {
        out[`${rel}/`] = 'dir'
        walk(path)
        continue
      }
      const stat = lstatSync(path)
      const sha = createHash('sha256').update(readFileSync(path)).digest('hex')
      out[rel] = `${String(stat.size)}:${String(stat.mtimeMs)}:${sha}`
    }
  }
  walk(root)
  return out
}

const ENV_KEYS = ['HOME', 'USERPROFILE', 'CODEX_HOME', 'CLAUDE_CONFIG_DIR'] as const

describe.sequential('⛔ F093 · nothing is composed into the person’s own provider folder', () => {
  let world: F093World
  /** The throwaway "home" the person's own `.codex` and `.claude` sit in. */
  let theirs: string
  let saved: Record<(typeof ENV_KEYS)[number], string | undefined>

  /**
   * ⛔ **SAFETY — the person's folder for `provider`, only when it is a throwaway one.** Throws
   * before anything is opened when the seam resolves outside the temp folders this file made.
   */
  const theirFolder = (provider: Provider): string => {
    const home = userProviderHomePath(provider)
    const safe = [theirs, world.userData].some((dir) => home.startsWith(`${dir}${sep}`))
    if (!safe || homedir() !== theirs) {
      throw new Error(
        `refusing to run: the ${provider} home resolves to ${home} (homedir ${homedir()}), outside the throwaway folders`,
      )
    }
    return home
  }

  /** ⚑ A conversation the sweep found in the person's own folder: adopted, with no profile. */
  const adoptTheirs = (id: string, provider: Provider, profileId: string | null = null): void => {
    world.store.adopt({
      id,
      provider,
      sessionId: `ext_${id}`,
      cwd: world.project,
      profileId,
      createdAt: 1_000,
      updatedAt: 2_000,
    })
  }

  beforeEach(() => {
    world = new F093World()
    theirs = mkdtempSync(join(tmpdir(), 'brobot2-f093-their-home-'))
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
    // ⚑ The person's own files, which must come out exactly as they went in.
    mkdirSync(join(theirs, '.codex', 'sessions', '2026'), { recursive: true })
    writeFileSync(join(theirs, '.codex', 'AGENTS.md'), 'Their own rule: always tabs.\n')
    writeFileSync(join(theirs, '.codex', 'config.toml'), 'model = "theirs"\n')
    writeFileSync(join(theirs, '.codex', 'sessions', '2026', 'rollout.jsonl'), '{"theirs":true}\n')
    mkdirSync(join(theirs, '.claude', 'projects'), { recursive: true })
    writeFileSync(join(theirs, '.claude', 'CLAUDE.md'), 'Their own memory.\n')
    writeFileSync(join(theirs, '.claude', 'settings.json'), '{}\n')
  })

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const value = saved[key]
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await world.dispose()
    rmSync(theirs, { recursive: true, force: true })
  })

  it('⛔ Codex: a look and the one read leave the person’s ~/.codex exactly as it was — no AGENTS.override.md', async () => {
    const codexHome = theirFolder('codex')
    const host = world.buildHost()
    adoptTheirs('sess_theirs', 'codex')
    const before = treeOf(theirs)

    const looked = await host.look('sess_theirs', world.window, false)
    // ⚑ The premise: the look really is about the person's own folder.
    expect(looked.providerHome).toBe(codexHome)
    expect(looked.ranAsNobody).toBe('user-home')
    expect(looked.instructions.injected).toEqual([])

    const read = await host.whatThisAgentWasGiven('sess_theirs')
    expect(read.launch).toEqual({ recorded: false, why: 'before-this-build', running: false })
    expect(read.files).toEqual([])
    expect(read.thisConversation).toBeNull()

    expect(existsSync(join(codexHome, BUNDLE_LEAF.codex))).toBe(false)
    expect(treeOf(theirs)).toEqual(before)
  })

  it('⛔ Claude: a look and the one read leave the person’s ~/.claude exactly as it was — no brobot-instructions.md', async () => {
    const claudeHome = theirFolder('claude')
    const host = world.buildHost()
    adoptTheirs('sess_theirs_claude', 'claude')
    const before = treeOf(theirs)

    const looked = await host.look('sess_theirs_claude', world.window, false)
    expect(looked.providerHome).toBe(claudeHome)
    expect(looked.ranAsNobody).toBe('user-home')

    const read = await host.whatThisAgentWasGiven('sess_theirs_claude')
    expect(read.launch).toEqual({ recorded: false, why: 'before-this-build', running: false })
    expect(read.files).toEqual([])

    expect(existsSync(join(claudeHome, BUNDLE_LEAF.claude))).toBe(false)
    expect(treeOf(theirs)).toEqual(before)
  })

  it('⛔ a folder whose NAME starts with the managed root’s is still not the managed root’s', async () => {
    // ⚑ `<root>-theirs/.codex`: a prefix check would take it as "under the root"; `relative` does not.
    const beside = join(`${world.root()}-theirs`, '.codex')
    mkdirSync(beside, { recursive: true })
    writeFileSync(join(beside, 'AGENTS.md'), 'Their own rule.\n')
    process.env['CODEX_HOME'] = beside
    expect(theirFolder('codex')).toBe(beside)
    const host = world.buildHost()
    adoptTheirs('sess_beside', 'codex')
    const before = treeOf(beside)

    await host.look('sess_beside', world.window, false)
    const read = await host.whatThisAgentWasGiven('sess_beside')
    expect(read.files).toEqual([])
    expect(existsSync(join(beside, BUNDLE_LEAF.codex))).toBe(false)
    expect(treeOf(beside)).toEqual(before)
  })

  it('⚑ the pair: a conversation adopted from a home BroBot made IS composed there, and the person’s folder is still untouched', async () => {
    theirFolder('codex')
    const host = world.buildHost()
    const managed = world.homeOf('codex', 'lead')
    mkdirSync(managed, { recursive: true })
    adoptTheirs('sess_ours', 'codex', 'lead')
    const theirsBefore = treeOf(theirs)

    const looked = await host.look('sess_ours', world.window, false)
    expect(looked.providerHome).toBe(managed)
    expect(looked.ranAsNobody).toBeUndefined()
    // ⚑ The look composes into BroBot's own home — its rules file is written there.
    const leaf = join(managed, BUNDLE_LEAF.codex)
    expect(existsSync(leaf)).toBe(true)
    expect(readFileSync(leaf, 'utf8').startsWith(BUNDLE_MARKER)).toBe(true)

    const read = await host.whatThisAgentWasGiven('sess_ours')
    expect(read.launch.recorded).toBe(false)
    // ⚑ W4.177 — it ran before this app took it in, so it was launched: not by a launch kept here.
    expect(read.launch.recorded === false && read.launch.why).toBe('before-this-build')
    expect(read.files[0]?.kind).toBe('profile-instructions')
    expect(read.files[0]?.textIs).toBe('composed-now')
    expect(read.files[0]?.text).toBe(readFileSync(leaf, 'utf8'))

    expect(treeOf(theirs)).toEqual(theirsBefore)
  })
})
