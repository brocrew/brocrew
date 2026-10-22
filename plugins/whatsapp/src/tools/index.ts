import { createHash, randomBytes } from 'node:crypto'
import path from 'node:path'
import type { Bridge, BridgeGroup } from '../bridge.js'
import type { WhatsAppConfig } from '../config.js'
import { LocalFileGuardError, openGuardedFile } from '../localFileGuard.js'
import { SEND_LIMITS, characters, type SendPolicy } from '../policy.js'
import type { RefusalCode, Refusals } from '../refusals.js'
import type { SettingsStore } from '../settings.js'
import { currentRequestSignal } from '../shared/requestSignal.js'
import { PublicToolError, type ToolHandler, type ToolResult } from '../shared/toolServer.js'
import { jsonSchemaOf, parseArgs, type PropSpec, type ToolSpec } from './schema.js'

/** What begins every message an agent sends while the 🤖 option is on. */
export const MARK = '🤖'
const FILE_BYTES = 100 * 1024 * 1024
const CHAT = /^[0-9A-Za-z._:-]{1,64}@(?:s\.whatsapp\.net|g\.us|lid)$/
const MESSAGE = /^[0-9A-Za-z_-]{5,64}$/

const limit: PropSpec = {
  type: 'number',
  integer: true,
  min: 1,
  max: 100,
  description: 'How many to return (default 20, at most 100).',
}
const page: PropSpec = {
  type: 'number',
  integer: true,
  min: 0,
  max: 1000,
  description: 'Which page, from 0.',
}
const chat: PropSpec = {
  type: 'string',
  maxLength: 80,
  pattern: CHAT,
  description: 'The chat id, from list_chats.',
}

interface ChatRow {
  jid: string
  name: string
  group: boolean
  lastTime: number
  lastText: string
  lastFromMe: boolean
}
interface MessageRow {
  id: string
  chat: string
  chatName: string
  time: number
  sender: string
  senderName: string
  fromMe: boolean
  text: string
  media?: string
  fileName?: string
  sentByAgent?: boolean
}

const when = (seconds: number): string | null =>
  seconds > 0 ? new Date(seconds * 1000).toISOString() : null
const json = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
})

function shownMessage(row: MessageRow) {
  return {
    id: row.id,
    chat: row.chat,
    chatName: row.chatName,
    time: when(row.time),
    from: row.fromMe
      ? row.sentByAgent
        ? 'Me (via an agent)'
        : 'Me'
      : row.senderName || row.sender.split('@')[0],
    text: row.text,
    ...(row.media ? { media: row.media } : {}),
    ...(row.fileName ? { file: row.fileName } : {}),
  }
}

function seconds(value: unknown, key: string): number {
  if (value === undefined) return 0
  const ms = Date.parse(value as string)
  if (!Number.isFinite(ms) || ms <= 0)
    throw new PublicToolError(`invalid arguments: "${key}" has the wrong format`)
  return Math.floor(ms / 1000)
}

const fold = (name: string): string => name.normalize('NFKC').trim().toLowerCase()

/** The bridge's answer codes that are one of the agent's fixed refusals. */
const BRIDGE_REFUSALS: Readonly<Record<string, RefusalCode>> = Object.freeze({
  not_connected: 'not-linked',
  busy: 'busy',
})
const MEDIA_REFUSALS: Readonly<Record<string, RefusalCode>> = Object.freeze({
  ...BRIDGE_REFUSALS,
  not_found: 'no-media',
  no_media: 'no-media',
  too_large: 'no-media',
  unsupported_media_type: 'no-media',
})
const SEND_REFUSALS: Readonly<Record<string, RefusalCode>> = Object.freeze({
  ...BRIDGE_REFUSALS,
  unknown_group: 'cannot-write',
  rate_limited: 'too-many',
  unsupported_media_type: 'file-type',
  outside: 'file',
  changed: 'file',
  not_found: 'file',
})
const refusalIn = (map: Readonly<Record<string, RefusalCode>>, body: unknown) => {
  const code = String((body as { error?: unknown } | null)?.error ?? '')
  return { code, refusal: Object.hasOwn(map, code) ? map[code] : undefined }
}

export interface ToolDeps {
  config: WhatsAppConfig
  bridge: Bridge
  settings: SettingsStore
  policy: SendPolicy
  refusals: Refusals
}

export function createWhatsAppTools(deps: ToolDeps): ToolHandler[] {
  const { bridge, settings, refusals, config } = deps

  /** One bridge request; its fixed refusals come back as the agent's words, anything else as unavailable. */
  async function ask(
    tool: string,
    route: string,
    body: unknown,
    timeoutMs: number,
    known = BRIDGE_REFUSALS,
  ): Promise<unknown> {
    const reply = await bridge.call(route, body, {
      signal: currentRequestSignal(),
      timeoutMs,
    })
    if (reply.status === 200) return reply.body
    const { refusal } = refusalIn(known, reply.body)
    if (refusal) throw refusals.refuse(tool, refusal)
    throw new Error('unavailable')
  }

  /** Reading needs the person's yes and a linked phone; the stored messages stay readable while it reconnects. */
  function mayRead(tool: string): void {
    if (!settings.get().read) throw refusals.refuse(tool, 'read-off')
    const state = bridge.status().state
    if (state === 'unlinked' || state === 'pairing') throw refusals.refuse(tool, 'not-linked')
  }

  function writableGroups(): BridgeGroup[] {
    const writable = new Set(settings.get().writable)
    return bridge.groups().filter((group) => writable.has(group.jid))
  }

  function groupNamed(tool: string, asked: string): BridgeGroup {
    const groups = writableGroups()
    if (asked.endsWith('@g.us')) {
      const found = groups.find((group) => group.jid === asked)
      if (!found) throw refusals.refuse(tool, 'cannot-write')
      return found
    }
    const matches = groups.filter((group) => fold(group.name) === fold(asked))
    if (matches.length === 0) throw refusals.refuse(tool, 'cannot-write')
    if (matches.length > 1) throw refusals.refuse(tool, 'two-groups')
    return matches[0]
  }

  async function attachment(tool: string, file: string) {
    let guarded
    try {
      guarded = openGuardedFile(file, { roots: [config.files], maxBytes: FILE_BYTES })
    } catch (error) {
      if (error instanceof LocalFileGuardError) throw refusals.refuse(tool, 'file')
      throw error
    }
    try {
      const hash = createHash('sha256')
      for await (const chunk of guarded.stream()) hash.update(chunk as Buffer)
      return {
        path: guarded.realPath,
        name: guarded.name,
        size: guarded.size,
        sha256: hash.digest('hex'),
      }
    } finally {
      guarded.close()
    }
  }

  const tools: Array<{ spec: ToolSpec; run(args: Record<string, unknown>): Promise<ToolResult> }> =
    [
      {
        spec: {
          name: 'list_chats',
          description: 'Chats, newest first. Filter by name; paged.',
          props: {
            query: {
              type: 'string',
              maxLength: 200,
              description: 'Part of a chat name or number.',
            },
            limit,
            page,
          },
        },
        async run(a) {
          mayRead('list_chats')
          const body = (await ask('list_chats', '/chats', a, 15_000)) as { chats?: ChatRow[] }
          return json({
            chats: (body.chats ?? []).map((row) => ({
              id: row.jid,
              name: row.name,
              group: row.group,
              lastMessage: when(row.lastTime),
              ...(row.lastText ? { lastText: row.lastText, lastFromMe: row.lastFromMe } : {}),
            })),
          })
        },
      },
      {
        spec: {
          name: 'read_messages',
          description: 'Messages of one chat, newest first. Before/after a date; paged.',
          props: {
            chat,
            before: {
              type: 'string',
              maxLength: 40,
              description: 'Only messages before this date (ISO 8601).',
            },
            after: {
              type: 'string',
              maxLength: 40,
              description: 'Only messages after this date (ISO 8601).',
            },
            limit,
            page,
          },
          required: ['chat'],
        },
        async run(a) {
          mayRead('read_messages')
          const body = (await ask(
            'read_messages',
            '/messages',
            {
              chat: a.chat,
              before: seconds(a.before, 'before'),
              after: seconds(a.after, 'after'),
              ...(a.limit === undefined ? {} : { limit: a.limit }),
              ...(a.page === undefined ? {} : { page: a.page }),
            },
            15_000,
          )) as { messages?: MessageRow[] }
          return json({ messages: (body.messages ?? []).map(shownMessage) })
        },
      },
      {
        spec: {
          name: 'search_messages',
          description: 'Words in all chats or one chat.',
          props: {
            query: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
              description: 'The words to find.',
            },
            chat: { ...chat, description: 'Only this chat, by its id from list_chats.' },
            limit,
            page,
          },
          required: ['query'],
        },
        async run(a) {
          mayRead('search_messages')
          const body = (await ask('search_messages', '/messages', a, 15_000)) as {
            messages?: MessageRow[]
          }
          return json({ messages: (body.messages ?? []).map(shownMessage) })
        },
      },
      {
        spec: {
          name: 'search_contacts',
          description: 'Contacts by name or number.',
          props: {
            query: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
              description: 'Part of a name or number.',
            },
          },
          required: ['query'],
        },
        async run(a) {
          mayRead('search_contacts')
          const body = (await ask('search_contacts', '/contacts', { query: a.query }, 15_000)) as {
            contacts?: Array<{ jid: string; name: string }>
          }
          return json({
            contacts: (body.contacts ?? []).map((row) => ({ id: row.jid, name: row.name })),
          })
        },
      },
      {
        spec: {
          name: 'get_media',
          description:
            "The image or PDF of one message. The image comes back inline; the file is saved in the plugin's downloads folder.",
          props: {
            chat,
            message: {
              type: 'string',
              maxLength: 64,
              pattern: MESSAGE,
              description: 'The message id, from read_messages or search_messages.',
            },
          },
          required: ['chat', 'message'],
        },
        async run(a) {
          mayRead('get_media')
          const out = path.join(
            config.downloads,
            `${randomBytes(8).toString('hex')}_${a.message as string}.jpg`,
          )
          const body = (await ask(
            'get_media',
            '/media',
            { id: a.message, chat: a.chat, out },
            70_000,
            MEDIA_REFUSALS,
          )) as { kind?: string; mime?: string; size?: number; path?: string; preview?: string }
          if (
            typeof body.path !== 'string' ||
            path.dirname(body.path) !== config.downloads ||
            (body.kind !== 'image' && body.kind !== 'pdf')
          )
            throw new Error('unavailable')
          return {
            content: [
              ...(body.kind === 'image' && body.preview
                ? [{ type: 'image' as const, data: body.preview, mimeType: 'image/jpeg' }]
                : []),
              {
                type: 'text',
                text: JSON.stringify({
                  saved: body.path,
                  kind: body.kind,
                  type: body.mime,
                  bytes: body.size,
                }),
              },
            ],
          }
        },
      },
      {
        spec: {
          name: 'list_groups',
          description:
            'The groups whose "Can write" is on: their names and ids. Works even when reading is off.',
          props: {},
        },
        async run() {
          if (bridge.status().state === 'unlinked' || bridge.status().state === 'pairing')
            throw refusals.refuse('list_groups', 'not-linked')
          return json({
            groups: writableGroups().map((group) => ({ id: group.jid, name: group.name })),
          })
        },
      },
      {
        spec: {
          name: 'send_to_group',
          description: `Text, and optionally one file, to a group whose "Can write" is on. The file must be in ${config.files}, up to 100 MB.`,
          props: {
            group: {
              type: 'string',
              minLength: 1,
              maxLength: 200,
              description: 'The group, by its name or id from list_groups.',
            },
            text: {
              type: 'string',
              maxLength: 20_000,
              description:
                'The message, or the caption of the file. At most 4,000 characters; 1,000 with a file.',
            },
            file: {
              type: 'string',
              maxLength: 1000,
              description: `Absolute path of one file in ${config.files}.`,
            },
          },
          required: ['group'],
        },
        async run(a) {
          const tool = 'send_to_group'
          const text = (a.text as string | undefined) ?? ''
          const file = a.file as string | undefined
          if (file === undefined && text.trim() === '')
            throw new PublicToolError('invalid arguments: "text" is required')
          if (bridge.status().state === 'unlinked' || bridge.status().state === 'pairing')
            throw refusals.refuse(tool, 'not-linked')
          const group = groupNamed(tool, a.group as string)
          if (
            characters(text) >
            (file === undefined ? SEND_LIMITS.textCharacters : SEND_LIMITS.captionCharacters)
          )
            throw refusals.refuse(tool, file === undefined ? 'too-long' : 'caption-too-long')
          const attached = file === undefined ? undefined : await attachment(tool, file)
          // File preparation can outlast a change to the selected group's permission.
          groupNamed(tool, group.jid)
          const reservation = deps.policy.reserve(group.jid, text, attached?.sha256)
          if (!reservation.ok) throw refusals.refuse(tool, reservation.why)
          const sent = settings.get().prefix
            ? text.trim() === ''
              ? MARK
              : `${MARK} ${text}`
            : text
          const reply = await bridge.call(
            '/send',
            { group: group.jid, text: sent, ...(attached ? { file: attached } : {}) },
            { signal: currentRequestSignal(), timeoutMs: attached ? 115_000 : 30_000 },
          )
          if (reply.status === 200)
            return json({
              sent: true,
              group: group.name,
              ...(attached ? { file: attached.name } : {}),
            })
          const { code, refusal } = refusalIn(SEND_REFUSALS, reply.body)
          // A send that failed on the way may still have gone out, so it keeps counting.
          if (code !== 'send_failed') reservation.release()
          if (refusal) throw refusals.refuse(tool, refusal)
          throw new Error('unavailable')
        },
      },
    ]

  return tools.map(({ spec, run }) => ({
    definition: { name: spec.name, description: spec.description, inputSchema: jsonSchemaOf(spec) },
    execute: (raw) => run(parseArgs(spec, raw)),
  }))
}
