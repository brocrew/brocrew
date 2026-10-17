import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { agentToolHandlerInput, type AgentToolAnswer } from '@brobot2/runtime'
import { claudeMcpServersFor } from '../../../packages/runtime/src/claude/agent-tools'
import {
  answerCodexToolCall,
  codexDynamicToolsFor,
} from '../../../packages/runtime/src/codex/agent-tools'
import { agentToolsFor } from '../src/main/runtime/agent-tools'
import { refuseResource } from '../src/main/resources/resources'
import { aServiceWorld, type AServiceWorld } from './helpers/a-service-world'

type Packet = {
  id?: number
  error?: { code: number }
  result?: {
    isError?: boolean
    content?: { type: string; text?: string }[]
    tools?: { name: string; description: string; inputSchema: Record<string, unknown> }[]
  }
}

describe('reply field failures travel through the real MCP server', () => {
  let world: AServiceWorld
  let host: ReturnType<AServiceWorld['aHost']>
  let worker: string
  let piece: string
  let tool: ReturnType<typeof agentToolsFor>['tools'][number]
  let otherTool: typeof tool
  let updateTool: typeof tool
  let closes: (() => Promise<void>)[]
  let calls: AgentToolAnswer[]

  beforeEach(async () => {
    world = aServiceWorld()
    world.anAgent('parent', 'normal')
    world.anAgent('worker', 'normal')
    host = world.aHost()
    const parent = await world.aPersonOpens(host, 'parent')
    const given = await world.gives(host, parent, 'worker')
    if (!given.ok) throw new Error('fixture work was refused')
    worker = given.owner
    piece = given.piece
    const tools = agentToolsFor(host, worker).tools
    tool = tools.find((one) => one.name === 'reply_to_parent')!
    otherTool = tools.find((one) => one.name === 'get_agent_status')!
    expect(tools.filter((one) => one.handlerOwnsMissingInput).map((one) => one.name)).toEqual([
      'give_work',
      'message_agent',
      'reply_to_parent',
      'answer_question',
      'ask_question',
      'update_work',
      'take_on_work',
    ])
    updateTool = tools.find((one) => one.name === 'update_work')!
    closes = []
    calls = []
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    for (const close of closes) await close()
    await world.cleanUp()
  })

  async function server(
    strictSummary = false,
    secondTool = false,
    coreSummary = false,
    update = false,
  ) {
    const selected = update ? updateTool : secondTool ? otherTool : tool
    const summarySchema = new z.core.$ZodString({ type: 'string' })
    z.globalRegistry.add(summarySchema, { description: 'A fictional result summary.' })
    const offered = {
      ...selected,
      handlerOwnsMissingInput: strictSummary ? false : selected.handlerOwnsMissingInput,
      input: strictSummary
        ? { ...selected.input, summary: z.string() }
        : coreSummary
          ? { ...selected.input, summary: agentToolHandlerInput(summarySchema) }
          : selected.input,
      call: async (args: Record<string, unknown>) => {
        const answered = await selected.call(args)
        calls.push(answered)
        return answered
      },
    }
    const set = { server: 'brobot', tools: [offered] }
    const configured = claudeMcpServersFor(set)!
    const low = (
      configured.brobot as unknown as {
        instance: { server: { connect(transport: unknown): Promise<void>; close(): Promise<void> } }
      }
    ).instance.server
    const out: Packet[] = []
    const transport: Record<string, unknown> = {
      start: async () => {},
      send: async (packet: Packet) => {
        out.push(packet)
      },
      close: async () => {},
    }
    await low.connect(transport)
    closes.push(() => low.close())
    let id = 0
    async function request(method: string, params: Record<string, unknown>) {
      const next = ++id
      ;(transport.onmessage as (packet: unknown) => void)({
        jsonrpc: '2.0',
        id: next,
        method,
        params,
      })
      await vi.waitFor(() => expect(out.some((packet) => packet.id === next)).toBe(true), {
        timeout: 5000,
      })
      return out.find((packet) => packet.id === next)!
    }
    await request('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fictional-test', version: '1' },
    })
    ;(transport.onmessage as (packet: unknown) => void)({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    })
    return {
      set,
      list: () => request('tools/list', {}),
      call: (args: Record<string, unknown>) =>
        request('tools/call', { name: selected.name, arguments: args }),
    }
  }

  const words = (packet: Packet): string => {
    expect(packet.error).toBeUndefined()
    expect(packet.result?.isError, JSON.stringify(packet)).not.toBe(true)
    return packet.result!.content!.map((one) => one.text ?? '').join('\n')
  }
  const recorded = () => world.ledger(worker).filter((event) => event.type === 'tool_refused')

  const saveMethod =
    "If this work taught you a tested method you would reuse, save it now as your Saved methods section says; otherwise you're done."

  async function handBack(adapter: 'Claude' | 'Codex', args: Record<string, unknown>) {
    const wire = await server()
    if (adapter === 'Claude') return words(await wire.call(args))
    const response = await answerCodexToolCall(wire.set, {
      namespace: 'brobot',
      tool: 'reply_to_parent',
      arguments: args,
    })
    expect(response.success).toBe(true)
    return response.contentItems
      .map((item) => (item.type === 'inputText' ? item.text : ''))
      .join('\n')
  }

  function withoutProfile() {
    // Only the fictional conversation loses its identity; its work and running turn remain.
    world.db
      .prepare(
        'UPDATE provider_session SET agent_identity_id = NULL, profile_id = NULL WHERE id = ?',
      )
      .run(worker)
    expect(world.store.identityOf(worker)).toBeNull()
    expect(host.maySaveMemory(worker)).toBe(false)
  }

  async function personalPiece() {
    world.anAgent('own', 'normal')
    worker = await world.aPersonOpens(host, 'own')
    await host.send(worker, 'Please take on this fictional request.', world.window)
    const tools = agentToolsFor(host, worker).tools
    const taken = await tools
      .find((one) => one.name === 'take_on_work')!
      .call({
        title: 'Fictional request',
        definition_of_done: 'The fictional request is answered.',
        brief: 'Answer the fictional request.',
      })
    expect(taken.structured?.outcome).toBe('ok')
    piece = String(taken.structured?.piece)
    tool = tools.find((one) => one.name === 'reply_to_parent')!
  }

  const hasReminder = (text: string) => expect(text.endsWith(` ${saveMethod}`)).toBe(true)
  const hasNoReminder = (text: string) => expect(text).not.toContain(saveMethod)

  for (const adapter of ['Claude', 'Codex'] as const) {
    const replyIsAccepted = () => expect(calls.at(-1)!.structured?.outcome).toBe('ok')
    const replyIsRefused = () => expect(calls.at(-1)!.structured?.outcome).toBe('refused')
    const reportedMethod = () => world.ledger(worker).find((event) => event.type === 'work_replied')

    for (const blank of ['', ' \t\n', ' '.repeat(200)]) {
      it(`${adapter}: a blank method report (${blank.length} units) is left out and still gets the reminder`, async () => {
        const text = await handBack(adapter, {
          piece,
          outcome: 'done',
          summary: 'Fictional completion.',
          saved_method: blank,
        })
        replyIsAccepted()
        hasReminder(text)
        expect(reportedMethod()).not.toHaveProperty('savedMethod')
        expect(
          world.store.piecesOwnedBy(worker).find((one) => one.piece === piece),
        ).not.toHaveProperty('savedMethod')
      })
    }

    it(`${adapter}: a blank report on an unplaced conversation still cannot invite saving`, async () => {
      withoutProfile()
      const text = await handBack(adapter, {
        piece,
        outcome: 'done',
        summary: 'Fictional completion.',
        saved_method: ' \t ',
      })
      replyIsAccepted()
      hasNoReminder(text)
      expect(reportedMethod()).not.toHaveProperty('savedMethod')
    })

    it(`${adapter}: suppressing a blank report's reminder fails its answer control`, async () => {
      const original = tool.call
      tool = {
        ...tool,
        call: async (args) => {
          const result = await original(args)
          return { ...result, text: result.text.replace(` ${saveMethod}`, '') }
        },
      }
      const text = await handBack(adapter, {
        piece,
        outcome: 'done',
        summary: 'Fictional completion.',
        saved_method: '',
      })
      replyIsAccepted()
      expect(() => hasReminder(text)).toThrow()
    })

    for (const [name, kind] of [
      ['fictional.ZSH', 'a .zsh file'],
      ['fictional.ts', 'a .ts file'],
      ['fictional.PRIVATE_EXTENSION', 'a file of an unrecognised kind'],
      ['fictional-no-extension', 'a file of an unrecognised kind'],
    ] as const) {
      it(`${adapter}: a refused ${name} names the kinds and puts its path in summary`, async () => {
        const path = join(world.folder, name)
        writeFileSync(path, 'Fictional file; never executed.')
        const text = await handBack(adapter, {
          piece,
          outcome: 'done',
          summary: 'Fictional completion.',
          resource_paths: [path],
        })
        replyIsRefused()
        const reason = `This app does not keep ${kind}. It keeps a Markdown file, a page, an image or a PDF. Name its full path in summary instead of resource_paths; keep the file where it is. Nothing was kept or recorded.`
        expect(calls.at(-1)!.structured?.reason).toBe(reason)
        expect(text).toContain(reason)
        expect(reason).not.toContain('PRIVATE_EXTENSION')
        expect(world.store.resourcesOf(piece)).toEqual([])
        expect(reportedMethod()).toBeUndefined()
        expect(world.store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state).toBe(
          'working',
        )
        hasNoReminder(text)
        // Another file-writing door retains its own resource refusal.
        const update = await agentToolsFor(host, worker)
          .tools.find((one) => one.name === 'update_work')!
          .call({ piece, resources: [path] })
        expect(update.structured?.rail).toBe('resource-not-a-form-this-app-keeps')
        expect(update.structured?.reason).toBe(
          refuseResource('resource-not-a-form-this-app-keeps').reason,
        )
        const accepted = await handBack(adapter, {
          piece,
          outcome: 'done',
          summary: `The result stays at ${path}.`,
        })
        replyIsAccepted()
        hasReminder(accepted)
        expect(reportedMethod()).toMatchObject({ summary: `The result stays at ${path}.` })
      })
    }

    it(`${adapter}: restoring the generic file refusal fails the specific remedy control`, async () => {
      const path = join(world.folder, 'fictional.zsh')
      writeFileSync(path, 'Fictional file; never executed.')
      const original = host.replyToParent.bind(host)
      vi.spyOn(host, 'replyToParent').mockImplementation(async (input, by) => {
        const result = await original(input, by)
        return result.ok
          ? result
          : {
              ...result,
              refusal: {
                ...result.refusal,
                reason: refuseResource('resource-not-a-form-this-app-keeps').reason,
              },
            }
      })
      const text = await handBack(adapter, {
        piece,
        outcome: 'done',
        summary: 'Fictional completion.',
        resource_paths: [path],
      })
      replyIsRefused()
      expect(() =>
        expect(text).toContain('name its full path in summary instead of resource_paths'),
      ).toThrow()
    })

    for (const report of [
      'fictitious-method.md',
      'none: this work repeated an existing method',
      '🟩'.repeat(100),
    ]) {
      it(`${adapter}: keeps the supplied method report (${report.length} units) and omits the reminder`, async () => {
        const text = await handBack(adapter, {
          piece,
          outcome: 'done',
          summary: 'Fictional completion.',
          saved_method: report,
        })
        replyIsAccepted()
        hasNoReminder(text)
        expect(reportedMethod()).toMatchObject({ savedMethod: report })
        expect(
          world.store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.savedMethod,
        ).toBe(report)
        const read = await agentToolsFor(host, worker)
          .tools.find((one) => one.name === 'list_tasks')!
          .call({ piece })
        expect(read.structured?.saved_method).toBe(report)
      })
    }

    for (const bad of [
      null,
      { private: 'PRIVATE_METHOD' },
      'PRIVATE_METHOD'.padEnd(201, 'x'),
      '🟩'.repeat(101),
      ' '.repeat(201),
    ]) {
      it(`${adapter}: rejects a method report outside its type or limit (${typeof bad})`, async () => {
        const text = await handBack(adapter, {
          piece,
          outcome: 'done',
          summary: 'Fictional completion.',
          saved_method: bad,
        })
        replyIsRefused()
        expect(text).toContain(
          typeof bad === 'string'
            ? `saved_method: at most 200 characters; got ${bad.length}`
            : 'saved_method: expected text, or absent',
        )
        expect(reportedMethod()).toBeUndefined()
        expect(JSON.stringify(recorded())).not.toContain('PRIVATE_METHOD')
        expect(world.store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state).toBe(
          'working',
        )
      })
    }

    it(`${adapter}: accepts message as the unadvertised summary alias`, async () => {
      const text = await handBack(adapter, {
        piece,
        outcome: 'done',
        message: 'Exact alias words.',
      })
      replyIsAccepted()
      hasReminder(text)
      expect(reportedMethod()).toMatchObject({ summary: 'Exact alias words.' })
      expect(world.store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.summary).toBe(
        'Exact alias words.',
      )
    })

    for (const message of ['', { private: 'PRIVATE_MESSAGE' }]) {
      it(`${adapter}: alias values meet the same summary validation (${typeof message})`, async () => {
        await handBack(adapter, { piece, outcome: 'done', message })
        replyIsRefused()
        expect(reportedMethod()).toBeUndefined()
        expect(JSON.stringify(recorded())).not.toContain('PRIVATE_MESSAGE')
      })
    }

    for (const message of ['PRIVATE_SUMMARY', 'PRIVATE_MESSAGE']) {
      it(`${adapter}: refuses both summary fields even when their text ${message === 'PRIVATE_SUMMARY' ? 'agrees' : 'differs'}`, async () => {
        const text = await handBack(adapter, {
          piece,
          outcome: 'done',
          summary: 'PRIVATE_SUMMARY',
          message,
        })
        replyIsRefused()
        expect(text).toContain(
          'summary: send only one of message and summary; message is accepted only when summary is absent',
        )
        expect(reportedMethod()).toBeUndefined()
        expect(JSON.stringify(recorded())).not.toContain('PRIVATE_')
        expect(world.store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state).toBe(
          'working',
        )
      })
    }

    it(`${adapter}: an overlong alias names the exact cut without echoing its words`, async () => {
      const text = await handBack(adapter, {
        piece,
        outcome: 'done',
        message: 'PRIVATE_SUMMARY'.padEnd(1306, 'x'),
      })
      replyIsRefused()
      expect(text).toContain(
        'the summary is 1,306 characters; the most is 1,280, so cut at least 26.',
      )
      expect(JSON.stringify(recorded())).not.toContain('PRIVATE_SUMMARY')
      expect(reportedMethod()).toBeUndefined()
    })

    it(`${adapter}: losing the reported method before recording fails the durable control`, async () => {
      const original = host.replyToParent.bind(host)
      vi.spyOn(host, 'replyToParent').mockImplementation((input, by) =>
        original({ ...input, savedMethod: undefined }, by),
      )
      await handBack(adapter, {
        piece,
        outcome: 'done',
        summary: 'Fictional completion.',
        saved_method: 'fictional.md',
      })
      replyIsAccepted()
      expect(() =>
        expect(reportedMethod()).toMatchObject({ savedMethod: 'fictional.md' }),
      ).toThrow()
    })

    it(`${adapter}: a reminder planted after a supplied report fails its exclusion`, async () => {
      const original = tool.call
      tool = {
        ...tool,
        call: async (args) => {
          const result = await original(args)
          return { ...result, text: `${result.text} ${saveMethod}` }
        },
      }
      const text = await handBack(adapter, {
        piece,
        outcome: 'done',
        summary: 'Fictional completion.',
        saved_method: 'none: no new method',
      })
      replyIsAccepted()
      expect(() => hasNoReminder(text)).toThrow()
    })

    it(`${adapter}: dropping the alias fails the acceptance control`, async () => {
      const original = tool.call
      tool = {
        ...tool,
        call: async (args) => {
          const { message, ...without } = args
          void message
          return original(without)
        },
      }
      await handBack(adapter, { piece, outcome: 'done', message: 'Fictional completion.' })
      expect(() => replyIsAccepted()).toThrow()
    })

    it(`${adapter}: accepting a conflicting pair fails the refusal control`, async () => {
      const original = tool.call
      tool = {
        ...tool,
        call: async (args) => {
          const { message, ...without } = args
          return original({ ...without, summary: message })
        },
      }
      await handBack(adapter, { piece, outcome: 'done', summary: 'first', message: 'second' })
      expect(() => replyIsRefused()).toThrow()
    })

    it(`${adapter}: dropping the method bound fails its refusal control`, async () => {
      const original = tool.call
      tool = {
        ...tool,
        call: async (args) => {
          const { saved_method, ...without } = args
          void saved_method
          return original(without)
        },
      }
      await handBack(adapter, {
        piece,
        outcome: 'done',
        summary: 'Fictional completion.',
        saved_method: 'x'.repeat(201),
      })
      expect(() => replyIsRefused()).toThrow()
    })

    it(`${adapter}: removing the cut count fails its remedy control`, async () => {
      const original = tool.call
      tool = {
        ...tool,
        call: async (args) => {
          const result = await original(args)
          return { ...result, text: result.text.replace(', so cut at least 26', '') }
        },
      }
      const text = await handBack(adapter, { piece, outcome: 'done', summary: 'x'.repeat(1306) })
      replyIsRefused()
      expect(() => expect(text).toContain('so cut at least 26')).toThrow()
    })

    for (const ownRequest of [false, true]) {
      it(`${adapter}: an accepted ${ownRequest ? 'own request' : 'assigned piece'} ends with the save reminder`, async () => {
        if (ownRequest) await personalPiece()
        const before = world.ledger(worker).length
        const text = await handBack(adapter, {
          piece,
          outcome: 'done',
          summary: 'Fictional completion.',
        })
        expect(calls.at(-1)!.structured?.outcome).toBe('ok')
        hasReminder(text)
        const prefix = text.slice(0, -saveMethod.length - 1)
        expect(prefix).toContain('answered · ')
        if (ownRequest) expect(prefix).toMatch(/tell them here\.$/)
        expect(JSON.stringify(world.ledger(worker).slice(before))).not.toContain(saveMethod)
        expect(world.store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.summary).toBe(
          'Fictional completion.',
        )
      })

      it(`${adapter}: an accepted ${ownRequest ? 'own request' : 'assigned piece'} without a profile has no save reminder`, async () => {
        if (ownRequest) await personalPiece()
        withoutProfile()
        const text = await handBack(adapter, {
          piece,
          outcome: 'done',
          summary: 'Fictional completion.',
        })
        expect(calls.at(-1)!.structured?.outcome).toBe('ok')
        hasNoReminder(text)
      })
    }

    for (const args of [{ summary: '' }, { summary: 'x'.repeat(1281) }]) {
      it(`${adapter}: ${args.summary === '' ? 'malformed' : 'host-refused'} replies never invite saving`, async () => {
        const memory = vi.spyOn(host, 'maySaveMemory')
        const text = await handBack(adapter, { piece, outcome: 'done', ...args })
        expect(calls.at(-1)!.structured?.outcome).toBe('refused')
        hasNoReminder(text)
        expect(memory).not.toHaveBeenCalled()
        expect(world.store.piecesOwnedBy(worker).find((one) => one.piece === piece)?.state).toBe(
          'working',
        )
      })
    }

    it(`${adapter}: suppressing the accepted reminder fails the answer control`, async () => {
      const original = tool.call
      tool = {
        ...tool,
        call: async (args) => {
          const result = await original(args)
          return { ...result, text: result.text.replace(` ${saveMethod}`, '') }
        },
      }
      const text = await handBack(adapter, {
        piece,
        outcome: 'done',
        summary: 'Fictional completion.',
      })
      expect(calls.at(-1)!.structured?.outcome).toBe('ok')
      expect(() => hasReminder(text)).toThrow()
    })

    it(`${adapter}: planting the reminder on a refusal fails the exclusion control`, async () => {
      const original = tool.call
      tool = {
        ...tool,
        call: async (args) => {
          const result = await original(args)
          return { ...result, text: `${result.text} ${saveMethod}` }
        },
      }
      const text = await handBack(adapter, { piece, outcome: 'done', summary: '' })
      expect(calls.at(-1)!.structured?.outcome).toBe('refused')
      expect(() => hasNoReminder(text)).toThrow()
    })

    it(`${adapter}: bypassing the profile check fails the nameless-answer control`, async () => {
      withoutProfile()
      vi.spyOn(host, 'maySaveMemory').mockReturnValue(true)
      const text = await handBack(adapter, {
        piece,
        outcome: 'done',
        summary: 'Fictional completion.',
      })
      expect(calls.at(-1)!.structured?.outcome).toBe('ok')
      expect(() => hasNoReminder(text)).toThrow()
    })
  }

  it('advertises the required fields, their types and descriptions on both adapters', async () => {
    const wire = await server()
    const listed = await wire.list()
    const schema = listed.result!.tools![0]!.inputSchema
    const codex = codexDynamicToolsFor(wire.set)![0]!
    const other = (codex as { tools: { inputSchema: unknown }[] }).tools[0]!.inputSchema
    for (const candidate of [schema, other]) {
      const advertised = candidate as {
        required: string[]
        properties: Record<
          string,
          {
            type: string
            enum?: string[]
            description: string
            default?: unknown
            maxLength?: number
          }
        >
      }
      expect(advertised.required, JSON.stringify(candidate)).toEqual([
        'piece',
        'outcome',
        'summary',
      ])
      expect(Object.keys(advertised.properties)).toEqual(Object.keys(tool.input))
      expect(advertised.properties.outcome!.enum).toEqual(['done', 'blocked', 'failed'])
      for (const field of ['piece', 'outcome', 'summary', 'result_document'])
        expect(advertised.properties[field]!.type).toBe('string')
      expect(advertised.properties.resource_paths!.type).toBe('array')
      expect(advertised.properties.needs_user_action!.type).toBe('boolean')
      expect(advertised.properties.saved_method).toMatchObject({
        type: 'string',
        maxLength: 200,
        description:
          'What you saved to your Saved methods from this work: its file name, or none and why, in a few words. Save before you hand back.',
      })
      expect(advertised.properties).not.toHaveProperty('message')
      for (const property of Object.values(advertised.properties)) {
        expect(property.description.length).toBeGreaterThan(0)
        expect(property).not.toHaveProperty('default')
      }
    }
    expect(tool.description).not.toContain(
      'Before handing back: if this work taught you a tested method you would reuse, save it as your Saved methods section says; otherwise skip this.',
    )
    expect(listed.result!.tools![0]!.description).toBe(tool.description)
  })

  const cases: { title: string; args: Record<string, unknown>; omit?: string; lines: string[] }[] =
    [
      {
        title: 'message instead of outcome and summary',
        omit: 'summary',
        args: { outcome: undefined, message: 'PRIVATE_VALUE' },
        lines: ['outcome: required; expected one of done, blocked, failed'],
      },
      {
        title: 'missing piece',
        omit: 'piece',
        args: {},
        lines: ['piece: required; expected non-empty text'],
      },
      {
        title: 'missing outcome',
        omit: 'outcome',
        args: {},
        lines: ['outcome: required; expected one of done, blocked, failed'],
      },
      {
        title: 'missing summary',
        omit: 'summary',
        args: {},
        lines: ['summary: required; expected non-empty text'],
      },
      {
        title: 'a missing field does not hide another malformed value',
        omit: 'outcome',
        args: { summary: { private: 'PRIVATE_VALUE' } },
        lines: [
          'outcome: required; expected one of done, blocked, failed',
          'summary: expected text, got an object',
        ],
      },
      {
        title: 'piece of the wrong type',
        args: { piece: ['PRIVATE_VALUE'] },
        lines: ['piece: expected text, got a list'],
      },
      {
        title: 'summary of the wrong type',
        args: { summary: { private: 'PRIVATE_VALUE' } },
        lines: ['summary: expected text, got an object'],
      },
      {
        title: 'unknown outcome',
        args: { outcome: 'PRIVATE_VALUE' },
        lines: ['outcome: expected one of done, blocked, failed'],
      },
      {
        title: 'blank summary',
        args: { summary: '  ' },
        lines: ['summary: must not be empty or blank'],
      },
      { title: 'empty piece', args: { piece: '' }, lines: ['piece: must not be empty'] },
      {
        title: 'wrong path list type',
        args: { resource_paths: 'PRIVATE_VALUE' },
        lines: ['resource_paths: expected a list of non-empty text paths, or absent'],
      },
      {
        title: 'wrong path member type',
        args: { resource_paths: [42] },
        lines: ['resource_paths: expected a list of non-empty text paths, or absent'],
      },
      {
        title: 'too many paths',
        args: { resource_paths: Array(11).fill('/fictional/file.md') },
        lines: ['resource_paths: at most 10 files; got 11'],
      },
      {
        title: 'wrong action flag type',
        args: { needs_user_action: 'PRIVATE_VALUE' },
        lines: ['needs_user_action: expected true or false, or absent'],
      },
    ]
  it.each(cases)(
    '$title gets an app refusal without handing back',
    async ({ args, omit, lines }) => {
      const wire = await server()
      const input: Record<string, unknown> = {
        piece,
        outcome: 'done',
        summary: 'Fictional result',
        ...args,
      }
      if (omit !== undefined) delete input[omit]
      if (input.outcome === undefined) delete input.outcome
      const before = world.store.piecesOwnedBy(worker)
      const sent = world.sent.length
      const text = words(await wire.call(input))
      for (const line of lines) expect(text).toContain(line)
      expect(text).not.toContain('PRIVATE_VALUE')
      expect(calls).toHaveLength(1)
      expect(calls[0]!.structured).toMatchObject({ outcome: 'refused', rail: 'malformed-request' })
      expect(world.store.piecesOwnedBy(worker)).toEqual(before)
      expect(world.sent).toHaveLength(sent)
      expect(recorded()).toHaveLength(1)
      expect(JSON.stringify(recorded())).not.toContain('PRIVATE_VALUE')
      const said = recorded()[0]!.told?.text
      for (const line of lines) expect(said).toContain(line)
    },
  )

  it('bounds unknown-name replies and keeps every unknown name out of the record', async () => {
    const wire = await server()
    const names = ['PRIVATE_UNKNOWN', 'k'.repeat(500), 'PRIVATE\nKEY', 'EXTRA_4']
    const input = Object.fromEntries(names.map((name) => [name, 'PRIVATE_VALUE']))
    const text = words(await wire.call({ piece, outcome: 'done', ...input }))
    expect(text).toContain('PRIVATE_UNKNOWN: not a field of reply_to_parent')
    expect(text).toContain('unknown field: not a field of reply_to_parent')
    expect(text).toContain('Other unknown fields were also sent.')
    expect(text).not.toContain(names[1]!)
    expect(text).not.toContain(names[2]!)
    expect(text).not.toContain('PRIVATE_VALUE')
    for (const name of names) expect(JSON.stringify(recorded())).not.toContain(name)
    expect(recorded()[0]!.told?.text).toBe(calls[0]!.structured!.reason)
  })

  it('the former strict summary schema prevents these same calls from reaching the handler', async () => {
    const wire = await server(true)
    for (const args of [
      { piece, outcome: 'done', message: 'Fictional result' },
      { piece, outcome: 'done' },
    ]) {
      const packet = await wire.call(args)
      expect(packet.result?.isError).toBe(true)
      expect(packet.result?.content?.[0]?.text).toContain(
        'MCP error -32602: Input validation error',
      )
    }
    expect(calls).toHaveLength(0)
    expect(recorded()).toHaveLength(0)
    expect(world.store.piecesOwnedBy(worker).map((one) => one.piece)).toEqual([piece])
  })

  it('retains host length and result-document rails after transport admission', async () => {
    const wire = await server()
    expect(words(await wire.call({ piece, outcome: 'done', summary: 'x'.repeat(1281) }))).toContain(
      'the most is 1,280',
    )
    expect(calls.at(-1)!.structured?.rail).toBe('summary-too-long')
    words(await wire.call({ piece, outcome: 'done', summary: 'result', result_document: [] }))
    expect(calls.at(-1)!.structured?.rail).toBe('result-document-not-returned')
    expect(world.store.piecesOwnedBy(worker).map((one) => one.piece)).toEqual([piece])
  })

  it('a second real tool still rejects a missing field at the SDK boundary', async () => {
    const wire = await server(false, true)
    const packet = await wire.call({})
    expect(packet.result?.isError).toBe(true)
    expect(packet.result?.content?.[0]?.text).toContain('MCP error -32602: Input validation error')
    expect(calls).toHaveLength(0)
    expect(recorded()).toHaveLength(0)
  })

  it('a core Zod field retains its advertisement and reaches app validation', async () => {
    const wire = await server(false, false, true)
    const advertised = (await wire.list()).result!.tools![0]!.inputSchema
    expect(advertised.required).toEqual(['piece', 'outcome', 'summary'])
    expect((advertised.properties as Record<string, unknown>).summary).toMatchObject({
      type: 'string',
      description: 'A fictional result summary.',
    })
    expect(words(await wire.call({ piece, outcome: 'done' }))).toContain(
      'summary: required; expected non-empty text',
    )
    expect(words(await wire.call({ piece, outcome: 'done', summary: 42 }))).toContain(
      'summary: expected text, got a number',
    )
    expect(calls).toHaveLength(2)
    expect(calls.every((one) => one.structured?.rail === 'malformed-request')).toBe(true)
  })

  it('JSON values resembling the sentinel retain their own value and type', async () => {
    const wire = await server()
    const text = words(
      await wire.call({
        piece,
        outcome: 'done',
        summary: { description: 'missing tool argument' },
      }),
    )
    expect(text).toContain('summary: expected text, got an object')
    const summary = 'Symbol(missing tool argument)'
    words(await wire.call({ piece, outcome: 'done', summary }))
    expect(calls.at(-1)!.structured?.outcome).toBe('ok')
    expect(world.store.piecesOwnedBy(worker)).toMatchObject([{ piece, state: 'answered', summary }])
  })

  it('addressing refusal still precedes malformed field checks', async () => {
    const wire = await server()
    const text = words(
      await wire.call({ parentSessionId: 'PRIVATE_VALUE', message: 'PRIVATE_VALUE' }),
    )
    expect(text).toContain('parentSessionId is not an argument')
    expect(text).not.toContain('summary: required')
    expect(JSON.stringify(recorded())).not.toContain('parentSessionId')
    expect(JSON.stringify(recorded())).not.toContain('PRIVATE_VALUE')
  })

  it('accepts the exact summary bound and still ignores extra fields on a valid call', async () => {
    const wire = await server()
    words(
      await wire.call({
        piece,
        outcome: 'done',
        summary: 'x'.repeat(1280),
        ignored_extra: 'PRIVATE_VALUE',
      }),
    )
    expect(calls[0]!.structured?.outcome).toBe('ok')
    expect(world.store.piecesOwnedBy(worker)).toMatchObject([
      { piece, state: 'answered', outcome: 'done' },
    ])
    expect(recorded()).toEqual([])
  })

  it('a malformed wait reaches update_work’s own refusal on Claude, unknown keys and wrong types alike', async () => {
    const wire = await server(false, false, false, true)
    for (const on of [{ agent: 5 }, { time: '2030-01-01T09:00:00Z', foo: 1 }, { nothing: 'x' }]) {
      const said = words(await wire.call({ piece, status: 'waiting', on }))
      expect(said, JSON.stringify(on)).toContain(
        'on must name exactly one of agent, person, time, event',
      )
    }
  })
})
