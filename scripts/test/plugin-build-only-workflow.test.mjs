import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { exportChromePlugin } from '../export-chrome-plugin.mjs'
import { exportWhatsAppPlugin } from '../export-whatsapp-plugin.mjs'

const folders = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

for (const [plugin, exportPlugin] of [
  ['chrome', exportChromePlugin],
  ['whatsapp', exportWhatsAppPlugin],
]) {
  it(`${plugin} manual dispatch builds artifacts without release or tag authority`, () => {
    const folder = mkdtempSync(join(tmpdir(), 'fictional-build-only-'))
    folders.push(folder)
    exportPlugin(join(folder, 'source'))
    const workflow = readFileSync(join(folder, 'source/.github/workflows/release.yml'), 'utf8')
    const [release, dryRun] = workflow.split('\n  build-only:\n')
    expect(dryRun).toBeTruthy()
    expect(release).toContain(
      "github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')",
    )
    expect(dryRun).toContain("github.event_name == 'workflow_dispatch'")
    expect(dryRun).toContain(`github.repository == 'brocrew/brocrew-plugin-${plugin}'`)
    expect(dryRun).toContain('github.event.repository.private == true')
    expect(dryRun).toContain('    permissions:\n      contents: read\n')
    expect(dryRun).toContain('persist-credentials: false')
    expect(dryRun).not.toMatch(
      /contents: write|secrets\.|GH_TOKEN|gh release|git (?:push|tag)|needs:/,
    )
    expect(dryRun).toContain('uses: actions/upload-artifact@v4')
    expect(dryRun).toContain('path: artifact/')
    expect(dryRun).toContain('if-no-files-found: error')
    expect(dryRun).not.toContain('continue-on-error')
  })

  it(`${plugin} dry run pins inputs and uploads only reproducible checked archives`, () => {
    const folder = mkdtempSync(join(tmpdir(), 'fictional-build-only-'))
    folders.push(folder)
    exportPlugin(join(folder, 'source'))
    const workflow = readFileSync(join(folder, 'source/.github/workflows/release.yml'), 'utf8')
    const dryRun = workflow.split('\n  build-only:\n')[1]
    expect(dryRun).toContain("node-version: '22.23.3'")
    if (plugin === 'whatsapp') {
      expect(dryRun).toContain("go-version: '1.27.2'")
      expect(dryRun).toContain('GOTOOLCHAIN: local')
      expect(dryRun).toContain('BROCREW_GO="$(command -v go)" npm run build')
    }
    expect(dryRun.match(/test "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA"/g)).toHaveLength(2)
    expect(
      dryRun.match(/git status --porcelain --untracked-files=all --ignored=matching/g),
    ).toHaveLength(2)
    for (const source of [
      'src',
      'ui',
      'build.mjs',
      'manifest-template.json',
      'package.json',
      'package-lock.json',
    ])
      expect(dryRun).toContain(`plugins/${plugin}/${source}`)
    expect(dryRun).toContain('npm run build -- artifact\n')
    expect(dryRun).toContain('npm run build -- artifact-repeat\n')
    expect(dryRun).toContain('run: diff -r artifact artifact-repeat')
    expect(dryRun.indexOf('run: diff -r')).toBeLessThan(
      dryRun.indexOf('uses: actions/upload-artifact'),
    )
    expect(dryRun).toContain(`BROCREW_${plugin.toUpperCase()}_TEST_ARTIFACT:`)
    expect(dryRun).toContain('artifact/build-inputs.sha256')
    expect(dryRun).toContain('artifact/downloads.sha256')
    expect(dryRun).toContain('artifact/source-commit.txt')
    const releaseTests = readFileSync(
      join(folder, `source/plugins/${plugin}/test/release.test.ts`),
      'utf8',
    )
    expect(releaseTests).toContain('expect(manifest.sourceCommit).toBe(process.env.GITHUB_SHA)')
  })
}
