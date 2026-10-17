import { readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { agentToolsFor, refuseTool, type AgentToolHost } from '../../src/main/runtime/agent-tools'
import {
  THEME_TOOL_DESCRIPTIONS,
  THEME_TOOL_NAMES,
  THEME_TOOL_REASONS,
} from '../../src/main/themes/tool-words'
import { themeProblem } from '../../src/main/themes/words'
import type { ThemeStore } from '../../src/main/themes/store'
import { LIMITS } from '../../src/shared/themes/assets'
import { themeCatalogue } from '../../src/shared/themes/catalogue'
import { HELD_SETTINGS } from '../../src/shared/themes/schema'
import { childTheme, createHostFixture, RED_PNG, type HostFixture } from './host-fixtures'

let fixture: HostFixture
let store: ThemeStore
beforeEach(async () => {
  fixture = await createHostFixture()
  store = fixture.store({ problem: themeProblem })
  await store.start()
})
afterEach(async () => {
  await fixture.cleanup()
})

function tools() {
  const receipts: { tool: string; refusal: unknown }[] = []
  const boundary = new Proxy(
    {},
    {
      get: (_target, key) => {
        if (key === 'themes') return store
        if (key === 'mayReachAtAll') return () => null
        if (key === 'whatToCallTheConversation') return () => 'Ada'
        if (key === 'noteRefusal')
          return (_me: string, tool: string, refusal: unknown) => receipts.push({ tool, refusal })
        throw new Error(`unexpected host read ${String(key)}`)
      },
    },
  ) as AgentToolHost
  const set = agentToolsFor(boundary, 'fictional-conversation')
  const call = async (name: string, args: Record<string, unknown>) => {
    const tool = set.tools.find((one) => one.name === name)
    expect(tool).toBeDefined()
    return tool!.call(args)
  }
  return { set, call, receipts }
}

describe('theme tools use the workspace store and carry their facts once', () => {
  it('advertises tools without reading host services before a call', () => {
    const host = new Proxy(
      {},
      {
        get: (_target, key) => {
          throw new Error(`unexpected host read ${String(key)}`)
        },
      },
    ) as AgentToolHost
    const set = agentToolsFor(host, 'fictional-conversation')
    for (const name of THEME_TOOL_NAMES)
      expect(set.tools.some((one) => one.name === name)).toBe(true)
  })

  it('offers all three without a grant and uses the approved descriptions', () => {
    const { set } = tools()
    for (const name of THEME_TOOL_NAMES) {
      const tool = set.tools.find((one) => one.name === name)!
      expect(tool.description).toBe(THEME_TOOL_DESCRIPTIONS[name])
      expect(tool.beyondItsRails).toBe('nothing-its-rails-do-not-cover')
    }
  })

  it('lists active and refused entries; settings and catalogue are opt-in reads', async () => {
    const { call } = tools()
    const plain = await call('list_themes', {})
    expect(plain.text).toContain('Active theme: defined.')
    expect(plain.text).toContain('classic · Classic · built-in · ok')
    expect(plain.structured).not.toHaveProperty('theme')
    expect(plain.structured).not.toHaveProperty('catalogue')
    const requested = await call('list_themes', { id: 'defined', catalogue: true })
    expect(requested.structured).toHaveProperty('theme.id', 'defined')
    const catalogue = themeCatalogue()
    expect(requested.structured).toHaveProperty('catalogue', {
      ...catalogue,
      ...(catalogue.background
        ? { background: catalogue.background.replace('png|jpg|webp', 'png|jpg') }
        : {}),
      limits: catalogue.limits.replace('PNG, JPEG or WebP', 'PNG or JPEG'),
    })
    expect(requested.text).not.toContain('WebP')
    expect(requested.text).not.toContain('|webp')
    expect(requested.text.match(/^id: defined$/gm)).toHaveLength(1)
    expect(requested.text).toContain('settings[0].path:')
    for (const held of HELD_SETTINGS) {
      expect(requested.text).not.toMatch(new RegExp(`\\.path: ${held.replace(/\./g, '\\.')}\\b`))
    }
    expect(requested.text).not.toContain('"theme":')
  })

  it('lists the tokens a theme may set by zone, and says so', async () => {
    const sentence =
      'Tokens are listed per zone: frame (the title bar and left rail) and content (the conversation and its panels). Some tokens can be set only in content.'
    expect(THEME_TOOL_DESCRIPTIONS.list_themes).toContain(sentence)
    expect(THEME_TOOL_DESCRIPTIONS.save_theme).toContain(sentence)
    const { call } = tools()
    const listed = await call('list_themes', { catalogue: true })
    const tokens = (listed.structured as { catalogue: { tokens: Record<string, string[]> } })
      .catalogue.tokens
    expect(Object.keys(tokens)).toEqual(['frame', 'content'])
    expect(tokens.content).toContain('accent-2-text')
    expect(tokens.frame).not.toContain('accent-2-text')
    expect(tokens.frame).toContain('accent-text')
    // In words, each token is written under its zone.
    const lines = listed.text.split('\n')
    expect(lines.some((line) => /^tokens\.content\[\d+\]: accent-2-text$/.test(line))).toBe(true)
    expect(lines.some((line) => /^tokens\.frame\[\d+\]: accent-text$/.test(line))).toBe(true)
    expect(lines.filter((line) => /^tokens\.frame\[\d+\]: accent-2-text$/.test(line))).toEqual([])
  })

  it('copies files after admission, says the saved version and never echoes supplied contents', async () => {
    const { call } = tools()
    const description = 'DO NOT ECHO THIS THEME DESCRIPTION'
    const saved = await call('save_theme', {
      theme: { ...childTheme('mine'), description },
      assets: [{ name: 'red.png', base64: RED_PNG.toString('base64') }],
      activate: true,
    })
    expect(saved.structured).toMatchObject({
      outcome: 'ok',
      id: 'mine',
      active: 'mine',
      warnings: [],
    })
    expect(saved.text).toBe(
      `Saved mine, version ${saved.structured!['version']}. Active theme: mine.`,
    )
    expect(saved.text).not.toContain(description)
    expect(saved.text).not.toContain(RED_PNG.toString('base64'))
    expect(await readFile(join(fixture.library, 'mine/assets/red.png'))).toEqual(RED_PNG)
    const changes: unknown[] = []
    store.onChanged((change) => changes.push(change))
    const set = await call('set_theme', { id: 'classic' })
    expect(set.structured).toEqual({ outcome: 'ok', active: 'classic', previous: 'mine' })
    expect(set.text).toBe('Active theme: classic. Previous theme: mine.')
    expect(changes).toEqual([
      expect.objectContaining({ active: 'classic', previous: 'mine', actor: 'Ada' }),
    ])
  })

  it('invalid assets retain actionable prose and record only the app reason', async () => {
    const { call, receipts } = tools()
    const refused = await call('save_theme', {
      theme: childTheme('bad'),
      assets: [{ name: 'bad.svg', base64: Buffer.from('<svg/>').toString('base64') }],
    })
    expect(refused.structured).toMatchObject({
      outcome: 'refused',
      rail: 'theme-invalid',
      retryable: true,
    })
    expect(refused.text).toMatch(/^refused \(theme-invalid\): /)
    expect(refused.text).toContain('assets/bad.svg:')
    expect(refused.text).toContain('This refusal holds only while the reason lasts.')
    expect(refused.text.match(/assets\/bad\.svg:/g)).toHaveLength(1)
    expect(refused.text.match(/This refusal holds only while the reason lasts\./g)).toHaveLength(1)
    expect(refused.structured).toHaveProperty('reason', THEME_TOOL_REASONS['theme-invalid'])
    expect(refused.text).not.toContain('<svg/>')
    expect(receipts).toEqual([
      {
        tool: 'save_theme',
        refusal: {
          rail: 'theme-invalid',
          permanence: 'while-this-holds',
          retryable: true,
          remedy: 'change-what-you-sent-and-call-again',
          told: { text: THEME_TOOL_REASONS['theme-invalid'], dropped: 0 },
        },
      },
    ])
    expect(await readdir(fixture.library)).toEqual([])
  })

  it('distinguishes built-in, exists and unknown refusals with the same actionable prose', async () => {
    const { call } = tools()
    const built = await call('save_theme', { theme: childTheme('defined'), replace: true })
    expect(built.structured).toMatchObject({
      rail: 'theme-is-built-in',
      retryable: false,
      remedy: null,
    })
    expect(built.text).toContain('Save it under a new id.')
    expect(built.text).toContain('This exact call can never succeed.')
    await call('save_theme', { theme: childTheme('mine') })
    const exists = await call('save_theme', { theme: childTheme('mine') })
    expect(exists.structured).toHaveProperty('rail', 'theme-exists')
    expect(exists.text).toContain('Set replace to true')
    const unknown = await call('set_theme', { id: 'missing' })
    expect(unknown.structured).toHaveProperty('rail', 'theme-unknown')
    expect(unknown.text).toContain('Call list_themes')
    const file = join(fixture.source, 'big.png')
    await writeFile(file, Buffer.alloc(LIMITS.pictureBytes + 1))
    const tooLarge = await call('save_theme', {
      theme: childTheme('big'),
      assets: [{ name: 'big.png', path: file }],
    })
    expect(tooLarge.text).toContain(`${file} is over 4 MB; it can be up to 4 MB.`)
    const invalid = await call('save_theme', {
      theme: childTheme('bad'),
      assets: [{ name: '../bad.png', path: file }],
    })
    for (const answer of [exists, unknown, tooLarge, invalid])
      expect(answer.structured).toMatchObject({
        retryable: true,
        remedy: 'change-what-you-sent-and-call-again',
      })
  })

  it('malformed calls carry problems in words and perform no store mutation', async () => {
    const { call, receipts } = tools()
    for (const [name, args, problemAt] of [
      ['save_theme', {}, 'theme:'],
      ['save_theme', { theme: null }, 'theme:'],
      ['set_theme', {}, 'id:'],
      ['list_themes', { catalogue: 'yes' }, 'catalogue:'],
      ['message_agent', {}, 'agent: required; send the agent as text'],
    ] as const) {
      const before = receipts.length
      const refused = await call(name, args)
      expect(refused.structured).toHaveProperty('outcome', 'refused')
      expect(refused.structured).toHaveProperty('rail', 'malformed-request')
      const detail = refused.structured!['detail'] as { problems: string[] }
      expect(detail.problems.length).toBeGreaterThan(0)
      expect(detail.problems.some((one) => one.startsWith(problemAt))).toBe(true)
      expect(refused.text).toContain(problemAt)
      expect(refused.structured).toEqual(refuseTool('malformed-request', detail))
      const reason = refused.structured!['reason'] as string
      expect(refused.text).toBe(
        `refused (malformed-request): ${reason} Problems: ${detail.problems.map((one) => one.trim().replace(/[.;]+$/u, '')).join('; ')}. This exact call can never succeed. Fix it and call again.`,
      )
      expect(refused.text.match(/This exact call can never succeed\./g)).toHaveLength(1)
      expect(refused.text.match(/Fix it and call again\./g)).toHaveLength(1)
      expect(refused.text.match(/Problems:/g)).toHaveLength(1)
      for (const problem of detail.problems) expect(refused.text.split(problem).length - 1).toBe(1)
      expect(receipts.slice(before)).toEqual([
        {
          tool: name,
          refusal: {
            rail: 'malformed-request',
            permanence: 'permanent',
            retryable: false,
            remedy: null,
            told: {
              text:
                name === 'message_agent'
                  ? `${reason} Problems: agent: required; send the agent as text; text: required; send a non-blank text message. This exact call can never succeed. Fix it and call again.`
                  : reason,
              dropped: 0,
            },
          },
        },
      ])
    }
    expect(await readdir(fixture.library)).toEqual([])
  })

  it('keeps supplied asset names and paths and echoed keys out of the recorded quotation', async () => {
    const { call, receipts } = tools()
    const assetName = 'PRIVATE_CALLER_ASSET.svg'
    const file = join(fixture.source, 'PRIVATE_CALLER_PATH.png')
    await writeFile(file, Buffer.alloc(LIMITS.pictureBytes + 1))
    const problemKey = 'PRIVATE_CALLER_KEY'
    const cases = [
      {
        name: 'save_theme',
        args: {
          theme: childTheme('asset-refused'),
          assets: [{ name: assetName, base64: Buffer.from('<svg/>').toString('base64') }],
        },
        privateText: assetName,
        rail: 'theme-invalid',
        reason: THEME_TOOL_REASONS['theme-invalid'],
      },
      {
        name: 'save_theme',
        args: { theme: childTheme('path-refused'), assets: [{ name: 'big.png', path: file }] },
        privateText: file,
        rail: 'theme-too-large',
        reason: THEME_TOOL_REASONS['theme-too-large'],
      },
      {
        name: 'list_themes',
        args: { [problemKey]: true },
        privateText: problemKey,
        rail: 'malformed-request',
        reason: refuseTool('malformed-request').reason,
      },
    ]
    for (const one of cases) {
      const before = receipts.length
      const refused = await call(one.name, one.args)
      expect(refused.structured).toMatchObject({
        outcome: 'refused',
        rail: one.rail,
        reason: one.reason,
      })
      expect(refused.text).toContain(one.privateText)
      expect(JSON.stringify(refused.structured!['detail'])).toContain(one.privateText)
      const kept = receipts.slice(before)
      expect(kept).toHaveLength(1)
      expect(kept[0]).toEqual({
        tool: one.name,
        refusal: {
          rail: one.rail,
          permanence: one.rail === 'malformed-request' ? 'permanent' : 'while-this-holds',
          retryable: one.rail !== 'malformed-request',
          remedy: one.rail === 'malformed-request' ? null : 'change-what-you-sent-and-call-again',
          told: { text: one.reason, dropped: 0 },
        },
      })
      expect(JSON.stringify(kept)).not.toContain(one.privateText)
      expect(refused.text.startsWith(`refused (${one.rail}): ${one.reason}`)).toBe(true)
    }
    expect(await readdir(fixture.library)).toEqual([])
  })
})
