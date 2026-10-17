import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ClaudeRuntime, type ClaudeQuery } from '../src/claude/claude-runtime'
import { claudeAutoMemoryDir } from '../src/claude/auto-memory'
import {
  MAX_SETTINGS_BYTES,
  persistedAllowRules,
  persistedRulesFile,
} from '../src/claude/persisted-rules'
import { codexExternalMcpConfig } from '../src/codex/external-mcp'
import {
  KEPT_TOOL_APPROVALS,
  keepToolApproval,
  keptToolApprovals,
  keptToolApprovalsFile,
} from '../src/codex/kept-tool-approvals'
import { AsyncQueue } from '../src/internal/async-queue'

class FakeQuery implements ClaudeQuery {
  private readonly messages = new AsyncQueue<SDKMessage>()
  end(): void {
    this.messages.close()
  }
  async interrupt(): Promise<unknown> {
    return undefined
  }
  close(): void {}
  [Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    return this.messages[Symbol.asyncIterator]()
  }
}

/**
 * 🔴 **736 · R95 / 740 · R99 — a choice that outlives the conversation is KEPT where its CLI keeps
 * it, and read back at the next launch** — the stores this dispatch and `736` built, each driven with
 * real files in a scratch home: Claude's in the provider home's `settings.json` and (`740`) the
 * project's `.claude/settings.local.json`; Codex's MCP *Always allow* beside its `config.toml`. The
 * cards that offer the choices are pinned in each adapter's own tests; what each CLI does with them
 * is measured on the loopback (`probe:tool-calls-as-the-cli`, `probe:codex-mcp-tool-approval`,
 * `probe:codex-command-always`).
 */

let home: string
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'brobot2-736-home-'))
})
afterEach(() => {
  rmSync(home, { recursive: true, force: true })
})

/* ------------------------------------------------ §1 · Claude — the provider home's settings.json */

describe('§1 · Claude’s kept rules — `permissions.allow` in the provider home’s settings.json', () => {
  it('🔴 reads the rules the CLI wrote there', () => {
    // ⚑ The file as the CLI writes it for a `userSettings` update (measured, `736`'s loopback).
    writeFileSync(
      persistedRulesFile(home),
      `${JSON.stringify({ permissions: { allow: ['Bash(rm -f zz736.txt)', 'WebFetch(domain:example.com)'] } }, null, 2)}\n`,
    )
    expect(persistedAllowRules(home)).toEqual([
      'Bash(rm -f zz736.txt)',
      'WebFetch(domain:example.com)',
    ])
  })

  it('⚑ the reader’s bounds — no file, a file with none, a malformed file, an oversized one: no rules, and never a failed launch', () => {
    expect(persistedAllowRules(home)).toEqual([])
    writeFileSync(persistedRulesFile(home), '{"theme":"dark"}')
    expect(persistedAllowRules(home)).toEqual([])
    writeFileSync(persistedRulesFile(home), '{ not json')
    expect(persistedAllowRules(home)).toEqual([])
    writeFileSync(
      persistedRulesFile(home),
      JSON.stringify({ permissions: { allow: ['Bash(x)', 7, '', null] } }),
    )
    expect(persistedAllowRules(home), 'only non-empty strings').toEqual(['Bash(x)'])
    writeFileSync(
      persistedRulesFile(home),
      JSON.stringify({ permissions: { allow: ['x'.repeat(MAX_SETTINGS_BYTES)] } }),
    )
    expect(persistedAllowRules(home), 'past the bound, nothing is read').toEqual([])
  })

  const launchedSettings = async (): Promise<Options['settings']> => {
    let seen: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        seen = params.options
        return new FakeQuery()
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd: home, providerHome: home })
    await handle.close()
    return seen?.settings
  }

  it('🔴 a launch hands the kept rules to the CLI as FLAG settings — its permission rules, nothing else of the file', async () => {
    // ⛔ On `main`: never read — `settingSources: []` loads no settings file, so a rule the CLI wrote
    // was asked again at the next launch (measured). ⚑ Flag settings held it (measured).
    writeFileSync(
      persistedRulesFile(home),
      JSON.stringify({ permissions: { allow: ['Bash(rm -f zz736.txt)'] }, hooks: { Stop: [] } }),
    )
    expect(await launchedSettings()).toEqual({
      autoMemoryDirectory: claudeAutoMemoryDir(home),
      permissions: { allow: ['Bash(rm -f zz736.txt)'] },
    })
  })

  it('⚑ THE CONTROL — a home with no kept rule launches exactly as before `736`', async () => {
    expect(await launchedSettings()).toEqual({ autoMemoryDirectory: claudeAutoMemoryDir(home) })
  })
})

/* ------------------ §1b · 740 · R99 — kept where the CLI keeps it: the project's local settings */

/**
 * 🔴 **740 · R99 (`736` F-4) — *"an always rule is kept where the CLI keeps it"*.** ⚑ Measured on the
 * INTERACTIVE CLI (2.1.281, loopback, `740`'s pty arms K3–K5, outside `/tmp`): its *"don't ask again"*
 * for `make build`, a WebFetch host and an MCP tool each wrote `<project>/.claude/settings.local.json`,
 * held at the next launch in that folder and asked again in another folder. ⚑ **The project** is
 * where `local-settings-location.ts` finds it; its own tests hold the repository and worktree cases.
 *
 * ⛔ **On `main` (`736`)** the next launch read only the provider home's `settings.json`, so a rule the
 * CLI kept in the project was asked again. ⚑ **The permission rules of that file, and nothing else**
 * — its `allow`, and with it its `deny` and `ask`, so a rule a person kept there is never MORE
 * permissive in BroBot than in their own CLI (a `deny` the CLI honours beside an `allow` it honours).
 */
describe('§1b · 740 · R99 — Claude’s kept rules are read from the PROJECT’s local settings, as the CLI keeps them', () => {
  const git = (cwd: string, ...args: string[]): void => {
    execFileSync('git', args, {
      cwd,
      stdio: 'ignore',
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
    })
  }
  const launchedIn = async (cwd: string): Promise<Options['settings']> => {
    let seen: Options | undefined
    const runtime = new ClaudeRuntime(
      (params) => {
        seen = params.options
        return new FakeQuery()
      },
      async () => true,
    )
    const handle = await runtime.start({ cwd, providerHome: home })
    await handle.close()
    return seen?.settings
  }
  const keep = (root: string, permissions: Record<string, unknown>, extra = {}): void => {
    mkdirSync(join(root, '.claude'), { recursive: true })
    writeFileSync(
      join(root, '.claude', 'settings.local.json'),
      `${JSON.stringify({ permissions, ...extra }, null, 2)}\n`,
    )
  }

  it('🔴 a launch in the project reads its permission rules — allow, deny and ask — and nothing else of the file', async () => {
    const project = join(home, 'project')
    mkdirSync(project)
    keep(
      project,
      { allow: ['Bash(make build *)'], deny: ['Bash(rm *)'], ask: ['WebFetch'] },
      { hooks: { Stop: [] }, env: { A: '1' } },
    )
    expect(await launchedIn(project)).toEqual({
      autoMemoryDirectory: claudeAutoMemoryDir(home),
      permissions: { allow: ['Bash(make build *)'], deny: ['Bash(rm *)'], ask: ['WebFetch'] },
    })
  })

  it('⚑ THE CONTROL — a launch in ANOTHER folder of the same identity reads none of it', async () => {
    const project = join(home, 'project')
    const other = join(home, 'other')
    mkdirSync(project)
    mkdirSync(other)
    keep(project, { allow: ['Bash(make build *)'] })
    expect(await launchedIn(other)).toEqual({ autoMemoryDirectory: claudeAutoMemoryDir(home) })
  })

  it('🔴 a local-settings file the REPOSITORY carries gives no `allow` — its `deny` and `ask` stand', async () => {
    // ⚑ The CLI's gate with no trust recorded (`740`'s review): *"Ignoring N permissions.allow
    // entries from .claude/settings.local.json: this workspace has not been trusted"*.
    const repo = join(home, 'repo')
    mkdirSync(repo)
    git(repo, 'init', '-q')
    keep(repo, { allow: ['Bash(curl *)'], deny: ['Bash(rm -rf *)'], ask: ['WebFetch'] })
    git(repo, 'add', '-f', '.claude/settings.local.json')
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x')
    expect(await launchedIn(repo)).toEqual({
      autoMemoryDirectory: claudeAutoMemoryDir(home),
      permissions: { deny: ['Bash(rm -rf *)'], ask: ['WebFetch'] },
    })
  })

  it('🔴 …and in a SUBFOLDER of that repository, the root’s carried `allow` is dropped while the subfolder’s own `deny` stands', async () => {
    const repo = join(home, 'repo')
    const sub = join(repo, 'pkg')
    mkdirSync(sub, { recursive: true })
    git(repo, 'init', '-q')
    keep(repo, { allow: ['Bash(curl *)'] })
    git(repo, 'add', '-f', '.claude/settings.local.json')
    git(repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'x')
    keep(sub, { deny: ['Bash(rm -rf *)'] })
    expect(await launchedIn(sub)).toEqual({
      autoMemoryDirectory: claudeAutoMemoryDir(home),
      permissions: { deny: ['Bash(rm -rf *)'] },
    })
  })

  it('🔴 …nor does one reached through a SYMBOLIC LINK', async () => {
    const project = join(home, 'project')
    const elsewhere = join(home, 'elsewhere')
    mkdirSync(project)
    keep(elsewhere, { allow: ['Bash(curl *)'] })
    symlinkSync(join(elsewhere, '.claude'), join(project, '.claude'))
    expect(await launchedIn(project)).toEqual({ autoMemoryDirectory: claudeAutoMemoryDir(home) })
  })

  it('⚑ …and the provider home’s own rules are read beside them, as before', async () => {
    const project = join(home, 'project')
    mkdirSync(project)
    keep(project, { allow: ['Bash(make build *)'] })
    writeFileSync(
      persistedRulesFile(home),
      JSON.stringify({ permissions: { allow: ['Bash(rm -f zz736.txt)'] } }),
    )
    expect(await launchedIn(project)).toEqual({
      autoMemoryDirectory: claudeAutoMemoryDir(home),
      permissions: { allow: ['Bash(rm -f zz736.txt)', 'Bash(make build *)'] },
    })
  })
})

/* ------------------------------------ §2 · Codex — the kept *Always allow* of an MCP tool */

const KIBANA = 'http://127.0.0.1:1/mcp'

describe('§2 · Codex’s kept *Always allow* — beside `config.toml`, and in each declared server’s own table', () => {
  it('🔴 kept once, read back, and never written twice', () => {
    keepToolApproval(home, { server: 'kibana', url: KIBANA, tool: 'search' })
    keepToolApproval(home, { server: 'kibana', url: KIBANA, tool: 'search' })
    keepToolApproval(home, { server: 'kibana', url: KIBANA, tool: 'export' })
    expect(keptToolApprovals(home)).toEqual([
      { server: 'kibana', url: KIBANA, tool: 'search' },
      { server: 'kibana', url: KIBANA, tool: 'export' },
    ])
    expect(JSON.parse(readFileSync(keptToolApprovalsFile(home), 'utf8'))).toEqual({
      always: [
        { server: 'kibana', url: KIBANA, tool: 'search' },
        { server: 'kibana', url: KIBANA, tool: 'export' },
      ],
    })
    // ⚑ …and the stage it was written through is gone: only the file itself is left.
    expect(readdirSync(home)).toEqual([KEPT_TOOL_APPROVALS])
  })

  it('🔴 a declared server carries its kept approvals in its own table — where the Codex terminal keeps one', () => {
    // ⛔ On `main`: nothing kept, so the next launch asked again (measured). ⚑ Measured through the
    // product: a declaration carrying `tools.<tool>.approval_mode = "approve"` ran the tool unasked.
    const reach = {
      servers: [
        { name: 'kibana', url: KIBANA },
        { name: 'other', url: 'http://127.0.0.1:2/mcp' },
      ],
      reservedToolNames: [],
    }
    expect(
      codexExternalMcpConfig(reach, [{ server: 'kibana', url: KIBANA, tool: 'search' }]),
    ).toEqual({
      mcp_servers: {
        kibana: { url: KIBANA, tools: { search: { approval_mode: 'approve' } } },
        // ⚑ THE CONTROL, one server over: none kept, so exactly what a launch sent before `736`.
        other: { url: 'http://127.0.0.1:2/mcp' },
      },
    })
  })

  it('⛔ a kept approval for a server this launch does NOT declare goes nowhere — never a table Codex cannot load', () => {
    // ⚑ Measured: that table in `config.toml` with no server declared stopped Codex from starting
    // (*"invalid transport"*), which is why the approval is kept beside `config.toml` and not in it.
    const reach = {
      servers: [{ name: 'other', url: 'http://127.0.0.1:2/mcp' }],
      reservedToolNames: [],
    }
    expect(
      codexExternalMcpConfig(reach, [{ server: 'kibana', url: KIBANA, tool: 'search' }]),
    ).toEqual({ mcp_servers: { other: { url: 'http://127.0.0.1:2/mcp' } } })
    // …and a launch granted no server sends nothing at all, kept approvals or not.
    expect(
      codexExternalMcpConfig(undefined, [{ server: 'kibana', url: KIBANA, tool: 'search' }]),
    ).toBeUndefined()
  })

  it('⛔ a server registered AGAIN under the same name at another address inherits nothing — it is another program', () => {
    // ⚑ `736`'s review: keyed by name alone, removing `kibana` and registering a different program as
    // `kibana` elsewhere handed it the first one's *Always allow*.
    const reach = {
      servers: [{ name: 'kibana', url: 'http://127.0.0.1:9/mcp' }],
      reservedToolNames: [],
    }
    expect(
      codexExternalMcpConfig(reach, [{ server: 'kibana', url: KIBANA, tool: 'search' }]),
    ).toEqual({ mcp_servers: { kibana: { url: 'http://127.0.0.1:9/mcp' } } })
  })

  it('⛔ a keep REFUSES to write over a file it could not read — the approvals already in it are not lost', () => {
    writeFileSync(keptToolApprovalsFile(home), '{ not json')
    expect(() => keepToolApproval(home, { server: 'kibana', url: KIBANA, tool: 'search' })).toThrow(
      /could not be read/,
    )
    expect(readFileSync(keptToolApprovalsFile(home), 'utf8')).toBe('{ not json')
    // ⚑ …and a directory where the file should be is refused the same way, leaving no stage behind.
    rmSync(keptToolApprovalsFile(home))
    mkdirSync(keptToolApprovalsFile(home))
    expect(() => keepToolApproval(home, { server: 'kibana', url: KIBANA, tool: 'search' })).toThrow(
      /not a regular file/,
    )
    expect(readdirSync(home)).toEqual([KEPT_TOOL_APPROVALS])
  })

  it('⚑ the reader’s bounds — no file, a malformed one, a directory, an entry missing a field: nothing kept, and a launch is never failed', () => {
    expect(keptToolApprovals(home)).toEqual([])
    writeFileSync(keptToolApprovalsFile(home), '{ not json')
    expect(keptToolApprovals(home)).toEqual([])
    writeFileSync(
      keptToolApprovalsFile(home),
      JSON.stringify({
        always: [
          { server: 'a', url: KIBANA },
          { server: '', url: KIBANA, tool: 'x' },
          { server: 'b', tool: 'y' },
          { server: 'c', url: KIBANA, tool: 'z' },
        ],
      }),
    )
    expect(keptToolApprovals(home)).toEqual([{ server: 'c', url: KIBANA, tool: 'z' }])
    rmSync(keptToolApprovalsFile(home))
    mkdirSync(keptToolApprovalsFile(home))
    expect(keptToolApprovals(home)).toEqual([])
  })
})

/* ------------------------------------------ §3 · a FIFO at either name must not hang a launch */

describe('§3 · a FIFO planted where a kept rule is read is no rules — and never a hung process', () => {
  it('⛔ both readers answer at once on a FIFO: no rules, no approvals (`736`’s review)', () => {
    // ⚑ `O_NONBLOCK`, then the regular-file check: without it `open(2)` on a FIFO waits for a writer,
    // and these run synchronously on Electron's main process at every launch of the home.
    execFileSync('mkfifo', [persistedRulesFile(home), keptToolApprovalsFile(home)])
    const started = Date.now()
    expect(persistedAllowRules(home)).toEqual([])
    expect(keptToolApprovals(home)).toEqual([])
    expect(Date.now() - started).toBeLessThan(5_000)
  })
})
