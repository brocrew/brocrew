import { afterEach, describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, reactive } from 'vue'
import KeptRules from '../../src/renderer/src/components/KeptRules.vue'
import ProviderCard from '../../src/renderer/src/components/ProviderCard.vue'
import { createModelLists } from '../../src/renderer/src/lib/model-lists'
import { PROVIDER_PARTS, type ProviderPart } from '../../src/renderer/src/lib/provider-parts'
import { providersBridge } from '../../look/fixtures/providers'
import { CAPABILITY_FIXTURE } from '../provider-capability-fixture'
import { mount, unmountAll, type Mounted } from './harness'

/**
 * A part of the Providers screen a person folded opens itself when it has something new to say: an
 * operation's refusal that arrives after the fold, or a warning that arrives while it is folded.
 * Words already seen stay folded if the person folds them again, and a quiet answer stays folded.
 * Fictional data and fictional refusals only: no provider, account or key is anybody's.
 */

const NOW = Date.now()
const HOUR = 3_600_000
const KEPT_KEY = 'brobot2.providers.open.kept-rules'

afterEach(() => {
  unmountAll()
  localStorage.removeItem(KEPT_KEY)
  Reflect.deleteProperty(window, 'api')
})

/** A promise the test settles by hand, for an answer that arrives after a fold. */
function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((done) => setTimeout(done, 0))
    await nextTick()
  }
}

const runtime = (): Record<string, unknown> =>
  (window.api as unknown as { runtime: Record<string, unknown> }).runtime

/**
 * One card under a parent that keeps the open state as the screen does: a press on a heading
 * toggles it, and a reveal opens it.
 */
async function card(over: Record<string, unknown> = {}) {
  const versions = await (runtime()['providerVersions'] as () => Promise<Record<string, unknown>>)()
  const open = reactive(
    Object.fromEntries(PROVIDER_PARTS.map((part) => [part, true])) as Record<ProviderPart, boolean>,
  )
  const state = reactive<Record<string, unknown>>({
    limitsRead: true,
    readings: [],
    resources: null,
    resourcesPaused: false,
    resourcesError: null,
    version: versions['claude'],
    ...over,
  })
  const revealed: ProviderPart[] = []
  // ⚑ A list holder of the card's own, so each test's fictional model list is the one read.
  const lists = createModelLists(() => window.api.runtime as never)
  const Parent = defineComponent({
    setup: () => () =>
      h(ProviderCard as never, {
        provider: 'claude',
        capabilities: CAPABILITY_FIXTURE,
        limit: null,
        clock: NOW,
        loginMoved: 0,
        lists,
        ...state,
        open: { ...open },
        onToggle: (part: ProviderPart) => (open[part] = !open[part]),
        onReveal: (part: ProviderPart) => {
          revealed.push(part)
          open[part] = true
        },
      }),
  })
  const m = mount(Parent, {}, { width: 560, height: 1600 })
  await settle()
  return { m, open, state, revealed }
}

const CY: Readonly<Record<ProviderPart, string>> = {
  login: 'provider-status',
  key: 'provider-key',
  version: 'provider-version',
  usage: 'provider-usage',
  resources: 'provider-resources',
  models: 'provider-models',
}

function fold(m: Mounted, part: ProviderPart): void {
  m.q(CY[part]).querySelector<HTMLButtonElement>('h3 button.fold')!.click()
}

/** Whether the part's body is drawn. */
function shown(m: Mounted, part: ProviderPart): boolean {
  const press = m.q(CY[part]).querySelector('h3 button.fold')!
  const body = document.getElementById(press.getAttribute('aria-controls') ?? '')!
  return getComputedStyle(body).display !== 'none'
}

/* ------------------------------------------------------------------ Models */

describe('Models: a refused add or removal that answers after the fold opens it', () => {
  async function adding(answer: Promise<unknown>) {
    providersBridge()
    runtime()['addHandAddedModel'] = () => answer
    const made = await card()
    made.m.q('provider-model-add-open').click()
    await nextTick()
    const field = made.m.q('provider-model-add-name') as HTMLInputElement
    field.value = 'claude-fictional-9'
    field.dispatchEvent(new Event('input'))
    await nextTick()
    field.form!.requestSubmit()
    await nextTick()
    fold(made.m, 'models')
    await nextTick()
    // ⚑ The premise: folded while the add is still out.
    expect(made.open.models).toBe(false)
    expect(shown(made.m, 'models')).toBe(false)
    return made
  }

  it('🔴 a refused add, after the fold, opens Models and shows the refusal', async () => {
    const answer = deferred<unknown>()
    const { m, open, revealed } = await adding(answer.promise)
    answer.reject(new Error('This fictional model was refused.'))
    await settle()
    expect(revealed).toContain('models')
    expect(open.models).toBe(true)
    expect(shown(m, 'models')).toBe(true)
    expect(m.q('provider-models').textContent).toContain('This fictional model was refused.')
  })

  it('⚑ …and an add that succeeds while folded stays folded', async () => {
    const answer = deferred<unknown>()
    const { m, open, revealed } = await adding(answer.promise)
    answer.resolve({ ok: true })
    await settle()
    expect(revealed).not.toContain('models')
    expect(open.models).toBe(false)
    expect(shown(m, 'models')).toBe(false)
  })

  it('🔴 a refused removal, after the fold, opens Models and shows the refusal', async () => {
    providersBridge()
    const listed = runtime()['modelList'] as (asked: unknown) => Promise<Record<string, unknown>>
    runtime()['modelList'] = async (asked: unknown) => {
      const list = await listed(asked)
      const models = list['models'] as Record<string, unknown>[]
      return {
        ...list,
        models: [
          ...models,
          { id: 'claude-mine', label: 'claude-mine', efforts: [], addedBy: 'a-person' },
        ],
      }
    }
    const answer = deferred<unknown>()
    runtime()['deleteHandAddedModel'] = () => answer.promise
    const { m, open, revealed } = await card()
    m.q('provider-model-delete').click()
    await nextTick()
    fold(m, 'models')
    await nextTick()
    expect(open.models).toBe(false)
    answer.reject(new Error('This fictional removal was refused.'))
    await settle()
    expect(revealed).toContain('models')
    expect(shown(m, 'models')).toBe(true)
    expect(m.q('provider-models').textContent).toContain('This fictional removal was refused.')
  })

  it('⛔ the same refusal twice is news twice', async () => {
    const first = deferred<unknown>()
    const { m, open, revealed } = await adding(first.promise)
    first.reject(new Error('Refused again and again.'))
    await settle()
    expect(revealed.filter((part) => part === 'models')).toHaveLength(1)
    const second = deferred<unknown>()
    runtime()['addHandAddedModel'] = () => second.promise
    const field = m.q('provider-model-add-name') as HTMLInputElement
    field.form!.requestSubmit()
    await nextTick()
    fold(m, 'models')
    await nextTick()
    expect(open.models).toBe(false)
    second.reject(new Error('Refused again and again.'))
    await settle()
    expect(revealed.filter((part) => part === 'models')).toHaveLength(2)
    expect(open.models).toBe(true)
  })
})

/* ------------------------------------------------------------------ the other parts */

describe('every other part opens for what it has to say', () => {
  it('🔴 API key: a refused save after the fold opens it; a save that lands stays folded', async () => {
    for (const refused of [true, false]) {
      providersBridge()
      const answer = deferred<unknown>()
      runtime()['setApiKey'] = () => answer.promise
      const { m, open, revealed } = await card()
      const field = m.q('provider-key-input') as HTMLInputElement
      field.value = 'fictional-key-123'
      field.dispatchEvent(new Event('input'))
      await nextTick()
      field.form!.requestSubmit()
      await nextTick()
      fold(m, 'key')
      await nextTick()
      expect(open.key).toBe(false)
      answer.resolve({
        provider: 'claude',
        set: !refused,
        setAt: refused ? null : NOW,
        inUse: !refused,
        ...(refused ? { refused: 'This fictional key was refused.' } : {}),
      })
      await settle()
      expect(open.key, `refused: ${String(refused)}`).toBe(refused)
      expect(revealed.includes('key')).toBe(refused)
      if (refused) expect(m.q('provider-key-said').textContent).toContain('wasn’t saved')
      unmountAll()
    }
  })

  /** A sign-in from a signed-out card, folded while it is out, answered by `result`. */
  async function signingIn(result: Record<string, unknown>) {
    providersBridge(true)
    const answer = deferred<unknown>()
    runtime()['signInProvider'] = () => answer.promise
    const made = await card()
    made.m.q('sign-in-start').click()
    await nextTick()
    // ⚑ The progress notice ("Finish signing in…") is there, and opened nothing: Login was open.
    fold(made.m, 'login')
    await nextTick()
    expect(made.open.login).toBe(false)
    answer.resolve(result)
    await settle()
    return made
  }

  it('🔴 Login: a sign-in that fails after the fold opens it with its words', async () => {
    const { m, open, revealed } = await signingIn({
      success: false,
      state: { state: 'absent', reason: 'No login on this fictional Mac.', why: 'no-login' },
      detail: 'The fictional sign-in did not complete.',
    })
    expect(revealed).toContain('login')
    expect(open.login).toBe(true)
    expect(shown(m, 'login')).toBe(true)
    expect(m.q('provider-status').textContent).toContain('The fictional sign-in did not complete.')
  })

  it('⛔ Login: a sign-in that lands after the fold says so quietly, and stays folded', async () => {
    const { m, open, revealed } = await signingIn({
      success: true,
      state: { state: 'usable', login: 'account', expiresAt: null },
      detail: null,
    })
    expect(revealed).not.toContain('login')
    expect(open.login).toBe(false)
    expect(shown(m, 'login')).toBe(false)
    // ⚑ The notice is there, folded with its part.
    expect(m.q('provider-status').textContent).toContain('Signed in to Claude.')
  })

  it('🔴 Usage: a warning that arrives while it is folded opens it', async () => {
    providersBridge()
    const { m, open, state, revealed } = await card()
    fold(m, 'usage')
    await nextTick()
    state['limitsRead'] = false
    await settle()
    expect(revealed).toContain('usage')
    expect(open.usage).toBe(true)
    expect(m.q('provider-usage-says').textContent).toContain('couldn’t read usage warnings')
  })

  it('⛔ Usage: a window running ahead of its time is a pace note, and leaves the fold as it is', async () => {
    providersBridge()
    const { m, open, state, revealed } = await card()
    fold(m, 'usage')
    await nextTick()
    state['readings'] = [
      { window: 'five_hour', usedPercent: 90, resetsAt: NOW + 4.5 * HOUR, at: NOW - 60_000 },
    ]
    await settle()
    expect(revealed).not.toContain('usage')
    expect(open.usage).toBe(false)
    // ⚑ The control: the note is really there, folded with its part.
    expect(m.all('provider-usage-ahead')).toHaveLength(1)
  })

  it('🔴 Running now: a sample that could not be measured opens it', async () => {
    providersBridge()
    const { m, open, state, revealed } = await card()
    fold(m, 'resources')
    await nextTick()
    state['resourcesError'] = 'The fictional sample failed.'
    await settle()
    expect(revealed).toContain('resources')
    expect(open.resources).toBe(true)
    expect(m.q('provider-resources-says').textContent).toContain('The fictional sample failed.')
  })

  it('🔴 Version: a standing that warns, arriving while folded, opens it', async () => {
    providersBridge()
    const { m, open, state, revealed } = await card()
    fold(m, 'version')
    await nextTick()
    const version = state['version'] as { program: Record<string, unknown> }
    state['version'] = {
      ...version,
      program: { ...version.program, standing: 'older-than-tested' },
    }
    await settle()
    expect(revealed).toContain('version')
    expect(open.version).toBe(true)
  })

  it('⛔ a warning already seen stays folded when folded again, while another part speaks', async () => {
    providersBridge()
    const { m, open, state } = await card({ limitsRead: false })
    fold(m, 'usage')
    await nextTick()
    expect(open.usage).toBe(false)
    state['resourcesError'] = 'Something else entirely.'
    await settle()
    expect(open.resources).toBe(true)
    expect(open.usage, 'the seen usage warning opened again').toBe(false)
  })
})

/* ------------------------------------------------------------------ Kept rules */

describe('Kept rules: a refusal or a failed read opens it', () => {
  const RULE = {
    claude: [
      {
        file: '/fictional/project/.claude/settings.local.json',
        rules: [
          {
            kept: 'Bash(npm run test:*)',
            rule: { kind: 'tool', tool: 'Bash', content: 'npm run test:*' },
          },
        ],
      },
    ],
    codex: [],
  }

  async function kept(remove: () => Promise<unknown>, reads: Array<() => Promise<unknown>>) {
    providersBridge()
    let read = 0
    runtime()['keptRules'] = () => reads[Math.min(read++, reads.length - 1)]!()
    runtime()['removeKeptRule'] = remove
    const m = mount(KeptRules, { providers: ['claude', 'codex'] }, { width: 900, height: 600 })
    await settle()
    return m
  }

  const press = (m: Mounted): HTMLElement => m.q('kept-rules-fold')

  it('🔴 a removal refused after the fold opens it and shows the refusal', async () => {
    const answer = deferred<unknown>()
    const m = await kept(() => answer.promise, [async () => RULE])
    m.q('kept-rule-remove').click()
    await nextTick()
    press(m).click()
    await nextTick()
    expect(press(m).getAttribute('aria-expanded')).toBe('false')
    answer.resolve({ removed: false, why: 'This fictional rule is no longer in that file.' })
    await settle()
    expect(press(m).getAttribute('aria-expanded')).toBe('true')
    expect(m.q('kept-rules-refused').textContent).toContain('no longer in that file')
  })

  it('🔴 a read that fails while folded opens it', async () => {
    const answer = deferred<unknown>()
    const m = await kept(
      () => answer.promise,
      [async () => RULE, () => Promise.reject(new Error('The fictional read failed.'))],
    )
    m.q('kept-rule-remove').click()
    await nextTick()
    press(m).click()
    await nextTick()
    expect(press(m).getAttribute('aria-expanded')).toBe('false')
    answer.resolve({ removed: true })
    await settle()
    expect(press(m).getAttribute('aria-expanded')).toBe('true')
    expect(m.q('kept-rules-unread').textContent).toContain('The fictional read failed.')
  })

  it('⚑ a removal that lands while folded stays folded', async () => {
    const answer = deferred<unknown>()
    const m = await kept(
      () => answer.promise,
      [async () => RULE, async () => ({ claude: [], codex: [] })],
    )
    m.q('kept-rule-remove').click()
    await nextTick()
    press(m).click()
    await nextTick()
    answer.resolve({ removed: true })
    await settle()
    expect(press(m).getAttribute('aria-expanded')).toBe('false')
  })
})
