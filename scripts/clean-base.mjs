#!/usr/bin/env node
/**
 * Remove BroBot state for a fresh install, keeping exports unless requested otherwise.
 *
 *   pnpm clean-base
 *   pnpm clean-base --dry-run
 *   pnpm clean-base --dir <path>
 *   pnpm clean-base --drop-exports
 *   pnpm clean-base --keep-profile-auth
 *
 * Without `--dir`, development and installed builds share the target data folder unless
 * launched with their own `--user-data-dir` (`lib/user-data.mjs`). State this in the report
 * before removal. Dry-run reports without removing; this script never launches the app.
 *
 * Proceed without confirmation only after checking the target and its contents. A running
 * app, unknown liveness, unreadable process table, invalid path or unexpected managed-home
 * directory refuses the whole operation. A nested userData under an unrecognised subtree
 * also refuses: name the observed tree without guessing why it is there. Subtrees are walked
 * before removal and again while removing, so this check has a real traversal cost.
 *
 * By default remove provider homes too: directories are the profile registry, and a copied
 * rotating refresh token can already be invalid. `--keep-profile-auth` explicitly retains them.
 */
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { whatIsRunning } from './lib/brobot-liveness.mjs'
import {
  againstTheSharedFolder,
  aLinkThatLeadsNowhere,
  applyChecked,
  checkPlan,
  CODEX_AUTH,
  DEFAULT_PROFILE_LABEL,
  HOME_FOLDER,
  HOMES,
  HOMES_DIRNAME,
  homesOnDisk,
  planCleanBase,
  planPastedImages,
  removeEmptyRoot,
  REPORT_ORDER,
} from './lib/clean-base.mjs'
import { trustedAnchor } from './lib/safe-remove.mjs'
import { defaultUserData, pastedImagesRoot } from './lib/user-data.mjs'

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/**
 * What `db/migrations/` holds, so the last line states a fact rather than a memory.
 *
 * One migration, `0000_the_tree`, generated from the final schema, with the one app-policy row
 * written by hand below it. Every table it creates lives in `brobot2.sqlite`, which this script
 * removes whole, and the one folder the tree writes under `userData/` (`resources/`, where a
 * piece's files are kept) is in `MANIFEST` and goes with it. So a fresh base is migrated and
 * unseeded: the tables, the policy row, and nothing else.
 *
 * A migration added after it owes this count, and the sentence it sits in, a decision:
 * `a-new-durable-write-under-userdata-owes-clean-base-a-decision`. Migrations that create a table
 * empty (`0001_the_model_list`: hand-added models and the last pick; `0003_the_api_keys`: saved,
 * sealed API keys; `0034_starred_conversations`: saved stars) make the sentence name what is gone. The rest only drop columns or rows or add
 * indexes, or add a nullable column to a table the sentence already names (`0002`, `0004` to `0009`,
 * `0011`, `0033`), so the sentence names nothing more.
 */
const MIGRATIONS = 35

const FLAGS = new Set([
  '--dry-run',
  // No `--packaged`: every build keeps its data in the one folder (`lib/user-data.mjs`).
  '--drop-exports',
  '--keep-profile-auth',
  '--help',
  '-h',
])

/** Names, one line-ful at a time, so a long list stays readable and nothing is elided. */
function wrap(names, width = 92, indent = '      ') {
  const lines = []
  let line = ''
  for (const name of names) {
    const next = line === '' ? name : `${line}, ${name}`
    if (next.length + indent.length > width && line !== '') {
      lines.push(`${indent}${line},`)
      line = name
    } else {
      line = next
    }
  }
  if (line !== '') lines.push(indent + line)
  return lines
}

/** `1 path`, not `1 paths` — this line is read a hundred times. */
function paths(count) {
  return `${String(count)} path${count === 1 ? '' : 's'}`
}

function bytes(count) {
  if (count < 1024) return `${String(count)} B`
  const units = ['kB', 'MB', 'GB']
  let value = count / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`
}

/**
 * `process.exitCode`, never `process.exit()`. On POSIX, writes to a piped stdout or stderr are
 * asynchronous and `process.exit()` does not wait for them (measured: a script logging 20 000
 * lines then calling `process.exit(1)` delivered 937 through a pipe). The path that matters most
 * is the one that exits non-zero after removing things, since the report is the only record of
 * what went.
 *
 * Setting the code and returning lets Node drain and exit on its own. The one thing this file must
 * therefore not do is leave a handle open; the gate probe destroys its socket on every path.
 */
function parse(argv) {
  const flags = new Set()
  let dir = null
  let sawDir = false
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = arg === '--dir' ? argv[i + 1] : arg.startsWith('--dir=') ? arg.slice(6) : null
    if (value !== null || arg === '--dir') {
      // A second `--dir` is a refusal, not last-wins. This flag selects what gets deleted; silently
      // taking the last of two is how a person watches the wrong directory empty.
      if (sawDir) return { error: '--dir was given twice, and it names what gets deleted' }
      sawDir = true
      if (value === undefined || value === null || value === '') {
        return { error: '--dir needs a path' }
      }
      dir = value
      if (arg === '--dir') i += 1
      continue
    }
    if (!FLAGS.has(arg)) return { error: `unknown option ${arg}` }
    flags.add(arg)
  }
  return { flags, dir }
}

const USAGE = `pnpm clean-base [--dry-run] [--dir <path>] [--drop-exports] [--keep-profile-auth]`

/**
 * The acceptance test, printed.
 *
 * The launcher's menu is `listProfileIds`, which is `provider-homes/default/<profile>` read back
 * off the disk, so the honest way to say what a clean base did to it is to name the homes that
 * were in it. BroBot's own profile is in the menu whether or not it is on disk
 * (`provider-homes.ts:164`), so the sentence says what the launcher will offer rather than
 * counting what went. The profile's name is read from {@link DEFAULT_PROFILE_LABEL}, not spelled.
 *
 * Three things this sentence is not allowed to do:
 *
 *  - claim the past tense on a preview: `--dry-run` removed nothing;
 *  - claim it at all when the removal did not finish: `applyChecked` reports `partly removed` when
 *    one entry could not come off, and one unremovable byte under a profile leaves that whole
 *    profile on disk and in the menu. A half-clean base is worse than not running;
 *  - say "the launcher" about a home the launcher never listed: `listProviderHomes` and
 *    `listProfileIds` read only {@link HOME_FOLDER}, so a home in any other folder is removed by
 *    this reset and was never in the menu. They are printed apart.
 */
function homesFootnote(plan, { dryRun, keepAuth, partial }) {
  const lines = []
  if (plan.homeStrays.length > 0) {
    lines.push('      …including entries BroBot did not write, which go with the tree:')
    lines.push(...wrap(plan.homeStrays, 92, '        '))
  }
  if (plan.profiles.length === 0) return lines
  const prefix = `${HOME_FOLDER}/`
  const menu = plan.profiles.filter((name) => name.startsWith(prefix))
  const offMenu = plan.profiles.filter((name) => !name.startsWith(prefix))

  if (partial) {
    lines.push(
      '      ⛔ this run did NOT finish — these homes were planned for removal and some of',
    )
    lines.push('         them are still on disk, so the launcher may still offer them:')
  } else if (keepAuth) {
    lines.push('      ⚠️  the profile homes STAY, and the launcher still offers those under')
    lines.push(`         \`${HOME_FOLDER}\`:`)
  } else {
    lines.push(`      profile homes ${dryRun ? 'that would go' : 'gone'}:`)
  }
  lines.push(...wrap(menu.length > 0 ? menu : plan.profiles, 92, '        '))
  if (menu.length > 0 && offMenu.length > 0) {
    lines.push(
      `      …and these, in folders beside \`${HOME_FOLDER}\`, which the launcher never listed:`,
    )
    lines.push(...wrap(offMenu, 92, '        '))
  }
  if (!keepAuth && !partial) {
    // The profile slug is not spelled here: this file cannot import `DEFAULT_PROFILE_ID`, and a
    // spelled word would be one rename away from being false. The sentence says whose profile rather
    // than which word. The name itself is read from {@link DEFAULT_PROFILE_LABEL}, the product's own
    // constant, held to `runtime-ipc.ts` by a test, instead of restated as a literal.
    lines.push(
      dryRun
        ? `      afterwards the launcher would offer ${DEFAULT_PROFILE_LABEL}'s own profile, and nothing else`
        : `      the launcher will offer ${DEFAULT_PROFILE_LABEL}'s own profile, and nothing else`,
    )
  }
  return lines
}

/**
 * The last line describes the behaviour this run actually had.
 *
 * It must not promise that auth or profile names survive: a report is computed from the outcome,
 * not from the plan or the flag. `standing` and `credentials` are measured off the disk after a
 * real run ({@link homesOnDisk}); `keepAuth` there only qualifies the sentence, and is named where
 * a person asked for something and did not get it. `--dir <userData>/.. --keep-profile-auth`
 * removed the whole userData as one unrecognised entry, so the report must not claim
 * `provider-homes/` still stands (`kept on purpose` is pushed only when the walk really found a
 * credential).
 *
 * On a preview there is no post-state, so `standing` is `keepAuth && plan.sawHomes`: a preview
 * predicts what a run with these flags would leave, and the flag is the only evidence of that.
 */
function nextLaunch({
  keepAuth = false,
  dryRun = false,
  partial = false,
  standing = false,
  credentials = 0,
} = {}) {
  // A run that did not finish has no post-state to describe. Saying "provider-homes/ is gone" under
  // a `left in place` block would repeat the old false sentence.
  if (partial) {
    return (
      `  ⛔ next launch: NOT a clean base. This run could not remove everything it planned to — see ` +
      `\`left in place\` above, fix what it names, and run it again. Until then some of what you ` +
      `asked to go is still there, and the launcher may still offer profiles you meant to drop.`
    )
  }
  // The conditional mood on a preview: `--dry-run` removed nothing, so the indicative would describe
  // a state this run deliberately did not produce, including the migration it counts, which a
  // database that was never deleted does not run.
  const opening =
    `  next launch${dryRun ? ', if you run this without --dry-run' : ''}: MIGRATED AND UNSEEDED, ` +
    `not empty — ${String(MIGRATIONS)} migration${MIGRATIONS === 1 ? '' : 's'}, one app-policy row, ` +
    `four compatibility connection entries, no connection defaults, ` +
    // Named because this line is where a person learns it went: the approval default lives on
    // `app_policy` and the ledger is deleted, so a reset puts every new conversation back to asking,
    // as a first-time install does. Saying only "one app-policy row" would hide a setting somebody
    // set once and would not think to check.
    // The two registry tables are created empty and named, so a person can tell "nothing is
    // registered" from "the registry was lost". The migration writes no row there and there is no
    // built-in `brobot` registration (BroBot2's own in-process server has no URL to store).
    // `--keep-profile-auth` does not preserve these: it keeps `provider-homes/`, and these rows are in
    // the database this run deletes. A registered server reaches everyone by default
    // (`external_mcp_server.reach`), but a clean base holds no rows, so that reaches nothing here.
    // The model list a person keeps and the API keys they saved live in that database too.
    `no approval default set, no external MCP servers and no grants, no hand-added models, no last ` +
    `model picked, no API keys, no conversations, no starred conversations` +
    `, no personal skills or skill choices, no history of standing rules or saved methods`
  // Selected by what is there, never by what was asked for: the run that kept nothing and the run
  // that kept something do not share a sentence, even with the flag passed.
  if (!standing) {
    return (
      // The second copy of the sentence {@link homesFootnote} repairs: it claimed the launcher offers a
      // profile name the app no longer uses, split across a `+` at a line break so a grep for the whole
      // sentence missed it. It is the last thing a person reads before relaunching a wiped install.
      `${opening} and no profiles: ${HOMES_DIRNAME}/ is gone, so the launcher offers ` +
      `${DEFAULT_PROFILE_LABEL}'s own profile and nothing else. ` +
      `Codex copies ~/.codex/${CODEX_AUTH} into the new home on the first ` +
      `conversation; Claude reads the machine Keychain, which never had a copy to go stale.` +
      // A person who typed the flag is owed an answer, and silence is not one. A fresh base has no
      // `provider-homes/` at all, so this is the ordinary outcome of asking for it.
      (keepAuth
        ? ` ⛔ You passed --keep-profile-auth and there is nothing here for it to keep: this path ` +
          `has no ${HOMES_DIRNAME}/${dryRun ? '' : ' now'}.`
        : '')
    )
  }
  // The flag is named as a description of the flag, not as a claim about argv, so the sentence stays
  // true in the one state nothing can reach today (a tree left standing by a run that did not ask).
  // The launcher's list is not this line's to give: `homesOnDisk` counts every folder while
  // `listProfileIds` reads only {@link HOME_FOLDER}, and the `provider homes` block above already
  // splits the two. This says what is on disk and leaves the menu to that block.
  return (
    `${opening} — ${HOMES_DIRNAME}/ still stands, which is what --keep-profile-auth asks for: ` +
    `every profile home you made is still there, ` +
    (credentials > 0
      ? `and the ${String(credentials)} managed ${CODEX_AUTH} under it ` +
        `${dryRun ? 'would be kept' : credentials === 1 ? 'was kept' : 'were kept'}. ⚠️ If Codex ` +
        `rejects one, that copy is stale and starting another conversation will not replace it — ` +
        `run this again without the flag, or sign that profile in from the launcher.`
      : `and no managed ${CODEX_AUTH} ${dryRun ? 'would be kept' : 'was kept'} — Codex copies ` +
        `~/.codex/${CODEX_AUTH} into a home on its first conversation.`)
  )
}

async function main() {
  const parsed = parse(process.argv.slice(2))
  if (parsed.error) {
    console.error(`clean-base: ${parsed.error}\n${USAGE}`)
    process.exitCode = 2
    return
  }
  if (parsed.flags.has('--help') || parsed.flags.has('-h')) {
    console.log(USAGE)
    return
  }
  const started = Date.now()
  const dryRun = parsed.flags.has('--dry-run')
  const target = parsed.dir ?? defaultUserData()

  const out = []
  out.push(`clean base${dryRun ? ' (dry run — nothing is removed)' : ''} · ${target}`)

  // The shared folder is said for what it is, at the head of the report: a development build and an
  // installed BroBot both keep their data there, whether named with `--dir` or fallen back to.
  // Asked of the folder wherever the target leads (a link to it, a linked parent, or another case
  // passed a `resolve()` of each spelling; see `againstTheSharedFolder`). A folder inside it, or one
  // holding it, is said too: what goes from there goes for every build.
  const shared = againstTheSharedFolder(target)
  if (shared !== null) {
    const where = {
      is: '',
      inside: `inside ${defaultUserData()}, `,
      holds: `holding ${defaultUserData()}, `,
    }[shared]
    out.push(
      `  ⚠️  ${where}the data of every BroBot on this machine not started with its own --user-data-dir — a development build’s and an installed one’s`,
    )
  }

  const anchor = trustedAnchor(target, { repoRoot: REPO_ROOT })
  if (anchor.kind === 'refused') {
    console.error(`${out.join('\n')}\n\n  ⛔ refused · ${anchor.why}`)
    process.exitCode = 1
    return
  }
  if (anchor.kind === 'absent') {
    // A link that leads nowhere is not "nothing at this path": something is there, and whoever made
    // the link meant a folder it no longer reaches.
    const nowhere = aLinkThatLeadsNowhere(anchor.lexical)
    if (nowhere !== null) {
      console.error(`${out.join('\n')}\n\n  ⛔ refused · ${nowhere}`)
      process.exitCode = 1
      return
    }
    // A statement about the path, not about BroBot's history: the old wording asserted a fact this
    // script cannot know, and printed it, exit 0, for a `--dir` with a typo in it.
    out.push(
      `  nothing at this path, so there is nothing to remove.` +
        `\n      ⚠️  if you meant a userData that exists, check the spelling — this is what a typo` +
        ` in --dir looks like.`,
    )
    console.log(out.join('\n'))
    return
  }
  if (anchor.real !== anchor.lexical) out.push(`  real path · ${anchor.real}`)

  // ⛔ Both spellings: Chromium resolves `--user-data-dir` before `app.getPath('userData')` answers,
  // so the app derives its paths from the real one while its argv still carries whichever the
  // launcher typed. A scan for one of them misses the app when the other was used.
  const live = await whatIsRunning({ lexical: anchor.lexical, real: anchor.real })
  if (live.verdict !== 'not-running') {
    const lines = [
      ...out,
      '',
      live.verdict === 'running'
        ? '  ⛔ refused · BroBot is running on this userData. Quit it and run this again.'
        : '  ⛔ refused · this could not be established, and unknown is a refusal — nothing was removed.',
      ...live.reasons.map((reason) => `      ${reason}`),
      ...live.processes.map((p) => `      pid ${String(p.pid)} · ${p.command.slice(0, 140)}`),
    ]
    console.error(lines.join('\n'))
    process.exitCode = 1
    return
  }
  out.push(`  not running · ${live.reasons.join(' · ')}`)

  const keepAuth = parsed.flags.has('--keep-profile-auth')
  const plan = planCleanBase(anchor, {
    dropExports: parsed.flags.has('--drop-exports'),
    keepAuth,
  })

  // `anchor.real`, not `anchor.lexical`. The product builds this root from the path
  // `app.getPath('userData')` returns, and Chromium resolves `--user-data-dir` before it answers, so
  // on a symlinked userData the lexical spelling names a sibling that does not exist and the whole
  // clipboard sweep is silently skipped.
  const pastedRoot = trustedAnchor(pastedImagesRoot(anchor.real), { repoRoot: REPO_ROOT })
  let pasted = { actions: [], strays: [], refusals: [] }
  if (pastedRoot.kind === 'refused') plan.refusals.push(`the pasted-image root: ${pastedRoot.why}`)
  else if (pastedRoot.kind === 'trusted') {
    pasted = planPastedImages(pastedRoot)
    plan.refusals.push(...pasted.refusals)
  }

  // Everything is checked before anything is removed. A refusal from the middle of a removal loop
  // leaves a half-clean base, worse than not running, because nothing on screen says which half.
  const inUserData = checkPlan(anchor, plan.actions)
  const inPasted =
    pastedRoot.kind === 'trusted'
      ? checkPlan(pastedRoot, pasted.actions)
      : { checked: [], refusals: [] }
  const refusals = [...plan.refusals, ...inUserData.refusals, ...inPasted.refusals]

  if (refusals.length > 0) {
    console.error(
      [
        ...out,
        '',
        `  ⛔ refused · ${String(refusals.length)} thing(s) this reset will not decide about. Nothing was removed.`,
        ...refusals.map((why) => `      ${why}`),
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }

  const done = applyChecked(inUserData.checked, { dryRun })
  const donePasted = applyChecked(inPasted.checked, { dryRun })
  // What the report may claim comes from the outcome, not the plan. One entry that could not be
  // unlinked leaves its whole profile on disk and in the launcher.
  const homesPartial = done.some((a) => a.why === HOMES && a.outcome === 'partly removed')
  // What the last line may say, measured. A real run has a post-state and this reads it, after the
  // removals and never before; a preview produced none, so it predicts from the plan: `sawHomes` is
  // whether `provider-homes/` was a top-level entry at all, and `kept` is how many managed
  // credentials the walk found under it.
  const after = dryRun
    ? { standing: keepAuth && plan.sawHomes, credentials: plan.kept }
    : homesOnDisk(anchor)

  out.push('', dryRun ? '  would remove' : '  removed')
  const groups = new Map()
  for (const action of [...done, ...donePasted]) {
    // Only what actually came off. `absent` never existed; `partly removed` says so beside its own
    // name rather than sitting here as if it were finished.
    if (action.outcome === 'absent') continue
    if (!groups.has(action.why)) groups.set(action.why, [])
    groups.get(action.why).push(action)
  }
  let totalBytes = 0
  let totalPaths = 0
  for (const why of REPORT_ORDER) {
    const group = groups.get(why)
    if (group === undefined) continue
    const size = group.reduce((sum, a) => sum + (a.bytes ?? 0), 0)
    const count = group.reduce(
      (sum, a) => sum + (a.files ?? 0) + (a.directories ?? 0) + (a.links ?? 0),
      0,
    )
    totalBytes += size
    totalPaths += count
    out.push(`    ${why} — ${paths(count)} · ${bytes(size)}`)
    // Every name, wrapped, never an elision: an unfamiliar entry must not be re-labelled, and a line
    // reading `16 entries: Cache, Code Cache, ...` re-labels the ones it cut.
    out.push(
      ...wrap(
        group.map(
          (a) =>
            a.rel +
            (a.note ? ` (${a.note})` : '') +
            (a.outcome === 'partly removed' ? ' ⛔ PARTLY' : ''),
        ),
      ),
    )
    if (why === HOMES) out.push(...homesFootnote(plan, { dryRun, keepAuth, partial: homesPartial }))
  }
  if (groups.size === 0) out.push('    (nothing — this directory is already a clean base)')

  // Remove the root only if empty. An unfamiliar entry keeps it, and so does a failed removal,
  // because `rmdir` refuses a directory that still has anything in it.
  let rootFailed = false
  if (pastedRoot.kind === 'trusted' && pasted.strays.length === 0) {
    const root = removeEmptyRoot(pastedRoot, { dryRun })
    // A continuation of the group above, not a second header for the same group.
    if (root.removed || root.planned) {
      // Counted: a directory that came off disk must not leave the total at `0 paths`, the one number a
      // person reads to know whether the command did anything.
      totalPaths += 1
      out.push(
        root.removed
          ? `      …and the root itself, now empty: ${pastedRoot.real}`
          : `      …and the root itself, which a real run would then leave empty: ${pastedRoot.real}`,
      )
    } else {
      // A failed removal must reach the exit code: printing it and exiting 0 would make a silent partial
      // failure look like success.
      rootFailed = true
      out.push(`      ⛔ the root stays (${root.why}): ${pastedRoot.real}`)
    }
  }

  const kept = [
    ...plan.keeps,
    ...pasted.strays.map((name) => ({
      // `anchor.real`, for the reason given above: on a symlinked userData the lexical spelling names a
      // sibling that does not exist, so the report would tell a person their file was kept at a path
      // they would find nothing at.
      rel: `${pastedImagesRoot(anchor.real)}/${name}`,
      why: 'not a name BroBot writes into that directory, so it is not ours to remove',
    })),
  ]
  out.push('', '  kept on purpose')
  for (const keep of kept) {
    out.push(`    ${keep.rel}${keep.flag ? `  ·  ${keep.flag}` : ''}`)
    out.push(`      ${keep.why}`)
  }

  // `outcome === 'refused'` is not tested here because `applyChecked` never sets it; such a
  // disjunct would carry no rule.
  const failed = [...done, ...donePasted].filter((a) => a.failed?.length)
  if (failed.length > 0) {
    out.push('', '  ⛔ left in place')
    for (const action of failed) {
      out.push(`    ${action.rel} · ${action.why ?? ''}`)
      for (const problem of action.failed ?? []) out.push(`      ${problem.path}: ${problem.why}`)
    }
  }

  out.push(
    '',
    `  ${paths(totalPaths)} · ${bytes(totalBytes)} · ${String(Date.now() - started)} ms`,
    nextLaunch({ keepAuth, dryRun, partial: homesPartial, ...after }),
  )
  console.log(out.join('\n'))
  if (failed.length > 0 || rootFailed) process.exitCode = 1
}

main().catch((error) => {
  console.error(`clean-base: ${error?.stack ?? String(error)}`)
  process.exitCode = 1
})
