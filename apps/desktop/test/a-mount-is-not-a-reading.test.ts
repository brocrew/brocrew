import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url))
const REPO = here('../../../')

const ROOTS = [
  'apps/desktop/test',
  'apps/desktop/gate-only',
  'packages/runtime/test',
  'packages/shared/test',
  'scripts/test',
  'scripts/gate-only',
]

const IS_TEST = /\.test\.(ts|mts|mjs)$/

const DECLARATION = /Every negative[\s\S]{0,60}?\bpaired\b/i

const DECLARES_AND_DRAWS = [
  'apps/desktop/test/dom/one-tab-at-a-time.dom.test.ts',
  'apps/desktop/test/a-look-he-can-take-back.render.test.ts',
  'apps/desktop/test/a-person-is-told-an-agent-can-still-drive-it.render.test.ts',
  'apps/desktop/test/a-report-that-names-a-conversation.render.test.ts',
  'apps/desktop/test/agent-state.render.test.ts',
  'apps/desktop/test/background-bar.render.test.ts',
  'apps/desktop/test/conversation-chrome.render.test.ts',
  'apps/desktop/test/dom/a-disclosure-whose-triangle-is-suppressed-draws-its-own-mark.dom.test.ts',
  'apps/desktop/test/dom/the-graph-draws-each-agent-as-the-rail-does-and-opens-only-what-opens.dom.test.ts',
  'apps/desktop/test/dom/the-card-lists-the-files-its-agent-added.dom.test.ts',
  'apps/desktop/test/dom/the-files-tab-lists-every-file-on-the-work.dom.test.ts',
  'apps/desktop/test/dom/files-library.dom.test.ts',
  'apps/desktop/test/dom/legacy-kept-file-lists.dom.test.ts',
  'apps/desktop/test/dom/the-cards-name-the-files-they-hand-over.dom.test.ts',
  'apps/desktop/test/dom/a-piece-on-the-graph-counts-its-files.dom.test.ts',
  'apps/desktop/test/dom/the-viewer-says-what-a-file-is.dom.test.ts',
  'apps/desktop/test/dom/the-card-says-the-work-a-person-gave-and-what-it-holds.dom.test.ts',
  'apps/desktop/test/dom/a-cut-brief-opens-to-its-whole-and-a-card-lists-only-its-own-files.dom.test.ts',
  'apps/desktop/test/dom/a-question-is-answered-where-it-is-asked-and-the-words-around-it-are-plain.dom.test.ts',
  'apps/desktop/test/dom/the-card-for-a-request-taken-on.dom.test.ts',
  'apps/desktop/test/dom/a-graph-card-can-be-pressed.dom.test.ts',
  'apps/desktop/test/dom/brobot-and-the-other-agents-fold-apart.dom.test.ts',
  'apps/desktop/test/dom/the-agent-card-frames-what-it-knows-and-nothing-more.dom.test.ts',
  'apps/desktop/test/dom/a-folder-a-person-chose-is-the-folder-the-conversation-runs-in.dom.test.ts',
  'apps/desktop/test/dom/a-gesture-that-creates-an-agent.dom.test.ts',
  'apps/desktop/test/dom/a-live-conversation-is-never-drawn-as-ended.dom.test.ts',
  'apps/desktop/test/dom/a-mode-that-says-what-it-does.dom.test.ts',
  'apps/desktop/test/dom/agent-commands.dom.test.ts',
  'apps/desktop/test/dom/closed-threads.dom.test.ts',
  'apps/desktop/test/dom/library-restore.dom.test.ts',
  'apps/desktop/test/dom/the-citation-we-throw-away.dom.test.ts',
  'apps/desktop/test/dom/the-half-nobody-lists.dom.test.ts',
  'apps/desktop/test/dom/the-memory-a-fresh-identity-does-not-have.dom.test.ts',
  'apps/desktop/test/dom/the-memory-that-is-in-the-prompt.dom.test.ts',
  'apps/desktop/test/dom/the-memory-write-we-render-as-a-file.dom.test.ts',
  'apps/desktop/test/dom/the-panel-that-stopped-explaining-itself.dom.test.ts',
  'apps/desktop/test/dom/the-text-a-child-is-actually-told.dom.test.ts',
  'apps/desktop/test/dom/the-tools-register.dom.test.ts',
  'apps/desktop/test/idle-truth.render.test.ts',
  'apps/desktop/test/live-settings.render.test.ts',
  'apps/desktop/test/mcp-row-duration.render.test.ts',
  'apps/desktop/test/queued-message.render.test.ts',
  'apps/desktop/test/schedule-bar.render.test.ts',
  'apps/desktop/test/the-answer-a-person-can-read.render.test.ts',
  'apps/desktop/test/the-card-stops-at-what-it-holds.render.test.ts',
  'apps/desktop/test/the-id-this-app-hands-a-person.render.test.ts',
  'apps/desktop/test/two-rows-that-say-the-wrong-thing.render.test.ts',
  'apps/desktop/test/watch-one-command.render.test.ts',
  'apps/desktop/test/what-a-request-is-about-and-whose-it-is.render.test.ts',
  'apps/desktop/test/dom/a-new-brief-is-a-card-once-its-row-landed.dom.test.ts',
]

const DECLARES_AND_DRAWS_NOTHING = [
  'apps/desktop/test/a-request-taken-on-is-a-card.test.ts',
  'apps/desktop/test/a-look-takes-what-a-press-may-take-and-nothing-else.test.ts',
  'apps/desktop/test/a-mount-is-not-a-reading.test.ts',
  'apps/desktop/test/a-no-pressed-on-a-request-is-written-down-as-a-no.test.ts',
  'apps/desktop/test/a-refusal-with-no-words-is-said-in-words.test.ts',
  'apps/desktop/test/a-refusal-you-can-see.test.ts',
  'apps/desktop/test/agent-commands.test.ts',
  'apps/desktop/test/consent-never-containment.test.ts',
  'apps/desktop/test/home-is-two-destinations.test.ts',
  'apps/desktop/test/schedule-words.test.ts',
  'apps/desktop/test/the-promise-a-rail-could-not-keep.test.ts',
  'apps/desktop/test/workflow-tree.test.ts',
  'packages/runtime/test/claude-memory-store.test.ts',
  'apps/desktop/test/the-window-is-told-what-an-agent-is-doing-the-moment-it-moves.test.ts',
  'apps/desktop/test/a-label-names-the-conversation-that-owns-the-piece-and-no-more.test.ts',
  'apps/desktop/test/a-launch-lists-what-its-profiles-other-conversations-are-doing.test.ts',
  'apps/desktop/test/the-survivors-the-tree-landing-left.test.ts',
  'scripts/test/a-stray-beside-the-home-folder-is-named-and-a-folder-brobot-could-not-make-refuses.test.mjs',
  'scripts/test/paper-ground.test.mjs',
  'apps/desktop/test/a-give-card-draws-the-whole-brief-it-gave.test.ts',
  'apps/desktop/test/a-new-brief-given-is-a-card.test.ts',
  'apps/desktop/test/a-front-matter-title-is-read-as-yaml-keys.test.ts',
]

function commentsOf(filename: string, source: string): string {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const seen = new Set<number>()
  const found: string[] = []
  const take = (ranges: readonly ts.CommentRange[] | undefined): void => {
    for (const range of ranges ?? []) {
      if (seen.has(range.pos)) continue
      seen.add(range.pos)
      found.push(source.slice(range.pos, range.end))
    }
  }
  const visit = (node: ts.Node): void => {
    take(ts.getLeadingCommentRanges(source, node.getFullStart()))
    take(ts.getTrailingCommentRanges(source, node.getEnd()))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  take(ts.getLeadingCommentRanges(source, sf.endOfFileToken.getFullStart()))
  return found.join('\n')
}

function specifiers(filename: string, source: string): string[] {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      found.push(node.moduleSpecifier.text)
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(file, visit)
  return found
}

const drawsSomething = (file: string, source: string): boolean =>
  file.includes('/test/dom/') || specifiers(file, source).some((one) => one.endsWith('.vue'))

interface Assertion {
  readonly subject: string
  readonly negated: boolean
  readonly matcher: string
  readonly args: readonly string[]
}

export interface Block {
  readonly title: string
  readonly line: number
  readonly assertions: readonly Assertion[]
}

const INK = new Set([
  'assertDrawn',
  'assertClipped',
  'assertClippedButTold',
  'titleRecovers',
  'drawnInFull',
  'inkRects',
  'cutsOf',
  'notDrawn',
  'clipsOf',
  'lineCount',
])

const WORDS =
  /textContent|innerText|innerHTML|outerHTML|getAttribute|ariaLabel|\.value\b|\.title\b|\.alt\b|placeholder|\.text\(|\bhtml\b/

const SURFACE =
  /querySelector|querySelectorAll|\.all\(|\.q\(|\bhost\b|textContent|innerText|innerHTML|outerHTML|document\.|getComputedStyle|getBoundingClientRect|data-cy|getAttribute|checkVisibility|\bhtml\b|\bmarkup\b/

const MARKUP = /data-[a-z-]+\s*[=\]]|<\/?[a-z]/

const HOOK_ONLY = /^\s*['"`]\s*\[?data-[a-z-]+\s*[=\]]/

export function blocksOf(filename: string, source: string): Block[] {
  const sf = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const T = (node: ts.Node | undefined): string =>
    node ? source.slice(node.getStart(sf), node.getEnd()) : ''

  const helpers = new Map<string, ts.Node>()
  const walkHelpers = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name) helpers.set(node.name.text, node)
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      helpers.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, walkHelpers)
  }
  ts.forEachChild(sf, walkHelpers)
  const helperText = new Map([...helpers].map(([name, node]) => [name, T(node)] as const))

  const binds = new Map<string, string>()
  const walkBinds = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      !ts.isArrowFunction(node.initializer) &&
      !ts.isFunctionExpression(node.initializer)
    ) {
      binds.set(node.name.text, T(node.initializer))
    }
    ts.forEachChild(node, walkBinds)
  }
  ts.forEachChild(sf, walkBinds)

  const assertionsIn = (node: ts.Node, seen: ReadonlySet<string>, depth: number): Assertion[] => {
    const found: Assertion[] = []
    const visit = (n: ts.Node): void => {
      if (ts.isCallExpression(n)) {
        const fn = n.expression
        if (ts.isIdentifier(fn) && fn.text === 'expect') {
          const names: string[] = []
          let parent: ts.Node | undefined = n.parent
          while (parent && ts.isPropertyAccessExpression(parent)) {
            names.push(parent.name.text)
            const call: ts.Node | undefined = parent.parent
            if (call && ts.isCallExpression(call) && call.expression === parent) {
              found.push({
                subject: T(n.arguments[0]),
                negated: names.includes('not'),
                matcher: names[names.length - 1] ?? '',
                args: call.arguments.map((one) => T(one)),
              })
              parent = call.parent
              continue
            }
            parent = parent.parent
          }
        }
        if (ts.isIdentifier(fn) && INK.has(fn.text)) {
          found.push({
            subject: T(n.arguments[0]),
            negated: false,
            matcher: `ink:${fn.text}`,
            args: [],
          })
        }
        const name = ts.isIdentifier(fn)
          ? fn.text
          : ts.isPropertyAccessExpression(fn) && ts.isIdentifier(fn.name)
            ? fn.name.text
            : null
        if (depth < 4 && name !== null && helpers.has(name) && !seen.has(name)) {
          const next = new Set(seen)
          next.add(name)
          found.push(...assertionsIn(helpers.get(name) as ts.Node, next, depth + 1))
        }
      }
      ts.forEachChild(n, visit)
    }
    ts.forEachChild(node, visit)
    return found
  }

  const blocks: Block[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      let base: string | null = null
      if (ts.isIdentifier(node.expression)) base = node.expression.text
      else if (ts.isPropertyAccessExpression(node.expression)) {
        let inner: ts.Node = node.expression.expression
        while (ts.isCallExpression(inner)) inner = inner.expression
        while (ts.isPropertyAccessExpression(inner)) inner = inner.expression
        if (ts.isIdentifier(inner)) base = inner.text
      }
      const body = node.arguments.find(
        (one) => ts.isArrowFunction(one) || ts.isFunctionExpression(one),
      )
      if ((base === 'it' || base === 'test') && body) {
        const first = node.arguments[0]
        const local = new Map<string, string>()
        const walkLocal = (n: ts.Node): void => {
          if (
            ts.isVariableDeclaration(n) &&
            n.initializer &&
            !ts.isArrowFunction(n.initializer) &&
            !ts.isFunctionExpression(n.initializer)
          ) {
            const init = T(n.initializer)
            if (ts.isIdentifier(n.name)) local.set(n.name.text, init)
            else if (ts.isObjectBindingPattern(n.name) || ts.isArrayBindingPattern(n.name)) {
              for (const element of n.name.elements) {
                if (ts.isBindingElement(element) && ts.isIdentifier(element.name)) {
                  local.set(element.name.text, init)
                }
              }
            }
          }
          ts.forEachChild(n, walkLocal)
        }
        walkLocal(body)
        blocks.push({
          title: first && ts.isStringLiteralLike(first) ? first.text : T(first),
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          assertions: assertionsIn(body, new Set(), 0).map((one) => ({
            ...one,
            subject: expand(one.subject, local, binds, helperText),
          })),
        })
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sf, visit)
  return blocks
}

function expand(
  text: string,
  local: ReadonlyMap<string, string>,
  binds: ReadonlyMap<string, string>,
  helperText: ReadonlyMap<string, string>,
): string {
  const seen = new Set<string>()
  const parts: string[] = []
  let frontier = [text]
  for (let hop = 0; hop <= 2 && frontier.length > 0; hop++) {
    const next: string[] = []
    for (const current of frontier) {
      parts.push(current)
      for (const name of new Set(current.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) ?? [])) {
        if (seen.has(name)) continue
        seen.add(name)
        const init = local.get(name) ?? binds.get(name) ?? helperText.get(name)
        if (init !== undefined && init.length < 4000) next.push(init)
      }
    }
    frontier = next
  }
  return parts.join(' ~ ')
}

const markupSubjects = (assertions: readonly Assertion[]): ReadonlySet<string> =>
  new Set(
    assertions
      .filter((one) => MARKUP.test(one.args.join(' ')) || SURFACE.test(one.subject))
      .map((one) => one.subject),
  )

function isAbsence(
  { matcher, negated, args, subject }: Assertion,
  surfaces: ReadonlySet<string>,
): boolean {
  const arg = args.join(' ').trim()
  if (!SURFACE.test(subject) && !MARKUP.test(arg) && !surfaces.has(subject)) return false
  if (!negated && (matcher === 'toBeNull' || matcher === 'toBeUndefined')) return true
  if (
    negated &&
    [
      'toContain',
      'toMatch',
      'toContainEqual',
      'toEqual',
      'toBe',
      'toStrictEqual',
      'toBeTruthy',
      'toBeDefined',
    ].includes(matcher)
  ) {
    return true
  }
  if (!negated && matcher === 'toHaveLength' && arg === '0') return true
  if (!negated && ['toEqual', 'toStrictEqual'].includes(matcher) && /^\[\s*\]$/.test(arg))
    return true
  if (!negated && matcher === 'toBe' && /^(''|""|``|0|false)$/.test(arg)) return true
  return false
}

function isReading(one: Assertion, surfaces: ReadonlySet<string>): boolean {
  if (one.matcher.startsWith('ink:')) return true
  if (one.negated) return false
  if (WORDS.test(one.subject)) return true
  const arg = one.args.join(' ').trim()
  return (
    ['toContain', 'toMatch', 'toContainEqual', 'toEqual', 'toStrictEqual', 'toBe'].includes(
      one.matcher,
    ) &&
    /['"`]/.test(arg) &&
    arg.length > 4 &&
    !HOOK_ONLY.test(arg) &&
    (SURFACE.test(one.subject) || MARKUP.test(arg) || surfaces.has(one.subject))
  )
}

export function unpaired(filename: string, source: string): Block[] {
  return blocksOf(filename, source).filter((block) => {
    const surfaces = markupSubjects(block.assertions)
    return (
      block.assertions.some((one) => isAbsence(one, surfaces)) &&
      !block.assertions.some((one) => isReading(one, surfaces))
    )
  })
}

interface TestFile {
  readonly file: string
  readonly source: string
}

function testFiles(): TestFile[] {
  const found: TestFile[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!IS_TEST.test(entry.name)) continue
      found.push({
        file: relative(REPO, child).split(sep).join('/'),
        source: readFileSync(child, 'utf8'),
      })
    }
  }
  for (const root of ROOTS) {
    const dir = join(REPO, root)
    if (existsSync(dir)) walk(dir)
  }
  return found
}

export const declaresTheRule = (file: string, source: string): boolean =>
  DECLARATION.test(commentsOf(file, source))

const ENFORCED = new Set([...DECLARES_AND_DRAWS, ...DECLARES_AND_DRAWS_NOTHING])
const enrolled = (file: string, source: string): boolean =>
  ENFORCED.has(file) || declaresTheRule(file, source)
const declaring = (): TestFile[] => testFiles().filter((one) => enrolled(one.file, one.source))

describe('⛔ 556 · a mount is not a reading', () => {
  it('⛔ every file that STATES the pairing rule is in exactly one of the three rosters', () => {
    const rosters = [...DECLARES_AND_DRAWS, ...DECLARES_AND_DRAWS_NOTHING]
    expect(new Set(rosters).size, 'a file is in two rosters').toBe(rosters.length)
    expect(rosters).toHaveLength(72)
    expect(DECLARES_AND_DRAWS).toHaveLength(50)
    expect(DECLARES_AND_DRAWS_NOTHING).toHaveLength(22)
    expect(enrolled('apps/desktop/test/the-answer-a-person-can-read.render.test.ts', '')).toBe(true)
    expect(
      declaring()
        .map((one) => one.file)
        .sort(),
    ).toEqual([...rosters].sort())
  })

  it('⚑ …and the rosters really are what their names say', () => {
    const byFile = new Map(testFiles().map((one) => [one.file, one.source]))
    for (const file of DECLARES_AND_DRAWS) {
      const source = byFile.get(file)
      expect(source, file).toBeDefined()
      expect(drawsSomething(file, source ?? ''), `${file} mounts nothing`).toBe(true)
    }
    for (const file of DECLARES_AND_DRAWS_NOTHING) {
      const source = byFile.get(file)
      expect(source, file).toBeDefined()
      expect(drawsSomething(file, source ?? ''), `${file} DOES mount something`).toBe(false)
    }
  })

  it('🔴 every declaring suite that draws something is ENFORCED — there is no third roster', () => {
    const drawing = declaring()
      .filter((one) => drawsSomething(one.file, one.source))
      .map((one) => one.file)
      .sort()
    expect(drawing).toEqual([...DECLARES_AND_DRAWS].sort())
    expect(drawing.length).toBeGreaterThan(30)
  })

  it('🔴 no declared suite pairs a surface absence with anything less than a reading', () => {
    const byFile = new Map(testFiles().map((one) => [one.file, one.source]))
    const offenders = DECLARES_AND_DRAWS.flatMap((file) =>
      unpaired(file, byFile.get(file) ?? '').map(
        (block) => `${file}:${String(block.line)} ${block.title}`,
      ),
    )
    expect(offenders).toEqual([])
  })

  it('⚑ …and the walk really read the suites, and found the readings that pair them', () => {
    const byFile = new Map(testFiles().map((one) => [one.file, one.source]))
    const blocks = DECLARES_AND_DRAWS.flatMap((file) => blocksOf(file, byFile.get(file) ?? ''))
    expect(testFiles().length).toBeGreaterThan(400)
    expect(blocks.length).toBeGreaterThan(300)
    const withAbsence = blocks.filter((one) =>
      one.assertions.some((a) => isAbsence(a, markupSubjects(one.assertions))),
    )
    const withReading = blocks.filter((one) =>
      one.assertions.some((a) => isReading(a, markupSubjects(one.assertions))),
    )
    expect(withAbsence.length).toBeGreaterThan(180)
    expect(withReading.length).toBeGreaterThan(250)
  })

  it('🔴 the predicate fires on a planted mount-only pair — twice in one file', () => {
    const planted = `
      import { mount } from './harness'
      it('the first block: two negatives and a mount', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="a"]')).toBeNull()
        expect(host.querySelector('[data-cy="b"]')).toBeNull()
        expect(host.querySelector('[data-cy="c"]')).not.toBeNull()
      })
      it('the second block, which a first-match reader never reaches', () => {
        const { host } = mount(Thing, {})
        expect(host.textContent).not.toContain('memory')
        expect(host.querySelector('[data-cy="c"]')).not.toBeNull()
      })
    `
    expect(unpaired('planted.ts', planted).map((one) => one.title)).toEqual([
      'the first block: two negatives and a mount',
      'the second block, which a first-match reader never reaches',
    ])
  })

  it('🔴 …and on `536`’s own repair — two presences are still not a reading', () => {
    const thirtySix = `
      it('⚑ …and a session with no memory at all still renders no block', () => {
        const { host } = openInfo(NOTHING)
        expect(host.querySelector('[data-cy="session-instructions"]')).toBeNull()
        expect(host.querySelector('[data-cy="told-layer-agent-store"]')).toBeNull()
        expect(host.querySelector('[data-cy="told-composition"]')).not.toBeNull()
        expect(host.querySelector('[data-cy="told-remembers-nothing"]')).not.toBeNull()
      })
    `
    expect(unpaired('planted.ts', thirtySix).map((one) => one.title)).toEqual([
      '⚑ …and a session with no memory at all still renders no block',
    ])

    const landed = `
      it('⚑ …and a session with no memory at all still renders no block', () => {
        const { host } = openInfo(NOTHING)
        expect(host.querySelector('[data-cy="session-instructions"]')).toBeNull()
        expect(host.querySelector('[data-cy="told-sentence"]')?.textContent?.trim()).toBe(
          TOLD_IS_THE_LAST_LAUNCH,
        )
      })
    `
    expect(unpaired('planted.ts', landed)).toEqual([])
  })

  it('⚑ …and stays silent on the three shapes it must not flag', () => {
    const repaired = `
      it('paired with a reading', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="a"]')).toBeNull()
        expect(host.querySelector('[data-cy="c"]')?.textContent).toContain('BroBot read none')
      })
    `
    expect(unpaired('planted.ts', repaired)).toEqual([])

    const honest = `
      it('renders at all', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="c"]')).not.toBeNull()
      })
    `
    expect(unpaired('planted.ts', honest)).toEqual([])

    const offstage = `
      it('sends no folder', () => {
        expect('cwd' in sent).toBe(false)
        expect(sent.projectSlug).toBeNull()
      })
    `
    expect(unpaired('planted.ts', offstage)).toEqual([])

    const throughAHelper = `
      const metaOf = (host, cy) => host.querySelector(\`[data-cy="\${cy}"] .meta\`)?.textContent ?? ''
      it('reads through a helper', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="a"]')).toBeNull()
        expect(metaOf(host, 'b')).toContain('put this in the prompt')
      })
    `
    expect(unpaired('planted.ts', throughAHelper)).toEqual([])

    const assertedInAHelper = `
      const readsIt = (host) =>
        expect(host.querySelector('[data-cy="c"]')?.textContent).toContain('BroBot read none')
      it('asserts through a helper', () => {
        const { host } = mount(Thing, {})
        expect(host.querySelector('[data-cy="a"]')).toBeNull()
        readsIt(host)
      })
    `
    expect(unpaired('planted.ts', assertedInAHelper)).toEqual([])
  })

  it('⚠️ the declaration is read from comments, and the weaker rule is not one', () => {
    const declared = `/** Every negative below is paired with a positive about the SAME element. */\nit('x', () => {})`
    expect(DECLARATION.test(commentsOf('p.ts', declared))).toBe(true)

    const wrapped = `/**\n * Every negative here is paired with a\n * positive on the same render.\n */`
    expect(DECLARATION.test(commentsOf('p.ts', wrapped))).toBe(true)

    const weaker = `/** Every negative here is scoped to an element that was asserted to exist first. */`
    expect(DECLARATION.test(commentsOf('p.ts', weaker))).toBe(false)

    const inCode = `const quoted = 'Every negative below is paired with a positive'\n`
    expect(declaresTheRule('p.ts', inCode)).toBe(false)
    expect(declaresTheRule('p.ts', declared)).toBe(true)
    expect(enrolled('unlisted.test.ts', declared)).toBe(true)
    expect(ENFORCED.has('unlisted.test.ts')).toBe(false)
    expect(enrolled('unlisted.test.ts', inCode)).toBe(false)
  })
})
