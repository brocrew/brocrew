import { execFile, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { powershellPath } from './process-groups.mjs'

/**
 * Starts the job keeper (`windows-job.ps1`, beside this file) and talks to it a line at a time.
 * The keeper is this process's ordinary child, so it ends with it, and its job, with every process
 * in it, ends with the keeper. Every answer has a deadline; a keeper that misses one is let go,
 * which ends the job. `cache` is a private folder the compiled job code is kept in between starts.
 * `opened` resolves to the milliseconds the keeper took to be ready, or null;
 * then `reason` says why, in one closed word, never the keeper's own text.
 */
/** The compiled job code's file in `folder`, named by the keeper script it was compiled from. */
function cacheFile(folder, script) {
  return join(folder, `job-${createHash('sha256').update(script).digest('hex').slice(0, 32)}.dll`)
}

/** Recover the whole recorded job, including descendants, after its owner has exited. */
export function recoverWindowsJob(name, cache) {
  const program = powershellPath()
  if (!program || !/^Local\\BroCrew\.Plugin\.[a-f0-9-]{36}$/.test(name))
    return Promise.resolve(false)
  const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'windows-job.ps1'))
  return new Promise((resolve) => {
    execFile(
      program,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script.toString('utf8'), 'utf16le').toString('base64'),
      ],
      {
        timeout: 120_000,
        windowsHide: true,
        encoding: 'utf8',
        maxBuffer: 16384,
        env: {
          ...process.env,
          BROCREW_PLUGIN_JOB_NAME: name,
          BROCREW_PLUGIN_JOB_RECOVER: '1',
          BROCREW_PLUGIN_JOB_CACHE: cacheFile(cache, script),
        },
      },
      (error, stdout, stderr) => resolve(!error && stdout.trim() === 'gone' && stderr.trim() === ''),
    )
  })
}
export function startJobKeeper(options = {}) {
  const name = options.name ?? `Local\\BroCrew.Plugin.${randomUUID()}`
  if (!/^Local\\BroCrew\.Plugin\.[a-f0-9-]{36}$/.test(name)) return failedKeeper('refused')
  const program = powershellPath()
  const started = performance.now()
  if (!program) return failedKeeper('no-powershell')
  const script = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'windows-job.ps1'))
  let child
  try {
    child = spawn(
      program,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script.toString('utf8'), 'utf16le').toString('base64'),
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env: {
          ...(options.env ?? process.env),
          BROCREW_PLUGIN_JOB_NAME: name,
          ...(options.cache ? { BROCREW_PLUGIN_JOB_CACHE: cacheFile(options.cache, script) } : {}),
        },
      },
    )
  } catch {
    return failedKeeper('no-powershell')
  }
  let errors = '',
    reason = null
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    if (errors.length < 16384) errors += chunk
  })
  const because = (why) => {
    reason ??= /malicious|antivirus|blocked by/i.test(errors)
      ? 'blocked'
      : /language mode|ConstrainedLanguage/i.test(errors)
        ? 'constrained'
        : /Add-Type|error CS\d|Cannot add type/i.test(errors)
          ? 'compile'
          : why
  }
  child.on('error', () => {})
  child.stdin.on('error', () => {})
  const waiting = []
  let buffered = '',
    gone = false
  const fail = (why = 'exited') => {
    because(why)
    gone = true
    for (const one of waiting.splice(0)) one(null)
    child.stdin.end()
    child.kill()
  }
  const keeperExited = new Promise((resolve) => child.once('exit', () => resolve(true)))
  child.once('exit', () => fail('exited'))
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffered += chunk
    if (buffered.length > 4096) return fail('refused')
    for (let end = buffered.indexOf('\n'); end >= 0; end = buffered.indexOf('\n')) {
      const line = buffered.slice(0, end).trim()
      buffered = buffered.slice(end + 1)
      waiting.shift()?.(line)
    }
  })
  const answer = (request, ms) =>
    new Promise((resolve) => {
      if (gone) return resolve(null)
      const timer = setTimeout(() => {
        fail('timeout')
      }, ms)
      waiting.push((line) => {
        clearTimeout(timer)
        resolve(line)
      })
      if (request !== null) child.stdin.write(request + '\n')
    })
  let cached = false
  const opened = answer(null, options.openMs ?? 20000).then((line) => {
    if (line !== 'ready' && line !== 'ready cached') {
      fail(line === null ? 'timeout' : 'refused')
      return null
    }
    cached = line === 'ready cached'
    return Math.round(performance.now() - started)
  })
  return {
    opened,
    get reason() {
      return reason
    },
    /** The keeper's own process number. */
    get pid() {
      return child.pid ?? null
    },
    /** Whether the open loaded the compiled job code from the cache rather than compiling it. */
    get cached() {
      return cached
    },
    /** Durable identity metadata; this observation alone is never empty-job evidence. */
    async identity() {
      if ((await opened) === null) return null
      const found = /^identity (\d{1,10}) (\d{1,20}) (\d{1,10}) (\d{1,20}) (\d{1,20})$/.exec(
        (await answer('identity', 5000)) ?? '',
      )
      if (
        !found ||
        Number(found[1]) !== process.pid ||
        Number(found[3]) !== child.pid ||
        BigInt(found[2]) <= 0n ||
        BigInt(found[4]) <= 0n ||
        BigInt(found[5]) > 18446744073709551615n
      )
        return null
      return {
        format: 1,
        name,
        guardian: { pid: Number(found[1]), birth: found[2] },
        keeper: { pid: Number(found[3]), birth: found[4] },
        boot: { kind: 'windows-tick64-v1', value: found[5] },
      }
    },
    /** The child's creation time (a FILETIME, as text) once it is in the job; null if refused. */
    async assign(pid) {
      if ((await opened) === null || !Number.isSafeInteger(pid) || pid <= 0) return null
      const line = await answer(`assign ${pid}`, 5000)
      const found = /^assigned (\d{1,20})$/.exec(line ?? '')
      return found ? found[1] : null
    },
    /** How many processes the job holds now, or null. */
    async count() {
      if ((await opened) === null) return null
      const found = /^count (\d{1,9})$/.exec((await answer('count', 3000)) ?? '')
      return found ? Number(found[1]) : null
    },
    /** Whether any process in the job runs below normal priority, or null when unknown. */
    async priorityClamped() {
      if ((await opened) === null) return null
      const line = await answer('priority', 3000)
      return line === 'priority below' ? true : line === 'priority normal' ? false : null
    },
    /** Ends every process in the job. */
    async terminate() {
      if ((await opened) === null) return false
      return (await answer('terminate', 3000)) === 'terminated'
    },
    /** Lets the keeper go, which ends the job and whatever it still holds. */
    close() {
      if (!gone) child.stdin.end()
    },
    /**
     * Lets the keeper go and waits for it to exit, which closes its job: given `graceMs` to read
     * its end of input, then ended through this process's handle on it, as one still compiling
     * its code would not read it. True once it has exited.
     */
    async end(graceMs = 2000) {
      if (!gone) child.stdin.end()
      const settled = (ms) =>
        Promise.race([keeperExited, new Promise((resolve) => setTimeout(() => resolve(false), ms))])
      if (await settled(graceMs)) return true
      child.kill()
      return settled(5000)
    },
  }
}

function failedKeeper(reason) {
  const none = async () => null
  return {
    opened: Promise.resolve(null),
    reason,
    pid: null,
    cached: false,
    identity: none,
    assign: none,
    count: none,
    priorityClamped: none,
    terminate: async () => false,
    close() {},
    end: async () => true,
  }
}
