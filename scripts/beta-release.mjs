// A build's release: which platforms a tag builds, and the title and words a person reads on its
// release page — written once, for every workflow that publishes (`.github/workflows/windows.yml`,
// `macos.yml`, `release.yml`).
//
//   node scripts/beta-release.mjs title <tag>
//   node scripts/beta-release.mjs notes <tag> <commit>   (links the install pages when GITHUB_REPOSITORY is set)
//
// ⚑ A tag names its platforms: `windows-beta-N` builds Windows, `mac-beta-N` builds the Mac, and
// `beta-N` builds both into ONE prerelease, so each job's text is the same whichever job makes the
// release first. ⚑ W4.109 — a version tag (`v0.1.0`, `v0.2.0-beta.1`) is a release of both,
// the one BroCrew's updater reads. ⛔ A tag that names none is an error: a workflow that publishes on
// it publishes nothing a person could be told how to install.
//
// Node built-ins only, so it runs before or without any install.
import { pathToFileURL } from 'node:url'

/** The keys pages, as the providers serve them today (`console.anthropic.com` moved here). */
const ANTHROPIC_KEYS = 'https://platform.claude.com/settings/keys'
const OPENAI_KEYS = 'https://platform.openai.com/api-keys'
const CLAUDE_CODE_SETUP = 'https://code.claude.com/docs/en/setup'

/** ⚑ W4.109 — a version tag: `vX.Y.Z` (a release) or `vX.Y.Z-beta.N` (a beta), else null. */
export function versionOf(tag) {
  const match = /^v(\d+\.\d+\.\d+)(-beta\.\d+)?$/.exec(tag)
  return match === null
    ? null
    : { version: `${match[1]}${match[2] ?? ''}`, beta: match[2] !== undefined }
}

/** The platforms a tag builds, in the order their install steps are read. */
export function platformsOf(tag) {
  if (versionOf(tag) !== null) return ['windows', 'mac']
  if (/^windows-beta-[^\s]+$/.test(tag)) return ['windows']
  if (/^mac-beta-[^\s]+$/.test(tag)) return ['mac']
  if (/^beta-[^\s]+$/.test(tag)) return ['windows', 'mac']
  throw new Error(
    `${tag} names no beta platform: windows-beta-N, mac-beta-N, beta-N, vX.Y.Z or vX.Y.Z-beta.N`,
  )
}

const NAMES = { windows: 'Windows', mac: 'macOS' }

/** The release's title. */
export function titleOf(tag) {
  const release = versionOf(tag)
  if (release !== null) return `BroCrew ${release.version}${release.beta ? ' (beta)' : ''}`
  const platforms = platformsOf(tag)
  const which = platforms.length === 1 ? `${NAMES[platforms[0]]} beta` : 'beta'
  return `BroCrew — ${which} (${tag})`
}

const WINDOWS = `**Windows (x64):**
1. Download \`BroCrew-Setup-….exe\` below. If your browser says the file is not commonly downloaded, choose Keep.
2. Open it. Windows says "Windows protected your PC": choose More info, then Run anyway.
3. Install for yourself only ("Only for me"), so no administrator is needed.`

const MAC = `**macOS (Apple silicon: M1 or later; macOS 15 or later):**
1. Download \`BroCrew-….dmg\` below, open it, and drag BroCrew into Applications.
2. Open BroCrew from Applications. macOS says it could not verify BroCrew: choose Done.
3. Within the hour, open System Settings → Privacy & Security. Under Security, next to the line about BroCrew, choose Open Anyway, confirm with your password or Touch ID (an administrator's, on a standard account), and choose Open Anyway once more. (Right-click → Open no longer does this on macOS 15.)
4. Only if macOS says BroCrew "is damaged": in Terminal, run \`xattr -dr com.apple.quarantine /Applications/BroCrew.app\`, then open it again.

BroCrew keeps its data in \`~/Library/Application Support/@brobot2/desktop\`. A BroCrew you run from source on the same Mac uses the same folder.`

const KEYS = `open Settings → Providers, save an Anthropic API key on the Claude card (from ${ANTHROPIC_KEYS}) and an OpenAI API key on the Codex card (from ${OPENAI_KEYS}), and press Check it works on each.`

const CLAUDE_CODE = `To use Claude agents, install Claude Code from ${CLAUDE_CODE_SETUP}. BroCrew does not include it: it runs the Claude Code installed on your computer. Codex comes with BroCrew.`

// Release notes give installation and key steps, plus the existing update route for 0.1.8.
const CLAUDE_CODE_FIRST = `To use Claude, install Claude Code first, from Anthropic: ${CLAUDE_CODE_SETUP}. Codex comes with BroCrew.`

const UPDATE_CHECK_018 = 'Stable automatic update checks continue through brocrew.app and include your installed app version, without a user or installation ID. Network errors, a 60-second timeout or server errors fall back to GitHub; beta checks use GitHub. Turn off Check automatically to stop new automatic requests to brocrew.app; manual checks and downloads then use GitHub. See https://brocrew.app/privacy/ and the Updates guide for details.'

const SIGN_IN = {
  windows: `open Settings → Providers, and save an API key on the Claude card (from ${ANTHROPIC_KEYS}) and on the Codex card (from ${OPENAI_KEYS}). With no Claude key saved, BroCrew runs Claude on your Claude Code login on this PC: sign in to it once by running \`claude\` in PowerShell.`,
  mac: `open Settings → Providers, and save an API key on the Claude card (from ${ANTHROPIC_KEYS}) and on the Codex card (from ${OPENAI_KEYS}). With no key saved, BroCrew uses the Claude and Codex logins already on the Mac.`,
}

/** Each platform's install page, in the repository. */
const PAGES = { windows: 'docs/install-windows.md', mac: 'docs/install-macos.md' }

/**
 * Where a platform's full steps are: its install page at this commit, linked when the repository is
 * known (the workflow's `GITHUB_REPOSITORY`), and named as a path when it is not.
 */
function pageOf(platform, commit, repository) {
  const page = PAGES[platform]
  return repository === null
    ? `\`${page}\``
    : `https://github.com/${repository}/blob/${commit}/${page}`
}

/** Public versions describe API keys; private beta tags retain their platform's sign-in steps. */
export function notesOf(tag, commit, repository = null) {
  const platforms = platformsOf(tag)
  const release = versionOf(tag)
  const what =
    release !== null
      ? `BroCrew ${release.version}${release.beta ? ', a beta,' : ''} for Windows x64 and for Macs with Apple silicon (unsigned on Windows; signed ad hoc and not notarized on the Mac)`
      : platforms.length === 1
        ? platforms[0] === 'windows'
          ? 'Unsigned beta build of BroCrew for Windows x64'
          : 'Beta build of BroCrew for Macs with Apple silicon, signed ad hoc and not notarized'
        : 'Beta builds of BroCrew for Windows x64 and for Macs with Apple silicon (unsigned on Windows; signed ad hoc and not notarized on the Mac)'
  const install = platforms.map((one) => (one === 'windows' ? WINDOWS : MAC))
  const signIn =
    release !== null
      ? [CLAUDE_CODE_FIRST, `To add your API keys: ${KEYS}`]
      : platforms.length === 1
        ? [CLAUDE_CODE, `To sign in: ${SIGN_IN[platforms[0]]}`]
        : [
            CLAUDE_CODE,
            `To sign in on Windows: ${SIGN_IN.windows}`,
            `To sign in on the Mac: ${SIGN_IN.mac}`,
          ]
  const steps =
    platforms.length === 1
      ? pageOf(platforms[0], commit, repository)
      : platforms.map((one) => `${NAMES[one]}, ${pageOf(one, commit, repository)}`).join('; ')
  return [
    `${what}, from commit ${commit} (tag ${tag}).`,
    'To install:',
    ...install,
    ...(release !== null
      ? [
          'The `.zip`, `.blockmap` and `latest*.yml` files are what BroCrew reads when it checks for updates. You don’t need to download them.',
        ]
      : []),
    ...signIn,
    ...(tag === 'v0.1.8' ? [UPDATE_CHECK_018] : []),
    release !== null
      ? 'What the agents do is billed to the account the key belongs to.'
      : 'What the agents do is billed to the account the key or login belongs to.',
    release !== null ? `The full steps: ${steps}.` : `The install and API-key steps: ${steps}.`,
  ].join('\n\n')
}

// ⚑ Only when run as a command: a test imports this module, and must not be answered with an exit.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , command, tag, commit] = process.argv
  if (command === 'title' && tag !== undefined) {
    console.log(titleOf(tag))
  } else if (command === 'notes' && tag !== undefined && commit !== undefined) {
    console.log(notesOf(tag, commit, process.env.GITHUB_REPOSITORY || null))
  } else {
    console.error('usage: beta-release.mjs title <tag> | notes <tag> <commit>')
    process.exit(2)
  }
}
