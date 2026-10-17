import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  CodexRuntime,
  claudeKeychainTokenProvider,
  codexAuthHealth,
  provisionCodexAuth,
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
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import {
  YOUR_OWN_INSTRUCTIONS_HEADING,
  composeProfileBundle,
  thisConversationSpans,
} from '../src/main/runtime/factory-text'
import { BUNDLE_LEAF, publishProfileBundle } from '../src/main/runtime/profile-bundle'
import {
  brobotWorkspace,
  CLAUDE_INSTRUCTIONS_FILE,
  ensureWorkspace,
  workspaceOwnFilesIn,
} from '../src/main/runtime/workspace'
import type { RuntimeEventMessage, TranscriptEvent } from '../src/shared/runtime-ipc'
import { bundledCodexTransportFactory } from '../../../packages/runtime/smoke/bundled-codex'
import { runScratch } from '../../../packages/runtime/smoke/run-paths'

/**
 * 🔴 **377 · a real child, on BOTH providers, quoting a marker only its rendered bundle contains —
 * and the same after a COLD RESUME.**
 *
 * ## ⛔ Why this probe exists and a unit test cannot replace it
 *
 * `377` §13.1: *"the provider's own report is the oracle, never our reader."* Everything below the
 * provider is already covered by `the-text-a-child-is-actually-told.test.ts` — what the compiler
 * says, what the publisher refuses, which leaf each dialect gets. ⛔ **What no test in this
 * repository can answer is whether the two providers actually READ those leaves**, because both
 * routes are the provider's own: Codex discovers `AGENTS.override.md` natively and Claude receives
 * an app-composed hint through its preset. `362` measured both routes on live children; this asserts
 * that the app now walks them.
 *
 * ## ⚑ The marker is PRODUCTION DATA, not a fixture string
 *
 * ⛔ **It rides the identity's own instructions** — the rules a person writes on an agent's sheet
 * (`RuntimeHost.instructAgent`), read by `RuntimeHost.instructionContext`, rendered as the
 * configured layer. ⚠️ A marker planted directly into a hand-built bundle would prove the provider
 * reads a file; this proves **the whole path** — database → context → compiler → publisher →
 * provider → model — which is the path `370` measured as broken end to end. ⚑ Until D-016 it rode
 * a project's description; projects went, and the person's own rules are the text a person types
 * that the bundle still carries.
 *
 * ⚑ **And that is what makes the resume arm honest.** Between close and resume the rules are
 * CHANGED, exactly as a person editing them would. If the child comes back quoting the new ones,
 * the live-profile semantic `158` §2 ruled holds through the new layer.
 *
 * ## 🔒 What this touches
 *
 * ⛔ Two cheap children per provider. Every home is provisioned fresh under this run's own scratch
 * root and removed in the `finally`. Nothing reads, writes or copies anything under a person's
 * `provider-homes/`, and nothing touches `:9444`. ⚠️ **The Codex credential is the one exception and
 * it is named rather than hidden**: a Codex child cannot run without an `auth.json`, so
 * `provisionCodexAuth` copies the machine login into each throwaway home exactly as every committed
 * Codex probe already does. The copies go with the homes.
 */

const CHEAP: Readonly<Record<Provider, string>> = {
  claude: 'claude-haiku-4-5-20251001',
  codex: 'gpt-5.6-luna',
}

/** ⛔ Per-process and per-arm, so a match can never be an echo of another run's evidence. */
const marker = (what: string): string => `BROBOT_377_${what}_${process.pid}`

class Recorder implements RuntimeEventSink {
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  /** Not a person: an automated probe may command a session and may never answer a permission. */
  readonly aPersonIsBehindIt = false
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
  replies(): string {
    return this.messages
      .map((one) => one.event)
      .filter((one): one is Extract<TranscriptEvent, { type: 'assistant_message' }> =>
        Boolean(one && one.type === 'assistant_message'),
      )
      .map((one) => one.text)
      .join('\n')
  }
}

const say = (line: string): void => {
  process.stdout.write(`${line}\n`)
}

async function until(what: string, ms: number, check: () => boolean): Promise<boolean> {
  const deadline = Date.now() + ms
  for (;;) {
    if (check()) return true
    if (Date.now() > deadline) {
      say(`   … gave up waiting for ${what} after ${ms}ms`)
      return false
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
}

/**
 * ⛔ **The question is asked so that only READING the bundle can answer it.**
 *
 * ⚠️ **The marker is never in the prompt.** `362`'s own rule and `348`'s: a match against a value the
 * question contained would measure the model's ability to echo. The prompt names the SHAPE of the
 * line — which is in the bundle — and asks for the value.
 */
const ASK =
  `Your instructions include a section headed "${YOUR_OWN_INSTRUCTIONS_HEADING}". ` +
  'Reply with the single token in that section that begins with BROBOT_377_, and nothing else. ' +
  'If there is no such token, reply with the word NONE. Do not use any tools.'

it.each(['claude', 'codex'] as const)(
  '🔴 %s: a real child quotes its rendered bundle, and quotes the NEW one after a cold resume',
  { timeout: 900_000 },
  async (provider) => {
    const scratch = runScratch(`377-${provider}`)
    const userData = join(scratch, 'userData')
    const work = join(scratch, 'work')
    mkdirSync(userData, { recursive: true })
    mkdirSync(work, { recursive: true })
    const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
    const homes: string[] = []

    const db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
    const store = createSessionStore(db)
    ensureWorkspace(userData)
    let counter = 0

    // ⚑ **The composition root's own wiring, copied because it IS the thing under test.** The order
    // — compile, publish, read — is what `362` §1.4 measured as the only one that works.
    const host = new RuntimeHost({
      store,
      discoverSessions: NO_DISCOVERY,
      nativeTranscriptPath: () => null,
      exportDirectory: () => join(userData, 'exports'),
      createRuntime: (): AgentRuntime =>
        provider === 'codex'
          ? new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth)
          : new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider()),
      prepareProviderHome: async (which: Provider, profileId?: string) => {
        const home = join(managedRoot, `377-${which}-${profileId ?? 'default'}-${process.pid}`)
        await provisionProviderHome(managedRoot, home)
        if (which === 'codex') await provisionCodexAuth(home)
        if (!homes.includes(home)) homes.push(home)
        return home
      },
      providerHomePath: (which, profileId) => join(managedRoot, `377-${which}-${profileId}`),
      resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
      newSessionId: () => `sess_${++counter}`,
      readProviderConfig: (which, home) => ({
        home,
        homeEnv: which === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
        model: 'live',
        authNote: null,
        files: [],
      }),
      readInstructions: (which, cwd, providerHome, context) => {
        const bundle = publishProfileBundle(which, providerHome, composeProfileBundle(context))
        const read = readSessionInstructions({
          provider: which,
          cwd,
          providerHome,
          bundle,
          // 🔴 **D-024 · R1 — what is true of THIS conversation is composed beside the file**, as
          // `main/index.ts` composes it: the file no longer carries it, and a shim without it would
          // launch a live child on text no production launch sends.
          // 🔴 **D-039 · and on Codex it opens with how to use the brobot tools** — the one decision
          // `main/index.ts` makes (`toolsToldInTextFor`), since that provider's catalogue cannot hold
          // them; ⛔ nothing on Claude, which is handed them with its catalogue. Without it a Codex
          // child here is told less than a production one about the tools it is offered.
          thisConversation: thisConversationSpans(context, toolsToldInTextFor(which)),
          workspaceFile: join(brobotWorkspace(userData), CLAUDE_INSTRUCTIONS_FILE),
          // 🔴 **594 · this shim is a HAND COPY of `main/index.ts`'s composition**, and a
          // field added there has to be added here or the one instrument that can see a LIVE
          // prompt goes on measuring the reader as it was. ⛔ Without it a real child still
          // receives the workspace body twice, under the only thing that could have said so.
          workspaceOwnFiles: workspaceOwnFilesIn(userData),
        })
        return {
          instructions: read.instructions,
          // ⚑ **D-024 · R1 — the reader says which channel carries the composition**: Claude's
          // system prompt, or the first message of each Codex life. ⛔ A recomposition of
          // `injected` here would drop this conversation's own block on Claude.
          systemHint: read.systemHint ?? undefined,
          ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
          memoryLoaded: read.memoryLoaded,
        }
      },
    })

    const first = marker('FIRST')
    const second = marker('SECOND')
    const window = new Recorder('webContents:1')

    try {
      // ── 1 · the identity's own rules carry the marker, exactly as a person would type them ────
      // ⛔ **The identity is brought into being first, with no turn sent**: a person may not write
      // rules for a name that does not exist yet (criterion 12), and the rules must be in place
      // before the launch that is measured.
      const handshake = await host.createSession(
        { provider, profileId: 'teller-worker', cwd: work, model: CHEAP[provider] },
        window,
      )
      await host.close(handshake.sessionId, window)
      expect(
        host.instructAgent(
          'teller-worker',
          `Everything here is a live probe. ${first}`,
          undefined,
          window,
        ),
      ).not.toBeNull()

      // ── 2 · a real child, launched on those rules ─────────────────────────────────────────────
      const opened = await host.createSession(
        {
          provider,
          profileId: 'teller-worker',
          cwd: work,
          model: CHEAP[provider],
          approvalMode: 'auto',
        },
        window,
      )
      say(`1 · ${provider} child ${opened.sessionId} launched as 'teller-worker'`)

      // ⛔ **The leaf really is on disk, under the name this dialect reads.** Asserted before the
      // turn so a failure downstream can be told apart from a publish that never happened.
      const home = homes.at(-1) as string
      const leaf = join(home, BUNDLE_LEAF[provider])
      expect(readFileSync(leaf, 'utf8')).toContain(first)
      say(`   published ${leaf}`)

      await host.send(opened.sessionId, ASK, window)
      const answered = await until('the first reply', 300_000, () =>
        window.replies().includes('BROBOT_377_'),
      )
      say(`2 · reply: ${JSON.stringify(window.replies().slice(-200))}`)
      expect(answered, 'the child answered').toBe(true)
      // 🔴 **The oracle is the child's own words**, and both directions are asserted: it quoted the
      // marker that was in its bundle, and not the one that was not.
      expect(window.replies()).toContain(first)
      expect(window.replies()).not.toContain(second)

      // ── 3 · change the rules, close, and COLD RESUME ──────────────────────────────────────────
      await host.close(opened.sessionId, window)
      expect(
        host.instructAgent(
          'teller-worker',
          `Everything here is a live probe. ${second}`,
          undefined,
          window,
        ),
      ).not.toBeNull()
      say('3 · closed, rules changed; resuming…')

      const resumed = new Recorder('webContents:2')
      await host.resumeSession(opened.sessionId, resumed)
      // ⚠️ The leaf was republished by the resume itself, before the provider was handed anything.
      expect(readFileSync(leaf, 'utf8')).toContain(second)

      await host.send(opened.sessionId, ASK, resumed)
      const again = await until('the reply after resume', 300_000, () =>
        resumed.replies().includes('BROBOT_377_'),
      )
      say(`4 · reply after resume: ${JSON.stringify(resumed.replies().slice(-200))}`)
      expect(again, 'the resumed child answered').toBe(true)
      // ⛔ **`362` §1.3's finding, now a property of the app**: *"a file edit takes effect at the
      // next provider-process launch, INCLUDING a cold resume."* ⚠️ The negative is the load-bearing
      // half — a resume that replayed the launch's text would still contain the FIRST marker.
      expect(resumed.replies()).toContain(second)
      expect(resumed.replies()).not.toContain(first)
      say(`✅ ${provider}: bundle read at launch AND re-read at cold resume`)
    } finally {
      await host.closeAll()
      db.close()
      for (const home of homes) rmSync(home, { recursive: true, force: true })
      rmSync(scratch, { recursive: true, force: true })
    }
  },
)

/**
 * 🔴 **§2 · the repository's own `AGENTS.md`, on both engines — `364`'s concrete gap, closed.**
 *
 * ⛔ **`364` measured a real repository with an `AGENTS.md` of 1,929 bytes and no `CLAUDE.md` of any
 * spelling.** Codex reads that file natively; before this dispatch Claude's reader selected neither
 * of the two files that are there, so the two engines were given different conventions for the
 * same directory.
 *
 * ## ⚠️ Two arms, because only one of them may touch the real repository
 *
 *  - **The static arm reads a real repository of that shape**, named by `BROBOT_SMOKE_AGENTS_REPO`,
 *    and asks which file this app now selects for a Claude session whose cwd is that directory.
 *    With the variable unset, the arm is skipped and says so. ⛔ **Nothing is launched there and
 *    nothing is written there** — it is one `readSessionInstructions` call over a directory, which
 *    is the same bounded read `364` made.
 *  - **The live arm runs the children in a DISPOSABLE git repository carrying those same bytes**
 *    plus one appended marker line. ⚑ Running a real agent in that repository to prove a reader
 *    works would put an agent in a person's repository to answer a question about a file read.
 */
const AGENTS_REPO = process.env.BROBOT_SMOKE_AGENTS_REPO ?? ''

it(
  '🔴 both engines get the repository’s shared conventions, and Codex gets them exactly once',
  { timeout: 900_000 },
  async () => {
    const scratch = runScratch('377-bridge')
    const userData = join(scratch, 'userData')
    mkdirSync(userData, { recursive: true })
    const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
    const homes: string[] = []

    // ── the static arm · the real repository, read and not run in ─────────────────────────────
    const real = AGENTS_REPO === '' ? '' : join(AGENTS_REPO, 'AGENTS.md')
    if (real === '' || !existsSync(real)) {
      say(
        real === ''
          ? '⚠️ BROBOT_SMOKE_AGENTS_REPO is not set; the static arm is skipped and says so'
          : `⚠️ ${real} is not on this machine; the static arm is skipped and says so`,
      )
    } else {
      const home = join(scratch, 'static-home')
      mkdirSync(home, { recursive: true })
      const read = readSessionInstructions({
        provider: 'claude',
        cwd: AGENTS_REPO,
        providerHome: home,
      })
      const picked = read.instructions.injected.filter(
        (item) => item.kind === 'repository-conventions',
      )
      say(`static · Claude selects ${picked.map((item) => item.path).join(', ') || 'NOTHING'}`)
      expect(picked.map((item) => item.path)).toContain(real)
      // ⚠️ The bytes really are the repository's, not an empty read that happened to match a path.
      expect(picked[0]?.bytes).toBeGreaterThan(1000)
    }

    // ── the live arm · a disposable repository carrying the same bytes ─────────────────────────
    const repo = join(scratch, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const shared = marker('SHARED')
    writeFileSync(
      join(repo, 'AGENTS.md'),
      `${real !== '' && existsSync(real) ? readFileSync(real, 'utf8') : '# Conventions\n'}\n\nConvention marker: ${shared}\n`,
    )

    const db = openDatabase(join(userData, 'brobot2.sqlite'))
    applyMigrations(db, join(__dirname, '../src/main/db/migrations'))
    const store = createSessionStore(db)
    ensureWorkspace(userData)
    let counter = 0
    const hosts: RuntimeHost[] = []

    const buildHost = (provider: Provider): RuntimeHost => {
      const built = new RuntimeHost({
        store,
        discoverSessions: NO_DISCOVERY,
        nativeTranscriptPath: () => null,
        exportDirectory: () => join(userData, 'exports'),
        createRuntime: (): AgentRuntime =>
          provider === 'codex'
            ? new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth)
            : new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider()),
        prepareProviderHome: async (which: Provider, profileId?: string) => {
          const home = join(
            managedRoot,
            `377b-${which}-${profileId ?? 'default'}-${process.pid}-${++counter}`,
          )
          await provisionProviderHome(managedRoot, home)
          if (which === 'codex') await provisionCodexAuth(home)
          homes.push(home)
          return home
        },
        providerHomePath: (which, profileId) => join(managedRoot, `377b-${which}-${profileId}`),
        resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
        newSessionId: () => `sess_${provider}_${++counter}`,
        readProviderConfig: (which, home) => ({
          home,
          homeEnv: which === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
          model: 'live',
          authNote: null,
          files: [],
        }),
        readInstructions: (which, cwd, providerHome, context) => {
          const bundle = publishProfileBundle(which, providerHome, composeProfileBundle(context))
          const read = readSessionInstructions({
            provider: which,
            cwd,
            providerHome,
            bundle,
            // ⚑ **D-024 · R1**, and 🔴 **D-039**'s tools section on Codex — the first arm's shim says
            // why.
            thisConversation: thisConversationSpans(context, toolsToldInTextFor(which)),
            workspaceFile: join(brobotWorkspace(userData), CLAUDE_INSTRUCTIONS_FILE),
            workspaceOwnFiles: workspaceOwnFilesIn(userData),
          })
          return {
            instructions: read.instructions,
            systemHint: read.systemHint ?? undefined,
            ...(read.firstTurnLead === null ? {} : { firstTurnLead: read.firstTurnLead }),
            memoryLoaded: read.memoryLoaded,
          }
        },
      })
      hosts.push(built)
      return built
    }

    const ASK_SHARED =
      'Your instructions include this repository’s conventions. Reply with the single token there ' +
      'that begins with BROBOT_377_, and nothing else. If there is none, reply NONE. Use no tools.'

    try {
      // ⛔ **Claude: the app read it and appended it**, which is the half that did not exist.
      const claudeSink = new Recorder('webContents:1')
      const claudeHost = buildHost('claude')
      const claude = await claudeHost.createSession(
        {
          provider: 'claude',
          profileId: 'bridge-claude',
          cwd: repo,
          model: CHEAP.claude,
          approvalMode: 'auto',
        },
        claudeSink,
      )
      expect(
        claude.instructions.injected.filter((item) => item.kind === 'repository-conventions'),
        'Claude was given no repository conventions',
      ).toHaveLength(1)
      await claudeHost.send(claude.sessionId, ASK_SHARED, claudeSink)
      expect(
        await until('claude to quote the shared file', 300_000, () =>
          claudeSink.replies().includes('BROBOT_377_'),
        ),
      ).toBe(true)
      say(`claude · ${JSON.stringify(claudeSink.replies().slice(-120))}`)
      expect(claudeSink.replies()).toContain(shared)

      // ⛔ **Codex: EXACTLY ONCE.** `364` §2.3 — the app sends no copy, the provider reads its own,
      // and the durable leaf carries none of it.
      const codexSink = new Recorder('webContents:2')
      const codexHost = buildHost('codex')
      const codex = await codexHost.createSession(
        {
          provider: 'codex',
          profileId: 'bridge-codex',
          cwd: repo,
          model: CHEAP.codex,
          approvalMode: 'auto',
        },
        codexSink,
      )
      // 1 · the app appended no file at all…
      expect(codex.instructions.injected, 'BroBot sent Codex a copy').toEqual([])
      // ⚑ **D-024 · R1 — …and the one text it does send Codex carries none of the bytes**: this
      // conversation's own block, in front of the first message. Asserted present first, so the
      // negative measures. 🔴 **D-039** — that text now opens with how to use the brobot tools
      // (factory text, `toolsToldInTextFor`), which carries none of the repository's bytes either;
      // the block named here is still in it, after that section.
      expect(codex.instructions.composed).toContain('## This conversation')
      expect(
        codex.instructions.composed,
        'BroBot sent Codex a copy in front of the first message',
      ).not.toContain(shared)
      // 2 · …the durable leaf holds none of the repository's bytes…
      const codexHome = homes.at(-1) as string
      expect(readFileSync(join(codexHome, BUNDLE_LEAF.codex), 'utf8')).not.toContain(shared)
      // 3 · …and the PROVIDER's own report names the file once. ⚑ This is the oracle: the list comes
      // off the handle, not from anything this app derived.
      const named = codex.instructions.provider.filter((one) =>
        one.path.endsWith(join(repo, 'AGENTS.md')),
      )
      say(
        `codex · instructionSources: ${codex.instructions.provider.map((o) => o.path).join(', ')}`,
      )
      expect(named.length, 'Codex was told about the repository file more than once').toBe(1)
      await codexHost.send(codex.sessionId, ASK_SHARED, codexSink)
      expect(
        await until('codex to quote the shared file', 300_000, () =>
          codexSink.replies().includes('BROBOT_377_'),
        ),
      ).toBe(true)
      say(`codex · ${JSON.stringify(codexSink.replies().slice(-120))}`)
      expect(codexSink.replies()).toContain(shared)
      say('✅ both engines read the same repository conventions; Codex got them once')
    } finally {
      for (const built of hosts) await built.closeAll()
      db.close()
      for (const home of homes) rmSync(home, { recursive: true, force: true })
      rmSync(scratch, { recursive: true, force: true })
    }
  },
)
