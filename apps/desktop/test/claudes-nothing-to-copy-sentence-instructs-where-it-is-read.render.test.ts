import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { capabilitiesFor } from '@brobot2/runtime'
import SignInPanel from '../src/renderer/src/components/SignInPanel.vue'
import { modelField } from '../src/renderer/src/lib/model-field'
import type { AuthState } from '../src/shared/runtime-ipc'

/**
 * # Claude's "nothing to copy" sentence says what to do, in both places a person reads it
 *
 * Claude declares that its machine sign-in cannot be copied into a profile, and the reason it gives
 * is read in two places, as it is declared:
 *
 *  - **the sign-in panel**, as its last line, where a copy button would be;
 *  - **the model picker**, as what to do when Claude could not be asked which models it runs.
 *
 * The picker shows it because it is an instruction. So the sentence has to keep telling a person
 * what to do, and it names no command: it comes from a fixed table, read once per window, that
 * cannot know which Claude Code this computer has.
 *
 * ⚑ Claude's real declaration, never a stand-in: a reworded sentence is met here.
 */

const declared = capabilitiesFor('claude')
const NOTHING_TO_COPY =
  'There is nothing to copy — with no API key saved, Claude sessions read your machine login ' +
  'directly. If it has expired, starting a Claude conversation renews it.'
const WHAT_TO_DO = 'If it has expired, starting a Claude conversation renews it.'

/** One element's text in rendered HTML, by its `data-cy`. */
function textOf(html: string, cy: string): string {
  const found = new RegExp(`data-cy="${cy}"[^>]*>([^<]*)<`).exec(html)
  return (found?.[1] ?? '').replaceAll('&#39;', "'").replaceAll('&quot;', '"').trim()
}

describe('Claude’s “nothing to copy” sentence', () => {
  it('🔴 is declared as an instruction, with no command in it', () => {
    const copy = declared.reprovisionAuth
    expect(copy.state).toBe('absent')
    expect(copy.state === 'absent' && copy.reason).toBe(NOTHING_TO_COPY)
    expect(NOTHING_TO_COPY).toContain(WHAT_TO_DO)
    // ⛔ No command: which program runs, and in which shell, is not this table's to say.
    expect(NOTHING_TO_COPY).not.toMatch(/`|\bterminal\b|PowerShell/)
  })

  it('🔴 the sign-in panel ends on it, whole', async () => {
    const notSignedIn: AuthState = { state: 'absent', reason: 'This computer has no Claude login.' }
    const html = await renderToString(
      createSSRApp({
        render: () =>
          h(SignInPanel as never, {
            provider: 'claude',
            state: notSignedIn,
            signIn: declared.signIn,
            reprovision: declared.reprovisionAuth,
            busy: 'idle',
            notice: null,
          }),
      }),
    )
    expect(textOf(html, 'sign-in-no-copy')).toBe(NOTHING_TO_COPY)
    // ⚑ The control: where a copy IS offered, the line is not drawn at all.
    const codex = capabilitiesFor('codex')
    const offered = await renderToString(
      createSSRApp({
        render: () =>
          h(SignInPanel as never, {
            provider: 'codex',
            state: notSignedIn,
            signIn: codex.signIn,
            reprovision: codex.reprovisionAuth,
            busy: 'idle',
            notice: null,
          }),
      }),
    )
    expect(offered).toContain('data-cy="sign-in-reprovision"')
    expect(offered).not.toContain('data-cy="sign-in-no-copy"')
  })

  it('🔴 the model picker directs missing setup to Settings instead of showing raw diagnostics', () => {
    const field = modelField({
      catalogue: { ok: false, reason: 'refused', detail: 'credentials expired' },
      profileExists: true,
      provider: 'claude',
      signIn: declared.signIn,
      reprovision: declared.reprovisionAuth,
    })
    expect(field.state).toBe('refused')
    expect(field.message).toBe("claude isn't set up. Set it up in Settings → Providers.")
    expect(field.notSetUp).toBe(true)
    expect(field.detail).toBe('credentials expired')
  })
})
