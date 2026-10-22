// Explicit local source export; never copies history, dependency folders or pushes a repository.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function exportWhatsAppPlugin(destination) {
  if (!path.isAbsolute(destination) || fs.existsSync(destination))
    throw new Error('Use a fresh absolute export folder')
  const plugin = path.join(destination, 'plugins/whatsapp')
  fs.mkdirSync(plugin, { recursive: true })
  for (const name of [
    'src',
    'bridge',
    'ui',
    'test',
    'COPY-INVENTORY.json',
    'README.md',
    'UPSTREAM-CHANGES.md',
    'build.mjs',
    'manifest-template.json',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'vitest.config.ts',
  ]) {
    fs.cpSync(path.join(root, 'plugins/whatsapp', name), path.join(plugin, name), {
      recursive: true,
      filter(source) {
        if (fs.lstatSync(source).isSymbolicLink()) throw new Error('No linked export inputs')
        return true
      },
    })
  }
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
  fs.mkdirSync(path.join(destination, 'scripts/leak-guard'), { recursive: true })
  for (const name of ['baseline.txt', 'allowed.txt'])
    fs.writeFileSync(path.join(destination, 'scripts/leak-guard', name), '')
  fs.writeFileSync(path.join(destination, '.gitignore'), 'node_modules/\nartifact/\n*.log\n')
  fs.writeFileSync(
    path.join(destination, 'package.json'),
    JSON.stringify(
      {
        name: 'brocrew-plugin-whatsapp',
        version: JSON.parse(fs.readFileSync(path.join(root, 'plugins/whatsapp/package.json')))
          .version,
        private: true,
        type: 'module',
        license: 'Apache-2.0',
        scripts: {
          build: 'node scripts/release.mjs',
          test: 'vitest run --config plugins/whatsapp/vitest.config.ts',
          typecheck: 'tsc --noEmit -p plugins/whatsapp/tsconfig.json',
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
        fs.readFileSync(path.join(root, 'plugins/whatsapp/release-tooling-lock.json'), 'utf8'),
      ),
      null,
      2,
    ) + '\n',
  )
  fs.writeFileSync(
    path.join(destination, 'README.md'),
    '# WhatsApp plugin for BroCrew\n\nThis repository is a clean source export of the WhatsApp plugin maintained and integration-tested with BroCrew. It contains no app history, no WhatsApp session and no messages. Its release workflow builds reproducible archives for macOS arm64 and Windows x64 with Go 1.27.2 and no cgo, runs the tests with a fake bridge and made-up chats, and emits the entry for BroCrew’s plugin list. Users install from Settings → Plugins and link a phone by scanning a QR code; they run no commands and supply no key or token.\n\nBroCrew installs the archive for its own system; on Windows that needs an app whose plugin host runs plugins there. The plugin’s own notes are in `plugins/whatsapp/README.md`; the copied code’s MIT notice is in `plugins/whatsapp/bridge/UPSTREAM-LICENSE`.\n',
  )
  fs.writeFileSync(path.join(destination, 'scripts/release.mjs'), releaseScript)
  fs.writeFileSync(path.join(plugin, 'test/release.test.ts'), releaseTest)
  fs.mkdirSync(path.join(destination, '.github/workflows'), { recursive: true })
  fs.writeFileSync(path.join(destination, '.github/workflows/release.yml'), workflow)
}
const releaseScript = `import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { gzipSync } from 'node:zlib'
import { buildWhatsAppPackage, WHATSAPP_TARGETS } from '../plugins/whatsapp/build.mjs'
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
const out = path.resolve(process.argv[2] ?? 'artifact')
fs.mkdirSync(out)
const targets = []
let version
for (const target of WHATSAPP_TARGETS) {
  const name = 'whatsapp-' + target.os + '-' + target.cpu
  const built = path.join(out, name)
  const release = await buildWhatsAppPackage(built, commit, undefined, target)
  version = release.version
  const bytes = gzipSync(fs.readFileSync(path.join(built, 'whatsapp.tar')), { level: 9 })
  // zlib emits a host-specific OS byte. Canonicalize it; payload and trailer stay unchanged.
  bytes[9] = 255
  fs.writeFileSync(path.join(out, name + '.tar.gz'), bytes)
  targets.push({ os: target.os, cpu: target.cpu,
    url: 'https://github.com/brocrew/brocrew-plugin-whatsapp/releases/download/v' + version + '/' + name + '.tar.gz',
    sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    compression: 'tar.gz', manifestSha256: release.manifestSha256 })
}
const entry = {
  id: 'whatsapp', name: 'WhatsApp',
  description: 'Lets agents read your WhatsApp chats when you allow it, and send to the groups you choose.',
  version, minAppVersion: '0.0.0', sourceCommit: commit, targets,
}
fs.writeFileSync(path.join(out, 'plugin-list-entry.json'), JSON.stringify(entry, null, 2) + '\\n')
console.log(JSON.stringify(targets.map((one) => ({ os: one.os, cpu: one.cpu, bytes: one.bytes, sha256: one.sha256 }))))
`
const releaseTest = `import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { expect, it } from 'vitest'
const folder = process.env.BROCREW_WHATSAPP_TEST_ARTIFACT
const names = ['whatsapp-darwin-arm64', 'whatsapp-win32-x64']
it.skipIf(!folder)('pins the platform-neutral gzip header bytes', () => {
  for (const name of names) {
    const bytes = fs.readFileSync(path.join(folder!, name + '.tar.gz'))
    expect([...bytes.subarray(0, 10)]).toEqual([0x1f, 0x8b, 8, 0, 0, 0, 0, 0, 2, 255])
  }
})
it.skipIf(!folder)('publishes exactly the built archives and their fixed repository pins, one target each', () => {
  const entry = JSON.parse(fs.readFileSync(path.join(folder!, 'plugin-list-entry.json'), 'utf8'))
  expect(entry.targets.map((one: { os: string; cpu: string }) => 'whatsapp-' + one.os + '-' + one.cpu)).toEqual(names)
  for (const [index, name] of names.entries()) {
    const target = entry.targets[index]
    const bytes = fs.readFileSync(path.join(folder!, name + '.tar.gz'))
    expect(bytes.length).toBe(target.bytes)
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(target.sha256)
    expect(gunzipSync(bytes).equals(fs.readFileSync(path.join(folder!, name, 'whatsapp.tar')))).toBe(true)
    expect(target.url).toBe('https://github.com/brocrew/brocrew-plugin-whatsapp/releases/download/v' + entry.version + '/' + name + '.tar.gz')
    const manifest = JSON.parse(fs.readFileSync(path.join(folder!, name, 'package/plugin.json'), 'utf8'))
    expect(manifest.sourceCommit).toBe(entry.sourceCommit)
    if (process.env.GITHUB_SHA) expect(manifest.sourceCommit).toBe(process.env.GITHUB_SHA)
    expect(manifest.platforms).toEqual([{ os: target.os, cpu: target.cpu }])
  }
})
`
const workflow = `name: WhatsApp release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
permissions:
  contents: read
jobs:
  release:
    if: github.repository == 'brocrew/brocrew-plugin-whatsapp' && github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v')
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
          fetch-depth: 0
      - uses: actions/setup-node@v7
        with:
          node-version: '22.23.3'
      - uses: actions/setup-go@v6
        with:
          go-version: '1.27.2'
          cache: false
      - run: npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
      - run: npm ci --prefix plugins/whatsapp --ignore-scripts --no-audit --no-fund
      - run: npm run typecheck
      - run: go vet ./... && go test ./... && GOOS=windows GOARCH=amd64 go vet ./...
        working-directory: plugins/whatsapp/bridge
        env:
          CGO_ENABLED: '0'
          GOTOOLCHAIN: local
      - run: BROCREW_GO="$(command -v go)" npm run build -- artifact
      - run: npm test
        env:
          BROCREW_WHATSAPP_TEST_ARTIFACT: \${{ github.workspace }}/artifact
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
          GH_REPO: brocrew/brocrew-plugin-whatsapp
          TAG: \${{ github.ref_name }}
        run: |
          set -eu
          test "$TAG" = "v$(node -p "require('./plugins/whatsapp/manifest-template.json').version")"
          gh release view "$TAG" >/dev/null 2>&1 || gh release create "$TAG" --title "$TAG" --notes 'WhatsApp plugin for BroCrew'
          gh release upload "$TAG" artifact/whatsapp-darwin-arm64.tar.gz artifact/whatsapp-win32-x64.tar.gz artifact/plugin-list-entry.json
  build-only:
    if: github.repository == 'brocrew/brocrew-plugin-whatsapp' && github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
          fetch-depth: 1
      - uses: actions/setup-node@v7
        with:
          node-version: '22.23.3'
      - uses: actions/setup-go@v6
        with:
          go-version: '1.27.2'
          cache: false
      - run: npm ci --legacy-peer-deps --ignore-scripts --no-audit --no-fund
      - run: npm ci --prefix plugins/whatsapp --ignore-scripts --no-audit --no-fund
      - run: npm run typecheck
      - run: go vet ./... && go test ./... && GOOS=windows GOARCH=amd64 go vet ./...
        working-directory: plugins/whatsapp/bridge
        env:
          CGO_ENABLED: '0'
          GOTOOLCHAIN: local
      - name: Refuse modified or extra package sources
        run: |
          set -eu
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          test -z "$(git status --porcelain --untracked-files=all --ignored=matching -- plugins/whatsapp/src plugins/whatsapp/ui plugins/whatsapp/bridge plugins/whatsapp/build.mjs plugins/whatsapp/manifest-template.json plugins/whatsapp/package.json plugins/whatsapp/package-lock.json scripts/release.mjs package.json package-lock.json)"
      - run: BROCREW_GO="$(command -v go)" npm run build -- artifact
      - run: BROCREW_GO="$(command -v go)" npm run build -- artifact-repeat
      - name: Verify reproducible archive bytes
        run: diff -r artifact artifact-repeat
      - run: npm test
        env:
          BROCREW_WHATSAPP_TEST_ARTIFACT: \${{ github.workspace }}/artifact
      - name: Record source and toolchain receipts
        run: |
          set -eu
          test "$(git rev-parse HEAD)" = "$GITHUB_SHA"
          test -z "$(git status --porcelain --untracked-files=all --ignored=matching -- plugins/whatsapp/src plugins/whatsapp/ui plugins/whatsapp/bridge plugins/whatsapp/build.mjs plugins/whatsapp/manifest-template.json plugins/whatsapp/package.json plugins/whatsapp/package-lock.json scripts/release.mjs package.json package-lock.json)"
          git rev-parse HEAD > artifact/source-commit.txt
          node --version > artifact/node-version.txt
          npm --version > artifact/npm-version.txt
          node -p "require('./plugins/whatsapp/node_modules/esbuild/package.json').version" > artifact/esbuild-version.txt
          go version > artifact/go-version.txt
          sha256sum package-lock.json plugins/whatsapp/package-lock.json scripts/release.mjs plugins/whatsapp/build.mjs .github/workflows/release.yml > artifact/build-inputs.sha256
          sha256sum artifact/*.tar.gz artifact/plugin-list-entry.json > artifact/downloads.sha256
      - uses: actions/upload-artifact@v4
        with:
          name: whatsapp-build-only-\${{ github.sha }}
          path: artifact/
          if-no-files-found: error
          retention-days: 14
`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  exportWhatsAppPlugin(path.resolve(process.argv[2] ?? ''))
