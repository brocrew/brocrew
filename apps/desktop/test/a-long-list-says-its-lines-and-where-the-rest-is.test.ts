import { realpathSync } from 'node:fs'
import { sep } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentToolset } from '@brobot2/runtime'
import { answerCodexToolCall } from '../../../packages/runtime/src/codex/agent-tools'
import type { AgentCard } from '../src/main/runtime/agent-directory'
import { agentToolsFor, type ToolName } from '../src/main/runtime/agent-tools'
import type { GiveOutcome, RuntimeHost } from '../src/main/runtime/runtime-host'
import {
  SHORT_REPLY_CHARACTERS,
  shortenedIfLong,
  toolRepliesFolder,
} from '../src/main/runtime/tool-families/long-replies'
import { aGiverAndHelper, type AServiceWorld } from './helpers/a-service-world'
import { answerOn } from './helpers/call-tool'
import { fullReplyPath, splitFullReply, toolTextViaClaude, wholeReply } from './lib/full-reply'

/**
 * 🔴 **484 · a long list or record says its actionable lines, and where the rest is.**
 *
 * Majid, 25 Nov: when list_tasks, list_agents, get_agent_status, list_profiles or list_questions
 * would answer at length, the reply is a short form ending `Full reply: <path>`, and the whole reply
 * is in that file in the system temp folder. A reply that is already short is unchanged. Both
 * providers send the same words, because the reply is made above both adapters; §4 drives the
 * real Claude MCP server and the real Codex tool-call answer to show it.
 */

const accepted = (given: GiveOutcome) => {
  if (!given.ok) throw new Error(given.refusal.reason)
  return given
}

const textOf = async (tools: AgentToolset, name: ToolName, args: Record<string, unknown> = {}) =>
  (await answerOn(tools, name, args)).text

const aLongBrief = (n: number) =>
  `Fictional brief ${String(n)}. ` +
  'Measure the room, list the chairs and note the light. '.repeat(30)

describe('484 · a long reply is a short form and a file; a short one is unchanged', () => {
  let world: AServiceWorld
  let host: RuntimeHost
  let giver: string

  beforeEach(async () => {
    ;({ world, host, giver } = await aGiverAndHelper())
  })
  afterEach(async () => {
    vi.restoreAllMocks()
    await world.cleanUp()
  })

  /** `count` pieces given to one helper conversation, each with a long brief. */
  async function givesMany(count: number) {
    const first = accepted(
      await world.gives(host, giver, 'helper', {
        title: 'Survey room 1',
        brief: aLongBrief(1),
        definition_of_done: 'Room 1 is surveyed, and the notes are kept on the piece.',
      }),
    )
    const pieces = [first]
    for (let n = 2; n <= count; n++)
      pieces.push(
        accepted(
          await world.gives(host, giver, 'helper', {
            to: first.label,
            title: `Survey room ${String(n)}`,
            brief: aLongBrief(n),
            definition_of_done: `Room ${String(n)} is surveyed, and the notes are kept on the piece.`,
          }),
        ),
      )
    return pieces
  }

  it('§1 a board of one short piece is compact, with no file', async () => {
    const piece = accepted(await world.gives(host, giver, 'helper'))
    const text = await textOf(agentToolsFor(host, giver), 'list_tasks')
    expect(text.length).toBeLessThanOrEqual(SHORT_REPLY_CHARACTERS)
    expect(text).not.toContain('Full reply:')
    expect(text).toContain(piece.label)
    expect(text).not.toContain('Done when:')
  })

  it('§2 a long board keeps a line a piece inline, and the whole board is in the file', async () => {
    const pieces = await givesMany(12)
    const text = await textOf(agentToolsFor(host, giver), 'list_tasks')
    const { short, path, full } = splitFullReply(text)
    // The same real spelling Claude is given for the folder, whatever symlink the temp folder is behind.
    expect(path.startsWith(`${toolRepliesFolder()}${sep}`)).toBe(true)
    expect(realpathSync.native(path)).toBe(path)
    expect(short.length).toBeLessThanOrEqual(SHORT_REPLY_CHARACTERS)
    expect(short).toContain('work you gave:')
    for (const piece of pieces) {
      const line = short.split('\n').find((one) => one.includes(`${piece.label} · `))
      expect(line, piece.label).toMatch(/ · [a-z-]+ · held by .+ · (given|status at) /)
      expect(full).toContain(piece.label)
    }
    expect(short).not.toContain('Done when:')
    expect(full).toContain('Done when: Room 12 is surveyed')
    expect(full).not.toContain('Full reply:')
  })

  it('§3 a long record keeps its line, status, done condition and brief inline', async () => {
    const [piece] = await givesMany(1)
    const text = await textOf(agentToolsFor(host, giver), 'list_tasks', { piece: piece!.label })
    const { short, full } = splitFullReply(text)
    expect(short).toContain(`${piece!.label} · Survey room 1`)
    expect(short).toContain('Done when: Room 1 is surveyed')
    expect(short).toContain(`Its brief:\n${aLongBrief(1)}`)
    // What the record says past them — its last exchange — is in the file only.
    expect(full.length).toBeGreaterThan(short.length)
    expect(full).toContain(`Its brief:\n${aLongBrief(1)}`)
  })

  it('§4 Claude and Codex agree on compact boards, named detail and spilled replies', async () => {
    const piece = accepted(await world.gives(host, giver, 'helper'))
    const tools = agentToolsFor(host, giver)
    const codexList = async (args: Record<string, unknown>): Promise<string> => {
      const result = await answerCodexToolCall(tools, {
        tool: 'list_tasks',
        namespace: tools.server,
        arguments: args,
      })
      expect(result.success).toBe(true)
      return (result.contentItems as { text: string }[]).map((one) => one.text).join('\n')
    }
    const waitForPerson = (label: string) =>
      vi.waitFor(() => {
        const row = host.pieceBoard(giver).gave.find((one) => one.label === label)
        expect(row?.state).toBe('waiting-on-a-person')
      })
    await waitForPerson(piece.label)
    const compact = await codexList({})
    expect(await toolTextViaClaude(tools, 'list_tasks', {})).toBe(compact)
    expect(compact).toContain(piece.label)
    expect(compact).not.toMatch(/Full reply:|Done when:|brocrew:\/\//)
    const expectMatchingSpills = (codexText: string, claudeText: string) => {
      const codex = splitFullReply(codexText)
      const claude = splitFullReply(claudeText)
      expect(claude.short).toBe(codex.short)
      expect(claude.full).toBe(codex.full)
      expect(claude.path).not.toBe(codex.path)
      return codex
    }

    const named = { piece: piece.label }
    const namedReply = expectMatchingSpills(
      await codexList(named),
      await toolTextViaClaude(tools, 'list_tasks', named),
    )
    expect(namedReply.short).toContain(
      'Done when: The room is booked and the confirmation is recorded.',
    )
    expect(namedReply.full).toContain('Its brief:\nbook the meeting room for Tuesday')

    const [longPiece] = await givesMany(12)
    await waitForPerson(longPiece!.label)
    expectMatchingSpills(await codexList({}), await toolTextViaClaude(tools, 'list_tasks', {}))
  })

  it('§5 a long conversation list keeps who, state and context a line', async () => {
    for (let n = 1; n <= 14; n++)
      accepted(
        await world.gives(host, giver, 'helper', { conversation_title: `Room ${String(n)}` }),
      )
    const answer = await answerOn(agentToolsFor(host, giver), 'list_agents', {})
    const { short, full } = splitFullReply(answer.text)
    expect(short.length).toBeLessThan(full.length)
    for (const line of short.split('\n').filter((one) => one.startsWith('conversation ')))
      expect(line.split(' · ').length).toBeGreaterThanOrEqual(3)
    expect(short).not.toContain('holds ')
    const cards = answer.structured?.agents as AgentCard[]
    const held = cards.flatMap((card) => card.pieces).find((piece) => piece.state !== null)
    if (held === undefined) throw new Error('fictional roster has no held task')
    expect(full).toContain(`${held.label} · ${held.title} (${held.state})`)
    expect(full).not.toMatch(/holds W[\d.]+(?: · [^\n]+?)? \(0\)/)
  })

  it('§6 a long roster keeps who each profile is and each provider’s usage, and is shorter', async () => {
    for (let n = 1; n <= 45; n++)
      world.anAgent(`fictional-building-surveyor-${String(n)}`, 'normal')
    const text = await textOf(agentToolsFor(host, giver), 'list_profiles')
    const { short, full } = splitFullReply(text)
    // What each runs on is in the file, so the reply with its path is still shorter than the whole.
    expect(text.length).toBeLessThan(full.length)
    const line = (body: string) =>
      body.split('\n').find((one) => one.startsWith('fictional-building-surveyor-1 '))
    // Who it is stays; what it runs on is in the file.
    expect(line(short)).not.toContain(' · claude')
    expect(line(full)).toContain(' · claude')
    expect(short).toMatch(/usage/)
  })

  it('§8 a long board of answered pieces is never longer than the whole reply', async () => {
    const first = accepted(
      await world.gives(host, giver, 'helper', { title: 'Survey the fictional east wing, room 1' }),
    )
    const pieces = [first]
    for (let n = 2; n <= 20; n++)
      pieces.push(
        accepted(
          await world.gives(host, giver, 'helper', {
            to: first.label,
            title: `Survey the fictional east wing, room ${String(n)}`,
          }),
        ),
      )
    const helperTools = agentToolsFor(host, first.owner)
    for (const piece of pieces)
      await answerOn(helperTools, 'reply_to_parent', {
        piece: piece.label,
        outcome: 'done',
        summary: 'Surveyed.',
      })
    const text = await textOf(agentToolsFor(host, giver), 'list_tasks', { state: 'ended' })
    const whole = wholeReply(text)
    expect(whole.length).toBeGreaterThan(SHORT_REPLY_CHARACTERS)
    // Shortened only when that saves space, path line included; otherwise the very same reply.
    if (fullReplyPath(text) === null) expect(text).toBe(whole)
    else expect(text.length).toBeLessThan(whole.length)
    for (const piece of pieces) expect(text).toContain(`${piece.label} · `)
  })

  it('§7 long questions keep who asked, about what and since when; their words are in the file', async () => {
    const [piece] = await givesMany(1)
    const helperTools = agentToolsFor(host, piece!.owner)
    for (let n = 1; n <= 3; n++)
      await answerOn(helperTools, 'ask_question', {
        who_answers: 'the-parent',
        piece: piece!.label,
        question:
          `Which chairs go in room ${String(n)}?\n` +
          'Some of them are worn and some are new. '.repeat(20),
      })
    const text = await textOf(agentToolsFor(host, giver), 'list_questions')
    const { short, full } = splitFullReply(text)
    for (let n = 1; n <= 3; n++) {
      expect(short).toContain(`Which chairs go in room ${String(n)}?`)
      expect(full).toContain(`Which chairs go in room ${String(n)}?`)
    }
    expect(short).toMatch(/ · asked /)
    expect(short).not.toContain('Some of them are worn')
    expect(full).toContain('Some of them are worn')
  })
})

describe('484 · where a reply is cut', () => {
  const written: string[] = []
  const write = (_tool: string, text: string) => {
    written.push(text)
    return '/fictional/temp/reply.txt'
  }

  it('keeps a reply of exactly the limit whole', () => {
    const answered = { text: 'x'.repeat(SHORT_REPLY_CHARACTERS) }
    expect(shortenedIfLong('list_tasks', answered, 'short', write)).toBe(answered)
  })

  it('cuts one character over, and keeps the payload', () => {
    const structured = { outcome: 'ok' }
    const text = 'x'.repeat(SHORT_REPLY_CHARACTERS + 1)
    expect(shortenedIfLong('list_tasks', { text, structured }, 'short', write)).toEqual({
      text: 'short\n\nFull reply: /fictional/temp/reply.txt',
      structured,
    })
    expect(written.at(-1)).toBe(text)
  })

  it('answers whole when the short form is no shorter, or its path would make it longer', () => {
    const text = 'x'.repeat(SHORT_REPLY_CHARACTERS + 10)
    expect(shortenedIfLong('list_tasks', { text }, text, write)).toEqual({ text })
    // Shorter by 5, but the path line adds more than that.
    expect(shortenedIfLong('list_tasks', { text }, text.slice(5), write)).toEqual({ text })
  })

  it('answers whole when the whole reply cannot be written', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const answered = { text: 'x'.repeat(SHORT_REPLY_CHARACTERS + 1) }
    const failing = () => {
      throw new Error('fictional full disk')
    }
    expect(shortenedIfLong('list_tasks', answered, 'short', failing)).toBe(answered)
  })

  it('leaves a tool with no short form whole, however long', () => {
    const answered = { text: 'x'.repeat(SHORT_REPLY_CHARACTERS * 4) }
    expect(shortenedIfLong('give_work', answered, undefined, write)).toBe(answered)
  })
})
