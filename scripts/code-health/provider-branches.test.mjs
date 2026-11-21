import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = (file) => readFileSync(new URL('../../' + file, import.meta.url), 'utf8')
const sourceRoot = 'apps/desktop/src/'
const code = /\.(?:[cm]?[jt]s|[jt]sx|vue|sql)$/
const tests = /(?:\.(?:test|spec)\.|(?:^|\/)(?:__tests__|__fixtures__|__mocks__|test)\/)/
const compatibility = 'read-by-codex'
const interpolation = 5
const directive = 7
const printer = ts.createPrinter({ removeComments: true })
const equality = new Set([
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
])

// Each entry permits one occurrence of this expression in its named file.
const exceptions = [
  [
    'main/connections/catalogues.ts',
    'provider === DEFAULT_CONVERSATION_PROVIDER',
    'Audit 512–521: deliberate BroBot unnamed-start effort default.',
  ],
  [
    'main/runtime/runtime-host.ts',
    "provider !== 'codex'",
    'Temporary W14.44: automatic newer sign-in copy. Remove when provider operations decide.',
  ],
  [
    'main/runtime/what-this-agent-was-given.ts',
    "case 'read-by-codex'",
    'Card 47: interpret the origin of a previously stored file kind.',
  ],
  [
    'main/runtime/what-this-agent-was-given.ts',
    "kind === 'read-by-codex'",
    'Card 47: preserve the heading behavior of a previously stored file kind.',
  ],
  [
    'main/db/migrations/0004_no_stream_fragments.sql',
    "json_extract(`payload`, '$.provider') = 'claude'",
    'Historical stream cleanup: preserve non-Claude events.',
  ],
  [
    'main/db/migrations/0000_the_tree.sql',
    '"identity_memory_amendment"."provider" in (\'claude\', \'codex\')',
    'Card 66: frozen original memory amendment schema.',
  ],
  [
    'main/db/migrations/0000_the_tree.sql',
    '"provider_session"."provider" in (\'claude\', \'codex\')',
    'Card 66: frozen original session schema.',
  ],
  [
    'main/db/migrations/0017_memory_restoration.sql',
    "`provider` in ('claude', 'codex')",
    'Card 66: frozen memory restoration schema.',
  ],
  [
    'main/db/migrations/0018_memory_recovery.sql',
    "`provider` in ('claude', 'codex')",
    'Card 66: frozen memory recovery schema.',
  ],
]

function unwrap(node) {
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression
  }
  return node
}

function providerValue(node) {
  node = unwrap(node)
  if (ts.isPropertyAccessExpression(node)) node = node.name
  if (ts.isElementAccessExpression(node)) {
    node = node.argumentExpression
    if (!ts.isStringLiteralLike(node)) return false
  }
  return (
    (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) &&
    /(?:^provider$|Provider(?:Id)?$|^providerId$|^provider_id$)/i.test(node.text)
  )
}

function providerNames() {
  const file = 'packages/shared/src/providers.ts'
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest)
  const declaration = source.statements
    .filter(ts.isVariableStatement)
    .flatMap((statement) => [...statement.declarationList.declarations])
    .find(({ name }) => ts.isIdentifier(name) && name.text === 'PROVIDER_DESCRIPTORS')
  assert.ok(declaration?.initializer, 'Find PROVIDER_DESCRIPTORS in the shared registry.')
  const descriptors = unwrap(declaration.initializer)
  assert.ok(ts.isArrayLiteralExpression(descriptors) && descriptors.elements.length > 0)
  return new Set(
    descriptors.elements.map((descriptor) => {
      assert.ok(ts.isObjectLiteralExpression(descriptor))
      const id = descriptor.properties.find(
        (property) => ts.isPropertyAssignment(property) && property.name.getText(source) === 'id',
      )
      assert.ok(id && ts.isStringLiteralLike(id.initializer), 'Give each provider a literal id.')
      return id.initializer.text
    }),
  )
}

function scriptFindings(file, text, names, lineOffset = 0) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const findings = []
  const named = (node) => {
    node = unwrap(node)
    return (
      (ts.isStringLiteralLike(node) && names.has(node.text)) ||
      (ts.isIdentifier(node) && node.text === 'DEFAULT_CONVERSATION_PROVIDER')
    )
  }
  const legacyKind = (node) => {
    node = unwrap(node)
    return ts.isStringLiteralLike(node) && node.text === compatibility
  }
  const record = (node, expression = printer.printNode(ts.EmitHint.Unspecified, node, source)) => {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    findings.push({ line: lineOffset + line + 1, expression })
  }
  const visit = (node) => {
    if (ts.isBinaryExpression(node) && equality.has(node.operatorToken.kind)) {
      const { left, right } = node
      if (
        (providerValue(left) && named(right)) ||
        (providerValue(right) && named(left)) ||
        legacyKind(left) ||
        legacyKind(right)
      )
        record(node)
    }
    if (ts.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause)) continue
        if (
          (providerValue(node.expression) && named(clause.expression)) ||
          legacyKind(clause.expression)
        ) {
          record(
            clause,
            'case ' + printer.printNode(ts.EmitHint.Expression, clause.expression, source),
          )
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'includes' &&
      node.arguments.length &&
      providerValue(node.arguments[0])
    ) {
      const list = unwrap(node.expression.expression)
      if (ts.isArrayLiteralExpression(list) && list.elements.some(named)) record(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return findings
}

function vueFindings(file, text, names) {
  const { descriptor, errors } = parse(text, { filename: file })
  assert.deepEqual(errors, [], file)
  const findings = []
  const scan = (content, line, lang) => {
    findings.push(...scriptFindings(file + '.' + lang, content, names, line - 1))
  }
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block) scan(block.content, block.loc.start.line, block.lang ?? 'js')
  }
  const visit = (node) => {
    if (!node) return
    if (node.type === interpolation)
      scan('(' + node.content.content + ')', node.content.loc.start.line, 'ts')
    for (const prop of node.props ?? []) {
      if (prop.type !== directive) continue
      if (!prop.arg?.isStatic && prop.arg)
        scan('(' + prop.arg.content + ')', prop.arg.loc.start.line, 'ts')
      if (prop.exp && prop.name !== 'for' && prop.name !== 'slot') {
        const { content, loc } = prop.exp
        scan(prop.name === 'on' ? content : '(' + content + ')', loc.start.line, 'ts')
      }
    }
    for (const child of node.children ?? []) visit(child)
  }
  visit(descriptor.template?.ast)
  return findings
}

function sqlFindings(text, names) {
  const lexemes =
    /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|`[^`]*`|"(?:""|[^"])*"|\[[^\]]*\]|[a-z_][\w]*|==|!=|<>|[^\s]/gi
  const tokens = [...text.matchAll(lexemes)].filter(([token]) => !/^(?:--|\/\*)/.test(token))
  const values = tokens.map(([token]) => token)
  const sqlProvider = /^(?:provider|"provider"|`provider`|\[provider\])$/i
  const named = (token) => token?.startsWith("'") && names.has(token.slice(1, -1))
  const compare = new Set(['=', '==', '!=', '<>'])
  const findings = []
  const between = (start, end) =>
    text.slice(tokens[start].index, tokens[end].index + values[end].length)
  const record = (start, end) => {
    const expression = between(start, end).replace(/\s+/g, ' ')
    const line = text.slice(0, tokens[start].index).split('\n').length
    findings.push({ line, expression })
  }
  const providerField = (index, direction) => {
    const qualified = values[index + direction] === '.'
    const field = direction > 0 && qualified ? index + 2 : index
    if (sqlProvider.test(values[field])) return qualified ? index + direction * 2 : index
    const first = direction < 0 ? index - 5 : index
    if (
      values[first]?.toLowerCase() === 'json_extract' &&
      values[first + 1] === '(' &&
      values[first + 3] === ',' &&
      values[first + 4] === "'$.provider'" &&
      values[first + 5] === ')'
    ) {
      return direction < 0 ? first : first + 5
    }
    return -1
  }
  for (const [index, value] of values.entries()) {
    if (compare.has(value)) {
      const left = providerField(index - 1, -1)
      const right = providerField(index + 1, 1)
      if (left >= 0 && named(values[index + 1])) record(left, index + 1)
      if (right >= 0 && named(values[index - 1])) record(index - 1, right)
    }
    if (value.toLowerCase() === 'in' && values[index + 1] === '(') {
      const previous = values[index - 1]?.toLowerCase() === 'not' ? index - 2 : index - 1
      const start = providerField(previous, -1)
      const end = values.indexOf(')', index + 2)
      if (start >= 0 && end >= 0 && values.slice(index + 2, end).some(named)) record(start, end)
    }
  }
  return findings
}

test('desktop provider-name branches stay in the provider layer', (t) => {
  const names = providerNames()
  const files = execFileSync('git', ['ls-files', '-z', '--', sourceRoot], { cwd: root })
    .toString()
    .split('\0')
    .filter(
      (file) =>
        code.test(file) && !tests.test(file) && !file.startsWith(sourceRoot + 'main/providers/'),
    )
  const allowed = new Map(
    exceptions.map(([file, expression, reason]) => [sourceRoot + file + '\0' + expression, reason]),
  )
  const unexpected = []
  let permitted = 0
  for (const file of files) {
    const text = read(file)
    const findings = file.endsWith('.sql')
      ? sqlFindings(text, names)
      : file.endsWith('.vue')
        ? vueFindings(file, text, names)
        : scriptFindings(file, text, names)
    for (const { line, expression } of findings) {
      if (allowed.delete(file + '\0' + expression)) permitted++
      else unexpected.push(file + ':' + line + ' ' + expression)
    }
  }
  t.diagnostic(
    'Scanned ' +
      files.length +
      ' files for ' +
      [...names].join(', ') +
      '. Used ' +
      permitted +
      ' of ' +
      exceptions.length +
      ' documented exceptions.',
  )
  assert.deepEqual(unexpected, [], 'Put provider-specific behavior behind a provider operation.')
})
