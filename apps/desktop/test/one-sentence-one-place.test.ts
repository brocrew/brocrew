import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { parse as parseSfc } from 'vue/compiler-sfc'

/**
 * 🔴 **700 · `688` H2 — the go-ahead's sentence lives in ONE place, and both processes read it.**
 *
 * ⚑ *"The plan was released but the go-ahead was not sent — type your next message to carry on"* is
 * what a person is told when a released plan's go-ahead did not go: main says it when the send fails
 * (`theGoAheadWasNotSent`, 060/670), and the renderer draws it when a person takes a held go-ahead back
 * (`688`, R33) — the same state, so the same words. ⛔ **Until 700 the bytes lived twice**, main's error
 * and the renderer's two halves, pinned equal by a test that drove the real host's failed send.
 * ⚑ `shared/the-go-ahead.ts` holds them now, and this census is what the pin became: **no other source
 * file spells either half.**
 *
 * ⚑ **Scoped by what it is ABOUT, not by where the copies were** (rule 27.1): every `.ts` and `.vue`
 * under `apps/desktop/src` and every package's `src`. ⚠️ **It reads CODE, never prose** — string and
 * template literals through the TypeScript parser, and a template's text with its comments removed —
 * so a docblock that quotes the sentence (this one does) is not a copy
 * ([[a-source-census-must-strip-prose-before-it-asserts]]).
 */

const REPO = join(__dirname, '../../..')
const THE_ONE_PLACE = 'apps/desktop/src/shared/the-go-ahead.ts'

/** The two halves, each short enough that splitting one across a `+` would take deliberate effort. */
const HALVES = ['go-ahead was not sent', 'type your next message to carry on'] as const

/** Every literal's cooked text in one script. */
function literalsOf(name: string, source: string): string[] {
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    )
      found.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true))
  return found
}

/**
 * ⚑ **Whitespace runs read as one space** — how Vue's default `condense` draws a template's text, and
 * how prettier's wrap of a long template sentence must be read: across the line break, as one.
 */
const flat = (text: string): string => text.replace(/\s+/g, ' ')

/** ⚑ **What a file SAYS, as code** — its literals, and a template's text without its comments. */
function spokenIn(name: string, source: string): string[] {
  if (!name.endsWith('.vue')) return literalsOf(name, source).map(flat)
  const { descriptor } = parseSfc(source, { filename: name })
  const scripts = [descriptor.script?.content, descriptor.scriptSetup?.content].filter(
    (one): one is string => one !== undefined,
  )
  return [
    ...scripts.flatMap((one, i) => literalsOf(`${name}.${i}.ts`, one)),
    (descriptor.template?.content ?? '').replace(/<!--[\s\S]*?-->/g, ''),
  ].map(flat)
}

/** Every source file of the app and the packages, repo-relative. */
function sources(): string[] {
  const roots = [
    'apps/desktop/src',
    ...readdirSync(join(REPO, 'packages'), { withFileTypes: true })
      .filter((one) => one.isDirectory())
      .map((one) => `packages/${one.name}/src`),
  ]
  const out: string[] = []
  const walk = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (/\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith('.d.ts'))
        out.push(relative(REPO, path).replaceAll('\\', '/'))
    }
  }
  for (const root of roots) walk(join(REPO, root))
  return out
}

/**
 * The files whose code spells `half`. ⚑ Only a file whose text, whitespace collapsed, holds it at
 * all is parsed — a spelling in a literal or a wrapped template is a spelling in that text.
 * ⚠️ **A half written with a Unicode escape is not looked for**: nothing here writes a person's
 * sentence that way, and parsing every file to find one would cost the whole app's parse per run.
 */
function spelledBy(
  files: readonly string[],
  half: string,
  read: (file: string) => string = (file) => readFileSync(join(REPO, file), 'utf8'),
): string[] {
  return files.filter((file) => {
    const source = read(file)
    return flat(source).includes(half) && spokenIn(file, source).some((said) => said.includes(half))
  })
}

describe('700 · `688` H2 — one sentence, one place', () => {
  const files = sources()

  it('⚑ the census reads the whole app — the renderer, main, shared and a package, by name', () => {
    expect(files.length).toBeGreaterThan(500)
    for (const one of [
      'apps/desktop/src/main/runtime/runtime-host.ts',
      'apps/desktop/src/renderer/src/lib/plan-mode.ts',
      'apps/desktop/src/renderer/src/components/QueuedMessage.vue',
      'packages/runtime/src/claude/claude-runtime.ts',
    ])
      expect(files).toContain(one)
  })

  for (const half of HALVES) {
    it(`🔴 only \`shared/the-go-ahead.ts\` spells “${half}”`, () => {
      expect(spelledBy(files, half)).toEqual([THE_ONE_PLACE])
    })
  }

  it('⚑ THE CONTROL — it finds a spelling in a literal, a template and a script block, and none in prose', () => {
    expect(
      spokenIn('prose.ts', `// the ${HALVES[0]}\n/** ${HALVES[1]} */\nconst quiet = 1\n`).some(
        (said) => HALVES.some((half) => said.includes(half)),
      ),
    ).toBe(false)
    const code = spokenIn(
      'code.ts',
      `const a = 'x ${HALVES[0]}'\nconst b = \`\${a} — ${HALVES[1]}\`\n`,
    )
    for (const half of HALVES) expect(code.some((said) => said.includes(half))).toBe(true)
    const sfc = spokenIn(
      'Card.vue',
      `<script setup lang="ts">\nconst s = '${HALVES[0]}'\n</script>\n` +
        `<template><!-- ${HALVES[0]} --><p>${HALVES[1]}</p></template>\n`,
    )
    for (const half of HALVES) expect(sfc.some((said) => said.includes(half))).toBe(true)
    const commentedOut = spokenIn('Quiet.vue', `<template><!-- ${HALVES[1]} --><p /></template>\n`)
    expect(commentedOut.some((said) => said.includes(HALVES[1]))).toBe(false)
    // ⚑ …and a template sentence prettier wrapped across two lines, which Vue draws as one.
    const wrapped = `<template>\n  <p>\n    Nothing went — type your next message\n    to carry on\n  </p>\n</template>\n`
    expect(wrapped.includes(HALVES[1])).toBe(false)
    // ⚑ Through `spelledBy` itself, so its pre-filter meets the wrap too — not only the reader.
    expect(
      spelledBy(['Wrapped.vue', 'Card.vue'], HALVES[1], (file) =>
        file === 'Wrapped.vue' ? wrapped : '<template><p /></template>',
      ),
    ).toEqual(['Wrapped.vue'])
  })
})
