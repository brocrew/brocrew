// Explicit local source export; never copies history, dependency folders or pushes a repository.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { copyPluginSource } from './plugin-source.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function exportChromePlugin(destination) {
  if (!path.isAbsolute(destination) || fs.existsSync(destination))
    throw new Error('Use a fresh absolute export folder')
  copyPluginSource(root, destination, 'chrome')
  fs.mkdirSync(path.join(destination, 'scripts/lib'), { recursive: true })
  for (const name of ['tests-run-in-a-fictional-home.mjs', 'a-test-sees-no-real-home.setup.mjs'])
    fs.copyFileSync(
      path.join(root, 'scripts/lib', name),
      path.join(destination, 'scripts/lib', name),
    )
  fs.copyFileSync(
    path.join(root, 'scripts/leak-check.mjs'),
    path.join(destination, 'scripts/leak-check.mjs'),
  )
  fs.copyFileSync(path.join(root, 'LICENSE'), path.join(destination, 'LICENSE'))
  fs.mkdirSync(path.join(destination, 'scripts/test'), { recursive: true })
  fs.copyFileSync(
    path.join(root, 'scripts/test/chrome-release-guards.test.mjs'),
    path.join(destination, 'scripts/test/chrome-release-guards.test.mjs'),
  )
  fs.mkdirSync(path.join(destination, 'scripts/leak-guard'), { recursive: true })
  for (const name of ['baseline.txt', 'allowed.txt'])
    fs.writeFileSync(path.join(destination, 'scripts/leak-guard', name), '')
  fs.writeFileSync(path.join(destination, '.gitignore'), 'node_modules/\nartifact/\n*.log\n')
  fs.writeFileSync(
    path.join(destination, 'package.json'),
    JSON.stringify(
      {
        name: 'brocrew-plugin-chrome',
        version: JSON.parse(fs.readFileSync(path.join(root, 'plugins/chrome/package.json')))
          .version,
        private: true,
        type: 'module',
        license: 'Apache-2.0',
        scripts: {
          build: 'node scripts/build-plugin-release.mjs chrome',
          test: 'vitest run --config vitest.release.config.mts',
          typecheck: 'tsc --noEmit -p plugins/chrome/tsconfig.json',
        },
        devDependencies: { vitest: '4.1.10', typescript: '5.9.3', '@types/node': '22.19.15' },
      },
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(destination, 'package-lock.json'),
    JSON.stringify(
      JSON.parse(
        fs.readFileSync(path.join(root, 'plugins/chrome/release-tooling-lock.json'), 'utf8'),
      ),
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(destination, 'README.md'),
    '# Chrome plugin for BroCrew\n\nThis repository is a clean source export of the Chrome plugin maintained and integration-tested with BroCrew. It contains no app history or client data. Its release workflow builds a deterministic archive, runs tests with fake browsers and emits the entry for BroCrew’s plugin list. Users install from Settings → Plugins; they run no commands and supply no key or token.\n\nThe first supported app target is macOS arm64. Windows and Linux app hosts are not enabled by this release. App-level archive verification and lifecycle tests remain in the BroCrew source repository.\n',
  )
  for (const script of ['plugin-source.mjs', 'build-plugin-release.mjs'])
    fs.copyFileSync(path.join(root, 'scripts', script), path.join(destination, 'scripts', script))
  fs.mkdirSync(path.join(destination, 'release-test'))
  fs.writeFileSync(path.join(destination, 'release-test/release.test.ts'), releaseTest)
  fs.writeFileSync(
    path.join(destination, 'vitest.release.config.mts'),
    `import { defineConfig } from 'vitest/config'
import { THE_GUARD, theTestsEnv } from './scripts/lib/tests-run-in-a-fictional-home.mjs'
export default defineConfig({
  test: { environment: 'node', env: theTestsEnv(), setupFiles: [THE_GUARD],
    include: ['plugins/chrome/test/**/*.test.ts', 'release-test/*.test.ts', 'scripts/test/chrome-release-guards.test.mjs'],
    exclude: ['plugins/chrome/test/archive.test.ts'],
  },
})
`,
  )

  fs.mkdirSync(path.join(destination, '.github/workflows'), { recursive: true })
  fs.writeFileSync(path.join(destination, '.github/workflows/release.yml'), workflow)
}
const releaseTest = `import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
const names = ['chrome-darwin-arm64', 'chrome-win32-x64']
it('pins the platform-neutral gzip header bytes', () => {
  const folder = process.env.BROCREW_CHROME_TEST_ARTIFACT
  expect(folder).toBeTruthy()
  for (const name of names) {
    const bytes = fs.readFileSync(path.join(folder!, name + '.tar.gz'))
    expect([...bytes.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255])
  }
})
it('publishes exactly the built archives and their fixed repository pins, one target each', () => {
  const folder = process.env.BROCREW_CHROME_TEST_ARTIFACT
  expect(folder).toBeTruthy()
  const entry = JSON.parse(fs.readFileSync(path.join(folder!, 'plugin-list-entry.json'), 'utf8'))
  expect(entry.targets.map((one: { os: string; cpu: string }) => 'chrome-' + one.os + '-' + one.cpu)).toEqual(names)
  for (const [index, name] of names.entries()) {
    const target = entry.targets[index]
    const manifest = JSON.parse(fs.readFileSync(path.join(folder!, name, 'package/plugin.json'), 'utf8'))
    expect(manifest.sourceCommit).toBe(entry.sourceCommit)
    expect(manifest.sourceCommit).toBe(process.env.BROCREW_PLUGIN_SOURCE_COMMIT)
    const bytes = fs.readFileSync(path.join(folder!, name + '.tar.gz'))
    expect(bytes.length).toBe(target.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(target.sha256)
    expect(gunzipSync(bytes).equals(fs.readFileSync(path.join(folder!, name, 'chrome.tar')))).toBe(true)
    expect(target.url).toBe('https://github.com/brocrew/brocrew-plugin-chrome/releases/download/v' + entry.version + '/' + name + '.tar.gz')
  }
})
`
const workflow = `name: Chrome release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      source_commit:
        description: Reviewed public monorepo commit (full SHA)
        required: true
        type: string
permissions:
  contents: read
jobs:
  release:
    if: github.repository == 'brocrew/brocrew-plugin-chrome' && github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: write
    env:
      BROCREW_PLUGIN_SOURCE_COMMIT: \${{ inputs.source_commit || vars.PLUGIN_SOURCE_COMMIT }}
      BROCREW_MONOREPO_ROOT: \${{ github.workspace }}/.canonical
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: '22.23.3'
      - name: Validate explicit canonical source pin
        run: node -e 'if (!/^[a-f0-9]{40}$/.test(process.env.BROCREW_PLUGIN_SOURCE_COMMIT || "")) throw new Error("A full reviewed source pin is required")'
      - uses: actions/checkout@v7
        with:
          repository: brocrew/brocrew
          ref: \${{ env.BROCREW_PLUGIN_SOURCE_COMMIT }}
          path: .canonical
          persist-credentials: false
      - run: npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
      - run: npm ci --prefix plugins/chrome --ignore-scripts --no-audit --no-fund
      - run: npm run typecheck
      - run: npm run build -- artifact
      - run: npm test
        env:
          BROCREW_CHROME_TEST_ARTIFACT: \${{ github.workspace }}/artifact
      - run: node scripts/leak-check.mjs --require-patterns
        env:
          BROBOT_LEAK_PATTERNS: \${{ secrets.BROBOT_LEAK_PATTERNS }}
      - run: node scripts/leak-check.mjs --require-patterns --require-identities --commits HEAD
        env:
          BROBOT_LEAK_PATTERNS: \${{ secrets.BROBOT_LEAK_PATTERNS }}
          BROBOT_COMMIT_PATTERNS: \${{ secrets.BROBOT_COMMIT_PATTERNS }}
          BROBOT_COMMIT_IDENTITIES: \${{ vars.BROBOT_COMMIT_IDENTITIES }}
      - name: Attach verified archives to the release
        if: startsWith(github.ref, 'refs/tags/v')
        env:
          GH_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          GH_REPO: brocrew/brocrew-plugin-chrome
          TAG: \${{ github.ref_name }}
        run: |
          set -eu
          test "$TAG" = "v$(node -p "require('./plugins/chrome/manifest-template.json').version")"
          gh release view "$TAG" >/dev/null 2>&1 || gh release create "$TAG" --title "$TAG" --notes 'Chrome plugin for BroCrew'
          gh release upload "$TAG" artifact/chrome-darwin-arm64.tar.gz artifact/chrome-win32-x64.tar.gz artifact/plugin-list-entry.json
  build-only:
    if: github.repository == 'brocrew/brocrew-plugin-chrome' && github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    env:
      BROCREW_PLUGIN_SOURCE_COMMIT: \${{ inputs.source_commit || vars.PLUGIN_SOURCE_COMMIT }}
      BROCREW_MONOREPO_ROOT: \${{ github.workspace }}/.canonical
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
          fetch-depth: 1
      - uses: actions/setup-node@v7
        with:
          node-version: '22.23.3'
      - name: Validate explicit canonical source pin
        run: node -e 'if (!/^[a-f0-9]{40}$/.test(process.env.BROCREW_PLUGIN_SOURCE_COMMIT || "")) throw new Error("A full reviewed source pin is required")'
      - uses: actions/checkout@v7
        with:
          repository: brocrew/brocrew
          ref: \${{ env.BROCREW_PLUGIN_SOURCE_COMMIT }}
          path: .canonical
          persist-credentials: false
      - run: npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
      - run: npm ci --prefix plugins/chrome --ignore-scripts --no-audit --no-fund
      - run: npm run typecheck
      - name: Refuse modified or extra package sources
        run: |
          set -eu
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          test -z "$(git status --porcelain --untracked-files=all --ignored=matching -- plugins/chrome/src plugins/chrome/ui plugins/chrome/bridge plugins/chrome/build.mjs plugins/chrome/manifest-template.json plugins/chrome/package.json plugins/chrome/package-lock.json scripts/build-plugin-release.mjs scripts/plugin-source.mjs package.json package-lock.json)"
      - run: npm run build -- artifact
      - run: npm run build -- artifact-repeat
      - name: Verify reproducible archive bytes
        run: diff -r artifact artifact-repeat
      - run: npm test
        env:
          BROCREW_CHROME_TEST_ARTIFACT: \${{ github.workspace }}/artifact
      - name: Record source and toolchain receipts
        run: |
          set -eu
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          test -z "$(git status --porcelain --untracked-files=all --ignored=matching -- plugins/chrome/src plugins/chrome/ui plugins/chrome/bridge plugins/chrome/build.mjs plugins/chrome/manifest-template.json plugins/chrome/package.json plugins/chrome/package-lock.json scripts/build-plugin-release.mjs scripts/plugin-source.mjs package.json package-lock.json)"
          git rev-parse HEAD > artifact/source-commit.txt
          node --version > artifact/node-version.txt
          npm --version > artifact/npm-version.txt
          node -p "require('./plugins/chrome/node_modules/esbuild/package.json').version" > artifact/esbuild-version.txt
          sha256sum package-lock.json plugins/chrome/package-lock.json scripts/build-plugin-release.mjs scripts/plugin-source.mjs plugins/chrome/build.mjs .github/workflows/release.yml > artifact/build-inputs.sha256
          sha256sum artifact/*.tar.gz artifact/plugin-list-entry.json > artifact/downloads.sha256
      - uses: actions/upload-artifact@v4
        with:
          name: chrome-build-only-\${{ github.sha }}
          path: artifact/
          if-no-files-found: error
          retention-days: 14
`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  exportChromePlugin(path.resolve(process.argv[2] ?? ''))
