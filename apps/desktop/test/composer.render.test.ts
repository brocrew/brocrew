import type { HandedPath } from '../src/shared/attachment-contracts'
import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import PromptComposer, {
  canSend,
  interruptKeyLabel,
  isSendShortcut,
  sendIntentFor,
  sendKeyLabel,
} from '../src/renderer/src/components/PromptComposer.vue'
import {
  createAttachmentBook,
  joiningTheBox,
  shouldRestoreDraft,
} from '../src/renderer/src/lib/drafts'
import { firstMessageBelongsTo } from '../src/renderer/src/components/RuntimeScreen.vue'

const render = (props: Record<string, unknown>): Promise<string> => {
  const staged = props['attachments'] as HandedPath[] | undefined
  const rest = { ...props }
  delete rest['attachments']
  const book = createAttachmentBook()
  if (staged !== undefined) book.write('session:alpha', staged)
  return renderToString(
    createSSRApp({
      render: () => h(PromptComposer as never, { ...rest, handing: book.handing('session:alpha') }),
    }),
  )
}

function buttonTag(html: string, cy: string): string {
  const tag = html.match(new RegExp(`<button[^>]*data-cy="${cy}"[^>]*>`))?.[0] ?? ''
  expect(tag, `no <button data-cy="${cy}"> was rendered`).not.toBe('')
  return tag
}

describe('the send shortcut decision', () => {
  const plain = { metaKey: false, ctrlKey: false, isComposing: false }

  it('plain Enter is NOT a send — it is how a message gets its second line', () => {
    expect(isSendShortcut({ ...plain, key: 'Enter' })).toBe(false)
  })

  it('Enter with ⌘ or Ctrl held is a send', () => {
    expect(isSendShortcut({ ...plain, key: 'Enter', metaKey: true })).toBe(true)
    expect(isSendShortcut({ ...plain, key: 'Enter', ctrlKey: true })).toBe(true)
  })

  it('the modifier alone, or on any other key, is not', () => {
    expect(isSendShortcut({ ...plain, key: 'a', metaKey: true })).toBe(false)
    expect(isSendShortcut({ ...plain, key: 'Meta', metaKey: true })).toBe(false)
  })

  it('an Enter that commits an IME composition never sends, modifier or not', () => {
    expect(isSendShortcut({ ...plain, key: 'Enter', metaKey: true, isComposing: true })).toBe(false)
    expect(isSendShortcut({ ...plain, key: 'Enter', ctrlKey: true, isComposing: true })).toBe(false)
  })
})

describe('the send guard both paths run through', () => {
  it('whitespace-only text — spaces, tabs, bare newlines — never sends', () => {
    expect(canSend('', 'idle')).toBe(false)
    expect(canSend('   ', 'idle')).toBe(false)
    expect(canSend(' \n\t\n ', 'idle')).toBe(false)
  })

  it('real text sends from idle AND mid-turn (077) — never frozen', () => {
    expect(canSend('hello', 'idle')).toBe(true)
    expect(canSend('hello', 'busy')).toBe(true)
    expect(canSend('hello', 'frozen')).toBe(false)
  })

  it('⛔ a caller’s own blocker refuses both paths, whatever the state says (169 §1)', () => {
    expect(canSend('hello', 'idle', 'that profile name cannot be used')).toBe(false)
    expect(canSend('hello', 'busy', 'that profile name cannot be used')).toBe(false)
    expect(canSend('hello', 'frozen', null)).toBe(false)
    expect(canSend('hello', 'idle', null)).toBe(true)
    expect(canSend('hello', 'idle')).toBe(true)
    expect(canSend('hello', 'idle', '')).toBe(false)
  })
})

describe('what a send MEANS depends on the state and the chord (077)', () => {
  it('idle sends now, whatever the modifier — there is no turn to interrupt or wait behind', () => {
    expect(sendIntentFor('idle', false)).toBe('now')
    expect(sendIntentFor('idle', true)).toBe('now')
  })

  it('mid-turn, the plain chord QUEUES and Shift interrupts — the safe one is the reflex', () => {
    expect(sendIntentFor('busy', false)).toBe('queue')
    expect(sendIntentFor('busy', true)).toBe('interrupt')
  })

  it('frozen never produces a destructive intent, since it never sends at all', () => {
    expect(sendIntentFor('frozen', true)).toBe('now')
  })
})

describe('the hint names the modifier this platform has', () => {
  it('⌘ on a Mac, Ctrl everywhere else', () => {
    expect(sendKeyLabel('MacIntel')).toBe('⌘↵')
    expect(sendKeyLabel('Win32')).toBe('Ctrl↵')
    expect(sendKeyLabel('Linux x86_64')).toBe('Ctrl↵')
    expect(sendKeyLabel('')).toBe('Ctrl↵')
  })

  it('and the interrupting chord adds Shift, on both platforms (077)', () => {
    expect(interruptKeyLabel('MacIntel')).toBe('⇧⌘↵')
    expect(interruptKeyLabel('Win32')).toBe('Shift+Ctrl↵')
    expect(interruptKeyLabel('')).toBe('Shift+Ctrl↵')
    expect(interruptKeyLabel('MacIntel')).not.toBe(sendKeyLabel('MacIntel'))
    expect(interruptKeyLabel('Win32')).not.toBe(sendKeyLabel('Win32'))
  })
})

describe('a failed launch hands the message back (015), to the slot it came from (019)', () => {
  const attempt = {
    busy: false,
    wasBusy: true,
    error: 'no such directory',
    lastTried: 'the paragraphs I typed',
  }

  it('restores when a launch attempt ENDS having failed with something to give back', () => {
    expect(shouldRestoreDraft(attempt)).toBe(true)
  })

  it('does not restore while the launch is still running', () => {
    expect(shouldRestoreDraft({ ...attempt, busy: true })).toBe(false)
  })

  it('does not restore a launch that SUCCEEDED — the text became the first message', () => {
    expect(shouldRestoreDraft({ ...attempt, error: null })).toBe(false)
  })

  it('does not fire on the rising edge, or with nothing to restore', () => {
    expect(shouldRestoreDraft({ ...attempt, wasBusy: false })).toBe(false)
    expect(shouldRestoreDraft({ ...attempt, lastTried: '' })).toBe(false)
  })

  it('hands back even when something is being typed now: the words join it, after a blank line', () => {
    expect(shouldRestoreDraft(attempt)).toBe(true)
    expect(joiningTheBox('something I am typing', attempt.lastTried)).toBe(
      'something I am typing\n\nthe paragraphs I typed',
    )
    expect(joiningTheBox(attempt.lastTried, attempt.lastTried)).toBe(attempt.lastTried)
  })
})

describe('a cancelled launch hands the message back too (102)', () => {
  const goesBack = (opened: string | null, launchError: string | null): boolean =>
    firstMessageBelongsTo({ opened, launchError, sendError: null }) === 'launcher'

  it('gives it back when nothing opened and nothing failed', () => {
    expect(goesBack(null, null)).toBe(true)
  })

  it('leaves it to the launcher when the launch FAILED — one hand-back, not two', () => {
    expect(goesBack(null, 'no such directory')).toBe(false)
  })

  it('never gives it back when a conversation DID open — it became the first message', () => {
    expect(goesBack('sess_1', null)).toBe(false)
    expect(goesBack('sess_1', 'a later failure')).toBe(false)
  })
})

describe('a launch that opened and could not speak keeps its conversation (221 §2)', () => {
  it('🔴 sends the words back to the CONVERSATION when the first message was refused', () => {
    expect(
      firstMessageBelongsTo({
        opened: 'sess_1',
        launchError: null,
        sendError: 'that message has no words and nothing attached, so there is nothing to send',
      }),
    ).toBe('conversation')
  })

  it('⚑ …and nowhere at all when it got out — the words are in the transcript now', () => {
    expect(firstMessageBelongsTo({ opened: 'sess_1', launchError: null, sendError: null })).toBe(
      'nowhere',
    )
  })

  it('⛔ the launcher only gets them back when NOTHING opened, and nothing else reported it', () => {
    expect(firstMessageBelongsTo({ opened: null, launchError: null, sendError: null })).toBe(
      'launcher',
    )
    expect(
      firstMessageBelongsTo({ opened: null, launchError: 'no such directory', sendError: null }),
    ).toBe('nowhere')
  })

  it('⛔ …and a launch that opened is NEVER sent back to the launcher, whatever went wrong', () => {
    for (const sendError of [null, 'that file has been moved or deleted since']) {
      expect(firstMessageBelongsTo({ opened: 'sess_1', launchError: null, sendError })).not.toBe(
        'launcher',
      )
    }
  })
})

describe('the field shows the conversation’s draft, and owns none of its own (019)', () => {
  it('renders the draft it is handed', async () => {
    const html = await render({ state: 'idle', draft: 'what A was saying' })
    expect(html).toContain('what A was saying')
  })

  it('a different draft renders a different field — the value is the prop, nothing else', async () => {
    const a = await render({ state: 'idle', draft: 'what A was saying' })
    const b = await render({ state: 'idle', draft: 'what B was saying' })
    expect(a).toContain('what A was saying')
    expect(b).toContain('what B was saying')
    expect(b).not.toContain('what A was saying')
  })

  it('no draft means an empty field, never the last one', async () => {
    const html = await render({ state: 'idle' })
    expect(html).toMatch(/<textarea[^>]*>\s*<\/textarea>/)
  })
})

describe('the composer renders as a multi-line field', () => {
  it('idle: a textarea (newlines can exist), the send button, and the new hint', async () => {
    const html = await render({ state: 'idle' })
    expect(html).toContain('<textarea')
    expect(html).toContain('data-cy="prompt-input"')
    expect(html).toContain('data-cy="send-prompt"')
    expect(html).not.toContain('Enter</strong> sends')
    expect(html).toContain('to send')
    expect(html).toContain('for a new line')
  })

  it('busy with an EMPTY box: typing is allowed (077) and the only button is the stop', async () => {
    const html = await render({ state: 'busy', who: 'Codex' })
    expect(html).not.toMatch(/<textarea[^>]* disabled/)
    expect(html).toContain('data-cy="prompt-input"')
    expect(html).toContain('data-cy="interrupt-session"')
    expect(html).not.toContain('data-cy="send-prompt"')
    expect(html).not.toContain('data-cy="queue-prompt"')
    expect(html).not.toContain('data-cy="interrupt-send-prompt"')
    expect(html).toContain('type to queue a message')
  })

  it('busy WITH a draft: both outcomes are buttons, so neither hides behind a chord (077)', async () => {
    const html = await render({ state: 'busy', who: 'Codex', draft: 'do this next' })
    expect(html).toContain('data-cy="queue-prompt"')
    expect(html).toContain('data-cy="interrupt-send-prompt"')
    expect(html).not.toContain('data-cy="interrupt-session"')
    expect(html).toContain('to send after Codex finishes')
    expect(html).toContain(
      'is Stop and send: the turn is asked to stop; this is sent once it has ended',
    )
  })

  it('🔴 busy with an ATTACHMENT and no words: both outcomes are still offered (234 §2)', async () => {
    const html = await render({
      state: 'busy',
      who: 'Codex',
      attachments: [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }],
    })
    expect(html).toContain('data-cy="queue-prompt"')
    expect(html).toContain('data-cy="interrupt-send-prompt"')
    expect(html).not.toContain('data-cy="interrupt-session"')
    expect(html).toContain('to send after Codex finishes')
  })

  it('⚑ …and with neither words nor an attachment, busy is still only the stop (234 §2)', async () => {
    const html = await render({ state: 'busy', who: 'Codex', attachments: [] })
    expect(html).toContain('data-cy="interrupt-session"')
    expect(html).not.toContain('data-cy="queue-prompt"')
    expect(html).not.toContain('data-cy="interrupt-send-prompt"')
  })

  it('⛔ …and a blocked conversation gets neither, attachment or not (219 §1 kept)', async () => {
    const html = await render({
      state: 'busy',
      who: 'Codex',
      blocked: [{ words: 'This conversation is closing — nothing more can be sent to it.' }],
      attachments: [{ path: '/work/alpha/notes.md', kind: 'file', outsideCwd: false }],
    })
    expect(html).not.toContain('data-cy="queue-prompt"')
    expect(html).not.toContain('data-cy="interrupt-send-prompt"')
    expect(html).toContain('nothing more can be sent to it')
  })

  it('busy with a draft and one already waiting: queueing is OFFERED, behind it (077, D-010)', async () => {
    const html = await render({
      state: 'busy',
      who: 'Codex',
      draft: 'a second one',
      hasQueued: true,
    })
    expect(buttonTag(html, 'queue-prompt')).not.toContain('disabled')
    expect(buttonTag(html, 'queue-prompt')).toContain(
      'with what is already waiting — a command goes alone',
    )
    expect(buttonTag(html, 'queue-prompt')).not.toContain('take what is already waiting')
    expect(html).toContain('data-cy="interrupt-send-prompt"')
    expect(html).not.toContain('A message is already waiting')
  })

  it('frozen: disabled, and the hint still says why a message will not help', async () => {
    const html = await render({ state: 'frozen' })
    expect(html).toMatch(/<textarea[^>]* disabled/)
    expect(html).toContain('A message won&#39;t answer it')
  })
})

describe('a frozen turn can be abandoned without answering it (094)', () => {
  it('offers the stop button, and says so in the hint', async () => {
    const html = await render({ state: 'frozen' })
    expect(html).toContain('data-cy="interrupt-session"')
    expect(html).toContain('Esc</strong> is Stop: the turn is asked to stop')
    expect(html).toContain('Stop instead of answering — the turn is asked to stop (Esc)')
    expect(html).not.toContain('Esc</strong> stops the turn')
  })

  it('⚠️ and 034 is untouched — a message still cannot be the answer', async () => {
    const html = await render({ state: 'frozen', draft: 'let me just say something' })
    expect(html).toMatch(/<textarea[^>]* disabled/)
    expect(html).toContain('data-cy="prompt-input"')
    expect(html).not.toContain('data-cy="send-prompt"')
    expect(html).not.toContain('data-cy="queue-prompt"')
    expect(html).not.toContain('data-cy="interrupt-send-prompt"')
    expect(canSend('let me just say something', 'frozen')).toBe(false)
    expect(html).toContain('A message won&#39;t answer it')
    expect(html).toContain('data-cy="interrupt-session"')
  })

  it('a composer told it is not interruptible offers no way to interrupt', async () => {
    const html = await render({ state: 'frozen', interruptible: false })
    expect(html).not.toContain('data-cy="interrupt-session"')
    expect(html).not.toContain('Esc</strong> is Stop')
    expect(html).toContain('A message won&#39;t answer it')
  })

  it('a launch is stoppable under its OWN name, never the turn one (102, re-homed by 103)', async () => {
    const html = await render({ state: 'starting' })
    expect(html).toContain('data-cy="cancel-launch"')
    expect(html).not.toContain('data-cy="interrupt-session"')
    expect(buttonTag(html, 'cancel-launch')).toContain('Stop opening this conversation')
  })

  it('…and a launch cannot be sent to, which is what makes it not a turn (103)', async () => {
    const html = await render({ state: 'starting', draft: 'the second thought', who: 'BroBot' })
    expect(canSend('the second thought', 'starting')).toBe(false)
    expect(buttonTag(html, 'send-prompt')).toContain('disabled')
    expect(html).toMatch(/<textarea[^>]* disabled/)
    expect(html).toContain('data-cy="prompt-input"')
    expect(html).toContain('BroBot is starting this conversation…')
    expect(html).toContain('data-cy="cancel-launch"')
    expect(canSend('the second thought', 'busy')).toBe(true)
    const busy = await render({ state: 'busy', draft: 'the second thought', who: 'BroBot' })
    expect(busy).not.toMatch(/<textarea[^>]* disabled/)
  })
})
