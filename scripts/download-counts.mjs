/**
 * ⚑ **How many times each release file was downloaded, one row per file per day** — the daily
 * record `.github/workflows/download-counts.yml` keeps on the `download-counts` branch.
 *
 * GitHub counts the downloads of every file a release carries (`download_count` on each asset) and
 * keeps only the running total. This writes that total down once a day, so a day's downloads are
 * the difference between two rows. ⛔ Metadata only: the release's tag, the file's name and its
 * count — nothing about who downloaded it, which GitHub does not tell anyway.
 *
 * Run: `node scripts/download-counts.mjs <releases.json> <counts.csv> <YYYY-MM-DD>`, where
 * `releases.json` is `gh api --paginate --slurp repos/<owner>/<repo>/releases`. It rewrites
 * `counts.csv` with that day's rows (a second run on one day replaces them) and prints a summary.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const HEADER = 'day,release,file,downloads'

/** A CSV field: quoted only when it must be. */
const field = (value) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)

/**
 * The day's rows, from the releases GitHub lists — every page flattened, drafts left out (a draft's
 * files cannot be downloaded) — sorted by release and file so a day's rows read the same each time.
 */
export function rowsFrom(releases, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`not a day (YYYY-MM-DD): ${day}`)
  const rows = []
  for (const release of releases.flat()) {
    if (release.draft) continue
    for (const asset of release.assets ?? []) {
      rows.push({
        day,
        release: String(release.tag_name),
        file: String(asset.name),
        downloads: Number(asset.download_count ?? 0),
      })
    }
  }
  return rows.sort((a, b) =>
    a.release === b.release
      ? a.file < b.file
        ? -1
        : a.file > b.file
          ? 1
          : 0
      : a.release < b.release
        ? -1
        : 1,
  )
}

/** ⚑ The record with `day`'s rows put in: any earlier rows for that day replaced, the rest kept. */
export function withTheDay(csv, rows, day) {
  const kept = csv
    .split('\n')
    .filter((line) => line !== '' && line !== HEADER && !line.startsWith(`${day},`))
  const added = rows.map((row) =>
    [row.day, field(row.release), field(row.file), String(row.downloads)].join(','),
  )
  return `${[HEADER, ...kept, ...added].join('\n')}\n`
}

/** A summary for the run's page: each release's downloads, all its files together. */
export function summaryOf(rows, day) {
  const byRelease = new Map()
  for (const row of rows)
    byRelease.set(row.release, (byRelease.get(row.release) ?? 0) + row.downloads)
  const lines = [`Downloads to ${day}, all files of each release together:`, '']
  if (byRelease.size === 0) lines.push('No release has any file yet.')
  else {
    lines.push('| release | downloads |', '|---|---:|')
    for (const [release, downloads] of byRelease)
      lines.push(`| ${release} | ${String(downloads)} |`)
  }
  return lines.join('\n')
}

// ⚠️ Only when this file IS the command. Importing it from the test must not exit the runner.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [releasesFile, csvFile, day] = process.argv.slice(2)
  if (day === undefined) {
    process.stderr.write(
      'usage: node scripts/download-counts.mjs <releases.json> <counts.csv> <day>\n',
    )
    process.exit(2)
  }
  const rows = rowsFrom(JSON.parse(readFileSync(releasesFile, 'utf8')), day)
  const before = existsSync(csvFile) ? readFileSync(csvFile, 'utf8') : ''
  writeFileSync(csvFile, withTheDay(before, rows, day))
  process.stdout.write(`${summaryOf(rows, day)}\n`)
}
