import {
  sizeOf,
  sizesAdded,
  type GivenSection,
  type WhatThisAgentWasGiven,
  type WhatTheModelGot,
} from '../../src/shared/what-this-agent-was-given'
import type { ProviderSnapshot } from '../../src/shared/provider-snapshots'
import type { WhoseText } from '../../src/shared/whose-text'

/**
 * ⚑ **A fake answer to `whatThisAgentWasGiven`** (F093), for the popup's DOM tests and its look
 * scenes. ⛔ Fake data only: no provider home, no real memory.
 */
const PARTS: { whose: WhoseText; heading: string | null; body: string }[] = [
  { whose: 'factory', heading: null, body: '# Your instructions' },
  {
    whose: 'factory',
    heading: 'How you work',
    body: '- Understand the request before acting.\n- Hand out focused pieces when work is large.',
  },
  {
    whose: 'configured',
    heading: 'Your own instructions',
    body: 'You are the designer of the bakery website. Keep the brand colours and use plain words.',
  },
]

function profileFile(): { text: string; sections: GivenSection[] } {
  let text = ''
  const sections = PARTS.map((part, index): GivenSection => {
    const start = text.length
    const rendered = part.heading === null ? part.body : `## ${part.heading}\n\n${part.body}`
    text += index === PARTS.length - 1 ? `${rendered}\n` : `${rendered}\n\n`
    const own = part.whose === 'configured'
    return {
      heading: part.heading,
      whose: part.whose,
      made: own ? 'own-instructions' : 'shipped',
      version: own
        ? {
            version: 3,
            whoWroteIt: 'person',
            whoWroteItMeans: 'you wrote this',
            by: { kind: 'person' },
            writtenAt: Date.UTC(2026, 9, 4, 18, 30),
            conversation: null,
            broughtBack: null,
          }
        : null,
      start,
      end: text.length,
      size: sizeOf(rendered),
    } as GivenSection
  })
  return { text, sections }
}

const PROMPT = 'You are Claude Code, Anthropic’s official CLI. Today’s date is ⟨date⟩.'
const READ_TOOL = '{"name":"Read","description":"Reads a file from the local filesystem."}'
const BASH_TOOL = '{"name":"Bash","description":"Executes a bash command."}'
const SNAPSHOT: ProviderSnapshot = {
  provider: 'claude',
  version: '2.1.287',
  label: 'as of Claude Code 2.1.287',
  model: 'claude-opus-5',
  shape: 'messages',
  notes: ['The skills list depends on the folder, so it is shown as ⟨skills⟩.'],
  parts: [
    {
      id: 'claude.prompt',
      title: 'Its system prompt',
      where: 'system-prompt',
      when: 'every-request',
      text: PROMPT,
      chars: PROMPT.length,
      words: PROMPT.split(/\s+/).length,
      approxTokens: Math.round(PROMPT.length / 4),
    },
    {
      id: 'claude.tools',
      title: 'Its built-in tools',
      where: 'tools',
      when: 'every-request',
      text: `${READ_TOOL}\n${BASH_TOOL}`,
      chars: READ_TOOL.length + BASH_TOOL.length,
      words: 10,
      approxTokens: Math.round((READ_TOOL.length + BASH_TOOL.length) / 4),
      varies: 'which built-in tools it has depends on the account and its settings',
      tools: [
        { name: 'Read', text: READ_TOOL, chars: READ_TOOL.length },
        { name: 'Bash', text: BASH_TOOL, chars: BASH_TOOL.length },
      ],
    },
  ],
  chars: PROMPT.length + READ_TOOL.length + BASH_TOOL.length,
  words: 22,
  approxTokens: Math.round((PROMPT.length + READ_TOOL.length + BASH_TOOL.length) / 4),
}

const CONVENTIONS = '# Contributing\n\nRun the tests before a commit.\n'
const NOTE = (at: number): string => `A note the designer kept, number ${at + 1}.`
const MEMORY_DIR = '/Users/someone/provider-homes/designer/memory'

export function givenAnswer(over: Partial<WhatThisAgentWasGiven> = {}): WhatThisAgentWasGiven {
  const own = profileFile()
  const brobot = sizeOf(own.text)
  const other = sizeOf(CONVENTIONS)
  const tool = {
    name: 'give_work',
    description: 'Give an agent a piece of work, with a title and a self-contained brief.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Who gets it' },
        brief: { type: 'string', description: 'What to do' },
      },
      required: ['agent', 'brief'],
    },
    size: sizeOf('Give an agent a piece of work, with a title and a self-contained brief.'),
  }
  // ⚑ Summed as the backend sums it (`main/runtime/what-this-agent-was-given.ts`): BroBot's words,
  // the other files, the tools as they reach every request (names only, since Claude loads each
  // definition on request), the memory in every request, and the provider's own parts.
  const memory = sizeOf('- [Warm colours](warm-colours.md)')
  const toolNames = sizeOf('mcp__brobot__give_work')
  const providerSize = {
    characters: SNAPSHOT.chars,
    words: SNAPSHOT.words,
    tokens: SNAPSHOT.approxTokens,
  }
  // ⚑ W4.184 · the person's other servers' tools, by name, as Claude's tool search hands them over.
  const otherTools = sizeOf(['mcp__gmail__search_emails', 'mcp__gmail__read_email'].join('\n'))
  const total = sizesAdded([brobot, other, toolNames, otherTools, memory, providerSize])
  return {
    sessionId: 'sess_1',
    provider: 'claude',
    profileId: 'designer',
    readAt: Date.UTC(2026, 9, 5, 6, 0),
    launch: {
      recorded: true,
      at: Date.UTC(2026, 9, 5, 5, 40),
      build: { id: 'abc1234', commit: 'abc1234' },
      thisBuild: true,
      running: true,
    },
    placement: 'system-prompt',
    files: [
      {
        path: '/Users/someone/provider-homes/designer/brobot-instructions.md',
        kind: 'profile-instructions',
        origin: 'brobot',
        madeAutomatically: true,
        originSays: 'Made by BroBot automatically at each launch',
        reach: 'in-every-request',
        text: own.text,
        textIs: 'as-launched',
        changedSinceLaunch: false,
        truncated: false,
        sections: own.sections,
        size: brobot,
        refused: null,
      },
      {
        path: '/Users/someone/work/bakery/CONTRIBUTING.md',
        kind: 'repository-conventions',
        origin: 'a-repository',
        madeAutomatically: false,
        originSays: 'From the repository, written by its authors',
        reach: 'in-every-request',
        text: CONVENTIONS,
        textIs: 'read-now',
        changedSinceLaunch: true,
        truncated: false,
        sections: [],
        size: other,
        refused: null,
      },
    ],
    thisConversation: null,
    ownInstructions: {
      used: own.sections[2]!.version,
      newest: own.sections[2]!.version,
      changedSinceLaunch: false,
    },
    tools: {
      server: 'brobot',
      instructions: {
        text: 'Use these tools to reach the app you run inside.',
        ridesIn: 'in-the-first-message',
        size: sizeOf('Use these tools to reach the app you run inside.'),
      },
      deferral: {
        kind: 'names-until-loaded',
        says: 'Claude sees only their names until it loads one.',
      },
      changedSinceLaunch: false,
      list: [tool],
      size: tool.size,
    },
    externalServers: [
      {
        name: 'gmail',
        tools: ['search_emails', 'read_email'],
        deferral: {
          kind: 'names-until-loaded',
          says: 'Claude sees only their names until it loads one.',
        },
      },
    ],
    memory: {
      readAt: Date.UTC(2026, 9, 5, 6, 0),
      stores: [
        {
          provider: 'claude',
          state: 'read',
          dir: MEMORY_DIR,
          entries: Array.from({ length: 3 }, (_, at) => ({
            path: `${MEMORY_DIR}/note-${at + 1}.md`,
            kind: 'agent-memory-note' as const,
            origin: 'an-agent' as const,
            reach: 'when-the-agent-opens-it' as const,
            text: NOTE(at),
            truncated: false,
            changedSinceLaunch: at === 0,
            amendable: true,
            size: sizeOf(NOTE(at)),
          })),
          total: 5,
          nextOffset: 3,
          refused: [],
        },
      ],
      atLaunch: [
        {
          path: `${MEMORY_DIR}/MEMORY.md`,
          kind: 'agent-memory',
          bytes: 58,
          sha256: 'a'.repeat(64),
        },
      ],
    },
    providerParts: {
      version: '2.1.287',
      model: 'claude-opus-5',
      snapshot: SNAPSHOT,
      why: null,
    },
    size: {
      brobot,
      otherFiles: other,
      tools: tool.size,
      toolsInEveryRequest: toolNames,
      otherServersToolsInEveryRequest: otherTools,
      otherServersToolsWhy: null,
      memoryInEveryRequest: memory,
      provider: providerSize,
      total,
      contextWindow: { tokens: 200_000, share: total.tokens / 200_000 },
      contextWindowWhy: null,
    },
    ...over,
  }
}

/** ⚑ A fake answer to `whatTheModelGot`: one relayed message as the model got it. */
export function modelGotAnswer(over: Partial<WhatTheModelGot> = {}): WhatTheModelGot {
  const sent =
    'From Pat (pm), who reads your reply. This is about W1.2 · Landing page header.\n\nMake the header warmer, and keep the logo where it is.'
  return {
    sessionId: 'sess_1',
    provider: 'claude',
    ordinal: 42,
    at: Date.UTC(2026, 9, 5, 6, 10),
    words: ['Make the header warmer, and keep the logo where it is.'],
    launch: { ordinal: 3, at: Date.UTC(2026, 9, 5, 5, 40), recorded: true },
    firstOfItsLaunch: false,
    parts: [
      {
        where: 'system-prompt',
        kind: 'profile-instructions',
        title: 'BroCrew’s instructions for this agent',
        origin: 'brobot',
        path: '/Users/someone/provider-homes/designer/brobot-instructions.md',
        text: '# Your instructions\n\n## How you work\n\n- Understand the request before acting.',
        why: null,
        size: sizeOf(
          '# Your instructions\n\n## How you work\n\n- Understand the request before acting.',
        ),
      },
      {
        where: 'system-prompt',
        kind: 'repository-conventions',
        title: 'CONTRIBUTING.md, from the repository',
        origin: 'a-repository',
        path: '/Users/someone/work/bakery/CONTRIBUTING.md',
        text: null,
        why: 'Kept by fingerprint only: it has changed since, so the text the model got is not known.',
        size: null,
      },
      {
        where: 'this-message',
        kind: 'the-message',
        title: 'The message, with BroBot’s lines around it',
        origin: 'brobot',
        path: null,
        text: sent,
        why: null,
        size: sizeOf(sent),
      },
    ],
    providersRecord: {
      found: true,
      provider: 'claude',
      version: '2.1.287',
      whole: true,
      message: sent,
      parts: [{ author: 'the-message', label: 'The message', role: 'user', text: sent }],
      standing: [
        {
          author: 'the-provider',
          label: 'A reminder Claude Code added',
          role: 'user',
          text: '<system-reminder>Today’s date is ⟨date⟩.</system-reminder>',
        },
      ],
      leavesOut: ['the-system-prompt', 'after-its-first-answer'],
      records: [],
    },
    providerKeptTheSameText: true,
    ...over,
  }
}
