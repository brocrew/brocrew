import { accessSync, constants } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Where the bundled `codex` executable is. The app spawns it by absolute path and never uses the
 * user's PATH or global install: a packaged app opened from Finder inherits launchd's minimal PATH,
 * and the handshake must be checked against the version this app was built for. Each platform
 * package is pinned to the version the vendored protocol types were generated from.
 *
 * Two places the binary can be, one layout:
 *  - dev: `node_modules/<platform package>/vendor/<triple>/bin/<binary>`, resolved through the
 *    module system so pnpm's layout is its problem, not ours.
 *  - packaged: `<resourcesPath>/{@link PACKAGED_CODEX_DIR}/<triple>/bin/<binary>`. A native binary
 *    cannot execute from inside `app.asar`, so electron-builder copies the platform package's
 *    `vendor/` tree there as `extraResources` (`electron-builder.yml`; a test holds it to these
 *    constants).
 *
 * The binary's sibling dirs (`codex-path/rg`, `codex-resources/zsh`) ride along in both cases;
 * codex finds them relative to its own location, as the official `bin/codex.js` launcher does.
 * Two platforms are bundled, macOS arm64 and Windows x64 ({@link BUNDLED_CODEX}), each with its own
 * package, vendor triple and file name.
 */

/** One Codex build this app bundles: its npm package, vendor triple, and the binary's file name. */
export interface BundledCodex {
  /** The npm package the binary ships in — an alias for `@openai/codex@<version>-<platform>`. */
  readonly package: string
  /** The rust target triple naming the vendor subdirectory. */
  readonly triple: string
  /** The executable's file name in `<triple>/bin/`. */
  readonly binary: string
}

/**
/** The Codex builds this app bundles by `<platform>/<arch>`, each pinned in `package.json`'s optionalDependencies and copied by `electron-builder.yml` (a test holds the three together). */
export const BUNDLED_CODEX: Readonly<Record<string, BundledCodex>> = {
  'darwin/arm64': {
    package: '@openai/codex-darwin-arm64',
    triple: 'aarch64-apple-darwin',
    binary: 'codex',
  },
  'win32/x64': {
    package: '@openai/codex-win32-x64',
    triple: 'x86_64-pc-windows-msvc',
    binary: 'codex.exe',
  },
}

/** The directory under `process.resourcesPath` the packaged build copies the vendor tree to. */
export const PACKAGED_CODEX_DIR = 'codex-vendor'

/** What the resolver needs to know about where it runs. Plain data and seams, no `electron` import, so the module loads under node. */
export interface CodexBinaryContext {
  isPackaged: boolean
  resourcesPath: string
  platform: NodeJS.Platform
  arch: string
  /** Module-resolution seam; defaults to a real `require.resolve` from this file. */
  resolvePackageJson?: (specifier: string) => string
}

/**
 * The launch cannot have Codex, and the message says what to do about it. Thrown at session
 * creation, where the host already turns a throw into the command error the surface shows —
 * "Codex isn't available …", never a raw `spawn ENOENT`.
 */
export class CodexUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexUnavailableError'
  }
}

/**
 * "Run pnpm install" alone would be circular advice: the package is an optionalDependency (so
 * pnpm can skip other platforms cleanly), and optional deps fail SILENTLY — a registry hiccup or
 * `--no-optional` leaves this exact state behind after an install that looked fine. Name the
 * mechanism, or the fix loops.
 */
const DEV_RESTORE_HINT =
  'Run pnpm install and check that optional dependencies were not skipped ' +
  '(they are how the platform binary arrives).'

function defaultResolvePackageJson(specifier: string): string {
  // `import.meta.url` survives both worlds this module runs in: vitest executes it as real ESM,
  // and the electron-vite CJS main bundle gets it transformed to a __filename-based URL.
  return createRequire(import.meta.url).resolve(specifier)
}

/**
 * The absolute path of the bundled `codex` binary, verified to exist and be executable — or a
 * {@link CodexUnavailableError} that names the path and the fix. Never a bare command.
 */
export function resolveCodexBinary(context: CodexBinaryContext): string {
  const bundled = BUNDLED_CODEX[`${context.platform}/${context.arch}`]
  if (bundled === undefined) {
    // Shipping another platform is build wiring, not a code branch: a row above and its package.
    // "running as", not "this machine is": under Rosetta an arm64 Mac reports x64, and the
    // process's reported platform is the true constraint — it is what the binary must match.
    throw new CodexUnavailableError(
      `Codex isn't available — this build bundles Codex for macOS arm64 and Windows x64 only, ` +
        `and the app is running as ${context.platform}/${context.arch}.`,
    )
  }

  const binary = context.isPackaged
    ? join(context.resourcesPath, PACKAGED_CODEX_DIR, bundled.triple, 'bin', bundled.binary)
    : devBinaryPath(context, bundled)

  try {
    // On Windows `X_OK` is checked as `F_OK` — it exists — which is what Windows can say.
    accessSync(binary, constants.X_OK)
  } catch {
    throw new CodexUnavailableError(
      `Codex isn't available — the bundled Codex binary is missing or not executable at ` +
        `${binary}. ${context.isPackaged ? 'Reinstall BroCrew to restore it.' : DEV_RESTORE_HINT}`,
    )
  }
  return binary
}

/**
 * The Codex program a launch runs, and where it comes from — `ClaudeProgram`'s shape. Only the
 * copy this app carries today: a second source widens `from`, and its version read then needs the
 * tested range a carried copy does without.
 */
export interface CodexProgram {
  readonly path: string
  readonly from: 'carried'
}

/**
 * The Codex program a launch runs: the copy this app carries, in a download and a source checkout
 * alike ({@link resolveCodexBinary}), or the same {@link CodexUnavailableError}.
 */
export function resolveCodexProgram(context: CodexBinaryContext): CodexProgram {
  return { path: resolveCodexBinary(context), from: 'carried' }
}

function devBinaryPath(context: CodexBinaryContext, bundled: BundledCodex): string {
  const resolve = context.resolvePackageJson ?? defaultResolvePackageJson
  let packageJson: string
  try {
    packageJson = resolve(`${bundled.package}/package.json`)
  } catch {
    throw new CodexUnavailableError(
      `Codex isn't available — the ${bundled.package} package is not installed. ` +
        DEV_RESTORE_HINT,
    )
  }
  return join(dirname(packageJson), 'vendor', bundled.triple, 'bin', bundled.binary)
}
