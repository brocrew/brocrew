import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  CodexRuntime,
  codexAuthHealth,
  provisionCodexAuth,
  provisionProviderHome,
  type RuntimeEvent,
} from '../src/index'
import { bundledCodexTransportFactory } from './bundled-codex'

/**
 * Does the provider actually READ the workspace instruction file? (Slice 2 · 006)
 *
 * A workspace whose instruction file the agent ignores is a lie, and the file existing proves
 * nothing. This puts a token no model would produce unprompted into `AGENTS.md` in the cwd and asks
 * the agent to repeat it. Codex only — it is free; the Claude answer is established separately.
 */
const CANARY = 'BROBOT-PROJECT-CANARY-8D31'

it('codex reads a project AGENTS.md from its cwd', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'brobot2-canary-ws-'))
  writeFileSync(
    join(workspace, 'AGENTS.md'),
    `# Fictional project\n\nThis file belongs to the project.\n\nInstruction marker: ${CANARY}\n`,
  )

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `codex-canary-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)
  await provisionCodexAuth(providerHome)

  const handle = await new CodexRuntime(bundledCodexTransportFactory(), codexAuthHealth).start({
    cwd: workspace,
    providerHome,
  })
  const events: RuntimeEvent[] = []
  const consumer = (async () => {
    for await (const e of handle.events()) events.push(e)
  })()

  try {
    await handle.send(
      'Your instructions contain a line beginning "Instruction marker:". Reply with that marker value and nothing else. Do not run any tools.',
    )
    const deadline = Date.now() + 180_000
    while (!events.some((e) => e.type === 'turn') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }
    const reply = events
      .filter((e) => e.type === 'assistant_message')
      .map((e) => (e.type === 'assistant_message' ? e.text : ''))
      .join('\n')
    console.log(
      `CODEX CANARY — surfaced=${reply.includes(CANARY)}, reply=${JSON.stringify(reply.slice(0, 160))}`,
    )
    expect(reply, 'the agent must surface the canary from AGENTS.md').toContain(CANARY)
  } finally {
    await handle.close()
    await consumer
    rmSync(workspace, { recursive: true, force: true })
  }
}, 240_000)
