import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { query, type AccountInfo } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  claudeKeychainTokenProviderAsync,
  claudeKeychainTokenProviderForALaunch,
  provisionProviderHome,
  type ClaudeQuery,
  type QueryFactory,
  type SessionHandle,
} from '@brobot2/runtime'
import {
  closeBounded,
  loopbackRuntime,
  startLoopback,
  until,
  type Loopback,
} from '../../../packages/runtime/smoke/loopback-claude'
import { probeRunDeadline, runBudgetMs } from '../../../packages/runtime/smoke/probe-run-deadline'
import { runScratch } from '../../../packages/runtime/smoke/run-paths'
import { findClaudeProgramHere } from '../src/main/runtime/claude-program'

/**
 * # Which account Claude Code says a conversation is signed in to
 *
 * BroBot asks Claude Code who a conversation is signed in as through the Agent SDK's documented
 * `Query.accountInfo()`, and stamps usage readings with that account. This asks it once and prints
 * which fields came back, so we know what that interface answers when Claude Code runs on the
 * sign-in BroBot hands it.
 *
 * ⛔ **It never prints the email or the organization**: only whether each field came back, and the
 * values of `subscriptionType`, `tokenSource` and `apiProvider`. A value that could be the account
 * is withheld too. No prompt is sent: the answer comes with Claude Code's handshake.
 *
 * Two ways to run it:
 *  - `pnpm run probe:account-info` — on a fake token and a local model, inside a scratch home that
 *    keeps it from this computer's own sign-in. It checks the probe and BroBot's reading of the
 *    answer, and says what a sign-in nobody can name answers.
 *  - `BROBOT_ACCOUNT_PROBE=login pnpm run probe:account-info` — ⚠️ **on this computer's Claude Code
 *    sign-in**, handed over as BroBot hands it (`provider-homes.ts`' `createProviderRuntime`), to the
 *    Claude Code BroBot would run, in a scratch folder under `/tmp` that it deletes after. Only the
 *    person whose sign-in it is runs this one.
 */

const ON_THE_LOGIN = process.env['BROBOT_ACCOUNT_PROBE'] === 'login'

const ANSWER_MS = 90_000
const TEARDOWN_MS = 15_000

const deadline = probeRunDeadline(
  'which-account probe',
  runBudgetMs([ANSWER_MS, ANSWER_MS, TEARDOWN_MS]),
  TEARDOWN_MS,
)

/** What `accountInfo()` answered, as the product's own call received it. */
interface Noted {
  answered: boolean
  info: AccountInfo | null
}

/** The SDK's `query`, with the answer to `accountInfo()` noted on its way to the product. */
function noting(noted: Noted): QueryFactory {
  return (params) => {
    const live = query(params) as unknown as ClaudeQuery & { accountInfo(): Promise<AccountInfo> }
    return new Proxy(live, {
      get(target, prop) {
        if (prop === 'accountInfo') {
          return async (): Promise<AccountInfo> => {
            try {
              const info = await target.accountInfo()
              noted.info = info
              return info
            } finally {
              noted.answered = true
            }
          }
        }
        const value = Reflect.get(target, prop, target) as unknown
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value
      },
    })
  }
}

/** `yes` or `no`: whether a field came back with something in it. */
function present(value: unknown): 'yes' | 'no' {
  return typeof value === 'string' && value.trim() !== '' ? 'yes' : 'no'
}

/**
 * A field it may print, as it came back — or withheld, when it is not a short plain word or could
 * be the account itself.
 */
function shown(value: unknown, info: AccountInfo): string {
  if (value === undefined) return '(not sent)'
  if (typeof value !== 'string') return '(not text, withheld)'
  const plain = /^[\w.:-]{1,64}$/.test(value)
  const theAccount = [info.email, info.organization].some(
    (said) => typeof said === 'string' && said !== '' && value.includes(said),
  )
  return plain && !theAccount && !value.includes('@') ? value : '(withheld)'
}

/** A product Claude runtime, as the person asked: on this computer's sign-in, or on the rig. */
interface Launch {
  readonly runtime: ClaudeRuntime
  readonly cwd: string
  readonly providerHome: string
}

/** On this computer's sign-in, in `root`: the same readers and program as `createProviderRuntime`. */
async function onTheLogin(root: string, noted: Noted): Promise<Launch> {
  const managed = join(root, 'provider-homes')
  const providerHome = join(managed, 'claude')
  const cwd = join(root, 'cwd')
  mkdirSync(cwd, { recursive: true })
  mkdirSync(managed, { recursive: true })
  await provisionProviderHome(managed, providerHome)
  const program = findClaudeProgramHere({ isPackaged: false, given: undefined }).path
  const runtime = new ClaudeRuntime(
    noting(noted),
    undefined,
    claudeKeychainTokenProvider(),
    claudeKeychainTokenProviderAsync(),
    undefined,
    undefined,
    undefined,
    undefined,
    program,
    claudeKeychainTokenProviderForALaunch(),
  )
  return { runtime, cwd, providerHome }
}

async function measure(): Promise<void> {
  const noted: Noted = { answered: false, info: null }
  const base = ON_THE_LOGIN
    ? process.platform === 'win32'
      ? tmpdir()
      : '/tmp'
    : runScratch('which-account')
  mkdirSync(base, { recursive: true })
  const root = mkdtempSync(join(base, 'brobot-account-'))
  let loopback: Loopback | null = null
  let handle: SessionHandle | null = null
  const release = deadline.own(async () => {
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
  })
  const started = Date.now()
  try {
    let launch: Launch
    if (ON_THE_LOGIN) launch = await onTheLogin(root, noted)
    else {
      loopback = await startLoopback(() => ({ kind: 'text', text: 'ok' }))
      launch = await loopbackRuntime({
        scratch: root,
        label: 'fake-token',
        port: loopback.port,
        contain: true,
        sdkQuery: ((params: Parameters<QueryFactory>[0]) =>
          noting(noted)(params)) as unknown as typeof query,
      })
    }
    deadline.refuse('the launch')
    handle = await launch.runtime.start({ cwd: launch.cwd, providerHome: launch.providerHome })
    const on = handle
    await until(() => noted.answered, ANSWER_MS, 'Claude Code saying who is signed in')
    await until(() => on.account?.() !== undefined, ANSWER_MS, 'BroBot reading the answer')
    const info = noted.info ?? {}
    const named = present(info.email) === 'yes'
    const reads =
      on.account?.() === null ? 'account not known' : 'an account to stamp readings with'
    console.log(
      [
        '',
        `Which account Claude Code says it is signed in to — on ${
          ON_THE_LOGIN ? 'this computer’s sign-in' : 'a fake token and a local model'
        }`,
        `  accountInfo answered:  ${noted.info === null ? 'no, it failed' : 'yes'}`,
        `  email:                 ${present(info.email)}`,
        `  organization:          ${present(info.organization)}`,
        `  apiKeySource:          ${present(info.apiKeySource)}`,
        `  subscriptionType:      ${shown(info.subscriptionType, info)}`,
        `  tokenSource:           ${shown(info.tokenSource, info)}`,
        `  apiProvider:           ${shown(info.apiProvider, info)}`,
        `  BroBot reads it as:    ${reads}`,
        `  took:                  ${String(Math.round((Date.now() - started) / 1000))} s`,
        '',
      ].join('\n'),
    )
    // ⚑ The product's reading agrees with the answer: an account exactly when an email came back.
    expect(on.account?.() !== null).toBe(named)
  } finally {
    release()
    if (handle !== null) await closeBounded(handle, TEARDOWN_MS)
    await loopback?.close()
    rmSync(root, { recursive: true, force: true })
  }
}

it(
  'says which fields Claude Code’s accountInfo() answers, and BroBot reads them as it should',
  () => deadline.within('asking Claude Code who is signed in', measure),
  deadline.testTimeoutMs,
)
