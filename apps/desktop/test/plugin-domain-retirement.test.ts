import { expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

async function sources(root: string): Promise<Array<[string, string]>> {
  const result: Array<[string, string]> = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) result.push(...await sources(path))
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) result.push([path, await readFile(path, 'utf8')])
  }
  return result
}

it('has no application-owned domain dispatcher, ledger reader or person proposal executor', async () => {
  const root = fileURLToPath(new URL('../src/', import.meta.url))
  const forbidden = /\b(?:pluginAdapter|requirePluginAdapter|PluginProfileLedger|ChromeProposal|WhatsAppProposal|chromeProfileIntent|profileRevision|applyProfile|PluginUiPeer|PluginUiRpc|proposeConfig|configure-ledger)\b|(?:chrome|whatsapp)-(?:apply|read|broker|policy)|\/v1\/(?:profiles|groups|status|uninstall)/
  const violations = (await sources(root)).flatMap(([path, source]) =>
    source.split('\n').flatMap((line, index) => forbidden.test(line) ? [`${path}:${index + 1}: ${line}`] : []),
  )
  // Historical declarations are decoded only in package-schema, never executable UI RPC.
  expect(violations.filter((line) => !line.includes('/plugins/package-schema.ts:'))).toEqual([])
})
