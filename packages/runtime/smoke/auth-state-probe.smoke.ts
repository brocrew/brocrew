import { spawn } from 'node:child_process'
import { chmodSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  describeHits,
  describeScan,
  filesContaining,
  pathsNaming,
  type Hit,
  type Marker,
} from '../../../scripts/lib/personal-home-guard.mjs'
import { codexAuthStateFrom, type AuthState } from '../src/index'
import { bundledCodexBinary } from './bundled-codex'

/**
 * What the Codex app-server SAYS about a credential, asked of the real binary (098).
 *
 * `pnpm run probe:auth-state`. This is the measurement `auth-probe.ts`'s table is written from, kept
 * runnable so the table can be re-checked against a new pin instead of trusted.
 *
 * ## 🔒 Every credential here is SYNTHETIC
 *
 * Nothing under `~/.codex` or `~/.claude` is written, and the run FAILS if anything this probe made
 * turns up there. That is not caution for its own sake: the profile copy and the machine credential
 * share one rotating refresh token, so a probe that used the real one — even read-only, even in a
 * temp home — could rotate it and break the user's CLI. The bug this file measures would then have
 * been caused by measuring it.
 *
 * ⛔ **176 replaced a before/after hash of `~/.codex/{auth.json,config.toml}` and `~/.claude.json`**,
 * which measured the machine rather than this probe — `174` collected the bill on three instruments
 * carrying the same control. What is asserted now is ownership, in both directions:
 *
 * | | |
 * |---|---|
 * | ⛔ **out** | not one of this probe's synthetic markers appears anywhere in `~/.codex` |
 * | ⛔ **in** | the machine's own refresh token appears nowhere in the temp home |
 * | ⚑ **and it can see** | the same scan finds every marker in the temp home, where they belong |
 *
 * ⚑ **The second row is a guarantee the retired control never gave.** A hash of `auth.json` says
 * whether the file changed; it says nothing about whether we READ it. The fear in the paragraph
 * above is a read, and this is the first version of this file that tests for one.
 *
 * The synthetic credentials are enough because `account/read` answers **locally**: a JWT signed with
 * `alg: none` and the email `probe@example.invalid` comes back as a signed-in ChatGPT account, which
 * no server would ever have agreed to. That is itself one of the findings, and it is what makes the
 * pre-flight free.
 */

const INIT = {
  clientInfo: { name: 'brobot2', title: null, version: '0.0.0' },
  capabilities: { experimentalApi: true, requestAttestation: false },
}

/** A minimal line-framed JSON-RPC client — the transport's own class is deliberately not exported. */
class Probe {
  private seq = 1
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >()
  private buffer = ''
  private readonly child

  constructor(home: string) {
    this.child = spawn(bundledCodexBinary(), ['app-server'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      // The same pinning the real spawn does — CODEX_HOME is the whole isolation.
      env: {
        PATH: process.env['PATH'],
        HOME: process.env['HOME'],
        CODEX_HOME: home,
        CODEX_SQLITE_HOME: home,
      },
    })
    this.child.stdout.setEncoding('utf8')
    this.child.stderr.resume() // drained so a chatty child cannot fill the pipe
    this.child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      let newline: number
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline).trim()
        this.buffer = this.buffer.slice(newline + 1)
        if (!line) continue
        let message: Record<string, unknown>
        try {
          message = JSON.parse(line) as Record<string, unknown>
        } catch {
          continue
        }
        if (typeof message['method'] === 'string') continue // notification
        const waiter = this.pending.get(message['id'] as number)
        if (!waiter) continue
        this.pending.delete(message['id'] as number)
        if (message['error']) waiter.reject(new Error(JSON.stringify(message['error'])))
        else waiter.resolve(message['result'])
      }
    })
  }

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.seq++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`)
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`timed out: ${method}`))
      }, 20_000)
      timer.unref?.()
    })
  }

  kill(): void {
    try {
      if (this.child.pid !== undefined) process.kill(-this.child.pid, 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

/** An unsigned JWT with the claims Codex reads. Not a credential — no server would accept it. */
function fakeJwt(claims: Record<string, unknown>): string {
  return [
    'eyJhbGciOiJub25lIn0',
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'unsigned',
  ].join('.')
}

const now = (): number => Math.floor(Date.now() / 1000)

/**
 * The synthetic strings this probe puts on disk — 🔒 not one of them is a credential.
 *
 * Every one is planted by {@link chatgptAuth} or by the api-key case, so the scan that hunts them in
 * `~/.codex` is hunting something this run demonstrably wrote. That is what makes the negative
 * meaningful, and it is the property `042` named: *a fresh id is ours alone*.
 */
const SYNTHETIC: Marker[] = [
  { label: 'the synthetic account email', value: 'probe@example.invalid' },
  { label: 'the synthetic refresh token', value: 'synthetic-refresh-token-not-real' },
  { label: 'the synthetic api key', value: 'sk-synthetic-not-real' },
]

/** Every file under `root`, for a directory small enough that reading all of it is honest. */
function filesUnder(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number): void => {
    if (depth > 4) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full, depth + 1)
      else if (entry.isFile()) out.push(full)
    }
  }
  walk(root, 0)
  return out
}

/**
 * The machine's own refresh token, as a NEEDLE — 🔒 read into memory, never printed, never written.
 *
 * `null` when the machine is signed out or on an api key, and the caller says so rather than
 * silently scanning for nothing: a needle that does not exist would make the check below pass over
 * an empty question, which is the vacuity `113` audited for.
 */
function machineRefreshToken(): Marker | null {
  try {
    const auth = JSON.parse(readFileSync(join(homedir(), '.codex', 'auth.json'), 'utf8')) as {
      tokens?: { refresh_token?: unknown }
    }
    const token = auth.tokens?.refresh_token
    return typeof token === 'string' && token.length >= 16
      ? { label: 'the MACHINE refresh token', value: token }
      : null
  } catch {
    return null
  }
}

/** A synthetic ChatGPT `auth.json` with the two token lifetimes under the caller's control. */
function chatgptAuth(idTokenExp: number, accessTokenExp: number): string {
  return JSON.stringify({
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: {
      id_token: fakeJwt({
        exp: idTokenExp,
        iat: now(),
        email: 'probe@example.invalid',
        'https://api.openai.com/auth': { chatgpt_plan_type: 'pro', chatgpt_account_id: 'probe' },
      }),
      access_token: fakeJwt({ exp: accessTokenExp, iat: now() }),
      refresh_token: 'synthetic-refresh-token-not-real',
      account_id: 'probe',
    },
    last_refresh: new Date().toISOString(),
  })
}

/** What one question cost: the answer, and 🔒 what was in the throwaway home when it was over. */
interface Asked {
  readonly state: AuthState
  /** The markers this run planted, found where they belong. Empty is a FAILURE, not a pass. */
  readonly ownMarkersHere: Hit[]
  /** 🔒 The machine credential, found where it must never be. Any hit is the defect. */
  readonly machineTokenHere: Hit[]
  /** The temp home's name, so the personal tree can be scanned for it by path (176). */
  readonly homeMarker: Marker
}

async function ask(label: string, authJson: string | null): Promise<Asked> {
  const home = join(tmpdir(), `brobot2-auth-probe-${process.pid}-${label}`)
  rmSync(home, { recursive: true, force: true })
  mkdirSync(home, { recursive: true, mode: 0o700 })
  if (authJson !== null) {
    writeFileSync(join(home, 'auth.json'), authJson)
    chmodSync(join(home, 'auth.json'), 0o600)
  }
  const probe = new Probe(home)
  try {
    await probe.request('initialize', INIT)
    const status = await probe.request('getAuthStatus', {
      includeToken: false,
      refreshToken: false,
    })
    const account = await probe.request('account/read', { refreshToken: false })
    const state = codexAuthStateFrom(status, account)
    console.log(
      `${label.padEnd(18)} authMethod=${JSON.stringify((status as Record<string, unknown>)['authMethod'])} ` +
        `account=${JSON.stringify((account as Record<string, unknown>)['account'])} → ${state.state}`,
    )
    // 🔒 Read the home while it still exists — after the `finally` there is nothing to testify with.
    const here = filesUnder(home)
    const machine = machineRefreshToken()
    return {
      state,
      ownMarkersHere: filesContaining(here, SYNTHETIC).hits,
      machineTokenHere: machine === null ? [] : filesContaining(here, [machine]).hits,
      homeMarker: {
        label: `the ${label} home`,
        value: `brobot2-auth-probe-${process.pid}-${label}`,
      },
    }
  } finally {
    probe.kill()
    rmSync(home, { recursive: true, force: true })
  }
}

it('codex auth-state probe — the four states, on the bundled binary', async () => {
  const far = now() + 86_400 * 365
  const past = now() - 86_400
  const asked: Asked[] = []
  const question = async (label: string, authJson: string | null): Promise<AuthState> => {
    const answer = await ask(label, authJson)
    asked.push(answer)
    return answer.state
  }

  // ⚠️ Each assertion is a PAIR with the one beside it: `absent` is only meaningful next to a
  // `usable` produced by the same code path on the same binary.
  expect((await question('no-credential', null)).state).toBe('absent')
  expect((await question('chatgpt-valid', chatgptAuth(far, far))).state).toBe('usable')

  // The discrimination that makes the pre-flight worth running: `account/read` follows the ACCESS
  // token, which is the one that has to be refreshed for a turn to run.
  expect((await question('access-expired', chatgptAuth(far, past))).state).toBe('stale')
  expect((await question('idtoken-expired', chatgptAuth(past, far))).state).toBe('usable')

  expect(
    (
      await question(
        'api-key',
        JSON.stringify({
          auth_mode: 'apikey',
          OPENAI_API_KEY: 'sk-synthetic-not-real',
          tokens: null,
        }),
      )
    ).state,
  ).toBe('usable')

  // ---- 🔒 isolation, keyed to what this run owns (176) ----
  //
  // ⛔ Three assertions, and the first is what makes the other two mean anything.
  expect(asked, 'every question ran').toHaveLength(5)

  // 1 · ⚑ the scan CAN see. Four of the five homes were handed a synthetic credential, and the scan
  //     finds it in each — so a silent scan below is silence about a question that was really asked.
  const carrying = asked.filter((answer) => answer.ownMarkersHere.length > 0)
  console.log(
    `\n── 🔒 isolation ──\n  homes carrying a synthetic marker : ${carrying.length}/5 ` +
      `(the fifth was handed no credential at all)`,
  )
  expect(carrying, 'the marker scan finds what this run planted, where it planted it').toHaveLength(
    4,
  )

  // 2 · ⛔ and nothing it planted is in the user's home. Whole tree, every depth — where the
  //     retired control hashed three named files and failed on any concurrent `codex` refresh.
  const codexHome = join(homedir(), '.codex')
  // ⛔ **The two `pathsNaming` spreads threw `is not iterable` until 202 corrected the
  // declaration**, so this check has never run to its assertion. `describeScan` folds the walks and
  // refuses to call an unfinished one clean; the file scan is separate because it is not a walk.
  const inFiles = filesContaining(
    [
      join(codexHome, 'auth.json'),
      join(codexHome, 'config.toml'),
      join(codexHome, 'history.jsonl'),
      join(codexHome, 'session_index.jsonl'),
    ],
    SYNTHETIC,
  )
  expect(
    inFiles.skipped,
    'every personal credential file this check accuses or clears was actually read',
  ).toEqual([])
  const leaked = describeScan(
    pathsNaming(
      codexHome,
      asked.map((answer) => answer.homeMarker),
    ),
    pathsNaming(join(homedir(), '.claude'), SYNTHETIC),
  )
  expect(describeHits(inFiles.hits), 'no synthetic credential of ours is in a personal file').toBe(
    'none',
  )
  expect(leaked, 'no synthetic credential of ours is in a personal home').toBe('none')

  // 3 · 🔒 and the machine's own credential never came the other way. This is the fear the header
  //     names — a probe that READ the real token could rotate it — and no before/after hash of
  //     `auth.json` could ever have detected it, because reading a file does not change it.
  const machine = machineRefreshToken()
  expect(
    machine,
    'the machine must be signed in to Codex, or this control scans for a needle that does not exist',
  ).not.toBeNull()
  const borrowed = asked.flatMap((answer) => answer.machineTokenHere)
  expect(describeHits(borrowed), 'the machine credential never entered a probe home').toBe('none')
}, 180_000)
