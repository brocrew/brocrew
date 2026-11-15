import { createHash } from 'node:crypto'
import { createReadStream, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PREVIOUS_PUBLIC_025, withdrawnPublicationOf } from './lib/withdrawn-upgrade-beta.mjs'
import { requireEvidence } from './lib/upgrade-path.mjs'

const [tag, folder, evidence] = process.argv.slice(2)
requireEvidence(
  tag === PREVIOUS_PUBLIC_025.tag && folder && evidence,
  'Use the withdrawn v0.2.25 tag, predecessor artifact folder and evidence folder.',
)
const old = PREVIOUS_PUBLIC_025
const release = {
  id: old.releaseId,
  tag_name: old.tag,
  target_commitish: old.source,
  draft: true,
  prerelease: false,
  published_at: old.publishedAt,
  assets: old.assets,
  metadataOrigin: 'retained public publication and intentional withdrawal receipt',
  predecessorBinding: JSON.parse(process.env.PREDECESSOR_BINDING),
}
const publication = withdrawnPublicationOf(release, tag)
requireEvidence(
  publication,
  'The original predecessor artifact binding does not match published v0.2.25.',
)
mkdirSync(evidence, { recursive: true })
const receipt = {
  publication,
  retrieval: 'original Actions release artifacts',
  complete: false,
  files: [],
}
const save = () =>
  writeFileSync(join(evidence, 'beta-withdrawn-predecessor.json'), JSON.stringify(receipt, null, 2))
save()
for (const asset of publication.assets) {
  const file = join(folder, asset.name)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  const bytes = statSync(file).size
  const digest = `sha256:${hash.digest('hex')}`
  requireEvidence(
    bytes === asset.size && digest === asset.digest,
    `The original artifact file ${asset.name} differs from the historical public asset.`,
  )
  receipt.files.push({ id: asset.id, name: asset.name, bytes, digest })
  save()
}
writeFileSync(join(evidence, 'beta-release.json'), JSON.stringify(release, null, 2))
receipt.complete = true
save()
console.log(
  `Checked all ${receipt.files.length} original published v0.2.25 files; the release remains withdrawn.`,
)
