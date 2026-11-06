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
  it(`${id} exports the loader assets declared by its settings page`, () => {
    const root = fs.mkdtempSync(path.join(tmpdir(), 'fictional-ui-export-'))
    folders.push(root)
    exportPlugin(root)
    const template = JSON.parse(
      fs.readFileSync(path.join(root, `plugins/${id}/manifest-template.json`), 'utf8'),
    )
    const html = fs.readFileSync(path.join(root, `plugins/${id}/ui/index.html`), 'utf8')
    for (const name of ['settings-load-state.js', 'settings-load-state.css']) {
      const relative = `plugins/shared/ui/${name}`
      expect(fs.readFileSync(path.join(root, relative))).toEqual(
        execFileSync('git', ['-C', repository, 'show', `HEAD:${relative}`]),
      )
      expect(html).toContain(name)
      expect(template.ui.assets.map((asset) => asset.path)).toContain(`ui/${name}`)
    }
  })
}
