import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

export function windowsBirthOf(pid: number): string {
  try {
    const birth = execFileSync(
      fileURLToPath(new URL('./bin/chrome-process-birth.exe', import.meta.url)),
      [String(pid)],
      { encoding: 'utf8', windowsHide: true },
    ).trim()
    if (!/^[1-9][0-9]{0,18}$/.test(birth) || BigInt(birth) > 3155378975999999999n)
      throw new Error('Invalid native process birth output')
    return birth
  } catch (cause) {
    const error = cause as Error & { stderr?: string | Buffer }
    const detail = error.stderr?.toString().trim() || error.message || String(cause)
    throw new Error(`Cannot read Windows process birth: ${detail}`, { cause })
  }
}
