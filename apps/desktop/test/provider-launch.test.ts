import { afterEach, describe, expect, it, vi } from 'vitest'
import { AuthUnavailableError, FakeRuntime, type AuthState } from '@brobot2/runtime'
import { DEFAULT_CONVERSATION_PROVIDER } from '@brobot2/shared'
import { modelSetupRequired } from '../src/main/runtime/launch-refusal'
import type { ModelList } from '../src/shared/model-choice-contracts'
import { providerLaunchChoices, resolveProviderLaunch } from '../src/main/runtime/provider-launch'
import { RuntimeHost, type RuntimeHostDeps } from '../src/main/runtime/runtime-host'
import { executeRuntimeCommand, runtimeCommandSchema } from '../src/main/runtime/ipc'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { neutralHostDeps, RecordingSink } from './lib/host-fixture'

const usable: AuthState = {
  state: 'usable',
  account: 'fern@example.invalid',
  login: 'account',
  expiresAt: null,
}
const unknown: AuthState = { state: 'unknown', reason: 'Fictional sign-in not read.' }
const list = (overrides: Partial<ModelList> = {}): ModelList => ({
  provider: 'codex',
  notAsked: null,
  standIn: null,
  lastPicked: null,
  startsOn: null,
  models: [
    { id: 'fern', label: 'Fern', isDefault: true, defaultEffort: 'low', addedBy: 'the-provider' },
  ],
  ...overrides,
})

describe('core provider launch choices', () => {
  it.each(['absent', 'stale'] as const)(
    'retains known %s auth even when models answered',
    (state) => {
      const answer = providerLaunchChoices(list(), { state, reason: 'Fictional sign-in.' })
      expect(answer.ready).toBe(false)
      expect(answer.defaultModel).toEqual({ model: 'fern', effort: 'low' })
    },
  )

  it('distinguishes empty success, unknown, closing and a typed setup failure without decoding prose', () => {
    expect(providerLaunchChoices(list({ models: [] }), unknown)).toMatchObject({
      ready: true,
      defaultModel: null,
      defaultModelToSend: null,
    })
    for (const notAsked of [
      { ok: false, reason: 'no-profile' },
      { ok: false, reason: 'closing' },
      { ok: false, reason: 'refused', detail: 'not signed in; spawn ENOENT; fictional raw words' },
    ] as const) {
      expect(providerLaunchChoices(list({ notAsked }), unknown).ready).toBeNull()
      expect(providerLaunchChoices(list({ notAsked }), usable).ready).toBe(true)
    }
    const refused = list({
      notAsked: {
        ok: false,
        reason: 'refused',
        detail: 'Fictional opaque refusal',
        setupRequired: true,
      },
    })
    expect(providerLaunchChoices(refused, usable).ready).toBe(false)
    expect(providerLaunchChoices(refused, unknown).list).toBe(refused)
  })

  it('preserves known missing-program priority over cached models and usable auth', () => {
    const cached = list()
    expect(providerLaunchChoices(cached, usable, { standing: 'missing' })).toMatchObject({
      ready: false,
      list: cached,
    })
    for (const program of [
      undefined,
      null,
      { standing: 'tested' },
      { standing: 'unreadable' },
    ] as const) {
      expect(providerLaunchChoices(cached, usable, program).ready).toBe(true)
      expect(
        providerLaunchChoices(
          list({ notAsked: { ok: false, reason: 'no-profile' } }),
          unknown,
          program,
        ).ready,
      ).toBeNull()
    }
    const resolved = resolveProviderLaunch(
      {
        askedProvider: 'codex',
        providers: [
          { provider: 'codex', ready: true, program: { standing: 'missing' } },
          { provider: 'claude', ready: true, program: null },
        ],
      },
      null,
    )
    expect(resolved).toEqual({
      provider: 'claude',
      pickerProvider: 'claude',
      readiness: [
        { provider: 'codex', ready: false },
        { provider: 'claude', ready: true },
      ],
    })
  })

  it('uses typed auth and program failures while retaining unrelated and slow diagnostics', () => {
    expect(
      modelSetupRequired(new AuthUnavailableError('codex', 'Fictional sign-in refusal')),
    ).toEqual({ setupRequired: true })
    const missing = Object.assign(new Error('Fictional native program'), {
      code: 'ENOENT',
      syscall: 'spawn fern',
    })
    expect(modelSetupRequired(missing)).toEqual({ setupRequired: true })
    expect(modelSetupRequired(new Error('not signed in; spawn ENOENT'))).toEqual({})
    const slow = list({
      notAsked: { ok: false, reason: 'refused', detail: 'Fictional timeout', tooSlow: true },
    })
    expect(providerLaunchChoices(slow, unknown)).toMatchObject({ ready: null, list: slow })
  })

  it('returns distinct display and omission decisions from the existing last pick and startsOn', () => {
    const start = { model: 'fern', effort: 'low', from: 'its-default' } as const
    expect(providerLaunchChoices(list({ startsOn: start }), unknown)).toMatchObject({
      defaultModel: { model: 'fern', effort: 'low' },
      defaultModelToSend: null,
    })
    const last = { model: 'willow', effort: 'high' }
    expect(
      providerLaunchChoices(list({ startsOn: start, lastPicked: last }), unknown),
    ).toMatchObject({
      defaultModel: last,
      defaultModelToSend: last,
    })
    expect(
      providerLaunchChoices(
        list({ startsOn: start, lastPicked: { model: ' FERN ', effort: 'low' } }),
        unknown,
      ).defaultModelToSend,
    ).toBeNull()
    expect(
      providerLaunchChoices(list({ models: [], startsOn: null, lastPicked: last }), unknown),
    ).toMatchObject({ defaultModel: last, defaultModelToSend: last })
  })

  it('separates root identity fallback from picker selection and retains supplied order', () => {
    const providers = [
      { provider: 'claude', ready: true },
      { provider: 'codex', ready: true },
    ] as const
    expect(resolveProviderLaunch({ askedProvider: null, providers }, 'codex')).toEqual({
      provider: 'codex',
      pickerProvider: 'claude',
      readiness: providers,
    })
    expect(resolveProviderLaunch({ askedProvider: 'codex', providers }, 'claude')).toEqual({
      provider: 'codex',
      pickerProvider: 'codex',
      readiness: providers,
    })
    expect(
      resolveProviderLaunch(
        {
          askedProvider: 'codex',
          providers: [
            { provider: 'codex', ready: null },
            { provider: 'claude', ready: true },
          ],
        },
        null,
      ),
    ).toEqual({
      provider: 'claude',
      pickerProvider: 'claude',
      readiness: [
        { provider: 'codex', ready: null },
        { provider: 'claude', ready: true },
      ],
    })
    expect(resolveProviderLaunch({ askedProvider: 'claude', providers: [] }, 'codex')).toEqual({
      provider: 'claude',
      pickerProvider: null,
      readiness: [],
    })
    expect(resolveProviderLaunch({ askedProvider: null, providers: [] }, null)).toEqual({
      provider: DEFAULT_CONVERSATION_PROVIDER,
      pickerProvider: null,
      readiness: [],
    })
  })
})

describe('the existing runtime transport supplies launch decisions', () => {
  let host: RuntimeHost | undefined
  afterEach(async () => {
    await host?.closeAll()
  })

  function fixture(overrides: Partial<RuntimeHostDeps> = {}): RuntimeHost {
    const forbidden = vi.fn((): never => {
      throw new Error('No native operation belongs to this fixture')
    })
    host = new RuntimeHost({
      ...neutralHostDeps(() => '/fictional/fern'),
      store: NULL_SESSION_STORE,
      createRuntime: forbidden,
      prepareProviderHome: forbidden,
      providerVersions: forbidden,
      programFound: { claude: forbidden },
      ...overrides,
    })
    return host
  }

  it('replaces one list read, preserves profile identity and never asks versions or manual auth', async () => {
    const host = fixture()
    const held = list({ standIn: 'brobot' })
    const modelRead = vi.spyOn(host, 'modelList').mockResolvedValue(held)
    const authRead = vi.spyOn(host, 'checkProviderAuth').mockResolvedValue(unknown)
    const command = runtimeCommandSchema.parse({
      kind: 'providerLaunchChoices',
      provider: 'codex',
      profileId: 'fern',
    })
    const answer = await executeRuntimeCommand(host, new RecordingSink('fern'), command)
    expect(answer).toEqual(providerLaunchChoices(held, unknown))
    expect(modelRead).toHaveBeenCalledExactlyOnceWith('codex', 'fern')
    expect(authRead).toHaveBeenCalledExactlyOnceWith('codex', 'fern')
    expect(host.sessionIds).toEqual([])
  })

  it('retains the model cache across concurrent choices and subsequent reads', async () => {
    const runtime = new FakeRuntime('codex')
    const listing = vi
      .spyOn(runtime, 'listModels')
      .mockResolvedValue([{ id: 'fern', label: 'Fern', isDefault: true }])
    const host = fixture({
      createRuntime: () => runtime,
      prepareProviderHome: () => '/fictional/fern',
      listProfiles: () => ['fern'],
    })
    vi.spyOn(host, 'checkProviderAuth').mockResolvedValue(unknown)
    const answers = await Promise.all([
      host.providerLaunchChoices('codex', 'fern'),
      host.providerLaunchChoices('codex', 'fern'),
    ])
    expect(answers[0]).toEqual(answers[1])
    expect(answers[0]?.ready).toBe(true)
    await host.providerLaunchChoices('codex', 'fern')
    expect(listing).toHaveBeenCalledTimes(1)
  })

  it('carries typed setup failures from the original home-preparation catch', async () => {
    const host = fixture({
      listProfiles: () => ['fern'],
      prepareProviderHome: () => {
        throw new AuthUnavailableError('codex', 'Fictional home sign-in refusal')
      },
    })
    vi.spyOn(host, 'checkProviderAuth').mockResolvedValue(usable)
    const answer = await host.providerLaunchChoices('codex', 'fern')
    expect(answer.ready).toBe(false)
    expect(answer.list.notAsked).toMatchObject({
      reason: 'refused',
      detail: 'Fictional home sign-in refusal',
      setupRequired: true,
    })
  })

  it('reads auth after a model read settles, retaining a sign-in change during that read', async () => {
    const host = fixture()
    let settle!: (answer: ModelList) => void
    vi.spyOn(host, 'modelList').mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve
        }),
    )
    const authRead = vi
      .spyOn(host, 'checkProviderAuth')
      .mockResolvedValue({ state: 'stale', reason: 'Fictional login changed during list read' })
    const pending = host.providerLaunchChoices('codex', 'fern')
    expect(authRead).not.toHaveBeenCalled()
    settle(list())
    expect((await pending).ready).toBe(false)
    expect(authRead).toHaveBeenCalledExactlyOnceWith('codex', 'fern')
  })

  it('carries the original explicit programme standing through the no-probe IPC decision', async () => {
    const host = fixture()
    const forbidden = (): never => {
      throw new Error('A programme observation must not trigger a probe')
    }
    vi.spyOn(host, 'modelList').mockImplementation(forbidden)
    vi.spyOn(host, 'checkProviderAuth').mockImplementation(forbidden)
    const command = runtimeCommandSchema.parse({
      kind: 'resolveProviderLaunch',
      askedProvider: 'codex',
      providers: [
        { provider: 'codex', ready: true, program: { standing: 'missing' } },
        { provider: 'claude', ready: true },
      ],
    })
    expect(await executeRuntimeCommand(host, new RecordingSink('fern'), command)).toEqual({
      provider: 'claude',
      pickerProvider: 'claude',
      readiness: [
        { provider: 'codex', ready: false },
        { provider: 'claude', ready: true },
      ],
    })
  })

  it('resolves a supplied snapshot with no list/auth/version/program read', async () => {
    const host = fixture()
    const forbidden = (): never => {
      throw new Error('Selection must not probe')
    }
    vi.spyOn(host, 'modelList').mockImplementation(forbidden)
    vi.spyOn(host, 'checkProviderAuth').mockImplementation(forbidden)
    const command = runtimeCommandSchema.parse({
      kind: 'resolveProviderLaunch',
      askedProvider: null,
      providers: [{ provider: 'claude', ready: true }],
    })
    expect(await executeRuntimeCommand(host, new RecordingSink('fern'), command)).toEqual({
      provider: 'claude',
      pickerProvider: 'claude',
      readiness: [{ provider: 'claude', ready: true }],
    })
    expect(host.sessionIds).toEqual([])
  })
})
