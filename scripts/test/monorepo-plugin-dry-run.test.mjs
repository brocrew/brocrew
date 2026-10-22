import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

const workflow = readFileSync(
  new URL('../../.github/workflows/plugin-archive-dry-run.yml', import.meta.url),
  'utf8',
)
it('runs only manual public monorepo builds without publishing authority', () => {
  expect(workflow).toContain('  workflow_dispatch:')
  expect(workflow).not.toMatch(
    /\n {2}(?:push|pull_request|schedule):|contents: write|secrets\.|GH_TOKEN|gh release|git (?:push|tag)/,
  )
  expect(workflow).toContain('permissions:\n  contents: read')
  const condition = workflow.match(/^ {4}if: (.+)$/m)[1]
  const event = (repository, event_name) => ({ github: { repository, event_name } })
  expect(runInNewContext(condition, event('brocrew/brocrew', 'workflow_dispatch'))).toBe(true)
  expect(runInNewContext(condition, event('fictional/wrong-repo', 'workflow_dispatch'))).toBe(false)
  expect(runInNewContext(condition, event('brocrew/brocrew', 'push'))).toBe(false)
  expect(workflow).toContain('persist-credentials: false')
  expect(workflow).toContain('uses: actions/upload-artifact@v4')
})
it('pins canonical source and toolchains and compares both plugin target builds before upload', () => {
  expect(workflow).toContain('plugin: [chrome, whatsapp]')
  expect(workflow).toContain("node-version: '22.23.3'")
  expect(workflow).toContain("go-version: '1.27.2'")
  expect(workflow).toContain('GOTOOLCHAIN: local')
  expect(workflow).toContain('BROCREW_PLUGIN_SOURCE_COMMIT: ${{ inputs.source_commit }}')
  expect(workflow).toContain('ref: ${{ inputs.source_commit }}')
  expect(workflow).toContain('npm ci --prefix "plugins/$PLUGIN_ID" --ignore-scripts')
  expect(workflow).not.toContain('npm run build')
  expect(workflow).toContain('node scripts/build-plugin-release.mjs "$PLUGIN_ID" artifact\n')
  expect(workflow).toContain('node scripts/build-plugin-release.mjs "$PLUGIN_ID" artifact-repeat\n')
  expect(workflow.indexOf('diff -r artifact artifact-repeat')).toBeLessThan(
    workflow.indexOf('uses: actions/upload-artifact'),
  )
  expect(workflow).toContain('artifact/build-inputs.sha256')
  expect(workflow).toContain('artifact/downloads.sha256')
  expect(workflow).toContain('if-no-files-found: error')
  expect(workflow).not.toContain('continue-on-error')
})
