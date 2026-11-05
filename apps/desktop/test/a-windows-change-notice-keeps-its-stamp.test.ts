import { describe, expect, it } from 'vitest'
import { changeNotices } from '../src/main/runtime/change-notices'
import type { RuntimeChangeMessage } from '../src/shared/runtime-ipc'

/**
 * The notices the app gathers for a turn of the loop and sends every window once it ends: one per
 * subject, each the newest announced for it, stamp and all, so a window can order it against the
 * answers it holds.
 */
describe('a window’s change notice keeps its stamp', () => {
  const epoch = { run: 'fictional-run', n: 0 }
  const gathered = () => {
    const sent: RuntimeChangeMessage[] = []
    let flush: (() => void) | undefined
    const notices = changeNotices(
      (message) => sent.push(message),
      (next) => {
        flush = next
      },
    )
    return { sent, notices, flush: () => flush?.() }
  }

  it('one notice per subject per turn, the newest of each, with its stamp', () => {
    const { sent, notices, flush } = gathered()
    notices.announce({ what: 'persons', published: { epoch, seq: 4 } })
    notices.announce({ what: 'conversations', published: { epoch, seq: 5 } })
    notices.announce({ what: 'persons', published: { epoch, seq: 6 } })
    notices.announce({ what: 'agents' })
    expect(sent).toEqual([])
    flush()
    expect(sent).toEqual([
      { what: 'persons', published: { epoch, seq: 6 } },
      { what: 'conversations', published: { epoch, seq: 5 } },
      { what: 'agents' },
    ])
  })

  it('a later turn sends its own notices again', () => {
    const { sent, notices, flush } = gathered()
    notices.announce({ what: 'persons', published: { epoch, seq: 1 } })
    flush()
    notices.announce({ what: 'persons', published: { epoch, seq: 2 } })
    flush()
    expect(sent.map((one) => one.published?.seq)).toEqual([1, 2])
  })
})
