import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeRuntime, type ProviderRuntimeContext } from '@brobot2/runtime'
import { openDatabase, type AppDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import type {
  CreateSessionInput,
  ModelChoice,
  RuntimeEventMessage,
  SessionLiveness,
  SessionLivenessMessage,
} from '../src/shared/runtime-ipc'
import { EFFORT_LAUNCH_CASES } from './fixtures/effort-launches'

/**
 * 274 §3 · **The other end of the seam** (from `272` finding 2).
 *
 * ⛔ `dom/effort-asked.dom.test.ts` DROVE the real launcher in a real browser and asserted what left
 * it. This takes the SAME corpus — `fixtures/effort-launches.ts` — through the real `RuntimeHost`
 * and asserts the sentence each payload ends up printing in the header.
 *
 * ⛔ **Neither half is worth much alone, and that is the point.** `179` already asserted both ends
 * separately and both were right separately: the menu offered nothing for `haiku`
 * (`dom/effort-menu.dom.test.ts`) and a payload with no effort produced `…` (`agent-rows.test.ts`).
 *
 * ⛔ **Both dom files were deleted at `417`** (HO-022 §2 removed the Fine-tune fold), and the launch
 * half of this rule had no browser end for three dispatches. ⚑ **`435` restored one**:
 * `dom/a-front-door-that-offers-everything.dom.test.ts` §5 takes this same corpus through the real
 * control. The drawer's own effort control keeps the live half in `live-settings.render.test.ts`.
 * What nothing did was carry one launcher state across, so a launcher that showed an empty menu and
 * sent `medium` was invisible to the whole suite. The shared corpus is the crossing.
 *
 * ⚑ `FakeRuntime` reports no `agentInfo` at all, which is exactly the state this is about: a Claude
 * session before its first turn, where the launch's own request is the only thing there is to say.
 *
 * ## ⚑ D-042 moved the far end of the crossing
 *
 * 🔴 **R1: every launch names its model and effort**, resolved once by the host. So a payload that
 * asks for NO effort is no longer *"each provider keeps its own default"* by the time it reaches the
 * provider: the host completes it — a model named alone runs at its list row's own default effort
 * (`null` only for a row that offers none), and nothing named runs on Claude's `default` at `high`,
 * by name. ⚑ **That makes the provider's LIST part of this crossing**, which it never was: the host
 * reads it at launch. So the runtime below answers each case's own `models` column — the provider's
 * answer the launcher saw — instead of the Fake's own two rows.
 *
 * ⚠️ **The corpus's `header` column is the launcher-era verdict** (`fixtures/effort-launches.ts`,
 * shared with the dom end, which never reads it). Where R1 now completes the effort, the header this
 * host prints is written by hand in {@link D042_HEADER} below — still by hand, never computed.
 */

/**
 * ⚑ **D-042 · the provider's answer for one case** — the corpus's `models`, as `ClaudeRuntime` now
 * maps Claude's rows: `defaultEffort: 'medium'` on a row that lists `medium` (W4.28; `high` until then, F3), none on a row that
 * lists no levels. `null` is *"nobody has answered"*, which the host's probe reads as a refusal.
 */
class Answering extends FakeRuntime {
  answer: ModelChoice[] | null = null

  override async listModels(context: ProviderRuntimeContext): Promise<ModelChoice[]> {
    await super.listModels(context) // the Fake's own cancel check and record of the home it was asked in
    if (this.answer === null) throw new Error('claude model list: nobody has answered')
    return this.answer.map((row) =>
      row.efforts?.some((one) => one.id === 'medium') ? { ...row, defaultEffort: 'medium' } : row,
    )
  }
}

/**
 * ⚑ **D-042 · the header each launch R1 completes now reads** — by hand, keyed by the corpus's own
 * case names. Every other case reads the corpus's `header`, unchanged.
 *
 *  - nothing named → Claude's `default` at `medium` (W4.28), by name: no list is needed to say it.
 *  - `opus` named alone → its row's own default effort, `medium`.
 *  - an id the list never mentioned, named alone → the provider's default effort, `medium`.
 *
 * ⛔ **`haiku` named alone still reads `…`** — its row offers no levels, so R1 names none and the
 * honest empty survives, now for that reason.
 */
const D042_HEADER: Readonly<Record<string, string>> = {
  'no catalogue, nothing held': 'medium (requested)',
  'listed, but not this rung': 'medium (requested)',
  'not this rung, and the box names an id the catalogue never mentioned': 'medium (requested)',
  'provider default, chosen on purpose': 'medium (requested)',
}

const headerOf = (probe: (typeof EFFORT_LAUNCH_CASES)[number]): string =>
  D042_HEADER[probe.name] ?? probe.header

class RecordingSink implements RuntimeEventSink {
  readonly aPersonIsBehindIt = false
  readonly messages: RuntimeEventMessage[] = []
  readonly liveness: SessionLiveness[] = []
  alive = true

  constructor(readonly ownerId = 'owner:1') {}

  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }

  sendLiveness(message: SessionLivenessMessage): void {
    this.liveness.push(message.liveness)
  }
}

const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), '../src/main/db/migrations')

/** The `model` / `reasoning` rows, as the header and the drawer read them off one liveness. */
function rows(handed: { liveness: SessionLiveness }): Record<string, string> {
  return Object.fromEntries((handed.liveness.agent ?? []).map((row) => [row.label, row.value]))
}

describe('274 · the header reads what the launcher asked for, and nothing more', () => {
  let userData: string
  let db: AppDatabase
  let host: RuntimeHost
  let sink: RecordingSink
  let runtime: Answering

  beforeEach(() => {
    userData = mkdtempSync(join(tmpdir(), 'brobot2-reasoning-asked-'))
    runtime = new Answering('claude')
    let counter = 0
    db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, migrationsFolder)
    host = new RuntimeHost({
      store: createSessionStore(db),
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: () => runtime,
      prepareProviderHome: (provider) => join(userData, 'provider-homes', provider),
      providerHomePath: (provider) => join(userData, 'provider-homes', provider),
      resolveCwd: (sessionId, requested) => requested ?? join(userData, 'scratch', sessionId),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'm',
        authNote: null,
        files: [],
      }),
    })
    sink = new RecordingSink()
  })

  afterEach(async () => {
    await host.closeAll()
    db.close()
    rmSync(userData, { recursive: true, force: true })
  })

  /**
   * ⛔ **Non-vacuity for the loop below.** A corpus that had drifted to all-omitted or all-asked
   * would still pass every iteration while asserting only one of the two facts the fix turns on.
   */
  it('the corpus really contains both endings', () => {
    expect(EFFORT_LAUNCH_CASES.filter((probe) => probe.asks === undefined).length).toBeGreaterThan(
      0,
    )
    expect(EFFORT_LAUNCH_CASES.filter((probe) => probe.asks !== undefined).length).toBeGreaterThan(
      0,
    )
    // …and the two endings really do read differently, which is the whole distinction 274 defends.
    expect(new Set(EFFORT_LAUNCH_CASES.map((probe) => probe.header)).size).toBe(2)
    // ⚑ D-042 · every hand-written header names a case the corpus HAS — a renamed case must not fall
    // back to the launcher-era verdict in silence — and the honest empty is still one of the endings
    // this host prints, so the loop below still asserts both kinds of fact.
    const names = new Set(EFFORT_LAUNCH_CASES.map((probe) => probe.name))
    expect(Object.keys(D042_HEADER).filter((name) => !names.has(name))).toEqual([])
    expect(new Set(EFFORT_LAUNCH_CASES.map(headerOf))).toEqual(new Set(['medium (requested)', '…']))
  })

  for (const probe of EFFORT_LAUNCH_CASES) {
    it(`${probe.name} — the header reads "${headerOf(probe)}"`, async () => {
      runtime.answer = probe.models
      const input: CreateSessionInput = {
        provider: 'claude',
        ...(probe.model === '' ? {} : { model: probe.model }),
        ...(probe.asks === undefined ? {} : { reasoningEffort: probe.asks }),
      }
      const created = await host.createSession(input, sink)

      expect(rows(created).reasoning, probe.why).toBe(headerOf(probe))
      // The paired positive: the row set really was built, so the assertion above is about the
      // reasoning row rather than about a liveness that carried no agent rows at all.
      expect(rows(created)).toHaveProperty('model')
      // ⚑ D-042 · a launch that typed no model is named one too — Claude's default, by name — and
      // the row says it as the request it is.
      expect(rows(created).model, 'and the model row still reports the request beside it').toBe(
        `${probe.model === '' ? 'default' : probe.model} (requested)`,
      )
    })
  }
})
