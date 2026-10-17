import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { executeRuntimeCommand } from '../src/main/runtime/ipc'
import { brobotWorkspace, CODEX_INSTRUCTIONS_FILE } from '../src/main/runtime/workspace'
import { sizeOf, type WhatThisAgentWasGiven } from '../src/shared/what-this-agent-was-given'
import { F093World, RecordingSink, waitFor } from './lib/f093-host'
import { legacyWorkspaceFiles } from './helpers/legacy-workspace-files'
import { fingerprintOf } from '../src/main/runtime/what-this-agent-was-given'

/**
 * # F093 · the one read (`bridge.whatThisAgentWasGiven`) — who wrote each part, and how the tools are handed
 *
 * ⚑ **Origins the dev's tests leave unread**: a profile's own `CLAUDE.md` (`unknown` — a person or the
 * agent, this app can't tell), Codex's memory summary (`the-provider`) beside an agent's note
 * (`an-agent`), a repository file Codex reported reading (`read-by-codex`, `a-repository`, Codex's own
 * sentence), a surviving person-written workspace file and an explicit legacy fixture, and the profile file
 * Codex reports listed once.
 *
 * ⚑ **Every deferral kind there is** (`GivenDeferral.kind`, all four): `unknown` (Claude reported no
 * tool list), `names-until-loaded` (Claude published `ToolSearch`), `in-every-request` (Claude without
 * it; Codex always), `found-by-search` (an external server's tools on Codex) — with what each does to
 * the total.
 *
 * ⛔ **The window's door**: through `executeRuntimeCommand`, a person's read; a channel no person is
 * behind is refused.
 */

describe('F093 · the one read: origins, deferrals, and its door', () => {
  let world: F093World

  beforeEach(() => {
    world = new F093World()
  })

  afterEach(async () => {
    await world.dispose()
  })

  /** ⚑ A server for everyone, so every identity is handed it. */
  const registerDocs = (): void => {
    const row = world.store.registerExternalMcpServer({
      name: 'docs',
      url: 'http://127.0.0.1:9/mcp',
      reach: 'everyone',
    })
    if (row === null) throw new Error('the server was not registered')
  }

  it('⚑ Claude: a profile’s own CLAUDE.md is “unknown” — a person or the agent — and read now', async () => {
    const home = world.homeOf('claude', 'lead')
    mkdirSync(home, { recursive: true })
    writeFileSync(join(home, 'CLAUDE.md'), 'Profile memory: keep it brief.\n')
    const host = world.buildHost()
    const lead = await world.open(host, 'claude', 'lead')
    const read = await host.whatThisAgentWasGiven(lead)

    const own = read.files.find((one) => one.kind === 'profile-memory')
    expect(own).toMatchObject({
      path: join(home, 'CLAUDE.md'),
      origin: 'unknown',
      madeAutomatically: false,
      reach: 'in-every-request',
      textIs: 'read-now',
      changedSinceLaunch: false,
      refused: null,
      sections: [],
    })
    expect(own?.originSays).toMatch(/can’t tell/)
    expect(own?.text).toBe('Profile memory: keep it brief.\n')
    expect(own?.size).toEqual(sizeOf('Profile memory: keep it brief.\n'))
    // ⚑ The control beside it: BroBot's own file says BroBot wrote it.
    expect(read.files[0]).toMatchObject({ kind: 'profile-instructions', origin: 'brobot' })
    expect(read.files[0]?.originSays).toMatch(/BroCrew writes this file at every launch/)
  })

  it('Codex reports person-written project and workspace files, and the profile file once', async () => {
    const codexHome = world.homeOf('codex', 'lead')
    const profilePath = join(codexHome, 'AGENTS.override.md')
    const repository = join(world.project, 'AGENTS.md')
    const workspace = join(brobotWorkspace(world.userData), CODEX_INSTRUCTIONS_FILE)
    writeFileSync(repository, 'Repository rule: tabs.\n')
    writeFileSync(workspace, '# Workspace notes\nWritten here.\n')
    world.end.reportedSources = [profilePath, repository, workspace]
    const host = world.buildHost()
    const lead = await world.open(host, 'codex', 'lead')

    const given = world.launchesOf(lead)[0]?.given
    expect(given?.files.some((one) => one.path === profilePath)).toBe(false)
    const keptRepository = given?.files.find((one) => one.path === repository)
    expect(keptRepository).toMatchObject({ kind: 'read-by-codex' })
    expect(keptRepository?.text).toBeUndefined()
    expect(given?.files.find((one) => one.path === workspace)).toMatchObject({
      kind: 'read-by-codex',
    })
    expect(given?.files.find((one) => one.path === workspace)?.text).toBeUndefined()
    expect(given?.files.some((one) => one.kind === 'workspace-instructions')).toBe(false)

    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.files.filter((one) => one.path === profilePath)).toHaveLength(1)
    expect(read.files[0]?.kind).toBe('profile-instructions')
    const fromTheRepository = read.files.find((one) => one.path === repository)
    expect(fromTheRepository).toMatchObject({
      kind: 'read-by-codex',
      origin: 'a-repository',
      madeAutomatically: false,
      textIs: 'read-now',
      changedSinceLaunch: false,
      text: 'Repository rule: tabs.\n',
    })
    expect(fromTheRepository?.originSays).toMatch(/Codex reads it itself/)
    const fromTheWorkspace = read.files.find((one) => one.path === workspace)
    expect(fromTheWorkspace).toMatchObject({
      kind: 'read-by-codex',
      origin: 'a-repository',
      madeAutomatically: false,
      textIs: 'read-now',
      text: '# Workspace notes\nWritten here.\n',
    })
  })

  it('keeps the known origin of an explicit previous-release workspace fixture', async () => {
    const legacy = legacyWorkspaceFiles().find((one) => one.name === CODEX_INSTRUCTIONS_FILE)
    if (legacy === undefined) throw new Error('the legacy AGENTS fixture is missing')
    const path = join(brobotWorkspace(world.userData), legacy.name)
    const host = world.buildHost()
    const lead = await world.open(host, 'codex', 'lead')
    const given = world.launchesOf(lead)[0]?.given
    if (given === undefined) throw new Error('the launch record is missing')
    await host.close(lead, world.window)
    world.store.append(
      lead,
      world.store.nextOrdinal(lead),
      {
        type: 'launched',
        given: {
          ...given,
          files: [
            ...given.files,
            {
              path,
              kind: 'workspace-instructions',
              text: legacy.content,
              bytes: Buffer.byteLength(legacy.content),
              sha256: fingerprintOf(legacy.content),
              truncated: false,
            },
          ],
        },
      },
      Date.now(),
    )
    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.files.find((one) => one.path === path)).toMatchObject({
      origin: 'brobot',
      madeAutomatically: true,
      textIs: 'as-launched',
      text: legacy.content,
    })
  })

  it('⚑ Codex memory: its summary is the provider’s and in every request; an agent’s note is the agent’s, opened on request', async () => {
    const memories = join(world.homeOf('codex', 'lead'), 'memories')
    const notes = join(memories, 'extensions', 'ad_hoc', 'notes')
    mkdirSync(notes, { recursive: true })
    writeFileSync(join(memories, 'memory_summary.md'), 'Summary: prefers tabs.\n')
    writeFileSync(join(memories, 'MEMORY.md'), 'Handbook: the long version.\n')
    writeFileSync(join(notes, 'note-a.md'), 'A note the agent kept.\n')
    const host = world.buildHost()
    const lead = await world.open(host, 'codex', 'lead')
    const read = await host.whatThisAgentWasGiven(lead)

    const codex = read.memory.stores.find((one) => one.provider === 'codex')
    const byName = (name: string) => codex?.entries.find((one) => one.path.endsWith(name))
    expect(byName('memory_summary.md')).toMatchObject({
      origin: 'the-provider',
      reach: 'in-every-request',
      text: 'Summary: prefers tabs.\n',
    })
    expect(byName('MEMORY.md')).toMatchObject({
      origin: 'the-provider',
      reach: 'when-the-agent-opens-it',
    })
    expect(byName('note-a.md')).toMatchObject({
      origin: 'an-agent',
      reach: 'when-the-agent-opens-it',
    })
    expect(codex?.total).toBe(3)
    // ⚑ Only what is in every request is counted there: the summary, and nothing else.
    expect(read.size.memoryInEveryRequest).toEqual(sizeOf('Summary: prefers tabs.\n'))
  })

  it('⚑ Claude: unknown until a tool list comes, names-until-loaded with ToolSearch, in-every-request without — and the total follows', async () => {
    registerDocs()
    const host = world.buildHost()
    const lead = await world.open(host, 'claude', 'lead')
    const handle = world.end.newest().handle

    const before = await host.whatThisAgentWasGiven(lead)
    expect(before.tools.deferral.kind).toBe('unknown')
    expect(before.externalServers).toEqual([
      { name: 'docs', tools: null, deferral: before.tools.deferral },
    ])

    handle.simulateToolInventory({
      published: {
        tools: [
          'Bash',
          'ToolSearch',
          'mcp__brobot__give_work',
          'mcp__docs__search',
          'mcp__docs__fetch',
        ],
        servers: [
          { name: 'brobot', status: 'connected' },
          { name: 'docs', status: 'connected' },
        ],
      },
    })
    await waitFor(() => world.countOf(lead, 'tool_inventory') === 1, 'the first tool list')
    const loaded = await host.whatThisAgentWasGiven(lead)
    expect(loaded.tools.deferral.kind).toBe('names-until-loaded')
    expect(loaded.externalServers).toEqual([
      { name: 'docs', tools: ['search', 'fetch'], deferral: loaded.tools.deferral },
    ])
    // ⛔ Only the names are in every request: the total counts them, never every definition.
    const names = sizeOf(
      loaded.tools.list.map((one) => `mcp__${loaded.tools.server}__${one.name}`).join('\n'),
    )
    const s = loaded.size
    expect(s.provider).toBeNull()
    // ⚑ W4.184 · and the other server's tools by name, which every request carries too.
    const theirs = sizeOf(['mcp__docs__search', 'mcp__docs__fetch'].join('\n'))
    expect(s.otherServersToolsInEveryRequest).toEqual(theirs)
    expect(s.toolsInEveryRequest).toEqual(names)
    expect(s.total.characters).toBe(
      s.brobot.characters +
        s.otherFiles.characters +
        names.characters +
        theirs.characters +
        s.memoryInEveryRequest.characters,
    )
    expect(s.tools.characters).toBeGreaterThan(names.characters)

    handle.simulateToolInventory({
      published: {
        tools: ['Bash', 'mcp__brobot__give_work', 'mcp__docs__search'],
        servers: [{ name: 'brobot', status: 'connected' }],
      },
    })
    await waitFor(() => world.countOf(lead, 'tool_inventory') === 2, 'the second tool list')
    const full = await host.whatThisAgentWasGiven(lead)
    expect(full.tools.deferral.kind).toBe('in-every-request')
    expect(full.tools.deferral.says).toMatch(/^Claude hands the model/)
    const f = full.size
    // ⚑ W4.184 · handed over in full, the other server's tools cannot be counted: this app keeps
    // none of their descriptions, and says so.
    expect(f.otherServersToolsInEveryRequest).toBeNull()
    expect(f.otherServersToolsWhy).toMatch(/keeps none of their descriptions/)
    expect(f.total.characters).toBe(
      f.brobot.characters +
        f.otherFiles.characters +
        f.tools.characters +
        f.memoryInEveryRequest.characters,
    )
  })

  it('⚑ Codex: BroBot’s tools in every request; an external server’s are found by search', async () => {
    registerDocs()
    const host = world.buildHost()
    const lead = await world.open(host, 'codex', 'lead')
    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.tools.deferral.kind).toBe('in-every-request')
    expect(read.tools.deferral.says).toMatch(/^Codex hands the model/)
    expect(read.externalServers).toHaveLength(1)
    expect(read.externalServers[0]).toMatchObject({
      name: 'docs',
      tools: null,
      deferral: { kind: 'found-by-search' },
    })
    expect(read.externalServers[0]?.deferral.says).toMatch(/tool search/)
  })

  it('⛔ the window’s door: a person’s read answers; a channel no person is behind is refused; an unknown id is refused', async () => {
    const host = world.buildHost()
    const lead = await world.open(host, 'claude', 'lead')
    const answer = (await executeRuntimeCommand(host, world.window, {
      kind: 'whatThisAgentWasGiven',
      sessionId: lead,
    })) as WhatThisAgentWasGiven
    expect(answer.sessionId).toBe(lead)
    expect(answer.profileId).toBe('lead')
    expect(answer.files[0]?.kind).toBe('profile-instructions')

    const noPerson = new RecordingSink('webContents:9', false)
    await expect(
      executeRuntimeCommand(host, noPerson, { kind: 'whatThisAgentWasGiven', sessionId: lead }),
    ).rejects.toThrow(/whatThisAgentWasGiven .*refused unless a person is asking/)
    await expect(
      executeRuntimeCommand(host, world.window, {
        kind: 'whatThisAgentWasGiven',
        sessionId: 'sess_nobody',
      }),
    ).rejects.toThrow()
  })
})
