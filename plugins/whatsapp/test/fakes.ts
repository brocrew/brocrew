import type { Bridge, BridgeGroup, BridgeReply, BridgeState, BridgeStatus } from '../src/bridge.js'

export const ROWING = { jid: '120363000000000001@g.us', name: 'Harbour Rowing Club' }
export const ALLOTMENT = { jid: '120363000000000002@g.us', name: 'Allotment Society' }
export const ALTOS = { jid: '120363000000000003@g.us', name: 'Choir Altos' }
export const ALTOS_TWO = { jid: '120363000000000004@g.us', name: 'choir altos' }
export const INES = '15550000001@s.whatsapp.net'
export const TOMAS = '15550000002@s.whatsapp.net'

interface FakeMessage {
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

/** Stands in for the Go bridge: made-up chats, no WhatsApp account, every request recorded. */
export class FakeBridge implements Bridge {
  state: BridgeState = 'linked'
  expired = false
  account = 'Fictional Phone'
  groupList: BridgeGroup[] = [ROWING, ALLOTMENT, ALTOS, ALTOS_TWO]
  messages: FakeMessage[] = [
    {
      id: 'MSG00001',
      chat: ROWING.jid,
      chatName: ROWING.name,
      time: 1_800_000_000,
      sender: INES,
      senderName: 'Ines Calder',
      fromMe: false,
      text: 'Training moves to Thursday',
    },
    {
      id: 'MSG00002',
      chat: ROWING.jid,
      chatName: ROWING.name,
      time: 1_800_000_060,
      sender: '15550000009@s.whatsapp.net',
      senderName: '',
      fromMe: true,
      text: '🤖 Boats are booked',
      sentByAgent: true,
    },
    {
      id: 'MSG00003',
      chat: INES,
      chatName: 'Ines Calder',
      time: 1_800_000_120,
      sender: INES,
      senderName: 'Ines Calder',
      fromMe: false,
      text: '',
      media: 'image',
    },
  ]
  requests: Array<{ route: string; body: unknown }> = []
  /** An error code the next send answers with, as the bridge would. */
  sendError: string | undefined
  mediaError: string | undefined
  unlinked = 0

  status(): BridgeStatus {
    return {
      state: this.state,
      expired: this.expired,
      account: this.state === 'linked' ? this.account : '',
      qr:
        this.state === 'pairing'
          ? { size: 21, bits: '01'.repeat(220) + '1', expiresAt: 1_900_000_000_000 }
          : null,
      removeOnPhone: false,
    }
  }
  groups(): readonly BridgeGroup[] {
    return this.state === 'linked' ? this.groupList : []
  }
  async refreshGroups(): Promise<void> {
    await this.call('/groups', { refresh: true })
  }
  async call(route: string, body: unknown): Promise<BridgeReply> {
    this.requests.push({ route, body })
    const asked = (body ?? {}) as Record<string, unknown>
    const ok = (value: unknown): BridgeReply => ({ status: 200, body: value })
    const refused = (error: string): BridgeReply => ({ status: 400, body: { error } })
    switch (route) {
      case '/groups':
        return ok({ groups: this.groups() })
      case '/chats':
        return ok({
          chats: [
            {
              jid: ROWING.jid,
              name: ROWING.name,
              group: true,
              lastTime: 1_800_000_060,
              lastText: '🤖 Boats are booked',
              lastFromMe: true,
            },
            {
              jid: INES,
              name: 'Ines Calder',
              group: false,
              lastTime: 1_800_000_120,
              lastText: '',
              lastFromMe: false,
            },
          ].filter(
            (one) =>
              !asked.query || one.name.toLowerCase().includes(String(asked.query).toLowerCase()),
          ),
        })
      case '/messages':
        return ok({
          messages: this.messages
            .filter((one) => !asked.chat || one.chat === asked.chat)
            .filter(
              (one) =>
                !asked.query || one.text.toLowerCase().includes(String(asked.query).toLowerCase()),
            )
            .filter((one) => !asked.before || one.time < (asked.before as number))
            .filter((one) => !asked.after || one.time > (asked.after as number))
            .sort((a, b) => b.time - a.time),
        })
      case '/contacts':
        return ok({
          contacts: [
            { jid: INES, name: 'Ines Calder' },
            { jid: TOMAS, name: 'Tomas Reyes' },
          ],
        })
      case '/media':
        if (this.mediaError) return refused(this.mediaError)
        return ok({
          kind: 'image',
          mime: 'image/jpeg',
          size: 4,
          path: asked.out,
          preview: '/9j/AA==',
        })
      case '/send': {
        const error = this.sendError
        this.sendError = undefined
        return error ? refused(error) : ok({})
      }
    }
    return { status: 404, body: { error: 'not_found' } }
  }
  async pair(): Promise<boolean> {
    if (this.state !== 'unlinked') return false
    this.state = 'pairing'
    return true
  }
  async unlink(): Promise<void> {
    this.unlinked++
    this.state = 'unlinked'
  }
  async close(): Promise<void> {}
  sends() {
    return this.requests
      .filter((one) => one.route === '/send')
      .map(
        (one) =>
          one.body as {
            group: string
            text: string
            file?: { path: string; name: string; size: number; sha256: string }
          },
      )
  }
}
