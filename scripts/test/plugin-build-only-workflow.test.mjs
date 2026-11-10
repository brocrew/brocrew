import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { runInNewContext } from 'node:vm'
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
    expect(workflow).not.toContain('github.event.repository.private')
    expect(workflow).not.toContain('--jq .private')
    const conditions = [...workflow.matchAll(/^ {4}if: (.+)$/gm)].map((match) => match[1])
    expect(conditions).toHaveLength(2)
    const event = (repository, event_name, ref) => ({
      github: { repository, event_name, ref, event: { repository: { private: false } } },
      startsWith: (value, prefix) => value.startsWith(prefix),
    })
    for (const [condition, trigger] of conditions.map((condition, index) => [
      condition,
      index === 0 ? 'push' : 'workflow_dispatch',
    ])) {
      expect(
        runInNewContext(
          condition,
          event(`brocrew/brocrew-plugin-${plugin}`, trigger, 'refs/tags/v0.1.0'),
          { timeout: 50 },
        ),
      ).toBe(true)
      expect(
        runInNewContext(condition, event('fictional/wrong-plugin', trigger, 'refs/tags/v0.1.0'), {
          timeout: 50,
        }),
      ).toBe(false)
    }
    const releaseCondition = conditions[0]
    const buildCondition = conditions[1]
    expect(
      runInNewContext(
        releaseCondition,
        event(`brocrew/brocrew-plugin-${plugin}`, 'workflow_dispatch', 'refs/tags/v0.1.0'),
      ),
    ).toBe(false)
    expect(
      runInNewContext(
        releaseCondition,
        event(`brocrew/brocrew-plugin-${plugin}`, 'push', 'refs/heads/main'),
      ),
    ).toBe(false)
    expect(
      runInNewContext(
        buildCondition,
        event(`brocrew/brocrew-plugin-${plugin}`, 'push', 'refs/tags/v0.1.0'),
      ),
    ).toBe(false)
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
}
