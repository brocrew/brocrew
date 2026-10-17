import { describe, expect, it } from 'vitest'
import type { Provider } from '@brobot2/shared'
import { SNAPSHOT_FILES, snapshotCatalogue, snapshotFor } from '../src/main/provider-snapshots'
import {
  sizeOf,
  type KeptPart,
  type ProviderSnapshotFile,
  type SnapshotAnswer,
} from '../src/shared/provider-snapshots'

/**
 * # 🔴 F093 · R3 — a snapshot is the one of the model asked for, and its total is what stands in
 * front of the model before it asks for anything
 *
 * ⚑ **On files built here** (`snapshotFor`'s third argument), so each rule is read on a shape the test
 * chose — an alias that is another model's id, a provider with no default, a part sent only once
 * loaded — and then **on the files this build carries**, where a model of one provider is never
 * found under the other.
 *
 *  - §1 · by the name asked: an id, an alias, `[1m]`; an id before an alias; the id is what is said.
 *  - §2 · ⛔ never another model's parts: an unknown model, a model of the other provider, a
 *    default that names nothing — each said so, with the models that were captured.
 *  - §3 · the totals leave out a part sent only once loaded — paired with the same part sent always.
 *  - §4 · a part made whole again: its text by hash, a tools part as its tools one per line.
 */

const T = {
  prompt: 'You are a provider.\nBe brief.',
  first: 'A reminder at the head of the first message.',
  bash: '{"name":"Bash","description":"Run a command."}',
  read: '{"name":"Read","description":"Read a file."}',
  fetch: '{"name":"WebFetch","description":"Fetch a page. '.padEnd(400, 'x') + '"}',
  small: 'Small model prompt.',
  dflt: 'The default model prompt.',
} as const

/** ⚑ Hash keys as the probe writes them: opaque, one per text. */
const H = {
  prompt: 'h-prompt',
  first: 'h-first',
  bash: 'h-bash',
  read: 'h-read',
  fetch: 'h-fetch',
  small: 'h-small',
  dflt: 'h-default',
} as const

const TEXTS: Record<string, string> = {
  [H.prompt]: T.prompt,
  [H.first]: T.first,
  [H.bash]: T.bash,
  [H.read]: T.read,
  [H.fetch]: T.fetch,
  [H.small]: T.small,
  [H.dflt]: T.dflt,
}

const prompt: KeptPart = {
  id: 'p.prompt',
  title: 'prompt',
  where: 'system-prompt',
  when: 'every-request',
  text: H.prompt,
}
const tools: KeptPart = {
  id: 'p.tools',
  title: 'tools',
  where: 'tools',
  when: 'every-request',
  text: '',
  tools: [
    { name: 'Bash', text: H.bash },
    { name: 'Read', text: H.read },
  ],
}
const first: KeptPart = {
  id: 'p.first',
  title: 'first',
  where: 'first-message',
  when: 'first-message',
  text: H.first,
}
const deferred: KeptPart = {
  id: 'p.deferred',
  title: 'deferred',
  where: 'tools',
  when: 'when-loaded',
  text: '',
  tools: [{ name: 'WebFetch', text: H.fetch }],
}

/** ⚑ Claude-like: `small` is listed BEFORE `big` and goes by `big` too, so an alias could shadow an id. */
const claudeLike = (bigParts: readonly KeptPart[] = [prompt, tools, first, deferred]) =>
  ({
    provider: 'claude',
    version: '9.9.9',
    label: 'as of Claude Code 9.9.9',
    defaultModel: 'default',
    notes: ['a note'],
    models: {
      small: { shape: 'messages', alsoCalled: ['big', 'claude-small-1'], parts: [prompt] },
      big: { shape: 'messages', alsoCalled: ['claude-big-1'], parts: bigParts },
      default: { shape: 'messages', alsoCalled: [], parts: [{ ...prompt, text: H.dflt }] },
    },
    texts: TEXTS,
  }) satisfies ProviderSnapshotFile

/** ⚑ Codex-like, and with no default it could name. */
const codexLike = {
  provider: 'codex',
  version: '0.0.1',
  label: 'as of Codex 0.0.1',
  defaultModel: null,
  notes: [],
  models: {
    'gpt-x': { shape: 'functions', alsoCalled: [], parts: [{ ...prompt, text: H.small }] },
  },
  texts: TEXTS,
} satisfies ProviderSnapshotFile

const files = (claude: ProviderSnapshotFile = claudeLike()) =>
  ({ claude, codex: codexLike }) satisfies Record<Provider, ProviderSnapshotFile>

const found = (answer: SnapshotAnswer) => {
  if (!answer.found) throw new Error(`not found: ${answer.why}`)
  return answer.snapshot
}

describe('§1 · by the name asked', () => {
  it('🔴 an id, an alias, and either with `[1m]` find the one model — and the answer names it by its id', () => {
    for (const asked of ['big', 'big[1m]', 'claude-big-1', 'claude-big-1[1m]']) {
      const snapshot = found(snapshotFor('claude', asked, files()))
      expect(snapshot.model, asked).toBe('big')
      expect(
        snapshot.parts.map((one) => one.id),
        asked,
      ).toEqual(['p.prompt', 'p.tools', 'p.first', 'p.deferred'])
    }
    // ⚑ The control: the other model's own alias finds THAT model, by its id.
    expect(found(snapshotFor('claude', 'claude-small-1', files())).model).toBe('small')
  })

  it('🔴 an id wins over another model’s alias of the same name, though that model is listed first', () => {
    // ⚑ Premise: `small` comes first, and goes by `big`.
    const file = claudeLike()
    expect(Object.keys(file.models)[0]).toBe('small')
    expect(file.models.small.alsoCalled).toContain('big')
    expect(found(snapshotFor('claude', 'big', files(file))).model).toBe('big')
    expect(found(snapshotFor('claude', 'big[1m]', files(file))).model).toBe('big')
  })

  it('⚑ the answer carries the provider asked, and its file’s version, label and notes', () => {
    const snapshot = found(snapshotFor('claude', 'big', files()))
    expect(snapshot).toMatchObject({
      provider: 'claude',
      version: '9.9.9',
      label: 'as of Claude Code 9.9.9',
      shape: 'messages',
      notes: ['a note'],
    })
    expect(found(snapshotFor('codex', 'gpt-x', files()))).toMatchObject({
      provider: 'codex',
      version: '0.0.1',
      shape: 'functions',
    })
  })

  it('⚑ no model named: the provider’s default — and the default by its own name is the same', () => {
    const none = found(snapshotFor('claude', null, files()))
    expect(none.model).toBe('default')
    expect(none.parts[0]?.text).toBe(T.dflt)
    expect(found(snapshotFor('claude', 'default', files()))).toEqual(none)
  })
})

describe('§2 · ⛔ never another model’s parts', () => {
  it('⛔ an unknown model is said so, by the name as asked, with the models captured — never the default', () => {
    for (const asked of ['nonesuch', 'nonesuch[1m]', 'BIG', 'bi', 'big[1m][1m]', '[1m]']) {
      expect(snapshotFor('claude', asked, files()), asked).toEqual({
        found: false,
        why: `${asked} was not captured as of Claude Code 9.9.9.`,
        models: ['small', 'big', 'default'],
      })
    }
  })

  it('⛔ a default that names no model: said so, with the models captured', () => {
    expect(snapshotFor('codex', null, files())).toEqual({
      found: false,
      why: 'No model was named, and as of Codex 0.0.1 names no default.',
      models: ['gpt-x'],
    })
    // ⚑ The paired positive: the same provider by a model it captured.
    expect(snapshotFor('codex', 'gpt-x', files()).found).toBe(true)
  })

  it('⛔ a default that was not captured is said so too, never another model in its place', () => {
    const file = { ...claudeLike(), defaultModel: 'ghost' }
    expect(snapshotFor('claude', null, files(file))).toEqual({
      found: false,
      why: 'ghost was not captured as of Claude Code 9.9.9.',
      models: ['small', 'big', 'default'],
    })
  })

  it('⛔ a model of the other provider is not found — on the files built here and on the ones this build carries', () => {
    expect(snapshotFor('codex', 'big', files()).found).toBe(false)
    expect(snapshotFor('claude', 'gpt-x', files()).found).toBe(false)

    // ⚑ This build's files: no name one provider answers to is a name the other does.
    const names = (provider: Provider): string[] =>
      Object.entries(SNAPSHOT_FILES[provider].models).flatMap(([id, one]) => [
        id,
        ...one.alsoCalled,
      ])
    const claude = names('claude')
    const codex = names('codex')
    expect(claude.length).toBeGreaterThan(0)
    expect(codex.length).toBeGreaterThan(0)
    expect(claude.filter((one) => codex.includes(one))).toEqual([])
    for (const asked of claude) {
      // ⚑ Each found under its own provider first: a presence, then the absence.
      expect(snapshotFor('claude', asked).found, asked).toBe(true)
      const across = snapshotFor('codex', asked)
      expect(across, asked).toEqual({
        found: false,
        why: `${asked} was not captured ${SNAPSHOT_FILES.codex.label}.`,
        models: Object.keys(SNAPSHOT_FILES.codex.models),
      })
    }
    for (const asked of codex) {
      expect(snapshotFor('codex', asked).found, asked).toBe(true)
      expect(snapshotFor('claude', asked).found, asked).toBe(false)
    }
  })

  it('⚑ this build’s defaults are models it captured, each under its own provider', () => {
    for (const provider of ['claude', 'codex'] as const) {
      const file = SNAPSHOT_FILES[provider]
      expect(file.defaultModel, provider).not.toBeNull()
      expect(Object.keys(file.models), provider).toContain(file.defaultModel)
      const snapshot = found(snapshotFor(provider, null))
      expect(snapshot.provider).toBe(provider)
      expect(snapshot.model).toBe(file.defaultModel)
    }
  })
})

describe('§3 · the totals leave out a part sent only once loaded', () => {
  /** ⚑ The rule, written out: every part but those loaded on demand, one per line. */
  const before = (parts: readonly { when: string; text: string }[]) =>
    sizeOf(
      parts
        .filter((one) => one.when !== 'when-loaded')
        .map((one) => one.text)
        .join('\n'),
    )

  it('🔴 a part loaded on demand is out of all three measures; one sent with the first message is in', () => {
    const snapshot = found(snapshotFor('claude', 'big', files()))
    const expected = sizeOf([T.prompt, `${T.bash}\n${T.read}`, T.first].join('\n'))
    expect({
      chars: snapshot.chars,
      words: snapshot.words,
      approxTokens: snapshot.approxTokens,
    }).toEqual(expected)
    expect(expected).toEqual(before(snapshot.parts))
    // ⚑ …and the part itself is still there, in full, with its own size.
    const loaded = snapshot.parts.find((one) => one.id === 'p.deferred')
    expect(loaded?.text).toBe(T.fetch)
    expect(loaded?.chars).toBe(sizeOf(T.fetch).chars)
    expect(snapshot.chars).toBeLessThan(
      snapshot.parts.reduce((sum, one) => sum + one.chars, 0) + snapshot.parts.length,
    )
  })

  it('🔴 paired: the same part sent with every request is counted, and dropping the loaded one changes nothing', () => {
    const loadedOnDemand = found(snapshotFor('claude', 'big', files()))
    const sentAlways = found(
      snapshotFor(
        'claude',
        'big',
        files(claudeLike([prompt, tools, first, { ...deferred, when: 'every-request' }])),
      ),
    )
    const without = found(snapshotFor('claude', 'big', files(claudeLike([prompt, tools, first]))))

    expect(sentAlways.chars).toBe(
      sizeOf([T.prompt, `${T.bash}\n${T.read}`, T.first, T.fetch].join('\n')).chars,
    )
    expect(sentAlways.chars - loadedOnDemand.chars).toBe(sizeOf(`\n${T.fetch}`).chars)
    expect(sentAlways.words).toBeGreaterThan(loadedOnDemand.words)
    expect(sentAlways.approxTokens).toBeGreaterThan(loadedOnDemand.approxTokens)
    expect({
      chars: without.chars,
      words: without.words,
      approxTokens: without.approxTokens,
    }).toEqual({
      chars: loadedOnDemand.chars,
      words: loadedOnDemand.words,
      approxTokens: loadedOnDemand.approxTokens,
    })
  })

  it('⚑ a model whose only part is loaded on demand stands at nothing before it asks', () => {
    const file = claudeLike([deferred])
    const snapshot = found(snapshotFor('claude', 'big', files(file)))
    expect(snapshot.parts).toHaveLength(1)
    expect(snapshot.parts[0]?.chars).toBeGreaterThan(0)
    expect([snapshot.chars, snapshot.words, snapshot.approxTokens]).toEqual([0, 0, 0])
  })

  it('⚑ on every model this build carries: the total is its parts but the loaded ones — words and tokens too', () => {
    for (const provider of ['claude', 'codex'] as const) {
      for (const model of Object.keys(SNAPSHOT_FILES[provider].models)) {
        const snapshot = found(snapshotFor(provider, model))
        expect(
          { chars: snapshot.chars, words: snapshot.words, approxTokens: snapshot.approxTokens },
          `${provider} ${model}`,
        ).toEqual(before(snapshot.parts))
      }
    }
    // ⚑ Claude Code's deferred tools are there to leave out: the rule is not read on nothing.
    const opus = found(snapshotFor('claude', 'opus'))
    const loaded = opus.parts.filter((one) => one.when === 'when-loaded')
    expect(loaded.length).toBeGreaterThan(0)
    expect(loaded.every((one) => one.chars > 0)).toBe(true)
  })
})

describe('§4 · a part made whole again', () => {
  it('⚑ a tools part is its tools, one per line, each with its own size; a text part is its text by hash', () => {
    const snapshot = found(snapshotFor('claude', 'big', files()))
    const toolsPart = snapshot.parts.find((one) => one.id === 'p.tools')
    expect(toolsPart?.tools).toEqual([
      { name: 'Bash', text: T.bash, chars: sizeOf(T.bash).chars },
      { name: 'Read', text: T.read, chars: sizeOf(T.read).chars },
    ])
    expect(toolsPart?.text).toBe(`${T.bash}\n${T.read}`)
    const promptPart = snapshot.parts.find((one) => one.id === 'p.prompt')
    expect(promptPart).toMatchObject({ text: T.prompt, ...sizeOf(T.prompt) })
    expect(promptPart).not.toHaveProperty('tools')
  })

  it('⚑ a hash the file does not hold reads as no text, never as another', () => {
    const file = claudeLike([{ ...prompt, text: 'h-missing' }])
    const snapshot = found(snapshotFor('claude', 'big', files(file)))
    expect(snapshot.parts[0]).toMatchObject({ text: '', chars: 0, words: 0, approxTokens: 0 })
  })

  it('⚑ the catalogue: claude then codex whatever the files’ order, each model with its shape and other names', () => {
    const reversed = { codex: codexLike, claude: claudeLike() } as Record<
      Provider,
      ProviderSnapshotFile
    >
    const catalogue = snapshotCatalogue(reversed)
    expect(catalogue.map((one) => one.provider)).toEqual(['claude', 'codex'])
    expect(catalogue[0]).toEqual({
      provider: 'claude',
      version: '9.9.9',
      label: 'as of Claude Code 9.9.9',
      defaultModel: 'default',
      notes: ['a note'],
      models: [
        { model: 'small', shape: 'messages', alsoCalled: ['big', 'claude-small-1'] },
        { model: 'big', shape: 'messages', alsoCalled: ['claude-big-1'] },
        { model: 'default', shape: 'messages', alsoCalled: [] },
      ],
    })
    expect(catalogue[1]?.defaultModel).toBeNull()
  })
})
