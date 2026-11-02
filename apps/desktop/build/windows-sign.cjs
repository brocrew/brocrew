/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this hook as CommonJS. */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const SECRET_NAMES = ['ES_USERNAME', 'ES_PASSWORD', 'CREDENTIAL_ID', 'ES_TOTP_SECRET']
const THUMBPRINT = '382E2CDE6834E3400371451FEBD6AB5943C71647'

function createSigner({ env = process.env, run = spawnSync, platform = process.platform } = {}) {
  const signed = new Set()
  const quietRun = (...args) => {
    try {
      return run(...args)
    } catch {
      return { status: 1 }
    }
  }
  return async function sign(configuration, packager) {
    const present = SECRET_NAMES.filter((name) => Boolean(env[name]))
    // With no signing account, leave every byte and the updater's existing policy alone.
    if (present.length === 0) return
    if (present.length !== SECRET_NAMES.length) {
      throw new Error('Windows signing requires all four eSigner environment secrets')
    }
    if (
      platform !== 'win32' ||
      env.GITHUB_ACTIONS !== 'true' ||
      env.GITHUB_REPOSITORY !== 'brocrew/brocrew' ||
      !/^refs\/tags\/v\d+\.\d+\.\d+(-beta\.\d+)?$/.test(env.GITHUB_REF || '')
    ) {
      throw new Error('Windows signing is restricted to BroCrew release tags on Windows CI')
    }

    const installer = `BroCrew-Setup-${packager.appInfo.version}-x64`
    const targets = [
      path.resolve(packager.info.outDir, 'win-unpacked', 'BroCrew.exe'),
      path.resolve(packager.info.outDir, `${installer}.exe`),
      path.resolve(packager.info.outDir, `${installer}.__uninstaller.exe`),
    ]
    const file = path.resolve(configuration.path)
    // Builder also offers vendor executables and native modules. They keep their original bytes.
    if (!targets.includes(file)) return
    if (signed.has(file)) throw new Error('Refusing a duplicate Windows signing call')
    if (file === targets[1] && (!signed.has(targets[0]) || !signed.has(targets[2]))) {
      throw new Error('The app and uninstaller must be signed before the installer')
    }
    if (configuration.hash !== 'sha256' || configuration.isNest) {
      throw new Error('Windows signing requires one SHA-256 signature per file')
    }
    if (!env.JAVA_HOME || !env.CODE_SIGN_TOOL_PATH) {
      throw new Error('The pinned eSigner tool and Java must be set up before packaging')
    }

    const result = quietRun(
      path.join(env.JAVA_HOME, 'bin', 'java.exe'),
      [
        '-Xmx1024M',
        '-jar',
        path.join(env.CODE_SIGN_TOOL_PATH, 'jar', 'code_sign_tool-1.3.0.jar'),
        'sign',
        `-username=${env.ES_USERNAME}`,
        `-password=${env.ES_PASSWORD}`,
        `-credential_id=${env.CREDENTIAL_ID}`,
        `-totp_secret=${env.ES_TOTP_SECRET}`,
        `-input_file_path=${file}`,
        '-override=true',
      ],
      {
        cwd: env.CODE_SIGN_TOOL_PATH,
        env,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: 180_000,
      },
    )
    // CodeSignTool can report an error with exit code zero. Never echo its account-bearing output.
    if (
      result.error ||
      result.status !== 0 ||
      /error|exception|missing required|unmatched argument/i.test(
        `${result.stdout || ''}\n${result.stderr || ''}`,
      )
    ) {
      throw new Error('eSigner failed; packaging stopped before update metadata was generated')
    }

    const verificationEnv = { ...env, BROCREW_SIGN_FILE: file }
    for (const name of SECRET_NAMES) delete verificationEnv[name]
    const verified = quietRun(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$s = Get-AuthenticodeSignature -LiteralPath $env:BROCREW_SIGN_FILE; if ($s.Status -ne 'Valid' -or $s.SignerCertificate.Thumbprint -ne '${THUMBPRINT}' -or $s.SignerCertificate.GetNameInfo('SimpleName', $false) -ne 'DEVERP' -or $null -eq $s.TimeStamperCertificate) { exit 1 }`,
      ],
      {
        env: verificationEnv,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        timeout: 60_000,
      },
    )
    if (verified.error || verified.status !== 0) {
      throw new Error('Windows signature must be valid, timestamped and issued to DEVERP')
    }
    signed.add(file)
    console.info(`Verified DEVERP signature: ${path.basename(file)}`)
  }
}

module.exports = createSigner()
module.exports.createSigner = createSigner
