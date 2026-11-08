import { createRequire } from 'node:module'
const workspace = createRequire(import.meta.url)
const builder = createRequire(workspace.resolve('electron-builder/package.json'))
const library = createRequire(builder.resolve('app-builder-lib/package.json'))
export default {
  buildBlockMap: library('./out/targets/blockmap/blockmap.js').buildBlockMap,
  loadYaml: library('js-yaml').load,
}
