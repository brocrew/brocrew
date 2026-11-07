import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sniffAsset, type AssetFacts } from '../../src/shared/themes/assets'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
const ROOT = join(__dirname, '../../resources/themes')
const IDS = readdirSync(ROOT).filter((name) => statSync(join(ROOT, name)).isDirectory())

const filesUnder = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? filesUnder(path) : [path]
  })

interface Folder {
  readonly raw: Record<string, unknown>
  readonly assets: Map<string, AssetFacts>
}

function read(id: string): Folder {
  const raw = JSON.parse(readFileSync(join(ROOT, id, 'theme.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const assets = new Map<string, AssetFacts>()
  const assetDir = join(ROOT, id, 'assets')
  for (const file of statSync(assetDir, { throwIfNoEntry: false }) ? filesUnder(assetDir) : []) {
    const path = relative(join(ROOT, id), file).split(sep).join('/')
    const bytes = readFileSync(file)
    const sniffed = sniffAsset(bytes)
    if (!sniffed.ok) throw new Error(`${id}/${path}: ${sniffed.says}`)
    assets.set(path, sniffed.facts)
  }
  return { raw, assets }
}

const folders = new Map(IDS.map((id) => [id, read(id)]))

function validateAll(): Map<string, Theme> {
  const resolved = new Map<string, Theme>()
  const pending = new Set(IDS)
  while (pending.size) {
    const ready = [...pending].filter((id) => {
      const base = folders.get(id)!.raw.extends
      return typeof base !== 'string' || resolved.has(base)
    })
    if (ready.length === 0) throw new Error(`no base for: ${[...pending].join(', ')}`)
    for (const id of ready) {
      const folder = folders.get(id)!
      const r = validateTheme(folder.raw, {
        assets: folder.assets,
        builtIns: resolved,
        builtIn: true,
      })
      if (!r.ok)
        throw new Error(`${id}: ${r.problems.map((p) => `${p.at}: ${p.says}`).join(' | ')}`)
      resolved.set(id, resolveTheme(r.theme, resolved.get(r.theme.extends ?? '')))
      pending.delete(id)
    }
  }
  return resolved
}

describe('the themes the app ships', () => {
  it('are the samples chosen for now', () => {
    expect(IDS.sort()).toEqual(['brocrew', 'crew-night', 'defined', 'synthwave'])
  })

  it('all validate, bases first', () => {
    expect([...validateAll().keys()].sort()).toEqual([...IDS].sort())
  })

  it.each(IDS)('%s is named by its folder', (id) => {
    expect(folders.get(id)!.raw.id).toBe(id)
  })

  it.each(IDS)('%s is not local-only: everything in this folder ships', (id) => {
    expect(folders.get(id)!.raw.localOnly).toBeUndefined()
  })

  it.each(IDS)('%s holds only PNG and JPEG pictures', (id) => {
    for (const [path, facts] of folders.get(id)!.assets) {
      expect(['png', 'jpeg'], path).toContain(facts.type)
    }
  })
})

describe('BroCrew’s words in the second accent, before it set their colour by hand', () => {
  const brocrew = folders.get('brocrew')!
  const raw = brocrew.raw as {
    content: Record<string, string>
    tokens: { content: Record<string, string> }
  }
  const tokens = { ...raw.tokens.content }
  delete tokens['accent-2-text']
  const without = { ...raw, tokens: { ...raw.tokens, content: tokens } }
  const check = (file: Record<string, unknown>) =>
    validateTheme(file, {
      assets: brocrew.assets,
      builtIns: new Map([['defined', validateAll().get('defined')!]]),
      builtIn: true,
    })

  it('accepts the original colours without contrast overrides', () => {
    expect(check(without)).toMatchObject({ ok: true })
  })

  it('also accepts darker colours and explicit paint overrides', () => {
    const darker = { ...without, content: { ...without.content, accent2: '#565bb5' } }
    expect(check(darker)).toMatchObject({ ok: true })
    expect(check(raw)).toMatchObject({ ok: true })
  })
})
