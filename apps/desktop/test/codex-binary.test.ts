import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CODEX_PROTOCOL_VERSION, type TransportFactory } from '@brobot2/runtime'
import {
  BUNDLED_CODEX,
  CodexUnavailableError,
  PACKAGED_CODEX_DIR,
  resolveCodexBinary,
  resolveCodexProgram,
  type BundledCodex,
} from '../src/main/runtime/codex-binary'
import { providerVersionsReader } from '../src/main/runtime/provider-versions'
import { createProviderRuntime } from '../src/main/runtime/provider-homes'
import { readableError } from '../src/renderer/src/lib/session-record'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The bundled codex binary (014): the app spawns the codex it SHIPS, by absolute path — never a
 * PATH lookup — and the version it ships is the version the vendored protocol was generated
 * from, so the handshake cannot be broken by whatever the user has installed globally.
 */
/** ⚑ The two builds bundled since F072. */
const DARWIN = BUNDLED_CODEX['darwin/arm64'] as BundledCodex
const WINDOWS = BUNDLED_CODEX['win32/x64'] as BundledCodex

describe('bundled codex binary', () => {
  const darwinArm = { platform: 'darwin' as NodeJS.Platform, arch: 'arm64' }
  const windowsX64 = { platform: 'win32' as NodeJS.Platform, arch: 'x64' }

  let scratch: string
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'brobot2-codex-bin-'))
  })
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true })
  })

  /** Lay a fake vendor tree with an executable binary under `root`, returning the binary path. */
  function plantBinary(root: string, vendorDir: string, bundled: BundledCodex = DARWIN): string {
    const bin = join(root, vendorDir, bundled.triple, 'bin')
    mkdirSync(bin, { recursive: true })
    const binary = join(bin, bundled.binary)
    writeFileSync(binary, '#!/bin/sh\n')
    chmodSync(binary, 0o755)
    return binary
  }

  describe('the pin', () => {
    it('each platform package is pinned to exactly the vendored protocol version', () => {
      // Binary, protocol types, and the launch-time handshake are one version by construction:
      // these aliases are the only place the binary's version is stated, and each must be the pin.
      const raw = JSON.parse(readFileSync(join(here, '../package.json'), 'utf8')) as {
        optionalDependencies?: Record<string, string>
      }
      expect(raw.optionalDependencies?.[DARWIN.package]).toBe(
        `npm:@openai/codex@${CODEX_PROTOCOL_VERSION}-darwin-arm64`,
      )
      // ⚑ F072 — and the Windows build, the same version.
      expect(raw.optionalDependencies?.[WINDOWS.package]).toBe(
        `npm:@openai/codex@${CODEX_PROTOCOL_VERSION}-win32-x64`,
      )
      expect(Object.keys(BUNDLED_CODEX).sort()).toEqual(['darwin/arm64', 'win32/x64'])
    })

    // Real-install assertions run only where the optional dep can exist: the package declares
    // os:[darwin]/cpu:[arm64], so pnpm rightly skips it elsewhere — including the committed
    // ubuntu CI workflow — and a hard failure there would be red for no regression. The
    // seam-based tests above and below cover the logic on every platform.
    const onBundledPlatform = process.platform === 'darwin' && process.arch === 'arm64'

    it.runIf(onBundledPlatform)(
      'the installed binary really is there, executable, at the pinned version',
      () => {
        // The dev-branch resolution against the REAL install — this is what every codex session
        // this repo starts actually spawns. require.resolve follows pnpm's symlinks into the
        // store, where the path carries the artifact's true version — so this binds the binary
        // ON DISK to the protocol pin, not just the manifest's declaration to it. And it must
        // live in THIS repo's node_modules, never the developer's global install.
        const binary = resolveCodexBinary({ ...darwinArm, isPackaged: false, resourcesPath: '' })
        const repoRoot = realpathSync(join(here, '..', '..', '..'))
        expect(realpathSync(binary).startsWith(repoRoot)).toBe(true)
        expect(binary).toContain('/node_modules/')
        expect(binary).toContain(`@openai+codex@${CODEX_PROTOCOL_VERSION}-darwin-arm64`)
        expect(binary.endsWith(join('vendor', DARWIN.triple, 'bin', 'codex'))).toBe(true)
      },
    )
  })

  describe('dev resolution', () => {
    it('resolves through the module system to the platform package vendor tree', () => {
      const pkg = join(scratch, 'node_modules', DARWIN.package)
      const binary = plantBinary(pkg, 'vendor')
      writeFileSync(join(pkg, 'package.json'), '{}')
      const resolved = resolveCodexBinary({
        ...darwinArm,
        isPackaged: false,
        resourcesPath: '',
        resolvePackageJson: () => join(pkg, 'package.json'),
      })
      expect(resolved).toBe(binary)
    })

    it('an uninstalled package is "Codex isn\'t available", naming the fix', () => {
      const attempt = () =>
        resolveCodexBinary({
          ...darwinArm,
          isPackaged: false,
          resourcesPath: '',
          resolvePackageJson: () => {
            throw new Error("Cannot find module '@openai/codex-darwin-arm64/package.json'")
          },
        })
      expect(attempt).toThrow(CodexUnavailableError)
      expect(attempt).toThrow(/Codex isn't available/)
      expect(attempt).toThrow(/pnpm install/)
    })
  })

  describe('the program a launch runs, as the Providers page says it', () => {
    /** The planted binary, made to print a Codex version. */
    const sayingAVersion = (binary: string): string => {
      writeFileSync(binary, '#!/bin/sh\necho "codex-cli 0.160.0"\n')
      chmodSync(binary, 0o755)
      return binary
    }
    const noClaude = (): never => {
      throw new Error('no Claude Code here')
    }

    it('in a source run: the copy BroCrew carries, at the path a launch runs', async () => {
      const pkg = join(scratch, 'node_modules', DARWIN.package)
      const binary = sayingAVersion(plantBinary(pkg, 'vendor'))
      writeFileSync(join(pkg, 'package.json'), '{}')
      const context = {
        ...darwinArm,
        isPackaged: false,
        resourcesPath: '',
        resolvePackageJson: () => join(pkg, 'package.json'),
      }
      expect(resolveCodexProgram(context)).toEqual({ path: binary, from: 'carried' })
      const { codex } = await providerVersionsReader(() => resolveCodexProgram(context), noClaude)()
      expect(codex.program).toMatchObject({
        standing: 'tested',
        from: 'carried',
        path: binary,
        tested: null,
        help: null,
        said: `Codex 0.160.0, the copy BroCrew carries, at ${binary}.`,
      })
    })

    it('in a download: the same words, at the path in its resources', async () => {
      const binary = sayingAVersion(plantBinary(scratch, PACKAGED_CODEX_DIR))
      const context = { ...darwinArm, isPackaged: true, resourcesPath: scratch }
      expect(resolveCodexProgram(context)).toEqual({ path: binary, from: 'carried' })
      const { codex } = await providerVersionsReader(() => resolveCodexProgram(context), noClaude)()
      expect(codex.program?.said).toBe(`Codex 0.160.0, the copy BroCrew carries, at ${binary}.`)
      // ⚑ Plain words: the path is the real one, and nothing else says how the copy is packed.
      expect(codex.program?.said.replace(binary, '')).not.toMatch(/vendor|SDK/i)
    })

    it('a copy that is not there is the program’s own sentence, and nothing runs', async () => {
      const context = { ...darwinArm, isPackaged: true, resourcesPath: scratch }
      const { codex } = await providerVersionsReader(() => resolveCodexProgram(context), noClaude)()
      expect(codex.program).toMatchObject({ standing: 'missing', from: null, path: null })
      expect(codex.program?.said).toMatch(/Reinstall BroCrew to restore it/)
    })
  })

  describe('packaged resolution', () => {
    it('resolves under resourcesPath in the extraResources layout', () => {
      // The process.resourcesPath simulation: the packaged branch must build exactly the path
      // electron-builder's extraResources mapping produces.
      const binary = plantBinary(scratch, PACKAGED_CODEX_DIR)
      const resolved = resolveCodexBinary({
        ...darwinArm,
        isPackaged: true,
        resourcesPath: scratch,
      })
      expect(resolved).toBe(binary)
    })

    it('a missing packaged binary is actionable — the path and "reinstall", never ENOENT', () => {
      const attempt = () =>
        resolveCodexBinary({ ...darwinArm, isPackaged: true, resourcesPath: scratch })
      expect(attempt).toThrow(CodexUnavailableError)
      expect(attempt).toThrow(/Codex isn't available/)
      expect(attempt).toThrow(new RegExp(PACKAGED_CODEX_DIR))
      expect(attempt).toThrow(/Reinstall/)
      expect(attempt).not.toThrow(/ENOENT/)
    })

    it('⚑ F072 · on Windows x64 it is `codex.exe`, under the Windows triple, in the same folder', () => {
      // The layout Codex's own launcher reads (`codex-cli/bin/codex.js`), copied by `win:`'s
      // extraResources to the same `codex-vendor` folder the Mac build uses.
      const binary = plantBinary(scratch, PACKAGED_CODEX_DIR, WINDOWS)
      expect(binary.endsWith(join('x86_64-pc-windows-msvc', 'bin', 'codex.exe'))).toBe(true)
      expect(resolveCodexBinary({ ...windowsX64, isPackaged: true, resourcesPath: scratch })).toBe(
        binary,
      )
    })

    it('a binary that exists but cannot execute gets the same actionable error', () => {
      const binary = plantBinary(scratch, PACKAGED_CODEX_DIR)
      chmodSync(binary, 0o644)
      expect(() =>
        resolveCodexBinary({ ...darwinArm, isPackaged: true, resourcesPath: scratch }),
      ).toThrow(/missing or not executable/)
    })
  })

  it('an unsupported platform says which platform, and which two are bundled', () => {
    const attempt = () =>
      resolveCodexBinary({
        platform: 'linux',
        arch: 'x64',
        isPackaged: true,
        resourcesPath: scratch,
      })
    expect(attempt).toThrow(CodexUnavailableError)
    expect(attempt).toThrow(/macOS arm64 and Windows x64 only/)
    expect(attempt).toThrow(/linux\/x64/)
  })

  describe('electron-builder wiring', () => {
    // No YAML parser in the repo and none needed — but substring checks were not enough either:
    // a commented-out block, a renamed `to:` with a suffix, or two half-right mappings would all
    // "contain" the literals. So the assertions are anchored: the mapping must be ONE contiguous
    // uncommented from/to pair, and the destination line must end exactly at the constant.
    const config = readFileSync(join(here, '../electron-builder.yml'), 'utf8')
    /** ⚑ F072 — one top-level section of the file: its key's line, to the next top-level key. */
    const section = (key: string): string => {
      const lines = config.split('\n')
      const at = lines.indexOf(`${key}:`)
      expect(at, `no top-level ${key}: section`).toBeGreaterThanOrEqual(0)
      const end = lines.findIndex((line, index) => index > at && /^[^\s#]/.test(line))
      return lines.slice(at, end === -1 ? undefined : end).join('\n')
    }
    const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    it('copies each platform package vendor tree, contiguously, to exactly the resolver dir — in its own platform section', () => {
      // ⚑ F072 — each platform copies only the Codex build it can run: the Mac's under `mac:`,
      // Windows' under `win:`, never one in the other.
      for (const [key, bundled, other] of [
        ['mac', DARWIN, WINDOWS],
        ['win', WINDOWS, DARWIN],
      ] as const) {
        const mapping = new RegExp(
          `^\\s*- from: ${escaped(`node_modules/${bundled.package}/vendor`)}\\n\\s*to: ${PACKAGED_CODEX_DIR}$`,
          'm',
        )
        expect(section(key), key).toMatch(mapping)
        expect(section(key), key).not.toContain(other.package)
      }
    })

    it('keeps each vendor tree OUT of the packed node_modules — shipped once, not twice', () => {
      // electron-builder packs production node_modules (optionalDependencies included) in a
      // pass a custom `files` pattern does not scope; only this negation reaches it. Without
      // it the ~310MB vendor tree ships twice — the asar copy unreachable dead weight.
      for (const bundled of [DARWIN, WINDOWS]) {
        expect(config).toMatch(new RegExp(`^\\s*- '!node_modules/${bundled.package}/\\*\\*'$`, 'm'))
      }
    })

    it('unpacks the native database module — dlopen cannot open a file inside app.asar', () => {
      // 020 built this for real, and better-sqlite3's prebuilt .node turned out to be N-API, so
      // no Electron-ABI rebuild was needed — but it still has to be a real file on disk. Deleting
      // this line breaks ONLY the packaged app, at launch, in a way no unit test or dev run would
      // ever notice: the pinning is here because the failure is invisible everywhere else.
      expect(config).toMatch(/^asarUnpack:$/m)
      expect(config).toMatch(/^\s*- '\*\*\/node_modules\/better-sqlite3\/\*\*'$/m)
    })

    it('ships no Claude Code — every Agent SDK platform package is kept out, the SDK itself is not', () => {
      // The SDK's platform packages are its optional dependencies, each a whole Claude Code binary,
      // and electron-builder's node_modules pass packs optional dependencies unless a negation
      // reaches them.
      const negation = /^\s*- '!\*\*\/node_modules\/@anthropic-ai\/claude-agent-sdk-\*\/\*\*'$/m
      const line = negation.exec(config)
      expect(line, 'no negation keeps the Agent SDK platform packages out').not.toBeNull()
      // The pattern, read as electron-builder's glob reads it: every platform package, at the top
      // of node_modules or nested under the SDK, and never the SDK's own JavaScript, which ships.
      const glob = /'!(.*)'/.exec(line![0])![1]!
      const matcher = new RegExp(
        `^${glob
          .split('**/')
          .map((part) =>
            escaped(part)
              .replace(/\\\*\\\*$/, '.*')
              .replace(/\\\*/g, '[^/]*'),
          )
          .join('(?:.*/)?')}$`,
      )
      for (const shipped of [
        'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
        'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64/claude.exe',
        'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl/claude',
        'node_modules/@anthropic-ai/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
      ]) {
        expect(matcher.test(shipped), shipped).toBe(true)
      }
      for (const kept of [
        'node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs',
        'node_modules/@anthropic-ai/claude-agent-sdk/package.json',
      ]) {
        expect(matcher.test(kept), kept).toBe(false)
      }
      // Nothing unpacks one: an asarUnpack line for a platform package would claim the app runs
      // the binary inside it.
      expect(section('asarUnpack')).not.toContain('claude-agent-sdk')
      expect(config).not.toMatch(
        /^\s*- '\*\*\/node_modules\/@anthropic-ai\/claude-agent-sdk-[\w-]+\/\*\*'$/m,
      )
    })

    it('builds each platform for the arch whose codex it bundles — macOS arm64, Windows x64', () => {
      // A universal or a mismatched arch would ship an app whose bundled Codex cannot run; the
      // resolver fails those closed, and the build must not produce one. Asserted against the
      // DECLARATIONS rather than the file, or the header's own prose about other arches fails.
      const declarations = (text: string): string =>
        text
          .split('\n')
          .filter((line) => !line.trim().startsWith('#'))
          .join('\n')
      expect(declarations(section('mac'))).toMatch(/^\s*arch: \[arm64\]$/m)
      expect(declarations(section('mac'))).not.toMatch(/universal|x64/)
      expect(declarations(section('win'))).toMatch(/^\s*- target: nsis\n\s*arch: \[x64\]$/m)
      expect(declarations(section('win'))).not.toMatch(/universal|arm64|ia32/)
    })

    it('ships the third-party notices Apache-2.0 §4 requires alongside the binary', () => {
      expect(config).toMatch(
        /^\s*- from: THIRD-PARTY-NOTICES\.md\n\s*to: THIRD-PARTY-NOTICES\.md$/m,
      )
      const notices = readFileSync(join(here, '../THIRD-PARTY-NOTICES.md'), 'utf8')
      expect(notices).toContain('@openai/codex')
      expect(notices).toContain('Apache License')
      expect(notices).toContain('Version 2.0, January 2004')
    })
  })

  describe('the resolved command reaches the actual spawn', () => {
    it('createProviderRuntime threads codexCommand into the process that starts', async () => {
      // The thunk-count test proves codexCommand is CALLED; this proves the value is what SPAWNS.
      // Without it, a codex branch that called the thunk and discarded the result — falling back
      // to the default bare-`codex` transport — would pass every unit test in the repo. The
      // recorder script writes its own $0: if the spawned argv0 is the script's path, the chain
      // resolver → seams → runtime → transport → spawn held end to end.
      const recorder = join(scratch, 'record-codex')
      const witness = join(scratch, 'spawned.txt')
      writeFileSync(recorder, `#!/bin/sh\necho "$0" > "${witness}"\ncat > /dev/null\n`)
      chmodSync(recorder, 0o755)

      const runtime = createProviderRuntime('codex', {
        codexCommand: () => recorder,
        claudeProgram: () => {
          throw new Error('a Codex launch never asks for Claude Code')
        },
      })
      // The factory is the runtime's spawn seam — private to TS, but invoking it IS the spawn,
      // and reaching it here beats driving a full handshake against a fake app-server.
      const factory = (runtime as unknown as { transportFactory: TransportFactory })
        .transportFactory
      const transport = factory({ cwd: scratch, providerHome: scratch })
      try {
        const deadline = Date.now() + 5000
        while (!existsSync(witness) && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 25))
        }
        expect(existsSync(witness)).toBe(true)
        expect(readFileSync(witness, 'utf8').trim()).toBe(recorder)
      } finally {
        await transport.close()
      }
    })
  })

  describe('the error the surface shows', () => {
    it("strips Electron's IPC wrapper AND the exception class name — actionable text only", () => {
      // Electron serializes a main-process throw as `${name}: ${message}`, so without the strip
      // the launch error opens with "CodexUnavailableError:" — exception taxonomy, not help.
      const raw = new Error(
        "Error invoking remote method 'runtime:command': CodexUnavailableError: " +
          "Codex isn't available — the bundled Codex binary is missing or not executable at /x.",
      )
      expect(readableError(raw)).toBe(
        "Codex isn't available — the bundled Codex binary is missing or not executable at /x.",
      )
    })
  })
})
