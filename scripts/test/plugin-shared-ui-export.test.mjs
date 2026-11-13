import fs from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openResolvedFile } from '../../plugins/shared/file-reader.ts'
import { openGuardedFile, LocalFileGuardError } from '../../plugins/chrome/src/localFileGuard.ts'
import {
  openGuardedFile as openWhatsAppFile,
  LocalFileGuardError as WhatsAppFileError,
} from '../../plugins/whatsapp/src/localFileGuard.ts'
import { exportChromePlugin } from '../export-chrome-plugin.mjs'
import { exportWhatsAppPlugin } from '../export-whatsapp-plugin.mjs'

const repository = fileURLToPath(new URL('../..', import.meta.url))
const folders = [],
  cleanup = []
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close()
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true })
})

for (const [id, exportPlugin] of [
  ['chrome', exportChromePlugin],
  ['whatsapp', exportWhatsAppPlugin],
]) {
  it(`${id} exports the shared assets declared by its settings page`, () => {
    const base = fs.mkdtempSync(path.join(tmpdir(), 'fictional-ui-export-'))
    folders.push(base)
    const root = path.join(base, 'export')
    exportPlugin(root)
    expect(fs.existsSync(path.join(root, 'plugins/shared/atomic-file.ts'))).toBe(true)
    const builder = 'plugins/shared/package-archive.mjs'
    expect(fs.readFileSync(path.join(root, builder))).toEqual(
      execFileSync('git', ['-C', repository, 'show', `HEAD:${builder}`]),
    )
    const template = JSON.parse(
      fs.readFileSync(path.join(root, `plugins/${id}/manifest-template.json`), 'utf8'),
    )
    const html = fs.readFileSync(path.join(root, `plugins/${id}/ui/index.html`), 'utf8')
    for (const name of ['settings-load-state.js', 'rpc.js', 'base.css']) {
      const relative = `plugins/shared/ui/${name}`
      expect(fs.readFileSync(path.join(root, relative))).toEqual(
        execFileSync('git', ['-C', repository, 'show', `HEAD:${relative}`]),
      )
      expect(html).toContain(name)
      expect(template.ui.assets).toContainEqual({
        path: `ui/${name}`,
        mime: name.endsWith('.css') ? 'text/css' : 'text/javascript',
      })
    }
  })
}

function setup(data = Buffer.from('fictional bytes')) {
  const home = fs.mkdtempSync(path.join(tmpdir(), 'fictional-guarded-open-'))
  folders.push(home)
  const file = path.join(home, 'fictional.txt')
  fs.writeFileSync(file, data)
  const io = { ...fs, openSync: vi.fn(fs.openSync), closeSync: vi.fn(fs.closeSync) }
  const cfg = { roots: [home], hostHome: home, mount: '', maxBytes: 1024, fs: io }
  const open = (options = cfg, filesystem = io) =>
    openResolvedFile(
      fs.realpathSync(file),
      options,
      filesystem,
      process.platform === 'win32',
      LocalFileGuardError,
    )
  return { file, io, cfg, open }
}

describe('shared resolved file opening', () => {
  it('returns the verified descriptor and metadata', () => {
    const { file, io, open } = setup()
    const guarded = open()
    cleanup.push(guarded.close)
    expect(guarded.fd).toBe(io.openSync.mock.results[0].value)
    expect(guarded.size).toBe(15)
    expect(guarded.realPath).toBe(fs.realpathSync(file))
    expect(guarded.name).toBe('fictional.txt')
    expect(guarded.extension).toBe('txt')
  })
  it('rejects a replaced inode and closes the opened descriptor', () => {
    const { file, io, cfg, open } = setup()
    const beforeOpen = () => {
      fs.renameSync(file, `${file}.old`)
      fs.writeFileSync(file, 'replacement')
    }
    expect(() => open({ ...cfg, beforeOpen })).toThrow(
      new LocalFileGuardError(
        'This file cannot be used: the file changed while it was being opened.',
      ),
    )
    expect(io.closeSync).toHaveBeenCalledExactlyOnceWith(io.openSync.mock.results[0].value)
    expect(() => fs.fstatSync(io.openSync.mock.results[0].value)).toThrow(/EBADF/)
  })
  it('reports hard links before size refusals', () => {
    const { file, io, cfg, open } = setup(Buffer.alloc(0))
    fs.linkSync(file, `${file}.link`)
    expect(() => open({ ...cfg, maxBytes: -1 })).toThrow(
      new LocalFileGuardError(
        'This file cannot be used: it is a hard-linked file (it has more than one name).',
      ),
    )
    expect(io.closeSync).toHaveBeenCalledExactlyOnceWith(io.openSync.mock.results[0].value)
  })
  it('wraps a post-open native failure and closes the descriptor', () => {
    const { io, cfg, open } = setup()
    const failingIo = {
      ...io,
      statSync: () => {
        throw new Error('fictional stat failure')
      },
    }
    expect(() => open(cfg, failingIo)).toThrow(
      new LocalFileGuardError('This file cannot be used: it cannot be read.'),
    )
    expect(io.closeSync).toHaveBeenCalledExactlyOnceWith(io.openSync.mock.results[0].value)
  })
  it('propagates cancellation before opening without wrapping it', () => {
    const { io, cfg, open } = setup()
    const cancelled = new Error('fictional cancellation')
    try {
      open({
        ...cfg,
        beforeOpen: () => {
          throw cancelled
        },
      })
      expect.unreachable('cancelled opening should throw')
    } catch (error) {
      expect(error).toBe(cancelled)
    }
    expect(io.openSync).not.toHaveBeenCalled()
    expect(io.closeSync).not.toHaveBeenCalled()
  })
})

it.each([
  ['Chrome', openGuardedFile, LocalFileGuardError],
  ['WhatsApp', openWhatsAppFile, WhatsAppFileError],
])('%s wrapper retains its package error class', (_name, open, FileError) => {
  const { file, cfg } = setup()
  expect(() => open(file, { ...cfg, maxBytes: 1 })).toThrow(FileError)
})

it.each([
  ['Chrome', openGuardedFile],
  ['WhatsApp', openWhatsAppFile],
])('%s streams an empty regular file and closes only when asked', async (_name, open) => {
  const { file, cfg, io } = setup(Buffer.alloc(0))
  const opened = open(file, cfg)
  cleanup.push(opened.close)
  expect(opened.size).toBe(0)
  expect(opened.realPath).toBe(fs.realpathSync(file))
  const chunks = []
  for await (const chunk of opened.stream()) chunks.push(chunk)
  expect(Buffer.concat(chunks)).toEqual(Buffer.alloc(0))
  expect(fs.fstatSync(opened.fd).size).toBe(0)
  expect(io.closeSync).not.toHaveBeenCalled()
  opened.close()
  opened.close()
  expect(io.closeSync).toHaveBeenCalledExactlyOnceWith(opened.fd)
  expect(() => fs.fstatSync(opened.fd)).toThrow(/EBADF/)
})
