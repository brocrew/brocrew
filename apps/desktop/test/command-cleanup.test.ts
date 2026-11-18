import { alive } from '../../../packages/runtime/test/helpers/process-alive'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, mkdirSync, rmSync, realpathSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import {
  stopCommandsInFolders,
  stopWorkerCommands,
  workerCommandFolder,
} from '../src/main/command-cleanup'

it.skipIf(process.platform === 'win32').each(['ordinary', 'stubborn', 'nested'])(
  'reaps an orphan, preserving a live peer and outside command (%s)',
  async (kind) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orphan-cleanup-')))
    const own = join(root, 'worker-output', 'work-own')
    const outside = join(root, 'worker-output-sibling')
    mkdirSync(own, { recursive: true })
    mkdirSync(join(own, 'repo'))
    mkdirSync(join(root, 'brobot-workspace'))
    mkdirSync(outside)
    const grandchildFile = join(own, 'grandchild.pid')
    const command =
      kind === 'stubborn'
        ? 'trap "" TERM; exec tail -f /dev/null'
        : kind === 'nested'
          ? `/usr/bin/tail -f /dev/null & echo $! > '${grandchildFile}'; wait`
          : 'exec tail -f /dev/null'
    const peer = spawn('/usr/bin/tail', ['-f', '/dev/null'], { cwd: own, stdio: 'ignore' })
    const stranger = spawn('/usr/bin/tail', ['-f', '/dev/null'], { cwd: outside, stdio: 'ignore' })
    const peerExit = once(peer, 'exit')
    const strangerExit = once(stranger, 'exit')
    const launcher = spawn(
      process.execPath,
      [
        '-e',
        `
      const { spawn } = require('node:child_process')
      const child = spawn('sh', ['-c', ${JSON.stringify(command)}], { detached: true, stdio: 'ignore' })
      console.log(child.pid)
      child.unref()
    `,
      ],
      { cwd: own, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const launcherExit = once(launcher, 'exit')
    let orphan: number | undefined
    let grandchild: number | undefined
    try {
      const [chunk] = await once(launcher.stdout, 'data')
      orphan = Number(String(chunk).trim())
      await launcherExit
      expect(
        Number(
          execFileSync('ps', ['-o', 'ppid=', '-p', String(orphan)], { encoding: 'utf8' }).trim(),
        ),
      ).toBe(1)
      expect(alive(orphan)).toBe(true)
      if (kind === 'nested') {
        await vi.waitFor(() => expect(existsSync(grandchildFile)).toBe(true))
        grandchild = Number(readFileSync(grandchildFile, 'utf8').trim())
        expect(alive(grandchild)).toBe(true)
      }
      await stopWorkerCommands(root, own, () => [join(own, 'repo')])
      expect(alive(orphan)).toBe(true)
      await stopCommandsInFolders([own])
      await vi.waitFor(() => expect(alive(orphan!)).toBe(false))
      if (grandchild !== undefined) expect(alive(grandchild)).toBe(false)
      expect(alive(peer.pid!)).toBe(true)
      expect(alive(stranger.pid!)).toBe(true)
      expect(workerCommandFolder(root, join(own, 'repo'))).toBe(own)
      expect(workerCommandFolder(root, outside)).toBeNull()
      expect(workerCommandFolder(root, join(root, 'brobot-workspace'))).toBeNull()
      if (process.platform === 'darwin') {
        expect(workerCommandFolder(root, own.replace('/worker-output/', '/WORKER-OUTPUT/'))).toBe(
          own,
        )
      }
    } finally {
      if (orphan !== undefined && alive(orphan)) process.kill(orphan, 'SIGKILL')
      if (grandchild !== undefined && alive(grandchild)) process.kill(grandchild, 'SIGKILL')
      peer.kill('SIGTERM')
      stranger.kill('SIGTERM')
      await Promise.all([peerExit, strangerExit])
      rmSync(root, { recursive: true, force: true })
    }
  },
  12_000,
)
