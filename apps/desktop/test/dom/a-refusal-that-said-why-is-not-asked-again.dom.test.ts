import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
// ⚠️ The MODULE, not the barrel — `@brobot2/runtime`'s index reaches `node:fs` and fails to import
// in this project (`the-bridge-that-clones-nothing.dom.test.ts`' note, for the same import).
import { allProviderCapabilities } from '../../../../packages/runtime/src/capabilities'
import NewConversation from '../../src/renderer/src/components/NewConversation.vue'
import * as since725 from '../../src/renderer/src/components/NewConversation.vue'
import { createAttachmentBook, NEW_CONVERSATION } from '../../src/renderer/src/lib/drafts'
import { NO_LAUNCH_CHOICES } from '../../src/renderer/src/lib/launch-choices'
import {
  DEFAULT_PROFILE_ID,
  LAUNCH_REFUSALS,
  type LaunchRefusal,
} from '../../src/shared/runtime-ipc'
import { mount, unmountAll, visible, type Mounted } from './harness'

/**
 * # 🔴 725 draw 7 · `716` F-1 — a refusal that said why is not asked about again, DRAWN
 *
 * ⚑ **The finding** (`716` §9, F-1): the launcher skips its automatic sign-in check when main's
 * refusal already said why. ⚑ **Main's table, third column** (`LAUNCH_REFUSALS`): `sign-in` → the
 * check *"is the remedy — its buttons are how a person fixes it"*; `program`, `folder`, `machine`,
 * `launch` → it *"says nothing the refusal did not"*; no word → *"the launcher's check is then the
 * only diagnosis there is"*. ⛔ **`710` F-7 is the defect**: after a start the machine ran short for,
 * the launcher drew the refusal's sentence AND *"Could not check this profile’s sign-in"* with the
 * same shortage as its reason — one fact, said twice.
 *
 * ⚑ **In the DOM project because it is a TRANSITION** (`the-bridge-that-clones-nothing.dom.test.ts`'
 * reason): the check runs on a falling edge of `busy` with an `error`, which SSR renders once and
 * cannot reach. ⚑ The host moves the three facts the screen hands the launcher — `busy`, `error`
 * and `refusedAs` (`store.isLaunching()`, `store.launchError`, `store.launchRefusal`) — in ONE
 * block, the order `forLaunch` writes them in; and `checkProviderAuth` COUNTS, because *"not asked"*
 * is the claim.
 *
 * | § | the refusal's word | the check | the panel |
 * |---|---|---|---|
 * | 1 | 🔴 `program` · `folder` · `machine` · `launch` | not asked | not drawn — the refusal's box alone |
 * | 1 | ⚑ `sign-in` | asked once | drawn — its buttons are the fix |
 * | 1 | ⚑ `null`, and the prop absent | asked once | drawn — the only diagnosis there is |
 * | 2 | 🔴 `machine`, after an earlier *could not check* | not asked again | dropped — `710` F-7's second box |
 * | 2 | ⚑ `machine`, after an earlier *not signed in* / *expired* | asked again, as `main` did | the provider's answer — the refusal proves it neither true nor false (review) |
 * | 2 | 🔴 `machine`, after an earlier *expired*, asked again and answered *could not check* | asked again | dropped, not a second box |
 * | 2 | 🔴 `machine`, after an earlier *usable* (nothing drawn) | not asked again | nothing — the check `716` F-1 skips (review, round three) |
 * | 2 | ⚑ `machine`, while a person's *Check again* runs | — | kept — its *Checking…* stays up |
 * | 2 | 🔴 `machine`, while an AUTOMATIC check runs, and its answer is *could not check* | — | not drawn — and what was up goes with it |
 * | 2 | ⚑ `machine`, while an automatic check runs, and its answer is *expired* | — | drawn — the provider's answer about the credential |
 * | 2 | ⚑ then a `sign-in` or no word, while that check runs | — | its answer is drawn — the check is that failure's remedy / diagnosis |
 * | 3 | `theCheckCanSayMore` over every word main has, and `null`/`undefined` | | |
 *
 * ⚠️ **`theCheckCanSayMore` is read through the module's namespace** (`since725`): the browser runner
 * links native modules, and a named import `main` cannot satisfy would fail the whole file there —
 * the controls with it. ⚠️ On `main` the launcher has no `refusedAs` prop, so the host's word falls
 * through as an attribute and the check runs as it always did.
 */

afterEach(unmountAll)

/** ⚑ `NewConversation`'s module exports — `theCheckCanSayMore` is `undefined` on `main`. */
const { theCheckCanSayMore } = since725

/** What main's check answers — the shapes `SignInPanel` draws (`usable` draws nothing). */
type AuthAnswer =
  | { readonly state: 'usable' }
  | { readonly state: 'stale' | 'absent' | 'unknown'; readonly reason: string }

/** ⚑ The check's own words after a shortage (`a-person-whose-machine-ran-short.test.ts`, `710`). */
const COULD_NOT_CHECK: AuthAnswer = {
  state: 'unknown',
  reason:
    'This machine ran short of open files, processes or memory, so Codex could not be started to ask about this profile’s sign-in.',
}
const NOT_SIGNED_IN: AuthAnswer = {
  state: 'absent',
  reason: 'This profile has never been signed in.',
}
const EXPIRED: AuthAnswer = { state: 'stale', reason: 'The refresh token was rejected.' }

/** ⚑ What main says for each word — `session-unavailable.ts`' sentences where one exists. */
const SAID: Readonly<Record<LaunchRefusal, string>> = {
  'sign-in': 'Codex is not signed in on this profile.',
  program: 'Codex isn’t available on this machine, so this conversation did not open.',
  folder: 'This conversation did not open: BroBot2 could not make its folder.',
  machine:
    'This conversation did not open: this machine ran short of open files, processes or memory as its agent was starting. Close an app or a conversation you are not using, then start it again.',
  cancelled:
    'This conversation was stopped before it opened. Start it again whenever you are ready.',
  launch:
    "This conversation's agent did not answer within 15s, so BroBot2 stopped waiting and shut it down. No conversation was made: start it again. If it keeps not answering, its provider is not responding on this machine.",
}
/** ⚑ A failure main has no word for — what `the-bridge-that-clones-nothing.dom.test.ts` fails with. */
const UNWORDED = 'codex exited before it started: no such file or directory (cwd)'

const settled = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
  }
}

/**
 * ⚑ **The launcher behind a host whose `busy`, `error` and `refusedAs` move** — `718`'s `theSheet()`
 * shape, over the launcher's own props (`the-bridge-that-clones-nothing.dom.test.ts`' frame).
 * `answers` are what `checkProviderAuth` says, in order; a `null` entry is a check that has not
 * answered yet, released by `release()`.
 */
function theLauncher(answers: readonly (AuthAnswer | null)[]) {
  const busy = ref(false)
  const error = ref<string | null>(null)
  /** ⚑ `undefined` is the prop LEFT OUT — a mount that hands no word at all. */
  const refusedAs = ref<LaunchRefusal | null | undefined>(undefined)
  const words = ref('Plan the migration.')
  const book = createAttachmentBook()
  const checks: unknown[] = []
  const waiting: ((answer: AuthAnswer) => void)[] = []
  ;(window as unknown as { api: unknown }).api = {
    runtime: {
      checkProviderAuth: (asked: unknown) => {
        const answer = answers[Math.min(checks.length, answers.length - 1)] ?? null
        checks.push(asked)
        return answer === null
          ? new Promise<AuthAnswer>((done) => waiting.push(done))
          : Promise.resolve(answer)
      },
    },
  }
  const Host = defineComponent({
    name: 'LauncherHost',
    setup() {
      return () =>
        h(NewConversation as Component, {
          busy: busy.value,
          error: error.value,
          ...(refusedAs.value === undefined ? {} : { refusedAs: refusedAs.value }),
          debug: false,
          draft: words.value,
          handing: book.handing(NEW_CONVERSATION),
          defaultProvider: 'codex',
          defaultApprovalMode: 'ask',
          models: null,
          choices: NO_LAUNCH_CHOICES,
          capabilities: allProviderCapabilities(),
          'onUpdate:draft': (text: string) => (words.value = text),
          // ⚑ The launch this surface starts — which is what marks the failure as ITS failure.
          onStart: () => (busy.value = true),
        })
    },
  })
  const m = mount(Host, {}, { width: 1200, height: 900 })

  /**
   * ⚑ **Send, then main refuses it** — the word, the sentence and the flag in ONE block, the order
   * `forLaunch` writes them in (`launchRefusal`, then `launchError`, then `inFlight` in `finally`).
   */
  const refusedWith = async (word: LaunchRefusal | null | undefined, said: string) => {
    words.value = 'Plan the migration.'
    await nextTick()
    m.q('send-prompt').click()
    await settled()
    // ⚑ The premise: THIS surface started the launch that is about to be refused.
    expect(busy.value).toBe(true)
    refusedAs.value = word
    error.value = said
    busy.value = false
    await settled()
  }
  const release = async (answer: AuthAnswer): Promise<void> => {
    waiting.shift()?.(answer)
    await settled()
  }
  return { m, checks, refusedWith, release }
}

const panelOf = (m: Mounted): HTMLElement | null =>
  m.host.querySelector<HTMLElement>('[data-cy="sign-in-panel"]')
const headingOf = (m: Mounted): string =>
  (m.host.querySelector('[data-cy="sign-in-heading"]')?.textContent ?? '').trim()

/* ================================================================ §1 · one refusal */

describe('§1 · `716` F-1 — after a refusal that said why, the launcher does not ask the provider', () => {
  /**
   * 🔴 **The subject — RED on `main`**, which asked after every failed start whatever the refusal
   * was: one `checkProviderAuth`, and *"Could not check this profile’s sign-in"* under the sentence.
   */
  it('🔴 `program`, `folder`, `machine`, `launch`: the refusal’s own box, no check asked, no sign-in panel', async () => {
    for (const word of ['program', 'folder', 'machine', 'launch'] as const) {
      const { m, checks, refusedWith } = theLauncher([COULD_NOT_CHECK])
      await refusedWith(word, SAID[word])
      // ⚑ The positive the negatives stand beside: the refusal IS drawn, in main's words.
      expect(visible(m.q('launch-blocked')), word).toBe(true)
      expect(m.q('command-error').textContent?.trim(), word).toBe(SAID[word])
      // 🔴 …and it is the only box: nothing was asked, nothing said twice.
      expect(checks, word).toEqual([])
      expect(panelOf(m), word).toBeNull()
      unmountAll()
    }
  })

  /** ⚑ **THE CONTROL — green on `main`**: the one word whose panel is the fix. */
  it('⚑ `sign-in`: the check is asked once and its panel is drawn — its buttons are the fix', async () => {
    const { m, checks, refusedWith } = theLauncher([EXPIRED])
    await refusedWith('sign-in', SAID['sign-in'])
    expect(checks).toEqual([{ provider: 'codex', profileId: DEFAULT_PROFILE_ID }])
    expect(visible(m.q('sign-in-panel'))).toBe(true)
    expect(headingOf(m)).toBe('This profile’s sign-in has expired')
    expect(m.q('command-error').textContent?.trim()).toBe(SAID['sign-in'])
  })

  /**
   * ⚑ **THE CONTROLS — green on `main`**: a refusal main gave no word for, handed as `null` (the
   * store's) and with the prop LEFT OUT (every mount that predates `725`) — the check is the only
   * diagnosis there is, and it runs.
   */
  it('⚑ no word — `null`, and the prop left out — the check is asked once and its panel drawn', async () => {
    for (const word of [null, undefined] as const) {
      const { m, checks, refusedWith } = theLauncher([COULD_NOT_CHECK])
      await refusedWith(word, UNWORDED)
      const name = String(word)
      expect(checks, name).toHaveLength(1)
      expect(visible(m.q('sign-in-panel')), name).toBe(true)
      expect(headingOf(m), name).toBe('Could not check this profile’s sign-in')
      expect(m.q('command-error').textContent?.trim(), name).toBe(UNWORDED)
      unmountAll()
    }
  })
})

/* ================================================================ §2 · a refusal after another */

describe('§2 · what an EARLIER check left on the screen, when a later refusal said why', () => {
  /**
   * 🔴 **RED on `main`** — a first start failed with no word, the check could not check; a second
   * start is refused for a shortage. `main` asks again and draws *could not check* a second time
   * under the shortage's sentence; here the stale box goes, while nothing is in flight.
   */
  it('🔴 an earlier *could not check* is dropped by a later `machine` refusal — and not asked again', async () => {
    const { m, checks, refusedWith } = theLauncher([COULD_NOT_CHECK])
    await refusedWith(null, UNWORDED)
    // ⚑ The premise: the first failure's check ran and its box is up.
    expect(checks).toHaveLength(1)
    expect(headingOf(m)).toBe('Could not check this profile’s sign-in')

    await refusedWith('machine', SAID.machine)
    expect(checks).toHaveLength(1)
    expect(panelOf(m)).toBeNull()
    expect(m.q('command-error').textContent?.trim()).toBe(SAID.machine)
  })

  /**
   * ⚑ **THE CONTROL, one fact over — green on `main`** (725 review, round two): the earlier answer
   * was *not signed in* or *expired*. For Codex a refusal that said why proves nothing about it (its
   * expiry is asked only once its child is up, which a shortage at the spawn never reached); for
   * Claude a refusal past the spawn means the sign-in passed — either way the provider's own answer
   * keeps or clears it, so it is ASKED AGAIN, as `main` asked after every failure, and drawn.
   */
  it('⚑ an earlier *not signed in* or *expired* is asked again after a `machine` refusal, and kept as the provider answers it', async () => {
    for (const [answer, heading] of [
      [NOT_SIGNED_IN, 'This profile is not signed in'],
      [EXPIRED, 'This profile’s sign-in has expired'],
    ] as const) {
      const { m, checks, refusedWith } = theLauncher([answer])
      await refusedWith(null, UNWORDED)
      expect(headingOf(m), heading).toBe(heading)

      await refusedWith('machine', SAID.machine)
      expect(checks, heading).toHaveLength(2)
      expect(headingOf(m), heading).toBe(heading)
      expect(m.q('command-error').textContent?.trim(), heading).toBe(SAID.machine)
      unmountAll()
    }
  })

  /**
   * 🔴 **RED on `main`** — the same re-ask, and this time the provider could not be asked either
   * (the shortage the refusal named). `main` drew *could not check* under the shortage's sentence;
   * here nothing is drawn: the refusal already said it.
   */
  it('🔴 an earlier *expired*, asked again and answered *could not check*, is not drawn as a second box', async () => {
    const { m, checks, refusedWith } = theLauncher([EXPIRED, COULD_NOT_CHECK])
    await refusedWith(null, UNWORDED)
    expect(headingOf(m)).toBe('This profile’s sign-in has expired')

    await refusedWith('machine', SAID.machine)
    expect(checks).toHaveLength(2)
    expect(panelOf(m)).toBeNull()
    expect(m.q('command-error').textContent?.trim()).toBe(SAID.machine)
  })

  /**
   * 🔴 **725 review, round three — RED on `main`**, which asked after every failure: the earlier
   * answer was *usable*, which draws nothing. Nothing is up to ask again about, so a refusal that
   * said why spends no check — the one `716` F-1 skips.
   */
  it('🔴 an earlier *usable* (nothing drawn) is not asked again after a `machine` refusal', async () => {
    const { m, checks, refusedWith } = theLauncher([{ state: 'usable' }])
    await refusedWith(null, UNWORDED)
    // ⚑ The premise: the first failure's check ran, and a usable answer draws no panel.
    expect(checks).toHaveLength(1)
    expect(panelOf(m)).toBeNull()

    await refusedWith('machine', SAID.machine)
    expect(checks).toHaveLength(1)
    expect(panelOf(m)).toBeNull()
    expect(m.q('command-error').textContent?.trim()).toBe(SAID.machine)
  })

  /**
   * ⚑ **THE CONTROL on the guard — green on `main`**: a person pressed *Check again* and it is still
   * running when the refusal lands. The panel holds the gesture in flight, so it is not taken off the
   * screen under it (the provider watch's rule, `NewConversation.vue`).
   */
  it('⚑ a *Check again* still running keeps its panel through a later `machine` refusal', async () => {
    const { m, checks, refusedWith, release } = theLauncher([COULD_NOT_CHECK, null])
    await refusedWith(null, UNWORDED)
    expect(headingOf(m)).toBe('Could not check this profile’s sign-in')
    m.q('sign-in-check').click()
    await settled()
    // ⚑ The premise: the person's check is in flight, and the panel says so.
    expect(checks).toHaveLength(2)
    expect(m.q('sign-in-check').textContent?.trim()).toBe('Checking…')

    await refusedWith('machine', SAID.machine)
    expect(visible(m.q('sign-in-panel'))).toBe(true)
    expect(headingOf(m)).toBe('Could not check this profile’s sign-in')
    expect(checks).toHaveLength(2)
    // ⚑ …and when it answers, the answer is drawn where the person asked for it.
    await release(NOT_SIGNED_IN)
    expect(headingOf(m)).toBe('This profile is not signed in')
  })

  /**
   * ⚑ **THE CONTROL on whose check it is — green on `main`**: after a refusal that said why, a
   * person's own *Check again* is drawn whatever it answers — even *could not check*: they asked.
   */
  it('⚑ a person’s *Check again* after a `machine` refusal is drawn, even when it could not check', async () => {
    const { m, checks, refusedWith } = theLauncher([NOT_SIGNED_IN, NOT_SIGNED_IN, COULD_NOT_CHECK])
    await refusedWith(null, UNWORDED)
    await refusedWith('machine', SAID.machine)
    // ⚑ The premise: the earlier panel was asked again and kept.
    expect(checks).toHaveLength(2)
    expect(headingOf(m)).toBe('This profile is not signed in')
    m.q('sign-in-check').click()
    await settled()
    expect(checks).toHaveLength(3)
    expect(headingOf(m)).toBe('Could not check this profile’s sign-in')
  })

  /**
   * 🔴 **725 review — RED on `main`**: the AUTOMATIC check an earlier, unworded failure started is
   * still running when a later start is refused for a shortage, and it answers *could not check*.
   * Drawn under the shortage's sentence it is `710` F-7's second box again.
   */
  it('🔴 an automatic check still running answers *could not check* after a `machine` refusal: nothing is drawn', async () => {
    const { m, checks, refusedWith, release } = theLauncher([null])
    await refusedWith(null, UNWORDED)
    // ⚑ The premise: the automatic check is in flight, and nothing is drawn for it yet.
    expect(checks).toHaveLength(1)
    expect(panelOf(m)).toBeNull()

    await refusedWith('machine', SAID.machine)
    await release(COULD_NOT_CHECK)
    expect(panelOf(m)).toBeNull()
    expect(m.q('command-error').textContent?.trim()).toBe(SAID.machine)
    expect(checks).toHaveLength(1)
  })

  /**
   * 🔴 **RED on `main`** (review, round two): a panel was already UP when that check began — its
   * *could not check* answer takes the old box down with it, rather than leaving it under the
   * shortage's sentence.
   */
  it('🔴 …and the box an earlier check left up goes with it', async () => {
    const { m, checks, refusedWith, release } = theLauncher([COULD_NOT_CHECK, null])
    await refusedWith(null, UNWORDED)
    expect(headingOf(m)).toBe('Could not check this profile’s sign-in')
    await refusedWith(null, UNWORDED)
    // ⚑ The premise: a second automatic check is in flight, under the first one's box.
    expect(checks).toHaveLength(2)

    await refusedWith('machine', SAID.machine)
    await release(COULD_NOT_CHECK)
    expect(panelOf(m)).toBeNull()
  })

  /**
   * ⚑ **THE CONTROL, one fact over — green on `main`**: the same late answer is *expired* — the
   * provider's answer about the credential, true whichever failure asked it. It is drawn.
   */
  it('⚑ the same late check answering *expired* after a `machine` refusal is drawn', async () => {
    const { m, refusedWith, release } = theLauncher([null])
    await refusedWith(null, UNWORDED)
    await refusedWith('machine', SAID.machine)
    await release(EXPIRED)
    expect(visible(m.q('sign-in-panel'))).toBe(true)
    expect(headingOf(m)).toBe('This profile’s sign-in has expired')
  })

  /**
   * ⚑ **THE CONTROLS — green on `main`**: the LATEST failure decides, not any before it (review,
   * round two). After the `machine` refusal comes one with no word, or a `sign-in` — the check is
   * then that failure's only diagnosis, or its remedy — and the late *could not check* is drawn.
   */
  it('⚑ the same late *could not check* is drawn when the latest failure has no word, or is `sign-in`', async () => {
    for (const latest of [null, 'sign-in'] as const) {
      const { m, refusedWith, release } = theLauncher([null])
      await refusedWith(null, UNWORDED)
      await refusedWith('machine', SAID.machine)
      await refusedWith(latest, latest === null ? UNWORDED : SAID['sign-in'])
      await release(COULD_NOT_CHECK)
      const name = String(latest)
      expect(visible(m.q('sign-in-panel')), name).toBe(true)
      expect(headingOf(m), name).toBe('Could not check this profile’s sign-in')
      unmountAll()
    }
  })

  /**
   * ⚑ **THE CONTROL — green on `main`**: a later failure with no word, while the first check runs —
   * the late answer lands and is drawn, as it always was.
   */
  it('⚑ the same late answer, after a later failure with no word, is drawn', async () => {
    const { m, checks, refusedWith, release } = theLauncher([null])
    await refusedWith(null, UNWORDED)
    expect(checks).toHaveLength(1)

    await refusedWith(null, UNWORDED)
    await release(COULD_NOT_CHECK)
    expect(visible(m.q('sign-in-panel'))).toBe(true)
    expect(headingOf(m)).toBe('Could not check this profile’s sign-in')
  })
})

/* ================================================================ §3 · the rule, over every word */

describe('§3 · `theCheckCanSayMore` — main’s table read as it is written, word by word', () => {
  /**
   * ⚑ **Over EVERY word main has** — so a seventh word in `LAUNCH_REFUSALS` adds a key this table
   * does not have, and reddens here until someone decides what the check says after it.
   */
  it('🔴 only `sign-in` — and no word at all — leaves the check something to say', () => {
    const table = Object.fromEntries(
      LAUNCH_REFUSALS.map((word) => [word, theCheckCanSayMore(word)]),
    )
    expect(table).toEqual({
      'sign-in': true,
      program: false,
      folder: false,
      machine: false,
      cancelled: false,
      launch: false,
    })
    expect(theCheckCanSayMore(null)).toBe(true)
    expect(theCheckCanSayMore(undefined)).toBe(true)
  })
})
