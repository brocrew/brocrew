import { describe, expect, it } from 'vitest'
import {
  checks,
  finish,
  onlyTheThree,
  report,
  requireHosted,
  safeSummary,
} from '../gates/plugin-windows/gate.mjs'
import * as whatsapp from '../gates/plugin-windows/whatsapp.mjs'
import { matchesPin } from '../gates/plugin-windows/whatsapp-release.mjs'

const user = 'S-1-5-21-1-2-3-1001'
const hosted = {
  RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'brocrew/brocrew',
  GITHUB_REF: 'refs/heads/gate/plugin-windows-fern',
}

describe('the hosted Windows plugin gate', () => {
  it('runs only on a private hosted Windows x64 gate branch', () => {
    expect(() => requireHosted(hosted, 'win32', 'x64')).not.toThrow()
    expect(() =>
      requireHosted({ ...hosted, GITHUB_REPOSITORY: 'brocrew/brocrew' }, 'win32', 'x64'),
    ).not.toThrow()
    for (const [env, platform, arch] of [
      [{ ...hosted, RUNNER_ENVIRONMENT: 'self-hosted' }, 'win32', 'x64'],
      [{ ...hosted, GITHUB_REPOSITORY: 'fern/brobot2' }, 'win32', 'x64'],
      [{ ...hosted, GITHUB_REF: 'refs/heads/dev' }, 'win32', 'x64'],
      [hosted, 'darwin', 'arm64'],
      [hosted, 'win32', 'arm64'],
    ])
      expect(() => requireHosted(env, platform, arch)).toThrow('Private hosted Windows gate only')
  })
  it('writes out a fresh summary and a closed failure, and refuses any text or unknown step', () => {
    expect(safeSummary(report())).toBe(true)
    expect(safeSummary({ ...report(), failure: { step: 'install', category: 'timeout' } })).toBe(
      true,
    )
    expect(safeSummary({ ...report(), failure: { step: 'C:\\fern', category: 'timeout' } })).toBe(
      false,
    )
    expect(
      safeSummary({ ...report(), failure: { step: 'install', category: 'x', extra: 1 } }),
    ).toBe(false)
    expect(safeSummary({ ...report(), counts: { keeperOpenedMs: 1200 } })).toBe(true)
    expect(safeSummary({ ...report(), counts: { path: 'C:\\Users\\fern' } })).toBe(false)
    expect(safeSummary({ ...report(), counts: { negative: -1 } })).toBe(false)
  })
  it('passes only when every check, both coverages and no credential audit are as required', () => {
    const summary = report()
    for (const key of checks) summary.checks[key] = true
    summary.coverage.agentBrowserActions = true
    summary.coverage.liveTabs = true
    expect(finish(summary).passed).toBe(true)
    expect(finish({ ...summary, failure: { step: 'install', category: 'assertion' } }).passed).toBe(
      false,
    )
    summary.checks[checks[0]] = false
    expect(finish(summary).passed).toBe(false)
  })
  it('reads a protected list of this user, SYSTEM and Administrators as private, and nothing wider', () => {
    expect(onlyTheThree(`D:PAI(A;OICI;FA;;;${user})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)`, user)).toBe(
      true,
    )
    expect(onlyTheThree('D:PAI(A;OICI;FA;;;LA)(A;OICI;FA;;;SY)', 'S-1-5-21-1-2-3-500')).toBe(true)
    expect(onlyTheThree('D:PAI(A;OICI;FA;;;LA)(A;OICI;FA;;;SY)', user)).toBe(false)
    expect(onlyTheThree(`D:AI(A;OICI;FA;;;${user})`, user)).toBe(false)
    expect(onlyTheThree(`D:PAI(A;OICI;FA;;;${user})(A;OICI;FR;;;BU)`, user)).toBe(false)
    expect(onlyTheThree(`D:PAI(A;OICI;FA;;;${user})(D;OICI;FA;;;WD)`, user)).toBe(true)
    expect(onlyTheThree('D:PAI', user)).toBe(false)
  })
})

describe("the Windows gate's WhatsApp leg", () => {
  it('writes out only booleans, whole numbers and a closed failure', () => {
    expect(whatsapp.safeSummary(whatsapp.report())).toBe(true)
    const summary = { ...whatsapp.report(), counts: { installToRunningMs: 1200 } }
    expect(whatsapp.safeSummary(summary)).toBe(true)
    expect(
      whatsapp.safeSummary({ ...summary, failure: { step: 'configure', category: 'timeout' } }),
    ).toBe(true)
    expect(
      whatsapp.safeSummary({ ...summary, failure: { step: 'C:\\fern', category: 'timeout' } }),
    ).toBe(false)
    expect(whatsapp.safeSummary({ ...summary, counts: { path: 'C:\\Users\\fern' } })).toBe(false)
    expect(whatsapp.safeSummary({ ...summary, counts: { negative: -1 } })).toBe(false)
  })
  it('passes only when every check holds and nothing failed', () => {
    const summary = whatsapp.report()
    expect(whatsapp.finish(summary).passed).toBe(false)
    for (const key of whatsapp.checks) summary.checks[key] = true
    expect(whatsapp.finish(summary).passed).toBe(true)
    expect(
      whatsapp.finish({ ...summary, failure: { step: 'install', category: 'assertion' } }).passed,
    ).toBe(false)
    summary.checks.configureNotLinked = false
    expect(whatsapp.finish(summary).passed).toBe(false)
  })
  it('takes a release only when every target is exactly a pinned one', () => {
    const pinned = {
      targets: [
        { os: 'darwin', cpu: 'arm64', sha256: 'a'.repeat(64), bytes: 1, manifestSha256: 'c' },
        { os: 'win32', cpu: 'x64', sha256: 'b'.repeat(64), bytes: 2, manifestSha256: 'd' },
      ],
    }
    expect(matchesPin(pinned, pinned.targets)).toBe(true)
    expect(matchesPin(pinned, pinned.targets.slice(1))).toBe(false)
    expect(matchesPin(pinned, [pinned.targets[0], { ...pinned.targets[1], bytes: 3 }])).toBe(false)
    expect(
      matchesPin(pinned, [pinned.targets[0], { ...pinned.targets[1], manifestSha256: 'e' }]),
    ).toBe(false)
  })
})
