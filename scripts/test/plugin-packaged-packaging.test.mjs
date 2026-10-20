import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { command, buildEnvironment } from '../gates/plugin-packaged/prepare.mjs'
import { digest, safeReport } from '../gates/plugin-packaged/contract.mjs'
import { builderOutputClass, printFailure } from '../gates/plugin-packaged/diagnostics.mjs'
import {
  directoryPackageArguments,
  hostedBuilder,
  requireLocalRehearsal,
  localDirectoryPackageArguments,
} from '../gates/plugin-packaged/packaging.mjs'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const appRequire = createRequire(path.join(repository, 'apps/desktop/package.json'))
const builderRequire = createRequire(appRequire.resolve('electron-builder/package.json'))
const libPackage = builderRequire.resolve('app-builder-lib/package.json')
const libRequire = createRequire(libPackage)
const roots = []
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-dir-package-')))
  roots.push(root)
  fs.chmodSync(root, 0o700)
  fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n')
  const app = path.join(root, 'Fern.app'),
    runtime = path.join(app, 'Contents/Resources/plugin-node/node')
  fs.mkdirSync(path.dirname(runtime), { recursive: true })
  fs.writeFileSync(runtime, 'fictional pinned runtime')
  fs.writeFileSync(
    path.join(path.dirname(runtime), 'runtime.json'),
    JSON.stringify({ sha256: digest(fs.readFileSync(runtime)) }),
  )
  const entitlements = path.join(root, 'entitlements.plist')
  fs.writeFileSync(entitlements, '<?xml version="1.0"?><plist version="1.0"><dict/></plist>')
  return { root, app, runtime, entitlements }
}

describe.skipIf(process.platform !== 'darwin')('directory-only keyless gate packaging', () => {
  it('refuses the local unsigned rehearsal on any hosted or self-hosted runner', () => {
    expect(() => requireLocalRehearsal({}, 'darwin', 'arm64')).not.toThrow()
    for (const env of [
      { GITHUB_ACTIONS: 'true' },
      { GITHUB_ACTIONS: 'false' },
      { CI: 'true' },
      { RUNNER_ENVIRONMENT: 'github-hosted' },
      { RUNNER_ENVIRONMENT: 'self-hosted' },
    ])
      expect(() => requireLocalRehearsal(env, 'darwin', 'arm64')).toThrow()
    expect(() => requireLocalRehearsal({}, 'linux', 'arm64')).toThrow()
    vi.stubEnv('RUNNER_ENVIRONMENT', 'github-hosted')
    expect(() => localDirectoryPackageArguments()).toThrow('Local Mac build rehearsal only')
  })
  it('refuses local Builder execution before any certificate discovery', async () => {
    vi.stubEnv('RUNNER_ENVIRONMENT', 'self-hosted')
    const work = vi.fn()
    await expect(hostedBuilder(work)).rejects.toThrow('Private Mac gate only')
    expect(work).not.toHaveBeenCalled()
  })
  it('the actual builder parser selects only dir and the normal ad-hoc identity, overriding the normal DMG defaults', () => {
    const builder = builderRequire('./out/builder.js')
    const args = directoryPackageArguments()
    const parsed = builder
      .configureBuildCommand(builder.createYargs())
      .parse(args.slice(args.indexOf('electron-builder') + 1))
    const options = builder.normalizeOptions(parsed)
    expect(options.config.mac.identity).toBe('-')
    expect(options.config.mac.signIgnore).toBe('/Contents/Resources/plugin-node/node$')
    const targetLists = [...options.targets.values()].flatMap((architectures) => [
      ...architectures.values(),
    ])
    expect(targetLists).toEqual([['dir']])
    expect(
      fs.readFileSync(path.join(repository, 'apps/desktop/electron-builder.yml'), 'utf8'),
    ).toContain('- target: dmg')
  })
  it.skipIf(process.arch !== 'arm64')(
    'the guarded local arguments disable Builder signing rather than selecting an identity',
    () => {
      vi.stubEnv('GITHUB_ACTIONS', undefined)
      vi.stubEnv('RUNNER_ENVIRONMENT', undefined)
      vi.stubEnv('CI', undefined)
      const builder = builderRequire('./out/builder.js'),
        args = localDirectoryPackageArguments()
      const options = builder.normalizeOptions(
        builder
          .configureBuildCommand(builder.createYargs())
          .parse(args.slice(args.indexOf('electron-builder') + 1)),
      )
      expect(options.config.mac.identity).toBe(null)
    },
  )
  it('the actual builder resolves the in-app hook with either app or workspace root', async () => {
    const { root } = fixture(),
      project = path.join(root, 'apps/desktop'),
      tools = path.join(root, 'declared-tools')
    fs.mkdirSync(project, { recursive: true })
    fs.mkdirSync(path.join(root, 'scripts'))
    fs.mkdirSync(path.join(project, 'build'))
    fs.copyFileSync(
      path.join(repository, 'apps/desktop/build/before-pack.cjs'),
      path.join(project, 'build/before-pack.cjs'),
    )
    fs.mkdirSync(tools)
    fs.writeFileSync(
      path.join(project, 'package.json'),
      JSON.stringify({ name: 'fictional-desktop', packageManager: 'pnpm@10.11.0' }),
    )
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({ name: 'fictional-root', packageManager: 'pnpm@10.11.0' }),
    )
    fs.writeFileSync(
      path.join(root, 'scripts/prepare-plugin-node-before-pack.cjs'),
      'module.exports = async () => 42',
    )
    const pnpm = path.join(tools, 'pnpm')
    fs.writeFileSync(pnpm, "#!/bin/sh\nprintf '%s\n' " + JSON.stringify(root) + '\n', {
      mode: 0o700,
    })
    const resolver = libRequire.resolve('./out/util/resolve.js')
    const collector = libRequire.resolve('./out/node-module-collector/index.js')
    const probe = `
const {createRequire}=require('node:module');
const req=createRequire(${JSON.stringify(resolver)});
const {resolveFunction}=req(${JSON.stringify(resolver)});
const {determinePackageManagerEnv}=req(${JSON.stringify(collector)});
(async()=>{
const manager=await determinePackageManagerEnv({projectDir:process.cwd(),appDir:process.cwd()}).value;
const root=await manager.workspaceRoot||process.cwd();
const fn=await resolveFunction('commonjs','./build/before-pack.cjs','beforePack',root);
if(await fn()!==42)process.exit(3);
})().catch(()=>process.exit(4));`
    await expect(
      command(process.execPath, ['-e', probe], root, {}, project, 'app-package'),
    ).resolves.toEqual(expect.any(String))
    await expect(
      command(
        process.execPath,
        ['-e', probe],
        root,
        buildEnvironment(root, pnpm),
        project,
        'app-package',
      ),
    ).resolves.toEqual(expect.any(String))
  })
  it('the builder skips before its keychain/identity getter when identity is null', async () => {
    const { MacPackager } = libRequire('./out/macPackager.js')
    let skipped = false
    const fake = {
      helper: {
        handleNullIdentity() {
          skipped = true
          return false
        },
      },
      get codeSigningInfo() {
        throw new Error('Keychain discovery must not run')
      },
    }
    expect(
      await MacPackager.prototype.sign.call(
        fake,
        '/fictional/Fern.app',
        '/fictional',
        { identity: null },
        3,
      ),
    ).toBe(false)
    expect(skipped).toBe(true)
  })
  it('the dash identity follows Builder discovery then uses its normal ad-hoc fallback', async () => {
    const codeSign = libRequire('./out/codeSign/macCodeSign.js')
    const find = vi.spyOn(codeSign, 'findIdentity').mockResolvedValue(null)
    const { MacTargetHelper } = libRequire('./out/mac/MacTargetHelper.js')
    const helper = new MacTargetHelper({})
    const identity = await helper.findSigningIdentity(false, false, '-', undefined, {})
    expect(identity.name).toBe('-')
    expect(find).toHaveBeenCalledWith('Developer ID Application', '-', undefined)
  })
  it('uses Builder normal hardened-runtime/entitlement policy and ignores only the pinned Node', async () => {
    const { app, runtime } = fixture()
    const { MacTargetHelper } = libRequire('./out/mac/MacTargetHelper.js')
    const helper = new MacTargetHelper({
      resourceList: Promise.resolve([]),
      config: {},
      platformSpecificBuildOptions: {},
    })
    const options = await helper.buildSignOptions(
      app,
      { name: '-' },
      'distribution',
      false,
      { signIgnore: '/Contents/Resources/plugin-node/node$' },
      undefined,
      3,
    )
    expect(options.identity).toBe('-')
    expect(options.ignore(runtime)).toBe(true)
    expect(options.ignore(runtime + '-foreign')).toBe(false)
    expect(options.ignore(app)).toBe(false)
    for (const file of [app, path.join(app, 'Contents/Frameworks/Fern Helper.app')]) {
      const policy = options.optionsForFile(file)
      expect(policy.hardenedRuntime).toBe(true)
      expect(fs.readFileSync(policy.entitlements, 'utf8')).toContain(
        'com.apple.security.cs.allow-jit',
      )
    }
  })
  it.each([
    ['hdiutil create /fictional/image.dmg', 'builder-dmg'],
    ['/usr/bin/security find-identity HOME=/fictional', 'builder-keychain'],
    ['security: errSecInternalComponent /fictional', 'builder-keychain'],
    ['SecKeychain: user interaction is not allowed', 'builder-keychain'],
    ['codesign failed to sign /fictional/Fern.app', 'builder-codesign'],
    ['download https://example.invalid/fictional failed', 'builder-download'],
    ['ENOSPC no space left on device /fictional', 'builder-enospc'],
  ])(
    'classifies packaging failures without retaining command/path/env text (%s)',
    async (text, kind) => {
      expect(builderOutputClass(text)).toBe(kind)
      const { root } = fixture()
      let failure
      await command(
        process.execPath,
        ['-e', `console.error(${JSON.stringify(text)});process.exit(1)`],
        root,
        {},
        repository,
        'app-package',
      ).catch((error) => {
        failure = error.failure
      })
      expect(failure).toEqual({ phase: 'app-package', errorClass: kind, exitCode: 1, signal: null })
      expect(safeReport({ failure })).toBe(true)
      const lines = []
      printFailure(failure, (line) => lines.push(line))
      expect(lines.join('') + JSON.stringify(failure)).not.toMatch(
        /fictional|HOME|https|find-identity|usr|example|SecKeychain|space left/,
      )
    },
  )
})
