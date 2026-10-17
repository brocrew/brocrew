// W4.109 · What a release must carry for BroBot's updater, checked on the built files before they
// are published — run by `.github/workflows/release.yml` on each platform's build:
//
//   node scripts/release-check.mjs <dist> <version> <owner/repo> <app-update.yml>
//
// 1. The update file (`latest.yml` on Windows, `latest-mac.yml` on the Mac) names this version, and
//    every file it names is in `<dist>`, with the size and the sha512 it says — the sha512 is what
//    the updater checks a download against, so a wrong one is an update nobody can install.
// 2. The app's own `app-update.yml` points at `<owner/repo>` on GitHub: where the app will look,
//    anonymously — it names no private feed and carries no token.
//
// Node built-ins only, so it runs before or without any install. Exit 0: every check held.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The fields of an electron-builder update file this check needs — its YAML, read line by line. */
export function readUpdateFile(text) {
  const version = /^version: ['"]?([^'"\n]+)['"]?$/m.exec(text)?.[1] ?? null
  const files = []
  let current = null
  for (const line of text.split('\n')) {
    const url = /^ {2}- url: (.+)$/.exec(line)
    if (url) {
      current = { url: url[1].trim(), sha512: null, size: null }
      files.push(current)
      continue
    }
    const field = /^ {4}(sha512|size): (.+)$/.exec(line)
    if (field && current !== null) {
      current[field[1]] = field[1] === 'size' ? Number(field[2]) : field[2].trim()
      continue
    }
    if (!line.startsWith('    ')) current = null
  }
  const path = /^path: (.+)$/m.exec(text)?.[1]?.trim() ?? null
  const sha512 = /^sha512: (.+)$/m.exec(text)?.[1]?.trim() ?? null
  return { version, files, path, sha512 }
}

/** A file's sha512 as electron-builder writes it: base64. */
export function sha512Of(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

/** Every problem with the release in `dist`, or none. */
export function problemsWith(dist, version, repo, appUpdateFile) {
  const problems = []
  const updateFiles = readdirSync(dist).filter((name) => /^latest(-mac)?\.yml$/.test(name))
  if (updateFiles.length === 0) problems.push(`no latest.yml or latest-mac.yml in ${dist}`)
  for (const name of updateFiles) {
    const said = readUpdateFile(readFileSync(join(dist, name), 'utf8'))
    if (said.version !== version)
      problems.push(`${name} names version ${said.version}, not ${version}`)
    if (said.files.length === 0) problems.push(`${name} names no file`)
    const sums = new Map()
    for (const file of said.files) {
      const path = join(dist, file.url)
      if (!existsSync(path)) {
        problems.push(`${name} names ${file.url}, which is not in ${dist}`)
        continue
      }
      const sum = sha512Of(path)
      sums.set(file.url, sum)
      if (file.sha512 !== sum) problems.push(`${name}: ${file.url}'s sha512 is not the file's`)
      if (file.size !== statSync(path).size)
        problems.push(`${name}: ${file.url}'s size is not the file's`)
    }
    if (said.path === null || !sums.has(said.path)) {
      problems.push(`${name}'s path (${said.path}) is not one of the files it names`)
    } else if (said.sha512 !== sums.get(said.path)) {
      problems.push(`${name}'s top-level sha512 is not ${said.path}'s`)
    }
  }
  const [owner, name] = repo.split('/')
  if (!existsSync(appUpdateFile)) {
    problems.push(`the app carries no ${appUpdateFile}`)
  } else {
    const text = readFileSync(appUpdateFile, 'utf8')
    for (const [key, value] of [
      ['provider', 'github'],
      ['owner', owner],
      ['repo', name],
    ]) {
      if (!new RegExp(`^${key}: ['"]?${value}['"]?$`, 'm').test(text)) {
        problems.push(`the app's app-update.yml does not say ${key}: ${value}`)
      }
    }
    // ⛔ A released app reads its feed anonymously: no private-feed path, and no token.
    for (const key of ['private', 'token']) {
      if (new RegExp(`^${key}:`, 'm').test(text)) {
        problems.push(`the app's app-update.yml says ${key}:, which a release never carries`)
      }
    }
  }
  return problems
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , dist, version, repo, appUpdateFile] = process.argv
  if (!dist || !version || !repo || !appUpdateFile || !repo.includes('/')) {
    console.error('usage: release-check.mjs <dist> <version> <owner/repo> <app-update.yml>')
    process.exit(2)
  }
  const problems = problemsWith(dist, version, repo, appUpdateFile)
  for (const problem of problems) console.log(`[release-check] ✗ ${problem}`)
  if (problems.length === 0) {
    console.log(
      `[release-check] ✓ version ${version}; every file named, with its size and sha512; the app looks at github.com/${repo}`,
    )
  }
  process.exit(problems.length === 0 ? 0 : 1)
}
