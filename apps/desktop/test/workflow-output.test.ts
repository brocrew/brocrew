import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { resolveAssetRequest } from '../src/main/asset-protocol'
import { MAX_OUTPUT_BYTES, readWorkflowOutput } from '../src/main/workflow-output'
import { assetUrl } from '../src/shared/asset-url'

/**
 * 108 · The file a workflow-output read will open, and everything it will not.
 *
 * ⚑ **`726` · R92 — what it opens is decided by the file's TYPE, never by its name or place.** From
 * 108 until `726` it had to be named after the run (`<task_id><ext>`); R92 removed that rule, and
 * its test below now pins the opposite.
 *
 * 🔴 **731 · and the type asked is only *is it text*.** Until `731` it also had to carry one of eight
 * text extensions, whose point was *"that a private key is not on it"*; the PM ruled that allow-list
 * away (`726` §9). ⚠️ The fixtures named like credentials here are planted text, never a real one.
 *
 * ⚠️ **Driven against real files, real symlinks and a real fifo**, exactly as `asset-protocol`'s own
 * tests are — the whole point of this module is a filesystem boundary, and a mocked `fs` would
 * assert that the mock behaves the way the code expects rather than that the code is safe.
 */

let root: string

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'brobot2-108-'))
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

const write = (name: string, body: string): string => {
  const path = join(root, name)
  writeFileSync(path, body)
  return path
}

describe('what it opens (108)', () => {
  it('reads a workflow output and names it', () => {
    const path = write('wq1demo.output', '# Winner\n\nthe-wait\n')
    const read = readWorkflowOutput(path)
    expect(read).toEqual({
      name: 'wq1demo.output',
      text: '# Winner\n\nthe-wait\n',
      truncated: false,
      bytes: 19,
    })
  })

  it('🔴 731 · a text file opens whatever its extension — the ones the old list refused included', () => {
    // ⛔ On `main` the second loop was refused `not-readable`: eight extensions were the whole list.
    for (const ext of ['.output', '.md', '.txt', '.json', '.jsonl', '.log']) {
      const id = `run${ext.slice(1)}`
      expect(readWorkflowOutput(write(`${id}${ext}`, 'x')), ext).toMatchObject({ text: 'x' })
    }
    for (const ext of ['', '.pem', '.sh', '.sqlite', '.toml']) {
      const id = `was${ext.slice(1)}`
      expect(readWorkflowOutput(write(`${id}${ext}`, 'x')), ext).toMatchObject({ text: 'x' })
    }
  })

  it('🔴 731 · a binary is refused whatever it is called — it cannot be drawn as text', () => {
    // ⛔ On `main` a binary with a text extension was READ and drawn as mojibake: the list asked
    // the name, never the bytes.
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00])
    for (const name of ['binary.output', 'binary.txt', 'binary.md']) {
      const path = join(root, name)
      writeFileSync(path, bytes)
      expect(readWorkflowOutput(path), name).toBe('not-readable')
    }
    // …and one NUL is the whole test: the same text without it is read.
    expect(readWorkflowOutput(write('nearly.txt', 'PNG\r\n'))).toMatchObject({ text: 'PNG\r\n' })
  })

  it('⚑ THE CONTROL — an image under an image’s name is not drawn as text, on either tree', () => {
    const png = join(root, 'picture.png')
    writeFileSync(png, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))
    expect(readWorkflowOutput(png)).toBe('not-readable')
    // ⚑ …and an image is still DRAWN — by the door that draws images (`asset-protocol.ts`), whose
    // type check the ruling keeps because it is about what can be drawn (`726` §9, `731`).
    expect(resolveAssetRequest(assetUrl(png))).toMatchObject({ contentType: 'image/png' })
  })

  it('🔴 726 · R92 — a file NOT named after the run opens; whether it is text is what is asked', () => {
    // ⛔ On `main` this was refused (108 review: the basename had to be `<task_id><ext>`, so a
    // provider reporting some other file — the example was `~/.claude.json` — read nothing).
    const other = write('.claude.json', '{"a":"fixture"}')
    expect(readWorkflowOutput(other)).toMatchObject({
      name: '.claude.json',
      text: '{"a":"fixture"}',
    })
    // …and through a link named like a run's output, judged by where it LANDS.
    const alias = join(root, 'decoyrun.json')
    symlinkSync(other, alias)
    expect(readWorkflowOutput(alias)).toMatchObject({ name: '.claude.json' })
    // ⚑ The controls, the same on both trees: an image is not drawn as text, and a file that is not
    // there is still `gone`, wherever either one is.
    const binary = join(root, 'otherrun.png')
    writeFileSync(binary, Buffer.from([0x00, 0x01, 0x02]))
    expect(readWorkflowOutput(binary)).toBe('not-readable')
    expect(readWorkflowOutput(join(root, 'otherrun-never-written.output'))).toBe('gone')
  })

  it('a long file is truncated OUT LOUD, with its real size', () => {
    // 092's rule. A document cut at the ceiling that did not say so would read as a run that
    // produced less than it did.
    const path = write('big.output', 'x'.repeat(MAX_OUTPUT_BYTES + 500))
    const read = readWorkflowOutput(path)
    expect(read).toMatchObject({ truncated: true, bytes: MAX_OUTPUT_BYTES + 500 })
    if (typeof read === 'string') throw new Error('unreachable')
    expect(read.text).toHaveLength(MAX_OUTPUT_BYTES)
    // …and the paired positive: a file that FITS is not marked truncated.
    expect(readWorkflowOutput(write('small.output', 'x'))).toMatchObject({
      truncated: false,
    })
  })

  it('an empty output is a document, not a refusal', () => {
    // A run that wrote nothing still wrote a file. "Empty" and "could not be read" are different
    // sentences and the viewer says different things about them.
    expect(readWorkflowOutput(write('empty.output', ''))).toEqual({
      name: 'empty.output',
      text: '',
      truncated: false,
      bytes: 0,
    })
  })
})

describe('what it refuses, and why each refusal is its own word (108)', () => {
  it('a file that is not there is `gone` — the ORDINARY case, not an error', () => {
    // Workflow outputs live under the OS temp directory, which the system clears. A reader coming
    // back to last week's conversation hits this on the normal path.
    expect(readWorkflowOutput(join(root, 'never-existed.output'))).toBe('gone')
  })

  it.skipIf(process.platform === 'win32')(
    '🔴 731 · a file this user may not read is `unreadable` — it is there — never `gone`',
    () => {
      // ⛔ On `main` every failed `open` was `gone`, and the viewer said *"no longer on disk"* about a
      // file that is there. The extension list had kept most such files from arriving; it is gone.
      if (process.getuid?.() === 0) return // root reads a 0000 file, so there is nothing to refuse
      const locked = write('locked.output', 'secret-shaped text')
      chmodSync(locked, 0o000)
      try {
        expect(readWorkflowOutput(locked)).toBe('unreadable')
      } finally {
        chmodSync(locked, 0o600)
      }
    },
  ) // chmod 000 does not deny reads through a Windows ACL.

  it.skipIf(process.platform === 'win32')(
    '🔴 731 · a socket is `not-readable` — it cannot be shown as text — never `gone`',
    async () => {
      const path = join(root, 'listening.output')
      const server = createServer()
      await new Promise<void>((resolve) => server.listen(path, resolve))
      try {
        // ⛔ On `main`: `gone` (open(2) refuses a socket with EOPNOTSUPP, and every refusal was `gone`).
        expect(readWorkflowOutput(path)).toBe('not-readable')
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
  ) // This fixture binds a POSIX-domain socket to a filesystem path.

  it('a relative path, and a path with a NUL, are refused before any syscall', () => {
    // A NUL truncates at the syscall boundary, so the name that would be opened is not the name we
    // checked. Refused rather than trimmed.
    expect(readWorkflowOutput('relative.output')).toBe('not-readable')
    expect(readWorkflowOutput('/tmp/evil\0.output')).toBe('not-readable')
  })

  it('🔴 731 · a symlink is read where it REALLY goes — a key-shaped text file included', () => {
    // ⛔ On `main` `pretty.output → secret_key` was refused for what it resolved to: a name with no
    // text extension. ⚠️ The "key" is planted text, never a credential.
    const secret = write('secret_key', 'BEGIN PRIVATE KEY')
    const link = join(root, 'pretty.output')
    symlinkSync(secret, link)
    // Named for its TARGET, which is what the resolved-path rule means.
    expect(readWorkflowOutput(link)).toMatchObject({
      name: 'secret_key',
      text: 'BEGIN PRIVATE KEY',
    })
    // ⚑ THE CONTROL: a link to a binary is refused for where it lands, whatever it is called.
    const binary = join(root, 'blob')
    writeFileSync(binary, Buffer.from([0x00, 0xff]))
    const alias = join(root, 'alias.md')
    symlinkSync(binary, alias)
    expect(readWorkflowOutput(alias)).toBe('not-readable')
  })

  it('a directory is not a document', () => {
    expect(readWorkflowOutput(root)).toBe('not-readable')
  })

  it.skipIf(process.platform === 'win32')(
    'a fifo is refused rather than read — it would block the MAIN process forever',
    () => {
      // ⚠️ **The one refusal whose absence is a HANG rather than a hole — and this test found it.**
      // The module originally opened without `O_NONBLOCK` and checked `isFile()` afterwards, on the
      // theory that `readSync` was the blocking call. It is `open(2)` itself: on a fifo with no
      // writer it never returns, in the process that must never stutter. Written as a normal
      // assertion, this test froze the whole suite instead of failing — which is why the fix is
      // `O_NONBLOCK` on the open and not a better check after it.
      const fifo = join(root, 'pipe.output')
      execFileSync('mkfifo', [fifo])
      expect(readWorkflowOutput(fifo)).toBe('not-readable')
    },
  ) // This fixture requires POSIX mkfifo; Windows named pipes have another pathname form.
})
