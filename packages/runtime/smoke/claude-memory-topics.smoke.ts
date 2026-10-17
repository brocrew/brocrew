import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  AUTO_MEMORY_INDEX,
  ClaudeRuntime,
  claudeAutoMemoryDir,
  claudeKeychainTokenProvider,
  provisionProviderHome,
  type RuntimeEvent,
  type SessionHandle,
} from '../src/index'

/**
 * 322 · 🔴 **Which half of a Claude memory store is in the prompt, and which half is not.**
 *
 * ⛔ **322 §3.1 asked for this in as many words** — *"`instructions.ts:68` records that
 * `<providerHome>/memory/MEMORY.md` reaches the model, and the Claude docs' own account is that
 * topic files are loaded on demand with ordinary file tools. **Confirm that boundary before you
 * encode it**; do not take my sentence for it."* The panel now draws a `reach` word on every row of
 * that store, so the boundary is not a footnote: it is the claim each row makes.
 *
 * ## ⚑ Why a live child
 *
 * Claude Code puts `<providerHome>/memory/MEMORY.md`, and only that file, into its system prompt,
 * and `isClaudeMemoryTopic` encodes that. ⚠️ **A claim about the provider is not a measurement.**
 * `316` enumerated item TYPES across fifteen arms, found no memory tool, and shipped *"invisible,
 * permanently"* about a FIELD it had already fetched; the lesson is that a search answers the
 * question it was shaped for. This asks the child instead, and the child
 * cannot answer the wrong question.
 *
 * ## The three arms, in this order, in ONE session
 *
 * | # | asked for | ⛔ what it proves |
 * |---|---|---|
 * | **CONTROL** | a token that exists only in `MEMORY.md`, no files opened | answered anyway → the index really is in the prompt |
 * | **UNASKED** | a token that exists only in `release_codename.md` | it must never know this **without opening something** → the topic file is NOT in the prompt |
 * | **ON REQUEST** | the same token, told it may look | answered **after a tool call naming that file** → it is reachable, by an ordinary file tool |
 *
 * ⚠️ **The order is the evidence and one session is deliberate.** The control runs first, so at the
 * moment the second arm is asked nothing in the store has been opened; the third then has to go and
 * get it, in front of the same context that already had the index. Two sessions would prove the same
 * facts and would not prove they are facts about the same store at the same moment.
 *
 * ⚑ **The middle arm is the one that carries the ruling, and its assertion is a NEGATIVE about a
 * pair.** It is not *"the model said it did not know"* — a model may decline for its own reasons —
 * it is *"the model never knew the token while having opened nothing"*. That is the only shape that
 * excludes a preloaded file, and it is true whichever branch the child takes.
 *
 * 🔒 Temp home, temp cwd, both removed. Never `~/.claude`. `haiku`, three turns.
 */

const CHEAP_CLAUDE = 'claude-haiku-4-5-20251001'

/** Every card is answered, and every card is kept — a probe that hangs measures nothing. */
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

it('322 · the index is in the prompt; a topic file is fetched or it is not seen', async () => {
  const root = join(tmpdir(), `brobot2-322-topics-${process.pid}`)
  const cwd = join(root, 'work')
  const managedRoot = join(tmpdir(), 'brobot2-smoke-homes')
  const home = join(managedRoot, `claude-322-${process.pid}-${Date.now()}`)
  rmSync(root, { recursive: true, force: true })
  mkdirSync(cwd, { recursive: true })
  await provisionProviderHome(managedRoot, home)

  // ⚠️ **Two unguessable tokens, and mundane facts to hang them on** (165's lesson: haiku refuses
  // to "remember" anything shaped like a credential, which is the model being right and the probe
  // being wrong). A durable working convention is what memory is FOR.
  const stamp = `${process.pid.toString(36)}${Date.now().toString(36)}`.toUpperCase()
  const indexToken = `BROBOT-322-INDEX-${stamp}`
  const topicToken = `BROBOT-322-TOPIC-${stamp}`

  const memory = claudeAutoMemoryDir(home)
  const topicFile = 'release_codename.md'
  mkdirSync(memory, { recursive: true })
  // The index, in the shape the provider's own instruction dictates: one line per memory,
  // `- [Title](file.md) — hook`, and no memory content in it. The control token rides in a hook,
  // which is exactly what a hook is for.
  writeFileSync(
    join(memory, AUTO_MEMORY_INDEX),
    [
      '# Memory Index',
      '',
      `- [Release note style](release_note_style.md) — every release note must carry the tag ${indexToken}`,
      `- [Release codename](${topicFile}) — the codename this release ships under`,
      '',
    ].join('\n'),
  )
  // ⛔ **The topic file, whose token appears NOWHERE else** — not in the index, not in the prompt,
  // not in either question. If it comes back, it came out of this file.
  writeFileSync(
    join(memory, topicFile),
    [
      '---',
      'name: release-codename',
      'description: the codename the current release ships under',
      'metadata:',
      '  type: project',
      '---',
      '',
      `The current release ships under the codename ${topicToken}.`,
      '',
    ].join('\n'),
  )

  const runtime = new ClaudeRuntime(undefined, undefined, claudeKeychainTokenProvider())
  const handle = await runtime.start({ cwd, providerHome: home, model: CHEAP_CLAUDE })
  const events: RuntimeEvent[] = []
  const consumer = consume(handle, events)

  /** One turn: what it said, and every tool call it made getting there. */
  const ask = async (
    prompt: string,
  ): Promise<{ said: string; tools: { name: string; summary: string }[] }> => {
    const before = events.length
    const turnsBefore = events.filter((e) => e.type === 'turn').length
    await handle.send(prompt)
    await waitFor(
      () => events.filter((e) => e.type === 'turn').length > turnsBefore,
      300_000,
      'the turn to end',
    )
    const slice = events.slice(before)
    return {
      said: slice
        .filter((e) => e.type === 'assistant_message')
        .map((e) => (e as { text?: string }).text ?? '')
        .join('\n'),
      tools: slice
        .filter((e) => e.type === 'tool_call')
        .map((e) => e as unknown as { name: string; summary: string })
        .map((e) => ({ name: e.name, summary: e.summary })),
    }
  }

  try {
    console.log(`\n=== the store this profile was given ===`)
    console.log(`  ${join(memory, AUTO_MEMORY_INDEX)}   (index)`)
    console.log(`  ${join(memory, topicFile)}   (one memory)`)

    // ---- CONTROL · a fact that lives only in the index ----------------------
    const control = await ask(
      'What tag must every release note carry? Answer in one short sentence, from what you ' +
        'already know. Do not open any files.',
    )
    console.log(`\n=== CONTROL · asked for the INDEX's own token ===`)
    console.log(`  tools : ${control.tools.map((t) => t.name).join(', ') || '(none)'}`)
    console.log(`  said  : ${control.said.slice(0, 300)}`)
    expect(
      control.said,
      'the index is not in the prompt — the child could not answer from it',
    ).toContain(indexToken)
    expect(
      control.tools,
      'the child opened a file to answer from the index — it was not preloaded',
    ).toEqual([])

    // ---- UNASKED · the same store, a fact that lives only in the topic file --
    // ⛔ **No instruction about tools either way.** The turn is left exactly as a user would ask it,
    // so whatever the child does is the child's own choice and the assertion below holds for both.
    const unasked = await ask(
      'What codename does the current release ship under? Answer in one short sentence.',
    )
    console.log(`\n=== UNASKED · the TOPIC FILE's token, nothing said about looking ===`)
    console.log(
      `  tools : ${unasked.tools.map((t) => `${t.name}(${t.summary})`).join(', ') || '(none)'}`,
    )
    console.log(`  said  : ${unasked.said.slice(0, 300)}`)
    // 🔴 **The ruling.** Knowing a token while having opened nothing is the one outcome that means
    // the topic file was in the prompt, and it is the one this asserts against. Either branch of the
    // other two is fine and both are printed.
    expect(
      unasked.said.includes(topicToken) && unasked.tools.length === 0,
      'a topic file reached the model unasked — `reach: on-request` is understating this store',
    ).toBe(false)

    // ---- ON REQUEST · the other half of the same word ------------------------
    const fetched = await ask(
      'Look in your memory directory and read whichever memory file holds it, then tell me the ' +
        'release codename in one short sentence.',
    )
    console.log(`\n=== ON REQUEST · told it may look ===`)
    console.log(
      `  tools : ${fetched.tools.map((t) => `${t.name}(${t.summary})`).join(', ') || '(none)'}`,
    )
    console.log(`  said  : ${fetched.said.slice(0, 300)}`)
    expect(fetched.said, 'the child could not reach its own topic file at all').toContain(
      topicToken,
    )
    // ⚠️ **An ORDINARY file tool, which is the second half of the ruling**: there is no memory tool
    // on this provider, so the row on the panel must not imply one (322 §4 / 305).
    expect(
      fetched.tools.some(
        (t) => t.summary.includes(topicFile) || t.name.toLowerCase().includes('read'),
      ),
      'the token arrived with no file read on the turn — measure again before trusting either arm',
    ).toBe(true)

    console.log(
      `\n=== verdicts ===\n` +
        `  index answered with no tool   : ${control.tools.length === 0}   ⚑ reach = 'prompt'\n` +
        `  topic known unasked           : ${unasked.said.includes(topicToken)}\n` +
        `  …with nothing opened          : ${unasked.tools.length === 0}   ⛔ both true = not on-request\n` +
        `  topic fetched when asked      : ${fetched.said.includes(topicToken)}   ⚑ reach = 'on-request'\n` +
        `  tools on the fetch turn       : ${fetched.tools.map((t) => t.name).join(', ')}`,
    )
  } finally {
    await handle.close()
    await consumer
    rmSync(root, { recursive: true, force: true })
    rmSync(home, { recursive: true, force: true })
  }
}, 900_000)
