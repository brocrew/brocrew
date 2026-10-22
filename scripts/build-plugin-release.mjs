import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { verifyPluginSource } from './plugin-source.mjs'

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')

// The archive contains the canonical source pin; export/build repository identity is a separate receipt.
export async function assemblePluginRelease({ id, out, proof, targets, buildPackage }) {
  fs.mkdirSync(out)
  const downloads = []
  let version, authors
  for (const target of targets) {
    const name = `${id}-${target.os}-${target.cpu}`
    const built = path.join(out, name)
    const release = await buildPackage(built, proof.sourceCommit, target)
    version = release.version
    authors = release.authors
    const bytes = gzipSync(fs.readFileSync(path.join(built, `${id}.tar`)), { level: 9 })
    bytes[9] = 255
    fs.writeFileSync(path.join(out, name + '.tar.gz'), bytes)
    downloads.push({
      os: target.os,
      cpu: target.cpu,
      url: `https://github.com/brocrew/brocrew-plugin-${id}/releases/download/v${version}/${name}.tar.gz`,
      sha256: digest(bytes),
      bytes: bytes.length,
      compression: 'tar.gz',
      manifestSha256: release.manifestSha256,
    })
  }
  const entry = {
    id,
    name: id === 'chrome' ? 'Chrome' : 'WhatsApp',
    description:
      id === 'chrome'
        ? 'Lets agents use Google Chrome with its own separate profiles: read pages, use sites and save downloads.'
        : 'Lets agents read your WhatsApp chats when you allow it, and send to the groups you choose.',
    version,
    authors,
    minAppVersion: authors === undefined ? '0.0.0' : '0.1.7',
    sourceCommit: proof.sourceCommit,
    targets: downloads,
  }
  fs.writeFileSync(path.join(out, 'plugin-list-entry.json'), JSON.stringify(entry, null, 2) + '\n')
  fs.writeFileSync(path.join(out, 'source-receipt.json'), JSON.stringify(proof, null, 2) + '\n')
  return entry
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const id = process.argv[2]
  const options = {
    root,
    id,
    canonicalRoot: process.env.BROCREW_MONOREPO_ROOT,
    sourceCommit: process.env.BROCREW_PLUGIN_SOURCE_COMMIT,
  }
  const proof = verifyPluginSource(options)
  const builder = await import(`../plugins/${id}/build.mjs`)
  await assemblePluginRelease({
    id,
    out: path.resolve(process.argv[3] ?? 'artifact'),
    proof,
    targets: id === 'chrome' ? builder.CHROME_TARGETS : builder.WHATSAPP_TARGETS,
    buildPackage:
      id === 'chrome'
        ? builder.buildChromePackage
        : (built, commit, target) => builder.buildWhatsAppPackage(built, commit, undefined, target),
  })
  verifyPluginSource(options)
}
