import { describe, expect, it } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { capabilitiesFor } from '@brobot2/runtime'
import type { AuthState, CapabilityStatus } from '../src/shared/runtime-ipc'
import SignInPanel from '../src/renderer/src/components/SignInPanel.vue'

/**
 * The way out of a stale credential, as a surface (098).
 *
 * ⚠️ **Every "it is not shown" here is paired with an "it IS shown".** These tests render to a
 * string, and a string assertion that something is absent passes just as well over a component that
 * renders nothing at all — the failure mode this repo has now counted twenty-eight times. So the
 * negative and the positive are asserted in the same test, on the same component, with only the
 * input changed.
 */

const render = (props: Record<string, unknown>): Promise<string> =>
  renderToString(createSSRApp({ render: () => h(SignInPanel as never, props) }))

/** The real declaration, so this file cannot pass against a capability the adapters do not make. */
const CODEX_SIGN_IN: CapabilityStatus = capabilitiesFor('codex').signIn
const CLAUDE_SIGN_IN: CapabilityStatus = capabilitiesFor('claude').signIn

const CODEX_COPY: CapabilityStatus = capabilitiesFor('codex').reprovisionAuth
const CLAUDE_COPY: CapabilityStatus = capabilitiesFor('claude').reprovisionAuth

const base = { signIn: CODEX_SIGN_IN, reprovision: CODEX_COPY, busy: 'idle', notice: null }
const STALE: AuthState = { state: 'stale', reason: 'This profile’s Codex sign-in has expired.' }
const ABSENT: AuthState = { state: 'absent', reason: 'This profile has no Codex sign-in yet.' }
const UNKNOWN: AuthState = { state: 'unknown', reason: 'could not ask' }
const USABLE: AuthState = {
  state: 'usable',
  account: 'someone@example.invalid',
  login: 'account',
  expiresAt: null,
}

describe('SignInPanel — when it appears at all (098)', () => {
  it('stays out of the way for a working credential, and appears for a stale one', async () => {
    const quiet = await render({ ...base, state: USABLE })
    expect(quiet).not.toContain('sign-in-panel')

    // The pairing. Same component, same props but the state — so the silence above is a decision.
    const loud = await render({ ...base, state: STALE })
    expect(loud).toContain('data-cy="sign-in-panel"')
    expect(loud).toContain('expired')
  })

  it('says nothing before anyone has asked — `null` is not a verdict', async () => {
    expect(await render({ ...base, state: null })).not.toContain('sign-in-panel')
    // Paired against the state that IS a verdict.
    expect(await render({ ...base, state: ABSENT })).toContain('data-cy="sign-in-panel"')
  })

  it('⚠️ shows `unknown` rather than treating "could not ask" as "you are fine"', async () => {
    const html = await render({ ...base, state: UNKNOWN })
    expect(html).toContain('data-cy="sign-in-panel"')
    expect(html).toContain('Could not check')
    // And it offers the way to try again rather than only reporting the failure.
    expect(html).toContain('data-cy="sign-in-check"')
  })

  it('distinguishes expired from never-signed-in — they need different sentences', async () => {
    expect(await render({ ...base, state: STALE })).toContain('sign-in has expired')
    expect(await render({ ...base, state: ABSENT })).toContain('not signed in')
  })
})

describe('SignInPanel — the two ways out, and the difference between them (098)', () => {
  it('offers signing in FIRST, because it is the one that does not recur', async () => {
    const html = await render({ ...base, state: STALE })
    expect(html).toContain('data-cy="sign-in-start"')
    expect(html).toContain('data-cy="sign-in-reprovision"')
    // Order is the ruling made visible: the remedy that ends the sharing comes first.
    expect(html.indexOf('data-cy="sign-in-start"')).toBeLessThan(
      html.indexOf('data-cy="sign-in-reprovision"'),
    )
  })

  it('⚠️ says out loud that copying does not end the sharing — the sentence 098 exists for', async () => {
    const html = await render({ ...base, state: STALE })
    expect(html).toContain('data-cy="sign-in-caveat"')
    expect(html).toMatch(/shares one sign-in with the CLI/)
    expect(html).toMatch(/expire the other/)
  })

  it('asks the capability rather than the provider — Codex offers it, Claude explains why not', async () => {
    const codex = await render({ ...base, state: STALE, signIn: CODEX_SIGN_IN })
    expect(codex).toContain('data-cy="sign-in-start"')
    expect(codex).not.toContain('data-cy="sign-in-unavailable"')

    // ⚠️ The pairing, and the whole of 039's rule: nothing in the component names a provider. Hand
    // it Claude's real declarations and BOTH buttons go, replaced by the ADAPTER's own reasons.
    const claude = await render({
      ...base,
      state: ABSENT,
      signIn: CLAUDE_SIGN_IN,
      reprovision: CLAUDE_COPY,
    })
    expect(claude).not.toContain('data-cy="sign-in-start"')
    expect(claude).toContain('data-cy="sign-in-unavailable"')
    expect(claude).toContain('machine login')
  })

  it('⚠️ never offers a remedy the host would refuse — the copy button is its own capability', async () => {
    // A review finding: the copy button used to render unconditionally, so a Claude user with an
    // expired machine login was shown "Copy my machine sign-in" — a gesture `createProviderAuthOps`
    // throws on outright, because Claude keeps no credential in the profile home to copy into.
    const claude = await render({
      ...base,
      state: ABSENT,
      signIn: CLAUDE_SIGN_IN,
      reprovision: CLAUDE_COPY,
    })
    expect(claude).not.toContain('data-cy="sign-in-reprovision"')
    expect(claude).toContain('data-cy="sign-in-no-copy"')
    expect(claude).toContain('starting a Claude conversation renews it')
    // And the choice-between-two-remedies sentence is withheld, because there is no choice here.
    expect(claude).not.toContain('data-cy="sign-in-caveat"')

    // Paired: Codex declares both, so it gets both buttons AND the sentence about choosing.
    const codex = await render({ ...base, state: STALE })
    expect(codex).toContain('data-cy="sign-in-reprovision"')
    expect(codex).toContain('data-cy="sign-in-caveat"')
    expect(codex).not.toContain('data-cy="sign-in-no-copy"')
  })

  it('shows a Cancel only while a sign-in is actually waiting on the browser', async () => {
    const waiting = await render({ ...base, state: STALE, busy: 'signing-in' })
    expect(waiting).toContain('data-cy="sign-in-cancel"')
    expect(waiting).toContain('Waiting for your browser')

    // Paired: idle has no Cancel, so the presence above is about the state and not about the markup.
    const idle = await render({ ...base, state: STALE, busy: 'idle' })
    expect(idle).not.toContain('data-cy="sign-in-cancel"')
    expect(idle).toContain('Sign in to this profile')
  })

  it('disables EVERY button while one gesture is in flight, and enables them when idle', async () => {
    // ⚠️ This counted `disabled` occurrences (>= 2) and would have passed with one button still
    // live — a review finding on this file's own test. Each hook is asserted by name instead, so a
    // dropped `:disabled` on any one of the three is a red.
    const copying = await render({ ...base, state: STALE, busy: 'copying' })
    expect(copying).toContain('Copying…')
    for (const hook of ['sign-in-start', 'sign-in-reprovision', 'sign-in-check']) {
      expect(copying).toMatch(
        new RegExp(`disabled[^>]*data-cy="${hook}"|data-cy="${hook}"[^>]*disabled`),
      )
    }

    const idle = await render({ ...base, state: STALE, busy: 'idle' })
    expect(idle).not.toContain('disabled')
  })

  it('reports the outcome of the last gesture when there is one, and nothing when there is not', async () => {
    const told = await render({
      ...base,
      state: STALE,
      notice: 'Your machine sign-in is identical to the one already here.',
    })
    expect(told).toContain('data-cy="sign-in-notice"')
    expect(told).toContain('identical to the one already here')

    expect(await render({ ...base, state: STALE, notice: null })).not.toContain('sign-in-notice')
  })

  it('🔒 renders no credential, because none is in the data it is given', async () => {
    const html = await render({
      ...base,
      state: { state: 'stale', reason: 'expired' },
      notice: 'Copied your machine sign-in into this profile.',
    })
    for (const secret of ['access_token', 'refresh_token', 'id_token', 'Bearer', 'sk-']) {
      expect(html).not.toContain(secret)
    }
    // Paired, so the absence above is not the absence of a rendered panel.
    expect(html).toContain('data-cy="sign-in-panel"')
  })
})
