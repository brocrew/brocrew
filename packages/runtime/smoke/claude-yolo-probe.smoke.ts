import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type RuntimeEvent,
} from '../src/index'
import { runScratch } from './run-paths'

/**
 * ONE live Claude turn, to prove 080 against the real SDK — the 078 bug slipped precisely because
 * auto-approve was only asserted on the options shape, never exercised end to end. Deliberately
 * minimal (a single turn) because the Claude quota is nearly exhausted.
 */
it('claude auto-approve — a Bash command runs with NO card', async () => {
  const scratch = runScratch('claude-yolo-probe')
  mkdirSync(scratch, { recursive: true })
  const target = join(scratch, 'newfile.txt')

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-yolo-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  const runtime = new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
  // 038: the cheapest Claude — this probe is about whether approvals are raised, not about answers.
  const handle = await runtime.start({
    cwd: scratch,
    providerHome,
    approvalMode: 'auto',
    model: 'claude-haiku-4-5-20251001',
  })
  const events: RuntimeEvent[] = []
  const consumer = (async () => {
    for await (const event of handle.events()) events.push(event)
  })()

  try {
    await handle.send(
      `Use the Bash tool to run exactly: touch ${target} — then stop. Do not run any other command.`,
    )
    const deadline = Date.now() + 180_000
    while (!events.some((e) => e.type === 'turn') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }

    const cards = events.filter((e) => e.type === 'permission_request')
    const waiting = events.filter((e) => e.type === 'status' && e.state === 'waiting_permission')
    const landed = existsSync(target)
    console.log(
      `YOLO PROBE — cards=${cards.length} (must be 0), waiting_permission=${waiting.length} (must be 0), file=${landed ? 'written' : 'MISSING'}, terminal=${events
        .filter((e) => e.type === 'turn')
        .map((e) => (e.type === 'turn' ? e.state : ''))
        .join(',')}`,
    )
    // Truthful both ways: no card proves nothing unless the command actually ran.
    expect(cards).toHaveLength(0)
    expect(waiting).toHaveLength(0)
    expect(landed).toBe(true)
  } finally {
    await handle.close()
    await consumer
  }
}, 240_000)
