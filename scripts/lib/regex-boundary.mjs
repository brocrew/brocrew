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
 * Marks a doubled backslash that really means a backslash, on the same line or the line above.
 * It is a visible string in the source, so an exemption cannot be added without showing in a diff.
 * It exists because the node-side rule cannot tell these apart: `/\\./g`, `/^[A-Z]:\\.+$/`,
 * `/\\+/g`, `/\\$/`, `/\\n/` and `/[\\.]/` are correct but would be reported. A guard may miss;
 * it may not fail a step that is right.
 */
export const BACKSLASH_IS_REAL = 'regex-boundary-ok'

/**
 * Characters after which a `/` begins a regex rather than a division.
 * `)` and `]` are deliberately absent (see the module comment): `if (ok) /re/` and `arr[0] /re/`
 * are missed, which is a miss rather than a false failure.
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
 * `/` and `-` are excluded: `[/\\]` and `[\\-]` are ordinary. A `\\` inside a character class is
 * never reported (see {@link inCharacterClass}), which is what `[\\]` needs.
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
 * `depth` is `0` for node-side and `1` for a regex inside a template literal. A `${…}` hole is
 * ordinary code and does not raise the depth: its contents are evaluated here, not sent.
 */
export function regexLiteralsIn(source) {
  const found = []
  walk(source, skipShebang(source), source.length, 0, CODE, found)
  return found
}

/**
 * Every regex literal in `source` whose escaping belongs to the other side.
 * Each violation names the line, the literal, the side, and what the code will actually see.
 */
export function regexBoundaryViolations(source) {
  const lines = source.split('\n')
  const out = []
  for (const literal of regexLiteralsIn(source)) {
    const message = literal.depth > 0 ? pageSideFault(literal) : nodeSideFault(literal)
    if (message === null) continue
    // The marker is read off the source, at the literal's own line or the one above it, so a long
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
 * Two questions: does every backslash survive the crossing (an odd-length run loses at least
 * one), and is what arrives itself right (`\\\\.` survives as `\\.`, which is still wrong).
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
 * A regex in ordinary code, checked for the escaping of the other side.
 *
 * `\\.` here is not a dot: it is a backslash followed by any character, so a filename pattern
 * written that way rejects the very name it was meant to accept.
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
      // Everything else, including `\\`, `\.` and `\d`, yields the character itself. `\d` inside a
      // template reaches the far side as a bare `d`, silently, with no syntax error.
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
 * One linear walk, three modes. A single walk keeps comment and string state alive across a
 * `${…}` hole, which is stepped over from inside the same loop rather than restarting the scan.
 *
 * `word` is the identifier ending at the previous character, never across whitespace; otherwise
 * `innerText` on one line and `return /re/` on the next would join and hide the regex.
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
   * Whitespace updates `previous` and nothing else. `significant` must skip it (`const re = /x/`
   * has a space before the slash); `word` must not, or `innerText` and a following `return`
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

    // Template text is not code: a backslash escapes whatever follows, so an escaped backtick is a
    // character and never starts a nested literal.
    if (mode === TEMPLATE && char === '\\') {
      // `significant` becomes an ordinary character. Left at its start-of-region `\n`, which opens a
      // regex, the `/…/` in a message like `` \`/${cooked}/\` `` would be read as a literal, swallow
      // the hole after it, and leave the enclosing template unclosed.
      significant = '\\'
      word = ''
      previous = ''
      i += 2
      continue
    }
    if (char === '$' && next === '{' && mode === TEMPLATE) {
      // The hole is ordinary code at the depth outside this template, and the walk continues after
      // it with everything it knew.
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
      // In template text a quote only opens a string if it closes on the same line. Prose is ordinary
      // inside a message template, and an apostrophe would otherwise open a string that swallows the
      // template's closing backtick. A real page-side string (`'[data-cy=x]'`) closes on its line and
      // is still skipped.
      const close = endOfQuoted(source, i, to, char)
      if (mode === TEMPLATE && source[close - 1] !== char) {
        i = advance(char, i + 1)
        continue
      }
      i = advance(char, close)
      continue
    }
    if (char === '`') {
      // The extent is found before the body is scanned, so a mis-scan inside a template cannot leak
      // past its own closing backtick.
      //
      // A tagged template keeps the current depth: `String.raw` cooks nothing, so its text reaches the
      // far side verbatim and the node-side rule applies (`scripts/nav-order-probe.mjs` ships a whole
      // program that way).
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
 * Whether a backtick here is tagged (`String.raw\`…\``, `html\`…\``) rather than a plain template.
 * A tag ends in an identifier character or a `)`, where a bare template literal cannot start.
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
 * Past a shebang, which a scanner would otherwise read as a regex opening on line 1.
 */
function skipShebang(source) {
  if (!source.startsWith('#!')) return 0
  const at = source.indexOf('\n')
  return at === -1 ? source.length : at
}

/**
 * The index of a template literal's closing backtick, found before anything inside it is read.
 *
 * Bounding the body first makes a mis-scan survivable: template text is often prose, so the walk
 * over it may lose its place but never the file. This pass looks only at an escape, a hole and
 * the backtick, none of which prose can fake.
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
 * Braces inside strings, templates and regex literals are stepped over, so a `}` in a character
 * class (`/^a\\.[}]b$/`) does not close the hole early.
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
 * A newline before the closing `/` means this was a division after all, and returning null keeps
 * a stray `a / b` from swallowing the rest of the file. Inside template text a `${` also ends
 * the attempt: `` `\`/${cooked}/\`` `` is prose with a hole between two slashes, not a regex.
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
