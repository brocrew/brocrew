#!/usr/bin/env node
/**
 * The failing tests in a folder of Vitest JSON reports, for the Windows suite's artifact.
 *
 * usage: node .github/windows-suite-failures.mjs <folder>
 *
 * Prints each report's counts, then each failing test: its file, its full name and the first lines
 * of its failure, without terminal colours. A test file that failed to load counts as one failure
 * with its own message. Writes the same list as `failures.json` in the folder.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { stripVTControlCharacters } from 'node:util'

const MOST_LINES = 8
const MOST_CHARS = 1500

const plain = (text) => stripVTControlCharacters(String(text ?? ''))

/** The first lines of a failure, bounded. */
const firstLines = (text) =>
  plain(text).split(/\r?\n/).slice(0, MOST_LINES).join('\n').slice(0, MOST_CHARS)

const fileOf = (path) => relative(process.cwd(), path).split('\\').join('/')

const folder = process.argv[2] ?? '.'
const reports = readdirSync(folder)
  .filter((name) => name.endsWith('.json') && name !== 'failures.json')
  .sort()
const failures = []
for (const name of reports) {
  let report
  try {
    report = JSON.parse(readFileSync(join(folder, name), 'utf8'))
  } catch {
    console.log(`${name}: not readable`)
    continue
  }
  console.log(
    `${name}: ${String(report.numPassedTests)} passed, ${String(report.numFailedTests)} failed, ` +
      `${String(report.numPendingTests)} skipped, ${String(report.numTotalTests)} in all; ` +
      `${String(report.numFailedTestSuites)} files failed`,
  )
  for (const file of report.testResults ?? []) {
    const failed = (file.assertionResults ?? []).filter((one) => one.status === 'failed')
    if (file.status === 'failed' && failed.length === 0) {
      failures.push({
        report: name,
        file: fileOf(file.name),
        test: '(the file)',
        message: firstLines(file.message),
      })
    }
    for (const one of failed) {
      failures.push({
        report: name,
        file: fileOf(file.name),
        test: one.fullName ?? one.title,
        message: firstLines((one.failureMessages ?? []).join('\n')),
      })
    }
  }
}
if (reports.length === 0) console.log('No report was written.')
for (const one of failures) {
  console.log(`\nFAIL ${one.file} > ${one.test}\n${one.message}`)
}
writeFileSync(join(folder, 'failures.json'), `${JSON.stringify(failures, null, 2)}\n`)
