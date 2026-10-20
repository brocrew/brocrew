import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { loadConfig } from '../src/config.js'
import { startWhatsApp, VERSION } from '../src/app.js'
import { silentLogger } from '../src/logger.js'
import { REFUSALS, fileRefusal } from '../src/refusals.js'
import { createSettingsStore } from '../src/settings.js'
import { ALLOTMENT, ALTOS, FakeBridge, INES, ROWING } from './fakes.js'

const cleanup: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse()) await fn()
})
const temporary = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-whatsapp-'))
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}
const mcpToken = 'fictional-mcp-'.repeat(8)
const adminToken = 'fictional-person-'.repeat(8)
function configured() {
  const home = temporary()
  const authPath = path.join(home, 'fixture-auth.json')
  fs.writeFileSync(authPath, JSON.stringify({ mcpToken, adminToken }), { mode: 0o600 })
  return loadConfig({ BROCREW_WHATSAPP_DATA: home, BROCREW_WHATSAPP_AUTH: authPath })
}
async function boot(options: { read?: boolean; writable?: string[]; prefix?: boolean } = {}) {
  const config = configured()
  const settings = createSettingsStore(config.home)
  if (options.read) settings.setRead(true)
  if (options.prefix === false) settings.setPrefix(false)
  for (const group of options.writable ?? []) settings.setWritable(group, true)
  const bridge = new FakeBridge()
  let clock = 1_800_000_000_000
  const server = await startWhatsApp(config, {
    bridge,
    settings,
    logger: silentLogger,
    now: () => clock,
  })
  cleanup.push(() => server.close())
  const url = `http://127.0.0.1:${(server.httpServer.address() as { port: number }).port}`
  async function request(endpoint: string, token?: string, body?: unknown, origin?: string) {
    const response = await fetch(url + endpoint, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(origin ? { origin } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    return { status: response.status, body: await response.json() }
  }
  const client = new Client({ name: 'fictional-agent', version: '1.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url + '/mcp'), {
      requestInit: { headers: { authorization: `Bearer ${mcpToken}` } },
    }),
  )
  cleanup.push(() => client.close())
  async function call(name: string, args: Record<string, unknown> = {}) {
    const result = (await client.callTool({ name, arguments: args })) as {
      content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
      isError?: boolean
    }
    expect(result.isError).toBeFalsy()
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
    request,
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

  it('requires explicit private paths and distinct private tokens', () => {
    expect(() => loadConfig({})).toThrow('Plugin unavailable')
    expect(() => loadConfig({ BROCREW_WHATSAPP_DATA: 'relative' })).toThrow('Plugin unavailable')
    const config = configured()
    for (const dir of [config.home, config.files, config.downloads, config.bridgeData, config.bin])
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700)
    fs.writeFileSync(config.authPath, JSON.stringify({ mcpToken, adminToken: mcpToken }))
    expect(() =>
      loadConfig({ BROCREW_WHATSAPP_DATA: config.home, BROCREW_WHATSAPP_AUTH: config.authPath }),
    ).toThrow('Plugin unavailable')
    fs.writeFileSync(config.authPath, JSON.stringify({ mcpToken, adminToken }))
    fs.chmodSync(config.authPath, 0o644)
    expect(() =>
      loadConfig({ BROCREW_WHATSAPP_DATA: config.home, BROCREW_WHATSAPP_AUTH: config.authPath }),
    ).toThrow('Plugin unavailable')
  })

  it('keeps the person’s routes apart from the tools, and refuses browser origins', async () => {
    const { request } = await boot()
    expect((await request('/healthz')).status).toBe(401)
    expect((await request('/v1/status', mcpToken)).status).toBe(401)
    expect((await request('/v1/read', mcpToken, { enabled: true })).status).toBe(401)
    expect((await request('/mcp', adminToken, {})).status).toBe(401)
    expect(await request('/healthz', adminToken)).toEqual({
      status: 200,
      body: { ok: true, version: VERSION },
    })
    expect(
      (await request('/v1/status', adminToken, undefined, 'https://fictional.invalid')).status,
    ).toBe(403)
  })

  it('refreshes groups through the bridge only for the person, preserving writing choices', async () => {
    const { request, bridge, settings } = await boot({ writable: [ROWING.jid] })
    expect((await request('/v1/refresh-groups', mcpToken, {})).status).toBe(401)
    expect((await request('/v1/refresh-groups', adminToken, { route: '/chats' })).status).toBe(400)
    expect(bridge.requests).toEqual([])
    const answer = await request('/v1/refresh-groups', adminToken, {})
    expect(answer.status).toBe(200)
    expect(bridge.requests).toEqual([{ route: '/groups', body: { refresh: true } }])
    expect(answer.body.groups.find((one: { jid: string }) => one.jid === ROWING.jid).canWrite).toBe(
      true,
    )
    expect(settings.get().writable).toEqual([ROWING.jid])
    bridge.refreshGroups = async () => {
      throw new Error('unavailable')
    }
    expect((await request('/v1/refresh-groups', adminToken, {})).status).toBe(503)
  })

  it('serves the page its status and settings, and takes only the person’s switches', async () => {
    const { request, bridge, settings } = await boot()
    expect((await request('/v1/status', adminToken)).body).toEqual({
      state: 'linked',
      expired: false,
      account: 'Fictional Phone',
      qr: null,
      removeOnPhone: false,
    })
    const first = (await request('/v1/settings', adminToken)).body
    expect(first.read).toBe(false)
    expect(first.prefix).toBe(true)
    expect(first.groups.every((one: { canWrite: boolean }) => !one.canWrite)).toBe(true)
    expect((await request('/v1/read', adminToken, { enabled: true })).body.read).toBe(true)
    expect((await request('/v1/prefix', adminToken, { enabled: false })).body.prefix).toBe(false)
    const written = await request('/v1/group-write', adminToken, {
      group: ROWING.jid,
      enabled: true,
    })
    expect(
      written.body.groups.find((one: { jid: string }) => one.jid === ROWING.jid).canWrite,
    ).toBe(true)
    expect(
      (
        await request('/v1/group-write', adminToken, {
          group: '120363000000000099@g.us',
          enabled: true,
        })
      ).status,
    ).toBe(400)
    expect(
      (await request('/v1/group-write', adminToken, { group: INES, enabled: true })).status,
    ).toBe(400)
    expect((await request('/v1/read', adminToken, { enabled: 'yes' })).status).toBe(400)
    expect((await request('/v1/read', adminToken, { enabled: true, extra: 1 })).status).toBe(400)
    expect(settings.get()).toEqual({ read: true, prefix: false, writable: [ROWING.jid] })
    expect((await request('/v1/link', adminToken, {})).status).toBe(409)
    expect((await request('/v1/unlink', adminToken, {})).status).toBe(202)
    expect(bridge.unlinked).toBe(1)
    const linking = await request('/v1/link', adminToken, {})
    expect(linking.status).toBe(200)
    expect(linking.body.state).toBe('pairing')
    expect(linking.body.qr.size).toBe(21)
  })

  it('logs out and waits for the wipe before the app uninstalls it; only the person can ask', async () => {
    const { request, bridge } = await boot()
    expect((await request('/v1/uninstall', mcpToken, {})).status).toBe(401)
    expect(bridge.unlinked).toBe(0)
    expect(await request('/v1/uninstall', adminToken, {})).toEqual({ status: 200, body: {} })
    expect(bridge.unlinked).toBe(1)
    expect((await request('/v1/uninstall', adminToken, { now: true })).status).toBe(400)
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

  it('offers exactly the reviewed tools, naming the files folder by its absolute path', async () => {
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
