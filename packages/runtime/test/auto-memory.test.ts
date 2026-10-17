import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import {
  AUTO_MEMORY_INDEX,
  buildChildEnv,
  ClaudeRuntime,
  claudeAutoMemoryDir,
  claudeAutoMemoryIndex,
  claudeProjectDirName,
  isClaudeMemoryTopic,
} from '../src/index'

/**
 * **Where the agent's own memory lives, and whether it can be moved** (165, re-decided at 166).
 *
 * Pin memory to the profile so changing projects does not reset it. Check the directory sent
 * through claudeAutoMemoryDir and whether anything reachable from a session can redirect it.
 *
 * ⚑ The scoping ITSELF is proven live, with four real sessions, in `smoke/auto-memory-probe.smoke.ts`
 * — a path string is not evidence that two profiles cannot read each other's memory.
 */

describe('🔴 the directory we send is the PROFILE’s, and no cwd reaches it (166)', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'brobot2-automem-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('⛔ is `<providerHome>/memory`, and takes no working directory at all', () => {
    expect(claudeAutoMemoryDir('/homes/claude')).toBe(join('/homes/claude', 'memory'))
    // ⚠️ The arity IS the assertion. A one-argument function cannot be scoped by a cwd, so the
    // ticket's middle row — same profile, different project, still remembers — is a property of the
    // signature rather than of a caller remembering to pass the same value twice.
    expect(claudeAutoMemoryDir.length).toBe(1)
  })

  it('⛔ two cwds whose project folders COLLIDE now share nothing — because neither is in the path', () => {
    // The two paths `~/dev/notes-api` and `~/dev/notes/api` exercise a sanitization
    // collision.
    const goHyphen = '/Users/dev/notes-api'
    const goNested = '/Users/dev/notes/api'

    // 1 · Claude Code's per-folder project folders flatten every non-alphanumeric to `-`, so these
    // two are ONE folder there.
    expect(claudeProjectDirName(goHyphen)).toBe(claudeProjectDirName(goNested))

    // 2 · …and under ours the question cannot be asked: the cwd is not a term in the path, for these
    // two or for any other pair.
    const sent = claudeAutoMemoryDir('/homes/claude')
    expect(sent).not.toContain('projects')
    for (const cwd of [goHyphen, goNested, root, '/', '/tmp/a.b', '/tmp/a_b']) {
      expect(sent, `${cwd} reached the memory path`).not.toContain(claudeProjectDirName(cwd))
    }
  })

  it('the index is MEMORY.md directly inside it', () => {
    const index = claudeAutoMemoryIndex('/homes/claude')
    expect(index).toBe(join('/homes/claude', 'memory', 'MEMORY.md'))
    expect(index.includes(`${sep}projects${sep}`), 'the per-project axis survived').toBe(false)
  })
})

describe('🔒 the agent cannot relocate its own memory', () => {
  it('⛔ no inherited CLAUDE_* variable survives into the child', () => {
    // Any `CLAUDE_*` variable in the user's shell could move where the child keeps its memory, and
    // `CLAUDE_CONFIG_DIR` would move the whole home. `buildChildEnv` is an explicit finite
    // ALLOW-LIST, so none of them can arrive from the user's shell, from a `.env` a session wrote, or
    // from anything the agent can reach — including names this app has never heard of.
    const env = buildChildEnv(
      { CLAUDE_CONFIG_DIR: '/homes/claude' },
      {
        PATH: '/usr/bin',
        CLAUDE_SOME_MEMORY_DIR: '/tmp/attacker',
        CLAUDE_SOME_MEMORY_PATH_OVERRIDE: '/tmp/attacker',
        CLAUDE_CONFIG_DIR: '/tmp/attacker-home',
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
      },
    )

    expect(env['CLAUDE_SOME_MEMORY_DIR']).toBeUndefined()
    expect(env['CLAUDE_SOME_MEMORY_PATH_OVERRIDE']).toBeUndefined()
    expect('CLAUDE_CODE_DISABLE_AUTO_MEMORY' in env).toBe(false)
    // …and the one CLAUDE var that does reach the child is the one the ADAPTER sets, layered after
    // the veto, never the inherited one.
    expect(env['CLAUDE_CONFIG_DIR']).toBe('/homes/claude')
    expect(env['PATH']).toBe('/usr/bin')
  })

  it('⚠️ …and the ONLY layer that can carry `autoMemoryDirectory` is the one we write', async () => {
    // 🔴 **This assertion changed direction at 166 and the old one is worth naming.** It read
    // `expect(captured?.settings).toBeUndefined()` — "the app sends no settings object that could
    // carry the field" — which was a true statement about 165 and is now the opposite of the
    // feature. What survives is the property underneath it: nothing ELSE can set the field.
    //
    // Flag settings sit below managed policy settings and above user, project and local settings
    // (`sdk.d.ts`, `Query.applyFlagSettings`). ⛔ `settingSources: []` means user, project and
    // local are never read, so the three lower layers are empty by construction — including a
    // `.claude/settings.json` the agent writes into its own cwd, which is the one an attacker
    // controls. The SDK's own *"Ignored if set in projectSettings … for security"* is a guarantee
    // this app does not have to depend on.
    let captured: Options | undefined
    const handle = await new ClaudeRuntime(
      (params) => {
        captured = params.options
        return new (class {
          async *[Symbol.asyncIterator](): AsyncGenerator<never> {}
          async interrupt(): Promise<unknown> {
            return undefined
          }
          close(): void {}
        })() as never
      },
      async () => true,
    ).start({ cwd: '/tmp/x', providerHome: '/homes/claude' })
    await handle.close()

    expect(captured?.settingSources, 'no user, project or local settings are read').toEqual([])
    expect(captured?.strictMcpConfig).toBe(true)
    // …and what we DO send points inside the app-owned home, derived from the home alone.
    expect(captured?.settings).toEqual({ autoMemoryDirectory: join('/homes/claude', 'memory') })
    // ⚠️ The cwd was `/tmp/x` and must appear nowhere in it — the launch that proves the derivation
    // ignores the session, rather than a caller that happened to pass the same home twice.
    expect(JSON.stringify(captured?.settings)).not.toContain('tmp')
  })
})

/**
 * 🔴 **Which files in that directory are memories, and which one is the index** (322).
 *
 * ⛔ **The reader listed the index alone until 322**, so a real profile's three files reached the
 * panel as one. The provider's own instruction is what settles the shape: *"**Step 1** — write the
 * memory to its own file (e.g. `user_role.md`, `feedback_testing.md`) … **Step 2** — add a pointer
 * to that file in `MEMORY.md`. `MEMORY.md` is an index, not a memory … Never write memory content
 * directly into `MEMORY.md`."*
 */
describe('the memories beside the index (322)', () => {
  it('⛔ the index is not one of its own entries', () => {
    expect(isClaudeMemoryTopic(AUTO_MEMORY_INDEX)).toBe(false)
    // …and the paired positive, so this is a rule about ONE name rather than about `.md`.
    expect(isClaudeMemoryTopic('user_role.md')).toBe(true)
  })

  it('⚠️ Markdown only — the frontmatter format the provider dictates', () => {
    expect(isClaudeMemoryTopic('feedback_testing.md')).toBe(true)
    for (const name of ['notes.txt', 'MEMORY', 'settings.json', '.DS_Store', 'md']) {
      expect(isClaudeMemoryTopic(name), name).toBe(false)
    }
  })

  it('⚑ the check is on the NAME, so it says nothing about a path', () => {
    // ⛔ It is a predicate over one directory entry and the caller does the enumeration — the point
    // 032 makes about second copies: a version of this that took a path would be a second place
    // where "which directory is the store" gets decided.
    expect(isClaudeMemoryTopic('memory/MEMORY.md')).toBe(true)
    expect(isClaudeMemoryTopic(AUTO_MEMORY_INDEX)).toBe(false)
  })
})
