import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Compare hook observations to the files a real packaging run produced, without any signing tool.
export function checkWitness(evidenceDir, dist, sha) {
  assert.match(sha, /^[a-f0-9]{40}$/)
  const rows = readFileSync(join(evidenceDir, 'callbacks.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  assert(rows.every((row) => row.mode === 'record-only' && row.sha === sha))
  const installers = readdirSync(dist).filter((name) => /^BroCrew-Setup-.+-x64\.exe$/.test(name))
  assert.equal(installers.length, 1, 'Exactly one actual installer must exist')
  const installer = installers[0]
  const expected = [
    ['app', resolve(dist, 'win-unpacked/BroCrew.exe')],
    ['uninstaller', resolve(dist, installer.replace(/\.exe$/, '.__uninstaller.exe'))],
    ['installer', resolve(dist, installer)],
  ]
  const selected = rows.filter((row) => row.role !== null)
  assert.deepEqual(
    selected.map((row) => [row.role, row.path]),
    expected,
    'Actual callbacks must select exactly app, uninstaller, installer in packaging order',
  )
  for (const row of rows) {
    assert.equal(row.hash, 'sha256')
    assert.equal(row.isNest, false)
    const actual = row.role === 'uninstaller' ? join(evidenceDir, 'uninstaller.exe') : row.path
    const bytes = readFileSync(actual)
    assert.equal(bytes.length, row.size, `File size changed after callback: ${row.path}`)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), row.sha256, row.path)
    if (row.role) assert.equal(bytes.subarray(0, 2).toString(), 'MZ', row.path)
  }
  const result = { mode: 'record-only', sha, callbacks: rows.length, selected }
  writeFileSync(join(evidenceDir, 'checked.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, evidenceDir, dist, sha] = process.argv.slice(2)
  if (command === 'prepare') {
    // A stale evidence directory must fail rather than mix two packaging runs.
    mkdirSync(evidenceDir)
  } else {
    assert.equal(command, 'check')
    console.log(JSON.stringify(checkWitness(evidenceDir, dist, sha), null, 2))
  }
}
