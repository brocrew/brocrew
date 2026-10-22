import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ClaudeRuntime, claudeProjectDirName } from '../src/claude/claude-runtime'
import { CodexRuntime, createSpawnTransportFactory } from '../src/codex/codex-runtime'
import { CODEX_PROTOCOL_VERSION } from '../src/codex/protocol-version'
import { FakeProviderSessions, FakeRuntime } from '../src/fake-runtime'
import { ResumeError } from '../src/runtime'
import {
  A_CODEX_THREAD,
  aCodexThatRefuses,
  aRolloutOf,
  type ResumeRefusal,
} from './fixtures/a-codex-that-refuses'

/**
 * # 🔴 706 · a session the provider no longer has — told apart from a resume that failed, BY WHAT IT IS
 *
 * ⚑ **`705` F-3**: *"A thread Codex no longer has carries a cause, the JSON-RPC refusal. The host
 * forgets a quit-kept conversation only for a CAUSELESS `ResumeError`, so that path never forgets a
 * lost Codex thread."* ⛔ **Whether an error carries a cause was never what it IS** — Claude's
 * not-found happens to have none, and every Codex failure has one since `673`.
 *
 * ⚑ **So the answer is a field the adapter sets where it KNOWS**: `ResumeError.noSuchSession`. The
 * Codex arms run the product's own `createSpawnTransportFactory` and `CodexRuntime.resume` against a
 * `codex` that answers `thread/resume` with the bytes `probe:codex-lost-thread` measured on the
 * bundled `0.146.0` (`fixtures/codex-resume-refusals.mjs`).
 *
 * ⛔ **The controls are the other half of the ruling**: *"A transient failure must never make the app
 * forget a conversation."* Every arm below that is not a never must come out NOT marked — an
 * app-server that died, a refusal for another reason, the not-found words about another thread or
 * under another code, and the not-found words while the thread's rollout IS on disk.
 *
 * ⚠️ **Written to run on `main`**, where the field does not exist: {@link markedGone} reads it
 * structurally, so the subjects are red there and the Codex controls are not. ⚠️ Three checks the
 * review added are red on `main` too, and measure a fix rather than a control: the unreadable Claude
 * home's cause (`main` threw a causeless *"session not found"*), the bare constructor's default
 * (`main` had no field) and Claude's folder named the SDK's way (`main` looked elsewhere).
 */

const roots: string[] = []
/** Directories a test made unreadable — made readable again before anything is removed. */
const locked: string[] = []
afterEach(() => {
  for (const dir of locked.splice(0)) chmodSync(dir, 0o755)
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), 'brobot2-706-'))
  roots.push(root)
  return root
}

/** ⚑ Whether a resume's failure says the provider does not have the session — and nothing else. */
function markedGone(error: unknown): boolean {
  return (
    error instanceof ResumeError && (error as { noSuchSession?: unknown }).noSuchSession === true
  )
}

/** ⚑ The product's Codex resume, over the product's factory, against a `codex` playing `scenario`. */
async function codexResume(
  scenario: ResumeRefusal,
  plant:
    'nothing' | 'its-rollout' | 'its-archived-rollout' | 'an-unreadable-sessions-tree' = 'nothing',
): Promise<unknown> {
  const root = scratch()
  const home = join(root, 'home')
  const cwd = join(root, 'cwd')
  mkdirSync(home, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  if (plant === 'its-rollout') aRolloutOf(home, A_CODEX_THREAD)
  if (plant === 'its-archived-rollout') aRolloutOf(home, A_CODEX_THREAD, 'archived_sessions')
  if (plant === 'an-unreadable-sessions-tree') {
    const sessions = join(home, 'sessions')
    mkdirSync(sessions)
    chmodSync(sessions, 0o000)
    locked.push(sessions)
  }
  const codex = aCodexThatRefuses(join(root, 'bin'), scenario, CODEX_PROTOCOL_VERSION, cwd)
  return new CodexRuntime(createSpawnTransportFactory(codex))
    .resume(
      { provider: 'codex', sessionId: A_CODEX_THREAD, cwd, rotation: 0 },
      { providerHome: home },
    )
    .then(
      async (handle) => {
        await handle.close()
        return handle
      },
      (error: unknown) => error,
    )
}

describe('706 · Codex — the app-server’s own answer, over the product’s own transport', () => {
  it('⚑ the rig resumes a thread the app-server HAS — the positive every refusal below is read against', async () => {
    const outcome = await codexResume('answers')
    expect(outcome).not.toBeInstanceOf(Error)
    expect((outcome as { ref?: { sessionId?: string } }).ref?.sessionId).toBe(A_CODEX_THREAD)
  })

  it('🔴 *"no rollout found for thread id <it>"* — an id it never had, a wiped home — is a session it does not have', async () => {
    const outcome = await codexResume('no-rollout')
    expect(outcome).toBeInstanceOf(ResumeError)
    expect(markedGone(outcome)).toBe(true)
    // ⚑ The refusal is still carried, as it was: nothing a caller reads today is taken away.
    expect((outcome as Error).message).toBe(
      `resume failed: {"code":-32600,"message":"no rollout found for thread id ${A_CODEX_THREAD}"}`,
    )
    expect((outcome as Error).cause).toBeInstanceOf(Error)
  })

  it('🔴 *"failed to resolve rollout path `…<it>.jsonl`: file does not exist"* — its own record names a file that is gone', async () => {
    const outcome = await codexResume('rollout-path')
    expect(outcome).toBeInstanceOf(ResumeError)
    expect(markedGone(outcome)).toBe(true)
  })

  it('🔴 the transport says WHICH request was refused, and with what — the JSON-RPC error as the app-server sent it', async () => {
    const outcome = await codexResume('no-rollout')
    const refused = (outcome as Error).cause as { method?: unknown; refusal?: unknown }
    expect(refused.method).toBe('thread/resume')
    expect(refused.refusal).toEqual({
      code: -32600,
      message: `no rollout found for thread id ${A_CODEX_THREAD}`,
    })
  })

  describe('⛔ the controls — a failure of THIS attempt is never a session that is gone', () => {
    it('an app-server that died as the resume was asked', async () => {
      const outcome = await codexResume('died')
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
    })

    it('a refusal of `thread/resume` for another reason (a history it could not load)', async () => {
      const outcome = await codexResume('other-refusal')
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
    })

    it('the not-found words about ANOTHER thread', async () => {
      const outcome = await codexResume('another-thread')
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
    })

    it('the not-found words under a code the app-server does not give them', async () => {
      const outcome = await codexResume('another-code')
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
    })

    it('the rollout-path words naming ANOTHER thread’s file', async () => {
      const outcome = await codexResume('another-rollout-path')
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
    })

    it('the not-found words about this thread — as the answer to `initialize`, not to `thread/resume`', async () => {
      const outcome = await codexResume('initialize-refused')
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
    })

    it('⚠️ the not-found words while the thread’s rollout is ARCHIVED — still on disk, so it is kept', async () => {
      // ⚑ Kept on purpose: an archived thread is one `thread/unarchive` brings back, and nothing in
      // this app archives one (`lost-thread.ts`).
      const outcome = await codexResume('no-rollout', 'its-archived-rollout')
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
    })

    it('🔴 the not-found words while the home’s rollouts could not be READ — a doubt keeps it', async () => {
      const outcome = await codexResume('no-rollout', 'an-unreadable-sessions-tree')
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
    })

    it('🔴 the not-found words while the thread’s rollout IS on disk — the provider misread, and the app does not forget', async () => {
      const outcome = await codexResume('no-rollout', 'its-rollout')
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
      // ⚑ …and the paired subject, the same refusal with nothing on disk, is `true` above.
    })
  })
})

describe('706 · Claude and the double — the same field, where each already knew', () => {
  const claudeRef = (cwd: string) =>
    ({ provider: 'claude', sessionId: 'sess_706', cwd, rotation: 0 }) as const

  it('🔴 Claude’s *"session not found"* — its own existence probe answered no — is a session it does not have', async () => {
    const root = scratch()
    const outcome = await new ClaudeRuntime(undefined, async () => false)
      .resume(claudeRef(root), { providerHome: join(root, 'home') })
      .catch((error: unknown) => error)
    expect(outcome).toBeInstanceOf(ResumeError)
    expect(markedGone(outcome)).toBe(true)
  })

  it('🔴 Claude’s OWN probe, on a home that does not hold the transcript — a session it does not have', async () => {
    const root = scratch()
    const home = join(root, 'home')
    mkdirSync(join(home, 'projects'), { recursive: true })
    const outcome = await new ClaudeRuntime()
      .resume(claudeRef(root), { providerHome: home })
      .catch((error: unknown) => error)
    expect(outcome).toBeInstanceOf(ResumeError)
    expect(markedGone(outcome)).toBe(true)
  })

  // Windows chmod cannot construct a POSIX permission denial.
  it.skipIf(process.platform === 'win32')(
    '⛔ …and the same probe on a home it could not READ — a doubt, never a session that is gone',
    async () => {
      // ⚠️ **`706` review**: the probe was `existsSync`, which answers `false` for EACCES too.
      const root = scratch()
      const home = join(root, 'home')
      const projects = join(home, 'projects')
      mkdirSync(projects, { recursive: true })
      chmodSync(projects, 0o000)
      locked.push(projects)
      const outcome = await new ClaudeRuntime()
        .resume(claudeRef(root), { providerHome: home })
        .catch((error: unknown) => error)
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
      // ⚑ …and it says what refused it: the kernel's answer rides as the cause.
      expect(((outcome as Error).cause as { code?: unknown }).code).toBe('EACCES')
    },
  )

  /**
   * ⚑ **The real adapter, stopped right after its probe** — a query factory that refuses, and a
   * `spawnChild` that refuses too, so nothing is ever launched. ⚠️ Its message then says what the
   * PROBE answered: *"session not found"* is the probe's no, *"stopped after the probe"* its yes.
   */
  const stoppedAfterTheProbe = (): ClaudeRuntime =>
    new ClaudeRuntime(
      () => {
        throw new Error('stopped after the probe')
      },
      undefined,
      undefined,
      undefined,
      () => {
        throw new Error('no child may start in this test')
      },
    )
  const plantTranscript = (home: string, folder: string): void => {
    mkdirSync(join(home, 'projects', folder), { recursive: true })
    // ⚑ **D-017 · R9** — a transcript that holds a conversation: a user record.
    writeFileSync(join(home, 'projects', folder, 'sess_706.jsonl'), '{"type":"user"}\n')
  }
  const probed = async (cwd: string, home: string): Promise<unknown> =>
    stoppedAfterTheProbe()
      .resume(
        { provider: 'claude', sessionId: 'sess_706', cwd, rotation: 0 },
        { providerHome: home },
      )
      .catch((error: unknown) => error)

  /**
   * 🔴 **The `706` review, rounds two and three**: the working folder names a folder Claude may never
   * have written — a symlink, a folder moved and linked back, a name past the SDK's 200-character
   * cut — while Claude's own resume, missing there, looks in EVERY project folder for the id. ⚑ So
   * a transcript of the id in any of them is a conversation Claude still has.
   */
  const WHERE_IT_WAS_WRITTEN = [
    {
      name: 'a symlinked working folder, written under its REAL path',
      shape: (root: string) => {
        const real = join(root, 'real')
        mkdirSync(real)
        const link = join(root, 'link')
        symlinkSync(real, link)
        return { cwd: link, folder: claudeProjectDirName(realpathSync(real)) }
      },
    },
    {
      name: 'a working folder MOVED and linked back from where it was',
      shape: (root: string) => {
        const old = join(root, 'old')
        mkdirSync(old)
        const folder = claudeProjectDirName(realpathSync(old))
        const moved = join(root, 'moved')
        renameSync(old, moved)
        symlinkSync(moved, old)
        return { cwd: old, folder: `${folder}-before-the-move` }
      },
    },
    {
      name: 'a working folder whose name is past the SDK’s 200-character cut',
      shape: (root: string) => {
        const long = join(root, 'a'.repeat(120), 'b'.repeat(90))
        mkdirSync(long, { recursive: true })
        const whole = claudeProjectDirName(realpathSync(long))
        return { cwd: long, folder: `${whole.slice(0, 200)}-1x2y3z` }
      },
    },
  ] as const

  it.each(WHERE_IT_WAS_WRITTEN)(
    '🔴 Claude’s OWN probe finds the transcript in ANOTHER project folder — $name',
    async ({ shape }) => {
      const root = realpathSync(scratch())
      const { cwd, folder } = shape(root)
      const home = join(root, 'home')
      plantTranscript(home, folder)
      // ⚑ The premise: the folder the cwd names is not the one it was written in.
      expect(folder).not.toBe(claudeProjectDirName(cwd))
      const outcome = await probed(cwd, home)
      expect((outcome as Error).message).toBe('resume setup failed: stopped after the probe')
      expect(markedGone(outcome)).toBe(false)
    },
  )

  it('⚑ …and the control: NO project folder holds it — it is gone', async () => {
    const root = realpathSync(scratch())
    const home = join(root, 'home')
    // ⚑ Folders that hold OTHER conversations, and none this one.
    mkdirSync(join(home, 'projects', 'one'), { recursive: true })
    writeFileSync(join(home, 'projects', 'one', 'sess_other.jsonl'), '{}\n')
    mkdirSync(join(home, 'projects', claudeProjectDirName(root)), { recursive: true })
    const outcome = await probed(root, home)
    expect((outcome as Error).message).toBe('session not found: sess_706')
    expect(markedGone(outcome)).toBe(true)
  })

  it('⛔ …an unreadable folder — the one the working folder names, asked FIRST — does not hide it elsewhere', async () => {
    const root = realpathSync(scratch())
    const home = join(root, 'home')
    const unreadable = join(home, 'projects', claudeProjectDirName(root))
    mkdirSync(unreadable, { recursive: true })
    chmodSync(unreadable, 0o000)
    locked.push(unreadable)
    plantTranscript(home, 'where-it-was-written')
    const outcome = await probed(root, home)
    expect((outcome as Error).message).toBe('resume setup failed: stopped after the probe')
    expect(markedGone(outcome)).toBe(false)
  })

  it('⚑ …and a working folder past the length a name can have, with NO folder holding it, is gone', async () => {
    // ⚠️ `ENAMETOOLONG` is the kernel's absence: a name too long to exist holds no file.
    const root = realpathSync(scratch())
    const long = join(root, 'a'.repeat(150), 'b'.repeat(150))
    mkdirSync(long, { recursive: true })
    expect(claudeProjectDirName(long).length).toBeGreaterThan(255)
    const home = join(root, 'home')
    mkdirSync(join(home, 'projects', 'another-conversation'), { recursive: true })
    const outcome = await probed(long, home)
    expect((outcome as Error).message).toBe('session not found: sess_706')
    expect(markedGone(outcome)).toBe(true)
  })

  // Windows chmod cannot construct a POSIX permission denial.
  it.skipIf(process.platform === 'win32')(
    '⛔ …and a `projects/` that can be entered but not LISTED is a doubt — the transcript may be in a folder it cannot see',
    async () => {
      // ⚠️ **`706` review, round four**: search without read — the first lookup meets an absence, and
      // only the listing is refused.
      const root = realpathSync(scratch())
      const home = join(root, 'home')
      plantTranscript(home, 'elsewhere')
      const projects = join(home, 'projects')
      chmodSync(projects, 0o311)
      locked.push(projects)
      const outcome = await probed(root, home)
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
      expect(((outcome as Error).cause as { code?: unknown }).code).toBe('EACCES')
    },
  )

  // Windows chmod cannot construct a POSIX permission denial.
  it.skipIf(process.platform === 'win32')(
    '⛔ …and an unreadable folder with NONE holding it is a doubt, never a session that is gone',
    async () => {
      const root = realpathSync(scratch())
      const home = join(root, 'home')
      const unreadable = join(home, 'projects', 'could-be-it')
      mkdirSync(unreadable, { recursive: true })
      chmodSync(unreadable, 0o000)
      locked.push(unreadable)
      const outcome = await probed(root, home)
      expect(outcome).toBeInstanceOf(ResumeError)
      expect(markedGone(outcome)).toBe(false)
      expect(((outcome as Error).cause as { code?: unknown }).code).toBe('EACCES')
    },
  )

  it('⛔ …and a probe that could not ASK is a failure of the attempt', async () => {
    const root = scratch()
    const outcome = await new ClaudeRuntime(undefined, async () => {
      throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' })
    })
      .resume(claudeRef(root), { providerHome: join(root, 'home') })
      .catch((error: unknown) => error)
    expect(outcome).toBeInstanceOf(ResumeError)
    expect(markedGone(outcome)).toBe(false)
  })

  it('🔴 the double: a ref it never issued, and one issued under another home, are sessions it does not have', async () => {
    const sessions = new FakeProviderSessions()
    const runtime = new FakeRuntime('codex', { sessions })
    const never = await runtime
      .resume(
        { provider: 'codex', sessionId: 'fake_never', cwd: '/tmp/x', rotation: 0 },
        { providerHome: '/h' },
      )
      .catch((error: unknown) => error)
    expect(markedGone(never)).toBe(true)
    const started = await runtime.start({ cwd: '/tmp/x', providerHome: '/h' })
    const ref = started.ref
    if (ref === null) throw new Error('the double issued no ref')
    await started.close()
    const elsewhere = await runtime
      .resume(ref, { providerHome: '/somewhere-else' })
      .catch((error: unknown) => error)
    expect(markedGone(elsewhere)).toBe(true)
  })

  it('⛔ …and a launch it refused before asking — a cancel already requested — is not', async () => {
    const sessions = new FakeProviderSessions()
    const runtime = new FakeRuntime('codex', { sessions })
    const started = await runtime.start({ cwd: '/tmp/x', providerHome: '/h' })
    const ref = started.ref
    if (ref === null) throw new Error('the double issued no ref')
    await started.close()
    const cancel = new AbortController()
    cancel.abort()
    const outcome = await runtime
      .resume(ref, { providerHome: '/h', signal: cancel.signal })
      .catch((error: unknown) => error)
    expect(outcome).toBeInstanceOf(ResumeError)
    expect(markedGone(outcome)).toBe(false)
  })

  it('⚑ the field is a boolean on every `ResumeError`, never absent — `false` is an answer', async () => {
    // ⚠️ **A `ResumeError` built WITHOUT the option** (the `706` review) — the Codex arms always pass
    // one, so only this asks the constructor's own default.
    const bare = new ResumeError(
      { provider: 'codex', sessionId: A_CODEX_THREAD, cwd: '/tmp/x', rotation: 0 },
      'x',
    )
    expect(bare.noSuchSession).toBe(false)
    const withACause = new ResumeError(bare.ref, 'y', { cause: new Error('z') })
    expect(withACause.noSuchSession).toBe(false)
    expect(withACause.cause).toBeInstanceOf(Error)
    const outcome = await codexResume('died')
    expect(typeof (outcome as { noSuchSession?: unknown }).noSuchSession).toBe('boolean')
  })
})
