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
  CLAUDE_INSTRUCTIONS_FILE: 'src/main/providers/claude/layout.mjs',
  CODEX_INSTRUCTIONS_FILE: 'src/main/providers/codex/layout.mjs',
  DEFAULT_PROVIDER: '../../packages/shared/src/providers.ts',
  ASKED_TO_STOP: 'src/shared/how-work-stopped.ts',
  DEFAULT_PROFILE_ID: 'src/shared/runtime-ipc.ts',
  PROVIDER_HOMES_DIRNAME: 'src/main/connections/homes.ts',
  HOME_FOLDER: 'src/main/connections/homes.ts',
}

/**
 * The declaration shapes {@link constantFrom} can read, tried in order.
 *
 * Both anchor on `const <name>`, so neither matches a mention in prose, an import, or a property of
 * the same name. The second allows an optional type annotation and nothing else, so a line of
 * commentary quoting the constant cannot match.
 */
const SPELLINGS = [
  (name) => new RegExp(`export const ${name} = '([^']+)'`),
  (name) => new RegExp(`\\bconst ${name}(?:: [A-Za-z<>\\[\\]| ]+)? = '([^']+)'`),
]

/**
 * The value of an `export const <name> = '<literal>'` in the app's source.
 *
 * A miss throws rather than answering `undefined`: a constant that quietly became `undefined` turns
 * an assertion into `includes(undefined)`, a check that cannot fire and is green. Every caller uses
 * the value to build a path or recognise a string, so there is no safe default.
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

function descriptorRowsFrom(source) {
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
  return array.elements
}

function descriptorProperty(object, key) {
  if (!ts.isObjectLiteralExpression(object)) return undefined
  return object.properties.find(
    (entry) =>
      ts.isPropertyAssignment(entry) &&
      (ts.isIdentifier(entry.name) || ts.isStringLiteral(entry.name)) &&
      entry.name.text === key,
  )?.initializer
}

/** Read the registry's default without evaluating app code or matching comments. */
export function providerDefaultFrom(source, kind = 'conversation') {
  const defaults = []
  for (const row of descriptorRowsFrom(source)) {
    const id = descriptorProperty(row, 'id')
    const flags = descriptorProperty(row, 'defaults')
    const flag = flags && descriptorProperty(flags, kind)
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

/** Literal ids and display names in the same order as the app's provider registry. */
export function providerRosterFrom(source) {
  const seen = new Set()
  const roster = descriptorRowsFrom(source).map((row) => {
    const id = descriptorProperty(row, 'id')
    const name = descriptorProperty(row, 'displayName')
    if (
      !id ||
      !ts.isStringLiteral(id) ||
      !id.text ||
      seen.has(id.text) ||
      !name ||
      !ts.isStringLiteral(name) ||
      !name.text
    ) {
      throw new Error('The provider registry has an unreadable or duplicate roster entry.')
    }
    seen.add(id.text)
    return { provider: id.text, name: name.text }
  })
  if (roster.length === 0) throw new Error('The provider registry has no roster entries.')
  return roster
}

export function providerRoster() {
  return providerRosterFrom(readFileSync(join(DESKTOP, DECLARED_IN.DEFAULT_PROVIDER), 'utf8'))
}

/**
 * The provider's own sub-agent tools, the names `ui-live-smoke.mjs` looks for in a launch. This is
 * the one value in this module not read from the app: every launch keeps these tools, so no app
 * source declares a list of them. They span what init lists and what the model calls: `system/init`
 * lists the sub-agent tool as `Task`, and the model calls it `Agent`. Pinned by
 * `front-door.test.mjs`.
 */
export function nativeDelegationTools() {
  return ['Agent', 'Workflow', 'Task']
}

/**
 * A profile's own home, where its conversations run when a launch names no folder.
 *
 * @param {string} userDataDir the `--user-data-dir` the app under test was launched with.
 * @param {string} profileId the profile whose home it is.
 */
export function profileHome(userDataDir, profileId) {
  if (typeof userDataDir !== 'string' || userDataDir === '') {
    throw new Error(
      'profileHome: the home is under a specific userData directory — an instrument ' +
        'that does not know which app it launched cannot name it',
    )
  }
  return join(
    userDataDir,
    constantFrom('PROVIDER_HOMES_DIRNAME'),
    constantFrom('HOME_FOLDER'),
    profileId,
  )
}

/**
 * What the placed door sends, lifted out of `NewConversation.vue` rather than written down here, so the
 * count an instrument prints about the interim door stays true to what the surface sends.
 *
 * The Team entry inherits the saved approval mode. The field is present even though the sheet
 * does not offer a mode selector.
 *
 * A shape it cannot read is a stop: an empty field list would make every placement look movable.
 *
 * @returns {string[]} the field names, in source order.
 */
export function placedDoorSends() {
  return placedDoorSendsFrom(
    readFileSync(join(DESKTOP, 'src/renderer/src/components/NewConversation.vue'), 'utf8'),
  )
}

/** Read the emitted object, including a local constant shared with the awaited submit path. */
export function placedDoorSendsFrom(source) {
  const script = source.match(/<script\b[^>]*\bsetup\b[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? source
  const tree = ts.createSourceFile('NewConversation.ts', script, ts.ScriptTarget.Latest, true)
  let payload
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'emit' &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === 'start'
    ) {
      let value = node.arguments[1]
      const computedValue =
        value && ts.isPropertyAccessExpression(value) && value.name.text === 'value'
      const identifier = computedValue ? value.expression : value
      if (identifier && ts.isIdentifier(identifier)) {
        value = undefined
        for (let scope = node.parent; scope; scope = scope.parent) {
          if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue
          const binding = scope.statements
            .filter(ts.isVariableStatement)
            .flatMap((statement) => [...statement.declarationList.declarations])
            .find(
              (declaration) =>
                ts.isIdentifier(declaration.name) && declaration.name.text === identifier.text,
            )
          if (!binding) continue
          if (binding.parent.flags & ts.NodeFlags.Const) value = binding.initializer
          break
        }
        if (computedValue) {
          const computed =
            value &&
            ts.isCallExpression(value) &&
            ts.isIdentifier(value.expression) &&
            value.expression.text === 'computed'
          const getter = computed ? value.arguments[0] : undefined
          value = getter && ts.isArrowFunction(getter) ? getter.body : undefined
          if (value && ts.isParenthesizedExpression(value)) value = value.expression
        }
      }
      if (!value || !ts.isObjectLiteralExpression(value)) {
        throw new Error('The launcher start payload is not an object literal or a constant object')
      }
      payload = value
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  if (!payload) throw new Error('NewConversation.vue has no readable start payload')
  const fields = fieldsOf(script.slice(payload.getStart(tree) + 1, payload.end - 1))
  if (fields.length === 0) {
    throw new Error('⛔ NewConversation.vue’s start payload read as empty — refusing to answer.')
  }
  return fields
}

/**
 * The top-level keys of an object literal's body, in source order.
 *
 * Block comments are stripped and line comments deliberately are not: a `//` line can never be
 * mistaken for a field (the pattern wants an identifier character straight after the indent), so a
 * filter for it would be a line no mutation could kill. A block comment's inner line can be anything,
 * and a note like "projectSlug: removed" inside one would count a field the component no longer
 * sends.
 *
 * A field sent only when it has a value is a field it sends: the wire's idiom for an optional field
 * is a conditional spread, `...(folder.value === null ? {} : { cwd: ... })` in `NewConversation.vue`.
 * So a spread line counts its one key, on either arm and in either spelling (`{ cwd: x }` or
 * `{ cwd }`); a spread of anything else names no key here.
 *
 * Exported so that rule has a test: the literal this reads in production is a real component, which
 * cannot have a fixture planted in it.
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
 * A design token's value, read out of `tokens.css`'s `:root`, so the live instrument cannot drift
 * from what the app draws (`chat-theme.test.ts:493` pins the value in the gate).
 *
 * `:root` and nothing else: the file also declares tokens under `[data-on-white]` and inside two
 * width media queries, and a reader that took the last declaration would answer with a narrow-window
 * override. The app under test runs in the dark scope, which is `:root`, the block
 * `chat-theme.test.ts` calls `DARK`.
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
