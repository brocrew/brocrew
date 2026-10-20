import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { classifyHandedPath } from '../src/main/runtime/handed-path'
import { composeSystemHint } from '../src/main/runtime/instructions'
import { fingerprintOf, toolsetFingerprint } from '../src/main/runtime/what-this-agent-was-given'
import { theMessagesOf, type HandedPath } from '../src/shared/runtime-ipc'
import type { WhatALaunchGave } from '../src/shared/what-this-agent-was-given'
import { F093World, waitFor, type Handed } from './lib/f093-host'

/**
 * # 🔴 F093 · R2 — what a `launched` row and a `user_turn` row keep is EXACTLY what the provider got
 *
 * ⚑ The dev's tests read the rows with `toContain`. These compare them with the provider end itself
 * (`TheProviderEnd`): the `systemHint` a Claude launch was handed, the text every `send` carried, the
 * toolset a launch was handed, and the files on disk the provider reads itself (Codex).
 *
 * ⛔ `sent` equals the text handed over, character for character — a plain turn, a turn with an
 * attachment, a turn of several held messages, Codex's first turn with its lead, and a later turn
 * without it. ⛔ A person's `/compact` on Codex hands over no words, and its row keeps no `sent`.
 * ⚑ A reopened conversation's launch keeps its record too (the resume door's own site).
 */

describe('F093 · R2 — kept as the provider got it', () => {
  let world: F093World

  beforeEach(() => {
    world = new F093World()
  })

  afterEach(async () => {
    await world.dispose()
  })

  const givenOf = (sessionId: string, at = 0): WhatALaunchGave => {
    const given = world.launchesOf(sessionId)[at]?.given
    if (given === undefined) throw new Error(`launch ${String(at)} of ${sessionId} kept no record`)
    return given
  }

  const hintOf = (handed: Handed): string => {
    const hint = handed.handle.systemHint
    if (hint === undefined) throw new Error('the launch was handed no system hint')
    return hint
  }

  const seedClaudeMemory = (profileId: string): string => {
    const dir = join(world.homeOf('claude', profileId), 'memory')
    mkdirSync(dir, { recursive: true })
    const index = join(dir, 'MEMORY.md')
    writeFileSync(index, '- [Style](style.md) — one line per change\n')
    return index
  }

  it('🔴 Claude: the launch’s record is the system hint it was handed — BroBot’s words verbatim, the rest by the fingerprint of what was sent', async () => {
    const index = seedClaudeMemory('lead')
    const repository = join(world.project, 'CLAUDE.md')
    writeFileSync(repository, 'Repository rule: tabs, never spaces.\n')
    const host = world.buildHost()
    const lead = await world.open(host, 'claude', 'lead')
    const handed = world.end.newest()
    const hint = hintOf(handed)
    const given = givenOf(lead)

    // ⛔ BroBot's profile file: what was published, what the provider was appended, and the record agree.
    const profile = given.profileFile
    expect(profile?.refused).toBeNull()
    expect(profile?.text.length).toBeGreaterThan(1_000)
    expect(readFileSync(profile?.path ?? '', 'utf8')).toBe(profile?.text)
    expect(hint.includes(profile?.text ?? '∅')).toBe(true)
    // ⛔ This conversation's own text is the LAST block of the hint, verbatim.
    expect(given.thisConversation).not.toBeNull()
    expect(hint.endsWith(given.thisConversation?.text ?? '∅')).toBe(true)
    // ⚑ Every file BroBot keeps in full is in the hint as kept.
    for (const file of given.files) {
      if (file.text !== undefined) expect(hint.includes(file.text), file.path).toBe(true)
    }
    // ⛔ The repository's file: by fingerprint only, and the fingerprint is of the text that was sent.
    const sentText = readFileSync(repository, 'utf8')
    const kept = given.files.find((one) => one.path === repository)
    expect(kept?.text).toBeUndefined()
    expect(kept?.sha256).toBe(fingerprintOf(sentText))
    expect(kept?.bytes).toBe(Buffer.byteLength(sentText, 'utf8'))
    expect(hint.includes(sentText)).toBe(true)
    // ⛔ The memory there at launch, by the fingerprint of its own bytes.
    const memory = given.memory.find((one) => one.path.endsWith('MEMORY.md'))
    expect(memory?.sha256).toBe(fingerprintOf(readFileSync(index, 'utf8')))
    // ⛔ The tools: the toolset the provider was handed, by its own fingerprint, and their paragraph
    // in full.
    const toolset = handed.options.agentTools
    if (toolset === undefined) throw new Error('the launch was handed no toolset')
    expect(toolset.instructions?.length).toBeGreaterThan(0)
    expect(given.tools).toEqual({
      server: toolset.server,
      count: toolset.tools.length,
      sha256: toolsetFingerprint(toolset),
      instructions: toolset.instructions,
    })
    // ⛔ The line above each block, as kept: with the texts, they ARE the hint, character for
    // character, in the order it was handed.
    const blocks = [
      `${profile?.heading ?? '∅'}\n\n${profile?.text ?? '∅'}`,
      ...given.files.map(
        (file) => `${file.heading ?? '∅'}\n\n${file.text ?? readFileSync(file.path, 'utf8')}`,
      ),
      `${given.thisConversation?.heading ?? '∅'}\n\n${given.thisConversation?.text ?? '∅'}`,
    ]
    expect(blocks.join('\n\n')).toBe(hint)
  })

  it('🔴 Claude: a turn’s `sent` is the text its provider was handed, character for character — with an attachment too', async () => {
    writeFileSync(join(world.project, 'notes.md'), '# notes\n')
    const chosen = await classifyHandedPath(join(world.project, 'notes.md'), world.project)
    if (!('handed' in chosen)) throw new Error('the fixture path did not classify')
    const file: HandedPath = chosen.handed
    const host = world.buildHost()
    const lead = await world.open(host, 'claude', 'lead')
    const handed = world.end.newest()

    await host.send(lead, 'please plan the next release', world.window)
    await waitFor(() => world.turnsOf(lead).length === 1, 'the first turn')
    await host.send(lead, 'read this for me', world.window, [file])
    await waitFor(() => world.turnsOf(lead).length === 2, 'the second turn')

    expect(handed.sends).toHaveLength(2)
    const [plain, attached] = world.turnsOf(lead)
    expect(plain?.text).toBe('please plan the next release')
    expect(plain?.sent).toBe(handed.sends[0])
    expect(plain?.sent).not.toBe(plain?.text)
    // ⚑ The attachment block is in what was sent; the words alone stay in `text`.
    expect(attached?.text).toBe('read this for me')
    expect(attached?.attachments).toEqual([file])
    expect(attached?.sent).toBe(handed.sends[1])
    expect(attached?.sent).toContain(JSON.stringify(file.path))
  })

  it('🔴 a turn of several held messages keeps the one text that carried them all', async () => {
    const host = world.buildHost()
    const lead = await world.open(host, 'claude', 'lead', { approvalMode: 'ask' })
    const handed = world.end.newest()
    const cards = (): string[] =>
      world.ledger(lead).flatMap((event) => (event.type === 'permission_request' ? [event.id] : []))

    await host.send(lead, 'the first thing', world.window)
    await waitFor(() => cards().length === 1, 'the first turn to park on its card')
    for (const words of ['held one', 'held two']) {
      const outcome = await host.queueMessage(lead, words, world.window)
      expect(outcome.outcome, words).toBe('queued')
    }
    const card = cards()[0]
    if (card === undefined) throw new Error('no card')
    await host.respondPermission(lead, card, { outcome: 'allow' }, world.window)
    await waitFor(() => world.turnsOf(lead).length === 2, 'the turn of several')

    const together = world.turnsOf(lead)[1]
    if (together === undefined) throw new Error('no turn of several')
    expect(theMessagesOf(together).map((one) => one.text)).toEqual(['held one', 'held two'])
    expect(handed.sends).toHaveLength(2)
    expect(together.sent).toBe(handed.sends[1])
    expect(together.sent).toContain('held one')
    expect(together.sent).toContain('held two')
    // ⚑ The first turn's own text stayed its own.
    expect(world.turnsOf(lead)[0]?.sent).toBe(handed.sends[0])
  })

  it('🔴 Codex: the first turn keeps the lead the launch recorded, exactly; the next keeps no lead; the profile file is the one Codex reads', async () => {
    const host = world.buildHost()
    const lead = await world.open(host, 'codex', 'lead')
    const handed = world.end.newest()
    const given = givenOf(lead)

    await host.send(lead, 'please plan the next release', world.window)
    await waitFor(() => world.turnsOf(lead).length === 1, 'the first turn')
    await host.send(lead, 'and then the one after', world.window)
    await waitFor(() => world.turnsOf(lead).length === 2, 'the second turn')

    const [first, second] = world.turnsOf(lead)
    expect(handed.sends).toHaveLength(2)
    expect(first?.sent).toBe(handed.sends[0])
    expect(second?.sent).toBe(handed.sends[1])
    // ⛔ The lead in front of the first turn is the recorded per-conversation text, as composed.
    const conversation = given.thisConversation
    if (conversation === null) throw new Error('the launch kept no per-conversation text')
    const lead0 = composeSystemHint([], conversation)
    if (lead0 === undefined) throw new Error('nothing composed')
    expect(handed.sends[0]?.startsWith(lead0)).toBe(true)
    expect(handed.sends[1]?.startsWith(lead0)).toBe(false)
    // ⛔ Codex reads BroBot's file itself: the record is the file it reads.
    expect(given.placement).toBe('first-message')
    expect(readFileSync(join(world.homeOf('codex', 'lead'), 'AGENTS.override.md'), 'utf8')).toBe(
      given.profileFile?.text,
    )
  })

  it('⛔ Codex: a person’s /compact hands over no words, so its row keeps no `sent`; the next turn keeps its own', async () => {
    world.end.compactsOnCodex = true
    const host = world.buildHost()
    const lead = await world.open(host, 'codex', 'lead')
    const handed = world.end.newest()

    await host.send(lead, '/compact', world.window)
    await waitFor(() => world.turnsOf(lead).length === 1, 'the /compact row')
    await waitFor(() => handed.handle.compactions === 1, 'the compaction')
    const [compact] = world.turnsOf(lead)
    expect(compact?.text).toBe('/compact')
    expect(compact).not.toHaveProperty('sent')
    expect(handed.sends).toEqual([])

    await host.send(lead, 'and now the words', world.window)
    await waitFor(() => world.turnsOf(lead).length === 2, 'the next turn')
    expect(handed.sends).toHaveLength(1)
    expect(world.turnsOf(lead)[1]?.sent).toBe(handed.sends[0])
  })

  it('⚑ a reopened conversation’s launch keeps its own record, and it is what the resumed provider was handed', async () => {
    const host = world.buildHost()
    const lead = await world.open(host, 'claude', 'lead')
    await host.close(lead, world.window)
    await host.resumeSession(lead, world.window)
    await waitFor(() => world.launchesOf(lead).length === 2, 'the second launch row')

    const resumed = world.end.newest()
    expect(world.end.handed).toHaveLength(2)
    const given = givenOf(lead, 1)
    const hint = hintOf(resumed)
    expect(hint.includes(given.profileFile?.text ?? '∅')).toBe(true)
    expect(hint.endsWith(given.thisConversation?.text ?? '∅')).toBe(true)
    const toolset = resumed.options.agentTools
    if (toolset === undefined) throw new Error('the resume was handed no toolset')
    expect(given.tools.sha256).toBe(toolsetFingerprint(toolset))
    // ⚑ And the read describes THAT launch.
    const read = await host.whatThisAgentWasGiven(lead)
    expect(read.launch).toMatchObject({ recorded: true, running: true })
    expect(read.files[0]?.textIs).toBe('as-launched')
  })
})
