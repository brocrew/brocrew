import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { claudeVersionTheSdkShips } from '@brobot2/runtime'
import { CODEX_PROTOCOL_VERSION } from '../../../packages/runtime/src/codex/protocol-version'
import {
  claudeContextSections,
  claudeParts,
  codexParts,
  PLACEHOLDER,
  residueIn,
  scrubbed,
} from '../smoke/provider-snapshot-parts'
import {
  SNAPSHOT_FILES,
  SNAPSHOT_FILES_BY_PLATFORM,
  capturedOnFor,
  snapshotCatalogue,
  snapshotFilesFor,
  snapshotFor,
} from '../src/main/provider-snapshots'
import { sizeOf } from '../src/shared/provider-snapshots'
import { agentPreamble } from '../src/main/runtime/agent-preamble'

/**
 * 🔴 **W4.164 · F093 R3 — the bundled providers' own parts, shipped with the app.**
 *
 *  - §1 · ⛔ **a snapshot is of the version this build bundles**: when a bump changes Claude Code or
 *    Codex, this fails until `pnpm run snapshots:providers` is run again.
 *  - §2 · nothing in a snapshot is a person's, this computer's, or BroBot's own.
 *  - §3 · the window's ask: by provider and model, the provider's default for none, and a model not
 *    captured said so.
 *  - §4 · how a request is cut: BroBot's parts out, this conversation's facts as placeholders.
 */

const here = dirname(fileURLToPath(import.meta.url))

/** Each platform's files: every check below holds for each, whichever platform runs it. */
const PLATFORMS = Object.entries(SNAPSHOT_FILES_BY_PLATFORM)

describe('§1 · ⛔ a snapshot is of the version this build bundles', () => {
  it.each(PLATFORMS)('🔴 Claude Code’s, as the bundled SDK declares it ships (%s)', (_, files) => {
    expect(files.claude.version, 'run `pnpm run snapshots:providers` after a Claude bump').toBe(
      claudeVersionTheSdkShips(),
    )
    expect(files.claude.label).toBe(`as of Claude Code ${files.claude.version}`)
    // ⚑ …and the program itself said so, in the first line of every request it sent.
    for (const [model, one] of Object.entries(files.claude.models)) {
      const header = one.parts.find((part) => part.id === 'claude.request-header')
      expect(files.claude.texts[header?.text ?? ''] ?? '', model).toContain(
        `cc_version=${files.claude.version}.`,
      )
    }
  })

  it.each(PLATFORMS)('🔴 Codex’s, as the vendored protocol says (%s)', (_, files) => {
    expect(files.codex.version, 'run `pnpm run snapshots:providers` after a Codex bump').toBe(
      CODEX_PROTOCOL_VERSION,
    )
    expect(files.codex.label).toBe(`as of Codex ${files.codex.version}`)
  })

  it('🔴 Codex’s, as the bundled binary’s package says', () => {
    // ⚑ The pin every platform's Codex is bundled at — read on every runner, whichever it installs.
    const pins = (
      JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as {
        optionalDependencies: Record<string, string>
      }
    ).optionalDependencies
    for (const name of ['@openai/codex-darwin-arm64', '@openai/codex-win32-x64']) {
      expect(pins[name], name).toMatch(
        new RegExp(`^npm:@openai/codex@${SNAPSHOT_FILES.codex.version.replace(/\./g, '\\.')}-`),
      )
    }
  })

  it.runIf(process.platform === 'darwin' && process.arch === 'arm64')(
    '⚑ …and, where it is installed, the bundled binary’s own package',
    () => {
      const bundled = JSON.parse(
        readFileSync(join(here, '../node_modules/@openai/codex-darwin-arm64/package.json'), 'utf8'),
      ) as { version: string }
      expect(bundled.version.split('-')[0]).toBe(SNAPSHOT_FILES.codex.version)
    },
  )

  it('⚑ the probe that writes them is a script, and the snapshots ship inside the main bundle', () => {
    const scripts = (
      JSON.parse(readFileSync(join(here, '../../../package.json'), 'utf8')) as {
        scripts: Record<string, string>
      }
    ).scripts
    expect(scripts['snapshots:providers']).toBe(
      'vitest run --config vitest.smoke.config.ts apps/desktop/smoke/provider-snapshots.smoke.ts',
    )
    const main = readFileSync(join(here, '../src/main/index.ts'), 'utf8')
    expect(main).toContain('      startProviderSnapshots()\n')
  })
})

describe('§2 · nothing in a snapshot is a person’s, this computer’s, or BroBot’s own', () => {
  for (const [platform, files] of PLATFORMS) {
    for (const provider of ['claude', 'codex'] as const) {
      it(`⛔ ${provider} (${platform}): no path, no scratch value, no word of BroBot’s`, () => {
        const file = files[provider]
        for (const [hash, text] of Object.entries(file.texts)) {
          expect(residueIn(text, ['⟨provider-homes⟩', 'SNAPSHOT-', 'snap-']), hash).toEqual([])
        }
        // ⚑ Every text a part names is there, and every text is named by a part.
        const named = new Set(
          Object.values(file.models).flatMap((model) =>
            model.parts.flatMap((part) => [
              ...(part.tools === undefined ? [part.text] : []),
              ...(part.tools ?? []).map((tool) => tool.text),
            ]),
          ),
        )
        expect([...named].sort()).toEqual(Object.keys(file.texts).sort())
      })
    }
  }

  it.each(PLATFORMS)('⚑ where BroBot’s parts sat, a placeholder says so (%s)', (_, files) => {
    const claude = snapshotFor('claude', 'opus', files)
    const codexExec = snapshotFor('codex', 'gpt-6.1-sol', files)
    const codexFunctions = snapshotFor('codex', 'gpt-5.5', files)
    if (!claude.found || !codexExec.found || !codexFunctions.found) throw new Error('not captured')
    const all = (answer: typeof claude & { found: true }): string =>
      answer.snapshot.parts.map((part) => part.text).join('\n')
    expect(all(claude)).toContain(PLACEHOLDER.brobotToolNames)
    expect(all(claude)).toContain(PLACEHOLDER.brobotServerParagraph)
    expect(all(claude)).toContain(PLACEHOLDER.memoryIndex)
    expect(all(codexExec)).toContain(PLACEHOLDER.brobotToolDeclarations)
    expect(all(codexExec)).toContain(PLACEHOLDER.agentsFiles)
    expect(all(codexFunctions)).toContain(PLACEHOLDER.memorySummary)
    expect(all(codexFunctions)).not.toContain('"name":"brobot"')
  })
})

describe('§3 · the window’s ask: by provider and model', () => {
  it('🔴 Codex’s model decides its request’s shape', () => {
    const functions = snapshotFor('codex', 'gpt-5.5')
    const exec = snapshotFor('codex', 'gpt-6.1-sol')
    expect(functions.found && functions.snapshot.shape).toBe('functions')
    expect(exec.found && exec.snapshot.shape).toBe('exec')
    if (!functions.found || !exec.found) throw new Error('not captured')
    expect(functions.snapshot.parts.map((part) => part.id)).toContain('codex.prompt')
    expect(functions.snapshot.parts.find((part) => part.id === 'codex.prompt')?.where).toBe(
      'instructions',
    )
    expect(exec.snapshot.parts.find((part) => part.id === 'codex.prompt')?.where).toBe(
      'developer-message',
    )
    expect(
      exec.snapshot.parts
        .find((part) => part.id === 'codex.tools')
        ?.tools?.map((tool) => tool.name),
    ).toContain('functions.exec')
  })

  it('⚑ no model named: the provider’s own default', () => {
    const codex = snapshotFor('codex', null)
    expect(codex.found && codex.snapshot.model).toBe(SNAPSHOT_FILES.codex.defaultModel)
    const claude = snapshotFor('claude', null)
    expect(claude.found && claude.snapshot.model).toBe(SNAPSHOT_FILES.claude.defaultModel)
  })

  it('⚑ a Claude model by the name a menu offers, or by the id Claude Code told its model', () => {
    for (const asked of ['opus', 'opus[1m]', 'claude-opus-5-5', 'claude-opus-5-5[1m]']) {
      const answer = snapshotFor('claude', asked)
      expect(answer.found && answer.snapshot.model, asked).toBe('opus')
    }
    // ⚑ The default's own entry is named by `default` only: another model's id finds that model.
    const sonnet = snapshotFor('claude', 'claude-sonnet-5-5')
    expect(sonnet.found && sonnet.snapshot.model).toBe('sonnet')
    expect(SNAPSHOT_FILES.claude.models['default']?.alsoCalled).toEqual([])
  })

  it('⚑ what this build carries, per provider: its version, default, and each model’s shape', () => {
    const catalogue = snapshotCatalogue()
    expect(catalogue.map((one) => [one.provider, one.label])).toEqual([
      ['claude', SNAPSHOT_FILES.claude.label],
      ['codex', SNAPSHOT_FILES.codex.label],
    ])
    const codex = catalogue[1]
    expect(codex?.models.find((one) => one.model === 'gpt-5.5')?.shape).toBe('functions')
    expect(codex?.models.find((one) => one.model === 'gpt-6.1-sol')?.shape).toBe('exec')
  })

  it('⚑ Claude Code’s deferred built-ins, in full, as loaded on demand — and out of the total', () => {
    const answer = snapshotFor('claude', 'opus')
    if (!answer.found) throw new Error('not captured')
    const deferred = answer.snapshot.parts.find((part) => part.id === 'claude.tools.deferred')
    expect(deferred?.when).toBe('when-loaded')
    expect(deferred?.tools?.map((tool) => tool.name)).toContain('WebFetch')
    const before = answer.snapshot.parts.filter((part) => part.when !== 'when-loaded')
    expect(answer.snapshot.chars).toBe(sizeOf(before.map((part) => part.text).join('\n')).chars)
  })

  it('🔴 W4.186 · Claude: the tools the model is shown, and its skills and sub-agent types as parts of their own', () => {
    for (const [model, kept] of Object.entries(SNAPSHOT_FILES.claude.models)) {
      const answer = snapshotFor('claude', model)
      if (!answer.found) throw new Error(`${model} not captured`)
      const { parts } = answer.snapshot
      // ⛔ Claude Code's reserved tool is sent deferred: the model is never shown it.
      const tools = parts.find((part) => part.id === 'claude.tools')?.tools ?? []
      expect(tools.map((tool) => tool.name)).not.toContain('DeferredToolPlaceholder')
      expect(tools.every((tool) => !tool.text.includes('"defer_loading":true'))).toBe(true)
      // ⚑ The skills list and the sub-agent types — in the context message, or (Haiku) reminders.
      const ids = parts.map((part) => part.id)
      const where = ids.includes('claude.context.skills') ? 'context' : 'reminder'
      expect(ids, model).toContain(`claude.${where}.skills`)
      expect(ids, model).toContain(`claude.${where}.agent-types`)
      expect(kept.parts.every((part) => part.id !== 'claude.context')).toBe(true)
    }
    // ⚑ What differs by profile or account is said on the part, and the notes name the rest.
    const opus = snapshotFor('claude', 'opus')
    if (!opus.found) throw new Error('opus not captured')
    const skills = opus.snapshot.parts.find((part) => part.id === 'claude.context.skills')
    expect(skills?.varies).toMatch(/installed/)
    expect(SNAPSHOT_FILES.claude.notes.join(' ')).toMatch(/DeferredToolPlaceholder/)
    expect(SNAPSHOT_FILES.claude.notes.join(' ')).toMatch(
      /Monitor, PushNotification and DesignSync/,
    )
    // ⚑ A section reads alike in the context message and, on Haiku, among the reminders.
    const haiku = snapshotFor('claude', 'haiku')
    if (!haiku.found) throw new Error('haiku not captured')
    const twin = haiku.snapshot.parts.find((part) => part.id === 'claude.reminder.skills')
    expect(twin?.varies).toBe(skills?.varies)
  })

  it('⛔ a model this build did not capture is said so, never shown as another', () => {
    const answer = snapshotFor('codex', 'gpt-99')
    expect(answer).toEqual({
      found: false,
      why: `gpt-99 was not captured ${SNAPSHOT_FILES.codex.label}.`,
      models: Object.keys(SNAPSHOT_FILES.codex.models),
    })
  })

  it('⚑ every size is the F093 map’s: characters, words, characters ÷ 4', () => {
    const answer = snapshotFor('claude', 'opus')
    if (!answer.found) throw new Error('not captured')
    for (const part of answer.snapshot.parts) {
      expect({ chars: part.chars, words: part.words, approxTokens: part.approxTokens }).toEqual(
        sizeOf(part.text),
      )
    }
    expect(sizeOf('ab cd\nef')).toEqual({ chars: 8, words: 3, approxTokens: 2 })
    expect(answer.snapshot.label).toBe(`as of Claude Code ${SNAPSHOT_FILES.claude.version}`)
  })
})

describe('§4 · how a request is cut', () => {
  const scrubs = [
    { from: '/scratch/w', to: PLACEHOLDER.folder },
    { from: '2026-10-05', to: PLACEHOLDER.date },
  ]

  it('🔴 Claude: BroBot’s appended system text, its tools’ names and paragraph placeholders', () => {
    const append = agentPreamble({ profileSlug: 'writer', displayName: 'Lena' })
    const request = {
      system: [
        { type: 'text', text: 'x-anthropic-billing-header: cc_version=9.9.9;' },
        { type: 'text', text: 'You are Claude Code.' },
        {
          type: 'text',
          text: `Guidance.\n\n<total_tokens>99 tokens left</total_tokens>\n\n${append}`,
        },
      ],
      tools: [
        { name: 'Bash', description: 'Run.' },
        // ⚑ Claude Code's reserved tool: sent deferred, so the model is never shown it.
        { name: 'DeferredToolPlaceholder', description: 'Reserved.', defer_loading: true },
        { name: 'mcp__brobot__give_work' },
      ],
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: '<system-reminder>\nContents of /scratch/w/memory/MEMORY.md (user’s auto-memory):\n\n- a line\n</system-reminder>',
            },
            { type: 'text', text: 'Sent by a person, typed into this app.' },
          ],
        },
        {
          role: 'system',
          content: [
            {
              type: 'text',
              text: "# Environment\n - Primary working directory: /scratch/w\n\nThe following deferred tools are now available:\nWebFetch\nmcp__brobot__give_work\nmcp__brobot__list_tasks\n\n# MCP Server Instructions\n\n## brobot\nThese tools reach the app.\nMore.\n\nThe following skills are available for use with the Skill tool:\n- a\n\nToday's date is 2026-10-05.",
            },
          ],
        },
      ],
    }
    // ⚑ The context message's sections, as Claude Code's transcript keeps them.
    const sections = [
      { label: 'environment', text: '# Environment\n - Primary working directory: /scratch/w' },
      {
        label: 'deferred_tools_delta',
        text: 'The following deferred tools are now available:\nWebFetch\nmcp__brobot__give_work\nmcp__brobot__list_tasks',
      },
      {
        label: 'mcp_instructions_delta',
        text: '# MCP Server Instructions\n\n## brobot\nThese tools reach the app.\nMore.',
      },
      {
        label: 'skill_listing',
        text: 'The following skills are available for use with the Skill tool:\n- a',
      },
      { label: 'date', text: "Today's date is 2026-10-05." },
    ]
    const parts = claudeParts(request, { append }, scrubs, sections)
    expect(parts.map((part) => part.id)).toEqual([
      'claude.request-header',
      'claude.identity',
      'claude.prompt',
      'claude.tools',
      'claude.reminder.memory',
      'claude.context.environment',
      'claude.context.deferred-tools',
      'claude.context.server-instructions',
      'claude.context.skills',
      'claude.context.date',
    ])
    const text = (id: string): string => parts.find((part) => part.id === id)?.text ?? ''
    // ⚑ BroBot's text is a placeholder where it joined, never cut out without a trace.
    // ⛔ Its words are the line the window draws there, as approved, and no others.
    expect(PLACEHOLDER.brobotSystemPromptText).toBe('⟨BroCrew’s text joins the system prompt here⟩')
    expect(text('claude.prompt')).toBe(
      `Guidance.\n\n<total_tokens>${PLACEHOLDER.tokensLeft} tokens left</total_tokens>\n\n${PLACEHOLDER.brobotSystemPromptText}`,
    )
    // ⚑ …at the very place it joined, with Claude Code's own text after it where there is any.
    const followed = structuredClone(request)
    const guidance = followed.system[2] as { text: string }
    guidance.text = `${guidance.text}\n\nClaude Code’s own line after it.`
    expect(
      claudeParts(followed, { append }, scrubs, sections).find(
        (part) => part.id === 'claude.prompt',
      )?.text,
    ).toBe(
      `Guidance.\n\n<total_tokens>${PLACEHOLDER.tokensLeft} tokens left</total_tokens>\n\n${PLACEHOLDER.brobotSystemPromptText}\n\nClaude Code’s own line after it.`,
    )
    expect(parts.find((part) => part.id === 'claude.tools')?.tools?.map((t) => t.name)).toEqual([
      'Bash',
    ])
    expect(text('claude.reminder.memory')).toContain(
      `Contents of ${PLACEHOLDER.folder}/memory/MEMORY.md`,
    )
    expect(text('claude.reminder.memory')).toContain(PLACEHOLDER.memoryIndex)
    expect(text('claude.reminder.memory')).not.toContain('a line')
    expect(text('claude.context.environment')).toBe(
      `# Environment\n - Primary working directory: ${PLACEHOLDER.folder}`,
    )
    expect(text('claude.context.deferred-tools')).toBe(
      `The following deferred tools are now available:\nWebFetch\n${PLACEHOLDER.brobotToolNames}`,
    )
    expect(text('claude.context.server-instructions')).toBe(
      `# MCP Server Instructions\n\n## brobot\n${PLACEHOLDER.brobotServerParagraph}`,
    )
    expect(text('claude.context.date')).toBe(`Today's date is ${PLACEHOLDER.date}.`)
    // 🔴 W4.186 · what differs by conversation is said on the parts it differs in, and only there.
    const varies = (id: string): string | undefined => parts.find((part) => part.id === id)?.varies
    expect(varies('claude.context.deferred-tools')).toMatch(/ListMcpResourcesTool/)
    expect(varies('claude.context.skills')).toMatch(/installed/)
    expect(varies('claude.context.server-instructions')).toMatch(/servers/)
    expect(varies('claude.context.environment')).toMatch(/git repository/)
    expect(varies('claude.prompt')).toBeUndefined()
    // ⛔ BroBot's text not where it was sent: nothing is cut by guess.
    expect(() => claudeParts(request, { append: 'not sent' }, scrubs, sections)).toThrow(
      /not in the system/,
    )
    // ⛔ …and a context message its transcript does not account for is not written either.
    expect(() => claudeParts(request, { append }, scrubs, sections.slice(1))).toThrow(
      /does not hold its/,
    )
    expect(() => claudeParts(request, { append }, scrubs, sections.slice(0, -1))).toThrow(
      /names no section for/,
    )
    // ⛔ …nor one whose sections are not joined by a blank line and nothing else.
    const squeezed = structuredClone(request)
    const block = squeezed.messages[1]?.content[0] as { text: string }
    block.text = block.text.replace('\n\n# MCP', '\n \n# MCP')
    expect(() => claudeParts(squeezed, { append }, scrubs, sections)).toThrow(/does not hold its/)
    // ⛔ …nor two parts of one name: a window lists them by it.
    const twice = [{ ...sections[0]!, label: 'date' }, ...sections.slice(1)]
    const doubled = structuredClone(request)
    const first = doubled.messages[1]?.content[0] as { text: string }
    first.text = first.text.replace(
      '# Environment\n - Primary working directory: /scratch/w',
      twice[0]!.text,
    )
    expect(() => claudeParts(doubled, { append }, scrubs, twice)).toThrow(
      /two parts would be named/,
    )
  })

  it('🔴 W4.186 · the context message’s sections, from Claude Code’s own transcript', () => {
    const transcript = readFileSync(
      join(here, 'fixtures', 'turn-as-sent', 'claude-transcript.jsonl'),
      'utf8',
    )
    const sections = claudeContextSections(transcript, 'W4157-PERSON')
    expect(sections.map((one) => one.label)).toEqual([
      'environment',
      'model',
      'deferred_tools_delta',
      'agent_listing_delta',
      'mcp_instructions_delta',
      'skill_listing',
      'total_tokens_reminder',
      'date',
    ])
    expect(sections.find((one) => one.label === 'skill_listing')?.text).toMatch(
      /^The following skills are available for use with the Skill tool/,
    )
    expect(sections.find((one) => one.label === 'agent_listing_delta')?.text).toMatch(
      /^Available agent types for the Agent tool/,
    )
  })

  it('🔴 Codex, both shapes: BroBot’s tools, AGENTS files and message out', () => {
    const agents =
      '# AGENTS.md instructions for /scratch/w\n\n<INSTRUCTIONS>\nBroBot’s rules\n</INSTRUCTIONS>'
    const functions = codexParts(
      {
        instructions: 'You are Codex.',
        tools: [
          { type: 'function', name: 'exec_command' },
          { type: 'namespace', name: 'brobot', tools: [{ name: 'give_work' }] },
        ],
        input: [
          {
            type: 'message',
            role: 'developer',
            content: [
              {
                type: 'input_text',
                text: '## Memory\n\n========= MEMORY_SUMMARY BEGINS =========\nmine\n========= MEMORY_SUMMARY ENDS =========',
              },
            ],
          },
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: agents }] },
          {
            type: 'message',
            role: 'user',
            content: [{ type: 'input_text', text: 'Composed by BroCrew for this conversation' }],
          },
        ],
      },
      scrubs,
      (text) => text.startsWith('Composed by BroCrew'),
    )
    expect(functions.shape).toBe('functions')
    expect(functions.parts.map((part) => part.id)).toEqual([
      'codex.prompt',
      'codex.tools',
      'codex.memory',
      'codex.agents-wrapper',
    ])
    expect(functions.parts[1]?.tools?.map((tool) => tool.name)).toEqual(['exec_command'])
    // ⚑ The request's own instructions and tools go with every request; its input items once, at
    // the head of the conversation, which every request then re-sends.
    expect(functions.parts.map((part) => part.when)).toEqual([
      'every-request',
      'every-request',
      'first-message',
      'first-message',
    ])
    expect(functions.parts[2]?.text).toContain(PLACEHOLDER.memorySummary)
    expect(functions.parts[3]?.text).toBe(
      `# AGENTS.md instructions for ${PLACEHOLDER.folder}\n\n<INSTRUCTIONS>\n${PLACEHOLDER.agentsFiles}\n</INSTRUCTIONS>`,
    )
    // ⚑ With the workspace's file too, Codex's own separator between the two stays.
    const two = codexParts(
      {
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: '# AGENTS.md instructions for /scratch/w\n\n<INSTRUCTIONS>\nmine\n\n--- project-doc ---\n\ntheirs\n</INSTRUCTIONS>',
              },
            ],
          },
        ],
      },
      scrubs,
      () => false,
    )
    expect(two.parts.at(-1)?.text).toBe(
      `# AGENTS.md instructions for ${PLACEHOLDER.folder}\n\n<INSTRUCTIONS>\n${PLACEHOLDER.agentsFiles}\n\n--- project-doc ---\n\n${PLACEHOLDER.workspaceAgentsFile}\n</INSTRUCTIONS>`,
    )

    const exec = codexParts(
      {
        input: [
          {
            type: 'additional_tools',
            tools: [
              {
                type: 'namespace',
                name: 'functions',
                tools: [
                  {
                    type: 'custom',
                    name: 'exec',
                    description:
                      '## exec_command\nRun.\n\n## brobot\n### `brobot__give_work`\nGive.\n\n## clock\nTime.',
                  },
                ],
              },
            ],
          },
          {
            type: 'message',
            role: 'developer',
            content: [{ type: 'input_text', text: 'You are Codex, an agent.' }],
          },
        ],
      },
      scrubs,
      () => false,
    )
    expect(exec.shape).toBe('exec')
    expect(exec.parts.map((part) => [part.id, part.where, part.when])).toEqual([
      ['codex.tools', 'tools', 'first-message'],
      ['codex.prompt', 'developer-message', 'first-message'],
    ])
    expect(exec.parts[0]?.tools?.map((tool) => tool.name)).toEqual(['functions', 'functions.exec'])
    const declared = JSON.parse(exec.parts[0]?.tools?.[1]?.text ?? '{}') as { description: string }
    expect(declared.description).toBe(
      `## exec_command\nRun.\n\n## brobot\n${PLACEHOLDER.brobotToolDeclarations}\n\n## clock\nTime.`,
    )
  })

  it('⚑ placeholders replace the longest value first, and count tokens left as one', () => {
    expect(
      scrubbed('/a/b/c and /a/b', [
        { from: '/a/b', to: '⟨B⟩' },
        { from: '/a/b/c', to: '⟨C⟩' },
      ]),
    ).toBe('⟨C⟩ and ⟨B⟩')
    expect(residueIn('/Users/x and mcp__brobot__give_work')).toEqual([
      '/Users/',
      'mcp__brobot__',
      'brobot__',
    ])
  })
})

describe('§5 · each platform shows the capture made on it', () => {
  it('⚑ Linux shows Linux’s own capture; every other platform the macOS one', () => {
    expect(capturedOnFor('linux')).toBe('linux')
    expect(snapshotFilesFor('linux')).toBe(SNAPSHOT_FILES_BY_PLATFORM.linux)
    for (const platform of ['darwin', 'win32', 'freebsd'] as const) {
      expect(capturedOnFor(platform), platform).toBe('macos')
      expect(snapshotFilesFor(platform), platform).toBe(SNAPSHOT_FILES_BY_PLATFORM.macos)
    }
    expect(SNAPSHOT_FILES).toBe(snapshotFilesFor(process.platform))
  })

  it('⚑ each capture says where it was made', () => {
    for (const provider of ['claude', 'codex'] as const) {
      expect(SNAPSHOT_FILES_BY_PLATFORM.linux[provider].notes[0], provider).toMatch(
        /^Captured on Linux/,
      )
      expect(SNAPSHOT_FILES_BY_PLATFORM.macos[provider].notes[0], provider).toMatch(
        /^Captured on macOS/,
      )
    }
  })
})
