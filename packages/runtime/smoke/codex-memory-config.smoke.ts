import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 **A deep import, and deliberately.** `SpawnCodexTransport` is not re-exported from the package
// index (063, from 061 finding 4) because `createSpawnTransportFactory` is the ordinary way to get a
// transport and it sanitizes the child environment. This probe needs one variable in that
// environment — the loopback provider's `env_key` — so it owns the spawn on purpose, from inside the
// package the class belongs to. Nothing here widens the package's public surface.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { ensureCodexMemoryConfig } from '../src/index'
import { bundledCodexBinary } from './bundled-codex'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **314 §2.4 · prove the four memory tools from the CHILD, never from the file.**
 *
 * ## ⛔ Why a test that reads `config.toml` back proves nothing
 *
 * 312 measured Codex's TOML parser **silently accepting** `[memories] not_a_real_field = true` — no
 * error, no warning, nothing on stderr. So a green assertion that the four keys are on disk is an
 * assertion about our own writer and says nothing about whether the provider agreed. The oracle is
 * the four names
 *
 * ```
 * memories__list · memories__read · memories__search · memories__add_ad_hoc_note
 * ```
 *
 * ⚠️ **inside the code-mode `exec` surface**, not as top-level Responses tools: 312 found them in
 * `exec`'s model-visible deferred-tool description under `## memories`, and a probe that searched
 * the top-level tool array — or BroBot's own normalized `tool_call` events — would have measured
 * their absence and been wrong.
 *
 * ## ⚑ It costs no tokens, and that is 312's instrument rather than a new one
 *
 * The home targets an owned loopback Responses endpoint. Real `codex app-server` builds the
 * request, whose exact body is captured before a `400` response. Read the inventory where
 * availability is decided without paying for a turn; leave personal `provider-homes/`,
 * `~/.codex`, and `:9444` untouched.
 *
 * ## 🔴 Two arms, because a capture that finds nothing is not a measurement
 *
 * | arm | config | expected |
 * |---|---|---|
 * | **A · production** | the provider stanza, then `ensureCodexMemoryConfig` — the shipped writer | all four names present |
 * | **B · control** | the provider stanza + `[features] memories = true` **by hand** | all four names ABSENT |
 *
 * ⚠️ **Arm B is 312's exact negative and it is the half that makes arm A mean something.** The
 * feature gate alone genuinely turns memory on — the summary is injected — and exposes no tools at
 * all, because `dedicated_tools` defaults false. Without B, an arm A that found the names would be
 * consistent with the second gate doing nothing.
 *
 * ⚑ **Arm A also exercises the MERGE, not just the keys**: the provider stanza is written first and
 * the shipped writer merges into it, so a merge that clobbered the loopback provider would produce
 * a child that cannot reach the endpoint at all — a failure this probe cannot mistake for a pass.
 *
 * Run: `pnpm run probe:codex-memory`. Not part of `pnpm run ci`.
 */

const TOOL_NAMES = [
  'memories__list',
  'memories__read',
  'memories__search',
  'memories__add_ad_hoc_note',
] as const

/** The loopback model provider — one stanza, so both arms differ only in the memory keys. */
function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 314 capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_314_CAPTURE_KEY"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
}

interface Captured {
  readonly config: string
  readonly body: unknown
  readonly execDescription: string
  /** Whatever the transport said when a request failed — it carries the child's stderr tail. */
  readonly failure: string | null
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no loopback port')
  return address.port
}

/**
 * The `exec` tool's model-visible description, where 312 found the memory declarations. ⚑ Bundled
 * 0.160.0 nests `exec` one level down, inside a `functions` namespace, so namespaces are searched.
 */
function execDescriptionOf(body: unknown): string {
  const input = (body as { input?: unknown[] } | undefined)?.input
  if (!Array.isArray(input)) return ''
  const find = (tools: unknown): string | null => {
    if (!Array.isArray(tools)) return null
    for (const tool of tools) {
      const named = tool as { name?: string; description?: string; tools?: unknown[] }
      if (named.name === 'exec') return named.description ?? ''
      const nested = find(named.tools)
      if (nested !== null) return nested
    }
    return null
  }
  for (const item of input) {
    if ((item as { type?: string }).type !== 'additional_tools') continue
    const found = find((item as { tools?: unknown[] }).tools)
    if (found !== null) return found
  }
  return ''
}

async function captureInventory(label: string, write: (home: string) => void): Promise<Captured> {
  const scratch = runScratch('codex-memory')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const bodies: unknown[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      try {
        bodies.push(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        bodies.push(Buffer.concat(chunks).toString('utf8'))
      }
      response.statusCode = 400
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ error: { message: 'BROBOT_314_CAPTURED' } }))
    })
  })
  const port = await listen(server)
  writeFileSync(join(home, 'config.toml'), providerStanza(port))
  write(home)

  // ⛔ **The class, not the factory, and deliberately spelled out here** — the factory sanitizes the
  // child env, and this probe needs one variable in it: the loopback provider's `env_key`. The
  // transport's own docblock asks for exactly this, an explicit `env` at a call site a reviewer can
  // see, rather than a default nobody notices. ⚠️ No credential of any kind is placed in this home.
  const transport = new SpawnCodexTransport(
    bundledCodexBinary(),
    ['app-server', '--strict-config'],
    {
      cwd,
      env: {
        PATH: process.env['PATH'] ?? '',
        HOME: root,
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: home,
        BROBOT_314_CAPTURE_KEY: 'probe-only',
      },
    },
  )
  // ⚠️ Server→client requests must be answered or the child waits on us forever. This probe
  // implements none of them, and says so on the wire rather than by going quiet.
  const pump = (async () => {
    for await (const incoming of transport.incoming()) {
      if (incoming.kind === 'request') {
        transport.respondError(
          incoming.id,
          -32601,
          `the 314 probe does not implement ${incoming.method}`,
        )
      }
    }
  })()

  let failure: string | null = null
  try {
    await transport.request('initialize', {
      clientInfo: { name: 'brobot-314-probe', title: 'BroBot 314 memory probe', version: '0.0.0' },
      capabilities: { experimentalApi: true, requestAttestation: false },
    })
    transport.notify('initialized', {})
    const started = (await transport.request('thread/start', {
      model: 'gpt-5.6-luna',
      modelProvider: 'capture',
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'danger-full-access',
      ephemeral: true,
    })) as { thread?: { id?: string } }
    void transport.request('turn/start', {
      threadId: started.thread?.id,
      input: [{ type: 'text', text: `314 inventory ${label}`, text_elements: [] }],
      cwd,
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
      model: 'gpt-5.6-luna',
      effort: 'low',
    })
    const deadline = Date.now() + 60_000
    while (bodies.length === 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  } catch (error) {
    // ⚠️ Kept rather than thrown: a child that died carries its stderr tail in this message, and a
    // probe that hides why the app-server refused a config is the instrument going quiet.
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    await transport.close()
    await pump
    await new Promise((resolve) => server.close(() => resolve(undefined)))
  }

  const captured: Captured = {
    config: readFileSync(join(home, 'config.toml'), 'utf8'),
    body: bodies[0],
    execDescription: execDescriptionOf(bodies[0]),
    failure,
  }
  rmSync(root, { recursive: true, force: true })
  return captured
}

it('314 · the shipped writer puts the four memory tools in a real child’s inventory', async () => {
  const production = await captureInventory('production', (home) => {
    const result = ensureCodexMemoryConfig(home)
    expect(result.outcome, `the shipped writer refused: ${result.why ?? ''}`).toBe('written')
  })
  const control = await captureInventory('feature-only', (home) => {
    const path = join(home, 'config.toml')
    writeFileSync(path, `${readFileSync(path, 'utf8')}\n[features]\nmemories = true\n`)
  })

  const report = {
    production: {
      names: TOOL_NAMES.filter((name) => production.execDescription.includes(name)),
      execDescriptionBytes: production.execDescription.length,
      reachedTheEndpoint: production.body !== undefined,
      failure: production.failure,
    },
    control: {
      names: TOOL_NAMES.filter((name) => control.execDescription.includes(name)),
      execDescriptionBytes: control.execDescription.length,
      reachedTheEndpoint: control.body !== undefined,
      failure: control.failure,
    },
  }
  writeFileSync(
    runEvidence('codex-memory-inventory.json'),
    `${JSON.stringify({ report, productionConfig: production.config, controlConfig: control.config }, null, 2)}\n`,
  )
  console.log(`314 CODEX MEMORY INVENTORY — ${JSON.stringify(report)}`)

  // ⚑ **The instrument speaks before it is believed.** Both arms must have reached the endpoint and
  // produced an `exec` description at all; a probe whose child never called out would report an
  // empty control and an empty production arm and look like a clean negative.
  expect(production.body, 'arm A never reached the loopback endpoint').toBeDefined()
  expect(control.body, 'arm B never reached the loopback endpoint').toBeDefined()
  expect(production.execDescription.length).toBeGreaterThan(0)
  expect(control.execDescription.length).toBeGreaterThan(0)
  // …and the merge did not eat the provider stanza it was merged into.
  expect(production.config).toContain('base_url = "http://127.0.0.1:')
  expect(production.config).toContain('dedicated_tools = true')

  for (const name of TOOL_NAMES) {
    expect(production.execDescription, `${name} is missing from the child's inventory`).toContain(
      name,
    )
    // ⛔ 312's exact negative: the feature gate alone exposes none of them.
    expect(
      control.execDescription,
      `${name} appeared with only the FEATURE gate open`,
    ).not.toContain(name)
  }
}, 300_000)
