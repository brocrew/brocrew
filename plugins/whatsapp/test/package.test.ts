import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { loadConfig } from '../src/config.js'
import { startWhatsApp, VERSION } from '../src/app.js'
import { silentLogger } from '../src/logger.js'
import { REFUSALS, fileRefusal } from '../src/refusals.js'
import { createSettingsStore } from '../src/settings.js'
import * as localFileGuard from '../src/localFileGuard.js'
import { ALLOTMENT, ALTOS, FakeBridge, INES, ROWING } from './fakes.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
const temporary = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-whatsapp-'))
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
function configured() {
  return loadConfig({ BROCREW_PLUGIN_DATA: temporary() })
}
async function boot(options: { read?: boolean; writable?: string[]; prefix?: boolean } = {}) {
  const config = configured()
  const settings = createSettingsStore(config.home)
  if (options.read) settings.setRead(true)
  if (options.prefix === false) settings.setPrefix(false)
  for (const group of options.writable ?? []) settings.setWritable(group, true)
  const bridge = new FakeBridge()
  let clock = 1_800_000_000_000
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const server = await startWhatsApp(config, {
    transport: serverTransport,
    bridge,
    settings,
    logger: silentLogger,
    now: () => clock,
  })
  cleanup.push(() => server.close())
  const client = new Client({ name: 'fictional-agent', version: '1.0.0' })
  await client.connect(clientTransport)
  cleanup.push(() => client.close())
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({
      name,
      arguments: args,
      _meta: {
        workspaceId: 'fictional-workspace',
        requestId: name,
        origin: name.startsWith('whatsapp_') ? 'settings.page' : 'agent',
      },
    })) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
      isError?: boolean
    }
    return result
  }
  const text = async (name: string, args: Record<string, unknown> = {}) =>
    (await call(name, args)).content.find((one) => one.type === 'text')!.text!
  const refusals = () =>
    fs.existsSync(path.join(config.home, 'refusals.jsonl'))
      ? fs
          .readFileSync(path.join(config.home, 'refusals.jsonl'), 'utf8')
          .trim()
          .split('\n')
          .map((line) => JSON.parse(line))
      : []
  return {
    config,
    settings,
    bridge,
    call,
    text,
    refusals,
    tools: async () => (await client.listTools()).tools,
    tick: (ms: number) => (clock += ms),
  }
}
const refused = (line: string) => `Error: ${line}`

describe('WhatsApp package', () => {
  it('derives the server version from release metadata and contains no literal server version', () => {
    const metadata = JSON.parse(fs.readFileSync('plugins/whatsapp/manifest-template.json', 'utf8'))
    expect(VERSION).toBe(metadata.version)
    const inspect = (directory: string): void => {
      for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) inspect(file)
        else if (entry.name.endsWith('.ts'))
          expect(fs.readFileSync(file, 'utf8')).not.toMatch(
            /['"`]\d+\.\d+\.\d+(?:[-+][^'"`\s]+)?['"`]/,
          )
      }
    }
    inspect('plugins/whatsapp/src')
  })

  it('requires explicit generic data paths and keeps private folders', () => {
    expect(() => loadConfig({})).toThrow('Plugin unavailable')
    expect(() => loadConfig({ BROCREW_PLUGIN_DATA: 'relative' })).toThrow('Plugin unavailable')
    const config = configured()
    for (const dir of [config.home, config.files, config.downloads, config.bridgeData, config.bin])
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
  })

  it('refreshes groups through ordinary MCP, preserving writing choices', async () => {
    const { call, bridge, settings } = await boot({ writable: [ROWING.jid] })
    expect((await call('whatsapp_refresh_groups', { route: '/chats' })).isError).toBe(true)
    expect(bridge.requests).toEqual([])
    const answer = await call('whatsapp_refresh_groups')
    expect(answer.isError).toBeFalsy()
    expect(bridge.requests).toEqual([{ route: '/groups', body: { refresh: true } }])
    expect(settings.get().writable).toEqual([ROWING.jid])
    bridge.refreshGroups = async () => {
      throw new Error('unavailable')
    }
    expect((await call('whatsapp_refresh_groups')).isError).toBe(true)
  })

  it('keeps the settings in a private file that survives a restart', async () => {
    const { config, settings } = await boot({ read: true, writable: [ALLOTMENT.jid] })
    expect(fs.statSync(path.join(config.home, 'settings.json')).mode & 0o777).toBe(0o600)
    expect(createSettingsStore(config.home).get()).toEqual(settings.get())
    settings.forgetGroups()
    expect(createSettingsStore(config.home).get().writable).toEqual([])
    fs.writeFileSync(path.join(config.home, 'settings.json'), '{"read":"yes"}')
    expect(createSettingsStore(config.home).get()).toEqual({
      read: false,
      prefix: true,
      writable: [],
    })
  })

  it('offers domain and Configure MCP tools, naming the files folder by its absolute path', async () => {
    const { tools, config } = await boot()
    const listed = await tools()
    expect(listed.map((tool) => tool.name).sort()).toEqual([
      'get_media',
      'list_chats',
      'list_groups',
      'read_messages',
      'search_contacts',
      'search_messages',
      'send_to_group',
      'whatsapp_before_remove',
      'whatsapp_link',
      'whatsapp_refresh_groups',
      'whatsapp_set_group_write',
      'whatsapp_set_prefix',
      'whatsapp_set_read',
      'whatsapp_settings',
      'whatsapp_status',
      'whatsapp_unlink',
    ])
    const send = listed.find((tool) => tool.name === 'send_to_group')!
    expect(send.description).toContain(config.files)
    expect(path.isAbsolute(config.files)).toBe(true)
    expect(JSON.stringify(listed)).not.toContain('~/')
  })
})

describe('reading', () => {
  it('refuses every reading tool while reading is off, and logs the refusal without what was asked', async () => {
    const { call, refusals, bridge } = await boot()
    for (const [name, args] of [
      ['list_chats', { query: 'rowing' }],
      ['read_messages', { chat: ROWING.jid }],
      ['search_messages', { query: 'secret plans' }],
      ['search_contacts', { query: 'Ines' }],
      ['get_media', { chat: INES, message: 'MSG00003' }],
    ] as const) {
      const result = await call(name, args)
      expect(result.content).toEqual([{ type: 'text', text: refused(REFUSALS['read-off']) }])
    }
    expect(bridge.requests).toEqual([])
    const logged = refusals()
    expect(logged.map((one) => [one.tool, one.refused])).toEqual([
      ['list_chats', 'read-off'],
      ['read_messages', 'read-off'],
      ['search_messages', 'read-off'],
      ['search_contacts', 'read-off'],
      ['get_media', 'read-off'],
    ])
    expect(JSON.stringify(logged)).not.toMatch(/secret plans|rowing|Ines/)
  })

  it('reads chats and messages once the person allows it, naming what an agent sent', async () => {
    const { text } = await boot({ read: true })
    expect(JSON.parse(await text('list_chats', { query: 'rowing' }))).toEqual({
      chats: [
        {
          id: ROWING.jid,
          name: ROWING.name,
          group: true,
          lastMessage: new Date(1_800_000_060_000).toISOString(),
          lastText: '🤖 Boats are booked',
          lastFromMe: true,
        },
      ],
    })
    const messages = JSON.parse(await text('read_messages', { chat: ROWING.jid }))
    expect(messages.messages.map((one: { from: string }) => one.from)).toEqual([
      'Me (via an agent)',
      'Ines Calder',
    ])
    const before = JSON.parse(
      await text('read_messages', { chat: ROWING.jid, before: '2027-01-15T08:00:30Z' }),
    )
    expect(before.messages.map((one: { id: string }) => one.id)).toEqual(['MSG00001'])
    expect(await text('read_messages', { chat: ROWING.jid, before: 'last tuesday' })).toBe(
      'Error: invalid arguments: "before" has the wrong format',
    )
    expect(JSON.parse(await text('search_messages', { query: 'thursday' })).messages).toHaveLength(
      1,
    )
    expect(JSON.parse(await text('search_contacts', { query: 'e' })).contacts).toHaveLength(2)
  })

  it('refuses reading while no phone is linked', async () => {
    const { call, bridge } = await boot({ read: true })
    bridge.state = 'unlinked'
    expect((await call('list_chats')).content[0].text).toBe(refused(REFUSALS['not-linked']))
  })

  it('returns a photo inline and saves it in the downloads folder', async () => {
    const { call, config, bridge } = await boot({ read: true })
    const result = await call('get_media', { chat: INES, message: 'MSG00003' })
    expect(result.content[0]).toEqual({ type: 'image', data: '/9j/AA==', mimeType: 'image/jpeg' })
    const saved = JSON.parse(result.content[1].text!)
    expect(path.dirname(saved.saved)).toBe(config.downloads)
    expect(path.basename(saved.saved)).toMatch(/^[0-9a-f]{16}_MSG00003\.jpg$/)
    bridge.mediaError = 'no_media'
    expect((await call('get_media', { chat: INES, message: 'MSG00001' })).content[0].text).toBe(
      refused(REFUSALS['no-media']),
    )
  })
})

describe('sending', () => {
  it('lists only the groups whose Can write is on, even while reading is off', async () => {
    const { text } = await boot({ writable: [ROWING.jid] })
    expect(JSON.parse(await text('list_groups'))).toEqual({
      groups: [{ id: ROWING.jid, name: ROWING.name }],
    })
  })

  it('sends only to a writable group, never to a person, with the 🤖 start', async () => {
    const { call, bridge, refusals } = await boot({ writable: [ROWING.jid, ALTOS.jid] })
    expect(
      (await call('send_to_group', { group: ROWING.name, text: 'Boats at seven' })).content[0].text,
    ).toBe(JSON.stringify({ sent: true, group: ROWING.name }))
    expect(bridge.sends()).toEqual([{ group: ROWING.jid, text: '🤖 Boats at seven' }])
    for (const group of [ALLOTMENT.name, ALLOTMENT.jid, INES, 'Ines Calder'])
      expect((await call('send_to_group', { group, text: 'Hello' })).content[0].text).toBe(
        refused(REFUSALS['cannot-write']),
      )
    expect(bridge.sends()).toHaveLength(1)
    expect(refusals().map((one) => one.refused)).toEqual(Array(4).fill('cannot-write'))
  })

  it('asks for the id when two writable groups share a name', async () => {
    const { call, settings } = await boot({ writable: [ALTOS.jid] })
    settings.setWritable('120363000000000004@g.us', true)
    expect(
      (await call('send_to_group', { group: 'Choir Altos', text: 'Hello' })).content[0].text,
    ).toBe(refused(REFUSALS['two-groups']))
    expect(
      (await call('send_to_group', { group: ALTOS.jid, text: 'Hello' })).content[0].text,
    ).toContain('"sent":true')
  })

  it('sends without the 🤖 start when the person turned it off', async () => {
    const { call, bridge } = await boot({ writable: [ROWING.jid], prefix: false })
    await call('send_to_group', { group: ROWING.jid, text: 'Plain words' })
    expect(bridge.sends()[0].text).toBe('Plain words')
  })

  it('refuses too long a message, too many and the same one twice', async () => {
    const { call, tick } = await boot({ writable: [ROWING.jid, ALLOTMENT.jid] })
    expect(
      (await call('send_to_group', { group: ROWING.jid, text: '🌊'.repeat(4001) })).content[0].text,
    ).toBe(refused(REFUSALS['too-long']))
    expect(
      (await call('send_to_group', { group: ROWING.jid, text: '🌊'.repeat(4000) })).content[0].text,
    ).toContain('"sent":true')
    expect(
      (await call('send_to_group', { group: ROWING.jid, text: '🌊'.repeat(4000) })).content[0].text,
    ).toBe(refused(REFUSALS.duplicate))
    for (let i = 0; i < 4; i++)
      await call('send_to_group', { group: ROWING.jid, text: `Note ${i}` })
    expect(
      (await call('send_to_group', { group: ROWING.jid, text: 'Sixth' })).content[0].text,
    ).toBe(refused(REFUSALS['too-many']))
    expect(
      (await call('send_to_group', { group: ALLOTMENT.jid, text: 'Other group' })).content[0].text,
    ).toContain('"sent":true')
    tick(10 * 60_000)
    expect(
      (await call('send_to_group', { group: ROWING.jid, text: 'Sixth' })).content[0].text,
    ).toContain('"sent":true')
  })

  it('takes a file only from the files folder, with its size and SHA-256', async () => {
    const { call, bridge, config } = await boot({ writable: [ROWING.jid] })
    const inside = path.join(config.files, 'minutes.pdf')
    const bytes = Buffer.from('%PDF-1.7\nfictional minutes\n')
    fs.writeFileSync(inside, bytes)
    const reply = await call('send_to_group', { group: ROWING.jid, file: inside })
    expect(reply.content[0].text).toBe(
      JSON.stringify({ sent: true, group: ROWING.name, file: 'minutes.pdf' }),
    )
    expect(bridge.sends()[0]).toEqual({
      group: ROWING.jid,
      text: '🤖',
      file: {
        path: fs.realpathSync(inside),
        name: 'minutes.pdf',
        size: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    })
    const outside = path.join(config.home, 'elsewhere.pdf')
    fs.writeFileSync(outside, bytes)
    for (const file of [
      outside,
      'files/minutes.pdf',
      '~/files/minutes.pdf',
      path.join(config.files, 'missing.pdf'),
    ])
      expect(
        (await call('send_to_group', { group: ROWING.jid, file, text: 'x' })).content[0].text,
      ).toBe(refused(fileRefusal(config.files)))
    fs.symlinkSync(outside, path.join(config.files, 'link.pdf'))
    expect(
      (
        await call('send_to_group', {
          group: ROWING.jid,
          file: path.join(config.files, 'link.pdf'),
          text: 'y',
        })
      ).content[0].text,
    ).toBe(refused(fileRefusal(config.files)))
    expect(
      (await call('send_to_group', { group: ROWING.jid, file: inside, text: 'c'.repeat(1001) }))
        .content[0].text,
    ).toBe(refused(REFUSALS['caption-too-long']))
    bridge.sendError = 'unsupported_media_type'
    expect(
      (await call('send_to_group', { group: ROWING.jid, file: inside, text: 'typed' })).content[0]
        .text,
    ).toBe(refused(REFUSALS['file-type']))
    expect(bridge.sends()).toHaveLength(2)
  })

  it.each([ROWING.name, ROWING.jid])(
    'rechecks Can write after preparing a file for %s',
    async (group) => {
      const { call, bridge, config, settings, refusals } = await boot({
        writable: [ROWING.jid],
      })
      const file = path.join(config.files, 'minutes.pdf')
      fs.writeFileSync(file, '%PDF-1.7\nfictional minutes\n')
      const open = localFileGuard.openGuardedFile
      const preparing = vi
        .spyOn(localFileGuard, 'openGuardedFile')
        .mockImplementationOnce((...args) => {
          const guarded = open(...args)
          return {
            ...guarded,
            stream: () =>
              Readable.from(
                (async function* () {
                  for await (const chunk of guarded.stream()) {
                    settings.setWritable(ROWING.jid, false)
                    yield chunk
                  }
                })(),
              ),
          }
        })

      const result = await call('send_to_group', { group, file })
      expect(preparing).toHaveBeenCalledOnce()
      expect(settings.get().writable).toEqual([])
      expect(bridge.sends()).toEqual([])
      expect(result.content[0].text).toBe(refused(REFUSALS['cannot-write']))
      expect(refusals().map((one) => one.refused)).toEqual(['cannot-write'])

      settings.setWritable(ROWING.jid, true)
      expect((await call('send_to_group', { group, file })).content[0].text).toBe(
        JSON.stringify({ sent: true, group: ROWING.name, file: 'minutes.pdf' }),
      )
      expect(bridge.sends()).toHaveLength(1)
    },
  )

  it('says the plugin is unavailable, not a refusal, when the bridge fails a send', async () => {
    const { call, bridge, refusals } = await boot({ writable: [ROWING.jid] })
    bridge.sendError = 'send_failed'
    expect(
      (await call('send_to_group', { group: ROWING.jid, text: 'Hello' })).content[0].text,
    ).toBe('Error: Plugin unavailable. Try again.')
    expect(refusals()).toEqual([])
  })

  it('refuses sending while no phone is linked', async () => {
    const { call, bridge } = await boot({ writable: [ROWING.jid] })
    bridge.state = 'pairing'
    expect(
      (await call('send_to_group', { group: ROWING.jid, text: 'Hello' })).content[0].text,
    ).toBe(refused(REFUSALS['not-linked']))
    expect(bridge.sends()).toEqual([])
  })
})
