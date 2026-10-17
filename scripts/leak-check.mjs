/**
 * Prevent private identifiers in tracked contents and filenames using case-insensitive fixed
 * strings. Read patterns from `BROBOT_LEAK_PATTERNS`, its file variable, or the private config
 * file. Never print patterns or matching text; give Git its patterns through stdin.
 *
 * Missing patterns may skip contributor checks, but `--require-patterns` refuses that skip for
 * releases and public exports. A named empty file refuses. The per-file baseline is a shrinking
 * ratchet; deliberate exceptions require a reason in the allowed list.
 *
 * `--commits` additionally checks messages and identities, using external commit patterns,
 * {@link CARD_IDS}, the configured identity list and {@link GITHUB_IDENTITIES}.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const BASELINE = 'scripts/leak-guard/baseline.txt'
export const ALLOWED = 'scripts/leak-guard/allowed.txt'
export const SKIPPED = 'leak guard skipped: no patterns configured'
export const REQUIRED =
  'leak guard: no patterns configured, and this run requires them — set BROBOT_LEAK_PATTERNS ' +
  '(in CI, the repository secret), BROBOT_LEAK_PATTERNS_FILE, or ~/.config/brobot/leak-patterns'

/** The lines of a list file that say something: not blank, not a `#` comment. */
function meaningful(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
}

/**
 * ⚑ **A list of fixed strings, and where it was read** — `null` when none is configured. Read from
 * the variable itself, else the file a second variable names, else a file in `~/.config/brobot/`.
 * Never printed.
 */
function listFrom({ env, home, variable, fileVariable, configured, what }) {
  const read = (text, from) => {
    const patterns = meaningful(text)
    if (patterns.length === 0) {
      throw new Error(`${from} holds no ${what}: add them one per line, or remove it.`)
    }
    return { patterns, from }
  }
  if ((env[variable] ?? '').trim() !== '') return read(env[variable], variable)
  const named = (env[fileVariable] ?? '').trim()
  if (named !== '') {
    if (!existsSync(named)) {
      throw new Error(`${fileVariable} names a file that does not exist: create it, or unset it.`)
    }
    return read(readFileSync(named, 'utf8'), `the file ${fileVariable} names`)
  }
  const file = join(home, '.config', 'brobot', configured)
  if (existsSync(file)) return read(readFileSync(file, 'utf8'), `~/.config/brobot/${configured}`)
  return null
}

/**
 * ⚑ **The patterns, and where they were read** — `null` when none is configured. Never printed.
 */
export function patternsFrom({ env = process.env, home = homedir() } = {}) {
  return listFrom({
    env,
    home,
    variable: 'BROBOT_LEAK_PATTERNS',
    fileVariable: 'BROBOT_LEAK_PATTERNS_FILE',
    configured: 'leak-patterns',
    what: 'pattern',
  })
}

/**
 * ⚑ **The names a commit message must not carry** — names the tree itself does carry, so they
 * cannot be leak patterns — and where they were read; `null` when none is configured. Never printed.
 */
export function commitPatternsFrom({ env = process.env, home = homedir() } = {}) {
  return listFrom({
    env,
    home,
    variable: 'BROBOT_COMMIT_PATTERNS',
    fileVariable: 'BROBOT_COMMIT_PATTERNS_FILE',
    configured: 'commit-patterns',
    what: 'pattern',
  })
}

/**
 * A text as it may be printed: every part of it that is a pattern, in any case, is `…`. ⚑ Every
 * match is found in the text as it is before any is hidden, so a short pattern inside a longer one
 * cannot leave the rest of the longer one showing.
 */
export function shown(text, patterns) {
  const lower = text.toLowerCase()
  // ⚠️ A text whose lower case is not the same length cannot be matched by position: none of it.
  if (lower.length !== text.length) return '…'
  const hidden = new Array(text.length).fill(false)
  for (const pattern of patterns.map((one) => one.toLowerCase())) {
    for (let at = lower.indexOf(pattern); at >= 0; at = lower.indexOf(pattern, at + 1)) {
      hidden.fill(true, at, at + pattern.length)
    }
  }
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    if (!hidden[index]) out += text[index]
    else if (index === 0 || !hidden[index - 1]) out += '…'
  }
  return out
}

/**
 * ⚑ **Every tracked text file that carries a mention, and the numbers of its lines that do** — one
 * `git grep` over the tree: fixed strings, any case, binaries skipped. ⛔ The patterns go in on its
 * standard input, never on its command line, which a failure would print; and a failure is told
 * with git's own words, any pattern in them hidden.
 */
export function mentionsIn(root, patterns) {
  let out
  try {
    out = execFileSync(
      'git',
      [
        '-C',
        root,
        'grep',
        '-I',
        '-i',
        '-F',
        '-z',
        '-n',
        '--no-color',
        '--no-recurse-submodules',
        '-f',
        '-',
      ],
      {
        encoding: 'utf8',
        input: `${patterns.join('\n')}\n`,
        maxBuffer: 256 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
  } catch (error) {
    // ⚑ `git grep` answers 1 for "no line matched", which is the answer this guard hopes for.
    if (error.status === 1 && error.stdout === '') return new Map()
    const said = shown(String(error.stderr ?? '').trim(), patterns)
    // ⛔ Not attached as the cause: the caught error carries git's output, which may hold a
    // matched line.
    // eslint-disable-next-line preserve-caught-error -- its output may hold a matched line
    throw new Error(`git grep failed (exit ${String(error.status)}): ${said}`)
  }
  const mentions = new Map()
  for (const line of out.split('\n')) {
    if (line === '') continue
    const [path, number] = line.split('\0')
    const lines = mentions.get(path) ?? []
    lines.push(Number(number))
    mentions.set(path, lines)
  }
  return mentions
}

/**
 * ⚑ **Every tracked file whose path carries a mention** — `git ls-files -z`, matched as the contents
 * are: fixed text, any case. Sorted.
 */
export function pathsNamingIn(root, patterns) {
  let out
  try {
    out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--no-recurse-submodules'], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const said = shown(String(error.stderr ?? '').trim(), patterns)
    // eslint-disable-next-line preserve-caught-error -- its output may hold a matched path
    throw new Error(`git ls-files failed (exit ${String(error.status)}): ${said}`)
  }
  // ⚑ One form for both sides: a Mac may hand back a decomposed accent.
  const lowered = patterns.map((pattern) => pattern.normalize('NFC').toLowerCase())
  return out
    .split('\0')
    .filter(
      (path) =>
        path !== '' &&
        lowered.some((pattern) => path.normalize('NFC').toLowerCase().includes(pattern)),
    )
    .sort()
}

/** `path<TAB>count` per line. ⛔ A line it cannot read is refused, never guessed at. */
export function parseBaseline(text) {
  const baseline = new Map()
  for (const line of meaningful(text)) {
    const match = /^(.+)\t(\d+)$/.exec(line)
    if (match === null) throw new Error(`${BASELINE}: a line this guard cannot read: ${line}`)
    baseline.set(match[1], Number(match[2]))
  }
  return baseline
}

/** `path<TAB>reason` per line, and the reason is required. */
export function parseAllowed(text) {
  const allowed = new Map()
  for (const line of meaningful(text)) {
    const match = /^(.+?)\t+(.*\S.*)$/.exec(line)
    if (match === null) {
      throw new Error(`${ALLOWED}: each line is a path, a tab and the reason: ${line}`)
    }
    allowed.set(match[1], match[2].trim())
  }
  return allowed
}

/**
 * 🔴 **The verdict** — what grew past the baseline (a new mention), what the baseline lists above
 * the tree (lower it), and which exceptions excuse nothing any more.
 */
export function verdict({ mentions, baseline, allowed }) {
  const grew = []
  const shrank = []
  for (const [path, lines] of mentions) {
    if (allowed.has(path)) continue
    const listed = baseline.get(path) ?? 0
    if (lines.length > listed) grew.push({ path, lines, listed })
  }
  for (const [path, listed] of baseline) {
    if (allowed.has(path)) continue
    const count = mentions.get(path)?.length ?? 0
    if (count < listed) shrank.push({ path, count, listed })
  }
  const stale = [...allowed.keys()].filter((path) => !mentions.has(path))
  return { grew, shrank, stale }
}

/** ⚑ The baseline, lowered to the tree: never raised, never a file added. */
export function shrunk(baseline, mentions) {
  const lines = []
  for (const [path, listed] of [...baseline].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const count = Math.min(listed, mentions.get(path)?.length ?? 0)
    if (count > 0) lines.push(`${path}\t${count}`)
  }
  return lines
}

/** `1 file`, `2 files`. */
const files = (count) => `${count} file${count === 1 ? '' : 's'}`

/** The report a person reads, or `null` when the tree passes. Paths and line numbers only. */
export function problems(patterns, { grew, shrank, stale, named = [] }) {
  const out = []
  if (named.length > 0) {
    out.push('leak guard: rename these files — their names carry a mention:')
    for (const path of named) out.push(`  ${shown(path, patterns)}`)
  }
  if (grew.length > 0) {
    out.push(
      'leak guard: remove these mentions — or, for a deliberate one, add its file to ' +
        `${ALLOWED} with the reason:`,
    )
    for (const { path, lines, listed } of grew) {
      const was = listed === 0 ? '' : ` (the baseline allows ${listed}, it now has ${lines.length})`
      out.push(`  ${shown(path, patterns)}:${lines.join(',')}${was}`)
    }
  }
  if (shrank.length > 0) {
    out.push(
      'leak guard: lower the baseline to what the tree carries now — ' +
        '`node scripts/leak-check.mjs --shrink` — so a mention cannot come back unseen. A file that ' +
        `was renamed keeps its count: move its line in ${BASELINE} to the new path by hand.`,
    )
    for (const { path, count, listed } of shrank) {
      out.push(`  ${shown(path, patterns)}: ${count} now, ${listed} listed`)
    }
  }
  if (stale.length > 0) {
    out.push(`leak guard: remove these lines from ${ALLOWED} — their files carry no mention now:`)
    for (const path of stale) out.push(`  ${shown(path, patterns)}`)
  }
  return out.length === 0 ? null : out.join('\n')
}

/** The whole check, as the command runs it: the text to print and whether it passed. */
export function leakCheck({
  root = ROOT,
  env = process.env,
  home = homedir(),
  required = false,
} = {}) {
  const configured = patternsFrom({ env, home })
  if (configured === null)
    return required ? { passed: false, text: REQUIRED } : { passed: true, text: SKIPPED }
  const { patterns, from } = configured
  const baseline = parseBaseline(readFileSync(join(root, BASELINE), 'utf8'))
  const allowed = parseAllowed(readFileSync(join(root, ALLOWED), 'utf8'))
  const found = verdict({ mentions: mentionsIn(root, patterns), baseline, allowed })
  const text = problems(patterns, { ...found, named: pathsNamingIn(root, patterns) })
  if (text !== null) return { passed: false, text }
  const read = `${patterns.length} pattern${patterns.length === 1 ? '' : 's'} from ${from}`
  return {
    passed: true,
    text:
      baseline.size === 0
        ? `leak guard: no mention in the tree (${read})`
        : `leak guard: no new mention (${read}; ${files(baseline.size)} still listed in ${BASELINE})`,
  }
}

/** `--shrink`: the baseline lowered to the tree, written back. Answers what it says. */
export function shrinkTheBaseline({ root = ROOT, env = process.env, home = homedir() } = {}) {
  const configured = patternsFrom({ env, home })
  if (configured === null) {
    throw new Error('no patterns configured, so there is nothing to lower the baseline against.')
  }
  const file = join(root, BASELINE)
  const text = readFileSync(file, 'utf8')
  const header = text.split('\n').filter((line) => line.startsWith('#'))
  const kept = shrunk(parseBaseline(text), mentionsIn(root, configured.patterns))
  writeFileSync(file, `${[...header, ...kept].join('\n')}\n`)
  return `leak guard: ${BASELINE} lowered to the tree; ${files(kept.length)} listed`
}

// ── the commits ───────────────────────────────────────────────────────────────────────────────

/**
 * 🔴 **The card ids a commit message may not carry** — the team's own references, which mean
 * nothing to a reader of the public history. Each matched as a whole word; every member is a shape
 * the team's messages have carried.
 */
export const CARD_IDS = Object.freeze([
  { kind: 'a decision (D-0NN)', pattern: /\bD-\d{3}[a-z]?\b/g },
  { kind: 'a piece label (W4, W4.NN)', pattern: /\bW\d+(?:\.\d+)*[a-z]?\b/g },
  { kind: 'a feature card (FNNN)', pattern: /\bF\d{3}[a-z]?\b/g },
  { kind: 'a hand-over (HO-NNN)', pattern: /\bHO-\d{3}\b/g },
  { kind: 'a screen card (UI-NNN)', pattern: /\bUI-\d{3}\b/g },
  { kind: 'an extension card (EXT-NNN)', pattern: /\bEXT-\d{3}\b/g },
  { kind: 'a task card (T-NNN)', pattern: /\bT-\d{3}\b/g },
  { kind: 'a ruling (RNN)', pattern: /\bR\d{1,3}[a-z]?\b/g },
])

/** Every card id in a text, each once, in the order they first appear. */
export function cardIdsIn(text) {
  const found = []
  for (const { pattern } of CARD_IDS) {
    for (const match of text.matchAll(pattern)) found.push({ at: match.index, id: match[0] })
  }
  return [...new Set(found.sort((a, b) => a.at - b.at).map((one) => one.id))]
}

/**
 * ⚑ **GitHub's own identities**, which commit on GitHub's side: a pull request merged or a file
 * edited on the site (`web-flow`), and a workflow's own commits (`github-actions[bot]`).
 */
export const GITHUB_IDENTITIES = Object.freeze([
  'GitHub <noreply@github.com>',
  'github-actions[bot] <41898099+github-actions[bot]@users.noreply.github.com>',
])

/** ⚑ The identities a commit may carry, from `BROBOT_COMMIT_IDENTITIES`; `null` when unset. */
export function identitiesFrom({ env = process.env } = {}) {
  const listed = meaningful(env.BROBOT_COMMIT_IDENTITIES ?? '')
  return listed.length === 0 ? null : [...listed, ...GITHUB_IDENTITIES]
}

const FIELD = '\x1f'

/** A git command's output; its failure told in git's words, any pattern in them hidden. */
function git(root, args, { gitEnv = process.env, patterns = [], what }) {
  try {
    return execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      // ⚑ The objects as written: no replacement may stand in for a commit or a tag.
      env: { ...gitEnv, GIT_NO_REPLACE_OBJECTS: '1' },
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    const said = shown(String(error.stderr ?? '').trim(), patterns)
    // eslint-disable-next-line preserve-caught-error -- git's words are told, not its object
    throw new Error(`${what} failed (exit ${String(error.status)}): ${said}`)
  }
}

/**
 * ⚑ The commits `git log` names for `revisions`: id, author, committer and message each, one record
 * per commit, NUL-separated, so no message can end or split one. `gitEnv` is git's own environment —
 * a test hands it a scratch home.
 */
export function commitsIn(root, revisions, gitEnv = process.env, patterns = []) {
  const out = git(
    root,
    [
      'log',
      '-z',
      '--no-color',
      `--format=%H${FIELD}%an <%ae>${FIELD}%cn <%ce>${FIELD}%B`,
      '--end-of-options',
      ...revisions,
      '--',
    ],
    { gitEnv, patterns, what: 'git log' },
  )
  return out
    .split('\0')
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [sha, author, committer, ...message] = record.split(FIELD)
      return { sha, author, committer, message: message.join(FIELD) }
    })
}

/**
 * ⚑ An annotated tag as a commit check reads it — its tagger and its message, which a public
 * repository shows — or `null` for a lightweight tag, which carries neither.
 */
export function tagIn(root, name, gitEnv = process.env, patterns = []) {
  const ref = `refs/tags/${name}`
  const kind = git(root, ['cat-file', '-t', '--end-of-options', ref], {
    gitEnv,
    patterns,
    what: 'git cat-file',
  }).trim()
  if (kind !== 'tag') return null
  const body = git(root, ['cat-file', '-p', '--end-of-options', ref], {
    gitEnv,
    patterns,
    what: 'git cat-file',
  })
  const split = body.indexOf('\n\n')
  const header = split < 0 ? body : body.slice(0, split)
  const tagger = /^tagger (.*>) \d+ [+-]\d{4}$/m.exec(header)?.[1] ?? ''
  return {
    sha: `tag ${name}`,
    author: tagger,
    committer: tagger,
    message: split < 0 ? '' : body.slice(split + 2),
  }
}

/**
 * 🔴 **The verdict on some commits** — one problem per commit and part. `patterns` are every fixed
 * string a commit may not carry (leak and commit patterns together, any case); `identities` the
 * ones it may carry, or `null` for any. ⛔ A problem names a part and a kind, and a card id, which
 * is nobody's secret; never a pattern.
 */
export function commitProblems(commits, { patterns, identities }) {
  const lowered = patterns.map((one) => one.toLowerCase())
  const carries = (text) => lowered.some((pattern) => text.toLowerCase().includes(pattern))
  const problems = []
  for (const { sha, author, committer, message } of commits) {
    // ⚑ A commit by its short id; a tag by its name, whole.
    const short = sha.startsWith('tag ') ? sha : sha.slice(0, 9)
    if (carries(message)) {
      problems.push({
        sha: short,
        part: 'message',
        says: 'carries a name this repository must not carry',
      })
    }
    const ids = cardIdsIn(message)
    if (ids.length > 0) {
      problems.push({
        sha: short,
        part: 'message',
        says: `names ${ids.length === 1 ? 'a card id' : 'card ids'} (${ids.join(', ')}): write plain words, and keep ids in the reports`,
      })
    }
    for (const [part, identity] of [
      ['author', author],
      ['committer', committer],
    ]) {
      if (carries(identity)) {
        problems.push({ sha: short, part, says: 'carries a name this repository must not carry' })
      } else if (identities !== null && !identities.includes(identity)) {
        problems.push({
          sha: short,
          part,
          says: 'is not an identity this repository commits under',
        })
      }
    }
  }
  return problems
}

/** The whole commit check, as the command runs it: the text to print and whether it passed. */
export function commitCheck(
  revisions,
  {
    root = ROOT,
    env = process.env,
    home = homedir(),
    gitEnv = process.env,
    required = false,
    identitiesRequired = false,
    tags = [],
  } = {},
) {
  const leak = patternsFrom({ env, home })
  const names = commitPatternsFrom({ env, home })
  const identities = identitiesFrom({ env })
  const lacking = [
    ...(required && leak === null ? ['the leak patterns (BROBOT_LEAK_PATTERNS)'] : []),
    ...(required && names === null ? ['the commit patterns (BROBOT_COMMIT_PATTERNS)'] : []),
    ...(identitiesRequired && identities === null
      ? ['the identities (BROBOT_COMMIT_IDENTITIES)']
      : []),
  ]
  if (lacking.length > 0) {
    return {
      passed: false,
      text: `commit check: this run requires ${lacking.join(', ')}, and they are not configured`,
    }
  }
  const patterns = [...(leak?.patterns ?? []), ...(names?.patterns ?? [])]
  const commits = [
    ...(revisions.length === 0 ? [] : commitsIn(root, revisions, gitEnv, patterns)),
    ...tags.flatMap((name) => tagIn(root, name, gitEnv, patterns) ?? []),
  ]
  const problems = commitProblems(commits, { patterns, identities })
  const unchecked = [
    ...(leak === null ? ['leak patterns'] : []),
    ...(names === null ? ['commit patterns'] : []),
    ...(identities === null ? ['identities'] : []),
  ]
  const missing =
    unchecked.length === 0 ? '' : ` (not configured, so not checked: ${unchecked.join(', ')})`
  const tagged = commits.filter((one) => one.sha.startsWith('tag ')).length
  const committed = commits.length - tagged
  const counted =
    `${committed} commit${committed === 1 ? '' : 's'}` +
    (tags.length === 0 ? '' : `, ${tagged} annotated tag${tagged === 1 ? '' : 's'}`)
  if (problems.length === 0) {
    return { passed: true, text: `commit check: ${counted}, nothing found${missing}` }
  }
  const lines = problems.map(
    ({ sha, part, says }) => `  ${sha}: its ${part} ${shown(says, patterns)}`,
  )
  return {
    passed: false,
    text:
      `commit check: ${counted}, and these must change before they are public — reword or ` +
      `re-commit through the public identity${missing}:\n${lines.join('\n')}`,
  }
}

/**
 * ⚑ **A pull request's title and branch name** — the squash commit's message and the merge commit's
 * words come from them, after the merge, where they cannot be reworded without rewriting history. So
 * they are read before: card ids and the patterns, as a message is. Never printed with a pattern.
 */
export function pullRequestCheck({
  title,
  branch,
  env = process.env,
  home = homedir(),
  required = false,
}) {
  const leak = patternsFrom({ env, home })
  const names = commitPatternsFrom({ env, home })
  if (required && (leak === null || names === null)) {
    return {
      passed: false,
      text: 'pull request check: this run requires the leak and commit patterns, and they are not configured',
    }
  }
  const patterns = [...(leak?.patterns ?? []), ...(names?.patterns ?? [])]
  const lowered = patterns.map((one) => one.toLowerCase())
  const lines = []
  for (const [what, text] of [
    ['its title', title],
    ['its branch name', branch],
  ]) {
    if (lowered.some((pattern) => text.toLowerCase().includes(pattern))) {
      lines.push(`  ${what} carries a name this repository must not carry`)
    }
    const ids = cardIdsIn(text)
    if (ids.length > 0) lines.push(`  ${what} names ${ids.join(', ')}: write plain words`)
  }
  return lines.length === 0
    ? { passed: true, text: 'pull request check: its title and branch name are plain words' }
    : {
        passed: false,
        text: `pull request check: change these before it is merged —\n${lines.join('\n')}`,
      }
}

// ⚠️ Only when this file IS the command. Importing it from the test must not exit the runner.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const flags = new Set(['--require-patterns', '--require-identities'])
    const required = process.argv.includes('--require-patterns')
    const identitiesRequired = process.argv.includes('--require-identities')
    const commits = process.argv.indexOf('--commits')
    const tag = process.argv.indexOf('--tag')
    const said = ({ passed, text }) => {
      ;(passed ? process.stdout : process.stderr).write(`${text}\n`)
      if (!passed) process.exit(1)
    }
    if (commits >= 0 || tag >= 0) {
      const revisions =
        commits < 0 ? [] : process.argv.slice(commits + 1).filter((one) => !flags.has(one))
      const tags = tag < 0 ? [] : [process.argv[tag + 1] ?? '']
      if (commits >= 0 && revisions.length === 0)
        throw new Error('--commits needs revisions: base..head, or one commit')
      if (tags.includes('')) throw new Error('--tag needs a tag name')
      said(commitCheck(revisions, { required, identitiesRequired, tags }))
    } else if (process.argv.includes('--pull-request')) {
      // ⚑ From the environment, so the words never pass through a shell.
      said(
        pullRequestCheck({
          title: process.env.PR_TITLE ?? '',
          branch: process.env.PR_BRANCH ?? '',
          required,
        }),
      )
    } else if (process.argv.includes('--shrink')) {
      process.stdout.write(`${shrinkTheBaseline()}\n`)
    } else {
      const { passed, text } = leakCheck({ required })
      ;(passed ? process.stdout : process.stderr).write(`${text}\n`)
      if (!passed) process.exit(1)
    }
  } catch (error) {
    process.stderr.write(`leak guard: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
