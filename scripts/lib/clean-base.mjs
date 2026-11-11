import { lstatSync, readdirSync, readlinkSync, realpathSync, rmdirSync, statSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import { identityOf, isAncestor, mayRemove, removeChecked, whereItStands } from './safe-remove.mjs'
import { defaultUserData } from './user-data.mjs'


/** What an entry is for, in the report. */
export const LEDGER = 'ledger'
export const WORKSPACE = 'workspace'
export const EXPORTS = 'exports'
export const RESOURCES = 'resources'
export const HOMES = 'provider homes'
export const GATE = 'one-host gate'
export const OTHER = 'other'
export const PASTED = 'pasted images'
export const DRAFTS = 'unsent drafts'
export const UPDATES = 'updates'
export const WORKSPACES = 'workspaces'
export const USAGE = 'usage readings'
export const RECOVERY = 'recovery copies'

export const REPORT_ORDER = Object.freeze([
  LEDGER,
  WORKSPACE,
  RESOURCES,
  EXPORTS,
  HOMES,
  DRAFTS,
  UPDATES,
  WORKSPACES,
  USAGE,
  RECOVERY,
  GATE,
  OTHER,
  PASTED,
])

export const MANIFEST = Object.freeze([
  { name: 'skills', expect: 'dir', why: WORKSPACE, source: 'main/skills/shared-library.ts' },
  { name: 'skills-off', expect: 'dir', why: WORKSPACE, source: 'main/skills/shared-library.ts' },
  {
    name: 'skills-conversion.json',
    expect: 'file',
    why: WORKSPACE,
    source: 'main/skills/shared-library.ts',
  },
  { name: 'active-theme.json', expect: 'file', why: WORKSPACE, source: 'main/themes/state.ts' },
  { name: 'dock-label.json', expect: 'file', why: WORKSPACE, source: 'main/dock-label.ts' },
  {
    name: 'transcript-retention.json',
    expect: 'file',
    why: WORKSPACE,
    source: 'main/transcript-retention.ts',
  },
  { name: 'themes', expect: 'dir', why: WORKSPACE, source: 'main/themes/state.ts' },
  { name: 'logging.json', expect: 'file', why: WORKSPACE, source: 'main/logging/log.ts' },
  { name: 'logs', expect: 'dir', why: WORKSPACE, source: 'main/logging/log.ts' },
  { name: 'brobot2.sqlite', expect: 'file', why: LEDGER, source: 'main/index.ts:218' },
  { name: 'brobot2.sqlite-wal', expect: 'file', why: LEDGER, source: 'main/db/connection.ts:19' },
  { name: 'brobot2.sqlite-shm', expect: 'file', why: LEDGER, source: 'main/db/connection.ts:19' },
  { name: 'brobot2.sqlite-journal', expect: 'file', why: LEDGER, source: "SQLite's, not BroBot's" },
  {
    name: 'brobot-workspace',
    expect: 'dir',
    why: WORKSPACE,
    source: 'main/runtime/workspace.ts:45',
  },
  {
    name: 'resources',
    expect: 'dir',
    why: RESOURCES,
    source: 'main/resources/resources.ts (resourcesRoot)',
  },
  {
    name: 'drafts.json',
    expect: 'file',
    why: DRAFTS,
    source: 'main/drafts-file.ts (importDraftsFile)',
  },
  // The conversations a person archived, named by their rows in the ledger it goes with.
  { name: 'archived.json', expect: 'file', why: LEDGER, source: 'main/archived-file.ts' },
  { name: 'exports', expect: 'dir', why: EXPORTS, source: 'main/index.ts:415' },
  { name: 'worker-output', expect: 'dir', why: WORKSPACE, source: 'main/worker-piece-folder.ts' },
  {
    name: 'provider-homes',
    expect: 'dir',
    why: HOMES,
    source: 'main/runtime/provider-homes.ts:80',
  },
  { name: 'one-host.sock', expect: 'unlink', why: GATE, source: 'main/one-host-gate.ts:127' },
  {
    name: 'update-settings.json',
    expect: 'file',
    why: UPDATES,
    source: 'main/update-settings.ts (updateSettingsOf)',
  },
  { name: 'updates', expect: 'dir', why: UPDATES, source: 'main/updates-in-the-app.ts (guide)' },
  {
    name: 'sign-in-changes.json',
    expect: 'file',
    why: LEDGER,
    source: 'main/sign-in-changes.ts (importSignInChangesFile)',
  },
  {
    name: 'schedule-attempts.json',
    expect: 'file',
    why: LEDGER,
    source: 'main/schedule-attempts-file.ts (importScheduleAttemptsFile)',
  },
  {
    name: 'profile-execution.json',
    expect: 'file',
    why: LEDGER,
    source: 'main/profile-execution-file.ts (importProfileExecutionFile)',
  },
  {
    name: 'api-keys.json',
    expect: 'file',
    why: LEDGER,
    source: 'main/runtime/api-keys.ts (API_KEYS_FILE)',
  },
  {
    name: 'turns-the-app-cut.json',
    expect: 'file',
    why: LEDGER,
    source: 'main/turns-the-app-cut-file.ts (importTurnsTheAppCutFile)',
  },
  {
    name: 'workspace.json',
    expect: 'file',
    why: WORKSPACES,
    source: 'main/workspaces.ts (nameWorkspace)',
  },
  {
    name: 'workspaces.json',
    expect: 'file',
    why: WORKSPACES,
    source: 'main/workspaces.ts (workspaceListFile)',
  },
  {
    name: 'provider-usage.json',
    expect: 'file',
    why: USAGE,
    source: 'main/provider-usage-file.ts (importProviderUsageFile)',
  },
  {
    name: 'provider-accounts.json',
    expect: 'file',
    why: USAGE,
    source: 'main/provider-accounts-file.ts (providerAccountsFile)',
  },
  {
    name: 'backups',
    expect: 'dir',
    why: RECOVERY,
    source: 'main/recovery/layout.ts (BACKUPS_DIRNAME)',
  },
  {
    name: 'recovery',
    expect: 'dir',
    why: RECOVERY,
    source: 'main/recovery/layout.ts (RECOVERY_DIRNAME)',
  },
])

export const ACTIVE_THEME_PART = /^active-theme\.json\.(?:\d+\.[0-9a-f-]{36}|[0-9a-f]{12})\.tmp$/

export const DRAFTS_PART = /^drafts\.json\.[0-9a-f]{12}\.part$/

export const UPDATE_SETTINGS_PART = /^update-settings\.json\.(?:\d+|[0-9a-f]{12})\.tmp$/

export const DOCK_LABEL_PART = /^dock-label\.json\.(?:\d+\.[0-9a-f-]{36}|[0-9a-f]{12})\.tmp$/
export const TRANSCRIPT_RETENTION_PART =
  /^transcript-retention\.json\.(?:\d+\.[0-9a-f-]{36}|[0-9a-f]{12})\.tmp$/

export const WORKSPACES_PART = /^workspaces?\.json\.(?:\d+|[0-9a-f]{12})\.tmp$/

export const PROVIDER_USAGE_PART = /^provider-accounts\.json\.(?:\d+|[0-9a-f]{12})\.tmp$/

const API_KEYS_PART = /^api-keys\.json\.(?:[0-9a-f]{12}\.tmp|unreadable-\d+)$/

export const PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const PATH_SEGMENT_MAX = 64

/** The two provider leaves, and nothing else may sit at that depth. */
export const PROVIDERS = Object.freeze(['claude', 'codex'])

export const HOME_FOLDER = 'default'

export const DEFAULT_PROFILE_LABEL = 'BroBot'

/** `<provider>.lock` and its steal remnant — siblings of the leaf, not children of it. */
export const HOME_LOCK = /^(claude|codex)\.lock(\.stale-\d+-\d+)?$/

/** The finished clipboard copy — `shared/runtime-ipc.ts:3141`, character for character. */
export const PASTED_IMAGE_NAME = /^pasted-[0-9a-f]{32}\.png$/
export const PASTED_PART = /^pasted-[0-9a-f]{32}\.png\.[0-9a-f]{12}\.(?:part|tmp)$/

/** The credential kept by default: a regular file at exactly this mode, or the run refuses. */
export const CODEX_AUTH = 'auth.json'
export const CODEX_AUTH_MODE = 0o600

/** The directory name, so the string is spelled once. */
export const HOMES_DIRNAME = 'provider-homes'

export const EXPORTS_DIRNAME = 'exports'

export const NESTED_USERDATA_SIGNS = Object.freeze([
  'skills-conversion.json',
  'brobot2.sqlite',
  'brobot2.sqlite-wal',
  'brobot2.sqlite-shm',
  'brobot2.sqlite-journal',
  'brobot-workspace',
  HOMES_DIRNAME,
  'one-host.sock',
])

export const BUNDLE_NAME = /\.brobot-session\.json$/

function isSegment(name) {
  return name.length <= PATH_SEGMENT_MAX && PATH_SEGMENT.test(name)
}

function listing(path) {
  try {
    return { kind: 'read', entries: readdirSync(path, { withFileTypes: true }) }
  } catch (error) {
    if (error?.code === 'ENOENT') return { kind: 'absent', entries: [] }
    return { kind: 'unknown', why: `${path} could not be listed: ${error?.code ?? 'unknown'}` }
  }
}

function whereItLeads(path) {
  let rest = ''
  for (let at = resolve(path); ; at = dirname(at)) {
    try {
      return join(realpathSync.native(at), rest)
    } catch {
      if (dirname(at) === at) return resolve(path)
      rest = join(basename(at), rest)
    }
  }
}

export function againstTheSharedFolder(target, shared = defaultUserData()) {
  const leads = whereItLeads(target)
  const sharedLeads = whereItLeads(shared)
  const stands = identityOf(sharedLeads) === null ? undefined : whereItStands(leads, sharedLeads)
  if (stands !== undefined) return stands
  if (leads === sharedLeads) return 'is'
  if (isAncestor(sharedLeads, leads)) return 'inside'
  return isAncestor(leads, sharedLeads) ? 'holds' : null
}

export function aLinkThatLeadsNowhere(lexical) {
  const chain = []
  for (let at = lexical; ; at = dirname(at)) {
    chain.unshift(at)
    if (dirname(at) === at) break
  }
  for (const at of chain) {
    let stat
    try {
      stat = lstatSync(at)
    } catch {
      return null
    }
    if (!stat.isSymbolicLink()) continue
    try {
      statSync(at)
    } catch {
      return (
        `${at} is a link to ${readlinkSync(at)}, which leads nowhere — point --dir at the folder ` +
        `you mean, or make that link lead to a folder that exists`
      )
    }
  }
  return null
}

export function firstNestedSign(root, rel) {
  const stack = [[rel, root]]
  while (stack.length > 0) {
    const [at, path] = stack.pop()
    const here = listing(path)
    if (here.kind === 'unknown') return { kind: 'unknown', why: here.why }
    const entries = [...here.entries].sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    )
    for (const entry of entries) {
      if (NESTED_USERDATA_SIGNS.includes(entry.name)) {
        return { kind: 'found', at: `${at}/${entry.name}`, holder: at }
      }
      if (entry.isFile() && BUNDLE_NAME.test(entry.name) && at.endsWith(`/${EXPORTS_DIRNAME}`)) {
        return {
          kind: 'found',
          at: `${at}/${entry.name}`,
          holder: at.slice(0, at.length - EXPORTS_DIRNAME.length - 1),
        }
      }
    }
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].isDirectory())
        stack.push([`${at}/${entries[i].name}`, `${path}/${entries[i].name}`])
    }
  }
  return { kind: 'clean' }
}

export function homesOnDisk(anchor) {
  const root = `${anchor.real}/${HOMES_DIRNAME}`
  let stat
  try {
    stat = lstatSync(root)
  } catch {
    return { standing: false, credentials: 0 }
  }
  if (!stat.isDirectory()) return { standing: false, credentials: 0 }
  let credentials = 0
  for (const folder of listing(root).entries ?? []) {
    if (!folder.isDirectory()) continue
    for (const profile of listing(`${root}/${folder.name}`).entries ?? []) {
      if (!profile.isDirectory()) continue
      let auth
      try {
        auth = lstatSync(`${root}/${folder.name}/${profile.name}/codex/${CODEX_AUTH}`)
      } catch {
        continue
      }
      if (auth.isFile()) credentials += 1
    }
  }
  return { standing: true, credentials }
}

export function planProviderHomes(anchor, { keepAuth = false } = {}) {
  const actions = []
  const refusals = []
  /** `<folder>/<profile>` for every home this walk finds; those under {@link HOME_FOLDER} are the menu. */
  const profiles = new Set()
  /** Names inside the tree that BroBot did not write, so the report can still name them. */
  const strays = []
  let kept = 0
  const root = mayRemove(anchor, HOMES_DIRNAME, { expect: 'dir' })
  const empty = { actions, refusals, profiles: [], strays, kept: 0 }
  if (root.kind === 'absent') return empty
  if (root.kind === 'refused') return { ...empty, refusals: [root.why] }

  const folders = listing(root.path)
  if (folders.kind === 'unknown') return { ...empty, refusals: [folders.why] }
  for (const folder of folders.entries) {
    const folderRel = `${HOMES_DIRNAME}/${folder.name}`
    if (folder.isFile()) {
      if (keepAuth) actions.push({ rel: folderRel, expect: 'unlink', why: OTHER })
      else strays.push(folderRel)
      continue
    }
    if (!folder.isDirectory()) {
      refusals.push(
        `${folderRel} is neither a folder nor an ordinary file — this reset does not know what it is`,
      )
      continue
    }
    if (!isSegment(folder.name)) {
      refusals.push(
        `${folderRel} is not a valid folder name — BroBot cannot have created it, so this reset will not remove it`,
      )
      continue
    }
    const profileEntries = listing(`${root.path}/${folder.name}`)
    if (profileEntries.kind === 'unknown') {
      refusals.push(profileEntries.why)
      continue
    }
    for (const profile of profileEntries.entries) {
      const profileRel = `${folderRel}/${profile.name}`
      if (profile.isFile()) {
        if (keepAuth) actions.push({ rel: profileRel, expect: 'unlink', why: OTHER })
        else strays.push(profileRel)
        continue
      }
      if (!profile.isDirectory()) {
        refusals.push(
          `${profileRel} is neither a profile directory nor an ordinary file — this reset does not know what it is`,
        )
        continue
      }
      if (!isSegment(profile.name)) {
        refusals.push(`${profileRel} is not a valid profile directory`)
        continue
      }
      const leaves = listing(`${root.path}/${folder.name}/${profile.name}`)
      if (leaves.kind === 'unknown') {
        refusals.push(leaves.why)
        continue
      }
      for (const leaf of leaves.entries) {
        const rel = `${profileRel}/${leaf.name}`
        if (HOME_LOCK.test(leaf.name)) {
          if (keepAuth) {
            actions.push({
              rel,
              expect: leaf.isDirectory() ? 'dir' : 'unlink',
              why: HOMES,
              note: 'a provisioning lock',
            })
          }
          continue
        }
        if (leaf.isFile()) {
          if (keepAuth) actions.push({ rel, expect: 'unlink', why: OTHER })
          else strays.push(rel)
          continue
        }
        if (!leaf.isDirectory() || !PROVIDERS.includes(leaf.name)) {
          refusals.push(
            `${rel} is neither a ${PROVIDERS.join('/')} home nor a provisioning lock — this reset does not know what it is`,
          )
          continue
        }
        if (keepAuth && leaf.name === 'codex') {
          const auth = mayRemove(anchor, `${rel}/${CODEX_AUTH}`, { expect: 'file' })
          if (auth.kind === 'refused') {
            refusals.push(`${rel}/${CODEX_AUTH}: ${auth.why}`)
            continue
          }
          if (auth.kind === 'ok' && (auth.stat.mode & 0o777) !== CODEX_AUTH_MODE) {
            refusals.push(
              `${rel}/${CODEX_AUTH} is mode 0${(auth.stat.mode & 0o777).toString(8)} where a managed credential is 0600 — this reset will not decide what it is`,
            )
            continue
          }
          if (auth.kind === 'ok') kept += 1
        }
        profiles.add(`${folder.name}/${profile.name}`)
        if (!keepAuth) continue
        actions.push({
          rel,
          expect: 'dir',
          why: HOMES,
          empty: true,
          keep: leaf.name === 'codex' ? CODEX_AUTH : null,
          note: leaf.name === 'codex' ? `emptied, keeping ${CODEX_AUTH}` : 'emptied',
        })
      }
    }
  }
  if (!keepAuth) {
    actions.push({
      rel: HOMES_DIRNAME,
      expect: 'dir',
      why: HOMES,
      note: 'the whole tree — a fresh install has no such directory',
    })
  }
  return { actions, refusals, profiles: [...profiles].sort(), strays, kept }
}

export function planCleanBase(anchor, { dropExports = false, keepAuth = false } = {}) {
  const actions = []
  const refusals = []
  const keeps = []
  let profiles = []
  let homeStrays = []
  let sawHomes = false
  let kept = 0

  const top = listing(anchor.real)
  if (top.kind === 'unknown') {
    return { actions, refusals: [top.why], keeps, profiles, homeStrays, sawHomes, kept }
  }

  const named = new Map(MANIFEST.map((entry) => [entry.name, entry]))
  for (const entry of [...top.entries].sort((a, b) => a.name.localeCompare(b.name))) {
    const rule = named.get(entry.name)
    if (rule?.name === 'worker-output') {
      keeps.push({
        rel: 'worker-output',
        why: "A person's results written for parallel pieces are kept on reset.",
      })
      continue
    }
    if (rule?.name === 'exports' && !dropExports) {
      keeps.push({
        rel: 'exports',
        why: "a new export cannot be regenerated once the provider's file is gone, and it loads into nothing",
        flag: '--drop-exports',
      })
      continue
    }
    if (rule?.name === HOMES_DIRNAME) {
      const homes = planProviderHomes(anchor, { keepAuth })
      actions.push(...homes.actions)
      refusals.push(...homes.refusals)
      profiles = homes.profiles
      homeStrays = homes.strays
      sawHomes = true
      kept = homes.kept
      if (keepAuth && homes.kept > 0) {
        keeps.push({
          rel: `${HOMES_DIRNAME}/*/*/codex/${CODEX_AUTH} — and every profile directory holding one`,
          why: 'you asked for it; the default removes this. A kept copy that has been rotated stays stale, and nothing re-copies it: provisionCodexAuth never overwrites',
          flag: '--keep-profile-auth',
        })
      }
      continue
    }
    if (rule) {
      actions.push({ rel: rule.name, expect: rule.expect, why: rule.why })
      continue
    }
    if (
      ACTIVE_THEME_PART.test(entry.name) ||
      DOCK_LABEL_PART.test(entry.name) ||
      TRANSCRIPT_RETENTION_PART.test(entry.name)
    ) {
      actions.push({ rel: entry.name, expect: 'file', why: WORKSPACE })
      continue
    }
    if (DRAFTS_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: DRAFTS })
      continue
    }
    if (UPDATE_SETTINGS_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: UPDATES })
      continue
    }
    if (WORKSPACES_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: WORKSPACES })
      continue
    }
    if (PROVIDER_USAGE_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: USAGE })
      continue
    }
    if (API_KEYS_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: LEDGER })
      continue
    }
    if (entry.isDirectory()) {
      const nested = firstNestedSign(`${anchor.real}/${entry.name}`, entry.name)
      if (nested.kind === 'unknown') {
        refusals.push(nested.why)
        continue
      }
      if (nested.kind === 'found') {
        const userData = `${anchor.real}/${nested.holder}`
        refusals.push(
          `${entry.name} is not a name this reset knows, so it would be removed whole — and ` +
            `${nested.at} is under it, which only BroBot writes. ⛔ This reset empties ONE userData ` +
            `and ${userData} looks like one, inside the directory you named: point --dir at it if ` +
            `that is the one you meant, and move or remove that tree if it is not.`,
        )
        continue
      }
    }
    actions.push({ rel: entry.name, expect: entry.isDirectory() ? 'dir' : 'unlink', why: OTHER })
  }
  return { actions, refusals, keeps, profiles, homeStrays, sawHomes, kept }
}

export function planPastedImages(anchor) {
  const actions = []
  const strays = []
  const top = listing(anchor.real)
  if (top.kind === 'unknown') return { actions, strays, refusals: [top.why] }
  for (const entry of top.entries) {
    if (PASTED_IMAGE_NAME.test(entry.name) || PASTED_PART.test(entry.name)) {
      actions.push({ rel: entry.name, expect: 'file', why: PASTED })
      continue
    }
    strays.push(entry.name)
  }
  return { actions, strays, refusals: [] }
}

export function checkPlan(anchor, actions) {
  const checked = []
  const refusals = []
  for (const action of actions) {
    const verdict = mayRemove(anchor, action.rel, { expect: action.expect })
    if (verdict.kind === 'refused') {
      refusals.push(verdict.why)
      continue
    }
    checked.push({ action, verdict })
  }
  return { checked, refusals }
}

export function applyChecked(checked, { dryRun = false } = {}) {
  const done = []
  for (const { action, verdict } of checked) {
    if (verdict.kind === 'absent') {
      done.push({ ...action, outcome: 'absent' })
      continue
    }
    const result = removeChecked(verdict.path, verdict.stat, {
      apply: !dryRun,
      removeRoot: !action.empty,
      keep: action.keep ? (relative) => relative === action.keep : undefined,
    })
    done.push({
      ...action,
      outcome: result.failed.length > 0 ? 'partly removed' : dryRun ? 'would remove' : 'removed',
      path: verdict.path,
      ...result,
    })
  }
  return done
}

export function removeEmptyRoot(anchor, { dryRun = false } = {}) {
  let now
  try {
    now = lstatSync(anchor.real)
  } catch (error) {
    return { removed: false, why: `it could not be read: ${error?.code ?? 'unknown'}` }
  }
  if (!now.isDirectory() || now.dev !== anchor.dev || now.ino !== anchor.ino) {
    return { removed: false, why: 'it is no longer the directory that was checked' }
  }
  if (dryRun) {
    return { removed: false, planned: true, why: null }
  }
  try {
    rmdirSync(anchor.real)
    return { removed: true, why: null }
  } catch (error) {
    return { removed: false, why: `rmdir refused it: ${error?.code ?? 'unknown'}` }
  }
}
