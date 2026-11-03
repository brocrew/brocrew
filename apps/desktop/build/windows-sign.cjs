/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this hook as CommonJS. */
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const { appendFileSync, copyFileSync, constants, readFileSync } = require('node:fs')
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
    const recordDir = env.BROCREW_WINDOWS_SIGNING_RECORD_DIR
    if (recordDir && present.length) {
      throw new Error('Record-only Windows packaging requires no eSigner secrets')
    }
    // With no signing account, leave every byte and the updater's existing policy alone.
    if (!recordDir && present.length === 0) return
    if (!recordDir && present.length !== SECRET_NAMES.length) {
      throw new Error('Windows signing requires all four eSigner environment secrets')
    }
    if (
      platform !== 'win32' ||
      env.GITHUB_ACTIONS !== 'true' ||
      env.GITHUB_REPOSITORY !== 'brocrew/brocrew' ||
      (!recordDir && !/^refs\/tags\/v\d+\.\d+\.\d+(-beta\.\d+)?$/.test(env.GITHUB_REF || ''))
    ) {
      throw new Error('Windows signing is restricted to BroCrew release tags on Windows CI')
    }

    const installer = `BroCrew-Setup-${packager.appInfo.version}-x64`
    const outDir = path.resolve(
      packager.projectDir,
      packager.expandMacro(packager.config.directories.output, 'x64'),
    )
    const targets = [
      path.join(outDir, 'win-unpacked', 'BroCrew.exe'),
      path.join(outDir, `${installer}.exe`),
      path.join(outDir, `${installer}.__uninstaller.exe`),
    ]
    const file = path.resolve(configuration.path)
    // Record actual callback bytes, preserving the transient uninstaller before builder deletes it.
    // This branch always returns before any signing or verification subprocess can run.
    if (recordDir) {
      if (!path.isAbsolute(recordDir) || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA || '')) {
        throw new Error('Record-only packaging needs an absolute evidence directory and commit SHA')
      }
      const role = ['app', 'installer', 'uninstaller'][targets.indexOf(file)] || null
      const bytes = readFileSync(file)
      if (role === 'uninstaller') {
        copyFileSync(file, path.join(recordDir, 'uninstaller.exe'), constants.COPYFILE_EXCL)
      }
      appendFileSync(
        path.join(recordDir, 'callbacks.jsonl'),
        JSON.stringify({
          mode: 'record-only',
          sha: env.GITHUB_SHA,
          path: file,
          role,
          hash: configuration.hash,
          isNest: Boolean(configuration.isNest),
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        }) + '\n',
      )
      return
    }
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
