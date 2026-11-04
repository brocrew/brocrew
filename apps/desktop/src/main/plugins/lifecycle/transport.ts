import type { Socket } from 'node:net'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { PluginSupervisorError } from '../supervisor/protocol'

const Packet = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('call'), id: z.uuid(), value: z.unknown() }),
  z.strictObject({ kind: z.literal('reply'), id: z.uuid(), ok: z.boolean(), value: z.unknown() }),
])
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
/** Ordinary local request/reply channel with per-call correlation. */
export class PersonChannel {
  private input = ''
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
  private readonly lost = new Set<() => void>()
  constructor(
    private readonly socket: Socket,
    _key: string,
    _challenge: string,
    private readonly side: 'server' | 'client',
    private readonly handle: (input: unknown) => Promise<unknown>,
    private readonly reportRefusals: () => boolean = () => false,
  ) {
    void _key
    void _challenge
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
    if (this.closed) throw new PluginSupervisorError('unavailable')
    this.socket.write(JSON.stringify(packet) + '\n')
  }

  private read(bytes: string): void {
    this.input += bytes
    let newline: number
    while ((newline = this.input.indexOf('\n')) !== -1) {
      const line = this.input.slice(0, newline + 1)
      this.input = this.input.slice(newline + 1)
      try {
        const packet = Packet.parse(JSON.parse(line))
        if (packet.kind === 'reply') {
          const waiter = this.pending.get(packet.id)
          if (!waiter) throw new Error('unavailable')
          this.pending.delete(packet.id)
          clearTimeout(waiter.timer)
          if (packet.ok) waiter.resolve(packet.value)
          else {
            const cause = z
              .strictObject({
                pluginRefusal: z.enum([
                  'policy-refused',
                  'source-mismatch',
                  'incompatible',
                  'network',
                ]),
              })
              .safeParse(packet.value)
            const detail = z.object({ pluginError: z.string() }).safeParse(packet.value)
            waiter.reject(
              detail.success
                ? new Error(detail.data.pluginError)
                : new PluginSupervisorError(
                    cause.success ? cause.data.pluginRefusal : 'unavailable',
                  ),
            )
          }
        } else {
          const work = Promise.resolve()
            .then(() => this.handle(packet.value))
            .then(
              (value) =>
                this.send({ kind: 'reply', id: packet.id, ok: true, value: value ?? null }),
              (error) =>
                this.send({
                  kind: 'reply',
                  id: packet.id,
                  ok: false,
                  value:
                    this.reportRefusals() &&
                    error instanceof PluginSupervisorError &&
                    ['policy-refused', 'source-mismatch', 'incompatible', 'network'].includes(
                      error.code,
                    )
                      ? { pluginRefusal: error.code }
                      : this.reportRefusals() && error instanceof Error
                        ? { pluginError: error.message }
                        : null,
                }),
            )
            .catch(() => this.close())
            .finally(() => {
              this.work.delete(work)
            })
          this.work.add(work)
        }
      } catch {
        this.close()
        return
      }
    }
  }
  call(value: unknown, within: number = ANSWER_WITHIN[this.side]): Promise<unknown> {
    if (this.closed) return Promise.reject(new PluginSupervisorError('unavailable'))
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
