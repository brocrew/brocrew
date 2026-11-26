#!/usr/bin/env node
/**
 * One part of a Vitest shard's files, for the Windows suite, and the check that a part ran it.
 *
 * usage: node .github/windows-suite-part.mjs <list.json> <shard> <shards> <part> <parts>
 *        node .github/windows-suite-part.mjs --ran <report.json> <part-files.txt>
 *
 * The first form prints the files `vitest run --shard=<shard>/<shards>` would run, every
 * `parts`-th of them in sorted order, one absolute path per line, so the parts together run
 * exactly the shard. `<list.json>` is what `vitest list --filesOnly --json=<file>` writes from the
 * checkout's root. `vitest list` ignores `--shard`, so the shard is chosen here as Vitest 4's
 * BaseSequencer.shard chooses it: every file ordered by the SHA-1 of its path from the root, then
 * the shard's slice as calculateShardRange cuts it. A file listed by two projects is refused,
 * since this selection counts each file once.
 *
 * The second form fails unless the Vitest JSON report ran exactly the files the part listed, each
 * once, and at least one.
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const slash = (path) => path.split('\\').join('/')
const linesOf = (file) => readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)

if (process.argv[2] === '--ran') {
  const [reportFile, listFile] = process.argv.slice(3)
  const listed = linesOf(listFile).map(slash).sort()
  const ran = JSON.parse(readFileSync(reportFile, 'utf8'))
    .testResults.map((result) => slash(result.name))
    .sort()
  if (listed.length === 0) throw new Error(`${listFile} lists no files`)
  if (JSON.stringify(ran) !== JSON.stringify(listed)) {
    const missing = listed.filter((file) => !ran.includes(file))
    const extra = ran.filter((file) => !listed.includes(file))
    throw new Error(
      `ran ${ran.length} files for ${listed.length} listed; missing: ${missing.join(', ') || 'none'}; ` +
        `not listed or repeated: ${extra.join(', ') || 'none'}`,
    )
  }
  console.log(`ran exactly the ${listed.length} listed files`)
  process.exit(0)
}

const [listFile, ...counts] = process.argv.slice(2)
const [shard, shards, part, parts] = counts.map(Number)
const isPart = (one, of) => Number.isInteger(one) && Number.isInteger(of) && one >= 1 && one <= of
if (!isPart(shard, shards) || !isPart(part, parts)) {
  throw new Error(
    `shard ${counts[0]} of ${counts[1]}, part ${counts[2]} of ${counts[3]}: not a part`,
  )
}

const root = slash(process.cwd())
const files = JSON.parse(readFileSync(listFile, 'utf8')).map((entry) => entry.file)
if (files.length === 0) throw new Error(`${listFile} lists no files`)
const twice = files.filter((file, at) => files.indexOf(file) !== at)
if (twice.length > 0) throw new Error(`listed by more than one project: ${twice.join(', ')}`)

const sha1 = (file) => createHash('sha1').update(slash(file).slice(root.length)).digest('hex')
const ordered = files
  .map((file) => ({ file, hash: sha1(file) }))
  .sort((a, b) => (a.hash < b.hash ? -1 : a.hash > b.hash ? 1 : 0))

const base = Math.floor(files.length / shards)
const rest = files.length % shards
const size = rest >= shard ? base + 1 : base
const start = rest >= shard ? size * (shard - 1) : rest * (base + 1) + (shard - rest - 1) * base

const inShard = ordered
  .slice(start, start + size)
  .map(({ file }) => file)
  .sort()
for (const [at, file] of inShard.entries()) if (at % parts === part - 1) console.log(file)
