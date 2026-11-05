import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import source from './fixtures/plugin-encoder-820/source.json'
const root = fileURLToPath(new URL('./fixtures/plugin-encoder-820/', import.meta.url))
it.each(source.files)(
  'uses separately identified actual 820 encoder source $path without relabelling unavailable 22 bytes',
  async (file) => {
    const adapted = await readFile(join(root, file.file), 'utf8')
    if ('kind' in file && file.kind === 'exact-type-excerpt-no-runtime') {
      const raw = await readFile(join(root, file.rawFile!), 'utf8')
      expect(createHash('sha256').update(raw).digest('hex')).toBe(file.sourceSha256)
      expect(createHash('sha256').update(adapted).digest('hex')).toBe(file.excerptSha256)
      expect(
        raw
          .split('\n')
          .slice(file.startLine! - 1, file.endLine)
          .join('\n') + '\n',
      ).toBe(adapted)
      return
    }
    const imports = new Map<string, string>(Object.entries(file.imports))
    const original = adapted.replace(/from '(\.[^']+)'/g, (_, spec: string) => {
      expect(imports.has(spec)).toBe(true)
      return `from '${imports.get(spec)}'`
    })
    expect(createHash('sha256').update(original).digest('hex')).toBe(file.sourceSha256)
    expect(file.commit).toBe('82054a3e7c1954398a7c5fc4765c95fafd2db22e')
  },
)

it.each(['plugin-update-parent', 'plugin-delete-parent', 'plugin-disclosure-mixed'])(
  'keeps every frozen %s byte fixture as labelled data, with no executable source files',
  async (name) => {
    const directory = fileURLToPath(new URL('./fixtures/' + name + '/', import.meta.url))
    type FrozenFile = { file: string; frozenSha256: string }
    const provenance = JSON.parse(await readFile(join(directory, 'source.json'), 'utf8')) as
      { files: FrozenFile[] } | FrozenFile[]
    const files = Array.isArray(provenance) ? provenance : provenance.files
    const extra = JSON.parse(await readFile(join(directory, 'FROZEN.json'), 'utf8')) as {
      execution: string
      additionalFiles: Array<{ file: string; frozenSha256: string }>
    }
    expect(extra.execution).toContain('forbidden')
    for (const file of files)
      expect(
        createHash('sha256')
          .update(await readFile(join(directory, file.file)))
          .digest('hex'),
      ).toBe(file.frozenSha256)
    for (const file of extra.additionalFiles)
      expect(
        createHash('sha256')
          .update(await readFile(join(directory, file.file)))
          .digest('hex'),
      ).toBe(file.frozenSha256)
  },
)
