import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { release, tmpdir, type } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import {
  claudeVersionTheSdkShips,
  CodexRuntime,
  provisionProviderHome,
  type AgentRuntime,
} from '@brobot2/runtime'
import type { Provider } from '@brobot2/shared'
import { codexAppServerArgs } from '../../../packages/runtime/src/codex/codex-runtime'
import { buildChildEnv } from '../../../packages/runtime/src/internal/child-env'
import { CODEX_PROTOCOL_VERSION } from '../../../packages/runtime/src/codex/protocol-version'
import {
  SpawnCodexTransport,
  type CodexIncoming,
  type CodexTransport,
} from '../../../packages/runtime/src/codex/codex-transport'
import { bundledCodexBinary } from '../../../packages/runtime/smoke/bundled-codex'
import { loopbackRuntime, startLoopback } from '../../../packages/runtime/smoke/loopback-claude'
import { probeRunDeadline, runBudgetMs } from '../../../packages/runtime/smoke/probe-run-deadline'
import { runEvidence } from '../../../packages/runtime/smoke/run-paths'
import { NO_DISCOVERY } from '../src/main/adopt/discover-sessions'
import { openDatabase } from '../src/main/db/connection'
import { applyMigrations } from '../src/main/db/migrate'
import { createSessionStore } from '../src/main/db/session-store'
import { readSessionInstructions } from '../src/main/runtime/instructions'
import { toolsToldInTextFor } from '../src/main/runtime/agent-tools'
import { profileBundleSpans, thisConversationSpans } from '../src/main/runtime/factory-text'
import { publishProfileBundle } from '../src/main/runtime/profile-bundle'
import { RuntimeHost, type RuntimeEventSink } from '../src/main/runtime/runtime-host'
import { resolveSessionCwd } from '../src/main/runtime/scratch-cwd'
import {
  brobotWorkspace,
  CLAUDE_INSTRUCTIONS_FILE,
  ensureWorkspace,
  workspaceOwnFilesIn,
} from '../src/main/runtime/workspace'
import type { RuntimeEventMessage } from '../src/shared/runtime-ipc'
import {
  claudeContextSections,
  claudeDeferredBuiltIns,
  claudeLoadedTools,
  claudeModelNamed,
  claudeParts,
  codexParts,
  keep,
  PLACEHOLDER,
  residueIn,
  type Scrub,
} from './provider-snapshot-parts'
import type { ProviderSnapshotFile, SnapshotPart } from '../src/shared/provider-snapshots'

/**
 * 🔴 **W4.164 · F093 R3 — `pnpm run snapshots:providers`: what each bundled provider puts in front
 * of its model on its own**, written to `src/main/provider-snapshots/{claude-code,codex}.json` and
 * shipped with the app. ⚑ **Run it whenever a bundled provider changes**: a test
 * (`provider-snapshots.test.ts`) fails while a snapshot's version is not the bundled one.
 *
 * ## How
 *
 * BroBot's REAL host — the wiring `main/index.ts` gives it, copied from the F093 map's probe —
 * starts a conversation per model and sends one message. The provider's own program answers to a
 * local stand-in model that records what it was sent and answers "Noted.". Each first request is
 * cut into the provider's own parts by `provider-snapshot-parts.ts`: BroBot's parts out, this
 * capture's facts made placeholders.
 *  - **Claude**: the SDK's bundled CLI on a loopback Messages endpoint, every model its own model
 *    list offers. ⚑ Tool search switched on (`ENABLE_TOOL_SEARCH`), as Claude Code switches it on
 *    for Anthropic's own servers and off for a local address — so the capture defers tools exactly
 *    as a real launch does.
 *  - **Codex**: the bundled app-server on a loopback Responses endpoint, every model in its own
 *    catalogue: the model decides the request's shape.
 *
 * ## 🔒 Nothing personal, no login, no credential
 *
 * Scratch data folder, scratch provider homes, scratch `HOME`, a `security` that finds nothing
 * first on the Claude CLI's `PATH`, the literal key `probe-only` sent only to the loopback port.
 * ⛔ A snapshot that still holds a path into this computer, or a word of BroBot's, is not written.
 */

const here = dirname(fileURLToPath(import.meta.url))
const SNAPSHOTS = join(here, '../src/main/provider-snapshots')
const migrationsFolder = join(here, '../src/main/db/migrations')

/** Each model's capture: its conversation started, its first request seen (about a second). */
const MODEL_MS = 20_000
const LIST_MS = 30_000
const TEARDOWN_MS = 10_000
/** At most this many models per provider: a catalogue is a handful (5 and 8 at this writing). */
const MODELS_AT_MOST = 12
const WAITS = [LIST_MS, ...Array.from({ length: MODELS_AT_MOST }, () => MODEL_MS), TEARDOWN_MS]
const deadline = probeRunDeadline(
  'provider-snapshots',
  runBudgetMs([...WAITS, ...WAITS]),
  TEARDOWN_MS,
)

class Window implements RuntimeEventSink {
  readonly aPersonIsBehindIt = true
  readonly messages: RuntimeEventMessage[] = []
  alive = true
  constructor(readonly ownerId: string) {}
  send(message: RuntimeEventMessage): void {
    this.messages.push(message)
  }
  sendLiveness(): void {}
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))
async function until(what: string, ms: number, done: () => boolean): Promise<void> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (done()) return
    await sleep(100)
  }
  throw new Error(`NOT PERFORMED — ${what} within ${String(ms)} ms`)
}

/** ⚑ A one-line memory, so the capture shows where a provider puts an agent's memory. */
function seedMemory(provider: Provider, home: string): void {
  if (provider === 'claude') {
    mkdirSync(join(home, 'memory'), { recursive: true })
    writeFileSync(join(home, 'memory', 'MEMORY.md'), '- [A note](a-note.md) — one line\n')
    writeFileSync(join(home, 'memory', 'a-note.md'), 'One line.\n')
  } else {
    mkdirSync(join(home, 'memories'), { recursive: true })
    writeFileSync(join(home, 'memories', 'memory_summary.md'), '# Memory summary\n\n- One line.\n')
    writeFileSync(join(home, 'memories', 'MEMORY.md'), '# Handbook\n\nOne line.\n')
  }
}

/**
 * ⚑ **W4.186 · Claude Code's own transcript of the conversation that sent `marker`**, in its
 * profile's scratch home: where it keeps each section of its context message, by name.
 */
function transcriptHolding(home: string, marker: string): string {
  const projects = join(home, 'projects')
  if (!existsSync(projects)) {
    throw new Error(`NOT PERFORMED — Claude Code kept no transcript of the ${marker} conversation`)
  }
  for (const folder of readdirSync(projects)) {
    for (const name of readdirSync(join(projects, folder))) {
      if (!name.endsWith('.jsonl')) continue
      const text = readFileSync(join(projects, folder, name), 'utf8')
      if (text.includes(marker)) return text
    }
  }
  throw new Error(`NOT PERFORMED — no transcript of the ${marker} conversation in its home`)
}

/** BroBot's host, wired as `main/index.ts` wires it, on this run's scratch folders. */
function hostFor(args: {
  userData: string
  managedRoot: string
  runtime: AgentRuntime
  afterProvision?: (provider: Provider, home: string) => void
}): { host: RuntimeHost; closeDatabase: () => void } {
  const { userData, managedRoot } = args
  let counter = 0
  const db = openDatabase(join(userData, 'brobot2.sqlite'))
  applyMigrations(db, migrationsFolder)
  const store = createSessionStore(db)
  const host = new RuntimeHost({
    store,
    discoverSessions: NO_DISCOVERY,
    nativeTranscriptPath: () => null,
    exportDirectory: () => join(userData, 'exports'),
    createRuntime: () => args.runtime,
    prepareProviderHome: async (which: Provider, profileId?: string) => {
      const home = join(managedRoot, `${profileId ?? 'default'}-${which}`)
      await provisionProviderHome(managedRoot, home)
      seedMemory(which, home)
      args.afterProvision?.(which, home)
      return home
    },
    providerHomePath: (which, profileId) => join(managedRoot, `${profileId}-${which}`),
    resolveCwd: (sessionId, requested) => resolveSessionCwd(userData, sessionId, requested),
    newSessionId: () => `sess_${String(++counter)}`,
    readProviderConfig: (which, home) => ({
      home,
      homeEnv: which === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR',
      model: 'live',
      authNote: null,
      files: [],
    }),
    whichBuild: () => ({ id: 'snapshot', commit: 'snapshot', dirty: false, schema: 7 }),
    readInstructions: (provider, cwd, providerHome, context) => {
      const composed = profileBundleSpans(context)
      const bundle = publishProfileBundle(provider, providerHome, composed.text)
      const read = readSessionInstructions({
        provider,
        cwd,
        providerHome,
        bundle,
        bundleComposed: composed,
        thisConversation: thisConversationSpans(context, toolsToldInTextFor(provider)),
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
  return { host, closeDatabase: () => db.close() }
}

/** Both spellings of a scratch path — the real one and the one `tmpdir()` gives — as one value. */
function bothSpellings(path: string, to: string): Scrub[] {
  const real = realpathSync(path)
  const scrubs: Scrub[] = [{ from: real, to }]
  if (real.startsWith('/private/')) scrubs.push({ from: real.slice('/private'.length), to })
  return scrubs
}

/** The shell the providers name: the name of `$SHELL`, as both write it. */
const shell = basename(process.env['SHELL'] ?? 'sh')

/** The values only this computer and this run have, and their placeholders. */
function scrubsFor(args: {
  cwd: string
  homes: string
  model: { name: string; id: string } | null
}): Scrub[] {
  const scrubs: Scrub[] = [
    ...bothSpellings(args.cwd, PLACEHOLDER.folder),
    // ⚑ Every profile's folder sits in `homes`: `<homes>/<profile>-<provider>` reads as one folder.
    ...bothSpellings(args.homes, '⟨provider-homes⟩'),
    ...bothSpellings(tmpdir(), PLACEHOLDER.tmp),
    // ⚑ Each where the provider writes it, never everywhere ("UTC" is also words of Codex's own),
    // and by its shape: each writes the date in this computer's own zone.
    { from: /Today's date is \d{4}-\d{2}-\d{2}/, to: `Today's date is ${PLACEHOLDER.date}` },
    {
      from: /<current_date>[^<]*<\/current_date>/,
      to: `<current_date>${PLACEHOLDER.date}</current_date>`,
    },
    { from: /<timezone>[^<]*<\/timezone>/, to: `<timezone>${PLACEHOLDER.timezone}</timezone>` },
    { from: `OS Version: ${type()} ${release()}`, to: `OS Version: ${PLACEHOLDER.osVersion}` },
    { from: `Shell: ${shell}`, to: `Shell: ${PLACEHOLDER.shell}` },
    { from: `<shell>${shell}</shell>`, to: `<shell>${PLACEHOLDER.shell}</shell>` },
  ]
  if (args.model !== null) {
    // ⚑ Only where Claude Code names THIS model: its own lists of models stay as written.
    const { name, id } = args.model
    scrubs.push({
      from: `the model named ${name}. The exact model ID is ${id}.`,
      to: `the model named ${PLACEHOLDER.modelName}. The exact model ID is ${PLACEHOLDER.modelId}.`,
    })
    scrubs.push({
      from: `Co-Authored-By: Claude ${name} <`,
      to: `Co-Authored-By: Claude ${PLACEHOLDER.modelName} <`,
    })
  }
  return scrubs
}

/** `⟨provider-homes⟩/<profile>-<provider>` → the one placeholder for this profile's folder. */
const providerHomeSpelled = (text: string): string =>
  text.replace(/⟨provider-homes⟩\/[\w.-]+/g, PLACEHOLDER.providerHome)

/** A part with every profile folder spelled as the one placeholder. */
const spelledHomes = (one: SnapshotPart): SnapshotPart => ({
  ...one,
  text: providerHomeSpelled(one.text),
  ...(one.tools === undefined
    ? {}
    : { tools: one.tools.map((tool) => ({ ...tool, text: providerHomeSpelled(tool.text) })) }),
})

/** A snapshot file, filled in as the captures come. */
type SnapshotFile = {
  -readonly [K in keyof ProviderSnapshotFile]: K extends 'models'
    ? Record<string, ProviderSnapshotFile['models'][string]>
    : K extends 'texts'
      ? Record<string, string>
      : K extends 'notes'
        ? string[]
        : ProviderSnapshotFile[K]
}

/** ⛔ Write a snapshot only when no text in it holds a path, a scratch value, or BroBot's words. */
function write(file: string, snapshot: SnapshotFile, extra: readonly string[]): void {
  // ⚑ …nor today's date, in this computer's zone or in UTC.
  const now = new Date()
  const local = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, '0'))
    .join('-')
  for (const [hash, text] of Object.entries(snapshot.texts)) {
    const residue = residueIn(text, [...extra, local, now.toISOString().slice(0, 10)])
    expect(residue, `text ${hash} of ${file} still holds ${residue.join(', ')}`).toEqual([])
  }
  mkdirSync(SNAPSHOTS, { recursive: true })
  writeFileSync(join(SNAPSHOTS, file), `${JSON.stringify(snapshot, null, 2)}\n`)
}

it(
  'Claude Code: its own prompt, context and tools, for every model it offers',
  () =>
    deadline.within('the Claude capture', async () => {
      const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snap-claude-')))
      const evidence = runEvidence('provider-snapshots')
      mkdirSync(evidence, { recursive: true })
      const appends: string[] = []
      const closing: (() => Promise<void> | void)[] = []
      const closeAll = async (): Promise<void> => {
        for (const close of closing.splice(0).reverse()) await close()
      }
      const release = deadline.own(closeAll)
      try {
        /**
         * ⚑ The stand-in model asks for every deferred built-in once — ToolSearch, by name — so
         * the next request carries their definitions in full; otherwise it answers "Noted.".
         */
        const searched = new Set<string>()
        const loop = await startLoopback((request) => {
          const marker = /SNAPSHOT-\d+-PERSON/.exec(JSON.stringify(request.body))?.[0]
          const names = claudeDeferredBuiltIns(request.body)
          if (marker !== undefined && !searched.has(marker) && names.length > 0) {
            searched.add(marker)
            return {
              kind: 'tool_use',
              name: 'ToolSearch',
              input: { query: `select:${names.join(',')}`, max_results: names.length },
              id: `toolu_snapshot_${String(searched.size)}`,
            }
          }
          return { kind: 'text', text: 'Noted.' }
        })
        closing.push(() => loop.close())
        const stubBin = join(scratch, 'bin')
        mkdirSync(stubBin, { recursive: true })
        // 🔒 A `security` that finds nothing: no Keychain is read, whatever the CLI asks.
        writeFileSync(join(stubBin, 'security'), '#!/bin/sh\nexit 44\n')
        chmodSync(join(stubBin, 'security'), 0o755)
        const fakeHome = join(scratch, 'home')
        mkdirSync(fakeHome, { recursive: true })
        const rig = await loopbackRuntime({
          scratch,
          label: 'rig',
          port: loop.port,
          rewrite: (options) => {
            const env = options.env as Record<string, string | undefined>
            env['ENABLE_TOOL_SEARCH'] = 'true'
            env['HOME'] = fakeHome
            env['PATH'] = `${stubBin}:${env['PATH'] ?? ''}`
            const prompt = options.systemPrompt as { append?: string } | string | undefined
            if (typeof prompt === 'object' && typeof prompt.append === 'string') {
              appends.push(prompt.append)
            }
          },
        })
        const userData = join(scratch, 'userData')
        mkdirSync(userData, { recursive: true })
        ensureWorkspace(userData)
        const managedRoot = join(rig.root, 'provider-homes')
        const { host, closeDatabase } = hostFor({ userData, managedRoot, runtime: rig.runtime })
        closing.push(closeDatabase, () => host.closeAll())
        const window = new Window('webContents:1')
        const version = claudeVersionTheSdkShips() ?? 'unknown'
        const snapshot: SnapshotFile = {
          provider: 'claude',
          version,
          label: `as of Claude Code ${version}`,
          defaultModel: null,
          notes: [
            'Captured on macOS, outside a git repository: in one, Claude Code also sends a snapshot of it.',
            'Captured on a stand-in sign-in with no account features, and with BroCrew’s server alone. A real conversation can have more deferred tools: its servers’ own; ListMcpResourcesTool, ReadMcpResourceTool and ReadMcpResourceDirTool when one of its servers offers resources; Monitor, PushNotification and DesignSync by its account. It can also have more skills, sub-agent types and servers’ instructions, by what its profile has installed.',
            'On a model whose server refuses a mid-conversation system message, Claude Code sends the context sections as reminders in the first message instead.',
            'Claude Code can also send one reserved tool, DeferredToolPlaceholder (“never call this tool”), marked deferred so the model is never shown it: it was in this capture, and is left out of the tools here.',
            'Captured with tool search on, as Claude Code turns it on for Anthropic’s own servers.',
            'Captured in a conversation that asks first.',
            'After a tool’s answer, Claude Code also adds a line of its own (“Tool loaded.”, tokens left): not kept here.',
          ],
          models: {},
          texts: {},
        }
        const listHome = join(managedRoot, 'list-claude')
        await provisionProviderHome(managedRoot, listHome)
        const listed = await rig.runtime.listModels({ providerHome: listHome })
        writeFileSync(join(evidence, 'claude-models.json'), JSON.stringify(listed, null, 2))
        expect(listed.length, 'Claude Code offered no model').toBeGreaterThan(0)
        expect(listed.length, 'more models than this probe’s budget').toBeLessThanOrEqual(
          MODELS_AT_MOST,
        )
        snapshot.defaultModel =
          listed.find((one) => (one as { isDefault?: boolean }).isDefault === true)?.id ??
          listed[0]?.id ??
          null
        for (const [index, { id: model }] of listed.entries()) {
          const marker = `SNAPSHOT-${String(index)}-PERSON`
          const before = loop.requests.length
          const session = await host.createSession(
            { provider: 'claude', profileId: `p${String(index)}`, approvalMode: 'ask', model },
            window,
          )
          await host.send(session.sessionId, `${marker} Hello.`, window)
          const seen = (): unknown[] =>
            loop.requests
              .slice(before)
              .map((one) => one.body)
              .filter((body) => JSON.stringify(body).includes(marker))
          await until(`the ${model} request`, MODEL_MS, () => seen().length > 0)
          const body = seen()[0]
          const names = claudeDeferredBuiltIns(body)
          // ⚑ The answer to its ToolSearch: the request after it, which carries the definitions.
          await until(`the ${model} deferred tools`, MODEL_MS, () =>
            names.length === 0
              ? true
              : seen().some((one) => JSON.stringify(one).includes('"tool_result"')),
          )
          const loaded = seen().find((one) => JSON.stringify(one).includes('"tool_result"'))
          writeFileSync(join(evidence, `claude-${model}.json`), JSON.stringify(body, null, 2))
          writeFileSync(
            join(evidence, `claude-${model}-loaded.json`),
            JSON.stringify(loaded ?? null, null, 2),
          )
          await host.close(session.sessionId, window)
          const named = claudeModelNamed(body)
          const scrubs = scrubsFor({
            cwd: resolveSessionCwd(userData, session.sessionId, undefined),
            homes: managedRoot,
            model: named,
          })
          const append = appends.find((one) =>
            JSON.stringify(body).includes(JSON.stringify(one).slice(1, -1)),
          )
          if (append === undefined) {
            throw new Error(`BroBot’s system text is not in the ${model} request`)
          }
          const deferred = loaded === undefined ? null : claudeLoadedTools(loaded, names, scrubs)
          expect(
            deferred?.tools?.map((one) => one.name) ?? [],
            `${model}: every deferred built-in, in full`,
          ).toEqual(names)
          const sections = claudeContextSections(
            transcriptHolding(join(managedRoot, `p${String(index)}-claude`), marker),
            marker,
          )
          writeFileSync(
            join(evidence, `claude-${model}-sections.json`),
            JSON.stringify(sections, null, 2),
          )
          const parts = [
            ...claudeParts(body, { append }, scrubs, sections),
            ...(deferred === null ? [] : [deferred]),
          ].map(spelledHomes)
          snapshot.models[model] = {
            shape: 'messages',
            alsoCalled:
              named === null || named.id === model || model === 'default' ? [] : [named.id],
            parts: keep(parts, snapshot.texts),
          }
          if (model === snapshot.defaultModel && named !== null) {
            snapshot.notes.push(
              `With no account, “${model}” ran ${named.name}; an account can make its default another model.`,
            )
          }
        }
        write('claude-code.json', snapshot, [basename(scratch), 'SNAPSHOT-', '⟨provider-homes⟩'])
      } finally {
        release()
        await closeAll()
        rmSync(scratch, { recursive: true, force: true })
      }
    }),
  deadline.testTimeoutMs,
)

// ──────────────────────────────────────── Codex: the bundled app-server, a Responses endpoint ───

const CODEX_KEY = 'BROBOT_SNAPSHOT_KEY'

function streamResponses(response: ServerResponse, id: string, text: string): void {
  const send = (kind: string, payload: Record<string, unknown>): void => {
    response.write(`event: ${kind}\ndata: ${JSON.stringify({ type: kind, ...payload })}\n\n`)
  }
  response.statusCode = 200
  response.setHeader('content-type', 'text/event-stream')
  send('response.created', { response: { id } })
  send('response.output_item.done', {
    output_index: 0,
    item: {
      type: 'message',
      id: `msg_${id}`,
      status: 'completed',
      role: 'assistant',
      content: [{ type: 'output_text', text, annotations: [] }],
    },
  })
  send('response.completed', {
    response: {
      id,
      usage: {
        input_tokens: 11,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 1,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 12,
      },
    },
  })
  response.end()
}

/** The product's transport, answering sign-in itself as an API-key login would. */
class SignedInByKey implements CodexTransport {
  constructor(private readonly inner: SpawnCodexTransport) {}
  get pid(): number | undefined {
    return this.inner.pid
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (method === 'getAuthStatus') {
      return Promise.resolve({ authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false })
    }
    if (method === 'account/read') {
      return Promise.resolve({ account: { type: 'apiKey' }, requiresOpenaiAuth: false })
    }
    return Promise.resolve(this.inner.request(method, params))
  }
  notify(method: string, params: unknown): void {
    this.inner.notify(method, params)
  }
  respond(id: string | number, result: unknown): void {
    this.inner.respond(id, result)
  }
  respondError(id: string | number, code: number, message: string): void {
    this.inner.respondError(id, code, message)
  }
  incoming(): AsyncIterable<CodexIncoming> {
    return this.inner.incoming()
  }
  close(): void | Promise<void> {
    return this.inner.close()
  }
}

it(
  'Codex: its own prompt, context and tools, for every model in its catalogue',
  () =>
    deadline.within('the Codex capture', async () => {
      const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snap-codex-')))
      const evidence = runEvidence('provider-snapshots')
      mkdirSync(evidence, { recursive: true })
      const closing: (() => Promise<void> | void)[] = []
      const closeAll = async (): Promise<void> => {
        for (const close of closing.splice(0).reverse()) await close()
      }
      const release = deadline.own(closeAll)
      try {
        const bodies: { url: string; body: unknown }[] = []
        const server = createServer((request, response) => {
          const chunks: Buffer[] = []
          request.on('data', (chunk: Buffer) => chunks.push(chunk))
          request.on('end', () => {
            let body: unknown
            try {
              body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
            } catch {
              body = null
            }
            bodies.push({ url: request.url ?? '', body })
            if (!(request.url ?? '').includes('/responses')) {
              response.statusCode = 404
              response.end('{}')
              return
            }
            streamResponses(response, `resp_${String(bodies.length)}`, 'Noted.')
          })
        })
        const port = await new Promise<number>((resolve, reject) => {
          server.once('error', reject)
          server.listen(0, '127.0.0.1', () => {
            const address = server.address()
            if (address === null || typeof address === 'string') reject(new Error('no port'))
            else resolve(address.port)
          })
        })
        closing.push(async () => {
          server.closeAllConnections()
          if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()))
        })
        const fakeHome = join(scratch, 'home')
        mkdirSync(fakeHome, { recursive: true })
        const runtime = new CodexRuntime(
          (context) =>
            new SignedInByKey(
              new SpawnCodexTransport(bundledCodexBinary(), codexAppServerArgs(), {
                cwd: context.cwd,
                // ⚑ The product's own child environment — its TMPDIR, SHELL, LANG and TZ — with
                // this run's home, Codex folder and stand-in key over it.
                env: buildChildEnv({
                  HOME: fakeHome,
                  CODEX_HOME: context.providerHome,
                  CODEX_SQLITE_HOME: context.providerHome,
                  [CODEX_KEY]: 'probe-only',
                }),
              }),
            ),
        )
        const configFor = (home: string, model: string): void => {
          writeFileSync(
            join(home, 'config.toml'),
            [
              `model = "${model}"`,
              'model_provider = "snapshot"',
              '',
              '[model_providers.snapshot]',
              'name = "BroBot provider snapshot"',
              `base_url = "http://127.0.0.1:${String(port)}/v1"`,
              `env_key = "${CODEX_KEY}"`,
              'request_max_retries = 0',
              'stream_max_retries = 0',
              '',
            ].join('\n'),
          )
        }
        const userData = join(scratch, 'userData')
        mkdirSync(userData, { recursive: true })
        ensureWorkspace(userData)
        const managedRoot = join(scratch, 'provider-homes')
        mkdirSync(managedRoot, { recursive: true })
        let modelNow = ''
        const { host, closeDatabase } = hostFor({
          userData,
          managedRoot,
          runtime,
          afterProvision: (which, home) => {
            if (which === 'codex') configFor(home, modelNow)
          },
        })
        closing.push(closeDatabase, () => host.closeAll())
        const window = new Window('webContents:1')
        const snapshot: SnapshotFile = {
          provider: 'codex',
          version: CODEX_PROTOCOL_VERSION,
          label: `as of Codex ${CODEX_PROTOCOL_VERSION}`,
          defaultModel: null,
          notes: [
            'Captured on macOS with an API key on a stand-in model, with the settings BroCrew gives Codex: an account can add apps and attribution text.',
            'Captured from the catalogue Codex ships: with a ChatGPT sign-in, Codex can refresh it from its server.',
            'Captured in a conversation that asks first: Codex’s sandbox rules differ in one that runs on its own.',
            'Codex also runs its own background memory writer on its own model; it is not part of an agent’s request, and not here.',
          ],
          models: {},
          texts: {},
        }
        const listHome = join(managedRoot, 'list-codex')
        await provisionProviderHome(managedRoot, listHome)
        configFor(listHome, 'gpt-5.5')
        const listed = await runtime.listModels({ providerHome: listHome })
        writeFileSync(join(evidence, 'codex-models.json'), JSON.stringify(listed, null, 2))
        expect(listed.length, 'Codex listed no model').toBeGreaterThan(0)
        expect(listed.length, 'more models than this probe’s budget').toBeLessThanOrEqual(
          MODELS_AT_MOST,
        )
        snapshot.defaultModel =
          listed.find((one) => (one as { isDefault?: boolean }).isDefault === true)?.id ?? null
        for (const [index, { id: model }] of listed.entries()) {
          modelNow = model
          const marker = `SNAPSHOT-${String(index)}-PERSON`
          const before = bodies.length
          const session = await host.createSession(
            { provider: 'codex', profileId: `p${String(index)}`, approvalMode: 'ask', model },
            window,
          )
          await host.send(session.sessionId, `${marker} Hello.`, window)
          const asked = (): unknown =>
            bodies.slice(before).find((one) => JSON.stringify(one.body).includes(marker))?.body
          await until(`the ${model} request`, MODEL_MS, () => asked() !== undefined)
          const body = asked()
          writeFileSync(join(evidence, `codex-${model}.json`), JSON.stringify(body, null, 2))
          await host.close(session.sessionId, window)
          const scrubs = scrubsFor({
            cwd: resolveSessionCwd(userData, session.sessionId, undefined),
            homes: managedRoot,
            model: null,
          })
          const cut = codexParts(
            body,
            scrubs,
            (text) => text.includes(marker) || text.startsWith('Composed by BroCrew'),
          )
          snapshot.models[model] = {
            shape: cut.shape,
            alsoCalled: [],
            parts: keep(cut.parts.map(spelledHomes), snapshot.texts),
          }
        }
        write('codex.json', snapshot, [basename(scratch), 'SNAPSHOT-', '⟨provider-homes⟩'])
      } finally {
        release()
        await closeAll()
        rmSync(scratch, { recursive: true, force: true })
      }
    }),
  deadline.testTimeoutMs,
)
