import { describe, expect, it } from 'vitest'
import { transcriptEventForDisplay } from '../src/main/providers/error-presentation'
import type { TranscriptEvent } from '../src/shared/conversation-events'
import { REOPEN_COSTS } from '../src/renderer/src/lib/reopening'
import {
  applyEvent,
  createTranscript,
  type TranscriptState,
  type NoticeItem,
} from '../src/renderer/src/lib/transcript'

function fold(event: TranscriptEvent): TranscriptState {
  const state = createTranscript()
  applyEvent(state, event)
  return state
}

describe('core credential words reach the transcript without native client decoding', () => {
  const CODEX_TEXT =
    'Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again.'
  const CLAUDE_TEXT = 'Failed to authenticate. API Error: 401 OAuth access token has been revoked.'

  const noticeOf = (state: TranscriptState): NoticeItem => {
    const notices = state.items.filter((i): i is NoticeItem => i.kind === 'notice')
    if (notices.length !== 1) throw new Error(`expected one notice, got ${notices.length}`)
    return notices[0]!
  }

  it('`auth_stale` offers a reopen, names where it is, and says what the reopen does not bring back', () => {
    const state = fold(
      transcriptEventForDisplay(
        {
          type: 'error',
          message: CLAUDE_TEXT,
          fatal: true,
          cause: 'auth_stale',
        },
        'claude',
      ),
    )
    const notice = noticeOf(state)
    expect(notice.level).toBe('error')
    expect(notice.text).toContain('send it a message to carry on')
    expect(notice.text).not.toContain('sidebar')
    expect(notice.text).not.toContain('press it')
    expect(notice.text).not.toContain('Resume')
    expect(notice.text).not.toContain('closed threads')
    expect(notice.text).not.toContain('Nothing here is lost')
    expect(notice.text).toContain('cannot continue')
    expect(notice.text).toContain('Its transcript is kept')
    expect(notice.text).toContain('this app carries it on with the new login by itself')
    expect(notice.text).toContain('Otherwise, send it a message to carry on')
    expect(notice.text).toContain('reads your machine login again')
    expect(notice.text).toContain('says so if that login has expired too')
    for (const cost of ['Allow for this conversation', 'running in the background']) {
      const row = REOPEN_COSTS.find((one) => 'isTold' in one.person && one.person.isTold === cost)
      expect(row?.becomes, cost).toMatch(/^(lost|stopped)$/)
      expect(notice.text).toContain(cost)
    }
    expect(notice.text).not.toContain('sign in again')
    expect(notice.text).not.toContain('401')
    expect(notice.text).not.toContain('OAuth')
  })

  it('`auth` still says sign in again — the branch that must not have moved', () => {
    const notice = noticeOf(
      fold(
        transcriptEventForDisplay(
          {
            type: 'error',
            message: CODEX_TEXT,
            fatal: false,
            cause: 'auth',
          },
          'codex',
        ),
      ),
    )
    expect(notice.level).toBe('error')
    expect(notice.text).toContain('sign in again')
    expect(notice.text).not.toContain('refresh token')
  })
})
