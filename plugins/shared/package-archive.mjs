import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
export function filesBelow(dir, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'))
    .flatMap((entry) => {
      const name = prefix + entry.name
      if (entry.isSymbolicLink()) throw new Error('Links are not package files')
      return entry.isDirectory()
        ? filesBelow(path.join(dir, entry.name), name + '/')
        : [{ path: name, bytes: fs.readFileSync(path.join(dir, entry.name)) }]
    })
}
function ustar(files) {
  const chunks = []
  for (const file of files) {
    const header = Buffer.alloc(512)
    let name = file.path,
      prefix = ''
    if (Buffer.byteLength(name) > 100) {
      const split = name.lastIndexOf('/', name.length - 1)
      prefix = name.slice(0, split)
      name = name.slice(split + 1)
      if (Buffer.byteLength(prefix) > 155 || Buffer.byteLength(name) > 100)
        throw new Error('USTAR path too long')
    }
    header.write(name, 0, 100)
    const oct = (n, offset, width) =>
      header.write(n.toString(8).padStart(width - 1, '0') + '\0', offset, width, 'ascii')
    oct(0o644, 100, 8)
    oct(0, 108, 8)
    oct(0, 116, 8)
    oct(file.bytes.length, 124, 12)
    oct(0, 136, 12)
    header.fill(32, 148, 156)
    header.write('0', 156)
    header.write('ustar\0', 257, 6)
    header.write('00', 263, 2)
    header.write(prefix, 345, 155)
    const checksum = [...header].reduce((sum, n) => sum + n, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii')
    chunks.push(header, file.bytes, Buffer.alloc((512 - (file.bytes.length % 512)) % 512))
  }
  return Buffer.concat([...chunks, Buffer.alloc(1024)])
}

export function finalizePackage({ root, destination, sourceCommit, target, archiveName, receipt }) {
  const payload = path.join(destination, 'package')
  const files = filesBelow(payload)
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest-template.json')))
  manifest.sourceCommit = sourceCommit
  manifest.platforms = [{ os: target.os, cpu: target.cpu }]
  manifest.files = files.map((file) => ({
    path: file.path,
    type: 'file',
    size: file.bytes.length,
    sha256: digest(file.bytes),
  }))
  const manifestBytes = Buffer.from(JSON.stringify(manifest))
  fs.writeFileSync(path.join(payload, 'plugin.json'), manifestBytes)
  const archive = ustar(
    [...files, { path: 'plugin.json', bytes: manifestBytes }].sort((a, b) =>
      a.path.localeCompare(b.path, 'en'),
    ),
  )
  fs.writeFileSync(path.join(destination, archiveName), archive)
  const release = {
    id: manifest.id,
    authors: manifest.authors,
    version: manifest.version,
    sourceCommit: manifest.sourceCommit,
    platforms: manifest.platforms,
    archive: {
      url: `https://example.invalid/${archiveName}`,
      size: archive.length,
      sha256: digest(archive),
      compression: 'tar',
    },
    manifestSha256: digest(manifestBytes),
  }
  fs.writeFileSync(
    path.join(destination, 'fixture-release.json'),
    JSON.stringify(release, null, 2) + '\n',
  )
  fs.writeFileSync(
    path.join(destination, 'build-receipt.json'),
    JSON.stringify(
      {
        files: files.length,
        bytes: archive.length,
        sha256: digest(archive),
        manifestBytes: manifestBytes.length,
        ...receipt,
      },
      null,
      2,
    ) + '\n',
  )
  return release
}
