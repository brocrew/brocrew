import type { Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { pack, unpack, OWNER_LIMITS, PluginSupervisorError } from '../supervisor/protocol'

const Packet = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('call'), id: z.uuid(), value: z.unknown() }),
  z.strictObject({ kind: z.literal('reply'), id: z.uuid(), ok: z.boolean(), value: z.unknown() }),
])
const Frame = z.strictObject({
  challenge: z.string(),
  sequence: z.number().int().positive().safe(),
  packet: Packet,
})
/**
 * How long a call may go unanswered before its channel is taken as lost. The app's calls wait for
 * the owner's state lock and may download, start or stop a plugin; the owner's calls are the app's
 * own work on its windows.
 */
// On Windows a first plugin start opens the job keeper, which can take two minutes on a cold machine.
const ANSWER_WITHIN = {
  client: 180_000,
  server: process.platform === 'win32' ? 180_000 : 30_000,
} as const
/** Private person-control transport. No endpoints, tokens or raw errors are returned as diagnostics. */
export class PersonChannel {
  private input = ''
  private sent = 0
  private received = 0
  private closed = false
  private readonly pending = new Map<
    string,
    {
      resolve(value: unknown): void
      reject(error: Error): void
      timer: ReturnType<typeof setTimeout>
    }
  >()
  private readonly work = new Set<Promise<unknown>>()
  async settled(): Promise<void> {
    await Promise.allSettled([...this.work])
  }
  private incoming = 0
  private readonly lost = new Set<() => void>()
  constructor(
    private readonly socket: Socket,
    private readonly key: string,
    private readonly challenge: string,
    private readonly side: 'server' | 'client',
    private readonly handle: (input: unknown) => Promise<unknown>,
  ) {
    socket.setEncoding('utf8')
    socket.on('data', (bytes) => this.read(String(bytes)))
    socket.on('error', () => this.close())
    socket.on('close', () => this.close())
  }
  get open(): boolean {
    return !this.closed
  }
  onClose(callback: () => void): () => void {
    this.lost.add(callback)
    return () => this.lost.delete(callback)
  }
  private send(packet: z.infer<typeof Packet>): void {
    if (this.closed || this.socket.writableLength > OWNER_LIMITS.packet * 4)
      throw new PluginSupervisorError('unavailable')
    this.socket.write(
      pack(this.key, this.side === 'client' ? 'request' : 'response', {
        challenge: this.challenge,
        sequence: ++this.sent,
        packet,
      }),
    )
  }
  private read(bytes: string): void {
    this.input += bytes
    // Deliberately bound a batch as well as individual frames: no unbounded buffered callers.
    if (Buffer.byteLength(this.input) > OWNER_LIMITS.packet * 4) return this.close()
    let newline: number
    while ((newline = this.input.indexOf('\n')) !== -1) {
      const line = this.input.slice(0, newline + 1)
      this.input = this.input.slice(newline + 1)
      try {
        if (Buffer.byteLength(line) > OWNER_LIMITS.packet) throw new Error('unavailable')
        const frame = Frame.parse(
          unpack(this.key, this.side === 'client' ? 'response' : 'request', line),
        )
        if (frame.challenge !== this.challenge || frame.sequence !== ++this.received)
          throw new Error('unavailable')
        const packet = frame.packet
        if (packet.kind === 'reply') {
          const waiter = this.pending.get(packet.id)
          if (!waiter) throw new Error('unavailable')
          this.pending.delete(packet.id)
          clearTimeout(waiter.timer)
          if (packet.ok) waiter.resolve(packet.value)
          else waiter.reject(new PluginSupervisorError('unavailable'))
        } else {
          if (++this.incoming > 8) throw new Error('unavailable')
          const work = Promise.resolve()
            .then(() => this.handle(packet.value))
            .then(
              (value) =>
                this.send({ kind: 'reply', id: packet.id, ok: true, value: value ?? null }),
              () => this.send({ kind: 'reply', id: packet.id, ok: false, value: null }),
            )
            .catch(() => this.close())
            .finally(() => {
              this.incoming--
              this.work.delete(work)
            })
          this.work.add(work)
        }
      } catch {
        this.close()
        return
      }
    }
    if (Buffer.byteLength(this.input) > OWNER_LIMITS.packet) this.close()
  }
  call(value: unknown, within: number = ANSWER_WITHIN[this.side]): Promise<unknown> {
    if (this.closed || this.pending.size >= 8)
      return Promise.reject(new PluginSupervisorError('unavailable'))
    const id = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close()
      }, within)
      this.pending.set(id, { resolve, reject, timer })
      try {
        this.send({ kind: 'call', id, value })
      } catch {
        this.close()
      }
    })
  }
  close(): void {
    if (this.closed) return
    this.closed = true
    this.socket.destroy()
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer)
      waiter.reject(new PluginSupervisorError('unavailable'))
    }
    this.pending.clear()
    for (const callback of this.lost) {
      try {
        callback()
      } catch {
        /* Denial remains in place. */
      }
    }
    this.lost.clear()
  }
}
