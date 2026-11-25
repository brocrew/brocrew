// Explicit local source export; never copies history, dependency folders or pushes a repository.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { exportPluginRepository } from './plugin-source.mjs'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export function exportWhatsAppPlugin(destination) {
  exportPluginRepository(root, destination, 'whatsapp', { readme, releaseTest, workflow })
}
const readme =
  '# WhatsApp plugin for BroCrew\n\nThis repository is a clean source export of the WhatsApp plugin maintained and integration-tested with BroCrew. It contains no app history, no WhatsApp session and no messages. Its release workflow builds reproducible archives for macOS arm64 and Windows x64 with Go 1.27.2 and no cgo, runs the tests with a fake bridge and made-up chats, and emits the entry for BroCrew’s plugin list. Users install from Settings → Plugins and link a phone by scanning a QR code; they run no commands and supply no key or token.\n\nBroCrew installs the archive for its own system; on Windows that needs an app whose plugin host runs plugins there. The plugin’s own notes are in `plugins/whatsapp/README.md`; the copied code’s MIT notice is in `plugins/whatsapp/bridge/UPSTREAM-LICENSE`.\n'
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
    expect(manifest.sourceCommit).toBe(process.env.BROCREW_PLUGIN_SOURCE_COMMIT)
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
    env:
      BROCREW_PLUGIN_SOURCE_COMMIT: \${{ github.sha }}
    steps:
      - uses: actions/checkout@v7
        with:
          persist-credentials: false
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
    env:
      BROCREW_PLUGIN_SOURCE_COMMIT: \${{ github.sha }}
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
      - run: BROCREW_GO="$(command -v go)" npm run build -- artifact
      - run: npm test
        env:
          BROCREW_WHATSAPP_TEST_ARTIFACT: \${{ github.workspace }}/artifact
      - uses: actions/upload-artifact@v4
        with:
          name: whatsapp-build-only-\${{ github.sha }}
          path: artifact/
          if-no-files-found: error
          retention-days: 14
`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  exportWhatsAppPlugin(path.resolve(process.argv[2] ?? ''))
