import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  fallbackOnlyTokens,
  RAW_FAMILIES,
  rawValueCounts,
  rawValueFindings,
  rawValuesIn,
  stripComments,
  tokenDeclarationsIn,
  tokenUsesIn,
  undeclaredTokenUses,
} from '../lib/css-tokens.mjs'

/**
 * Check that CSS tokens used without a fallback are declared. The mutation fixtures reintroduce
 * both a bare missing token and a missing token with a valid fallback: the former must fail, the
 * latter must pass. Assert that each edit applied before trusting the guard's result.
 */

const TREE = join(dirname(fileURLToPath(import.meta.url)), '../../apps/desktop/src/renderer/src')

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) walk(path, out)
    else if (/\.(vue|css|ts)$/.test(name)) out.push(path)
  }
  return out
}

/** The renderer tree, as `Map<path-relative-to-the-tree, source>`. */
function readTree() {
  return new Map(
    walk(TREE).map((path) => [
      relative(TREE, path).replaceAll('\\', '/'),
      readFileSync(path, 'utf8'),
    ]),
  )
}

const tree = readTree()

/** One file's real source, by its path in the tree — mutations are applied to these, never on disk. */
const source = (file) => {
  const text = tree.get(file)
  if (text === undefined) throw new Error(`${file} is not in the scanned tree`)
  return text
}

/** The tree with one file's source replaced — the shape every mutation below takes. */
function withFile(file, text) {
  const next = new Map(tree)
  next.set(file, text)
  return next
}

/**
 * Apply a mutation and refuse to continue if the anchor was not found: a mutation that silently
 * no-ops leaves the test asserting over an unchanged string and passing for free.
 */
function mutate(file, from, to) {
  const text = source(file)
  expect(text.includes(from), `the mutation anchor "${from}" is gone from ${file}`).toBe(true)
  return withFile(file, text.replace(from, to))
}

/** Draws the fill of the sub-agent popup and of the workflow output document. */
const FRAME = 'components/DocumentViewerFrame.vue'
const LIBRARY = 'components/SessionLibrary.vue'

/* -------------------------------------------------------------- the real tree */

describe('the guard over the renderer tree', () => {
  /**
   * A known defect, named rather than tolerated in silence. `--space-13` does not exist (the ladder
   * goes `--space-12: 24px` then `--space-14: 28px`) and `SessionChanges.vue`'s `.empty` writes
   * `padding: var(--space-12) var(--space-9) var(--space-13)`. The whole declaration is invalid at
   * computed-value time, so that block loses all four sides of its padding.
   *
   * It is listed so a new one fails the build while this one stays visible. The line is part of the
   * pin deliberately: keying on `token in file` would still pass if this one were fixed and a
   * different `--space-13` appeared elsewhere in the file. An unrelated edit above the line makes
   * this fail with a message naming the new line.
   */
  // Empty since the app-wide look unified the tokens: `--space-13` is declared now, so the
  // assertion tightened to an empty list.
  const KNOWN = []

  it('every var(--x) is declared in this tree, or carries a fallback', () => {
    const findings = undeclaredTokenUses(tree)
    expect(
      findings.map((f) => `${f.token} at ${f.file}:${f.line}`),
      'undeclared and no fallback',
    ).toEqual(KNOWN)
  })

  /**
   * The scan is really reading the tree. A walker that matched nothing, a comment stripper that ate
   * the file, or a regex that never fired all produce a clean report, indistinguishable from a clean
   * tree unless the volume is asserted too.
   */
  it('…and it is reading a real tree, not an empty one', () => {
    expect(tree.size).toBeGreaterThan(80)

    const declared = new Set()
    let uses = 0
    let withFallback = 0
    for (const text of tree.values()) {
      for (const name of tokenDeclarationsIn(text)) declared.add(name)
      for (const use of tokenUsesIn(text)) {
        uses++
        if (use.fallback) withFallback++
      }
    }
    expect(declared.size, 'no token declarations found at all').toBeGreaterThan(200)
    expect(uses, 'no var() uses found at all').toBeGreaterThan(1500)
    // Both branches of the rule are exercised by the real tree, so neither is dead code.
    expect(withFallback, 'no fallback uses — the legal branch is untested').toBeGreaterThan(0)
    expect(uses - withFallback).toBeGreaterThan(1000)
    // The tokens that live in a `:style` binding rather than a stylesheet.
    for (const name of ['--sz', '--_c', '--_u', '--badge', '--badge-tint']) {
      expect(declared.has(name), `${name} is declared in a :style binding and was missed`).toBe(
        true,
      )
    }
  })

  /**
   * The other list, reported and not enforced. These four are undeclared everywhere and every use
   * carries a fallback, which the rule permits. A sweep is the PM's call, so they are pinned here to
   * stay visible rather than fixed.
   */
  // Empty since the app-wide look: SignInPanel's four fallback names became semantic tokens.
  it('no token is fallback-only, and nothing has quietly joined the empty list', () => {
    expect(fallbackOnlyTokens(tree).map((t) => t.token)).toEqual([])
  })
})

/* ------------------------------------------------------------ the two escapes */

describe('⛔ it catches both tokens this class has already cost', () => {
  it('125: --surface-1 put back on the sub-agent popup and the workflow output document', () => {
    const mutated = mutate(FRAME, 'background: var(--drawer-solid)', 'background: var(--surface-1)')
    const findings = undeclaredTokenUses(mutated).filter((f) => f.token === '--surface-1')
    expect(findings.map((f) => f.file)).toEqual([FRAME])
  })

  it('125: …every use is reported, not just the first, in every file', () => {
    const one = mutate(
      FRAME,
      'background: var(--drawer-solid)',
      'background: var(--surface-1);\n  outline-color: var(--surface-1)',
    )
    const both = new Map(one)
    both.set(LIBRARY, source(LIBRARY).replace('color: var(--text-soft)', 'color: var(--surface-1)'))
    expect(both.get(LIBRARY)).toContain('var(--surface-1)')
    const findings = undeclaredTokenUses(both).filter((f) => f.token === '--surface-1')
    expect(findings.map((f) => f.file)).toEqual([FRAME, FRAME, LIBRARY])
    expect(findings[1].line).toBe(findings[0].line + 1)
  })

  it('105: --warning, bare, is caught', () => {
    const mutated = mutate(LIBRARY, 'color: var(--text-soft)', 'color: var(--warning)')
    expect(
      undeclaredTokenUses(mutated)
        .filter((f) => f.token === '--warning')
        .map((f) => f.file),
    ).toEqual([LIBRARY])
  })

  /**
   * The correction, asserted rather than described. This is the shipped defect verbatim, the string
   * that was once in `SessionLibrary.vue`, and the guard passes it because a
   * fallback form is legal. A reader who assumed this file catches "the `--warning` bug" would be
   * wrong about which half.
   */
  it('105 as it ACTUALLY shipped — var(--warning, var(--text-soft)) — passes, by design', () => {
    const mutated = mutate(
      LIBRARY,
      'color: var(--text-soft)',
      'color: var(--warning, var(--text-soft))',
    )
    expect(undeclaredTokenUses(mutated).filter((f) => f.token === '--warning')).toEqual([])
    // It is not invisible, though: the other list names it, which is what makes the boundary a
    // decision rather than a blind spot.
    expect(fallbackOnlyTokens(mutated).map((t) => t.token)).toContain('--warning')
  })
})

/* ------------------------------------------------------------------ the parser */

describe('what the scanner does and does not see', () => {
  it('a declaration is a declaration wherever it is written', () => {
    const declared = tokenDeclarationsIn(`
      :root { --a: 1px; }
      [data-chat-theme='light'] { --b: 2px }
      @media (max-width: 100px) { :root { --c: 3px; } }
      .x { color: red; --d: 4px; }
    `)
    expect([...declared].sort()).toEqual(['--a', '--b', '--c', '--d'])
  })

  it('⛔ a name in the FALLBACK position is a use, never a declaration', () => {
    // The trap: `var(--a, --b)` declares neither. If `--b` counted, a tree could declare every
    // token it was missing simply by naming it as a fallback somewhere.
    expect([...tokenDeclarationsIn('.x { color: var(--a, --b); }')]).toEqual([])
    expect(
      tokenUsesIn('.x { color: var(--a, var(--b)); }').map((u) => [u.name, u.fallback]),
    ).toEqual([
      ['--a', true],
      ['--b', false],
    ])
  })

  it('a Vue :style binding declares a token too', () => {
    expect([...tokenDeclarationsIn(`<div :style="{ '--sz': \`\${px}px\` }" />`, 'A.vue')]).toEqual([
      '--sz',
    ])
  })

  /**
   * `//` is a line comment in JS and not a CSS comment, so an earlier version of this scanner read
   * `<script setup>` as CSS, and one `// --space-13: was 26px` anywhere in the tree made the guard's
   * single real finding vanish. The fix is a boundary rather than a second comment stripper: only
   * `<style>` blocks are CSS.
   */
  it('⛔ a token named in a // comment or in template PROSE declares nothing', () => {
    const vue = [
      '<script setup lang="ts">',
      '// --space-13: was 26px before we removed it',
      'const x = 1',
      '</script>',
      '<template><p>Set --foo: 12px yourself</p></template>',
      '<style scoped>',
      '.x { padding: var(--space-13); }',
      '</style>',
    ].join('\n')
    expect([...tokenDeclarationsIn(vue, 'A.vue')]).toEqual([])
    // …and the paired positive: the use inside the real <style> block IS seen, at its real line.
    expect(undeclaredTokenUses(new Map([['A.vue', vue]]))).toEqual([
      { token: '--space-13', file: 'A.vue', line: 7 },
    ])
  })

  it('⛔ …and an HTML comment in a template is not a use either', () => {
    const vue = '<template><!-- var(--nope) --></template>\n<style>.x { color: red }</style>'
    expect(tokenUsesIn(vue, 'A.vue')).toEqual([])
  })

  /**
   * `prettier --write .` runs in CI at `printWidth: 100` and breaks inside `var(` when the call is
   * long enough. A line-based scanner read `var(\n  --x\n)` as zero uses, a silent blind spot after
   * a reformat nobody would connect to this guard. The scan runs over the whole region.
   */
  it('⚠️ a var( that prettier split across lines is still a use, at the line it starts on', () => {
    const css = ['.x {', '  color: var(', '    --a-very-long-name,', '    #fff', '  );', '}'].join(
      '\n',
    )
    expect(tokenUsesIn(css)).toEqual([{ name: '--a-very-long-name', line: 2, fallback: true }])
    // And the bare form, which is the one that would have gone unreported rather than mis-flagged.
    expect(tokenUsesIn('.x {\n  color: var(\n    --b\n  );\n}')).toEqual([
      { name: '--b', line: 2, fallback: false },
    ])
  })

  it('⛔ a token named only inside a COMMENT is not declared', () => {
    // This is the one that would have hidden the finding from its own guard: two components carry long
    // comments about `--surface-1`, and one of them quotes the declaration it replaced.
    expect([
      ...tokenDeclarationsIn('/* --surface-1: #101010; */ .x { color: var(--surface-1); }'),
    ]).toEqual([])
    expect(
      undeclaredTokenUses(new Map([['x.css', '/* --a: 1px; */ .x { color: var(--a); }']])),
    ).toEqual([{ token: '--a', file: 'x.css', line: 1 }])
  })

  it('…and stripping a comment does not move the lines after it', () => {
    const text = ['/* one', 'two', 'three */', '.x { color: var(--gone); }'].join('\n')
    expect(stripComments(text).split('\n')).toHaveLength(4)
    expect(tokenUsesIn(text)).toEqual([{ name: '--gone', line: 4, fallback: false }])
  })

  it('every fallback shape counts as one, including the empty one', () => {
    const uses = tokenUsesIn('a{a:var(--a,1px)}b{b:var( --b , 1px )}c{c:var(--c,)}d{d:var(--d)}')
    expect(uses.map((u) => [u.name, u.fallback])).toEqual([
      ['--a', true],
      ['--b', true],
      ['--c', true],
      ['--d', false],
    ])
  })

  /**
   * The guard's real limit. `AgentState` writes `` `var(${dotToken})` `` and the name arrives from
   * `agent-state.ts` at runtime. No static scan can resolve that, so those uses are invisible here,
   * neither caught nor falsely reported. `agent-state.test.ts` pins that table's tokens, which is
   * the other half of the answer.
   */
  it('⚠️ a computed var(${…}) is invisible to it — neither caught nor falsely reported', () => {
    expect(tokenUsesIn('.x { color: var(${dotToken}); }')).toEqual([])
    expect(undeclaredTokenUses(new Map([['x.vue', '.x { color: var(${t}); }']]))).toEqual([])
  })
})

/* ------------------------------------------------------------------ raw values */

/**
 * **Components read tokens, not values**, so a theme reaches everything. Every family is empty: a
 * literal style value anywhere outside the token file fails here, unless its own line says why.
 */
describe('raw style values outside the token file', () => {
  const counts = () => rawValueCounts(rawValueFindings(tree))

  it.each(RAW_FAMILIES)('no stylesheet writes a %s value of its own', (family) => {
    expect(
      rawValueFindings(tree)
        .filter((f) => f.family === family)
        .map((f) => `${f.file}:${f.line} ${f.declaration}`),
    ).toEqual([])
  })

  /**
   * The literals kept on purpose, counted, so a new exception is a decision someone sees rather
   * than a comment that slipped in: seven glyph strokes, two separating rings, and the name of the
   * bundled face.
   */
  it('the literals marked raw are the ten known ones', () => {
    const marks = [...tree].flatMap(([file, text]) =>
      [...text.matchAll(/\/\*\s*raw:\s*([^*]*?)\s*\*\//g)].map((m) => `${file}: ${m[1]}`),
    )
    expect(marks).toHaveLength(10)
  })

  it('⛔ a literal border width put back into a real component is caught', () => {
    const mutated = mutate(
      LIBRARY,
      'border: var(--border-width) solid var(--line);',
      'border: 1px solid var(--line);',
    )
    expect(
      rawValueFindings(mutated)
        .filter((f) => f.family === 'border')
        .map((f) => f.file),
    ).toEqual([LIBRARY])
  })

  it('…and the same literal marked raw, with its reason, passes', () => {
    const mutated = mutate(
      LIBRARY,
      'border: var(--border-width) solid var(--line);',
      'border: 1px solid var(--line); /* raw: a test of the mark */',
    )
    expect(rawValueFindings(mutated).filter((f) => f.family === 'border')).toEqual([])
  })

  it('⛔ each other family catches its own literal in a real component', () => {
    const cases = [
      ['radius', 'border-radius: var(--radius-md);', 'border-radius: 8px;'],
      ['colour', 'color: var(--text-soft);', 'color: #46536d;'],
      ['type', 'font-weight: var(--fw-semibold);', 'font-weight: 600;'],
    ]
    for (const [family, from, to] of cases) {
      const before = counts()[family][LIBRARY] ?? 0
      expect(rawValueCounts(rawValueFindings(mutate(LIBRARY, from, to)))[family][LIBRARY]).toBe(
        before + 1,
      )
    }
  })

  it('the token file is where values live, so it is not scanned', () => {
    const tokens = new Map([['assets/tokens.css', ':root { --line: #e8eaf2; --r: 8px; }']])
    expect(rawValueFindings(tokens)).toEqual([])
    expect(rawValueFindings(new Map([['assets/x.css', '.x { color: #e8eaf2; }']]))).toHaveLength(1)
  })

  it('what each family refuses, and what it lets through', () => {
    const families = (css) => rawValuesIn(css).map((f) => f.family)
    expect(families('.x { border: 1px solid var(--line); }')).toEqual(['border'])
    expect(families('.x { border-top-width: 2px; }')).toEqual(['border'])
    expect(families('.x { border: var(--border-width) solid var(--line); border: 0; }')).toEqual([])
    expect(families('.x { border-radius: 6px; }')).toEqual(['radius'])
    expect(families('.x { border-radius: 50%; border-top-left-radius: 0; }')).toEqual([])
    expect(families('.x { border-radius: var(--radius) var(--radius) 0 0; }')).toEqual([])
    expect(families('.x { background: rgba(0, 0, 0, 0.1); color: #fff; }')).toEqual([
      'colour',
      'colour',
    ])
    expect(families('.x { color: color-mix(in srgb, var(--a) 5%, var(--b)); }')).toEqual(['colour'])
    expect(families('.x { color: transparent; fill: currentColor; }')).toEqual([])
    expect(families('.x { box-shadow: 0 2px 8px var(--ink); }')).toEqual(['shadow'])
    expect(families('.x { box-shadow: inset var(--border-width) 0 0 var(--line); }')).toEqual([])
    expect(families('.x { font-size: 12px; font-weight: 600; font-family: Inter; }')).toEqual([
      'type',
      'type',
      'type',
    ])
    expect(families('.x { font-size: var(--type-small); font-family: var(--font-mono); }')).toEqual(
      [],
    )
  })

  it('⛔ a literal only inside a comment is not a finding, and a mark on another line exempts nothing', () => {
    expect(rawValuesIn('/* border: 1px solid red; */ .x { color: var(--a); }')).toEqual([])
    expect(
      rawValuesIn(
        '.x {\n  /* raw: above, not on the line */\n  border: 1px solid var(--a);\n}',
      ).map((f) => [f.family, f.line]),
    ).toEqual([['border', 3]])
  })

  it('a Vue file is read only inside its <style> blocks', () => {
    const vue = [
      '<template><div style="border: 1px solid red" /></template>',
      '<script setup lang="ts">const c = "#fff"</script>',
      '<style scoped>',
      '.x { border: 1px solid var(--line); }',
      '</style>',
    ].join('\n')
    expect(rawValuesIn(vue, 'A.vue').map((f) => [f.family, f.line])).toEqual([['border', 4]])
  })
})
