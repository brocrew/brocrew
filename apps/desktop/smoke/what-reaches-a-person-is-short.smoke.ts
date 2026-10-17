import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  CodexRuntime,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type RuntimeEvent,
  type SessionHandle,
} from '@brobot2/runtime'
import { providerSchema } from '@brobot2/shared'
import { bundledCodexTransportFactory } from '../../../packages/runtime/smoke/bundled-codex'
import { runEvidence, runScratch } from '../../../packages/runtime/smoke/run-paths'
import { probeRunDeadline } from '../../../packages/runtime/smoke/probe-run-deadline'
import { DEFAULT_CAPABILITIES } from '../src/shared/capabilities'
import {
  composeProfileBundle,
  thisConversationSpans,
  type InstructionContext,
} from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import { messageNamingItsSender, THE_PERSON_AT_A_WINDOW } from '../src/main/runtime/turn-origin'

/**
 * 684: run once on the base, once on the change. Each invocation renders the bundle for every
 * provider through the product publisher and reader, then runs one person turn and an agent
 * control. The question, model and grants stay fixed. No claim of statistical reliability.
 *
 * Own scratch userData/homes; the lifecycle runner's product copy-once auth path, never a manual
 * credential read/copy. Headless adapters: no Electron, CDP or listener, hence no shared port.
 * Only answers, usage events and rendered instructions leave scratch. All homes are removed.
 *
 * BROBOT_BREVITY_LABEL=before pnpm exec vitest run --config vitest.smoke.config.ts \
 *   apps/desktop/smoke/what-reaches-a-person-is-short.smoke.ts
 * Repeat with label=after on the changed tree. Set BROBOT_BREVITY_RENDER_ONLY=1 for zero spend.
 */
const MODEL = 'gpt-5.6-luna'
const OPEN_MS = 30_000
const SEND_MS = 10_000
const TURN_MS = 90_000
const CLOSE_MS = 10_000
// The measured arms: every agent is composed the same way (D-014), so the audience is the one
// variable. Keeping this data local lets the deadline census evaluate the budget without executing
// an imported product module.
const CASES = [{ audience: 'person' }, { audience: 'agent' }] as const
const BUDGET_MS = CASES.length * (OPEN_MS + SEND_MS + TURN_MS + 2 * CLOSE_MS)
const deadline = probeRunDeadline('684 reader brevity', BUDGET_MS, 2 * CLOSE_MS)
const QUESTION =
  'Can the workshop go ahead on Thursday? The room is reserved for 14:00–16:00. ' +
  'Twelve people are attending. The room seats sixteen. Two people join remotely. ' +
  'The projector is broken, but a large monitor works. The remote link has not been sent. ' +
  'Mina owns the invitation. Arun can test the monitor Wednesday. ' +
  'One attendee needs step-free access; the east entrance has a ramp. ' +
  'Catering closes orders Tuesday at noon. Tell me whether the plan works and what needs doing. ' +
  'Use only these facts. Do not use tools or ask a follow-up question.'

async function bounded<T>(what: string, ms: number, work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`NOT PERFORMED: ${what}, deadline ${ms}ms`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

it(
  '684 · rendered instructions and one bounded live comparison arm per audience',
  () =>
    deadline.within('measuring the reader comparisons', async () => {
      const label = process.env.BROBOT_BREVITY_LABEL ?? 'current'
      expect(['before', 'after', 'current']).toContain(label)
      const root = runScratch(`brevity-${label}`)
      const userData = join(root, 'userData')
      const homes = join(userData, 'provider-homes')
      const work = join(root, 'work')
      mkdirSync(work, { recursive: true })
      const renders: unknown[] = []
      const results: unknown[] = []
      const evidence = runEvidence(`brevity-${label}.json`)
      const save = (): void =>
        writeFileSync(
          evidence,
          JSON.stringify({ label, model: MODEL, budgetMs: BUDGET_MS, renders, results }, null, 2),
        )
      console.log(
        `684 ${label}: ${CASES.length} turns maximum, ${BUDGET_MS}ms total wait budget; ${evidence}`,
      )
      const context = (audience: string): InstructionContext => ({
        profileSlug: `probe-${audience}`,
        cwd: work,
        // ⚑ D-016 · commit 7 · R3 · the parent, named by the root it owns (the sender below).
        startedBy: audience === 'agent' ? 'Parent (the owner of W1)' : null,
        depth: audience === 'agent' ? 1 : 0,
        capabilities: DEFAULT_CAPABILITIES,
        spawningEnabled: true,
        // ⚑ D-016 · a conversation a person starts owns a root; one another conversation started
        // owns none.
        root: audience === 'agent' ? null : 'W1',
        // ⚑ D-024 · R1 · no other conversation of the profile.
        others: { shown: [], more: 0 },
      })
      try {
        for (const provider of providerSchema.options) {
          const home = join(homes, 'render', provider)
          await provisionProviderHome(homes, home)
          const text = composeProfileBundle(context('person'))
          const bundle = publishProfileBundle(provider, home, text)
          expect(bundle.ok).toBe(true)
          // ⚑ D-024 · R1 · this conversation's own text, composed apart as `main/index.ts` does —
          // the file above carries none of it. 🔴 D-039 · and on Codex it opens with how to use the
          // brobot tools (`toolsToldInTextFor`, the composition root's one decision), so a render
          // without them is not the text that provider is sent.
          const read = readSessionInstructions({
            provider,
            cwd: work,
            providerHome: home,
            bundle,
            thisConversation: thisConversationSpans(
              context('person'),
              toolsToldInTextFor(provider),
            ),
          })
          renders.push({ provider, text, instructions: read.instructions })
        }
        save()
        if (process.env.BROBOT_BREVITY_RENDER_ONLY === '1') return
        for (const { audience } of CASES) {
          deadline.refuse(`starting ${audience}`)
          const home = join(homes, audience, 'codex')
          await provisionProviderHome(homes, home)
          // Same product-owned provisioning path as lifecycle-stage.smoke.ts.
          await provisionCodexAuth(home)
          const bundle = publishProfileBundle(
            'codex',
            home,
            composeProfileBundle(context(audience)),
          )
          expect(bundle.ok).toBe(true)
          expect(readFileSync(bundle.path, 'utf8')).toContain('## How you work')
          // Codex reads its published AGENTS.override.md itself; its app-side injected list is empty.
          // 🔴 **D-024 · R1 — what is true of this conversation left that file** (who started it,
          // its root, its grants): the reader composes it apart, and the host puts it in front of
          // the first message of the life (`RuntimeHost.withWhatThisLifeOwes`), which this probe
          // does below — or the agent arm would no longer be told who started it.
          // 🔴 **D-039 · and that lead now OPENS with how to use the brobot tools**, which a Codex
          // catalogue's capped namespace description no longer carries. ⚑ Handed here although this
          // arm's bare runtime is offered no catalogue (as before D-039, when the instructions rode
          // that catalogue and so reached this arm nowhere): what is measured is the reply to the
          // words a production Codex life is sent, and both arms get them alike, so the audience
          // stays the one variable.
          const { firstTurnLead } = readSessionInstructions({
            provider: 'codex',
            cwd: work,
            providerHome: home,
            bundle,
            thisConversation: thisConversationSpans(context(audience), toolsToldInTextFor('codex')),
          })
          expect(firstTurnLead).not.toBeNull()
          const usage: unknown[] = []
          const factory = bundledCodexTransportFactory()
          const runtime = new CodexRuntime((options) => {
            const transport = factory(options)
            return new Proxy(transport, {
              get(target, prop, receiver) {
                if (prop === 'incoming')
                  return async function* () {
                    for await (const frame of target.incoming()) {
                      if (frame.method === 'thread/tokenUsage/updated') usage.push(frame.params)
                      yield frame
                    }
                  }
                const value = Reflect.get(target, prop, receiver) as unknown
                return typeof value === 'function' ? value.bind(target) : value
              },
            })
          }, codexAuthHealth)
          const controller = new AbortController()
          let handle: SessionHandle | undefined
          const events: RuntimeEvent[] = []
          let consuming: Promise<void> | undefined
          let closing: Promise<void> | undefined
          const closeOwned = (): Promise<void> => {
            closing ??= (async () => {
              controller.abort()
              if (handle !== undefined) await bounded('close', CLOSE_MS, handle.close())
              if (consuming !== undefined) await bounded('event drain', CLOSE_MS, consuming)
            })()
            return closing
          }
          const release = deadline.own(closeOwned)
          const started = Date.now()
          try {
            deadline.refuse(`opening ${audience}`)
            const opening = runtime.start({
              cwd: work,
              providerHome: home,
              model: MODEL,
              signal: controller.signal,
            })
            opening.then(
              (late) => {
                if (controller.signal.aborted) void late.close()
              },
              () => {},
            )
            handle = await bounded('open', OPEN_MS, opening)
            deadline.refuse(`sending ${audience}`)
            const opened = handle
            consuming = (async () => {
              for await (const event of opened.events()) events.push(event)
            })()
            const words = messageNamingItsSender(
              audience === 'person'
                ? QUESTION
                : `${QUESTION} This is an agent handover; preserve every supplied fact so I can continue the work.`,
              audience === 'person'
                ? THE_PERSON_AT_A_WINDOW
                : {
                    who: 'a-caller-with-an-id',
                    caller: 'sess_probe_parent',
                    profile: 'parent',
                    aPersonIsBehindIt: false,
                  },
              // ⚑ D-011 · where the sender of this probe's words stands, as the host would say it:
              // these words give no piece, and the sender gave the receiver one that is still
              // open — under the root it owns, which names it (D-016 · commit 7 · R3).
              () => ({
                name: 'Parent',
                handsYou: null,
                openWorkItGaveYou: ['W1.1'],
                gaveYouWorkThatIsClosed: false,
                named: { label: 'W1', title: null },
                about: null,
              }),
            )
            // ⚑ D-024 · R1 · the host's own order: the lead, then the framed turn.
            const firstTurn = firstTurnLead === null ? words : `${firstTurnLead}\n\n${words}`
            await bounded('send', SEND_MS, handle.send(firstTurn))
            await bounded(
              'answer',
              TURN_MS,
              new Promise<void>((resolve) => {
                const poll = (): void => {
                  if (controller.signal.aborted || events.some((event) => event.type === 'turn'))
                    resolve()
                  else setTimeout(poll, 50)
                }
                poll()
              }),
            )
            const text = events
              .flatMap((event) => (event.type === 'assistant_message' ? [event.text] : []))
              .join('\n')
            const ending = events.filter((event) => event.type === 'turn').at(-1)
            expect(ending).toMatchObject({ state: 'completed' })
            expect(text).not.toBe('')
            const row = {
              audience,
              text,
              words: text.trim().split(/\s+/).length,
              elapsedMs: Date.now() - started,
              usage,
            }
            results.push(row)
            console.log(JSON.stringify(row))
          } catch (error) {
            results.push({ audience, error: String(error), elapsedMs: Date.now() - started })
            throw error
          } finally {
            try {
              await closeOwned()
            } finally {
              release()
              save()
            }
          }
        }
      } finally {
        save()
        rmSync(root, { recursive: true, force: true })
      }
    }),
  deadline.testTimeoutMs,
)
