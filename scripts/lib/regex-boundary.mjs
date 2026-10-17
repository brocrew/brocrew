/**
 * Check regex escaping on each side of a page-program template boundary. Inside an untagged
 * template, escapes are cooked before the page parses its regex; evaluate the cooked form
 * with the Node-side rule too. Outside a template, doubled backslashes before regex escapes
 * usually demand literal backslashes. Correct escaping does not prove the assertion's meaning.
 *
 * This is a handwritten scanner. Ambiguous slashes after `)` or `]` are missed to avoid
 * swallowing division as a regex. Tagged templates use the Node-side rule (`String.raw`
 * keeps bytes). Nested template text is not descended into. HTML prose can inflate literal
 * counts; an apostrophe in prose may lose one literal without escaping the template boundary.
 * Legitimate literal-backslash idioms use the visible `BACKSLASH_IS_REAL` exemption.
 * Controls in `regex-boundary.test.mjs` ensure an otherwise empty finding list is meaningful.
 */

/**
 * **The marker that says a doubled backslash means a real backslash** — on the same line, or the
 * line above it.
 *
 * ⚑ **The shape is `097`'s `WIDE_READ_MARK`, deliberately**: a visible string in the source rather
 * than a flag passed somewhere else, so an exemption cannot be added without appearing in a diff.
 *
 * ⛔ **It exists because the node-side rule genuinely cannot tell these apart.** Review produced six
 * correct node-side regexes it reports — `/\\./g`, `/^[A-Z]:\\.+$/`, `/\\+/g`, `/\\$/`, `/\\n/`,
 * `/[\\.]/` — and *"a guard may miss; it may not fail a step that is right"* is the rule this whole
 * module is written under. Nothing in the guarded files needs the marker today.
 */
export const BACKSLASH_IS_REAL = 'regex-boundary-ok'

/**
 * Characters after which a `/` begins a REGEX rather than a division.
 *
 * ⚠️ **`)` and `]` are deliberately absent** — see the module comment. It makes `if (ok) /re/` and
 * `arr[0] /re/` invisible, which is a miss rather than a false failure.
 */
const BEFORE_REGEX = new Set([
  '',
  '(',
  ',',
  '=',
  ':',
  '[',
  '!',
  '&',
  '|',
  '?',
  '{',
  '}',
  ';',
  '+',
  '-',
  '*',
  '%',
  '<',
  '>',
  '~',
  '^',
  '\n',
])

/** Keywords a regex may directly follow, where the preceding character is a plain letter. */
const KEYWORD_BEFORE_REGEX = new Set([
  'return',
  'typeof',
  'instanceof',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'case',
  'do',
  'else',
  'yield',
  'await',
  'throw',
])

/**
 * The escapes a `\\` on the node side is almost certainly meant to be.
 *
 * ⚠️ **`/` and `-` are excluded**: `[/\\]` and `[\\-]` are ordinary. Everything else that is a real
 * regex escape is in, including the ones review found missing — `x`, `u` and the backreference
 * digits `1`–`9`, each of which is exactly 117's shape and was silent.
 *
 * ⚠️ **A `\\` inside a character class is never reported at all** (see {@link inCharacterClass}),
 * which is what `[\\]` — the canonical way to write a backslash — needs, and what took `]` out of
 * an earlier version of this set for the wrong reason.
 */
const ESCAPE_AFTER_BACKSLASH = new Set([
  '.',
  'd',
  'D',
  'w',
  'W',
  's',
  'S',
  'b',
  'B',
  'n',
  'r',
  't',
  'f',
  'v',
  'x',
  'u',
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '+',
  '*',
  '?',
  '(',
  ')',
  '[',
  ']',
  '{',
  '}',
  '^',
  '$',
  '|',
])

/**
 * Every regex literal in `source`, with the side of the boundary it sits on.
 *
 * `depth` is `0` for node-side and `1` for a regex inside a template literal. ⚠️ **A `${…}` hole is
 * ordinary code and does NOT raise the depth** — the hole's contents are evaluated here, not sent,
 * so a regex inside one is node-side however deep the template around it is.
 */
export function regexLiteralsIn(source) {
  const found = []
  walk(source, skipShebang(source), source.length, 0, CODE, found)
  return found
}

/**
 * **Every regex literal in `source` whose escaping belongs to the other side.**
 *
 * Each violation names the line, the literal, the side it is on, and what the code will actually
 * see — because "wrong escaping" without the resulting expression makes you go and work out which
 * of the two directions it was.
 */
export function regexBoundaryViolations(source) {
  const lines = source.split('\n')
  const out = []
  for (const literal of regexLiteralsIn(source)) {
    const message = literal.depth > 0 ? pageSideFault(literal) : nodeSideFault(literal)
    if (message === null) continue
    // The marker is read off the SOURCE, at the literal's own line or the one above it, so a long
    // explanation can sit on its own line above a dense expression.
    const near = `${lines[literal.line - 2] ?? ''}\n${lines[literal.line - 1] ?? ''}`
    if (near.includes(BACKSLASH_IS_REAL)) continue
    out.push({
      line: literal.line,
      side: literal.depth > 0 ? 'page' : 'node',
      text: literal.text,
      message,
    })
  }
  return out
}

/**
 * A regex inside a template literal, checked against what the far side will receive.
 *
 * Two questions, not one. **Does every backslash survive the crossing** — an odd-length run means at
 * least one is eaten here, and what arrives is not what was written. And then, **is what arrives
 * itself right** — `\\\\.` is an even run that survives as `\\.`, which is 117's defect delivered
 * intact. Review found the second question missing; the first alone called four backslashes clean.
 */
function pageSideFault(literal) {
  for (const run of backslashRunsIn(literal.body)) {
    if (run.length % 2 === 0) continue
    const next = literal.body[run.at + run.length] ?? ''
    return (
      `regex-boundary: \`${literal.text}\` is INSIDE a template literal, and ` +
      `\`${'\\'.repeat(run.length)}${next}\` is escaped once. A lone backslash is consumed HERE, so ` +
      `what the far side receives is \`/${printable(cookTemplate(literal.body))}/${literal.flags}\` ` +
      `— ${describeCooked(next)}. Write \`${'\\'.repeat(run.length + 1)}${next}\`: on this side of ` +
      `the boundary every backslash must be doubled. This is 093's step 46, where the step could ` +
      `never have passed.`
    )
  }
  // What actually arrives is an ordinary node-side regex, so it answers to the node-side rule.
  const cooked = cookTemplate(literal.body)
  const arriving = nodeSideFault({ ...literal, body: cooked, text: `/${cooked}/${literal.flags}` })
  if (arriving === null) return null
  return (
    `regex-boundary: \`${literal.text}\` survives its template crossing as ` +
    `\`/${printable(cooked)}/${literal.flags}\`, and THAT is over-escaped. ${arriving}`
  )
}

/**
 * A regex in ordinary code, checked for the escaping of the OTHER side.
 *
 * `\\.` here is not a dot — it is a backslash followed by any character. 117's step 57 asked for a
 * filename shaped like `agent-<id>\<anything>jsonl` and failed the app for handing over
 * `agent-<id>.jsonl`, which is what it was written to accept.
 */
function nodeSideFault(literal) {
  for (const run of backslashRunsIn(literal.body)) {
    // An even run is `\\` repeated; an odd one has a real escape at the end and is correct.
    if (run.length % 2 !== 0) continue
    const next = literal.body[run.at + run.length] ?? ''
    if (!ESCAPE_AFTER_BACKSLASH.has(next)) continue
    // `[\\]` is the ordinary way to write a backslash inside a class, and `[\\.]`/`[/\\]` with it.
    if (inCharacterClass(literal.body, run.at)) continue
    return (
      `regex-boundary: \`${literal.text}\` is NOT inside a template literal, and \`\\\\${next}\` ` +
      `is escaped twice. Nothing cooks this string before the engine sees it, so it matches a ` +
      `LITERAL BACKSLASH followed by \`${next}\` rather than \`\\${next}\` — a subject that will ` +
      `never arrive, so the check can only ever fail. Write \`\\${next}\`, or say the backslash is ` +
      `real by writing \`${BACKSLASH_IS_REAL}\` on this line or the one above. This is 117's step ` +
      `57, where the app handed over exactly what the check claims to want and was failed for it.`
    )
  }
  return null
}

/** Whether the character at `at` sits inside a `[…]` character class. */
function inCharacterClass(body, at) {
  let open = false
  for (let i = 0; i < at; i++) {
    if (body[i] === '\\') {
      i += 1
      continue
    }
    if (body[i] === '[') open = true
    else if (body[i] === ']') open = false
  }
  return open
}

/** Every maximal run of backslashes in `body`, as `{at, length}`. */
function backslashRunsIn(body) {
  const runs = []
  for (let i = 0; i < body.length;) {
    if (body[i] !== '\\') {
      i += 1
      continue
    }
    let end = i
    while (end < body.length && body[end] === '\\') end += 1
    runs.push({ at: i, length: end - i })
    i = end
  }
  return runs
}

/** What a template literal does to this text on its way out — the far side's actual input. */
function cookTemplate(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] !== '\\') {
      out += raw[i]
      continue
    }
    const next = raw[++i]
    if (next === undefined) return out
    switch (next) {
      case 'n':
        out += '\n'
        break
      case 't':
        out += '\t'
        break
      case 'r':
        out += '\r'
        break
      case 'b':
        out += '\b'
        break
      case 'f':
        out += '\f'
        break
      case 'v':
        out += '\v'
        break
      case '0':
        out += '\0'
        break
      // Everything else — including `\\`, `\.` and `\d` — yields the character itself. That is the
      // whole defect class in one line: `\d` inside a template reaches the far side as a bare `d`,
      // silently, with no syntax error to notice.
      default:
        out += next
    }
  }
  return out
}

/** The cooked text with its control characters shown, so a message can print a real newline. */
function printable(text) {
  return text.replace(/\n/g, '⏎').replace(/\t/g, '⇥').replace(/\r/g, '⏎')
}

/** What eating this particular backslash costs, in the reader's terms. */
function describeCooked(next) {
  if (next === 'n' || next === 'r') {
    return 'a real line break inside a regex literal, which is a SyntaxError before anything runs'
  }
  if (next === 't') return 'a real tab inside a regex literal'
  return `the escape is gone and \`${next}\` is left standing alone, which matches something else entirely`
}

/* ---------------------------------------------------------------- the scanner */

/** Ordinary code: strings, comments, templates, regexes, division. */
const CODE = 'code'
/** The TEXT of a template literal, which ends at its closing backtick. */
const TEMPLATE = 'template'
/** A `${…}` hole, which ends at its own closing brace. */
const HOLE = 'hole'

/**
 * **One linear walk, three modes** — and the single walk is the point.
 *
 * ⛔ **An earlier version restarted the scan after every `${…}` hole**, which meant a hole inside a
 * `//` comment left the rest of that comment line to be read as executable code. Review measured the
 * consequence on the shipped file: eight stray-quote runs to end-of-line inside templates, prose
 * reported as a violation, and — through an apostrophe in `097's` — a real literal swallowed. Comment
 * and string state now survives a hole, because the hole is stepped over from inside the same loop
 * rather than ending it.
 *
 * ⚠️ **`word` is the identifier ending at the previous character, never across whitespace.** It used
 * to accumulate through spaces, so in this repo's semicolon-free style `document.body.innerText` on
 * one line and `return /re/` on the next produced the word `innerTextreturn` and the regex was
 * invisible. That is not a hypothetical: it hid one of the two page-side literals on
 * `ui-live-smoke.mjs`'s step-46 line, and the 093 mutation proof passed only because the defect
 * happens to sit in the other one.
 */
function walk(source, from, to, depth, mode, found) {
  let i = from
  /** The last character that decides whether a `/` opens a regex. */
  let significant = '\n'
  /** The identifier run ending at `significant`. */
  let word = ''
  /** The character immediately before `i`, whitespace included — what keeps `word` honest. */
  let previous = '\n'
  /** Nested `{}` inside a hole. */
  let braces = 0

  /**
   * Step past `char`, remembering what a following `/` needs to know.
   *
   * ⚠️ **Whitespace updates `previous` and nothing else**, and the distinction is the whole reason
   * `previous` exists as a separate variable. `significant` must skip it — `const re = /x/` has a
   * space before the slash, and a version of this that let the space become `significant` found
   * almost no regexes at all. `word` must NOT skip it, or `innerText` and a following `return`
   * concatenate and the regex after them goes unseen.
   */
  const advance = (char, next) => {
    if (!/\s/.test(char)) {
      significant = char
      word = isIdentifier(char) ? (isIdentifier(previous) ? word + char : char) : ''
    }
    previous = char
    return next
  }

  while (i < to) {
    const char = source[i]
    const next = source[i + 1]

    // Template TEXT is not code: a backslash escapes whatever follows, so `\`` is a character and
    // never the start of a nested literal. Skipping the pair is what stopped an escaped backtick
    // from inflating the depth and failing correctly-escaped page-side regexes.
    if (mode === TEMPLATE && char === '\\') {
      // ⚠️ **`significant` becomes an ordinary character, and that is not cosmetic.** An escaped
      // backtick used to leave `significant` at its start-of-region `\n`, which OPENS a regex — so
      // the `/…/` in a message like `` \`/${cooked}/\` `` was read as a literal, swallowed the hole
      // after it, and left the enclosing template unclosed for the rest of the file. Every literal
      // below it then reported the wrong side. A backslash is not an operator; saying so is enough.
      significant = '\\'
      word = ''
      previous = ''
      i += 2
      continue
    }
    if (char === '$' && next === '{' && mode === TEMPLATE) {
      // The hole is ordinary code at the depth OUTSIDE this template, and the walk continues after
      // it with everything it knew — see the note above.
      walk(source, i + 2, holeEnd(source, i + 2, to) - 1, depth - 1, HOLE, found)
      i = holeEnd(source, i + 2, to)
      significant = ')'
      word = ''
      previous = ''
      continue
    }

    if (char === '/' && next === '/') {
      i = endOfLine(source, i, to)
      significant = '\n'
      word = ''
      previous = '\n'
      continue
    }
    if (char === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2)
      i = close === -1 || close >= to ? to : close + 2
      previous = ' '
      continue
    }
    if (char === "'" || char === '"') {
      // ⛔ **In template TEXT a quote only opens a string if it CLOSES on the same line.** Prose is
      // ordinary inside a message template, and `093's` used to open a string that ran to the end
      // of the line and swallowed the template's own closing backtick — after which every literal
      // in the rest of the file reported the wrong side. Measured: it desynchronised this very file
      // from line 236 onwards. A real page-side string (`'[data-cy=x]'`) closes on its line and is
      // still skipped.
      const close = endOfQuoted(source, i, to, char)
      if (mode === TEMPLATE && source[close - 1] !== char) {
        i = advance(char, i + 1)
        continue
      }
      i = advance(char, close)
      continue
    }
    if (char === '`') {
      // ⚑ **The extent is found BEFORE the body is scanned**, so a mis-scan inside a template can
      // never leak past its own closing backtick. That containment is what turns the apostrophe
      // above from a whole-file cascade into at worst one missed literal.
      //
      // ⚠️ **A TAGGED template keeps the current depth**, which is not a dodge — it is the right
      // answer. `String.raw` cooks nothing, so its text reaches the far side verbatim and the
      // NODE-side rule is exactly the one that applies to it; `scripts/nav-order-probe.mjs` ships a
      // whole program that way. Treating it as page-side would demand `\\d` where `\d` is already
      // correct and wave through the genuinely broken form.
      const bodyEnd = templateExtent(source, i, to)
      walk(source, i + 1, bodyEnd, tagged(significant) ? depth : depth + 1, TEMPLATE, found)
      i = advance(char, Math.min(bodyEnd + 1, to))
      continue
    }
    if (mode === HOLE) {
      if (char === '{') braces += 1
      else if (char === '}') {
        if (braces === 0) return i + 1
        braces -= 1
      }
    }
    if (char === '/' && opensRegex(significant, word)) {
      const literal = readRegex(source, i, to, mode === TEMPLATE)
      if (literal !== null) {
        found.push({ ...literal, depth, line: lineAt(source, i) })
        i = advance('/', literal.end)
        continue
      }
    }
    i = advance(char, i + 1)
  }
  return to
}

/**
 * Whether a backtick here is TAGGED — `String.raw\`…\``, `html\`…\`` — rather than a plain template.
 *
 * A tag ends in an identifier character or a `)`, both of which are exactly the positions where a
 * bare template literal cannot legally start.
 */
function tagged(significant) {
  return isIdentifier(significant) || significant === ')'
}

function isIdentifier(char) {
  return char !== undefined && /[A-Za-z_$0-9]/.test(char)
}

/** Whether a `/` here opens a regex literal rather than dividing by something. */
function opensRegex(significant, word) {
  if (KEYWORD_BEFORE_REGEX.has(word)) return true
  if (isIdentifier(significant)) return false
  return BEFORE_REGEX.has(significant)
}

/**
 * Past a shebang, which is not a comment to a scanner unless it is told: `#!/usr/bin/env node`
 * otherwise opens a "regex" on line 1 and everything after it is misread.
 */
function skipShebang(source) {
  if (!source.startsWith('#!')) return 0
  const at = source.indexOf('\n')
  return at === -1 ? source.length : at
}

/**
 * The index of a template literal's CLOSING backtick, found before anything inside it is read.
 *
 * ⛔ **Bounding the body first is what makes a mis-scan survivable.** Template text is prose as often
 * as it is code, so no walk over it can be trusted not to lose its place; what it must never do is
 * lose the file. This pass looks at three things only — an escape, a hole, and the backtick — none
 * of which prose can fake.
 */
function templateExtent(source, start, to) {
  let i = start + 1
  while (i < to) {
    const char = source[i]
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === '`') return i
    if (char === '$' && source[i + 1] === '{') {
      i = holeEnd(source, i + 2, to)
      continue
    }
    i += 1
  }
  return to
}

/**
 * The index just past a `${…}` hole's own closing brace.
 *
 * Braces inside strings, templates and REGEX literals are stepped over — a `}` in a character class
 * (`/^a\\.[}]b$/`) used to close the hole early and drop the expression on the floor, which review
 * found by writing exactly that.
 */
function holeEnd(source, from, to) {
  let i = from
  let braces = 0
  while (i < to) {
    const char = source[i]
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === "'" || char === '"') {
      i = endOfQuoted(source, i, to, char)
      continue
    }
    if (char === '`') {
      i = Math.min(templateExtent(source, i, to) + 1, to)
      continue
    }
    if (char === '/' && source[i + 1] === '/') {
      i = endOfLine(source, i, to)
      continue
    }
    if (char === '/') {
      const literal = readRegex(source, i, to)
      if (literal !== null) {
        i = literal.end
        continue
      }
    }
    if (char === '{') braces += 1
    else if (char === '}') {
      if (braces === 0) return i + 1
      braces -= 1
    }
    i += 1
  }
  return to
}

function endOfQuoted(source, start, to, quote) {
  let i = start + 1
  while (i < to) {
    if (source[i] === '\\') {
      i += 2
      continue
    }
    if (source[i] === quote || source[i] === '\n') return i + 1
    i += 1
  }
  return to
}

function endOfLine(source, from, to) {
  const at = source.indexOf('\n', from)
  return at === -1 || at >= to ? to : at
}

/**
 * Read a regex literal starting at `start`, or `null` when what follows is not one.
 *
 * A newline before the closing `/` is the tell that this was a division after all — no regex
 * literal may contain an unescaped one — and returning null there is what keeps a stray `a / b`
 * from swallowing the rest of the file.
 *
 * ⚠️ **Inside template TEXT a `${` ends the attempt too.** A message built as `` `\`/${cooked}/\`` ``
 * has two slashes with a hole between them and is prose, not an expression; letting a "regex" cross
 * the hole consumed the interpolation and desynchronised everything after it.
 */
function readRegex(source, start, to, inTemplateText = false) {
  let i = start + 1
  let inClass = false
  if (source[i] === '/' || source[i] === '*' || source[i] === undefined) return null
  while (i < to) {
    const char = source[i]
    if (char === '\\') {
      i += 2
      continue
    }
    if (char === '\n') return null
    if (inTemplateText && char === '$' && source[i + 1] === '{') return null
    if (char === '[') inClass = true
    else if (char === ']') inClass = false
    else if (char === '/' && !inClass) {
      let end = i + 1
      while (end < to && /[a-z]/.test(source[end])) end += 1
      return {
        text: source.slice(start, end),
        body: source.slice(start + 1, i),
        flags: source.slice(i + 1, end),
        end,
      }
    }
    i += 1
  }
  return null
}

function lineAt(source, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (source[i] === '\n') line += 1
  return line
}
