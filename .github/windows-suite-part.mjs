#!/usr/bin/env node
/**
 * One part of a Vitest shard's files, for the Windows suite, and the check that a part ran it.
 *
 * usage: node .github/windows-suite-part.mjs <project filter> <shard>/<shards> <part>/<parts> <out.txt>
 *        node .github/windows-suite-part.mjs --ran <part-files.txt> <report.json>...
 *
 * The first form asks Vitest, from the checkout's root, for the test files the project filter
 * selects and for the ones its configured sequencer puts in that shard, exactly as
 * `vitest run --project <filter> --shard=<shard>/<shards>` would. It writes every `parts`-th of
 * them, in sorted order, to `<out.txt>`, one absolute path per line, so the parts together run
 * exactly the shard. It fails on an empty shard or part, and on a file selected by two projects,
 * since a part runs each listed file once.
 *
 * The second form fails unless the part's Vitest JSON reports, together, ran exactly the files the
 * part listed, each once, and at least one.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createVitest } from 'vitest/node'

const slash = (path) => path.split('\\').join('/')
const linesOf = (file) => readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean)

if (process.argv[2] === '--ran') {
  const [listFile, ...reportFiles] = process.argv.slice(3)
  const listed = linesOf(listFile).map(slash).sort()
  const ran = reportFiles
    .flatMap((report) => JSON.parse(readFileSync(report, 'utf8')).testResults)
    .map((result) => slash(result.name))
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

const [project, shardOf, partOf, outFile] = process.argv.slice(2)
const [part, parts] = (partOf ?? '').split('/').map(Number)
if (!project || !/^\d+\/\d+$/.test(shardOf ?? '') || !(part >= 1 && part <= parts) || !outFile) {
  throw new Error(
    `usage: <project filter> <shard>/<shards> <part>/<parts> <out.txt>, not ${process.argv.slice(2)}`,
  )
}

const vitest = await createVitest('test', { project: [project], shard: shardOf, watch: false })
try {
  const specifications = await vitest.globTestSpecifications()
  const sequencer = new vitest.config.sequence.sequencer(vitest)
  const files = (await sequencer.shard(specifications)).map((spec) => spec.moduleId)
  if (files.length === 0) throw new Error(`shard ${shardOf} of ${project} selects no files`)
  const twice = files.filter((file, at) => files.indexOf(file) !== at)
  if (twice.length > 0) throw new Error(`selected by more than one project: ${twice.join(', ')}`)
  const mine = files.sort().filter((_, at) => at % parts === part - 1)
  if (mine.length === 0) throw new Error(`part ${partOf} of shard ${shardOf} selects no files`)
  writeFileSync(outFile, mine.map((file) => `${file}\n`).join(''))
  console.log(`part ${partOf} of shard ${shardOf}: ${mine.length} of ${files.length} files`)
} finally {
  await vitest.close()
}
