import ts from 'typescript'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { camelize, capitalize, createSSRApp, h } from 'vue'
import { parse as parseSfc } from 'vue/compiler-sfc'
import { renderToString } from 'vue/server-renderer'
import ForestCard from '../src/renderer/src/components/ForestCard.vue'
import TaskList from '../src/renderer/src/components/TaskList.vue'
import {
  isDotOnly,
  platePx,
  SIZES,
  STANDING_LABEL,
  type SizeName,
} from '../src/renderer/src/lib/agent-state'
import { forestGraph } from '../src/renderer/src/lib/forest-graph'
import { forestView } from '../src/renderer/src/lib/the-forest'
import { WORK_STATE_WORD } from '../src/renderer/src/lib/work-report'
import {
  parentCardOf,
  workingTogetherView,
  type CastReading,
  type WorkingTogetherInput,
} from '../src/renderer/src/lib/working-together'
import type { LedgerWalk, LedgerWalkKind } from '../src/shared/questions'
import {
  TASK_WAITS,
  type TaskState,
  type TaskWait,
  type WhatEachConversationIsWaitingOn,
} from '../src/shared/tasks'
import type { ForestNode, TheWholeForest } from '../src/shared/the-whole-forest'
import type { WhatIsBeingDone } from '../src/shared/what-is-being-done'
import type { SpawnEdge, WhoCalledWhom, WorkEdge } from '../src/shared/who-called-whom'

/**
 * # 🔴 651 · A dot says one thing — so every dot in the app is DECLARED, and each declaration is PROVED
 *
 * ## ⛔ The ruling this file makes unbreakable by a new call site
 *
 * ⚑ **`priorityDotToken`'s own rule** (`081` §4): *"A dot can say exactly one thing, so it says the
 * most important one and the row's own text carries the word."* ⚠️ **And the sixth facet is the fact
 * a dot most certainly does NOT say** — `645` decided `priorityDotToken` ignores the wait, and
 * ⛔ **no plate of any size draws a wait at all**: `AgentState.vue` forwards `waiting` into the
 * accessible name and nowhere else. The only thing that shows a sighted person a wait is a
 * STANDING WORD — the rail row's, the header pill's, the forest's `forest-says`.
 *
 * 🔴 **So the hazard `645` §3.4 named is exact:** *a dot-sized plate for a subject that can be in a
 * wait, with no word for that wait anywhere its subject is drawn.* ⛔ The dot would answer `--ready`
 * over a conversation somebody is waiting on — `HO-095` §5.1's *"BroBot's header, avatar and rail
 * row read `Idle` while Task #1 was being worked on by Ada"* (a piece, `W1.1`, since D-016), at
 * sixteen pixels.
 *
 * ## ⚠️ `645`'s statement of this ruling was WRONG about which row, and this file encodes the true one
 *
 * ⛔ **`645` wrote that the forest's task line *"draws `forest-says` beside the mark."* It does not.**
 * `forest-says` is on the CONVERSATION row. ⚑ **What is true, and what this file pins, is that every
 * dot in the app REPEATS a subject rather than introducing one** — the forest's task dot WAS its
 * holder conversation's own `facets` object (and since `668` there is no forest dot: the task line
 * sits on its holder's card, see below); WorkingTogether's task dots are a cast card's own `facets` object, whose
 * plate is never handed a wait. 🔴 **But the two are not equally safe, and this file says which is
 * which**: the forest says its subject's standing in visible words; the band says a TASK's wait on
 * its status mark's `title` and `aria-label`, and to the eye only by the ○, by `631`'s ruled line
 * grammar — `654`'s tint for the ONE wait a person owes went with the given-out lines, the only
 * ones it could fire on (PM ruling, 2026-10-01). `651`'s first version called the band *"reads no wait at all"*; its review found that
 * false. §3 holds the proofs for both, and `DOTS` names the weaker one as weaker.
 *
 * ## 🔴 668 · the forest's task line has NO dot any more — and that is the ruling kept, not dropped
 *
 * Each task line sits inside its holder’s card, whose plate and standing word already
 * identify the holder’s state. The task line draws no additional plate, avoiding a second
 * mark that could read as a separate fact about the task.
 *
 * ## ⛔ Why a PARSER and not a grep — and why these node numbers are pinned rather than trusted
 *
 * ⚑ `test/lib/visible-copy.ts`' own argument: *"Comments never enter an AST, so prose is excluded by
 * construction rather than by a regex that has to be re-derived per file type"*
 * ([[a-source-census-must-strip-prose-before-it-asserts]]). A docblock quoting `<AgentState size="dot">`
 * is not a call site and no regex can be trusted to know that. ⚠️ **`vue/compiler-sfc` exports the
 * parser and not the node-type enum**, so the four numbers below are written down — and §4 plants a
 * fixture whose tag each must find, so a renumbering in Vue turns this file red instead of turning the
 * reader quietly empty (standing rule 27).
 *
 * ## ⚠️ Why this is a `.render.test.ts`, stated because it is only half a render test
 *
 * ⛔ **Boundary and type-checking both put it here.** It reads SFC SOURCE through Vite's
 * `import.meta.glob(…, { query: '?raw' })`, which is typed by `vite/client` — carried by
 * `tsconfig.web.json`, which includes `*.render.test.ts` and not plain tests. ⚑ And §3's forest proof
 * genuinely renders: it SSR-renders every `ForestCard` of the forest, in the order the forest draws
 * them, to show the word is drawn where the subject is. ⚠️ Not `TeamForest` itself since the forest
 * is drawn by Vue Flow (2026-09-30), which draws its nodes only in a browser.
 *
 * ## ⛔ What this census does NOT see — a green run is not more than this
 *
 *  - **A size handed in through a spread** (`v-bind="{ size: 'dot' }"`). Every spread on a plate
 *    today is an `AgentFacets`, which has no `size`; ⚠️ a tag that received its size that way would
 *    be classified by its explicit `size` alone.
 *  - **A plate rendered from SCRIPT** (`h(AgentState, …)`) rather than a template. ⚠️ §1 catches
 *    ONE shape of it — a `.vue` file whose only use of the import is scripted, which is
 *    import-and-no-tag. ⛔ It is SILENT for an `h()` plate in a file that also draws a tag, and for
 *    any `.ts` module, because the reader's glob reads `.vue` files only.
 *  - **A size constant SHADOWED in the template** — `const X = 16` in the script and a `v-for="X in …"`
 *    alias of the same name. The reader resolves `X` from the script. Measured: no such shadow
 *    exists; the pattern is the shape a linter would flag first.
 *  - **A renamed import through a barrel** (`import { AgentState as Plate } from './index'`) — the
 *    literal name is searched, the alias is not. ⚑ Refused if the tag is spelled `AgentState`.
 *  - **Whether a declared word is VISIBLE.** SSR carries markup and not layout; the forest's word is
 *    held visible by `the-forest-from-the-person-down.dom.test.ts`, whose *"the standing is drawn as a
 *    word beside the plate"* is the DOM half of §3's first proof.
 */

/* ────────────────────────────────────────────────────────────────────────────────────────────────
   The reader — one SFC in, every plate tag out, with its size RESOLVED or REFUSED
   ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Vue's template-AST numbers, named — pinned by §4 rather than taken on trust.
 *
 * ⚠️ **`tagType` is the parser's own answer to *is this a component?*** — `651`'s review found that
 * matching on the tag NAME alone counted an `<AgentState>` inside a `v-pre` subtree, which Vue renders
 * as a plain, inert HTML element and never as a plate.
 */
const TEMPLATE_ELEMENT = 1
const TAG_IS_COMPONENT = 1
const PROP_ATTRIBUTE = 6
const PROP_DIRECTIVE = 7

interface TemplateNode {
  readonly type: number
  readonly tag?: string
  readonly tagType?: number
  readonly props?: readonly TemplateProp[]
  readonly children?: readonly unknown[]
  readonly loc: { readonly start: { readonly line: number } }
}

interface TemplateProp {
  readonly type: number
  readonly name: string
  readonly value?: { readonly content: string } | undefined
  readonly arg?: { readonly content?: string } | undefined
  readonly exp?: { readonly content?: string } | undefined
}

/**
 * ⛔ **A size is a NUMBER or a REFUSAL — never a guess.**
 *
 * ⚠️ A `:size` bound to an expression this reader cannot evaluate is refused by name, and §1 turns a
 * refusal red. ⚑ That is the fail-closed direction: a new call site that computes its size at run
 * time — `:size="dense ? 'dot' : 'compact'"` — has to be made READABLE (a `SIZES` name, a number, or
 * a top-level numeric `const`). ⛔ **There is no declaration for a refused size**: `DOTS` declares
 * dots, and a size nobody can read is not known to be one.
 */
type Size = { readonly px: number } | { readonly refused: string }

export interface PlateTag {
  readonly line: number
  readonly size: Size
  /** The expression of a whole-object `v-bind`, or `null` where the facets are bound one at a time. */
  readonly spread: string | null
}

export interface PlateCallSite {
  /** Whether the file's script IMPORTS `AgentState.vue`, in ANY shape — found independently of the tags. */
  readonly imports: boolean
  readonly tags: readonly PlateTag[]
}

const isSizeName = (name: string): name is SizeName => Object.hasOwn(SIZES, name)

/**
 * ⚑ **What Vue itself resolves a tag to** — `<agent-state>`, `<agentState>` and `<AgentState>` all
 * render the same component, so all three are the same call site here. ⛔ Hand-building a kebab form,
 * as this file first did, missed `<agentState>` and `<Agent-State>`.
 */
const resolved = (tag: string): string => capitalize(camelize(tag))

/** Every script block of an SFC, parsed — imports and constants are read from here and nowhere else. */
function scriptsOf(file: string, blocks: readonly (string | undefined)[]): ts.SourceFile[] {
  return blocks
    .filter((text): text is string => text !== undefined)
    .map((text, i) => ts.createSourceFile(`${file}.${i}.ts`, text, ts.ScriptTarget.Latest, true))
}

/**
 * ⚑ **Every name this file gives `AgentState.vue`, and whether it imports it at all.**
 *
 * 🔴 **The two answers are found SEPARATELY, and `651`'s review is why.** The first version only
 * searched for tags under a name found by a DEFAULT import, so a file that imported the plate any
 * other way had no tags AND no import — and fell out of the roster with the census green. ⛔ So
 * `imports` is now true for ANY import of the file — default, `{ default as X }`, or a dynamic
 * `import('…/AgentState.vue')` of the `defineAsyncComponent` shape — and §1 turns a file that draws
 * a plate it has no recognised import for red, instead of never seeing it
 * ([[derive-a-roster-from-the-import-not-the-mention]]).
 */
function importOf(scripts: readonly ts.SourceFile[]): {
  readonly imports: boolean
  readonly names: readonly string[]
} {
  const names = new Set<string>()
  let imports = false
  const fromPlate = (spec: ts.Node | undefined): boolean =>
    spec !== undefined && ts.isStringLiteral(spec) && spec.text.endsWith('/AgentState.vue')
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && fromPlate(node.moduleSpecifier)) {
      imports = true
      const clause = node.importClause
      if (clause?.name) names.add(clause.name.text)
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamedImports(bindings)) {
        for (const one of bindings.elements)
          if ((one.propertyName ?? one.name).text === 'default') names.add(one.name.text)
      }
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      fromPlate(node.arguments[0])
    ) {
      imports = true
      let owner: ts.Node | undefined = node.parent
      while (owner && !ts.isVariableDeclaration(owner) && !ts.isSourceFile(owner))
        owner = owner.parent
      if (owner && ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name))
        names.add(owner.name.text)
    }
    ts.forEachChild(node, visit)
  }
  for (const script of scripts) visit(script)
  return { imports, names: [...names] }
}

/** ⚑ Top-level `const NAME = <number>` — what lets `SessionBot`'s `:size="PLATE"` be READ, not guessed. */
function numericConstantsOf(scripts: readonly ts.SourceFile[]): ReadonlyMap<string, number> {
  const found = new Map<string, number>()
  for (const script of scripts) {
    for (const statement of script.statements) {
      if (!ts.isVariableStatement(statement)) continue
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) continue
      for (const decl of statement.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.initializer && ts.isNumericLiteral(decl.initializer))
          found.set(decl.name.text, Number(decl.initializer.text))
      }
    }
  }
  return found
}

function sizeOf(props: readonly TemplateProp[], constants: ReadonlyMap<string, number>): Size {
  const literal = props.find((p) => p.type === PROP_ATTRIBUTE && p.name === 'size')
  if (literal) {
    const name = literal.value?.content ?? ''
    return isSizeName(name)
      ? { px: platePx(name) }
      : { refused: `size="${name}" is not one of SIZES' names` }
  }
  const bound = props.find(
    (p) => p.type === PROP_DIRECTIVE && p.name === 'bind' && p.arg?.content === 'size',
  )
  if (bound) {
    const exp = (bound.exp?.content ?? '').trim()
    if (/^\d+$/.test(exp)) return { px: Number(exp) }
    const quoted = /^'([a-z]+)'$/.exec(exp)?.[1]
    if (quoted !== undefined && isSizeName(quoted)) return { px: platePx(quoted) }
    const constant = constants.get(exp)
    if (constant !== undefined) return { px: constant }
    return { refused: `:size="${exp}" cannot be read without running the component` }
  }
  // ⚑ Absent ⇒ `platePx`'s own default, taken from the function rather than restated here.
  return { px: platePx(undefined) }
}

/**
 * ⚑ **`<component :is="AgentState">` is a plate too** — the one spelling of a call site whose tag
 * is not the component's name. ⛔ A static `is` and an identifier `:is` are resolved like a tag; any
 * other `:is` expression is not a plate this reader can name, and is left for the bounds.
 */
function dynamicTarget(node: TemplateNode): string | null {
  if (node.tag === undefined || resolved(node.tag) !== 'Component') return null
  for (const prop of node.props ?? []) {
    if (prop.type === PROP_ATTRIBUTE && prop.name === 'is')
      return (prop.value?.content ?? '').replace(/^vue:/, '')
    if (prop.type === PROP_DIRECTIVE && prop.name === 'bind' && prop.arg?.content === 'is') {
      const exp = (prop.exp?.content ?? '').trim()
      if (/^[A-Za-z_$][\w$]*$/.test(exp)) return exp
    }
  }
  return null
}

export function plateCallSite(file: string, source: string): PlateCallSite {
  const { descriptor, errors } = parseSfc(source, { filename: file })
  // ⛔ `visible-copy.ts`' two refusals, for its two reasons: a parse error and an out-of-file
  // template each hand back an AST that is not the file, and a census over it would be quietly empty.
  if (errors.length > 0) throw new Error(`${file}: ${errors.map(String).join('; ')}`)
  const template = descriptor.template as { ast?: TemplateNode } | null | undefined
  if (template && !template.ast) throw new Error(`${file}: a <template> this reader cannot see`)

  const scripts = scriptsOf(file, [descriptor.script?.content, descriptor.scriptSetup?.content])
  const { imports, names } = importOf(scripts)
  const constants = numericConstantsOf(scripts)
  // ⛔ **The literal name is ALWAYS searched**, whatever the import found — that is what lets §1 see a
  // plate drawn with no recognised import at all (a barrel, a renamed re-export, a self-reference).
  const plateNames = new Set(['AgentState', ...names].map(resolved))

  const roots = new Set(
    (template?.ast?.children ?? []).filter((c) => (c as TemplateNode).type === TEMPLATE_ELEMENT),
  )
  const tags: PlateTag[] = []
  const visit = (node: TemplateNode): void => {
    const target = node.tag === undefined ? null : (dynamicTarget(node) ?? node.tag)
    if (
      node.type === TEMPLATE_ELEMENT &&
      node.tagType === TAG_IS_COMPONENT &&
      target !== null &&
      plateNames.has(resolved(target))
    ) {
      const props = node.props ?? []
      const spread = props.find((p) => p.type === PROP_DIRECTIVE && p.name === 'bind' && !p.arg)
      tags.push({
        line: node.loc.start.line,
        // ⚠️ **A plate at the template ROOT is refused**: Vue falls a caller's attributes through
        // onto a single root, so its size would be whatever the CALLER writes — which this file
        // cannot read. ⚑ No such component exists today; the refusal is what keeps it that way.
        size: roots.has(node)
          ? { refused: 'a plate at the template root takes its caller’s size by fallthrough' }
          : sizeOf(props, constants),
        spread: spread?.exp?.content?.trim() ?? null,
      })
    }
    for (const child of node.children ?? []) visit(child as TemplateNode)
  }
  if (template?.ast) visit(template.ast)
  return { imports, tags }
}

const isDot = (tag: PlateTag): boolean => 'px' in tag.size && isDotOnly(tag.size.px)

/* ────────────────────────────────────────────────────────────────────────────────────────────────
   The declarations — every dot in the app, what it repeats, and where the wait is said
   ──────────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * 🔴 **Every dot-sized plate in the renderer, by FILE and COUNT** — never by line
 * ([[a-source-census-that-pins-a-line-kills-every-row-on-it]]).
 *
 * ⛔ **The declarations, each with its proofs in §3, and they are NOT equally strong:**
 *
 * | `wait` | means | proved by |
 * |---|---|---|
 * | `said-on-its-own-row` | the dot REPEATS a subject that can be in a wait, and that subject's own row says its STANDING in words — `standingOf`, whose precedence is what places the wait (a terminal ending outranks it, and then the dot says `ended` too) | a render showing the word, and the dot's facets being the SAME object as the worded row's |
 * | `said-only-by-its-mark` | the dot repeats a card whose plate is never handed a wait, and the wait the line DOES know — the task's own state — is said by its status mark: the word on `title` and `aria-label`, the shape alone to the eye | the band's plates being wait-free with every task wait planted, each dot being its own card's facets, and a render of the mark |
 *
 * On a taken line, the mark’s wait belongs to the holder while the dot represents the giver,
 * so tinting the dot for the holder’s wait would misattribute it. The mark’s label and title
 * say every wait; the current piece also carries its state as a word beside the mark in one
 * pill.
 */
/**
 * ⚑ **The declarations a dot can take.** `said-only-by-its-mark` is the band's — a wait said on
 * hover and in the label. ⛔ `654`'s third member, for a tinted mark, went with the tint (PM ruling,
 * 2026-10-01).
 */
type DotKind = 'said-on-its-own-row' | 'said-only-by-its-mark'

const DOTS = {
  // ⚑ **The band's task lines are `TaskList`'s since the refactor** — one row template drawn for
  // both lists, so ONE dot where `WorkingTogether` spelled the row twice.
  'components/TaskList.vue': {
    count: 1,
    repeats:
      'the giver’s card — `parent.facets`, on work taken in; a line from a giver the band holds no card for draws none',
    wait: 'said-only-by-its-mark',
    word: 'cast-work-mark',
  },
} as const satisfies Readonly<
  Record<
    string,
    {
      readonly count: number
      readonly repeats: string
      readonly wait: DotKind
      readonly word: string
    }
  >
>

/** ⚑ Every SFC in the renderer, as SOURCE — Vite's own module graph, so no filesystem path is invented. */
const SOURCES = import.meta.glob('../src/renderer/src/**/*.vue', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const PREFIX = '../src/renderer/src/'
const ROSTER: ReadonlyMap<string, PlateCallSite> = new Map(
  Object.entries(SOURCES)
    .map(([path, text]) => [path.slice(PREFIX.length), plateCallSite(path, text)] as const)
    .filter(([, site]) => site.imports || site.tags.length > 0),
)

/** The dot count per file, from the roster — the census's measurement. */
function dotsIn(roster: ReadonlyMap<string, PlateCallSite>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [file, site] of roster) {
    const dots = site.tags.filter(isDot).length
    if (dots > 0) out[file] = dots
  }
  return out
}

const DECLARED: Record<string, number> = Object.fromEntries(
  Object.entries(DOTS).map(([file, entry]) => [file, entry.count]),
)

/* ──────────────────────────────────────────────────────────────────────────────────────────── §1 */

describe('§1 · the roster is read, whole, from the import AND the tag', () => {
  it('⚑ it is not empty, and it reaches every file that draws a plate today', () => {
    // ⛔ **Non-vacuity, named rather than counted** — a census that read nothing passes every
    // assertion below it. ⚠️ Named FILES and not a total, for `651` §3's reason: a number in a test
    // ages exactly like a number in a docblock. ⚑ **Every importer, not five of them** — `651`'s
    // review found the first version's title claimed all and checked five (#21), which left six
    // files with no floor at all: a changed import form would have dropped any of them silently.
    for (const file of [
      'components/AttentionQueue.vue',
      'components/SessionBot.vue',
      'components/SessionHeader.vue',
      'components/SessionPanel.vue',
      'components/SideRail.vue',
      'components/SubAgentEntry.vue',
      'components/TaskList.vue',
      'components/ForestCard.vue',
      'components/TeamWorkspace.vue',
      'components/WorkflowEntry.vue',
      'components/WorkingTogether.vue',
    ])
      expect(ROSTER.get(file)?.tags.length ?? 0, file).toBeGreaterThan(0)
  })

  it('🔴 every file that imports `AgentState.vue` draws it in its template, and every one that draws it imports it', () => {
    // ⛔ **Both directions** ([[a-census-that-asks-for-the-import-must-ask-for-the-call]]). An import
    // with no tag is one shape a plate rendered from SCRIPT would take — `h(AgentState, …)` — and a
    // plate drawn with no RECOGNISED import is a barrel or a re-export the reader cannot follow.
    // ⚠️ **The second direction could not fail in `651`'s first version**: tags were only searched
    // under a name the import supplied, so `imports` was true of every file that had tags by
    // construction (review, #1). ⚑ The literal name is now searched whatever the import found, and
    // §4 plants the three shapes that used to fall through.
    for (const [file, site] of ROSTER) {
      expect(site.tags.length, `${file} imports AgentState.vue and draws no tag`).toBeGreaterThan(0)
      expect(site.imports, `${file} draws a plate it never imports`).toBe(true)
    }
  })

  it('⛔ every plate’s size is READ — none is guessed', () => {
    const refused = [...ROSTER].flatMap(([file, site]) =>
      site.tags.flatMap((tag) =>
        'refused' in tag.size ? [`${file}:${tag.line} ${tag.size.refused}`] : [],
      ),
    )
    expect(refused).toEqual([])
    // ⚑ **The one size this app computes rather than names, READ** — `SessionBot`'s `:size="PLATE"`.
    // Without the constant table it would be a refusal; with it, it is the number the drawer draws.
    const bot = ROSTER.get('components/SessionBot.vue')!.tags[0]!
    expect(bot.size).toEqual({ px: 77 })
  })
})

/* ──────────────────────────────────────────────────────────────────────────────────────────── §2 */

describe('§2 · the census — every dot in the app is declared, and nothing else is', () => {
  it('🔴 the dots the parser finds are EXACTLY the dots `DOTS` declares, by file and by count', () => {
    // ⛔ **This is the line `645` §3.4 said did not exist.** A new call site that draws a plate below
    // `PLATE_FLOOR` — for any reason, spread or not — turns this red until it is declared, and a
    // declaration cannot be written without choosing a `DotKind`, and the table above `DOTS` names
    // the proofs each one owes in §3.
    // ⚠️ **And the other direction**: a dot removed leaves a declaration describing nothing, which is
    // the stale-entry shape `mutations:census` refuses for the same reason.
    expect(dotsIn(ROSTER)).toEqual(DECLARED)
  })

  it('⚑ every declaration names its word, and the word is a hook the declared file really draws', () => {
    // ⛔ **A pointer is a claim** ([[a-pointer-clause-is-a-claim]]): a `word` naming a `data-cy`
    // the file no longer carries would be a declaration describing nothing.
    for (const [file, entry] of Object.entries(DOTS)) {
      expect(entry.repeats.length, file).toBeGreaterThan(0)
      expect(SOURCES[`${PREFIX}${file}`], file).toContain(`data-cy="${entry.word}"`)
    }
  })
})

/* ──────────────────────────────────────────────────────────────────────────────────────────── §3 */

const NOW = 1_800_000_000_000

describe('§3 · one proof per declaration', () => {
  /* ── TeamForest · `said-on-its-own-row` ───────────────────────────────────────────────────── */

  /**
   * ⚑ **Two conversations whose plates DIFFER — the one that GAVE the task and the one that HOLDS it.**
   *
   * ⛔ `651`'s review (#27): the first version had one conversation that both gave and held its own
   * task, so a task dot built from the GIVER's facets would have passed every assertion here. ⚠️ Now
   * the giver is working and says so, the holder is idle and waiting on a worker, and the task line
   * has to sit in the HOLDER's card to pass — `668` removed the dot, and the card is what it repeated.
   */
  const conversation = (id: string): ForestNode =>
    ({
      node: 'a-conversation',
      conversation: id,
      under: { is: 'the-person' },
      identity: id === 'sess_holder' ? 'dev' : 'lead',
      provider: 'claude',
      status: 'idle',
      running: 'unwatched',
      standsInFor: [],
      inItsPlace: null,
      startedAt: NOW - 60_000,
      updatedAt: NOW - 1_000,
    }) as ForestNode

  const task = (): ForestNode =>
    ({
      node: 'a-task',
      under: { is: 'a-conversation', conversation: 'sess_holder' },
      givenBy: { is: 'a-conversation', conversation: 'sess_giver' },
      work: {
        piece: 'work_1',
        label: 'W1.1',
        title: 'write the page',
        from: 'sess_giver',
        fromIdentity: 'lead',
        to: 'sess_holder',
        toIdentity: 'dev',
        state: 'working',
        givenAt: NOW - 30_000,
        endedAt: null,
      },
    }) as ForestNode

  const forest = (): TheWholeForest =>
    ({
      readAt: NOW,
      nodes: {
        rows: [conversation('sess_giver'), conversation('sess_holder'), task()],
        walk: 'every-conversation-this-app-placed',
        ledgers: 2,
        rowsUnread: 0,
      },
      conversations: 2,
      heldByNoAgent: 0,
    }) as TheWholeForest

  // ⚠️ **A live reading for both**, because `standingOf` raises `elsewhere` only over a KNOWN idle —
  // `641` §5's ruling, and the reason an AGENT's wait with no reading stays `Unknown`. ⚑ A PERSON's
  // wait does not: `waitSummonsAPerson` is checked above the `unknown` line in `standingOf`, so
  // `waiting-on-a-person` reads *Waiting on you* with or without one.
  const atWorkFor = (status: Record<string, string>) =>
    ({
      readAt: NOW,
      conversations: Object.entries(status).map(([conversation, state]) => ({
        conversation,
        identity: 'Dev',
        told: { said: 'nothing', because: 'no-activity-right-now' },
        status: state,
        streaming: false,
        since: NOW - 5_000,
      })),
    }) as unknown as WhatIsBeingDone

  const waits = (holder: TaskWait | null): WhatEachConversationIsWaitingOn =>
    ({
      readAt: NOW,
      conversations: [
        { conversation: 'sess_holder', identity: 'Dev', waiting: holder },
        { conversation: 'sess_giver', identity: 'Lead', waiting: null },
      ],
    }) as never

  const view = (holder: TaskWait | null) =>
    forestView({
      forest: forest(),
      atWork: atWorkFor({ sess_giver: 'working', sess_holder: 'idle' }),
      waits: waits(holder),
      identities: null,
      held: new Set<string>(),
    })!

  /** ⚑ Every card of the forest, in the order `forest-graph.ts` places them — the page's own cards. */
  const drawn = (holder: TaskWait | null): Promise<string> =>
    renderToString(
      createSSRApp({
        render: () =>
          h(
            'div',
            forestGraph(view(holder))
              .generations.flat()
              .map((node) => h(ForestCard, { node })),
          ),
      }),
    )

  /** ⚑ One row's markup, cut at its own `<li>` — so an assertion cannot be satisfied by a neighbour. */
  const rowOf = (html: string, key: string): string => {
    const from = html.indexOf(`data-cy="forest-row-${key}"`)
    expect(from, `row ${key} was not drawn`).toBeGreaterThan(-1)
    return html.slice(from, html.indexOf('</li>', from))
  }
  const plateIn = (row: string): string =>
    /<span[^>]*data-cy="agent-state"[^>]*>/.exec(row)?.[0] ?? ''
  const attr = (tag: string, name: string): string | undefined =>
    new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]
  const saysIn = (row: string): string | undefined =>
    /data-cy="forest-says"[^>]*>([^<]*)</.exec(row)?.[1]?.trim()

  // ⚠️ **668 · a VIEW-MODEL property now** — no template draws a task row's `facets` since the dot
  // went; the fold still hands every task row its holder's, and this keeps any future plate on a task
  // line from growing a second derivation (`651 M3`).
  it('🔴 TeamForest · a task row carries its HOLDER’s facets — never its giver’s, never a copy', () => {
    const rows = view('waiting-on-a-worker').rows
    const holder = rows.find(
      (row) => row.conversation === 'sess_holder' && row.kind === 'a-conversation',
    )!
    const giver = rows.find(
      (row) => row.conversation === 'sess_giver' && row.kind === 'a-conversation',
    )!
    const dot = rows.find((row) => row.kind === 'a-task')!
    // ⛔ **`toBe`, not `toEqual`** — the claim is that the task line has no facts of its own, and an
    // equal copy would be a second derivation that merely agrees today.
    expect(dot.facets).toBe(holder.facets)
    expect(dot.facets).not.toBe(giver.facets)
    // ⚑ The premises that make those two lines discriminate.
    expect(holder.facets.doing).not.toBe(giver.facets.doing)
    expect(dot.facets.waiting, 'this subject really is in a wait').toBe('waiting-on-a-worker')
  })

  it('🔴 TeamForest · 668 · the task line draws NO plate, inside the card whose word says its holder', async () => {
    const html = await drawn('waiting-on-a-worker')
    const holder = rowOf(html, 'sess_holder')
    const giver = rowOf(html, 'sess_giver')
    const taskRow = rowOf(html, 'work_1')
    expect(saysIn(holder)).toBe(STANDING_LABEL.elsewhere)
    expect(saysIn(giver)).toBe(STANDING_LABEL.working)
    // ⛔ **No plate on the task line** — neither a dot nor any other size.
    expect(plateIn(taskRow)).toBe('')
    // ⚑ **…because it is INSIDE the holder's card**: the task opens after the holder's card and
    // before any other conversation's card does — never under the giver's.
    const at = (cy: string): number => html.indexOf(`data-cy="${cy}"`)
    expect(at('forest-row-sess_holder')).toBeLessThan(at('forest-row-work_1'))
    // ⚑ from the END of the holder's own opening tag, which carries its own `data-kind`
    const between = html.slice(
      html.indexOf('>', at('forest-row-sess_holder')),
      at('forest-row-work_1'),
    )
    expect(between, 'another card opens between the holder and its task').not.toMatch(
      /data-kind="a-conversation"/,
    )
    // ⚑ and the holder's card DRAWS a plate, so the task line's silence is covered by it
    expect(attr(plateIn(holder), 'data-doing')).toBeDefined()
  })

  it('⚠️ TeamForest · the CONTROL — with no wait, the same row says something else', async () => {
    // ⛔ Without this the word above could be a constant that happens to equal the wait's label.
    const holder = rowOf(await drawn(null), 'sess_holder')
    expect(saysIn(holder)).toBe(STANDING_LABEL.idle)
  })

  /* ── WorkingTogether · `said-only-by-its-mark` ────────────────────────────────────────────── */

  const walk = <Row>(rows: readonly Row[], kind: LedgerWalkKind): LedgerWalk<Row> => ({
    rows,
    walk: kind,
    ledgers: rows.length,
    rowsUnread: 0,
  })
  const spawn = (conversation: string): SpawnEdge =>
    ({
      conversation,
      identity: 'worker',
      provider: 'claude',
      running: 'unwatched',
    }) as SpawnEdge
  const edge = (piece: string, from: string, to: string, state: TaskState): WorkEdge =>
    ({
      piece,
      label: 'W1.1',
      title: 'read the brief',
      from,
      fromIdentity: 'default',
      to,
      toIdentity: 'worker',
      state,
      givenAt: NOW - 120_000,
      endedAt: null,
    }) as WorkEdge

  /** ⚑ Three plates that DIFFER, so an identity check cannot be passed by two faceless look-alikes. */
  const atWork = {
    readAt: NOW,
    conversations: [
      ['sess_child', 'working'],
      ['sess_other', 'idle'],
      ['sess_parent', 'idle'],
    ].map(([conversation, status]) => ({
      conversation,
      identity: 'worker',
      told: { said: 'nothing', because: 'no-activity-right-now' },
      status,
      streaming: false,
      since: NOW - 5_000,
    })),
  } as unknown as WhatIsBeingDone

  /**
   * ⚑ **Every wait the band's input CAN carry, planted** — a task's state is a `TaskState`, and the
   * three waits are `TaskState`s (`651`'s review, finding #7, which is what corrected this entry).
   */
  const reading: CastReading = {
    conversation: 'sess_me',
    answered: true,
    atWork,
    read: {
      conversation: 'sess_me',
      parent: spawn('sess_parent'),
      children: walk([spawn('sess_child')], 'every-conversation-this-one-spawned'),
      workGivenOut: walk(
        [
          edge('t_child', 'sess_me', 'sess_child', 'waiting-on-a-worker'),
          edge('t_other', 'sess_me', 'sess_other', 'waiting-on-a-person'),
        ],
        'every-conversation-this-one-gave-work-to',
      ),
      workTakenIn: walk(
        [
          edge('t_in', 'sess_parent', 'sess_me', 'waiting-on-an-answer'),
          // ⚠️ From a conversation this band holds no card for — its line must wear NO plate.
          edge('t_stranger', 'sess_stranger', 'sess_me', 'working'),
          // ⚑ A person's wait on a TAKEN line — THIS conversation's own, while the line's plate and
          // name are the giver's: its mark says it, as every line's does.
          edge('t_trap', 'sess_parent', 'sess_me', 'waiting-on-a-person'),
        ],
        'every-piece-of-work-this-one-was-given',
      ),
      readAt: NOW,
    } as WhoCalledWhom,
  }

  /**
   * ⚑ **The task lines, drawn by the component that draws them** — the work TAKEN in, as the agent
   * card draws it: the right panel's one list since UI-006, over the band's own fold.
   */
  const lines = (): Promise<string> => {
    const band = workingTogetherView({
      reading,
      forConversation: 'sess_me',
      identities: null,
      now: NOW,
    })!
    return renderToString(
      createSSRApp({
        render: () => h(TaskList, { tasks: band.taken, canOpen: false, mode: 'all' }),
      }),
    )
  }

  it('🔴 WorkingTogether · a task’s wait never reaches a PLATE, and each dot is its OWN card’s facets', () => {
    const input = { reading, forConversation: 'sess_me', identities: null, now: NOW }
    const band = workingTogetherView(input)!
    // ⚑ The parent's card is `parentCardOf`'s — the one the panel draws as the way up; the band
    // holds none of its own.
    const parent = parentCardOf(input)!
    // ⚑ The premises: the waits really are on the lines, and the plates really differ.
    expect(
      band.taken.some((line) => (TASK_WAITS as readonly string[]).includes(line.piece.state)),
    ).toBe(true)
    const given = [...band.children, ...band.others]
    expect(new Set(given.map((card) => card.facets.doing)).size).toBeGreaterThan(1)
    const taken = (id: string) => band.taken.find((line) => line.piece.piece === id)!
    // ⚠️ `toEqual`: the panel's parent card is a second call of the same fold, not the band's own.
    expect(taken('t_in').facets).toEqual(parent.facets)
    expect(taken('t_stranger').facets).toBeNull()
    // ⛔ **The declaration's own premise**: every wait above is on a task, and none is on a plate.
    for (const card of [...given, parent])
      expect(card.facets, card.conversation).not.toHaveProperty('waiting')
  })

  it('⚠️ WorkingTogether · the wait is said by the line’s MARK — its label and its title, not its visible text', async () => {
    const html = await lines()
    // ⚑ Each line up to its sentence, in the fold's order: `t_in`, `t_stranger`, `t_trap`.
    const rows = html
      .split('data-cy="cast-taken-work"')
      .slice(1)
      .map((row) => row.slice(0, row.indexOf('data-cy="cast-work-said"')))
    expect(rows, 'the taken lines were not drawn').toHaveLength(3)
    // ⚑ The CURRENT piece — the newest still open — is `t_trap`, the last line.
    const line = rows[2]!
    const mark = /<span[^>]*data-cy="cast-work-mark"[^>]*>([^<]*)</.exec(line)
    const word = WORK_STATE_WORD['waiting-on-a-person']
    expect(mark?.[0]).toContain(`aria-label="${word}"`)
    expect(mark?.[0]).toContain(`title="${word}"`)
    // 🔴 **And this is the weakness the declaration names rather than hides**: the MARK is the shape
    // alone — `631`'s ruled line grammar.
    expect(mark?.[1]).toBe('○')
    // The current piece’s pill includes its state beside the mark. Hide the repeated word
    // from screen readers, which hear the state once through the mark.
    expect(line).toMatch(new RegExp(`<span class="tword" aria-hidden="true"[^>]*>${word}<`))
    // ⛔ **The dot this file declares for `TaskList` is the GIVER's** — on the line the parent gave,
    // whose card the band holds…
    expect(rows[0]).toContain('data-dot="true"')
    // ⚑ …and none, in the same render, on the line from a giver the band holds no card for.
    expect(rows[1]).not.toContain('data-cy="agent-state"')
  })

  /**
   * ⛔ **A conversation-level wait SOURCE cannot be wired into the band without retaking this entry.**
   *
   * ⚠️ **Scoped precisely, because the first version overclaimed** (`651`'s review, #9/#22/#23): the
   * band's input legitimately carries waits as TASK STATES — a `TaskState` is wider than `TaskWait`,
   * so a task state is not flagged, and that is correct: those waits are said by the mark. ⚑ What
   * IS flagged, at any depth to five: a field the waits READING (`636`'s per-conversation source)
   * could be assigned to, or a field NARROWER than `TaskWait`. 🔴 Either appearing anywhere in the
   * input fails `typecheck`. ⚠️ It does not see a wait in a shape that is neither — a `Map` of waits,
   * a `Record` keyed by conversation — and says so here rather than claiming it.
   */
  type WaitPaths<T, Depth extends unknown[] = []> = Depth['length'] extends 5
    ? never
    : {
        [K in keyof T & string]-?: WhatEachConversationIsWaitingOn extends NonNullable<T[K]>
          ? K
          : NonNullable<T[K]> extends TaskWait
            ? K
            : NonNullable<T[K]> extends readonly (infer Row)[]
              ? `${K}[].${WaitPaths<Row, [...Depth, 0]>}`
              : NonNullable<T[K]> extends object
                ? `${K}.${WaitPaths<NonNullable<T[K]>, [...Depth, 0]>}`
                : never
      }[keyof T & string]

  it('🔴 WorkingTogether · no per-conversation wait source reaches the band’s input, at any depth', () => {
    expectTypeOf<WaitPaths<WorkingTogetherInput>>().toBeNever()
    // ⚑ **The positive controls, one per arm and one per depth** — this is not a type that answers
    // `never` for everything.
    expectTypeOf<WaitPaths<Parameters<typeof forestView>[0]>>().toEqualTypeOf<'waits'>()
    expectTypeOf<
      WaitPaths<{ readonly reading: { readonly waits: WhatEachConversationIsWaitingOn | null } }>
    >().toEqualTypeOf<'reading.waits'>()
    expectTypeOf<
      WaitPaths<{
        readonly rows: readonly { readonly waiting?: TaskWait; readonly name: string }[]
      }>
    >().toEqualTypeOf<'rows[].waiting'>()
  })
})

/* ──────────────────────────────────────────────────────────────────────────────────────────── §4 */

/**
 * ⚑ A planted SFC — the census's own reader run over a file that does not exist in the app.
 *
 * ⚠️ **The template is wrapped in a `<div>`** so a planted plate is NOT at the template root — a
 * root-level plate is refused outright (see `plateCallSite`), and a fixture that tripped that rule
 * would be testing it by accident. `plantedAt` is for the fixtures that mean to.
 */
const plantedAt = (
  template: string,
  imports = "import AgentState from './AgentState.vue'",
): string =>
  `<script setup lang="ts">\n${imports}\n</script>\n\n<template>\n${template}\n</template>\n`
const planted = (template: string, script = ''): string =>
  plantedAt(`<div>\n${template}\n</div>`, `import AgentState from './AgentState.vue'\n${script}`)

/** ⚑ Whether a planted site would turn §1 red — the same two predicates §1 asserts over the roster. */
const refusedBySection1 = (site: PlateCallSite): boolean =>
  (site.imports && site.tags.length === 0) ||
  (!site.imports && site.tags.length > 0) ||
  site.tags.some((tag) => 'refused' in tag.size)

describe('§4 · the census FAILS on a planted violation, and passes the controls beside it', () => {
  it('🔴 a NEW dot that spreads a wait, with no word, is found — and the census goes red', () => {
    // ⛔ **`651` §5.1, hermetically**: the exact call site `645` §3.4 said nothing would catch.
    const site = plateCallSite(
      'components/Planted.vue',
      planted('  <li><AgentState size="dot" v-bind="row.facets" :label="row.name" /></li>'),
    )
    expect(site.tags).toEqual([
      { line: expect.any(Number), size: { px: SIZES.dot }, spread: 'row.facets' },
    ])
    const withIt = new Map(ROSTER).set('components/Planted.vue', site)
    expect(dotsIn(withIt)).not.toEqual(DECLARED)
    expect(dotsIn(withIt)['components/Planted.vue']).toBe(1)
  })

  it('⛔ …and a second dot added to an ALREADY-declared file is found too', () => {
    // ⚑ **668 · the band, since the forest has no dot left to add to** — its task lines, which
    // `TaskList` draws.
    const bandSource = SOURCES[`${PREFIX}components/TaskList.vue`]!
    // ⚑ Inside the first `<li>`, so the plant is a real nested call site and not a root one.
    const grown = bandSource.replace(
      '<li',
      '<li><AgentState size="dot" :doing="\'idle\'" /></li><li',
    )
    expect(grown).not.toBe(bandSource)
    const withIt = new Map(ROSTER).set(
      'components/TaskList.vue',
      plateCallSite('TaskList.vue', grown),
    )
    expect(dotsIn(withIt)['components/TaskList.vue']).toBe(
      DOTS['components/TaskList.vue'].count + 1,
    )
  })

  it('🔴 every spelling Vue renders as the plate is COUNTED as one — `651`’s review found three it missed', () => {
    const dots = (template: string): number =>
      plateCallSite('X.vue', planted(template)).tags.filter(isDot).length
    expect(dots('  <agent-state size="dot" />')).toBe(1)
    expect(dots('  <agentState size="dot" />')).toBe(1)
    expect(dots('  <Agent-State size="dot" />')).toBe(1)
    expect(dots('  <component :is="AgentState" size="dot" />')).toBe(1)
    expect(dots('  <component is="AgentState" size="dot" />')).toBe(1)
    // ⚠️ **And the one spelling that is NOT a plate**: inside `v-pre`, Vue renders the tag as inert
    // HTML — the node-type pin, `tagType`, is what tells the two apart.
    expect(dots('  <div v-pre><AgentState size="dot" /></div>')).toBe(0)
  })

  it('🔴 a plate the file has no RECOGNISED import for is refused, never dropped', () => {
    // ⛔ **`651`'s review, finding #1**: these three shapes each rendered a real 16px dot and fell out
    // of the first version's roster entirely, with every assertion green.
    const shapes = {
      'a named default': "import { default as AgentState } from './AgentState.vue'",
      'a barrel': "import { AgentState } from './index'",
      'an async component':
        "import { defineAsyncComponent } from 'vue'\nconst AgentState = defineAsyncComponent(() => import('./AgentState.vue'))",
    }
    for (const [shape, imports] of Object.entries(shapes)) {
      const site = plateCallSite(
        'X.vue',
        plantedAt('<div><AgentState size="dot" /></div>', imports),
      )
      expect(site.tags.filter(isDot), shape).toHaveLength(1)
      // ⚑ Two of the three are now recognised imports; the barrel is not — and it is REFUSED by §1
      // rather than silently dropped, which is the direction that matters.
      expect(site.imports || refusedBySection1(site), shape).toBe(true)
    }
    expect(
      refusedBySection1(
        plateCallSite(
          'X.vue',
          plantedAt('<div><AgentState size="dot" /></div>', shapes['a barrel']),
        ),
      ),
    ).toBe(true)
  })

  it('⛔ a plate at the template ROOT is refused — its size would be its caller’s', () => {
    const site = plateCallSite('X.vue', plantedAt('<AgentState size="compact" />'))
    expect(site.tags).toHaveLength(1)
    expect('refused' in site.tags[0]!.size).toBe(true)
    expect(refusedBySection1(site)).toBe(true)
  })

  it('⚠️ the CONTROLS — a plate at the floor is not a dot, and a dot in PROSE is not a call site', () => {
    const compact = plateCallSite(
      'C.vue',
      planted('  <AgentState size="compact" v-bind="facets" />'),
    )
    expect(compact.tags).toHaveLength(1)
    expect(isDot(compact.tags[0]!)).toBe(false)
    expect(refusedBySection1(compact)).toBe(false)
    // ⛔ **An HTML comment, a script comment and a string literal, each quoting a dot call site** —
    // the three places a docblock like this file's own puts one. None is a tag.
    const prose = plateCallSite(
      'P.vue',
      planted(
        '  <!-- a <AgentState size="dot" v-bind="x" /> in a comment -->\n  <p>see AgentState</p>',
        '// <AgentState size="dot" v-bind="x" />\nconst quoted = \'<AgentState size="dot" />\'',
      ),
    )
    expect(prose.tags).toEqual([])
    expect(prose.imports).toBe(true)
  })

  it('⛔ a size the reader cannot evaluate is REFUSED, and every form it can evaluate is read', () => {
    const sizes = (template: string, script = ''): Size[] =>
      plateCallSite('S.vue', planted(template, script)).tags.map((tag) => tag.size)
    expect(sizes('  <AgentState :size="16" />')).toEqual([{ px: 16 }])
    expect(sizes('  <AgentState :size="\'dot\'" />')).toEqual([{ px: SIZES.dot }])
    expect(sizes('  <AgentState :size="TINY" />', 'const TINY = 12')).toEqual([{ px: 12 }])
    expect(sizes('  <AgentState />')).toEqual([{ px: platePx(undefined) }])
    // ⛔ The fail-closed half: a computed size, and a size name that does not exist.
    const refused = sizes("  <AgentState :size=\"dense ? 'dot' : 'compact'\" />")
    expect(refused).toHaveLength(1)
    expect('refused' in refused[0]!).toBe(true)
    expect('refused' in sizes('  <AgentState size="tiny" />')[0]!).toBe(true)
  })

  it('🔴 the import’s LOCAL name is what is searched for — a renamed import hides nothing', () => {
    // ⚑ Also what pins the node-type constants: this tag is only found if ELEMENT, the component
    // `tagType`, ATTRIBUTE and DIRECTIVE are the numbers this file wrote down — a renumbering in Vue
    // empties `tags` here.
    const renamed = plateCallSite(
      'R.vue',
      plantedAt(
        '<div>\n  <Plate size="dot" v-bind="f" />\n  <plate :size="16" />\n</div>',
        "import Plate from './AgentState.vue'",
      ),
    )
    expect(renamed.imports).toBe(true)
    expect(renamed.tags.map((tag) => [tag.size, tag.spread])).toEqual([
      [{ px: SIZES.dot }, 'f'],
      [{ px: 16 }, null],
    ])
  })
})
