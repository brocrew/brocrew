import type { TranscriptEvent } from '../src/shared/conversation-events'
import type { RoutedRequest } from '../src/shared/question-contracts'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ClaudeRuntime, claudeKeychainTokenProvider } from '@brobot2/runtime/claude'
import { CodexRuntime, codexAuthHealth, provisionCodexAuth } from '@brobot2/runtime/codex'

import { provisionProviderHome, type AgentRuntime } from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import { resourcesRoot } from '../src/main/resources/resources'
import { composeProfileBundle, thisConversationSpans } from '../src/main/runtime/factory-text'
import { questionKey } from '../src/main/runtime/question-rails'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'

import { REQUEST_IS_OPEN, permissionShaped, theChannelRefusalIn } from '../src/shared/questions'

import { bundledCodexTransportFactory } from '../../../packages/runtime/smoke/bundled-codex'
import {
  MODEL,
  PHASE,
  PROVIDER,
  ROOT,
  ledgerReadersOf,
  note,
  say,
  type LifecycleRun,
} from './lifecycle-run'
import { phaseAOf } from './lifecycle-phase-a'
import { phaseBOf } from './lifecycle-phase-b'

/**
 * 🔴 **402 · one half of the lifecycle runner** — the stage `scripts/lifecycle-runner.mjs` starts,
 * kills, and starts again.
 *
 * ⛔ **This file performs; it does not judge.** Every observation is appended to a JSONL journal the
 * moment it is made, and the runner computes the table from that journal. ⚠️ **That split is not
 * tidiness — it is the only way the report can be computed from the OUTCOME**: phase `a` is killed
 * mid-turn on purpose, so anything it held in memory to summarise at the end would be exactly the
 * evidence a real kill destroys.
 *
 * ## ⚠️ Why two processes and not two hosts
 *
 * HO-018 §2.3 is *"the app being killed while work is in progress"*. A second `RuntimeHost` built
 * over the same store in the SAME process is not that: the first host's slots, its provider child
 * processes and its writers are all still alive and still appending. ⛔ **The kill has to be a real
 * `SIGKILL` to a real process group**, which is what the runner does and why this file takes a
 * `phase` instead of doing both halves itself.
 *
 * ## ⛔ Nothing here needs a window, and that is asserted rather than assumed
 *
 * `395` and `396` both shipped behaviour that only a watched session could reach. One sink in this
 * file says a person is behind it — the one a person really is behind — and every conversation a
 * give starts gets `NO_SURFACE` from the host itself, whose `alive` is `false`.
 *
 * ## ⚠️ Where this rig is NOT the app, named rather than implied
 *
 * It builds a real {@link RuntimeHost} with the real adapters, the real store, the real migrations,
 * the app's own `resourcesRoot` and the app's own instruction bundle. ⛔ **What `main/index.ts`
 * passes and this does not** — so a reader knows the shape of the gap rather than trusting a claim:
 *
 *  - **`userHomeSessions`, `liveness`, `providerAuth`** — the Library's import, the liveness pinger
 *    and the sign-in surface. None is on the lifecycle's path.
 *  - **a window** — deliberately, and §2.3 of the response says which rows that leaves on which side.
 *
 * ## 🔒 What it touches
 *
 * ⛔ **Its own root, passed in by the runner**, and nothing else: `userData`, `work`, and a
 * `provider-homes` tree under it. ⚠️ **The Codex credential is named rather than hidden**: a Codex
 * child cannot run without an `auth.json`, so `prepareProviderHome` calls the app's own
 * `provisionCodexAuth` — the same copy-once path `main/index.ts` performs on every launch and every
 * committed Codex probe uses. Nothing reads or writes anything under anybody's real profile home,
 * and the runner removes this run's tree.
 */

class Watcher implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(
    readonly ownerId: string,
    /**
     * ⛔ **True for exactly one sink in this file**, and it is the one the runner really is behind.
     * `375` measured that this is a fact about the SINK that owns a session; a probe that set it on
     * every sink would be answering a permission as somebody who is not there.
     */
    readonly aPersonIsBehindIt: boolean,
  ) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  events(): TranscriptEvent[] {
    return this.messages.map((one) => one.event)
  }
}

it('🔴 402 · the agent lifecycle, performed', { timeout: 3_600_000 }, async () => {
  expect(ROOT, 'BROBOT_LIFECYCLE_ROOT — the runner owns the root').not.toBe('')
  expect(['a', 'b']).toContain(PHASE)

  const userData = join(ROOT, 'userData')
  const work = join(ROOT, 'work')
  const homes = join(ROOT, 'provider-homes')
  for (const dir of [userData, work, homes]) mkdirSync(dir, { recursive: true })

  const db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
  const store = createSessionStore(db)
  /**
   * ⛔ **Session ids must not collide across the two phases.** A counter that restarts at 1 would
   * mint `sess_1` twice over one ledger — the second phase's first launch landing on the first
   * phase's BroBot. The phase letter is in the id, which is also readable evidence in the ledger
   * of which process opened a conversation.
   */
  let counter = 0
  const newSessionId = (): string => `sess_${PHASE}${++counter}`

  // ⛔ **Stable across phases, and that is what makes the relaunch a relaunch**: a home keyed by
  // time would hand phase `b` an empty tree and every resumed child a provider that had never
  // seen it.
  const homeOf = (profileId: string): string => join(homes, profileId, PROVIDER)

  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
    // ⚑ **The real adapters** — the same two the shipped app builds. The only thing this rig
    // substitutes is where the homes live.
    createRuntime: (): AgentRuntime =>
      PROVIDER === 'claude'
        ? new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
        : new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth),
    prepareProviderHome: async (_provider: Provider, profileId: string) => {
      const home = homeOf(profileId)
      await provisionProviderHome(homes, home)
      // ⚠️ **Named rather than hidden** — see this file's docblock. The app's own copy-once path.
      if (PROVIDER === 'codex') await provisionCodexAuth(home)
      return home
    },
    providerHomePath: (_provider, profileId) => homeOf(profileId),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    // ⛔ **Without this the app keeps no resource and a reply that hands one in is refused**
    // `resource-store-unavailable` — measured live when it was the document registry: a worker that
    // had done its work tried three times and answered *"Blocked: reply_to_parent repeatedly refused
    // because the document registry is unavailable."* ⚑ `resourcesRoot` is optional on
    // `RuntimeHostDeps`, and the app supplies it from `main/index.ts`; a rig that omits it is not the
    // shipped app, and the whole point of this file is to be one.
    resourcesRoot: () => resourcesRoot(userData),
    // ⛔ **The app's OWN instruction bundle, compiled, published and read** — the same three calls
    // `main/index.ts` makes, in the same order `362` §1.4 measured as the only one that works.
    // ⚠️ **Omitting it made the runner a rig rather than the app**: every agent in the chain ran with
    // no BroBot instructions at all, so nothing here would have exercised the factory text or
    // `402`'s own branch. ⚑ `readInstructions` is OPTIONAL on `RuntimeHostDeps`
    // and absent means *this host has nothing to say* — which is a real value, and the wrong one for
    // an instrument that claims to perform the product's lifecycle.
    //
    // 🔴 **D-024 · R1 — what is true of THIS conversation left the published file** (who started
    // it, its root, its grants, its profile's other conversations), so the seam composes it apart
    // as `main/index.ts` does, and hands on the reader's `firstTurnLead`: on Codex — this stage's
    // default — the host puts it in front of the first message of each life. ⛔ Without it a Codex
    // agent here would no longer be told who started it, which the file used to tell it.
    //
    // 🔴 **D-039 · and on Codex that text OPENS with how to use the brobot tools** — `main/index.ts`'s
    // one decision (`toolsToldInTextFor`): the catalogue's namespace description is capped and the
    // instructions are longer, so they left it for here. ⛔ Without it every Codex agent in this
    // chain would be offered `give_work` and `reply_to_parent` with no word on how agents are named
    // or what a refusal is — a prompt the product no longer sends.
    readInstructions: (provider, cwd, providerHome, context) => {
      const bundle = publishProfileBundle(provider, providerHome, composeProfileBundle(context))
      const read = readSessionInstructions({
        provider,
        cwd,
        providerHome,
        bundle,
        thisConversation: thisConversationSpans(context, toolsToldInTextFor(provider)),
      })
      return {
        instructions: read.instructions,
        systemHint: undefined,
        memoryLoaded: read.memoryLoaded,
        ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
      }
    },
    newSessionId,
    readProviderConfig: (provider, home) => ({
      home,
      homeEnv: provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME',
      model: MODEL,
      authNote: null,
      files: [],
    }),
  })

  const person = new Watcher('webContents:1', true)

  /**
   * 🔴 **The person, answering what only a person can — and the runner cannot skip it.**
   *
   * ⛔ **Every conversation in the chain runs `ask`, because BroBot does.** A give takes no mode:
   * the conversation it starts runs in its giver's (499, HO-036), so the mode the person opens
   * BroBot in is the mode of the whole tree — and this stage opens it in `ask`, the mode this app
   * ships as its default. So the first consequential tool call any conversation makes parks on a
   * permission card, and `mayAnswerAsAHuman` means only a person may answer it. ⚑ **The diagram's
   * *"authority goes to the human, never to the parent agent"* is therefore not one step of this
   * performance — it is the gate on every hop of it.**
   *
   * ## ⛔ Why it claims the conversation first
   *
   * `mayAnswerAsAHuman` reads the SLOT: a person may answer only a session they own, and a
   * conversation a give started is owned by nobody (`NO_SURFACE`, `ownerId: null`). ⚑ {@link RuntimeHost.claimSession} is
   * the door a person goes through when they open that conversation in the app, and it is the only
   * one — so this loop performs the real gesture rather than reaching past the rail.
   *
   * ## ⚠️ Why it still folds the ledger, and what step `7b` reads NOW
   *
   * ⛔ **`questionsForAPerson()` is structurally unable to list a permission**, and always will be:
   * *"`escalationsDue` never returns a routing with a `because`, so a permission-shaped request has
   * `escalatedAt === null` for ever and this filter cannot admit one."* ⚑ **`403` did not widen it
   * — it added a second reader**, `RuntimeHost.decisionsForAPerson`, and step `7b` now reads BOTH.
   *
   * ⚠️ **This loop goes on folding the ledger to find the cards it ANSWERS**, which is the point:
   * the thing under test is whether the app's own person-facing readers see what the ledger holds,
   * so the loop must not be driven by the readers it is measuring. ⛔ `queueListed` is the
   * measurement and `waitingOnAPerson` is the instrument, and they stay separate.
   */
  const claimed = new Map<string, Watcher>()
  const personsAnswers: { session: string; requestId: string; because: string | null }[] = []
  /** What the PERSON'S QUEUE listed, ever — read on every pass, so step 7b is a fact and not a guess. */
  const queueListed = new Set<string>()
  /** Conversations whose cards this person could not answer — reported once each, never per pass. */
  const cannotAnswer = new Set<string>()
  let watching = true

  const waitingOnAPerson = (sessionId: string): readonly RoutedRequest[] =>
    permissionShaped(store.routedRequestsOf(sessionId)).filter(
      (one) => one.went.to === 'a-person' && REQUEST_IS_OPEN[one.state],
    )

  /**
   * ⛔ **A person answers on a conversation they ALREADY have open; they do not open a second window.**
   *
   * 🔴 **Found by a whole phase `b` parking on a card.** `resumeSession` makes its sink the OWNER,
   * and `mayClaim` is true only of a `null` owner — so a loop that always minted a fresh sink was
   * refused *"session sess_a6 was not taken over: it is held for webContents:2"* on every pass, and
   * the resumed worker waited for an answer nobody could give. ⚑ Every session this stage takes
   * ownership of registers its sink in `claimed`, so this reuses it instead of claiming twice.
   */
  async function personAnswersOne(sessionId: string, request: RoutedRequest): Promise<void> {
    let sink = claimed.get(sessionId)
    if (sink === undefined) {
      sink = new Watcher(`webContents:person-${String(claimed.size + 2)}`, true)
      // ⚠️ A claim can legitimately refuse — the session may be closing, or already owned — and a
      // person who cannot open a conversation simply does not answer that card.
      host.claimSession(sessionId, sink)
      claimed.set(sessionId, sink)
    }
    const ack = await host.respondPermission(
      sessionId,
      request.requestId,
      { outcome: 'allow' },
      sink,
    )
    if (ack.outcome === 'taken') {
      personsAnswers.push({
        session: sessionId,
        requestId: request.requestId,
        because: theChannelRefusalIn(request),
      })
    }
  }

  async function theAttentionQueue(): Promise<void> {
    // ⛔ **An OUTER catch as well as the per-card one, and they guard different things.** The inner
    // one stops a conversation that cannot be claimed from hiding the ones behind it; this one stops
    // the loop from becoming an unhandled rejection when the store closes underneath it — `watching`
    // is set in the `finally` a line before `closeAll` and `db.close()`, so a pass that is mid-fold
    // when that happens reads a database that is going away.
    try {
      await sweepTheQueue()
    } catch (error) {
      say(
        `   the person stopped watching: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  async function sweepTheQueue(): Promise<void> {
    while (watching) {
      // ⛔ **One `try` per CARD, and that granularity is the whole of it.** A single catch around
      // the sweep would let one conversation that cannot be claimed hide every other conversation
      // behind it — the same card would throw on every pass, and the run would stall on a queue
      // that was never empty. Found reviewing this loop rather than by running it.
      // ⛔ **BOTH readers, since `403`.** ⚠️ Reading only the first is what made `7b` red, and
      // leaving it that way would report FAIL over a closed finding on every future run — the
      // instrument that produced a finding has to be re-pointed at the fix.
      // ⚑ **679 · keyed by the asker AND the id** — the runner defaults to Codex, whose ids are
      // numbered per connection, so two workers' `number:N` would count as one (`679`'s sweep).
      for (const one of host.questionsForAPerson().rows)
        queueListed.add(questionKey(one.request.askedBy, one.request.requestId))
      for (const one of host.decisionsForAPerson().rows)
        queueListed.add(questionKey(one.request.askedBy, one.request.requestId))
      for (const sessionId of [...host.sessionIds]) {
        for (const request of waitingOnAPerson(sessionId)) {
          const already = personsAnswers.some(
            (one) => one.session === sessionId && one.requestId === request.requestId,
          )
          if (already) continue
          try {
            await personAnswersOne(sessionId, request)
          } catch (error) {
            // ⚠️ **Once per conversation, not once per pass.** The refusal that found the
            // owning-sink defect printed dozens of times a minute for ten minutes, which is how a
            // real signal becomes something a reader scrolls past.
            if (!cannotAnswer.has(sessionId)) {
              cannotAnswer.add(sessionId)
              say(
                `   the person could not answer ${request.requestId} on ${sessionId}: ` +
                  `${error instanceof Error ? error.message : String(error)}`,
              )
            }
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1_500))
    }
  }

  /**
   * The run's state, as each phase's steps receive it. ⚠️ `watching` is read through a getter,
   * because the `finally` below turns it off while phase `a`'s kill window may still be looking.
   */
  const run: LifecycleRun = {
    store,
    host,
    work,
    person,
    claimed,
    personsAnswers,
    queueListed,
    get watching() {
      return watching
    },
    Watcher,
    theAttentionQueue,
    ...ledgerReadersOf(store, host),
  }
  const phaseA = phaseAOf(run)
  const phaseB = phaseBOf(run)

  try {
    if (PHASE === 'a') await phaseA()
    else await phaseB()
  } catch (error) {
    note('the stage itself', 'FAIL', error instanceof Error ? error.message : String(error))
    throw error
  } finally {
    // ⛔ **Phase `a` never reaches here** — it is killed. That asymmetry is the point of the file.
    watching = false
    await host.closeAll()
    db.close()
  }
})
