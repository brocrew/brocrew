import { createHash } from 'node:crypto'

export const SEND_LIMITS = Object.freeze({
  textCharacters: 4000,
  captionCharacters: 1000,
  perGroup: 5,
  perGroupMs: 10 * 60_000,
  total: 20,
  totalMs: 60 * 60_000,
  duplicateMs: 60 * 60_000,
})

/** Characters as a person counts them: an emoji is one. */
export const characters = (text: string): number => [...text].length

interface Sent {
  at: number
  group: string
  fingerprint: string
}

/**
 * Sends agents make, held in memory: five per group in ten minutes, twenty an hour in all, and the same
 * text (and file) to the same group once an hour. A reservation is taken before the send and released
 * when nothing went out.
 */
export function createSendPolicy(now: () => number = Date.now) {
  let sent: Sent[] = []
  return {
    reserve(
      group: string,
      text: string,
      fileSha256 = '',
    ): { ok: true; release(): void } | { ok: false; why: 'too-many' | 'duplicate' } {
      const at = now()
      sent = sent.filter((one) => at - one.at < SEND_LIMITS.totalMs)
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([group, text, fileSha256]))
        .digest('hex')
      if (
        sent.some(
          (one) =>
            one.group === group &&
            one.fingerprint === fingerprint &&
            at - one.at < SEND_LIMITS.duplicateMs,
        )
      )
        return { ok: false, why: 'duplicate' }
      if (
        sent.length >= SEND_LIMITS.total ||
        sent.filter((one) => one.group === group && at - one.at < SEND_LIMITS.perGroupMs).length >=
          SEND_LIMITS.perGroup
      )
        return { ok: false, why: 'too-many' }
      const entry = { at, group, fingerprint }
      sent.push(entry)
      return {
        ok: true,
        release: () => {
          sent = sent.filter((one) => one !== entry)
        },
      }
    },
  }
}
export type SendPolicy = ReturnType<typeof createSendPolicy>
