import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/**
 * Read instrument constants from the app's source instead of restating their values.
 * Plain `.mjs` tools cannot import desktop TypeScript directly. A shared reader keeps
 * source renames visible and avoids silently diverging copies.
 * `session-info-probe.mjs` also has a local reader; its source-text assertions must be
 * updated together if it is switched to this helper.
 */

const DESKTOP = join(dirname(fileURLToPath(import.meta.url)), '../../apps/desktop')

/**
 * Where each derivable constant is declared, so a move is a stop rather than a wrong answer.
 *
 * The launch default is read from the shared provider registry. The component and the
 * instruments therefore follow the same declaration when a default changes.
 */
const DECLARED_IN = {
  WORKSPACE_CANARY: 'src/main/runtime/workspace.ts',
  WORKSPACE_DIRNAME: 'src/main/runtime/workspace.ts',
  CLAUDE_INSTRUCTIONS_FILE: 'src/main/runtime/workspace.ts',
  CODEX_INSTRUCTIONS_FILE: 'src/main/runtime/workspace.ts',
  DEFAULT_PROVIDER: '../../packages/shared/src/providers.ts',
  ASKED_TO_STOP: 'src/shared/how-work-stopped.ts',
  DEFAULT_PROFILE_ID: 'src/shared/runtime-ipc.ts',
  PROVIDER_HOMES_DIRNAME: 'src/main/runtime/provider-homes.ts',
  HOME_FOLDER: 'src/main/runtime/provider-homes.ts',
}

/**
 * The declaration shapes {@link constantFrom} can read, tried in order.
 *
 * ⛔ **Both anchor on `const <name>`**, so neither can match a mention in prose, an import, or a
 * property of the same name on some object. ⚠️ The second is deliberately narrower than "any
 * assignment": it allows an optional type annotation and nothing else, because a reader that
 * accepted arbitrary text before the `=` would match a line of commentary quoting the constant.
 */
const SPELLINGS = [
  (name) => new RegExp(`export const ${name} = '([^']+)'`),
  (name) => new RegExp(`\\bconst ${name}(?:: [A-Za-z<>\\[\\]| ]+)? = '([^']+)'`),
]

/**
 * The value of an `export const <name> = '<literal>'` in the app's source.
 *
 * ⛔ **A miss THROWS rather than answering `undefined`.** A constant that quietly became
 * `undefined` turns an assertion into `includes(undefined)` — a check that cannot fire, which is
 * worse than no check because it is green. Every caller here uses the value to build a path or to
 * recognise a string, so there is no safe default to fall back to.
 *
 * @param {keyof typeof DECLARED_IN} name
 */
export function constantFrom(name) {
  const where = DECLARED_IN[name]
  if (where === undefined) {
    throw new Error(
      `⛔ ${name} has no declared home in app-source.mjs — add it to DECLARED_IN beside the file ` +
        `that exports it, so the next reader can see where the value comes from.`,
    )
  }
  const source = join(DESKTOP, where)
  const text = readFileSync(source, 'utf8')
  if (name === 'DEFAULT_PROVIDER') return providerDefaultFrom(text)
  let found
  for (const spelling of SPELLINGS) {
    found = text.match(spelling(name))?.[1]
    if (found !== undefined) break
  }
  if (!found) {
    throw new Error(
      `⛔ ${name} is not readable from ${source} as a single-quoted string literal. This is ` +
        `derived from the code instead of restated, so a declaration it cannot read is a stop ` +
        `rather than a default.`,
    )
  }
  return found
}

/** Read the registry's default without evaluating app code or matching comments. */
export function providerDefaultFrom(source, kind = 'conversation') {
  const tree = ts.createSourceFile('providers.ts', source, ts.ScriptTarget.Latest, true)
  const declaration = tree.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => statement.declarationList.declarations)
    .find((entry) => ts.isIdentifier(entry.name) && entry.name.text === 'PROVIDER_DESCRIPTORS')
  let array = declaration?.initializer
  while (
    array &&
    (ts.isAsExpression(array) ||
      ts.isSatisfiesExpression(array) ||
      ts.isParenthesizedExpression(array))
  ) {
    array = array.expression
  }
  if (!array || !ts.isArrayLiteralExpression(array)) {
    throw new Error('The provider registry is not a readable array declaration.')
  }
  const property = (object, key) => {
    if (!ts.isObjectLiteralExpression(object)) return undefined
    return object.properties.find(
      (entry) =>
        ts.isPropertyAssignment(entry) &&
        (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
        entry.name.text === key,
    )?.initializer
  }
  const defaults = []
  for (const row of array.elements) {
    const id = property(row, 'id')
    const flags = property(row, 'defaults')
    const flag = flags && property(flags, kind)
    if (
      !id ||
      !ts.isStringLiteral(id) ||
      !flag ||
      ![ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword].includes(flag.kind)
    ) {
      throw new Error('The provider registry has an unreadable id or default flag.')
    }
    if (flag.kind === ts.SyntaxKind.TrueKeyword) defaults.push(id.text)
  }
  if (defaults.length !== 1) throw new Error(`Expected one default provider for ${kind}.`)
  return defaults[0]
}

/**
 * 🔴 **722 · the provider's OWN sub-agent tools**, the names `ui-live-smoke.mjs` steps 57, 58 and
 * 80 look for in a launch. ⚑ **Written here, and the one value in this module that is not read
 * from the app**: every launch keeps these tools, so no app source declares a list of them to read.
 * ⚠️ They span what init lists and what the model calls: `system/init` lists the sub-agent tool as
 * `Task`, and the model calls that tool `Agent` (`722`'s batch, step 58 beside 80). Pinned by
 * `front-door.test.mjs`.
 */
export function nativeDelegationTools() {
  return ['Agent', 'Workflow', 'Task']
}

/**
 * 🔴 **BroBot's own workspace — where a FRONT-DOOR conversation runs, full stop.**
 *
 * ⚠️ **This docblock used to carry a condition, and `424` removed it.** It read *"when, and ONLY
 * when, the pinned project has no folder"*, which was `420` §0's measurement of a host that handed
 * a front-door conversation whatever somebody had typed into the project sheet. ⚑ Since D-016 there
 * are no projects: a launch that names no folder runs here, whoever it runs as.
 *
 * @param {string} userDataDir the `--user-data-dir` the app under test was launched with.
 */
export function brobotWorkspace(userDataDir) {
  if (typeof userDataDir !== 'string' || userDataDir === '') {
    throw new Error(
      'brobotWorkspace: the workspace is under a specific userData directory — an instrument ' +
        'that does not know which app it launched cannot name it',
    )
  }
  return join(userDataDir, constantFrom('WORKSPACE_DIRNAME'))
}

/**
 * 🔴 **What the PLACED door sends, lifted out of the component rather than written down here**
 * (`427` §3, `423` relay 1).
 *
 * ⛔ **The same rule `420` applied to the front door's payload**: *"the payload the test sends is
 * DERIVED from `NewConversation.vue`, not restated"*. `StartAsAgent.vue` is the surface a person
 * presses to place a conversation, and the count an instrument prints about *"how much is still
 * waiting on the interim door"* is only true while this list is what the surface really sends.
 *
 * ⚠️ **`approvalMode` is in the list and is not free.** The sheet sends the literal `'ask'`, so a
 * placement asking for `'auto'` is NOT something this door can carry —
 * {@link whatThePlacedDoorCannotCarry} is where that distinction lives, because it needs the
 * VALUE and this function only knows the shape.
 *
 * ⛔ **A shape it cannot read is a STOP.** An empty field list would make every placement look
 * movable, which is the direction that flatters the product.
 *
 * @returns {string[]} the field names, in source order.
 */
export function placedDoorSends() {
  const source = readFileSync(join(DESKTOP, 'src/renderer/src/components/StartAsAgent.vue'), 'utf8')
  const at = source.indexOf("emit(\n    'start',\n    {")
  if (at === -1) {
    throw new Error(
      '⛔ StartAsAgent.vue no longer emits `start` with an object literal this can read. The ' +
        "placed door's payload is derived from the component on purpose — a restated list would " +
        'go on being true after the component stopped agreeing with it.',
    )
  }
  const open = source.indexOf('{', at)
  let depth = 0
  let close = open
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) {
        close = i
        break
      }
    }
  }
  const fields = fieldsOf(source.slice(open + 1, close))
  if (fields.length === 0) {
    throw new Error('⛔ StartAsAgent.vue’s start payload read as empty — refusing to answer.')
  }
  return fields
}

/**
 * The top-level keys of an object literal's body, in source order.
 *
 * ⛔ **Block comments are stripped and line comments deliberately are NOT**
 * (`a-source-census-must-strip-prose-before-it-asserts`, and the half of it that does not apply
 * here). A `//` line can never be mistaken for a field: the pattern wants an identifier character
 * straight after the indent and `/` is not one, so a filter for it would be a line no mutation
 * could kill (`a-line-no-mutation-can-kill-is-not-carrying-its-rule` — it was written, measured
 * as a no-op, and removed). ⚠️ **A BLOCK comment's inner line can be anything at all**, and this
 * repo's literals are full of them: `StartAsAgent.vue`'s own payload carries a four-line note
 * about `approvalMode` today, and the day somebody writes *"projectSlug: removed at 431"* inside
 * a `/* … *\/` the reader would count a field the component no longer sends.
 *
 * ⚑ **D-016 · a field sent only when it has a value is a field it sends.** This wire's idiom for
 * an optional field is a conditional spread — `...(folder.value === null ? {} : { cwd: … })` in
 * `StartAsAgent.vue` — and a reader that saw only `key:` lines would report the sheet's folder as
 * a field no surface carries. ⚠️ So a spread line counts its one key, on either arm and in either
 * spelling (`{ cwd: x }` or the shorthand `{ cwd }`); a spread of anything else names no key here.
 *
 * ⚑ **Exported so that rule has a test**: the literal this reads in production is a real
 * component, which cannot have a fixture planted in it.
 *
 * @param {string} body everything between the literal's braces
 * @returns {string[]}
 */
export function fieldsOf(body) {
  return [
    ...body
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .matchAll(
        /^\s+(?:([A-Za-z_$][\w$]*):|\.\.\.\([^\n]*?\?\s*(?:\{\s*\}\s*:\s*)?\{\s*([A-Za-z_$][\w$]*)\s*[:,}])/gm,
      ),
  ].map((m) => m[1] ?? m[2])
}

/**
 * 🔴 **A design token's VALUE, read out of `tokens.css`'s `:root`** (`427` §3).
 *
 * ⛔ **`ui-live-smoke.mjs` step `1c` had `#7dbbff` written into it, and the app draws `#a7b7ff`.**
 * The token moved with design v2; `chat-theme.test.ts:493` pins the new value in the gate, so the
 * gate and the live instrument disagreed about one constant and the live half reported *"the token
 * layer is not loaded"* — an app-shaped red about a stylesheet that is perfectly fine. ⚑ Same class
 * as `420` F4's step `69`, one line over, and the same remedy standing rule 1 names: derive it.
 *
 * ⚠️ **`:root` and nothing else.** The file also declares tokens under `[data-on-white]` and inside
 * two width media queries; a reader that took the LAST declaration would answer with whatever a
 * narrow-window override happens to say. The app under test runs in the dark scope, which is
 * `:root` — the same block `chat-theme.test.ts` calls `DARK`.
 *
 * @param {string} name the custom property, including the leading `--`.
 */
export function themeTokenFrom(name) {
  const text = readFileSync(join(DESKTOP, 'src/renderer/src/assets/tokens.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ' ',
  )
  const at = text.indexOf(':root {')
  if (at === -1) throw new Error('⛔ tokens.css has no `:root {` block this can read.')
  const block = text.slice(at, text.indexOf('\n}', at))
  const found = new RegExp(`(?:^|[;{\\s])${name}\\s*:\\s*([^;]+);`).exec(block)?.[1]
  if (found === undefined) {
    throw new Error(
      `⛔ ${name} is not declared in tokens.css's :root block. This is derived from the stylesheet ` +
        `instead of restated, so a token it cannot read is a stop rather than a default.`,
    )
  }
  return found.trim()
}
