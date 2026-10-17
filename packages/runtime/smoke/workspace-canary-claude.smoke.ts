import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  ClaudeRuntime,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type RuntimeEvent,
} from '../src/index'

/**
 * ONE live Claude turn that answers BOTH questions at once (Slice 2 · 006), because the Claude
 * quota is nearly exhausted:
 *
 *  1. does Claude read `CLAUDE.md` from the cwd under our real options (`settingSources: []`,
 *     `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`)?  →  the FILE marker
 *  2. does the same text delivered through the system prompt reach it?  →  the HINT marker
 *
 * Two distinct markers, one question, one turn.
 */
const FILE_MARKER = 'BROBOT-CANARY-FILE-9K3X'
const HINT_MARKER = 'BROBOT-CANARY-HINT-7Q4Z'

it('claude: which path actually delivers the workspace instructions', async () => {
  const workspace = mkdtempSync(join(tmpdir(), 'brobot2-canary-ws-'))
  writeFileSync(
    join(workspace, 'CLAUDE.md'),
    `# BroCrew workspace\n\nThis directory is app-maintained.\n\nInstruction marker: ${FILE_MARKER}\n`,
  )

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const providerHome = join(managedRoot, `claude-canary-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, providerHome)

  const handle = await new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider()).start(
    {
      cwd: workspace,
      providerHome,
      // 038: the cheapest Claude. This canary asks only whether the appended workspace instruction
      // reaches the model at all — a question every tier answers the same way.
      model: 'claude-haiku-4-5-20251001',
      // Exactly what the app does for Claude (006): the same instruction body, appended to the
      // system prompt because the file cannot be read under our isolation settings.
      systemHint: `# BroCrew workspace\n\nThis directory is app-maintained.\n\nInstruction marker: ${HINT_MARKER}\n`,
    },
  )
  const events: RuntimeEvent[] = []
  const consumer = (async () => {
    for await (const e of handle.events()) events.push(e)
  })()

  try {
    await handle.send(
      'List every line you can see that begins with "Instruction marker:". Quote each marker value exactly. If you can see none, say NONE. Do not use any tools.',
    )
    const deadline = Date.now() + 180_000
    while (!events.some((e) => e.type === 'turn') && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 200))
    }
    const reply = events
      .filter((e) => e.type === 'assistant_message')
      .map((e) => (e.type === 'assistant_message' ? e.text : ''))
      .join('\n')
    const fromFile = reply.includes(FILE_MARKER)
    const fromHint = reply.includes(HINT_MARKER)
    console.log(
      `CLAUDE CANARY — CLAUDE.md read=${fromFile}, system-prompt injection=${fromHint}\nreply=${JSON.stringify(reply.slice(0, 400))}`,
    )
    // The acceptance: the workspace instructions REACH the agent by some honest path.
    expect(fromFile || fromHint, 'the workspace instructions must reach the agent').toBe(true)
  } finally {
    await handle.close()
    await consumer
    rmSync(workspace, { recursive: true, force: true })
  }
}, 240_000)
