import { execFile, execFileSync } from 'node:child_process'
import { accessSync, constants, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
const run = promisify(execFile)
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const taskpolicy = '/usr/sbin/taskpolicy'
/**
 * taskpolicy execs the durable Node in place: the guardian still owns that exact PID and group.
 * Windows takes the preload only as a file URL; a drive path there reads as a URL scheme.
 */
export function pluginServerLaunch(node, preload, options = {}) {
  let applicationPolicy = false
  const platform = options.platform ?? process.platform
  if (platform === 'darwin') {
    try {
      const info = (options.stat ?? lstatSync)(taskpolicy)
      if (info.isFile() && info.uid === 0) {
        const checkAccess = options.access ?? accessSync
        checkAccess(taskpolicy, constants.X_OK)
        applicationPolicy = true
      }
    } catch {
      // Missing/non-executable system utility: use precisely the existing plain Node launch.
    }
  }
  return {
    execPath: applicationPolicy ? taskpolicy : node,
    execArgv: [
      ...(applicationPolicy ? ['-a', node] : []),
      '--import',
      platform === 'win32' ? pathToFileURL(preload).href : preload,
    ],
  }
}
/** A scheduling snapshot only, never ownership/admission evidence. Raw ps text never leaves here. */
export function readPriorityClamped(pid, options = {}) {
  if ((options.platform ?? process.platform) !== 'darwin' || !Number.isSafeInteger(pid) || pid <= 1)
    return null
  try {
    const read =
      options.read ??
      ((ownedPid) =>
        execFileSync('/bin/ps', ['-p', String(ownedPid), '-o', 'pri=,nice='], {
          timeout: 750,
          maxBuffer: 4096,
          encoding: 'utf8',
          env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
        }))
    const value = read(pid)
    if (typeof value !== 'string' || value.length > 4096) return null
    const match = /^\s*(\d{1,3})\s+(-?\d{1,2})\s*$/.exec(value)
    if (!match) return null
    const priority = Number(match[1]),
      nice = Number(match[2])
    if (priority > 127 || nice < -20 || nice > 20) return null
    return priority <= 20 || nice > 0
  } catch {
    return null
  }
}
export function groupIdentity(pid) {
  let output
  try {
    output = execFileSync('/bin/ps', ['-p', String(pid), '-o', 'uid=,pgid=,lstart='], {
      timeout: 2000,
      maxBuffer: 4096,
      encoding: 'utf8',
      env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
    })
  } catch (error) {
    if (error.status === 1) return null
    throw error
  }
  const found = /^\s*(\d+)\s+(\d+)\s+(.+?)\s*$/.exec(output)
  return found && Number(found[2]) === pid ? `${found[1]}:${found[3]}` : null
}
export async function liveGroupMembers(group) {
  const { stdout } = await run('/bin/ps', ['-axo', 'pid=,pgid=,stat='], {
    timeout: 2000,
    maxBuffer: 4 * 1024 * 1024,
    env: { PATH: '/usr/bin:/bin', LC_ALL: 'C' },
  })
  return stdout.split('\n').flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)/.exec(line)
    return match && Number(match[2]) === group && !match[3].startsWith('Z')
      ? [Number(match[1])]
      : []
  })
}
/** On Windows the guardian's job ends the tree; a group here is the server by its creation time. */
export async function stopGroups(groups, graceMs = 1500) {
  if (process.platform === 'win32')
    return (
      groups instanceof Map && groups.size > 0 && endProcessesByIdentity(groups, graceMs + 2000)
    )
  const source = groups instanceof Map ? groups : new Map([...groups].map((pid) => [pid, null]))
  const identities = new Map(source)
  const active = new Set(source.keys())
  const retired = new Set()
  let certain = true
  const refresh = () => {
    for (const [group, birth] of source) {
      if (!identities.has(group)) identities.set(group, birth)
      if (!retired.has(group)) active.add(group)
    }
  }
  if ([...active].some((pid) => !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid))
    return false
  try {
    const signalled = { SIGTERM: new Set(), SIGKILL: new Set() }
    const signal = async (kind) => {
      refresh()
      for (const group of active) {
        if ((await liveGroupMembers(group)).length === 0) {
          active.delete(group)
          retired.add(group)
          continue
        }
        const birth = groupIdentity(group)
        if (birth && identities.get(group) && birth !== identities.get(group)) {
          certain = false
          active.delete(group)
          retired.add(group)
          continue
        }
        if (signalled[kind].has(group)) continue
        signalled[kind].add(group)
        try {
          process.kill(-group, kind)
        } catch (e) {
          if (e.code !== 'ESRCH') throw e
        }
      }
    }
    const gone = async () => {
      refresh()
      for (const group of active)
        if ((await liveGroupMembers(group)).length === 0) {
          active.delete(group)
          retired.add(group)
        }
      return active.size === 0
    }
    await signal('SIGTERM')
    let end = performance.now() + graceMs
    while (!(await gone()) && performance.now() < end) {
      await signal('SIGTERM')
      await pause(25)
    }
    if (active.size) await signal('SIGKILL')
    end = performance.now() + 2000
    while (!(await gone()) && performance.now() < end) {
      await signal('SIGKILL')
      await pause(25)
    }
    return active.size === 0 && certain
  } catch {
    return false
  }
}
/** Windows' own PowerShell, by its full path: never found by name. */
export function powershellPath(environment = process.env) {
  const root = environment.SystemRoot
  if (!root || !/^[A-Za-z]:\\[^;"<>|?*\0]*$/.test(root)) return null
  return join(root, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}
/**
 * For each process by number and creation time (a FILETIME, as the keeper gave it): ends it through
 * a handle opened on it if it still runs as that process, and waits for it. Resolves true once none
 * of them runs; a number now held by another process is left alone and counts as gone.
 */
export function endProcessesByIdentity(identities, ms = 3000) {
  const program = powershellPath()
  const list = [...identities]
    .filter(([pid, born]) => Number.isSafeInteger(pid) && pid > 0 && /^\d{1,20}$/.test(born ?? ''))
    .map(([pid, born]) => `${pid}:${born}`)
  if (!program || list.length !== identities.size) return Promise.resolve(false)
  const command =
    `$until = [DateTime]::UtcNow.AddMilliseconds(${Math.max(0, Math.trunc(ms))}); $all = $true; ` +
    `foreach ($t in '${list.join(' ')}'.Split(' ')) { $id, $born = $t.Split(':'); ` +
    'try { $p = [System.Diagnostics.Process]::GetProcessById([int]$id) } catch { continue }; ' +
    'try { $null = $p.Handle; ' +
    'if ([Math]::Abs($p.StartTime.ToFileTimeUtc() - [long]$born) -ge 10) { continue }; ' +
    '$p.Kill(); $left = [Math]::Max(0, [int]($until - [DateTime]::UtcNow).TotalMilliseconds); ' +
    'if (-not $p.WaitForExit($left)) { $all = $false } } ' +
    'catch { if (-not $p.HasExited) { $all = $false } } }; ' +
    "if ($all) { 'gone' } else { 'alive' }"
  return new Promise((resolve) => {
    execFile(
      program,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: ms + 5000, windowsHide: true, maxBuffer: 4096, encoding: 'utf8' },
      (error, stdout) => resolve(!error && stdout.trim() === 'gone'),
    )
  })
}

/** Milliseconds since 1970 as a Windows FILETIME (100 ns since 1601). */
export const fileTimeOf = (ms) => (BigInt(Math.trunc(ms)) + 11_644_473_600_000n) * 10_000n

/**
 * On Windows, after a guardian is lost: ends every process it started and everything they started,
 * found in the process table by parent and creation time, and waits until none of them runs. A
 * child counts when it was created after its parent, and, under a parent no longer running, no
 * later than a reading last saw that parent: a number reused since belongs to a stranger. Its
 * keeper is among them, and its exit closes the job, which ends the rest. True only once a reading
 * finds none of them running; false when the table cannot be read or one outlives `ms`. A reading
 * counts only when it read without any error and lists this reader itself and the process that
 * started it: an empty or partial table is no evidence that something is gone. `readCommand`
 * replaces the reading's PowerShell expression, for tests that simulate a failing one.
 */
export function endWindowsTree(rootPid, startedMs, endedMs, ms = 15000, options = {}) {
  const program = powershellPath()
  if (!program || !Number.isSafeInteger(rootPid) || rootPid <= 4) return Promise.resolve(false)
  const from = fileTimeOf(startedMs - 2000),
    until = fileTimeOf(endedMs + 2000)
  const read = options.readCommand ?? 'Get-CimInstance Win32_Process -ErrorAction Stop'
  const command =
    "$ErrorActionPreference = 'Stop'; try { " +
    `$root = ${rootPid}; $from = [long]${from}; $until = [long]${until}; ` +
    `$deadline = [DateTime]::UtcNow.AddMilliseconds(${Math.max(0, Math.trunc(ms))}); ` +
    '$known = @{}; $seen = @{}; ' +
    'do { $now = [DateTime]::UtcNow.ToFileTimeUtc(); ' +
    '$Error.Clear(); ' +
    `$all = @(${read} | ForEach-Object { [pscustomobject]@{ Id = [int]$_.ProcessId; ` +
    'Parent = [int]$_.ParentProcessId; Born = $(if ($_.CreationDate) { $_.CreationDate.ToFileTimeUtc() } else { 0 }) } }); ' +
    // A reading that raised anything, or that does not list this reader and its parent, is partial.
    "if ($Error.Count -gt 0) { 'unreadable'; exit }; " +
    '$me = @($all | Where-Object { $_.Id -eq $PID }); ' +
    "if ($me.Count -ne 1 -or @($all | Where-Object { $_.Id -eq $me[0].Parent }).Count -ne 1) { 'unreadable'; exit }; " +
    '$live = @{}; foreach ($p in $all) { $live["$($p.Id):$($p.Born)"] = $true }; ' +
    'foreach ($k in @($known.Keys)) { if ($live.ContainsKey($k)) { $seen[$k] = $now } }; ' +
    '$grew = $true; while ($grew) { $grew = $false; foreach ($p in $all) { $key = "$($p.Id):$($p.Born)"; if ($known.ContainsKey($key)) { continue }; ' +
    '$under = ($p.Parent -eq $root -and $p.Born -ge $from -and $p.Born -le $until); ' +
    'if (-not $under) { foreach ($k in @($known.Keys)) { $q = $known[$k]; if ($p.Parent -eq $q.Id -and $p.Born -ge $q.Born -and $p.Born -le $seen[$k]) { $under = $true; break } } }; ' +
    'if ($under) { $known[$key] = $p; $seen[$key] = $now; $grew = $true } } }; ' +
    '$running = @($known.Keys | Where-Object { $live.ContainsKey($_) }); ' +
    "if ($running.Count -eq 0) { 'gone'; exit }; " +
    'foreach ($k in $running) { $p = $known[$k]; try { $h = [System.Diagnostics.Process]::GetProcessById($p.Id); ' +
    'if ([Math]::Abs($h.StartTime.ToFileTimeUtc() - $p.Born) -lt 10) { $h.Kill() } } catch { } }; ' +
    'Start-Sleep -Milliseconds 250 } while ([DateTime]::UtcNow -lt $deadline); ' +
    "'alive' } catch { 'unreadable' }"
  return new Promise((resolve) => {
    execFile(
      program,
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: ms + 30_000, windowsHide: true, maxBuffer: 4096, encoding: 'utf8' },
      // Only the one word, alone, and nothing on standard error, is proof.
      (error, stdout, stderr) =>
        resolve(!error && stdout.trim() === 'gone' && String(stderr).trim() === ''),
    )
  })
}
