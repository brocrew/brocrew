/**
 * 🔴 **The secret scan hides what it finds — proven on a fake secret before it scans anything.**
 *
 * `.github/workflows/public-checks.yml` scans the repository with gitleaks and `--redact`, in a
 * public repository's public log. ⛔ A scan that printed a real secret would publish it a second
 * time, so before the scan runs, this makes a secret-shaped value that exists nowhere else (made
 * here, at run time, so the tree never carries one), scans a folder holding only it, and refuses
 * unless gitleaks:
 *  - found it (a scan that finds nothing proves nothing about hiding), and
 *  - printed none of it, in its output or in its report, and wrote `REDACTED` where it was.
 *
 * Run: `node scripts/secret-scan-redaction-check.mjs [path-to-gitleaks]` (default `gitleaks` on
 * `PATH`). The test holds the verdict on made-up gitleaks answers (`secret-scan.test.mjs`).
 */
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/**
 * ⚑ A value in the shape of a GitHub personal access token — `ghp_` and 36 letters and digits,
 * which gitleaks' own `github-pat` rule matches — made of fresh random bytes, so it is nobody's.
 */
export function aFakeSecret() {
  let body = ''
  for (const byte of randomBytes(36)) body += ALPHANUMERIC[byte % ALPHANUMERIC.length]
  return `ghp_${body}`
}

/**
 * 🔴 **The verdict** on one scan of a folder holding only `secret`: `null` when it held, else why
 * not. ⚑ Any 12 characters of the secret's body showing counts as showing it.
 */
export function redactionVerdict({ secret, status, output, report }) {
  if (status !== 1) {
    return `gitleaks answered ${String(status)}, not 1: it found nothing, so its hiding is unproven`
  }
  const body = secret.slice('ghp_'.length)
  const pieces = []
  for (let at = 0; at + 12 <= body.length; at += 1) pieces.push(body.slice(at, at + 12))
  const shows = (text) => pieces.some((piece) => text.includes(piece))
  if (shows(output)) return 'gitleaks printed the secret it found'
  if (shows(report)) return 'gitleaks wrote the secret it found into its report'
  if (!report.includes('REDACTED'))
    return "gitleaks' report does not say REDACTED where it found it"
  if (!report.includes('github-pat')) return "gitleaks' report does not name the rule that found it"
  return null
}

/** One scan of a scratch folder holding only a fresh fake secret, and its verdict. */
export function checkRedaction({ gitleaks = 'gitleaks', run = spawnSync } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'secret-scan-redaction-'))
  try {
    const secret = aFakeSecret()
    const folder = join(scratch, 'scanned')
    const report = join(scratch, 'report.json')
    mkdirSync(folder)
    writeFileSync(join(folder, 'settings.env'), `GITHUB_TOKEN=${secret}\n`)
    const result = run(
      gitleaks,
      [
        'dir',
        folder,
        '--redact',
        '--no-banner',
        '--verbose',
        '--exit-code',
        '1',
        '--report-format',
        'json',
        '--report-path',
        report,
      ],
      { encoding: 'utf8' },
    )
    if (result.error) return `gitleaks could not be run: ${result.error.message}`
    return redactionVerdict({
      secret,
      status: result.status,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
      report: existsSync(report) ? readFileSync(report, 'utf8') : '',
    })
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

// ⚠️ Only when this file IS the command. Importing it from the test must not exit the runner.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const why = checkRedaction({ gitleaks: process.argv[2] ?? 'gitleaks' })
  if (why === null) {
    process.stdout.write('secret scan: a fake secret was found and hidden in output and report\n')
  } else {
    process.stderr.write(`secret scan: redaction not proven — ${why}\n`)
    process.exit(1)
  }
}
