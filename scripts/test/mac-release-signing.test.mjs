import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  finalizeMac,
  notarizeAndStaple,
  requireDistributionSignature,
} from '../mac-release-signing.mjs'
import builderTools from '../../apps/desktop/build/builder-tools.mjs'
import afterSignHook from '../../apps/desktop/build/mac-after-sign.cjs'
import { readUpdateFile } from '../release-check.mjs'
import { FICTIONAL_IDENTITY, FICTIONAL_SIGNING_ENV } from './fixtures/mac-signing-identity.mjs'

const roots = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})
const folder = () => {
  const root = mkdtempSync(join(tmpdir(), 'fictional-mac-signing-'))
  roots.push(root)
  return root
}
const signature = `Authority=${FICTIONAL_IDENTITY.authority}\nTeamIdentifier=${FICTIONAL_IDENTITY.teamId}\nTimestamp=Nov 8, 2026\nCodeDirectory v=20500 flags=0x10000(runtime)\n`
const environment = (root) => ({
  ...FICTIONAL_SIGNING_ENV,
  APPLE_API_KEY: join(root, 'fictional-notary.p8'),
  APPLE_API_KEY_ID: 'fictional-id',
  APPLE_API_ISSUER: 'fictional-issuer',
  MAC_SIGNING_EVIDENCE: join(root, 'evidence'),
  MAC_SIGNING_IDENTITY: 'fictional-identity',
  CSC_KEYCHAIN: join(root, 'fictional.keychain'),
})

describe('Mac release signing', () => {
  it('the actual builder hook refuses another platform before touching an app', async () => {
    await expect(afterSignHook({ electronPlatformName: 'linux' })).rejects.toThrow(
      'another platform',
    )
  })
  it('the actual builder hook refuses missing trusted identity before invoking native signing tools', async () => {
    vi.stubEnv('MAC_EXPECTED_TEAM_ID', '')
    vi.stubEnv('MAC_EXPECTED_SIGNING_AUTHORITY', '')
    await expect(
      afterSignHook({
        electronPlatformName: 'darwin',
        appOutDir: '/nonexistent/fixture',
        packager: { appInfo: { productFilename: 'Fixture' } },
      }),
    ).rejects.toThrow('Configured Mac signing team and authority are required')
  })
  it('requires Developer ID, secure timestamp, hardened executables and the expected app team', () => {
    expect(() =>
      requireDistributionSignature(signature, { identity: FICTIONAL_IDENTITY }),
    ).not.toThrow()
    for (const description of [
      signature.replace('Developer ID Application:', 'Apple Development:'),
      signature.replace(/^Timestamp=.*\n/m, ''),
      signature.replace('0x10000(runtime)', '0x0(none)'),
      signature.replace(FICTIONAL_IDENTITY.teamId, 'OTHERTEAM'),
    ])
      expect(() =>
        requireDistributionSignature(description, { identity: FICTIONAL_IDENTITY }),
      ).toThrow()
    expect(() => requireDistributionSignature('Signature=adhoc')).toThrow()
  })

  for (const status of ['Accepted', 'Invalid']) {
    it(`retains the ${status} notary log and staples only accepted distributions`, async () => {
      const env = environment(folder())
      const run = vi.fn(async (_program, args) =>
        args.includes('submit')
          ? { stdout: JSON.stringify({ id: 'fictional-submission', status }) }
          : { stdout: '' },
      )
      const pending = notarizeAndStaple('app-submission.zip', 'BroCrew.app', 'app', { env, run })
      if (status === 'Accepted') await expect(pending).resolves.toBe('fictional-submission')
      else await expect(pending).rejects.toThrow('Invalid')
      const calls = run.mock.calls.map(([, args]) => args)
      expect(calls[0]).toContain('--wait')
      expect(calls[1]).toEqual(
        expect.arrayContaining(['notarytool', 'log', 'fictional-submission']),
      )
      expect(calls.some((args) => args.includes('staple'))).toBe(status === 'Accepted')
      expect(
        calls.some((args) => args.includes('app-submission.zip') && args[0] === 'stapler'),
      ).toBe(false)
      expect(
        JSON.parse(readFileSync(join(env.MAC_SIGNING_EVIDENCE, 'app-submission.json'))).status,
      ).toBe(status)
    })
  }

  it('hashes the stapled DMG, and writes both updater blockmaps and metadata after finalization', async () => {
    const dist = folder(),
      env = environment(dist)
    mkdirSync(join(dist, 'mac-arm64/BroCrew.app'), { recursive: true })
    const dmg = join(dist, 'BroCrew-0.2.12-arm64.dmg'),
      zip = join(dist, 'BroCrew-0.2.12-arm64-mac.zip')
    writeFileSync(dmg, 'original disk image')
    writeFileSync(zip, 'zip containing the stapled app')
    const run = vi.fn(async (_program, args) => {
      if (args.includes('submit'))
        return { stdout: JSON.stringify({ id: 'accepted-id', status: 'Accepted' }) }
      if (args[0] === 'stapler' && args[1] === 'staple')
        writeFileSync(dmg, 'final signed and stapled disk image')
      return { stdout: args.includes('--display') ? signature : '' }
    })
    const seen = []
    const { buildBlockMap } = builderTools
    const blockmap = async (path, format, output) => {
      seen.push({ path, format, bytes: readFileSync(path, 'utf8') })
      return buildBlockMap(path, format, output)
    }
    await finalizeMac(dist, '0.2.12', { env, run, blockmap })
    expect(seen).toEqual([
      { path: zip, format: 'gzip', bytes: 'zip containing the stapled app' },
      { path: dmg, format: 'gzip', bytes: 'final signed and stapled disk image' },
    ])
    const update = readUpdateFile(readFileSync(join(dist, 'latest-mac.yml'), 'utf8'))
    expect(update.files[1].size).toBe(readFileSync(dmg).length)
    expect(update.files[1].sha512).toBe(
      createHash('sha512').update(readFileSync(dmg)).digest('base64'),
    )
    expect(update.path).toBe('BroCrew-0.2.12-arm64-mac.zip')
    const map = JSON.parse(gunzipSync(readFileSync(`${dmg}.blockmap`)))
    expect(map.version).toBe('2')
    expect(map.files[0].sizes.reduce((sum, size) => sum + size, 0)).toBe(readFileSync(dmg).length)
    const signing = run.mock.calls.find(([, args]) => args.includes('--sign'))[1]
    expect(signing).toContain('--timestamp')
  })
})
