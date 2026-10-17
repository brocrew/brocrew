import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import { query, type SDKMessage, type SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { expect, it } from 'vitest'
import {
  buildChildEnv,
  ClaudeRuntime,
  claudeAutoMemoryDir,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'

/**
 * 166 · **Does a developer remember across PROJECTS — and still not across profiles?**
 *
 * Writing memory in one session and reading it in another must work across project cwds for
 * the same profile. The provider’s `<providerHome>/projects/<sanitized-cwd>/memory/` layout
 * alone scopes it too narrowly:
 *
 * > ⚑ *"'developer' profile has one HOME. But each 'developer' session might have a different
 * > project/CWD. The developer will 'remember' things from past work as a developer, and it might be
 * > working on different projects."*
 *
 * **So the middle row of this table FLIPS, and the last row must not.** That is the whole ticket, and
 * this file is 165's probe with that one expectation corrected rather than a new file beside it
 * (142's rule — a smoke that still asserts the old behaviour would be the only thing in the repo
 * claiming the feature never shipped).
 *
 * | | profile | cwd | 165 expected | ⛔ 166 expects |
 * |---|---|---|---|---|
 * | **A1** | A | 1 | writes a memory | writes a memory |
 * | **A2** | A | 1 | remembers | remembers |
 * | **B** | A | **2** | ❌ nothing | ⚑ **REMEMBERS — this is the change** |
 * | **C** | **B** | 1 | nothing | **nothing — the boundary that must survive** |
 *
 * ⚠️ **Each case is asserted twice**: the model's own answer, and the filesystem underneath it. A
 * model that says *"I don't know"* proves little on its own — it may simply not have said the quiet
 * part — so the directory is asserted beside it. And the positives are asserted on an **unguessable
 * token**, not on prose: a model can produce a plausible sentence about a project's codename without
 * having read anything.
 *
 * Measure §2 live: no permission card may name the memory directory. `Write →
 * …/memory/project_codename.md` must not park the session in `waiting_permission` each time
 * automatic memory is used.
 *
 * 🔒 Temp homes, temp cwds, both removed at the end. Never `~/.claude`. `haiku` throughout.
 */

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'

/**
 * ⚠️ **Cards are RECORDED, not just answered.** 165 answered them as harness — a memory write was an
 * ordinary `Write` and raised one. 166 rules that it must not, so what used to be plumbing is now
 * the measurement: every card is kept, and the assertion is that none of them names the memory
 * directory. They are still allowed, because a probe that hangs proves nothing about the one that
 * never appeared.
 */
function consume(handle: SessionHandle, sink: RuntimeEvent[]): Promise<void> {
  return (async () => {
    const seen = new Set<string>()
    for await (const event of handle.events()) {
      sink.push(event)
      if (event.type !== 'permission_request' || seen.has(event.id)) continue
      seen.add(event.id)
      await handle.respondPermission(event.id, { outcome: 'allow' }).catch(() => {})
    }
  })()
}

async function waitFor(pred: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

/** Every file under `root`, relative — for the containment check. */
function tree(root: string): string[] {
  if (!existsSync(root)) return []
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else out.push(relative(root, path))
    }
  }
  walk(root)
  return out.sort()
}

/** One session, one turn, what it said — and every card it raised on the way. */
async function askOnce(
  providerHome: string,
  cwd: string,
  prompt: string,
): Promise<{ said: string; tools: string[]; cards: string[] }> {
  const runtime = new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
  const handle = await runtime.start({ cwd, providerHome, model: CHEAP_CLAUDE })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)
  try {
    await handle.send(prompt)
    await waitFor(() => events.some((e) => e.type === 'turn'), 300_000, 'the turn to end')
    return {
      said: events
        .filter((e) => e.type === 'assistant_message')
        .map((e) => (e as { text?: string }).text ?? '')
        .join('\n'),
      tools: events.filter((e) => e.type === 'tool_call').map((e) => (e as { name: string }).name),
      cards: events
        .filter((e) => e.type === 'permission_request')
        .map((e) => JSON.stringify(e as unknown)),
    }
  } finally {
    await handle.close()
    await consumer
  }
}

it('166 · a developer remembers across projects, and still not across profiles', async () => {
  const root = join(tmpdir(), `brobot2-memory-probe-${process.pid}`)
  rmSync(root, { recursive: true, force: true })
  const cwd1 = join(root, 'project-one')
  const cwd2 = join(root, 'project-two')
  mkdirSync(cwd1, { recursive: true })
  mkdirSync(cwd2, { recursive: true })

  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const homeA = join(managedRoot, `claude-memA-${process.pid}-${Date.now()}`)
  const homeB = join(managedRoot, `claude-memB-${process.pid}-${Date.now()}`)
  await provisionProviderHome(managedRoot, homeA)
  await provisionProviderHome(managedRoot, homeB)

  // Unguessable, so a right answer cannot be improvised.
  //
  // ⚠️ **The FACT is deliberately mundane, and 165's first run failed because it was not.** It asked
  // the agent to remember *"the deploy password vault is codenamed …"* and haiku refused outright —
  // *"I can't store, remember, or save passwords, vault codes, deploy credentials… not even
  // temporarily"* — which is the model being right and the probe being wrong. A memory test has to
  // ask for the kind of thing memory is FOR: a durable working convention.
  const token = `BROBOT-166-${process.pid.toString(36).toUpperCase()}-QX7T`
  const fact = `whenever I ask for a release note, I want it written in exactly three bullets, and my personal style tag is ${token}`

  const memA = claudeAutoMemoryDir(homeA)
  const memB = claudeAutoMemoryDir(homeB)

  try {
    console.log(`\n=== the directory this app now SENDS (166) ===`)
    console.log(`  profile A : ${memA}`)
    console.log(`  profile B : ${memB}`)

    const beforeCwd = tree(cwd1)

    // ---- A1 · write, in project one ----------------------------------------
    const a1 = await askOnce(
      homeA,
      cwd1,
      `Please remember this for future sessions, permanently: ${fact}. ` +
        `Save it to your memory now, then reply with the word SAVED.`,
    )
    console.log(`\n=== A1 · profile A, project one — write ===`)
    console.log(`  tools : ${a1.tools.join(', ') || '(none)'}`)
    console.log(`  cards : ${a1.cards.length}`)
    console.log(`  said  : ${a1.said.slice(0, 300)}`)

    const wrote = tree(memA)
    console.log(`  files under ${memA}: ${wrote.join(', ') || '(none)'}`)
    expect(wrote.length, `the agent wrote nothing under ${memA}`).toBeGreaterThan(0)
    // The index the next session is handed. Its presence is what makes A2 a real test.
    expect(wrote, 'MEMORY.md — the index a new session is given').toContain('MEMORY.md')
    console.log(`  MEMORY.md:\n${readFileSync(join(memA, 'MEMORY.md'), 'utf8').slice(0, 600)}`)

    // §2 · no permission card names the memory. Check that the carve-out avoids
    // `waiting_permission` for the session’s own memory file.
    const memoryCards = a1.cards.filter((card) => card.includes(`${sep}memory${sep}`))
    console.log(`\n=== §2 · cards naming the memory directory: ${memoryCards.length} ===`)
    for (const card of memoryCards) console.log(`  ${card.slice(0, 300)}`)
    expect(memoryCards, 'a memory write raised a permission card').toEqual([])

    // ---- containment · nothing outside the memory directory ----------------
    // ⚠️ The cwd matters most: the agent was asked to remember, not to write here.
    expect(tree(cwd1), 'a memory write touched the working directory').toEqual(beforeCwd)
    const strays = tree(homeA).filter((rel) => !rel.startsWith(`memory${sep}`))
    console.log(`\n=== containment ===`)
    console.log(`  under homeA, OUTSIDE memory/: ${strays.join(', ') || 'none'}`)
    // ⚑ …and no per-project memory folder appeared under `projects/`, where the provider keeps its
    // own default, whatever it names the folder: that is what proves the override took effect rather
    // than the two paths merely both existing.
    expect(
      tree(join(homeA, 'projects')).filter((rel) => rel.split(sep).includes('memory')),
      'the provider’s per-project default was written too — the override did not take',
    ).toEqual([])

    // A2 · same profile, same project
    const a2 = await askOnce(homeA, cwd1, 'What is my personal style tag? Answer from memory.')
    console.log(`\n=== A2 · profile A, project one, NEW session ===`)
    console.log(`  said : ${a2.said.slice(0, 400)}`)
    expect(a2.said, "a new session did not remember the previous session's memory").toContain(token)

    // ---- B · same profile, DIFFERENT project — ⛔ THE TICKET ----------------
    const b = await askOnce(
      homeA,
      cwd2,
      'What is my personal style tag? Answer from memory. ' +
        'If you have no memory of it, say NOTHING REMEMBERED.',
    )
    console.log(`\n=== B · profile A, project TWO — the row that flipped ===`)
    console.log(`  said : ${b.said.slice(0, 300)}`)
    expect(
      b.said,
      'the same developer did not carry its memory into a second project — this is the ticket',
    ).toContain(token)

    // ---- C · DIFFERENT profile, same project — the boundary that survives ---
    const c = await askOnce(
      homeB,
      cwd1,
      'What is my personal style tag? Answer from memory. ' +
        'If you have no memory of it, say NOTHING REMEMBERED.',
    )
    console.log(`\n=== C · profile B, project one — the boundary ===`)
    console.log(`  said : ${c.said.slice(0, 300)}`)
    expect(c.said, 'a memory leaked across profiles').not.toContain(token)
    expect(
      tree(memB),
      'the second profile has a memory index of its own carrying the first profile’s memory',
    ).not.toContain('MEMORY.md')

    console.log(
      `\n=== verdicts ===\n` +
        `  wrote where the app said    : ${wrote.length > 0}\n` +
        `  cards on its own memory     : ${memoryCards.length}\n` +
        `  same project remembered     : ${a2.said.includes(token)}\n` +
        `  OTHER project remembered    : ${b.said.includes(token)}   ⚑ 166\n` +
        `  leaked across profile       : ${c.said.includes(token)}\n` +
        `  wrote into the cwd          : ${tree(cwd1).length !== beforeCwd.length}`,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(homeA, { recursive: true, force: true })
    rmSync(homeB, { recursive: true, force: true })
  }
}, 900_000)

/**
 * 165/166 · **Which lever puts a memory directory in the prompt, and which one decides WHERE.**
 *
 * ⛔ **165's first run failed with the env flag already removed**, and the model said why: *"I don't
 * have a persistent memory system that carries across separate conversations."* So the variable was
 * necessary and not sufficient: memory also needs the `claude_code` system-prompt preset, and
 * `CLAUDE_CODE_DISABLE_AUTO_MEMORY` set to a true value still turns it off (arm **e**).
 *
 * ⚑ **166 adds the second dimension: the DIRECTORY.** `Settings.autoMemoryDirectory` sets it,
 * and the flag-settings layer (`Options.settings`, ours) sits below managed policy settings and
 * above user, project and local settings (`sdk.d.ts`, `Query.applyFlagSettings`).
 *
 * Arm **d** asks a real session where its memory lives after we point it somewhere. The question
 * is the cheapest observable there is: the model can only name the directory if the CLI put the
 * path in its system prompt.
 */
it('166 · matrix — which lever turns memory on, and which one moves it', async () => {
  const root = join(tmpdir(), `brobot2-memory-matrix-${process.pid}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(root, { recursive: true })

  const token = claudeKeychainTokenProvider()()
  expect(token, 'the machine Keychain login must be inheritable').not.toBeNull()

  // ⚠️ **The SDK directly, not `ClaudeRuntime`** — the adapter owns its child env and offers no seam
  // to vary one variable, which is correct for a product and wrong for a measurement. These options
  // are `childEnvAdditions` restated, so the only difference between arms is the one under test.
  const ASK =
    'Do you have a persistent memory directory that survives between sessions? ' +
    'Reply with ONLY its absolute path, or the single word NONE.'

  const PRESET = { type: 'preset' as const, preset: 'claude_code' as const }
  const arms: {
    label: string
    extra: Record<string, string>
    preset: boolean
    /** Set the directory the way the adapter does — through the flag-settings layer. */
    pinDirectory: boolean
  }[] = [
    {
      label: 'a · no preset, no flag — what removing the env flag alone gives',
      extra: {},
      preset: false,
      pinDirectory: false,
    },
    {
      label: 'b · no preset, DISABLE_AUTO_MEMORY=0 — the variable explicitly falsy',
      extra: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '0' },
      preset: false,
      pinDirectory: false,
    },
    {
      label: 'c · PRESET, no settings — 165’s shape: the provider picks the directory',
      extra: {},
      preset: true,
      pinDirectory: false,
    },
    {
      label: 'd · PRESET + settings.autoMemoryDirectory — ⛔ 166’s lever',
      extra: {},
      preset: true,
      pinDirectory: true,
    },
    {
      label: 'e · PRESET + DISABLE_AUTO_MEMORY=1 — the control that must stay off',
      extra: { CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1' },
      preset: true,
      pinDirectory: true,
    },
  ]

  const answers: { label: string; said: string; namesOurs: boolean; namesADir: boolean }[] = []
  const homes: string[] = []
  try {
    for (const [index, arm] of arms.entries()) {
      const home = join(tmpdir(), `brobot2-memory-matrix-home-${process.pid}-${index}`)
      homes.push(home)
      rmSync(home, { recursive: true, force: true })
      mkdirSync(home, { recursive: true, mode: 0o700 })
      const q = query({
        prompt: (async function* () {
          yield {
            type: 'user',
            session_id: '',
            parent_tool_use_id: null,
            message: { role: 'user', content: ASK },
          } as unknown as SDKUserMessage
          await new Promise<void>(() => {})
        })(),
        options: {
          cwd: root,
          model: CHEAP_CLAUDE,
          ...(arm.preset ? { systemPrompt: PRESET } : {}),
          ...(arm.pinDirectory
            ? { settings: { autoMemoryDirectory: claudeAutoMemoryDir(home) } }
            : {}),
          settingSources: [],
          strictMcpConfig: true,
          env: buildChildEnv({
            CLAUDE_CONFIG_DIR: home,
            ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
            CLAUDE_CODE_OAUTH_TOKEN: token as string,
            ...arm.extra,
          }),
        },
      })
      let said = ''
      try {
        for await (const message of q as AsyncIterable<SDKMessage>) {
          if (message.type === 'assistant') {
            for (const block of message.message.content) {
              if (block.type === 'text') said += block.text
            }
          }
          if (message.type === 'result') break
        }
      } finally {
        try {
          q.close()
        } catch {
          /* best-effort */
        }
      }
      answers.push({
        label: arm.label,
        said,
        namesADir: said.includes(`${sep}memory`),
        // ⚠️ The pinned directory has no `projects/` segment, so "ours" is checkable by shape and
        // not only by string equality — a model that quotes the path with a trailing slash, or
        // real-pathed, still answers the question being asked.
        namesOurs: said.includes(claudeAutoMemoryDir(home)),
      })
    }
  } finally {
    for (const home of homes) rmSync(home, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  }

  console.log('\n=== which lever turns memory on, and which one moves it ===')
  for (const answer of answers) {
    console.log(
      `\n── ${answer.label} ──\n  names a memory dir: ${answer.namesADir}` +
        `\n  names OURS        : ${answer.namesOurs}\n  ${answer.said.slice(0, 300)}`,
    )
  }

  // ⛔ **166's lever, and the two controls that make it mean something.** The directory arm must name
  // the directory we chose; the preset-only arm must name a directory that is NOT ours (the
  // provider's per-cwd default, which is the thing being replaced); and `=1` must still turn the
  // whole feature off even with the directory pinned — otherwise the new setting would have quietly
  // become a second enable.
  expect(answers[3]?.namesOurs, 'the flag-settings layer did not move the memory directory').toBe(
    true,
  )
  expect(answers[2]?.namesOurs, 'the preset-only arm already pointed at our directory').toBe(false)
  expect(answers[4]?.namesADir, 'the old flag value no longer disables auto-memory').toBe(false)
}, 900_000)
