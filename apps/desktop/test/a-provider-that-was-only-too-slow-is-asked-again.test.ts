import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AuthUnavailableError,
  DidNotAnswerInTime,
  FakeRuntime,
  type ModelChoice,
  type ProviderRuntimeContext,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { NULL_SESSION_STORE } from '../src/main/db/session-store'
import { judgeAnAgentsChoice, refuseModel } from '../src/main/runtime/model-rails'
import { RuntimeHost } from '../src/main/runtime/runtime-host'
import { DEFAULT_PROFILE_ID, type ModelCatalogue } from '../src/shared/runtime-ipc'

/**
 * # A provider that was only too slow is asked again
 *
 * An agent that gives work is refused when the helper's provider cannot be asked which models it
 * offers. Most causes need a person: no sign-in, no program. One does not: the provider did not
 * answer in time. That one is its own word, priced so the same give is worth making again, and its
 * sentence says nobody has to change anything first.
 *
 * ⚑ Fictional models, a scratch folder and a stand-in runtime; nothing is launched.
 */

const A_LIST: ModelChoice[] = [{ id: 'gpt-fictional', label: 'GPT Fictional' }]

/** A provider whose model list answers, fails, or is too slow, as the test says. */
class ListDouble extends FakeRuntime {
  constructor(
    provider: Provider,
    private readonly answer: () => ModelChoice[] | Error,
  ) {
    super(provider)
  }
  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context)
    const answer = this.answer()
    if (answer instanceof Error) throw answer
    return answer
  }
}

describe('a provider that was only too slow is asked again', () => {
  let userData: string
  let host: RuntimeHost
  let lists: () => ModelChoice[] | Error
  /** What preparing a profile's home meets before any list is asked: nothing, or a failure. */
  let homes: () => Error | null

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-too-slow-'))
    lists = () => A_LIST
    homes = () => null
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    host = new RuntimeHost({
      store: NULL_SESSION_STORE,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (provider: Provider) => new ListDouble(provider, () => lists()),
      prepareProviderHome: (provider, profileId) => {
        const failed = homes()
        if (failed !== null) throw failed
        return join(userData, 'provider-homes', profileId, provider)
      },
      providerHomePath: (provider, profileId) =>
        join(userData, 'provider-homes', profileId, provider),
      resolveCwd: (sessionId) => join(userData, 'scratch', sessionId),
      newSessionId: () => 'sess_1',
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
        model: 'unused here',
        authNote: null,
        files: [],
      }),
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await host.closeAll()
    rmSync(userData, { recursive: true, force: true })
  })

  const tooSlow = (): Error =>
    new DidNotAnswerInTime('codex model/list did not answer within 15000ms')

  describe('§1 · the list a host reads says when its provider was only too slow', () => {
    it('🔴 a list that ran out of time is marked too slow; one that failed is not', async () => {
      lists = tooSlow
      const slow = await host.providerModels(DEFAULT_PROFILE_ID, 'codex')
      expect(slow).toMatchObject({ ok: false, reason: 'refused', tooSlow: true })

      // ⚑ The same read once the provider fails outright: asked again, and not marked.
      lists = () => new Error('codex app-server exited')
      const failed = await host.providerModels(DEFAULT_PROFILE_ID, 'codex')
      expect(failed).toEqual({ ok: false, reason: 'refused', detail: 'codex app-server exited' })

      // ⚑ …and once it answers.
      lists = () => A_LIST
      expect(await host.providerModels(DEFAULT_PROFILE_ID, 'codex')).toEqual({
        ok: true,
        models: A_LIST,
      })
    })

    it('🔴 a home that could not be made ready in time is marked too; one that failed is not', async () => {
      homes = () => new DidNotAnswerInTime('the home’s lock did not answer within 5000ms')
      expect(await host.providerModels(DEFAULT_PROFILE_ID, 'codex')).toMatchObject({
        ok: false,
        reason: 'refused',
        tooSlow: true,
      })
      homes = () => new AuthUnavailableError('codex', 'no sign-in here')
      expect(await host.providerModels(DEFAULT_PROFILE_ID, 'codex')).toEqual({
        ok: false,
        reason: 'refused',
        detail: 'no sign-in here',
      })
    })

    it('🔴 it is found under a failure that wraps the wait', async () => {
      lists = () => new Error('could not list the models', { cause: tooSlow() })
      expect(await host.providerModels(DEFAULT_PROFILE_ID, 'claude')).toMatchObject({
        ok: false,
        reason: 'refused',
        tooSlow: true,
      })
    })
  })

  describe('§2 · an agent whose give meets it is told to give again', () => {
    const unread = (catalogue: Exclude<ModelCatalogue, { ok: true }>) => ({
      rows: [],
      notAsked: catalogue,
    })
    const SLOW = { ok: false, reason: 'refused', detail: 'did not answer', tooSlow: true } as const
    const SIGNED_OUT = { ok: false, reason: 'refused', detail: 'not signed in' } as const

    it('🔴 a named model that could not be checked in time: its own word, and retrying can help', () => {
      const judged = judgeAnAgentsChoice(
        { model: 'gpt-fictional' },
        'codex',
        unread(SLOW),
        null,
        'give',
      )
      expect(judged).toMatchObject({
        ok: false,
        refusal: {
          rail: 'models-not-read-in-time',
          permanence: 'while-this-holds',
          retryable: true,
          remedy: 'make-the-same-call-when-this-settles',
          detail: { door: 'give', provider: 'codex', model: 'gpt-fictional' },
        },
      })
      const said = judged.ok ? '' : judged.refusal.reason
      expect(said).toBe(
        'Give again in a moment: Codex did not answer in time when asked which models it offers, so “gpt-fictional” could not be checked and nothing was given. Nobody has to change anything first.',
      )
      // ⛔ Never the sentence that sends a person to look.
      expect(said).not.toContain('Ask a person')
    })

    it('⚑ the same give when the provider is not signed in keeps the word a person must act on', () => {
      const judged = judgeAnAgentsChoice(
        { model: 'gpt-fictional' },
        'codex',
        unread(SIGNED_OUT),
        null,
        'give',
      )
      expect(judged).toMatchObject({
        ok: false,
        refusal: {
          rail: 'models-unavailable',
          permanence: 'until-a-person-changes-it',
          retryable: false,
          remedy: null,
        },
      })
      expect(judged.ok ? '' : judged.refusal.reason).toContain('Ask a person to check Codex')
    })

    it('🔴 an effort named alone, and an agent being made, are said in their own words', () => {
      const alone = judgeAnAgentsChoice({ effort: 'high' }, 'claude', unread(SLOW), null, 'give')
      expect(alone).toMatchObject({ ok: false, refusal: { rail: 'models-not-read-in-time' } })
      expect(alone.ok ? '' : alone.refusal.reason).toBe(
        'Give again in a moment: Claude did not answer in time when asked which models it offers, so no model was found to run the effort “high” on and nothing was given. Nobody has to change anything first.',
      )
      expect(
        refuseModel('models-not-read-in-time', { door: 'create', provider: 'codex', model: 'm' })
          .reason,
      ).toBe(
        'Make the agent again in a moment: Codex did not answer in time when asked which models it offers, so “m” could not be checked and no agent was made. Nobody has to change anything first.',
      )
    })

    it('⚑ and a list that was read admits the model: the word is about the list, not the give', () => {
      const read = {
        rows: [{ id: 'gpt-fictional', label: 'GPT Fictional', addedBy: 'the-provider' as const }],
        notAsked: null,
      }
      expect(
        judgeAnAgentsChoice({ model: 'gpt-fictional' }, 'codex', read, null, 'give'),
      ).toMatchObject({ ok: true, chosen: { model: 'gpt-fictional' } })
    })
  })
})
