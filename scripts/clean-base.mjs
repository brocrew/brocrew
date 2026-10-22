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
 * ⚑ **D-016 · one migration**, `0000_the_tree`, generated from the final schema, with the one
 * app-policy row written by hand below it. ⛔ **Every table it creates lives in `brobot2.sqlite`,
 * which this script removes whole**, and the one folder the tree writes under `userData/` —
 * `resources/`, where a piece's files are kept — is in `MANIFEST` and goes with it. ⚑ So a fresh
 * base is *MIGRATED AND UNSEEDED*: the tables, the policy row, and nothing else.
 *
 * ⚠️ A migration added after it owes this count, and the sentence it sits in, a decision:
 * `a-new-durable-write-under-userdata-owes-clean-base-a-decision`. ⚑ **D-042 · `0001_the_model_list`**
 * adds the person's model list — hand-added models and the last pick — in a table it creates EMPTY,
 * so the sentence names both as gone. ⚑ **D-050 · `0002_no_agent_limit`** drops two of that
 * table's columns and creates nothing, so the sentence names nothing more. ⚑ **`0003_the_api_keys`**
 * creates the table of the API keys a person saved, sealed, EMPTY — so the sentence names them as
 * gone. `0004_no_stream_fragments` removes rows and creates nothing, so the sentence names nothing
 * more. `0005_the_fold_index` creates an index and no table, so the sentence names nothing more.
 * `0006_the_inventory_index` creates an index and no table, so the sentence names nothing more.
 * `0007_the_mcp_request_index` creates an index and no table, so the sentence names nothing more.
 * `0008_work_receipt_reads` creates two indexes and no table, so the sentence names nothing more.
 * `0009_the_fold_index_ends_passed_up_questions` recreates an index and creates no table, so the
 * sentence names nothing more. `0011_the_transcript_copy_goes` drops a table and creates nothing, so
 * the sentence names nothing more.
 */
// Rules provenance, seen state and saved method recovery live in the database being removed.
const MIGRATIONS = 18

const FLAGS = new Set([
  '--dry-run',
  // ⚑ W4.90 — no `--packaged`: every build keeps its data in the one folder (`lib/user-data.mjs`).
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
 * ⛔ **`process.exitCode`, never `process.exit()`** (351, found by measuring it).
 *
 * 🔴 On POSIX, writes to a PIPED stdout or stderr are ASYNCHRONOUS, and `process.exit()` does not
 * wait for them. Measured: a script that `console.log`s 20 000 lines and then calls
 * `process.exit(1)` delivered **937** of them through a pipe. ⚠️ **The path that matters most is the
 * one that exits non-zero after removing things** — the report is the only record of what went, and
 * `351` §3.2 is that a silent success and a silent partial failure must not look identical.
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
      // ⛔ **A second `--dir` is a refusal, not last-wins** (351 review). This flag selects what gets
      // DELETED; silently taking the last of two is how a person watches the wrong directory empty.
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
 * 🔴 **The acceptance test, printed** (352 §2.1).
 *
 * ⚑ **The launcher's menu is `listProfileIds`**, which is `provider-homes/default/<profile>` read
 * back off the disk — so the only honest way to say what a clean base did to it is to name the
 * homes that were in it. ⚠️ **BroBot's own profile is in the menu whether or not it is on disk**
 * (`provider-homes.ts:164`), which is why the sentence below says what the launcher WILL offer
 * rather than counting what went.
 *
 * ⛔ **620 · this said `default` and that stopped being the profile's name at `592`** — the same
 * rename, in the docblock ABOVE the sentence `592` repaired. ⚑ It is named rather than spelled
 * here for {@link DEFAULT_PROFILE_LABEL}'s reason.
 *
 * ## ⛔ Three things this sentence is not allowed to do (352 review)
 *
 *  - 🔴 **claim the past tense on a preview.** `--dry-run` removed nothing;
 *  - 🔴 **claim it at all when the removal did not finish.** `applyChecked` reports `partly removed`
 *    when one entry could not come off, and one unremovable byte under a profile leaves that whole
 *    profile on disk and in the menu — while the plan, which is all this used to be handed, says it
 *    went. ⛔ That is the half-clean base `351` §3.3 calls worse than not running;
 *  - ⚠️ **say "the launcher" about a home the launcher never listed.** `listProviderHomes` and
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
    // ⚑ **592 · the slug is NOT spelled here, and that is the repair** (`HO-078` §2). ⛔ It read
    // *"the launcher will offer `default`"*, which the rename made false — and this file cannot
    // import `DEFAULT_PROFILE_ID`, so spelling the new word would put the same sentence one
    // rename away from being false again (`a-number-can-survive-the-death-of-its-derivation`, on
    // a name). ⚠️ **The sentence says WHOSE profile rather than which word**, which is true of
    // every spelling this app ever seeds and is what a person reading a reset needs to know.
    // ⛔ **620 · and the NAME is now read rather than restated.** `592` wrote `BroBot` as a
    // literal here, which is the same failure one level in: correct today, and answerable by
    // nothing if the app renames itself. {@link DEFAULT_PROFILE_LABEL} is the product's own
    // constant, held to `runtime-ipc.ts` by a test.
    lines.push(
      dryRun
        ? `      afterwards the launcher would offer ${DEFAULT_PROFILE_LABEL}'s own profile, and nothing else`
        : `      the launcher will offer ${DEFAULT_PROFILE_LABEL}'s own profile, and nothing else`,
    )
  }
  return lines
}

/**
 * ⛔ **The last line describes the behaviour this run actually had** (352 §2.4).
 *
 * 🔴 **The sentence it replaces was wrong and cost a working day.** `351` printed *"auth.json stays,
 * so Codex does not have to sign in again; provider-homes/ keeps its directories, so the profile
 * names survive"* — as a courtesy, in the report of the very act it was undoing. Both halves were
 * defects, both read as features, and the sentence is what got them relayed as features.
 *
 * ## 🔴 539 · and the second time it was wrong it was the FLAG, not the default
 *
 * ⛔ **`return keepAuth ? … : …` selected this sentence from the ARGUMENT.** The PM ran
 * `--dir <userData>/.. --keep-profile-auth` twice; both runs removed the whole userData as one
 * unrecognised entry and both printed *"provider-homes/ still stands: every profile you made is
 * still in the launcher, each with the auth.json it already had"* over a directory that no longer
 * existed. ⚠️ **The report already knew.** `kept on purpose` is pushed only when the walk really
 * found a credential (`planCleanBase`: `keepAuth && homes.kept > 0`), so the two halves of one page
 * contradicted each other and only the false one was read.
 *
 * ⚑ **So `standing` and `credentials` are MEASURED** — off the disk after a real run
 * ({@link homesOnDisk}), from the plan for a preview, which is the one run with no post-state to
 * read. 🔴 **A report is computed from the outcome, not from the plan** — the rule `351` §3.2
 * wrote and this line spent twelve days breaking.
 *
 * ⚠️ **On a REAL run `keepAuth` no longer selects anything**; it only qualifies the sentence, and
 * is named where a person asked for something and did not get it. ⛔ **On a PREVIEW it is still
 * part of the selector, and that is correct rather than an exception** — `standing` there is
 * `keepAuth && plan.sawHomes`, because what a preview predicts is what a run WITH THESE FLAGS
 * would leave, and the flag is the only evidence of that there can be. ⚑ Said out loud so the
 * sentence above is not read as a claim about both paths.
 */
function nextLaunch({
  keepAuth = false,
  dryRun = false,
  partial = false,
  standing = false,
  credentials = 0,
} = {}) {
  // ⛔ **A run that did not finish has no post-state to describe** (352 review). Saying
  // "provider-homes/ is gone" under a `⛔ left in place` block is the 351 sentence in a new place.
  if (partial) {
    return (
      `  ⛔ next launch: NOT a clean base. This run could not remove everything it planned to — see ` +
      `\`left in place\` above, fix what it names, and run it again. Until then some of what you ` +
      `asked to go is still there, and the launcher may still offer profiles you meant to drop.`
    )
  }
  // ⚑ **The conditional mood on a preview.** `--dry-run` removed nothing, so the indicative would
  // describe a state this run deliberately did not produce — including the migration it counts,
  // which a database that was never deleted does not run.
  const opening =
    `  next launch${dryRun ? ', if you run this without --dry-run' : ''}: MIGRATED AND UNSEEDED, ` +
    `not empty — ${String(MIGRATIONS)} migration${MIGRATIONS === 1 ? '' : 's'}, one app-policy row, ` +
    // 🔴 **500 · the one thing on that row a PERSON set, named because this line is where they
    // learn it went.** ⛔ The approval default lives on `app_policy` and the ledger is deleted, so
    // a reset puts every new conversation back to asking — which is the decision (a first-time
    // install has never been asked), not an accident of where the value landed. ⚠️ Saying *one
    // app-policy row* and stopping would have been true and would have hidden exactly the setting
    // somebody set once and would not think to check.
    // 🔴 **516 · and the two registry tables, created EMPTY, named because a person has to be able
    // to tell *nothing is registered* from *the registry was lost*.** ⛔ The migration writes no row
    // there and there is no built-in `brobot` registration — BroBot2's own in-process server is
    // product plumbing with no URL to store (`507` §2.3) — so a clean base really does hold none,
    // rather than holding some this line failed to mention. ⚠️ **`--keep-profile-auth` does not
    // preserve these**: it keeps `provider-homes/`, and these rows are in the database this run
    // deletes. ⚑ **524 · a registered server reaches everyone by default**
    // (`external_mcp_server.reach`), but a clean base holds no rows at all, so *everyone's* reaches
    // nothing here.
    // ⚑ **D-042 · and the model list a person keeps** — a reset that drops it says so. ⚑ And the API
    // keys a person saved, which live in that database too.
    `no approval default set, no external MCP servers and no grants, no hand-added models, no last ` +
    `model picked, no API keys, no conversations` +
    `, no personal skills or skill choices, no history of standing rules or saved methods`
  // ⛔ **539 · selected by what is THERE, never by what was asked for.** Both arms of this
  // condition are reachable with the flag passed, which is the whole of the repair: the run that
  // kept nothing and the run that kept something no longer share a sentence.
  if (!standing) {
    return (
      // ⛔ **620 · D23 · the SECOND copy of the sentence `592` repaired, and the one its sweep
      // could not see.** ⚠️ It read *"the launcher offers `default` and nothing else"* — the same
      // claim as {@link homesFootnote}'s in different words, split across a `+` at a line break,
      // so a grep for either whole sentence found neither. 🔴 **This is the last thing a person
      // reads before relaunching a wiped install**, which is the worst place for a name the app
      // stopped using at `592` (`HO-078` §2, standing rule 8.1's PERSON half).
      `${opening} and no profiles: ${HOMES_DIRNAME}/ is gone, so the launcher offers ` +
      `${DEFAULT_PROFILE_LABEL}'s own profile and nothing else. ` +
      `Codex copies ~/.codex/${CODEX_AUTH} into the new home on the first ` +
      `conversation; Claude reads the machine Keychain, which never had a copy to go stale.` +
      // ⚑ **A person who typed the flag is owed the answer, and silence is not it** (539). A fresh
      // base has no `provider-homes/` at all, so this is the ordinary outcome of asking for it —
      // and it is the outcome the false sentence used to hide.
      (keepAuth
        ? ` ⛔ You passed --keep-profile-auth and there is nothing here for it to keep: this path ` +
          `has no ${HOMES_DIRNAME}/${dryRun ? '' : ' now'}.`
        : '')
    )
  }
  // ⚠️ **The flag is NAMED here as a description of the flag, not as a claim about argv** — so the
  // sentence stays true in the one state nothing can reach today (a tree left standing by a run
  // that did not ask), instead of carrying an arm no test could ever enter.
  // ⛔ **539 review · the launcher's list is NOT this line's to give.** `homesOnDisk` counts every
  // folder, `listProfileIds` reads only {@link HOME_FOLDER}, and the `provider homes` block
  // above already splits the two — so a count attached to *"still in the launcher"* blurs exactly
  // what `352` made that footnote print apart. This says what is on DISK and leaves the menu to
  // the block whose job it is.
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

  // ⚠️ **The shared folder is said for what it is, at the head of the report** (W4.90): a development
  // build and an installed BroBot both keep their data there — whether it was named with `--dir` or
  // fallen back to. ⛔ Until W4.90 this named a second, "packaged" default that no build ever used.
  // 🔴 **W4.117 · asked of the FOLDER, wherever the target leads** — a link to it, a linked parent, or
  // another case passed a `resolve()` of each spelling (see `againstTheSharedFolder`). ⚑ A folder
  // INSIDE it, or one HOLDING it, is said too: what goes from there goes for every one of them.
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
    // ⛔ **W4.117 · a link that leads nowhere is not "nothing at this path"** — something IS there,
    // and whoever made the link meant a folder it no longer reaches.
    const nowhere = aLinkThatLeadsNowhere(anchor.lexical)
    if (nowhere !== null) {
      console.error(`${out.join('\n')}\n\n  ⛔ refused · ${nowhere}`)
      process.exitCode = 1
      return
    }
    // ⚠️ **A statement about the PATH, not about BroBot's history** (352 review). The old wording
    // asserted a fact this script cannot know, and printed it, exit 0, for `--dir` with a typo in it.
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

  // ⚠️ **`anchor.real`, not `anchor.lexical`** (351 review). The product builds this root from the
  // path `app.getPath('userData')` returns, and Chromium resolves `--user-data-dir` before it
  // answers — so on a symlinked userData the lexical spelling names a sibling that does not exist
  // and the whole clipboard sweep is silently skipped.
  const pastedRoot = trustedAnchor(pastedImagesRoot(anchor.real), { repoRoot: REPO_ROOT })
  let pasted = { actions: [], strays: [], refusals: [] }
  if (pastedRoot.kind === 'refused') plan.refusals.push(`the pasted-image root: ${pastedRoot.why}`)
  else if (pastedRoot.kind === 'trusted') {
    pasted = planPastedImages(pastedRoot)
    plan.refusals.push(...pasted.refusals)
  }

  // ⛔ **Everything is CHECKED before anything is removed** — 351 §3.3. A refusal that arrives from
  // the middle of a removal loop leaves a half-clean base, which is the one outcome worse than not
  // running at all, because nothing on screen says which half.
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
  // ⛔ **What the report is allowed to claim comes from the OUTCOME, not the plan** (352 review).
  // One entry that could not be unlinked leaves its whole profile on disk and in the launcher.
  const homesPartial = done.some((a) => a.why === HOMES && a.outcome === 'partly removed')
  // 🔴 **539 · what the last line may say, MEASURED.** A real run HAS a post-state and this reads
  // it, after the removals and never before; a preview deliberately produced none, so it predicts
  // from the plan — `sawHomes` is whether `provider-homes/` was a top-level entry at all, and
  // `kept` is how many managed credentials the walk really found under it.
  const after = dryRun
    ? { standing: keepAuth && plan.sawHomes, credentials: plan.kept }
    : homesOnDisk(anchor)

  out.push('', dryRun ? '  would remove' : '  removed')
  const groups = new Map()
  for (const action of [...done, ...donePasted]) {
    // ⚑ Only what actually came off. `absent` never existed; `partly removed` says so beside its
    // own name rather than sitting in this list as if it were finished.
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
    // ⚑ **Every name, wrapped — never an elision.** `350`'s rule is that an unfamiliar entry must
    // not be re-labelled, and a line reading `16 entries: Cache, Code Cache, …` has re-labelled the
    // ones it cut. Being able to read what went is the whole point of the `other` group.
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

  // ⚑ `350`: "then remove the root only if empty". An unfamiliar entry keeps it, and so does a
  // failed removal, because `rmdir` refuses a directory that still has anything in it.
  let rootFailed = false
  if (pastedRoot.kind === 'trusted' && pasted.strays.length === 0) {
    const root = removeEmptyRoot(pastedRoot, { dryRun })
    // ⚠️ A continuation of the group above, not a second header for the same group.
    if (root.removed || root.planned) {
      // ⚑ **Counted** (352 review). A directory came off disk and the total said `0 paths`, which
      // is the one number a person reads to know whether the command did anything.
      totalPaths += 1
      out.push(
        root.removed
          ? `      …and the root itself, now empty: ${pastedRoot.real}`
          : `      …and the root itself, which a real run would then leave empty: ${pastedRoot.real}`,
      )
    } else {
      // ⛔ **A removal that failed must reach the exit code** (352 review). This one was printed and
      // exited 0 — the single path where "a silent success and a silent partial failure look
      // identical" was true of the very script whose header forbids it.
      rootFailed = true
      out.push(`      ⛔ the root stays (${root.why}): ${pastedRoot.real}`)
    }
  }

  const kept = [
    ...plan.keeps,
    ...pasted.strays.map((name) => ({
      // ⛔ **`anchor.real`, for the reason written 100 lines above and missed here** (352 review).
      // On a symlinked userData the lexical spelling names a sibling that does not exist, so the
      // report told a person their file was kept at a path they would find nothing at.
      rel: `${pastedImagesRoot(anchor.real)}/${name}`,
      why: 'not a name BroBot writes into that directory, so it is not ours to remove',
    })),
    {
      rel: "app.getPath('logs')/memory.log",
      why: 'app-global across every userData — another BroBot instance can be appending to it',
    },
  ]
  out.push('', '  kept on purpose')
  for (const keep of kept) {
    out.push(`    ${keep.rel}${keep.flag ? `  ·  ${keep.flag}` : ''}`)
    out.push(`      ${keep.why}`)
  }

  // ⚑ `outcome === 'refused'` stood here and `applyChecked` never sets it (352 review) — a
  // disjunct no mutation could kill, which is a disjunct carrying no rule.
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
