import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(root, 'apps/desktop/package.json'))
const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const libRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const { createSigner } = require(join(root, 'apps/desktop/build/windows-sign.cjs'))
const { WindowsSignToolManager, Packager, WinPackager, Platform } = libRequire('./out/index.js')
const { getAppUpdatePublishConfiguration } = libRequire('./out/publish/PublishManager.js')
const { NsisUpdater } = require('electron-updater/out/NsisUpdater.js')
const { load: parse } = libRequire('js-yaml')
const builder = parse(readFileSync(join(root, 'apps/desktop/electron-builder.yml'), 'utf8'))
const workflow = parse(readFileSync(join(root, '.github/workflows/release.yml'), 'utf8'))
const temps = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const temp of temps.splice(0)) rmSync(temp, { recursive: true, force: true })
})

const fakeEnv = () => ({
  ES_USERNAME: 'fake-user',
  ES_PASSWORD: 'fake-password-with-!&%"-characters',
  CREDENTIAL_ID: 'fake-credential',
  ES_TOTP_SECRET: 'fake-totp',
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'brocrew/brocrew',
  GITHUB_REF: 'refs/tags/v0.2.0',
  JAVA_HOME: '/fictional/java',
  CODE_SIGN_TOOL_PATH: '/fictional/CodeSignTool',
})
const packager = (signtoolOptions = {}, output = 'dist') => {
  const info = new Packager({ projectDir: '/fictional/app' })
  info._configuration = {
    win: { signtoolOptions },
    productName: 'BroCrew',
    directories: { output },
  }
  info._metadata = {
    name: 'fictional-brocrew',
    version: '0.2.0',
    homepage: 'https://example.invalid/',
  }
  info.getWorkspaceRoot = async () => root
  return new WinPackager(info)
}
const task = (file = 'win-unpacked/BroCrew.exe') => ({
  path: join('/fictional/app/dist', file),
  hash: 'sha256',
  isNest: false,
})

describe('Windows release signing', () => {
  it('runs through real Packager, WinPackager and signing manager without an outDir property', async () => {
    const run = vi.fn(() => ({ status: 0 }))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const real = packager({
      ...builder.win.signtoolOptions,
      sign: createSigner({ env: fakeEnv(), run, platform: 'win32' }),
    })
    vi.spyOn(real, 'getCscLink').mockReturnValue(null)
    expect(real.outDir).toBeUndefined()
    expect(real.info).toBeInstanceOf(Packager)
    expect(real.info.outDir).toBeUndefined()
    for (const file of [
      'win-unpacked/BroCrew.exe',
      'BroCrew-Setup-0.2.0-x64.__uninstaller.exe',
      'BroCrew-Setup-0.2.0-x64.exe',
    ])
      await real.signIf(task(file).path)
    expect(run).toHaveBeenCalledTimes(6)
    expect(run.mock.calls.filter(([, args]) => args.includes('sign'))).toHaveLength(3)
  })

  it('expands the configured output macros with the real builder before choosing signing targets', async () => {
    const run = vi.fn(() => ({ status: 0 }))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const real = packager(
      {
        ...builder.win.signtoolOptions,
        sign: createSigner({ env: fakeEnv(), run, platform: 'win32' }),
      },
      'packages/${os}/${arch}',
    )
    vi.spyOn(real, 'getCscLink').mockReturnValue(null)
    for (const name of [
      'win-unpacked/BroCrew.exe',
      'BroCrew-Setup-0.2.0-x64.__uninstaller.exe',
      'BroCrew-Setup-0.2.0-x64.exe',
    ])
      await real.signIf(join('/fictional/app/packages/win/x64', name))
    expect(run).toHaveBeenCalledTimes(6)
  })

  it('no secrets means no child process and identical bytes for every offered file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'brocrew-signing-'))
    temps.push(dir)
    const run = vi.fn()
    const sign = createSigner({ env: {}, run })
    for (const name of [
      'BroCrew.exe',
      'node.exe',
      'codex.exe',
      'installer.exe',
      'uninstaller.exe',
    ]) {
      const file = join(dir, name)
      const bytes = Buffer.from(`original ${name}\0\xff`)
      writeFileSync(file, bytes)
      const before = createHash('sha256').update(bytes).digest('hex')
      await sign({ path: file }, {})
      expect(createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(before)
    }
    expect(run).not.toHaveBeenCalled()
  })

  it('signs only the three exact builder output paths, then verifies each signature', async () => {
    const run = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const env = fakeEnv()
    const sign = createSigner({ env, run, platform: 'win32' })
    for (const name of [
      'win-unpacked/BroCrew.exe',
      'BroCrew-Setup-0.2.0-x64.__uninstaller.exe',
      'BroCrew-Setup-0.2.0-x64.exe',
    ])
      await sign(task(name), packager())
    expect(run).toHaveBeenCalledTimes(6)
    for (let i = 0; i < 6; i += 2) {
      const [command, args, options] = run.mock.calls[i]
      expect(command).toBe(join(env.JAVA_HOME, 'bin', 'java.exe'))
      expect(args).toContain('sign')
      expect(args).toContain(`-password=${env.ES_PASSWORD}`)
      expect(args).toContain('-override=true')
      expect(options.shell).toBeUndefined()
      expect(options.windowsHide).toBe(true)
      expect(options.stdio).toEqual(['ignore', 'pipe', 'pipe'])
      const [verify, verifyArgs, verifyOptions] = run.mock.calls[i + 1]
      expect(verify).toBe('powershell.exe')
      expect(verifyArgs.join(' ')).toMatch(
        /Valid.*382E2CDE6834E3400371451FEBD6AB5943C71647.*DEVERP.*TimeStamperCertificate/,
      )
      expect(verifyOptions.env.ES_PASSWORD).toBeUndefined()
    }
  })

  it('never offers bundled programs or other same-name files to eSigner', async () => {
    const run = vi.fn()
    const sign = createSigner({ env: fakeEnv(), run, platform: 'win32' })
    for (const name of [
      'win-unpacked/resources/plugin-node/node.exe',
      'win-unpacked/resources/codex-vendor/bin/codex.exe',
      'win-unpacked/resources/codex-vendor/bin/BroCrew.exe',
      'win-unpacked/resources/BroCrew-Setup-0.2.0-x64.exe',
      'win-unpacked/elevate.exe',
      'win-unpacked/resources/native.node',
    ])
      await sign(task(name), packager())
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses duplicate signings and cannot finish an installer with an unsigned app or uninstaller', async () => {
    const run = vi.fn(() => ({ status: 0 }))
    vi.spyOn(console, 'info').mockImplementation(() => {})
    const sign = createSigner({ env: fakeEnv(), run, platform: 'win32' })
    await expect(sign(task('BroCrew-Setup-0.2.0-x64.exe'), packager())).rejects.toThrow(
      /app and uninstaller/,
    )
    expect(run).not.toHaveBeenCalled()
    await sign(task(), packager())
    await expect(sign(task(), packager())).rejects.toThrow(/duplicate/)
    await expect(sign(task('BroCrew-Setup-0.2.0-x64.exe'), packager())).rejects.toThrow(
      /app and uninstaller/,
    )
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('refuses partial secrets, non-release refs, other repos, non-Windows and dual signing', async () => {
    const run = vi.fn()
    for (const env of [
      { ES_USERNAME: 'fake' },
      { ...fakeEnv(), GITHUB_REF: 'refs/heads/gate/candidate' },
      { ...fakeEnv(), GITHUB_REF: 'refs/tags/windows-beta-1' },
      { ...fakeEnv(), GITHUB_REPOSITORY: 'other/repository' },
      { ...fakeEnv(), GITHUB_ACTIONS: 'false' },
      { ...fakeEnv(), JAVA_HOME: '' },
    ])
      await expect(
        createSigner({ env, run, platform: 'win32' })(task(), packager()),
      ).rejects.toThrow()
    await expect(
      createSigner({ env: fakeEnv(), run, platform: 'darwin' })(task(), packager()),
    ).rejects.toThrow()
    const sign = createSigner({ env: fakeEnv(), run, platform: 'win32' })
    await expect(sign({ ...task(), hash: 'sha1' }, packager())).rejects.toThrow(/one SHA-256/)
    await expect(sign({ ...task(), isNest: true }, packager())).rejects.toThrow(/one SHA-256/)
    expect(run).not.toHaveBeenCalled()
  })

  it.each([
    { status: 1, stdout: 'fake-password' },
    { status: 0, stdout: 'Error: fake-password' },
    { status: 0, stderr: 'Exception: fake-password' },
    { status: null, error: new Error('fake-password') },
  ])(
    'stops packaging on tool failure without echoing account-bearing diagnostics: %j',
    async (result) => {
      const run = vi.fn(() => result)
      const sign = createSigner({ env: fakeEnv(), run, platform: 'win32' })
      await expect(sign(task(), packager())).rejects.toThrow(
        'eSigner failed; packaging stopped before update metadata was generated',
      )
      expect(run).toHaveBeenCalledTimes(1)
    },
  )

  it('redacts thrown process errors and rejects invalid or untimestamped signatures', async () => {
    const run = vi.fn(() => {
      throw new Error('fake-password')
    })
    const sign = createSigner({ env: fakeEnv(), run, platform: 'win32' })
    await expect(sign(task(), packager())).rejects.toThrow(/^eSigner failed;/)
    run.mockReset().mockReturnValueOnce({ status: 0 }).mockReturnValueOnce({ status: 1 })
    await expect(sign(task(), packager())).rejects.toThrow(
      'Windows signature must be valid, timestamped and issued to DEVERP',
    )
  })

  it('the installed builder invokes the hook once per SHA-256 file and sets publisher only when supplied', async () => {
    const execute = vi.fn()
    const options = { signtoolOptions: { ...builder.win.signtoolOptions, sign: execute } }
    const manager = new WindowsSignToolManager({
      platformSpecificBuildOptions: options,
      appInfo: { productName: 'BroCrew', computePackageUrl: async () => null },
      getCscLink: () => null,
      info: { getWorkspaceRoot: async () => root },
    })
    for (const name of ['BroCrew.exe', 'installer.exe', 'uninstaller.exe']) {
      await manager.signFile({ path: name, options })
    }
    expect(execute).toHaveBeenCalledTimes(3)
    expect(execute.mock.calls.map(([config]) => config.hash)).toEqual([
      'sha256',
      'sha256',
      'sha256',
    ])
    expect(await manager.computedPublisherName.value).toBeNull()
    const signed = new WindowsSignToolManager({
      platformSpecificBuildOptions: {
        signtoolOptions: { ...options.signtoolOptions, publisherName: 'DEVERP' },
      },
    })
    expect(await signed.computedPublisherName.value).toEqual(['DEVERP'])
  })

  it('the installed updater accepts unsigned policy and enforces DEVERP once configured', async () => {
    const verify = vi.fn(async () => 'unsigned or wrong publisher')
    const context = (config) => ({
      configOnDisk: { value: Promise.resolve(config) },
      _verifyUpdateCodeSignature: verify,
    })
    expect(
      await NsisUpdater.prototype.verifySignature.call(context({}), 'candidate.exe'),
    ).toBeNull()
    expect(verify).not.toHaveBeenCalled()
    expect(
      await NsisUpdater.prototype.verifySignature.call(
        context({ publisherName: ['DEVERP'] }),
        'candidate.exe',
      ),
    ).toBe('unsigned or wrong publisher')
    expect(verify).toHaveBeenCalledWith(['DEVERP'], 'candidate.exe')
    verify.mockResolvedValue(null)
    expect(
      await NsisUpdater.prototype.verifySignature.call(
        context({ publisherName: ['DEVERP'] }),
        'candidate.exe',
      ),
    ).toBeNull()
  })

  it('the installed builder omits publisher policy for unsigned apps and writes DEVERP for signed apps', async () => {
    const configFor = async (publisherName) => {
      const options = { signtoolOptions: { ...builder.win.signtoolOptions, publisherName } }
      const manager = new WindowsSignToolManager({
        platformSpecificBuildOptions: options,
        getCscLink: () => null,
      })
      return getAppUpdatePublishConfiguration(
        {
          platform: Platform.WINDOWS,
          platformSpecificBuildOptions: options,
          config: { publish: { provider: 'generic', url: 'https://updates.example.invalid/' } },
          info: { config: {}, appInfo: { channel: null } },
          appInfo: { updaterCacheDirName: 'brocrew-updater' },
          isForceCodeSigningVerification: true,
          signingManager: { value: Promise.resolve(manager) },
          expandMacro: (value) => value,
        },
        null,
        1,
        true,
      )
    }
    const unsigned = await configFor(undefined)
    expect(unsigned).toEqual({
      provider: 'generic',
      url: 'https://updates.example.invalid/',
      updaterCacheDirName: 'brocrew-updater',
    })
    expect(await configFor('DEVERP')).toEqual({ ...unsigned, publisherName: ['DEVERP'] })
  })

  it('the installed NSIS target signs before creating the blockmap or publishing update info', () => {
    const source = readFileSync(libRequire.resolve('./out/targets/nsis/NsisTarget.js'), 'utf8')
    const signed = source.indexOf('packager.signIf(installerPath)')
    const blockmap = source.indexOf('createBlockmap)(installerPath', signed)
    const metadata = source.indexOf('emitArtifactBuildCompleted', signed)
    expect(signed).toBeGreaterThan(0)
    expect(blockmap).toBeGreaterThan(signed)
    expect(metadata).toBeGreaterThan(blockmap)
    expect(source).toContain('await packager.signIf(uninstallerPath)')
  })

  it('only the release Windows job uses signing secrets, with a pinned setup and conditional publisher policy', () => {
    const win = workflow.jobs.windows
    expect(win.environment).toBe('windows-signing')
    const setup = win.steps.find((step) => step.name === 'Set up CodeSignTool')
    expect(setup.uses).toBe('sslcom/esigner-codesign@b7f8ff36fc0de8690fbbab8e5b4421d29802f747')
    expect(setup.with.command).toBe('--version')
    expect(setup.if).toContain("steps.signing.outputs.enabled == 'true'")
    expect(setup.with.username).toBeUndefined()
    expect(builder.win.signtoolOptions.publisherName).toBeUndefined()
    expect(builder.win.signtoolOptions.sign).toBe('./build/windows-sign.cjs')
    for (const name of ['windows.yml', 'ci.yml', 'upgrade-path.yml']) {
      expect(readFileSync(join(root, '.github/workflows', name), 'utf8')).not.toMatch(
        /windows-signing|secrets\.(ES_USERNAME|ES_PASSWORD|CREDENTIAL_ID|ES_TOTP_SECRET)/,
      )
    }
    for (const [name, job] of Object.entries(workflow.jobs)) {
      if (name !== 'windows')
        expect(JSON.stringify(job)).not.toMatch(
          /secrets\.(ES_USERNAME|ES_PASSWORD|CREDENTIAL_ID|ES_TOTP_SECRET)/,
        )
    }
    const build = win.steps.find((step) => step.name === 'Build and package (NSIS, x64)')
    expect(build.run).toContain('if [ "$WINDOWS_SIGNING_ENABLED" = true ]; then')
    expect(build.run).toContain('signing+=(-c.win.signtoolOptions.publisherName=DEVERP)')
  })
})
