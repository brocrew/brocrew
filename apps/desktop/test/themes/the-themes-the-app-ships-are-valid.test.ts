import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { sniffAsset, type AssetFacts } from '../../src/shared/themes/assets'
import type { PictureSamples } from '../../src/shared/themes/contrast'
import { resolveTheme, type Theme } from '../../src/shared/themes/theme'
import { validateTheme } from '../../src/shared/themes/validate'
import { pngSamples } from './png-samples'

/**
 * Every theme in `resources/themes`, the folder packaged beside the app, read as the host reads
 * it: each file sniffed, each picture sampled, bases validated before the themes that extend them.
 */
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
  readonly pictures: Map<string, PictureSamples>
}

function read(id: string): Folder {
  const raw = JSON.parse(readFileSync(join(ROOT, id, 'theme.json'), 'utf8')) as Record<
    string,
    unknown
  >
  const assets = new Map<string, AssetFacts>()
  const pictures = new Map<string, PictureSamples>()
  const assetDir = join(ROOT, id, 'assets')
  for (const file of statSync(assetDir, { throwIfNoEntry: false }) ? filesUnder(assetDir) : []) {
    const path = relative(join(ROOT, id), file).split(sep).join('/')
    const bytes = readFileSync(file)
    const sniffed = sniffAsset(bytes)
    if (!sniffed.ok) throw new Error(`${id}/${path}: ${sniffed.says}`)
    assets.set(path, sniffed.facts)
    if (sniffed.facts.type === 'png') pictures.set(path, pngSamples(bytes))
  }
  return { raw, assets, pictures }
}

const folders = new Map(IDS.map((id) => [id, read(id)]))

/** Validates every built-in, bases first, as the host does. */
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
      const inherited = new Map(folder.pictures)
      for (const [base] of resolved) {
        for (const [path, samples] of folders.get(base)!.pictures)
          inherited.set(`@${base}/${path}`, samples)
      }
      const r = validateTheme(folder.raw, {
        assets: folder.assets,
        pictures: inherited,
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
    expect(IDS.sort()).toEqual(['brocrew', 'defined', 'synthwave'])
  })

  it('all validate, readability included, bases first', () => {
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
      pictures: brocrew.pictures,
      builtIns: new Map([['defined', validateAll().get('defined')!]]),
      builtIn: true,
    })

  it('is refused at the setting that decides them, in the existing words', () => {
    const read = check(without)
    expect(read.ok).toBe(false)
    if (read.ok) return
    // On the page, on the weak tint and in the right-hand panel: each names the second accent.
    expect(new Set(read.problems.map((p) => p.at))).toEqual(new Set(['content.accent2']))
    for (const p of read.problems)
      expect(p.says).toMatch(/would be too faint: .* Change `content\.accent2`\./)
    expect(read.problems.map((p) => p.says.split(' would')[0])).toContain('Links on the page')
  })

  it('…and following the hint puts it right, as does setting their colour by hand', () => {
    const darker = { ...without, content: { ...without.content, accent2: '#565bb5' } }
    expect(check(darker)).toMatchObject({ ok: true })
    expect(check(raw)).toMatchObject({ ok: true })
  })
})
