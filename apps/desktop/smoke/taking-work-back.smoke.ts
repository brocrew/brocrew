import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type AgentRuntime,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { TASK_IS_OPEN } from '../src/shared/tasks'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { runEvidence, runScratch } from '../../../packages/runtime/smoke/run-paths'

/**
 * 🔴 **429 · the fifth property and the verb, performed against a REAL provider** (§6.5).
 *
 * ⛔ **`415` §6.3 measured this defect live, twice, and a rail that only ever fired in a suite would
 * be the one thing this dispatch cannot claim.** ⚑ What a suite cannot show is that the refusal
 * REACHES a model as policy rather than as a broken tool, that the verb is ADVERTISED in the
 * inventory a real provider is handed, and that a real model can act on what it is told.
 *
 * ⚑ **D-016 · work is a piece now, given with `give_work` and taken back by its label or id.** The
 * refusal a model meets is the one for taking back a piece that was already answered — a re-sent
 * message opens nothing any more, so it has nothing to refuse — and a take-back TELLS the owner,
 * which the run reads off the owner's own ledger.
 *
 * ## ⚠️ The budget, stated up front — standing rule 13
 *
 * ⛔ **Four parent turns and three child turns on the CHEAP model — the child's a person's choice
 * for its agent, because a give names no model — inside a 20-minute ceiling.** Every
 * wait below carries its own deadline, and **a step whose deadline passes is reported NOT PERFORMED**
 * — never waited on further and never inferred. ⚑ A run that cannot finish inside the ceiling is a
 * finding about the run rather than a reason to keep waiting.
 *
 * ## ⛔ What it touches
 *
 * ⚠️ **Nothing under a person's `provider-homes/` is read, copied or written, and no `auth.json` is
 * read or written**: the machine login is injected transiently from the Keychain by the adapter's own
 * path, every home is provisioned fresh under this run's own root, and every one is removed
 * afterwards. ⚑ `347`'s rig, unchanged in everything but what it asks the model to do.
 */

const CHEAP = 'claude-haiku-4-5-20251001'
/**
 * ⚑ **D-016 · the same model, as Claude's own list names it** — `supportedModels()` gives aliases,
 * and a person's choice for the worker is one of the list's rows.
 */
const CHEAP_LISTED = 'haiku'
/** ⛔ Model-unprompted and appearing nowhere else, so a match cannot be an echo of the prompt. */
const MARKER = `BROBOT_429_DONE_${process.pid}`

class Recorder implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  /**
   * ⛔ **`aPersonIsBehindIt` decides whether this sink may ANSWER a card, and the third live run
   * measured it.** ⚠️ The pump below called `respondPermission` through a sink that answered `false`
   * and the host refused it, by name and repeatedly: *"session sess_3 is held for webContents:1, and
   * webContents:1 asked to answer for a person."* ⚑ The refusal is right — a started child's cards
   * are not a window's to settle unless a person is behind that window — and it is the rig that has
   * to say which it is, which is `375`'s ruling read from the outside.
   */
  constructor(
    readonly ownerId: string,
    readonly aPersonIsBehindIt = false,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

/** Poll until `check` is true, or give up — bounded, because a live child can simply not answer. */
async function until(
  what: string,
  ms: number,
  check: () => boolean | Promise<boolean>,
): Promise<boolean> {
  const deadline = Date.now() + ms
  for (;;) {
    if (await check()) return true
    if (Date.now() > deadline) {
      say(`   … NOT PERFORMED: gave up waiting for ${what} after ${ms}ms`)
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
}

it(
  '🔴 a real Claude parent is refused taking back answered work, and takes open work back',
  { timeout: 1_200_000 },
  async () => {
    const token = claudeKeychainTokenProvider()
    expect(token() !== null, 'a live demonstration needs a live machine login').toBe(true)

    const scratch = runScratch('taking-work-back')
    mkdirSync(scratch, { recursive: true })
    const userData = join(scratch, 'userData')
    const work = join(scratch, 'work')
    mkdirSync(userData, { recursive: true })
    mkdirSync(work, { recursive: true })
    const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
    const homes: string[] = []

    const db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
    const store = createSessionStore(db)
    let counter = 0

    const host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (): AgentRuntime => new ClaudeRuntime(undefined, undefined, token),
      prepareProviderHome: async (provider: Provider, profileId: string) => {
        const home = join(managedRoot, `429-${profileId}-${process.pid}-${Date.now()}`)
        await provisionProviderHome(managedRoot, home)
        homes.push(home)
        return home
      },
      providerHomePath: (_provider, profileId) => join(managedRoot, `429-${profileId}`),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (provider, home) => ({
        home,
        homeEnv: 'CLAUDE_CONFIG_DIR',
        model: 'live',
        authNote: null,
        files: [],
      }),
    })

    const window = new Recorder('webContents:1')
    const started = Date.now()
    const performed: Record<string, boolean> = {}
    try {
      const worker0 = await host.createSession(
        { provider: 'claude', profileId: 'worker', cwd: work, model: CHEAP },
        window,
      )
      await host.close(worker0.sessionId, window)
      // ⚑ **D-016 · the model the worker runs on is a person's choice for it** — a give names none.
      // Made through the person's own door, which checks it against the provider's list (no turn).
      const chose = await host.setAgentModelAndEffort('worker', {
        provider: 'claude',
        model: CHEAP_LISTED,
        effort: null,
      })
      expect(chose, 'a person chose the worker’s model').toMatchObject({ ok: true })
      say(`1 · identity 'worker' exists (session ${worker0.sessionId}, closed)`)

      const parentSink = new Recorder('webContents:2')
      const parent = await host.createSession(
        { provider: 'claude', profileId: 'pm', cwd: work, model: CHEAP, approvalMode: 'auto' },
        parentSink,
      )
      say(`2 · parent ${parent.sessionId} running, pm may give worker work`)

      const toolCalls = (sessionId: string): string[] =>
        store
          .events(sessionId)
          .map((one) => one.event)
          .filter(
            (one): one is Extract<TranscriptEvent, { type: 'tool_call' }> =>
              one.type === 'tool_call',
          )
          .map((one) => one.name)

      /**
       * ⛔ **Idle NOW, read off the LAST status row** — a live parent is mid-turn for most of this
       * run, and `host.send` THROWS *"cannot send: session is not active or a turn is in progress"*.
       * ⚠️ The first attempt at this run died there, on step 6, after seven minutes of real work:
       * a step that was never performed because the step before it had not finished.
       */
      const idle = (sessionId: string): boolean => {
        const last = store
          .events(sessionId)
          .map((one) => one.event)
          .filter((one) => one.type === 'status')
          .at(-1) as { state?: string } | undefined
        return last?.state === 'idle'
      }

      const sendWhenIdle = async (text: string, what: string): Promise<boolean> => {
        if (
          !(await until(`${what}: the parent to be idle`, 300_000, () => idle(parent.sessionId)))
        ) {
          return false
        }
        await host.send(parent.sessionId, text, parentSink)
        return true
      }

      // ⚑ Declared before the pump that uses it; claimed once the child exists.
      const personAtTheChild = new Recorder('webContents:3', true)

      /**
       * 🔴 **A person answering the child's permission cards, which is what the desktop IS.**
       *
       * ⚠️ **A conversation a give starts runs in its giver's mode** (499, HO-036) — `auto` here — so
       * no card is expected. ⛔ **But one that does arrive has nobody behind it**, and the FIRST
       * attempt at this run, when the child ran `ask` by rail, waited 420s for a reply that could
       * never come — standing rule 13's *not performed* arriving for a reason the rig created. ⚑ So
       * a person keeps answering.
       *
       * ⚠️ **Allow, never deny, and only on the conversations this run created.**
       */
      const pump = async (sessionId: string): Promise<void> => {
        const rows = store.events(sessionId).map((one) => one.event)
        const settled = new Set(
          rows
            .filter((one) => one.type === 'user_decision')
            .map((one) => (one as { requestId: string }).requestId),
        )
        for (const row of rows) {
          if (row.type !== 'permission_request') continue
          const id = (row as { id: string }).id
          if (settled.has(id)) continue
          try {
            await host.respondPermission(sessionId, id, { outcome: 'allow' }, personAtTheChild)
          } catch {
            // ⚠️ A card that settled between the read and the answer is not an error here.
          }
        }
      }

      const refusals = (sessionId: string): string[] =>
        store
          .events(sessionId)
          .map((one) => one.event)
          .filter(
            (one): one is Extract<TranscriptEvent, { type: 'tool_refused' }> =>
              one.type === 'tool_refused',
          )
          .map((one) => one.rail)

      // ── 3 · the inventory a real provider is handed carries the verb ─────────────────────────
      // ⛔ **Read off the adapter's own row**, not off our own toolset: what a model is told is the
      // JSON Schema the adapter builds, and `348` measured that an undocumented key reaches the
      // handler anyway. ⚑ The proof it is ADVERTISED is that it is in the inventory row.
      const inventoryOf = (sessionId: string): string | null => {
        const row = store
          .events(sessionId)
          .map((one) => one.event)
          .find((one) => one.type === 'tool_inventory')
        return row === undefined ? null : JSON.stringify(row)
      }

      // ── 4 · the parent gives work, and the worker answers it ────────────────────────────────
      const before = new Set(host.sessionIds)
      await host.send(
        parent.sessionId,
        `You are running inside an app that gives you tools for managing other agents. ` +
          `Do exactly one thing and then stop: call give_work with profile "worker", title ` +
          `"429 live demonstration", and brief exactly: Finish this piece with reply_to_parent, ` +
          `outcome done and summary ${MARKER}. Do not use any other tool.`,
        parentSink,
      )
      const appeared = await until('a child session', 300_000, () =>
        host.sessionIds.some((id) => !before.has(id)),
      )
      const child = host.sessionIds.find((id) => !before.has(id))
      say(`4 · child: ${child ?? 'NONE'} (appeared: ${appeared})`)
      expect(appeared, 'the parent started a child').toBe(true)
      expect(child, 'a child session id').toBeDefined()

      // ── 4a · the inventory a real provider is handed carries the verb ───────────────────────
      // ⛔ **Read off the adapter's own `tool_inventory` row**, which is what a model was actually
      // told — not off our own toolset. ⚠️ `348` measured that an undocumented key reaches the
      // handler anyway, so the only proof a surface is ADVERTISED is that it is in this row.
      const listed = inventoryOf(parent.sessionId) ?? inventoryOf(child!)
      performed.advertised = listed !== null && listed.includes('withdraw_task')
      say(
        `4a · inventory row found: ${listed !== null}; withdraw_task advertised: ${performed.advertised}`,
      )

      // ⚑ **A PERSON's window claims the child**, because the pump answers its cards — see
      // {@link Recorder} for the refusal that measured this.
      host.claimSession(child!, personAtTheChild)
      const answered = await until('the worker to answer its piece', 420_000, async () => {
        await pump(child!)
        return store.piecesOwnedBy(child!).some((one) => one.state === 'answered')
      })
      performed.answered = answered
      const done = store.piecesOwnedBy(child!).find((one) => one.state === 'answered')
      say(
        `   pieces in the child: ${JSON.stringify(store.piecesOwnedBy(child!).map((o) => [o.label, o.state]))}`,
      )
      if (!answered || done === undefined) {
        say(
          '⛔ NOT PERFORMED: the worker never answered, so the fifth property could not be reached',
        )
      } else {
        // ── 5 · taking back answered work, refused, against a real model ──────────────────────
        performed.askedToTakeBackTheAnswered = await sendWhenIdle(
          `${done.label} may not have been done. Do exactly one thing and then stop: call ` +
            `withdraw_task naming piece ${done.label}. Report what the tool answered, in full.`,
          'the answered take-back',
        )
        const refused = await until('the take-back to be refused', 300_000, () =>
          refusals(parent.sessionId).includes('that-piece-was-already-answered'),
        )
        performed.refused = refused
        say(`5 · parent refusals so far: ${JSON.stringify(refusals(parent.sessionId))}`)
        // ⛔ **The DURABLE row, not the model's prose** — `405`'s ledger is what makes this
        // checkable after the fact, and it is where HO-023 §5's refusal actually lands.
        expect(refused, 'taking back an answered piece was refused').toBe(true)
        expect(store.piecesOwnedBy(child!).filter((one) => TASK_IS_OPEN[one.state])).toEqual([])
      }

      // ── 6 · the verb, called by a real model, on work that is open ──────────────────────────
      // ⚑ **The same give reaches the same conversation** — the one this parent has with `worker`.
      performed.askedForSecondWork = await sendWhenIdle(
        `Do exactly one thing and then stop: call give_work with profile "worker", title ` +
          `"429 second piece", and brief exactly: wait and do nothing.`,
        'the second piece of work',
      )
      const opened = await until('a second, open piece', 300_000, async () => {
        await pump(child!)
        return store.piecesOwnedBy(child!).some((one) => TASK_IS_OPEN[one.state])
      })
      const open = store.piecesOwnedBy(child!).find((one) => TASK_IS_OPEN[one.state])
      say(`6 · second piece: ${open === undefined ? 'NONE' : `${open.label} ${open.state}`}`)
      performed.secondPiece = opened
      if (opened && open !== undefined) {
        performed.askedToTakeBack = await sendWhenIdle(
          `Do exactly one thing and then stop: call withdraw_task naming piece ${open.label}. ` +
            `Report what the tool answered, in full.`,
          'the take-back',
        )
        const tookBack = await until('withdraw_task to be called and to land', 300_000, () => {
          const row = store.piecesOwnedBy(child!).find((one) => one.piece === open.piece)
          return row?.state === 'withdrawn'
        })
        performed.tookBack = tookBack
        say(`7 · parent tool calls: ${JSON.stringify(toolCalls(parent.sessionId))}`)
        say(
          `   ${open.label} is now: ${store.piecesOwnedBy(child!).find((o) => o.piece === open.piece)?.state}`,
        )
        expect(tookBack, 'a real model took the work back through withdraw_task').toBe(true)
        expect(toolCalls(parent.sessionId).some((name) => name.includes('withdraw_task'))).toBe(
          true,
        )
        // ⚑ **And the durable row says WHO**, which is the fact `message_unqueued` could never carry.
        const row = store
          .events(child!)
          .map((one) => one.event)
          .find(
            (one): one is Extract<TranscriptEvent, { type: 'work_taken_back' }> =>
              one.type === 'work_taken_back' && one.piece === open.piece,
          )
        expect(row, 'a work_taken_back row in the child ledger').toBeDefined()
        expect(row?.by).toBe(parent.sessionId)
        // ⚑ **D-016 · the owner is TOLD** — the app's own notice, in the owner's ledger, as the turn
        // it takes or the message it holds.
        const told = await until('the worker to be told', 120_000, () =>
          store
            .events(child!)
            .map((one) => one.event)
            .some(
              (one) =>
                (one.type === 'user_turn' || one.type === 'message_queued') &&
                one.appNotice === 'a-piece-taken-back',
            ),
        )
        performed.toldTheOwner = told
        expect(told, 'the worker was told its piece was taken back').toBe(true)
      }

      say(`✅ 429 live: ${JSON.stringify(performed)} in ${Date.now() - started}ms`)
      say(`   evidence: ${runEvidence('429-live.txt')}`)
    } finally {
      await host.closeAll()
      db.close()
      for (const home of homes) rmSync(home, { recursive: true, force: true })
    }
  },
)
