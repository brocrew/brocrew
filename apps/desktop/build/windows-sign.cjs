/* eslint-disable @typescript-eslint/no-require-imports -- electron-builder loads this hook as CommonJS. */
const { spawnSync } = require('node:child_process')
const path = require('node:path')

const SECRET_NAMES = ['ES_USERNAME', 'ES_PASSWORD', 'CREDENTIAL_ID', 'ES_TOTP_SECRET']

function createSigner({ env = process.env, run = spawnSync } = {}) {
  return async function sign(configuration, packager) {
    if (!SECRET_NAMES.some((name) => env[name])) return
    const installer = `BroCrew-Setup-${packager.appInfo.version}-x64`
    const outDir = path.resolve(
      packager.projectDir,
      packager.expandMacro(packager.config.directories.output, 'x64'),
    )
    const file = path.resolve(configuration.path)
    // eSigner bills per signing: sign only the app, the uninstaller and the installer.
    if (
      ![
        path.join(outDir, 'win-unpacked', 'BroCrew.exe'),
        path.join(outDir, `${installer}.exe`),
        path.join(outDir, `${installer}.__uninstaller.exe`),
      ].includes(file)
    ) {
      return
    }
    if (!env.JAVA_HOME || !env.CODE_SIGN_TOOL_PATH) {
      throw new Error('Set up CodeSignTool (JAVA_HOME and CODE_SIGN_TOOL_PATH) before packaging')
    }
    const result = run(
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
    if (result.stdout) process.stdout.write(result.stdout)
    if (result.stderr) process.stderr.write(result.stderr)
    // CodeSignTool can report an error with exit code zero.
    if (
      result.error ||
      result.status !== 0 ||
      /error|exception|missing required|unmatched argument/i.test(
        `${result.stdout || ''}\n${result.stderr || ''}`,
      )
    ) {
      throw new Error(
        `CodeSignTool failed to sign ${path.basename(file)}: ${result.error ? result.error.message : `exit code ${result.status}`}`,
      )
    }
  }
}

module.exports = createSigner()
module.exports.createSigner = createSigner
