/**
 * 706 · **A Codex-shaped app-server that refuses `thread/resume` the way `0.146.0` does.**
 *
 * ⚑ The handshake is answered as the real app-server answers it — its version in the `userAgent`'s
 * first token, the `CODEX_HOME` it was handed echoed back, an API-key sign-in — so the product's own
 * `CodexRuntime.resume` reaches `thread/resume` over the product's own `SpawnCodexTransport`. What
 * `thread/resume` gets back is the scenario's, and the refusals are the BYTES
 * `packages/runtime/smoke/codex-lost-thread-probe.smoke.ts` measured (706, bundled `codex-cli 0.146.0`):
 *
 * | scenario | the app-server's answer |
 * |---|---|
 * | `no-rollout` | `{"code":-32600,"message":"no rollout found for thread id <id>"}` — an id it never had, or a wiped home |
 * | `rollout-path` | `{"code":-32600,"message":"failed to resolve rollout path \`<path>\`: file does not exist"}` — its own record names a file that is gone |
 * | `died` | it exits — the transport's *"codex app-server exited"*, a failure of the attempt |
 * | `other-refusal` | a refusal of `thread/resume` for a reason that is not *"it is gone"* |
 * | `another-thread` | the not-found words, about a DIFFERENT thread |
 * | `another-code` | the not-found words under a code the app-server does not use for them |
 * | `another-rollout-path` | the rollout-path words, naming ANOTHER thread's file |
 * | `initialize-refused` | the not-found words about THIS thread — as the answer to `initialize` |
 * | `answers` | a matching thread — the resume succeeds |
 *
 * Env: `BROBOT_706_RESUME` (the scenario), `BROBOT_706_VERSION` (the protocol version to report),
 * `CODEX_HOME` (echoed, as the real one does).
 */
import { createInterface } from 'node:readline'
import { join } from 'node:path'

const scenario = process.env.BROBOT_706_RESUME ?? ''
const version = process.env.BROBOT_706_VERSION ?? '0.0.0'
const home = process.env.CODEX_HOME ?? ''
/** The thread the test resumes — the only one `initialize-refused` can name before it is asked. */
const asked = process.env.BROBOT_706_THREAD ?? ''

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const refuse = (id, code, message) => send({ id, error: { code, message } })

createInterface({ input: process.stdin }).on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.id === undefined || typeof message.method !== 'string') return
  const { id, method, params } = message
  if (method === 'initialize') {
    if (scenario === 'initialize-refused') {
      return refuse(id, -32600, `no rollout found for thread id ${asked}`)
    }
    return send({
      id,
      result: {
        userAgent: `brobot2/${version} (Mac OS 26.3.0; arm64) vscode/1.130.0 (brobot2; 0.0.0)`,
        codexHome: home,
        platformFamily: 'unix',
        platformOs: 'macos',
      },
    })
  }
  if (method === 'getAuthStatus') {
    return send({
      id,
      result: { authMethod: 'apikey', authToken: null, requiresOpenaiAuth: false },
    })
  }
  if (method === 'account/read') {
    return send({ id, result: { account: { type: 'apiKey' }, requiresOpenaiAuth: false } })
  }
  if (method === 'thread/resume') {
    const thread = String(params?.threadId ?? '')
    const rollout = join(
      home,
      'sessions',
      '2026',
      '09',
      '24',
      `rollout-2026-09-24T20-46-18-${thread}.jsonl`,
    )
    switch (scenario) {
      case 'no-rollout':
        return refuse(id, -32600, `no rollout found for thread id ${thread}`)
      case 'rollout-path':
        return refuse(
          id,
          -32600,
          `failed to resolve rollout path \`${rollout}\`: file does not exist`,
        )
      case 'died':
        return process.exit(1)
      case 'other-refusal':
        return refuse(
          id,
          -32600,
          `failed to load thread history for thread ${thread}: Too many open files (os error 24)`,
        )
      case 'another-thread':
        return refuse(
          id,
          -32600,
          'no rollout found for thread id 01990000-0000-7000-8000-00000000beef',
        )
      case 'another-rollout-path':
        return refuse(
          id,
          -32600,
          `failed to resolve rollout path \`${rollout.replace(thread, '01990000-0000-7000-8000-00000000beef')}\`: file does not exist`,
        )
      case 'another-code':
        return refuse(id, -32603, `no rollout found for thread id ${thread}`)
      case 'answers':
        return send({
          id,
          result: {
            thread: { id: thread, cwd: params?.cwd },
            model: 'gpt-5.6-luna',
            modelProvider: 'openai',
            cwd: params?.cwd,
            instructionSources: [],
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            sandbox: {
              type: 'workspaceWrite',
              writableRoots: [],
              networkAccess: false,
              excludeTmpdirEnvVar: false,
              excludeSlashTmp: false,
            },
            reasoningEffort: null,
          },
        })
      default:
        return refuse(id, -32601, `unscripted scenario: ${scenario}`)
    }
  }
  refuse(id, -32601, `unscripted: ${method}`)
})
