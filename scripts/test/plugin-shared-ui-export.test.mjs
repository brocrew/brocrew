import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { exportChromePlugin } from '../export-chrome-plugin.mjs'
import { exportWhatsAppPlugin } from '../export-whatsapp-plugin.mjs'

const repository = fileURLToPath(new URL('../..', import.meta.url))
const folders = []
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

for (const [id, exportPlugin] of [
  ['chrome', exportChromePlugin],
  ['whatsapp', exportWhatsAppPlugin],
]) {
  it(`${id} exports the loader script declared by its settings page`, () => {
    const base = fs.mkdtempSync(path.join(tmpdir(), 'fictional-ui-export-'))
    folders.push(base)
    const root = path.join(base, 'export')
    exportPlugin(root)
    expect(fs.existsSync(path.join(root, 'plugins/shared/atomic-file.ts'))).toBe(true)
    const template = JSON.parse(
      fs.readFileSync(path.join(root, `plugins/${id}/manifest-template.json`), 'utf8'),
    )
    const html = fs.readFileSync(path.join(root, `plugins/${id}/ui/index.html`), 'utf8')
    const name = 'settings-load-state.js'
    const relative = `plugins/shared/ui/${name}`
    expect(fs.readFileSync(path.join(root, relative))).toEqual(
      execFileSync('git', ['-C', repository, 'show', `HEAD:${relative}`]),
    )
    expect(html).toContain(name)
    expect(template.ui.assets.map((asset) => asset.path)).toContain(`ui/${name}`)
  })
}
