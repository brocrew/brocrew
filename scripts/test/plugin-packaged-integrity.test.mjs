import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { afterEach, describe, expect, it } from 'vitest'
import {
  inspectBundle,
  integrityCheckpoint,
  readIntegrity,
  integrityStages,
} from '../gates/plugin-packaged/integrity.mjs'
import { digest, safeReport } from '../gates/plugin-packaged/contract.mjs'
const req = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const builder = createRequire(req.resolve('electron-builder/package.json'))
const lib = createRequire(builder.resolve('app-builder-lib/package.json'))
const asar = lib('@electron/asar'),
  plist = lib('plist')
const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
async function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fictional-integrity-')))
  roots.push(root)
  fs.chmodSync(root, 0o700)
  fs.writeFileSync(path.join(root, 'fixture-owned'), 'packaged-plugin-gate\n')
  const app = path.join(root, 'Fern.app'),
    resources = path.join(app, 'Contents/Resources'),
    input = path.join(root, 'input')
  fs.mkdirSync(resources, { recursive: true })
  fs.mkdirSync(input)
  fs.writeFileSync(path.join(input, 'fixture.js'), 'fictional archive payload')
  const archive = path.join(resources, 'app.asar')
  await asar.createPackage(input, archive)
  const info = {
    ElectronAsarIntegrity: {
      'Resources/app.asar': {
        algorithm: 'SHA256',
        hash: digest(asar.getRawHeader(archive).headerString),
      },
    },
  }
  const infoFile = path.join(app, 'Contents/Info.plist')
  fs.writeFileSync(infoFile, plist.build(info))
  const framework = path.join(
    app,
    'Contents/Frameworks/Electron Framework.framework/Electron Framework',
  )
  fs.mkdirSync(path.dirname(framework), { recursive: true })
  // The real fuse reader consumes this inert wire; there is no executable in the fixture.
  fs.writeFileSync(
    framework,
    Buffer.concat([
      Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'),
      Buffer.from([1, 9, 49, 48, 49, 49, 48, 48, 48, 49, 49]),
    ]),
  )
  const runtime = path.join(resources, 'plugin-node/node')
  fs.mkdirSync(path.dirname(runtime))
  fs.writeFileSync(runtime, 'fictional pinned runtime')
  fs.writeFileSync(
    path.join(path.dirname(runtime), 'runtime.json'),
    JSON.stringify({ sha256: digest(fs.readFileSync(runtime)) }),
  )
  return { root, app, archive, info, infoFile, framework, runtime }
}
describe.skipIf(process.platform === 'win32')('packaged bundle integrity without a launch', () => {
  it('reads the real ASAR/fuse formats and carries closed facts across every post-package stage', async () => {
    const f = await fixture()
    const stamp = await integrityCheckpoint(f.root, f.app, 'afterPackage')
    for (const stage of integrityStages.slice(1))
      await integrityCheckpoint(f.root, f.app, stage, stamp)
    const report = readIntegrity(f.root)
    expect(Object.keys(report)).toEqual(integrityStages)
    for (const facts of Object.values(report))
      expect(facts).toMatchObject({
        headerMatches: true,
        pinnedNodeMatches: true,
        EnableEmbeddedAsarIntegrityValidation: false,
        EnableNodeCliInspectArguments: true,
        unknownFuses: 1,
      })
    expect(safeReport(report)).toBe(true)
    expect(JSON.stringify(report)).not.toMatch(/fictional|path|hash|HOME/)
  })
  it('refuses a mismatched plist hash even when the embedded ASAR fuse is off', async () => {
    const f = await fixture()
    f.info.ElectronAsarIntegrity['Resources/app.asar'].hash = '0'.repeat(64)
    fs.writeFileSync(f.infoFile, plist.build(f.info))
    await expect(inspectBundle(f.app)).rejects.toThrow('ASAR integrity differs')
  })
  it.each(['archive', 'framework', 'runtime'])(
    'refuses a later change to %s rather than silently accepting a new baseline',
    async (field) => {
      const f = await fixture()
      const baseline = (await inspectBundle(f.app)).stamp
      if (field === 'framework') {
        const bytes = fs.readFileSync(f.framework)
        bytes[bytes.length - 1] = 48
        fs.writeFileSync(f.framework, bytes)
      } else fs.appendFileSync(f[field], 'changed')
      await expect(inspectBundle(f.app, baseline)).rejects.toThrow()
    },
  )
  it('requires the original checkpoint and refuses unreviewed receipt keys or a linked receipt', async () => {
    const f = await fixture(),
      baseline = (await inspectBundle(f.app)).stamp
    await expect(integrityCheckpoint(f.root, f.app, 'beforeLaunch')).rejects.toThrow(
      'Invalid integrity checkpoint',
    )
    await expect(integrityCheckpoint(f.root, f.app, 'beforeLaunch', baseline)).rejects.toThrow(
      'Missing package checkpoint',
    )
    await integrityCheckpoint(f.root, f.app, 'afterPackage')
    const report = readIntegrity(f.root)
    report.afterPackage['/fictional/private'] = true
    fs.writeFileSync(path.join(f.root, 'integrity.json'), JSON.stringify(report))
    expect(() => readIntegrity(f.root)).toThrow('Invalid integrity receipt')
    fs.unlinkSync(path.join(f.root, 'integrity.json'))
    fs.symlinkSync(f.infoFile, path.join(f.root, 'integrity.json'))
    expect(() => readIntegrity(f.root)).toThrow()
  })
})
