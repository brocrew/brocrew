import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
// 🔒 A deep import, for the reason `codex-memory-config.smoke.ts` states: `SpawnCodexTransport` is
// deliberately not re-exported from the package index (063, from 061 finding 4) because the factory
// sanitizes the child environment, and this probe needs the loopback provider's `env_key` in it.
import { SpawnCodexTransport } from '../src/codex/codex-transport'
import { codexMemoryIndex, codexMemorySummary, ensureCodexMemoryConfig } from '../src/index'
import { bundledCodexBinary } from './bundled-codex'
import { runEvidence, runScratch } from './run-paths'

/**
 * 🔴 **317 · the path the PANEL shows is the path the CHILD reads — and only one of them is in the
 * prompt.**
 *
 * ## ⛔ Why the unit tests cannot answer this
 *
 * Every assertion in `instructions.test.ts` writes the store with `codexMemorySummary()` and reads
 * it back through a reader that derives the same path from the same function. ⚠️ **A test that
 * plants and finds a file using one derivation passes whatever that derivation is** — 032's second
 * copy avoided, and the measurement avoided with it. If `memories/` were `memory/`, or the summary
 * lived one directory deeper, nothing in `pnpm run ci` would notice and the panel would confidently
 * show an empty store for a profile that remembers things.
 *
 * ⚑ **312 measured the tree, and could not close this.** Its probe seeded `memory_summary.md` at a
 * path it spelled by hand; that proves the BINARY reads that path and says nothing about what this
 * app derives. This joins the two: the file is planted by {@link codexMemorySummary} — the exact
 * function the instructions panel calls — and the oracle is the real 0.146.0 child's own request.
 *
 * ## ⚠️ CODEX_HOME versus CODEX_SQLITE_HOME, stated rather than assumed
 *
 * 312 pointed both variables at one directory, so its captures cannot say which one the store
 * follows. Neither can this, and it does not need to: `codex-runtime.ts` pins **both** to
 * `context.providerHome`, so for every home BroBot builds they are the same path. ⛔ The day they
 * diverge, this is the probe to re-run.
 *
 * ## 🔴 Two arms, and the second is 317 §2.2's whole claim measured on the wire
 *
 * | arm | seeded at | expected in the model request |
 * |---|---|---|
 * | **A · the injected one** | `memories/memory_summary.md` | ⚑ present |
 * | **B · the handbook** | `memories/MEMORY.md` | ⛔ ABSENT |
 *
 * ⚠️ **Arm B is what makes `reach` a measurement rather than an opinion.** The panel labels the
 * summary *"the provider put this in the prompt"* and the handbook *"it reads this one only if it
 * chooses to"*, and 009's rule is that a disclosure must not claim the model has read something it
 * has not. If both arms showed their marker, that second label would be a lie and this would say so.
 *
 * No credential enters any constructed home. The endpoint captures requests and answers
 * `400`, so no model turn is paid for. Personal `provider-homes/`, `~/.codex`, and `:9444`
 * stay untouched.
 *
 * Run: `pnpm run probe:codex-memory-store`. Not part of `pnpm run ci`.
 */

const MARKER_SUMMARY = 'BROBOT_317_SUMMARY_K4TQ'
const MARKER_INDEX = 'BROBOT_317_HANDBOOK_R7VX'

function providerStanza(port: number): string {
  return [
    'model = "gpt-5.6-luna"',
    'model_provider = "capture"',
    '',
    '[model_providers.capture]',
    'name = "BroBot 317 capture"',
    `base_url = "http://127.0.0.1:${port}/v1"`,
    'env_key = "BROBOT_317_CAPTURE_KEY"',
    'request_max_retries = 0',
    'stream_max_retries = 0',
    '',
  ].join('\n')
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

interface Captured {
  /** The whole outbound request, as JSON — the marker is looked for anywhere in it. */
  readonly body: string
  readonly failure: string | null
}

async function capture(label: string, seed: (home: string) => void): Promise<Captured> {
  const scratch = runScratch('codex-memory-store')
  mkdirSync(scratch, { recursive: true })
  const root = mkdtempSync(join(scratch, `${label}-`))
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })

  const bodies: string[] = []
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      bodies.push(Buffer.concat(chunks).toString('utf8'))
      response.statusCode = 400
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ error: { message: 'BROBOT_317_CAPTURED' } }))
    })
  })
  const port = await listen(server)
  writeFileSync(join(home, 'config.toml'), providerStanza(port))
  // ⚑ The SHIPPED writer, not a hand-written memory block: an arm that opened the gates by hand
  // would prove nothing about the home a user's profile actually gets.
  const written = ensureCodexMemoryConfig(home)
  expect(written.outcome, `the shipped writer refused: ${written.why ?? ''}`).toBe('written')
  seed(home)

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
        BROBOT_317_CAPTURE_KEY: 'probe-only',
      },
    },
  )
  // ⚠️ Server→client requests must be answered or the child waits on us forever.
  const pump = (async () => {
    for await (const incoming of transport.incoming()) {
      if (incoming.kind === 'request') {
        transport.respondError(
          incoming.id,
          -32601,
          `the 317 probe does not implement ${incoming.method}`,
        )
      }
    }
  })()

  let failure: string | null = null
  try {
    await transport.request('initialize', {
      clientInfo: {
        name: 'brobot-317-probe',
        title: 'BroBot 317 memory store probe',
        version: '0.0.0',
      },
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
      input: [{ type: 'text', text: `317 store ${label}`, text_elements: [] }],
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
    // Kept rather than thrown: a child that died carries its stderr tail here, and a probe that
    // hides why the app-server refused a config is the instrument going quiet.
    failure = error instanceof Error ? error.message : String(error)
  } finally {
    await transport.close()
    await pump
    await new Promise((resolve) => server.close(() => resolve(undefined)))
  }

  const captured: Captured = { body: bodies[0] ?? '', failure }
  rmSync(root, { recursive: true, force: true })
  return captured
}

/**
 * ⚑ **The directory has to be created, and that is itself worth noticing**: a Codex home the shipped
 * writer has just prepared has no `memories/` at all. That is the ordinary first state the panel is
 * silent about, observed here rather than assumed.
 */
function seedAt(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

it('317 · the summary at the panel’s own path is in the request, and the handbook is not', async () => {
  const summary = await capture('summary', (home) => {
    // ⛔ The binding. `codexMemorySummary` is the function `instructions.ts` derives the row from.
    seedAt(codexMemorySummary(home), `The user's working note: ${MARKER_SUMMARY}\n`)
  })
  const handbook = await capture('handbook', (home) => {
    seedAt(codexMemoryIndex(home), `# Handbook\n\n- the user's note: ${MARKER_INDEX}\n`)
  })

  const report = {
    summary: {
      marker: summary.body.includes(MARKER_SUMMARY),
      bytes: summary.body.length,
      failure: summary.failure,
    },
    handbook: {
      marker: handbook.body.includes(MARKER_INDEX),
      bytes: handbook.body.length,
      failure: handbook.failure,
    },
  }
  writeFileSync(runEvidence('codex-memory-store.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(`317 CODEX MEMORY STORE — ${JSON.stringify(report)}`)

  // ⚑ **The instrument speaks before it is believed.** Both arms must have reached the endpoint;
  // two children that never called out would report two clean negatives and look like a finding.
  expect(summary.body.length, 'arm A never reached the loopback endpoint').toBeGreaterThan(0)
  expect(handbook.body.length, 'arm B never reached the loopback endpoint').toBeGreaterThan(0)

  // A · the file the panel labels "the provider put this in the prompt" really is in the prompt.
  expect(summary.body, `${MARKER_SUMMARY} is missing — the panel derives the wrong path`).toContain(
    MARKER_SUMMARY,
  )
  // B · …and the one it labels "only if it chooses to" is NOT, which is what makes that label true.
  expect(
    handbook.body,
    `${MARKER_INDEX} was injected — the handbook is not on-request`,
  ).not.toContain(MARKER_INDEX)
}, 300_000)
