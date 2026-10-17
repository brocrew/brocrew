import { strict as assert } from 'node:assert'
import { mkdtempSync, mkdirSync, realpathSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { app, BrowserWindow, nativeImage } from 'electron'
import { themePictureSampler } from '../../src/main/themes/picture-samples'
import { sniffAsset } from '../../src/shared/themes/assets'

function chunk(name: string, body: Buffer): Buffer {
  const data = Buffer.concat([Buffer.from(name), body])
  let crc = 0xffffffff
  for (const byte of data) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)
  length.writeUInt32BE(body.length)
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, data, checksum])
}

function pixel(r: number, g: number, b: number, a: number): Buffer {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(1, 0)
  header.writeUInt32BE(1, 4)
  header[8] = 8
  header[9] = 6
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, r, g, b, a]))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

async function measure(): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'brobot-native-theme-')))
  try {
    for (const name of ['app-data', 'workspace', 'session', 'logs', 'crashes'])
      mkdirSync(join(root, name))
    app.setPath('appData', join(root, 'app-data'))
    app.setPath('userData', join(root, 'workspace'))
    app.setPath('sessionData', join(root, 'session'))
    app.setPath('crashDumps', join(root, 'crashes'))
    app.setAppLogsPath(join(root, 'logs'))
    app.disableHardwareAcceleration()
    await app.whenReady()
    app.dock?.hide()
    const sample = themePictureSampler(nativeImage)
    const checked = (bytes: Buffer) => {
      const facts = sniffAsset(bytes)
      assert(facts.ok)
      const result = sample(bytes, facts.facts)
      assert(result)
      return result
    }
    const opaque = pixel(20, 40, 60, 255)
    const png = checked(opaque)
    assert.deepEqual(png.darkest, { r: 20, g: 40, b: 60, a: 1 })
    assert.deepEqual(png.lightest, png.darkest)
    assert.equal(png.seeThrough, false)
    const alpha = checked(pixel(128, 64, 32, 128))
    assert.equal(alpha.seeThrough, true)
    assert.equal(alpha.darkest.a, 128 / 255)
    for (const [key, expected] of [
      ['r', 128],
      ['g', 64],
      ['b', 32],
    ] as const) {
      assert(Math.abs(alpha.darkest[key] - expected) <= 1)
    }
    const jpeg = checked(nativeImage.createFromBuffer(opaque).toJPEG(100))
    assert.equal(jpeg.seeThrough, false)
    for (const [key, expected] of [
      ['r', 20],
      ['g', 40],
      ['b', 60],
    ] as const) {
      assert(Math.abs(jpeg.darkest[key] - expected) <= 5)
    }
    const windows = BrowserWindow.getAllWindows().length
    assert.equal(windows, 0)
    console.log(
      JSON.stringify({
        electron: process.versions.electron,
        png: true,
        jpeg: true,
        alpha: true,
        windows,
      }),
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

void measure().then(
  () => app.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : 'native theme sampling failed')
    app.exit(1)
  },
)
