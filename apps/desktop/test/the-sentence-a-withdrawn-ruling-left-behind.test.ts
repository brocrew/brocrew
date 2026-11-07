import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { proseSpans, proseText, type ProseSpan } from './lib/prose-spans'


const here = dirname(fileURLToPath(import.meta.url))
const REPO = join(here, '../../..')

const read = (path: string): string => readFileSync(join(REPO, path), 'utf8')

function everySource(): string[] {
  const git = (...args: string[]): string[] =>
    execFileSync('git', ['-C', REPO, 'ls-files', ...args, '*.ts', '*.vue', '*.mts'], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    })
      .split('\n')
      .filter((path) => path !== '')
  const deleted = new Set(git('--deleted'))
  return git().filter((path) => !path.includes('node_modules') && !deleted.has(path))
}

const ABOUT_THE_INSTRUCTION_LAYER =
  /\b(factory text|factory layer|systemHint|system hint|developerInstructions|baseInstructions|HINT_PREAMBLE|WORKSPACE_INSTRUCTIONS|profile bundle|composeProfileBundle|composeSystemHint|instruction layer|instruction text|instruction file|system prompt|base prompt|the preset|preset\+append|COMMON_RULES|claude_code)\b/i

const THE_WITHDRAWN_FRAMING: Readonly<Record<string, RegExp>> = {
  'it is a safety property': /\bsafety propert\w+/i,
  'a safety behaviour rests on the text':
    /\b(approval|permission|sandbox|containment|safety|rail)\w*\b[^.]{0,90}\b(depends? on|relies? on|rests? on|is guaranteed by)\b[^.]{0,60}\b(instruction|prompt|text|sentence|wording)\w*\b/i,
  'the text is what the rail rests on':
    /\b(instruction|prompt|text|sentence|wording)\w*\b[^.]{0,90}\b(approval|permission|sandbox|containment|safety|rail)\w*\b[^.]{0,60}\b(depends? on|relies? on|rests? on)\b/i,
  'the text is what enforces it':
    /\b(instruction|prompt|text|sentence|wording)\w*\b[^.]{0,90}\b(enforces?|guarantees?|prevents?|stops?)\b[^.]{0,60}\b(approval|permission|sandbox|containment|breach|escape)\w*\b/i,
  'changing the text removes the protection':
    /\b(replac\w+|strip\w*|drop\w*|remov\w+|los\w+)\b[^.]{0,80}\b(prompt|instruction|text)\w*\b[^.]{0,90}\b(approval|permission|sandbox|containment)\w*\b/i,
  'not a convenience': /\bnot (just |merely |only )?a convenience\b/i,
  'it cannot be circumvented':
    /\b(cannot|can ?not|can'?t|could not) be (circumvented|bypassed|overridden|replaced|removed|turned off|dropped)\b/i,
}

const CITES_THE_RULING_THAT_WITHDREW_IT = /\bHO-062\b/

function statingTheWithdrawnFraming(): string[] {
  const found: string[] = []
  for (const path of everySource()) {
    for (const span of proseSpans(path, read(path))) {
      const words = proseText(span)
      if (!ABOUT_THE_INSTRUCTION_LAYER.test(words)) continue
      const fired = Object.keys(THE_WITHDRAWN_FRAMING).filter((claim) =>
        (THE_WITHDRAWN_FRAMING[claim] as RegExp).test(words),
      )
      if (fired.length === 0) continue
      if (CITES_THE_RULING_THAT_WITHDREW_IT.test(words)) continue
      found.push(`${path}:${span.line} — ${fired.join(' | ')}`)
    }
  }
  return found
}


describe('§0 · the prose reader, and a census is only as good as it', () => {
  const spansOf = (source: string, name = 'x.ts'): ProseSpan[] => proseSpans(name, source)

  it('🔴 it sees a docblock and a line comment, and NOT a comment-opener inside a string', () => {
    const planted = [
      "const decoy = '/* this is a string, not a comment */'",
      '/** a docblock */',
      'const also = "// nor is this"',
      '// a real line comment',
    ].join('\n')
    expect(spansOf(planted).map((one) => one.text)).toEqual([
      '/** a docblock */',
      '// a real line comment',
    ])
  })

  it('⛔ a phrase WRAPPED across a docblock’s lines is still found — the first way this was blind', () => {
    const wrapped = [
      '/**',
      ' * … and that is a safety',
      ' * property rather than an omission.',
      ' */',
    ].join('\n')
    const [span] = spansOf(wrapped)
    expect(span, 'the reader found no span at all').toBeDefined()
    expect(/\bsafety propert\w+/i.test((span as ProseSpan).text), 'the RAW span matched').toBe(
      false,
    )
    expect(/\bsafety propert\w+/i.test(proseText(span as ProseSpan))).toBe(true)
  })

  it('⛔ a RUN of `//` lines is ONE span — the second way, and it hid every inline comment', () => {
    const run = [
      '// never a bare string, which would REPLACE the preset and strip the',
      '// tool/permission instructions the 001 approval profile depends on.',
      'const x = 1',
      '// a separate remark',
    ].join('\n')
    const spans = spansOf(run)
    expect(spans, 'the run did not fold, or folded too much').toHaveLength(2)
    expect(THE_WITHDRAWN_FRAMING['the text is what the rail rests on'] as RegExp).toBeDefined()
    expect(
      (THE_WITHDRAWN_FRAMING['the text is what the rail rests on'] as RegExp).test(
        proseText(spans[0] as ProseSpan),
      ),
    ).toBe(true)
  })

  it('⚠️ …and a blank line ENDS a run, so a span never swallows an unrelated remark', () => {
    const apart = ['// first', '', '// second'].join('\n')
    expect(spansOf(apart).map((one) => proseText(one))).toEqual(['first', 'second'])
  })

  it('⛔ two BLOCK comments never merge, however adjacent — a span is one author’s thought', () => {
    const two = ['/** first */', '/** second */', 'const x = 1'].join('\n')
    expect(spansOf(two).map((one) => proseText(one))).toEqual(['first', 'second'])
  })

  it('⚠️ a comment after the LAST statement is found — it leads the EOF token and nothing else', () => {
    expect(spansOf('const x = 1\n// the last word\n').map((one) => proseText(one))).toEqual([
      'the last word',
    ])
  })

  it('⚑ it reads a `.vue` file’s script AND its template comments, with the FILE’s line numbers', () => {
    const sfc = [
      '<template>',
      '  <!-- a template remark -->',
      '  <p>hello</p>',
      '</template>',
      '<script setup lang="ts">',
      '// a script remark',
      'const n = 1',
      '</script>',
    ].join('\n')
    const spans = proseSpans('x.vue', sfc)
    expect(spans.map((one) => one.kind).sort()).toEqual(['html', 'line'])
    const script = spans.find((one) => one.kind === 'line') as ProseSpan
    expect(script.line).toBe(6)
  })

  it('⛔ it THROWS on a template it cannot see, rather than answering with nothing', () => {
    expect(() => proseSpans('x.vue', '<template src="./elsewhere.html"></template>')).toThrow(
      /a <template> this reader cannot see/,
    )
  })

  it('🔴 and it really reads this repository — a positive control, per FILE', () => {
    for (const path of [
      'apps/desktop/src/main/runtime/factory-text.ts',
      'apps/desktop/src/shared/told.ts',
      'packages/runtime/src/codex/codex-runtime.ts',
      'apps/desktop/src/renderer/src/components/SessionInstructions.vue',
    ]) {
      const source = read(path)
      expect(source.trim().length, path).toBeGreaterThan(0)
      const block = '/* per-file parser span control */'
      const html = 'per-file template span control'
      expect(source).not.toContain(block)
      expect(source).not.toContain(html)
      let planted: string
      let blockLine: number
      if (path.endsWith('.vue')) {
        const opening = /<script\b[^>]*>/.exec(source)
        expect(opening, path).not.toBeNull()
        if (!opening) throw new Error(`${path}: no script insertion point`)
        const offset = opening.index + opening[0].length
        blockLine = source.slice(0, offset).split('\n').length + 1
        planted = source.slice(0, offset) + `\n${block}\n` + source.slice(offset)
        const template = '<template>'
        expect(planted.split(template), path).toHaveLength(2)
        planted = planted.replace(template, `${template}\n<!--${html}-->\n`)
        const htmlLine = planted.slice(0, planted.indexOf(`<!--${html}-->`)).split('\n').length
        expect(proseSpans(path, planted), path).toContainEqual({
          file: path,
          line: htmlLine,
          text: html,
          kind: 'html',
        })
        expect(planted.replace(`\n${block}\n`, '').replace(`\n<!--${html}-->\n`, '')).toBe(source)
      } else {
        blockLine = 1
        planted = `${block}\n${source}`
        expect(planted.slice(block.length + 1)).toBe(source)
      }
      const spans = proseSpans(path, planted)
      expect(spans, path).toContainEqual({ file: path, line: blockLine, text: block, kind: 'block' })
      expect(spans.filter((span) => span.text === block), path).toHaveLength(1)
      expect(spans.filter((span) => span.text !== block && span.text !== html).map(({ text, kind }) => ({ text, kind }))).toEqual(
        proseSpans(path, source).map(({ text, kind }) => ({ text, kind })),
      )
    }
  })

  it('⚑ …and it reads EVERY committed source file without going quiet on any of them', () => {
    const files = everySource()
    expect(files.length, 'the roster collapsed').toBeGreaterThan(1000)
    let withProse = 0
    for (const path of files) {
      if (proseSpans(path, read(path)).length > 0) withProse += 1
    }
    expect(withProse / files.length).toBeGreaterThan(0.8)
  })
})


describe('§1 · the withdrawn framing, and a census nobody has made fail is a census nobody has measured', () => {
  it('🔴 every member FIRES on the way that claim actually gets written', () => {
    const fires: Record<string, string> = {
      'it is a safety property':
        'putting repo bytes in Codex\u2019s global override, or echoing them through `developerInstructions`, ' +
        'gives Codex the copy AND its own native read. The Codex branch of this reader still injects ' +
        'nothing, and that is a safety property rather than an omission.',
      'a safety behaviour rests on the text':
        'The approval profile depends on the tool instructions in the preset.',
      'the text is what the rail rests on':
        'A bare string would REPLACE the preset and strip the tool/permission instructions the 001 approval profile depends on.',
      'the text is what enforces it':
        'The HINT_PREAMBLE is what makes this work: that sentence guarantees the permission card, so it ' +
        'must never be edited.',
      'changing the text removes the protection':
        'baseInstructions REPLACES the base prompt — using it would silently drop the built-in tool/approval behaviour.',
      'not a convenience':
        'The factory layer propagates verbatim because the app renders it — that is a safety property, not a convenience.',
      'it cannot be circumvented':
        'The factory text is rendered by the app, so it cannot be overridden by anything the provider does.',
    }
    expect(Object.keys(fires)).toEqual(Object.keys(THE_WITHDRAWN_FRAMING))
    for (const [claim, sentence] of Object.entries(fires)) {
      const pattern = THE_WITHDRAWN_FRAMING[claim] as RegExp
      expect(pattern, `${claim} has no pattern`).toBeDefined()
      expect(sentence, `${claim} cannot be seen by its own pattern`).toMatch(pattern)
      expect(sentence, `${claim} is not ABOUT this layer`).toMatch(ABOUT_THE_INSTRUCTION_LAYER)
    }
  })

  it('⛔ …and it catches NONE of the true sentences beside them — the over-correction control', () => {
    const kept = [
      'The neutral StartOptions.systemHint is appended to the claude_code preset and never replaces it.',
      'The factory layer carries BEHAVIOUR. Safety lives in the rails.',
      'A bare string would REPLACE the preset and strip the tool GUIDANCE the model reads.',
      'developerInstructions is the additive developer-message layer; baseInstructions is deliberately NOT used.',
      'The exact text appended to the model’s system prompt, composed.',
      'This app adds to the provider’s prompt and never replaces it.',
    ]
    for (const sentence of kept) {
      for (const [claim, pattern] of Object.entries(THE_WITHDRAWN_FRAMING)) {
        expect(sentence, `${claim} fires on a true sentence`).not.toMatch(pattern)
      }
    }
  })

  it('⚠️ the ESCAPE is a citation and not an adjective — a span must name the ruling', () => {
    const withTheClaim =
      'that is a safety property rather than an omission — and the wording was withdrawn.'
    expect(withTheClaim).toMatch(THE_WITHDRAWN_FRAMING['it is a safety property'] as RegExp)
    expect(withTheClaim, 'saying "withdrawn" was enough').not.toMatch(
      CITES_THE_RULING_THAT_WITHDREW_IT,
    )
    expect(`${withTheClaim} HO-062 §2 replaced it.`).toMatch(CITES_THE_RULING_THAT_WITHDREW_IT)
  })
})


describe('§2 · nothing in this tree rests a rail on the instruction text without citing HO-062', () => {
  it('🔴 no committed span states the withdrawn framing about this layer, uncited', () => {
    expect(statingTheWithdrawnFraming()).toEqual([])
  })
})


describe('the live instruction hand-off and reader mapping', () => {
  it('Claude appends to its preset and Codex uses developerInstructions without replacing the base', () => {
    const claude = read('packages/runtime/src/claude/claude-runtime.ts')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    const assignments = [...claude.matchAll(/options\.systemPrompt = /g)]
    expect(assignments).toHaveLength(1)
    const assigned = claude.slice(assignments[0]!.index, assignments[0]!.index + 200)
    expect(assigned).toContain("type: 'preset'")
    expect(assigned).toContain("preset: 'claude_code'")
    expect(assigned).toContain('append: systemHint')
    const codex = read('packages/runtime/src/codex/codex-runtime.ts')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    expect(codex).toContain('developerInstructions: systemHint')
    expect(codex).not.toContain('baseInstructions')
  })

  it('the instruction reader delegates to its provider and no live workspaceSystemHint function remains', () => {
    const reader = read('apps/desktop/src/main/runtime/instructions.ts')
    expect(reader).toContain('return providerKnowledge[inputs.provider].instructions.read(inputs)')
    const declared = `function ${'workspaceSystem'}Hint`
    const alive = everySource().filter((path) => read(path).includes(declared))
    expect(alive, 'workspaceSystemHint is a live function again').toEqual([])
  })

  it('the composed layer still checks for an actual composed value', () => {
    expect(read('apps/desktop/src/renderer/src/lib/told.ts')).toContain('if (composed !== null) {')
  })

  it('⚠️ and the three mechanisms the table names are REAL, not prose — the row’s own control', () => {
    expect(read('apps/desktop/src/main/runtime/runtime-host.ts')).toContain(
      'private tellIfNobodyHasYet(piece: PieceRow): void {',
    )
    expect(read('apps/desktop/src/shared/tasks.ts')).toContain('turn_ended:')
    expect(read('apps/desktop/src/main/runtime/agent-tools.ts')).toContain("'no agents you can see")
  })
})
