import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent, type SessionHandle } from '../src/index'
import { CodexRuntime } from '../src/codex'
import { completedTurn, turnCompletedNotification } from './fixtures/codex-protocol'
import {
  EVERY_THREAD_OVERLAY,
  FakeTransport,
  adopt,
  collect,
  firstOfType,
  has,
  okThread,
  startCodexOn,
} from './helpers/fake-codex-transport'

describe('auto-approve mode — Codex (078)', () => {
  async function startWith(approvalMode?: 'ask' | 'auto') {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () =>
      approvalMode === 'auto'
        ? ({
            ...okThread('th_1'),
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            sandbox: { type: 'dangerFullAccess' },
          } as Record<string, unknown>)
        : okThread('th_1'),
    )
    const runtime = new CodexRuntime(adopt(transport))
    const handle = await runtime.start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      ...(approvalMode ? { approvalMode } : {}),
    })
    return { transport, handle }
  }

  const startParams = (transport: FakeTransport) =>
    transport.requests.find((r) => r.method === 'thread/start')?.params as Record<string, unknown>

  it('ASK is unchanged — the prompting profile, by default and when asked for', async () => {
    // ⚑ 736 · R96 — the prompting profile's sandbox is the Codex CLI's default preset now
    // (`workspace-write`; `read-only` until then). Unchanged by 078 is the subject.
    for (const mode of [undefined, 'ask' as const]) {
      const { transport, handle } = await startWith(mode)
      expect(startParams(transport)).toMatchObject({
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
      })
      await handle.close()
    }
  })

  it('AUTO starts the thread with never + danger-full-access, and the validator ACCEPTS it', async () => {
    // The generated enums (`AskForApproval` has 'never'; `SandboxMode` has 'danger-full-access')
    // were read from the vendored protocol, not guessed.
    const { transport, handle } = await startWith('auto')
    expect(startParams(transport)).toMatchObject({
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: 'danger-full-access',
    })
    // Reaching a live handle at all means validateApprovalProfile accepted the echoed yolo profile.
    expect(handle.ref?.sessionId).toBe('th_1')
    await handle.close()
  })

  /**
   * 🔴 **160 · the CLI-equivalence assertions, and why they are HERE rather than only in a doc.**
   *
   * ⛔ 157 moved both modes onto named `[permissions.<id>]` profiles so that `auto` kept the whole
   * machine minus the credential roots. It worked. It was still the wrong call: the reason given was
   * that BroBot is unlike the CLI, and a CLI agent can already read `~/.codex/auth.json`. **A revert
   * that only deleted 157's tests would leave nothing standing against re-adding the profile.**
   *
   * ⚑ **What each of these pins was MEASURED on the pinned 0.146.0 binary by 160**, against a
   * disposable `CODEX_HOME`, using `command/exec` (a standalone request — no thread, no turn, no
   * tokens), same command under each policy:
   *
   * | operation | `sandboxPolicy: dangerFullAccess` | `permissionProfile: brobot-auto` |
   * |---|---|---|
   * | read a credential file in a denied root | exit 0 | ⛔ *"Operation not permitted"* |
   * | `ps -o pid= -p 1` | exit 0 | ⛔ *"sandbox-exec: execvp() of 'ps' failed"* |
   * | `top -l 1 -n 0` | exit 0 | ⛔ refused |
   *
   * ⚠️ **The loss came from having ANY Seatbelt profile, not from the deny entries** — `ps`, `top`,
   * `sudo` and the rest are setuid binaries, and nothing in `[permissions.<id>.filesystem]` grants
   * them back because they are not filesystem rules. An empty deny set would not have bought them
   * back. `danger-full-access` applies no policy at all, which is the whole of why it is here.
   */
  describe('and it behaves like the CLI, which is what `danger-full-access` buys (160)', () => {
    it('⚑ AUTO carries NO permissions profile — the field 157 added is gone from every request', async () => {
      // ⛔ The paired negative for the `sandbox: 'danger-full-access'` positive above. 155 measured
      // that `permissions` and `sandbox` are MUTUALLY EXCLUSIVE (-32600, *"`permissions` cannot be
      // combined with `sandbox`"*), so a request carrying both would not merely be redundant — it
      // would fail every launch. This is what makes the revert a clean swap rather than a merge.
      const { transport, handle } = await startWith('auto')
      await handle.send('go')
      const carrying = transport.requests.filter(
        (r) => (r.params as Record<string, unknown>)?.['permissions'] !== undefined,
      )
      expect(carrying.map((r) => r.method)).toEqual([])
      // …and the positive beside it, so this cannot pass by no requests being made at all.
      expect(transport.requests.map((r) => r.method)).toEqual(
        expect.arrayContaining(['thread/start', 'turn/start']),
      )
      await handle.close()
    })

    it('⚑ …and neither does ASK, whose behaviour did not move through either change', async () => {
      // 001 non-negotiable 1. 157 could not give `ask` the deny set anyway — a single `deny` entry
      // disables approval escalation, so an accepted card did nothing — which is why `ask` shipped
      // with an empty deny set and is byte-for-byte unchanged now that the profile is gone.
      const { transport, handle } = await startWith('ask')
      await handle.send('go')
      expect(
        transport.requests.filter(
          (r) => (r.params as Record<string, unknown>)?.['permissions'] !== undefined,
        ),
      ).toEqual([])
      // ⚑ 736 · R96 moved `ask`'s sandbox to the CLI's default preset — still a sandbox MODE, never
      // a permissions profile, which is what this pins.
      expect(startParams(transport)).toMatchObject({
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandbox: 'workspace-write',
      })
      await handle.close()
    })

    it('⛔ Codex is handed no path policy and no permissions profile — its sandbox mode is the whole of it', async () => {
      // ⚑ **This is the assertion that says what `auto` means now.** `danger-full-access` applies no
      // Seatbelt policy, so a Codex session in `auto` can read `~/.codex/auth.json` and run `ps` —
      // measured above, and exactly what the same agent does in a terminal. There is no per-call
      // hook on this adapter to narrow it and, since 160, no profile either. (Until `726` the app's
      // `protectedRoots` could be handed to `start` and reached no request; R92 removed the field.)
      const { transport, handle } = await startWith('auto')
      await handle.send('go')
      const wire = JSON.stringify(transport.requests)
      expect(wire).not.toContain('permissions')
      // …and the positive: the requests really were made and really do carry the yolo sandbox, so
      // the absence above is an absence from something rather than from nothing.
      expect(wire).toContain('danger-full-access')
      await handle.close()
    })
  })

  /**
   * 🔴 **160 §2 · the trap in the revert: 157 WROTE a `[permissions.*]` block into every home.**
   *
   * ⚑ **Measured on the pinned 0.146.0 binary rather than reasoned about** — a disposable
   * `CODEX_HOME` carrying 157's exact file, launched the way 160 launches: `thread/start` with
   * `read-only` and with `danger-full-access` both succeed, a cold-process `thread/resume` on a real
   * rollout succeeds, `activePermissionProfile` comes back **null** in every case, and stderr and
   * `configWarning` are empty. **A stale block does nothing to a launch.** 157 §11.3 had warned the
   * failure mode might be *every Codex session refuses to open*; it is not.
   *
   * ⚠️ **Inert is not ignored, which is why the file is removed rather than left.** Naming the block
   * explicitly on a `command/exec` in the same process proved it live — a denied read came back
   * *"Operation not permitted"*, `ps` came back *"sandbox-exec: execvp() failed"*. What sat in those
   * homes was a working, credential-denying policy that nothing selects, under a header claiming it
   * is rewritten every launch. See `codex-stale-permission-config.test.ts` for the removal's own
   * fail-safe, and `stale-permission-config.ts` for the whole measurement.
   */
  describe('a home carrying 157’s stale `[permissions.*]` block (160 §2)', () => {
    let home: string

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), 'brobot2-stale-launch-'))
    })

    afterEach(() => {
      rmSync(home, { recursive: true, force: true })
    })

    const STALE = '# Generated by BroBot2 — rewritten on every session launch. Do not edit.\n'

    for (const mode of ['ask', 'auto'] as const) {
      it(`⛔ STILL LAUNCHES — in ${mode}`, async () => {
        // Acceptance 5. The adapter must not turn a harmless file into a failed launch of its own
        // accord, and the binary does not either.
        writeFileSync(join(home, 'config.toml'), STALE)
        const transport = new FakeTransport()
        transport.onRequest('thread/start', () =>
          mode === 'auto'
            ? ({
                ...okThread('th_1'),
                approvalPolicy: 'never',
                approvalsReviewer: 'user',
                sandbox: { type: 'dangerFullAccess' },
              } as Record<string, unknown>)
            : okThread('th_1'),
        )
        const handle = await new CodexRuntime(adopt(transport)).start({
          cwd: '/tmp/x',
          providerHome: home,
          approvalMode: mode,
        })
        expect(handle.ref?.sessionId).toBe('th_1')
        await handle.close()
      })
    }

    it('⚑ …and the block is gone BEFORE the spawn, not after it', async () => {
      // ⚠️ **The ordering is the same one 157's WRITE needed, in reverse.** The app-server loads its
      // config once at startup, so a removal that ran after `transportFactory` would leave the block
      // live for the whole session — a migration that reports success and changes nothing.
      //
      // ⛔ **Corrected in place at 314, and the correction is the point.** This used to assert the
      // FILE was absent at the spawn. There is a `config.toml` at that moment again now, because
      // 314 writes the memory gates into every home on every launch — so the question the assertion
      // has to ask is whether 157's BLOCK is gone, which is what it was ever about. Both migrations
      // are above the spawn, and the second one is asserted here rather than left to be discovered.
      const config = join(home, 'config.toml')
      writeFileSync(config, STALE)
      let atSpawn: string | null = null
      const transport = new FakeTransport()
      transport.codexHome = home
      transport.onRequest('thread/start', () => okThread('th_1'))
      const handle = await new CodexRuntime(() => {
        atSpawn = existsSync(config) ? readFileSync(config, 'utf8') : null
        return transport
      }).start({ cwd: '/tmp/x', providerHome: home })
      expect(atSpawn, "157's block must already be gone when the transport is built").not.toContain(
        '# Generated by BroBot2',
      )
      expect(atSpawn, '…and 314’s gates must already be in it').toContain('memories = true')
      await handle.close()
    })

    it('⛔ …and even when its TOML no longer PARSES — 168 M4', async () => {
      const config = join(home, 'config.toml')
      writeFileSync(config, `${STALE}[permissions.deny\nthis = "is not toml\n`)
      const transport = new FakeTransport()
      const handle = await startCodexOn(transport, okThread('th_1'), { providerHome: home })
      expect(handle.ref?.sessionId).toBe('th_1')
      const after = readFileSync(config, 'utf8')
      expect(after, 'the unparseable block is gone, not merely stepped over').not.toContain(
        'permissions.deny',
      )
      expect(after).not.toContain('# Generated by BroBot2')
      expect(after).toContain('dedicated_tools = true')
      await handle.close()
    })

    it('leaves an unparseable configuration for Codex without deleting it', async () => {
      const config = join(home, 'config.toml')
      writeFileSync(config, '[permissions.deny\nthis = "is not toml\n')
      const transport = new FakeTransport()
      const handle = await startCodexOn(transport, okThread('th_1'), { providerHome: home })
      expect(readFileSync(config, 'utf8')).toBe('[permissions.deny\nthis = "is not toml\n')
      await handle.close()
    })

    it('⚑ a RESUME clears it too — the path a 157-era home is most likely to arrive by', async () => {
      // Resume reaches existing profiles’ homes. Remove the disabling block and add the gates
      // on that path as well as fresh launch.
      const config = join(home, 'config.toml')
      writeFileSync(config, STALE)
      const transport = new FakeTransport()
      transport.onRequest('thread/resume', () => okThread('th_1'))
      const handle = await new CodexRuntime(adopt(transport)).resume(
        { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
        { providerHome: home },
      )
      const after = readFileSync(config, 'utf8')
      expect(after).not.toContain('# Generated by BroBot2')
      expect(after).toContain('memories = true')
      await handle.close()
    })

    it('🔒 …but a config this app did NOT generate is MERGED into, never deleted or replaced', async () => {
      // The fail-safe, asserted where it matters: at launch, on a real home, not only in the unit.
      //
      // ⛔ **The title and the assertion were both corrected at 314, and the honest word is
      // "merged".** This used to say *survives the launch untouched* and compared the whole file
      // byte-for-byte — true while the app wrote nothing, and false the moment it writes the memory
      // gates. What the fail-safe actually promises has not changed: the removal deletes only a file
      // carrying our own generated header, and everything a person or Codex put in this file is
      // still here afterwards. That is what is asserted now, key by key, which is also what 312
      // measured the whole-file rewrite destroying.
      const config = join(home, 'config.toml')
      const theirs =
        'model = "gpt-5"\n\n[projects."/Users/someone/dev/thing"]\ntrust_level = "trusted"\n'
      writeFileSync(config, theirs)
      const transport = new FakeTransport()
      const handle = await startCodexOn(transport, okThread('th_1'), { providerHome: home })
      const after = readFileSync(config, 'utf8')
      expect(after).toContain('model = "gpt-5"')
      expect(after).toContain('[projects."/Users/someone/dev/thing"]\ntrust_level = "trusted"')
      expect(after).toContain('memories = true')
      await handle.close()
    })
  })

  it('ASK still REJECTS a `never` profile — 007 P1-6 is intact', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      sandbox: { type: 'dangerFullAccess' },
    }))
    await expect(
      new CodexRuntime(adopt(transport)).start({ cwd: '/tmp/x', providerHome: '/tmp/x/home' }),
    ).rejects.toThrow(/approval profile/i)
  })

  it('AUTO rejects a PARTIAL downgrade — approvals off but the sandbox still on', async () => {
    // Fail-closed per mode: "close enough" is exactly how an unnoticed half-applied profile slips
    // through, so `auto` is validated as strictly as `ask`, just against the other profile.
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      // ⚑ 736 · R96 — the `ask` sandbox left on is `workspaceWrite` now (was `readOnly`).
      sandbox: { type: 'workspaceWrite' },
    }))
    await expect(
      new CodexRuntime(adopt(transport)).start({
        cwd: '/tmp/x',
        providerHome: '/tmp/x/home',
        approvalMode: 'auto',
      }),
    ).rejects.toThrow(/approval profile/i)
  })

  it('a RESUMED session re-applies its mode on thread/resume', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({
      ...okThread('th_1'),
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandbox: { type: 'dangerFullAccess' },
    }))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', approvalMode: 'auto' },
    )
    const resumeParams = transport.requests.find((r) => r.method === 'thread/resume')?.params
    expect(resumeParams).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
    })
    await handle.close()
  })
})

describe('switching the approval mode mid-conversation — Codex (034)', () => {
  const turnParams = (transport: FakeTransport) =>
    transport.requests
      .filter((r) => r.method === 'turn/start')
      .map((r) => r.params as Record<string, unknown>)

  /**
   * ⚑ **736 · R96 — the `ask` sandbox as the fixture's handshake echoes it** (`workspaceWrite`, what
   * bundled 0.146.0 echoes for `sandbox: 'workspace-write'`); until `736` `{type:'readOnly',
   * networkAccess:false}`. ⚠️ Also, field for field, the adapter's fallback when nothing was echoed.
   */
  const WORKSPACE_WRITE_ECHOED = {
    type: 'workspaceWrite',
    writableRoots: [],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }

  async function inTurn(approvalMode?: 'ask' | 'auto') {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () =>
      approvalMode === 'auto'
        ? ({
            ...okThread('th_1'),
            approvalPolicy: 'never',
            approvalsReviewer: 'user',
            sandbox: { type: 'dangerFullAccess' },
          } as Record<string, unknown>)
        : okThread('th_1'),
    )
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      ...(approvalMode ? { approvalMode } : {}),
    })
    return { transport, handle }
  }

  it('EVERY turn re-pins the whole profile, not just the reviewer', async () => {
    // Nothing re-asserted the policy or the sandbox after the handshake, so a mid-session override
    // could move either and only `thread/settings/updated` would notice. It is also the mechanism
    // the switch below rides on, which is why it has to be unconditional.
    const { transport, handle } = await inTurn()
    await handle.send('one')
    expect(turnParams(transport)[0]).toMatchObject({
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      // `workspaceWrite` carries four fields the `thread/start` string form has no room for (⚑ 736 ·
      // R96; `readOnly`'s one network flag until then). These are what the app-server echoes for a
      // thread started `workspace-write`, so re-sending them every turn has to be a no-op — a re-pin
      // that quietly changed the sandbox would be worse than none.
      sandboxPolicy: WORKSPACE_WRITE_ECHOED,
    })
    await handle.close()
  })

  it('a requested change does NOT touch the turn already running', async () => {
    // The wire fact this whole design is built on (034 probe, live app-server): a mid-turn
    // `thread/settings/update` is ACCEPTED and echoed back, and the very next command in that same
    // turn prompts anyway. So the only honest thing to do is not to move until the next turn.
    const { transport, handle } = await inTurn()
    await handle.send('one')
    await handle.setApprovalMode('auto')

    expect(handle.approval).toEqual({ effective: 'ask', requested: 'auto' })
    // Not one extra frame on the wire: nothing can be said to the provider that would matter yet.
    expect(transport.requests.filter((r) => r.method === 'thread/settings/update')).toHaveLength(0)
    // And the card the user may be looking at RIGHT NOW still discloses the mode it was raised
    // under — the mode that is actually governing it.
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    transport.serverRequest(1, 'item/commandExecution/requestApproval', { command: 'ls' })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect(firstOfType(events, 'permission_request').scope.approvalMode).toBe('ask')
    await handle.close()
    await consumer
  })

  it('the NEXT turn carries it, and it is effective from the moment it is sent', async () => {
    const { transport, handle } = await inTurn()
    await handle.send('one')
    await handle.setApprovalMode('auto')
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))

    await handle.send('two')
    expect(turnParams(transport)[1]).toMatchObject({
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
      sandboxPolicy: { type: 'dangerFullAccess' },
    })
    // Adopted in the same step that sends it: what the provider was told and what we claim can
    // never be read apart from one another.
    expect(handle.approval).toEqual({ effective: 'auto', requested: 'auto' })
    await handle.close()
  })

  it('switches back, and the reverse direction is not special', async () => {
    const { transport, handle } = await inTurn('auto')
    await handle.setApprovalMode('ask')
    expect(handle.approval).toEqual({ effective: 'auto', requested: 'ask' })
    await handle.send('one')
    expect(turnParams(transport)[0]).toMatchObject({
      approvalPolicy: 'on-request',
      // ⚑ 736 · a thread started in `auto` echoed no `ask` sandbox, so this is the fallback —
      // `workspaceWrite` with nothing extra (`readOnly`, no network, until `736`).
      sandboxPolicy: WORKSPACE_WRITE_ECHOED,
    })
    expect(handle.approval.effective).toBe('ask')
    await handle.close()
  })

  it('only the exact string turns approvals off', async () => {
    // The same fail-safe rule as at creation (078), re-applied because this is a second door to
    // the same room: anything that is not literally `auto` lands on the prompting profile.
    const { handle } = await inTurn()
    await handle.setApprovalMode('AUTO' as 'auto')
    expect(handle.approval.requested).toBe('ask')
    await handle.close()
  })

  it('the mid-session settings guard follows the NEW mode once it is adopted', async () => {
    // `thread/settings/updated` fails the session closed when the effective profile disagrees with
    // the mode (007 P1-6). Codex sends one in response to a turn-start override — measured — so if
    // the guard were still checking the old mode, using the switch would kill the session.
    const { transport, handle } = await inTurn()
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.setApprovalMode('auto')
    await handle.send('one')
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    })
    await new Promise((r) => setTimeout(r, 10))
    expect(events.filter((e) => e.type === 'error')).toHaveLength(0)
    expect(handle.status()).not.toBe('errored')
    await handle.close()
    await consumer
  })

  it('still fails closed when the provider moves to a profile NOBODY asked for', async () => {
    // The guard has not been loosened — only re-pointed. A settings change to the yolo profile on a
    // session whose requested mode is still `ask` is the confused-deputy case it exists for.
    const { transport, handle } = await inTurn()
    const events: RuntimeEvent[] = []
    const consumer = collect(handle, events)
    await handle.send('one')
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    })
    await vi.waitFor(has(events, (e) => e.type === 'error' && e.fatal === true))
    expect(events.some((e) => e.type === 'status' && e.state === 'errored')).toBe(true)
    await consumer
  })

  it('a turn/start that FAILS un-adopts the mode it was carrying (034 review)', async () => {
    // The mode is adopted before the request is written, which is the safe direction while a turn is
    // genuinely in flight — but it is only tolerable because the NEXT turn re-sends the profile and
    // corrects any overstatement. A turn/start that never landed has no next turn to correct it, so
    // without a rollback the session would sit there claiming AUTO while the app-server was never
    // told anything and nothing had run unprompted.
    const transport = new FakeTransport()
    const handle = await startCodexOn(transport)
    // Rejected, not thrown: the real transport returns a promise on every path — a terminal error
    // rejects, and a failed stdin write is caught and rejected — so a synchronous throw would be a
    // shape only the fake can produce.
    transport.failRequest('turn/start')
    await handle.setApprovalMode('auto')
    await handle.send('one')
    await vi.waitFor(() => expect(handle.approval.effective).toBe('ask'))
    // The user's choice did not fail — the turn did. So it is still queued for the next one.
    expect(handle.approval).toEqual({ effective: 'ask', requested: 'auto' })
    await handle.close()
  })

  it('the per-turn sandbox re-pin echoes the SERVER’s workspaceWrite policy, not our guess (034 review)', async () => {
    // The thread is opened with the bare string `sandbox: 'workspace-write'`, which has no room for
    // its writable roots, network flag or temp-dir flags — the server picks them. Re-pinning the
    // tagged policy every turn means asserting a value for each, and asserting a captured constant
    // would quietly TIGHTEN (or loosen) the sandbox on any deployment whose default differs. So we
    // re-send what it told us it was. ⚑ 736 · R96 — `workspaceWrite` (was `readOnly`), and every
    // field below differs from the fallback, so a guess cannot pass.
    const echoed = {
      type: 'workspaceWrite',
      writableRoots: ['/tmp/also'],
      networkAccess: true,
      excludeTmpdirEnvVar: true,
      excludeSlashTmp: true,
    }
    const transport = new FakeTransport()
    const handle = await startCodexOn(transport, { ...okThread('th_1'), sandbox: echoed })
    await handle.send('one')
    expect(turnParams(transport)[0]?.['sandboxPolicy']).toEqual(echoed)
    await handle.close()
  })

  it('…and it keeps following the server when the settings change (034 review)', async () => {
    // ⚑ 736 · R96 — the `workspaceWrite` echo (was `readOnly`).
    const { transport, handle } = await inTurn()
    await handle.send('one')
    expect(turnParams(transport)[0]).toMatchObject({ sandboxPolicy: WORKSPACE_WRITE_ECHOED })
    const updated = { ...WORKSPACE_WRITE_ECHOED, writableRoots: ['/tmp/also'], networkAccess: true }
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
        sandboxPolicy: updated,
      },
    })
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    await handle.send('two')
    expect(turnParams(transport)[1]?.['sandboxPolicy']).toEqual(updated)
    await handle.close()
  })

  it('a dangerFullAccess echo teaches it nothing about workspaceWrite (034 review)', async () => {
    // Only a fully-formed workspaceWrite policy is evidence about what the `ask` sandbox means here
    // (⚑ 736 · R96; readOnly until then). The yolo profile's echo is about the OTHER mode, and a
    // switch back must not carry it over.
    const { transport, handle } = await inTurn()
    await handle.setApprovalMode('auto')
    await handle.send('one')
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: {
        approvalPolicy: 'never',
        approvalsReviewer: 'user',
        sandboxPolicy: { type: 'dangerFullAccess' },
      },
    })
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
    await handle.setApprovalMode('ask')
    await handle.send('two')
    expect(turnParams(transport)[1]).toMatchObject({ sandboxPolicy: WORKSPACE_WRITE_ECHOED })
    await handle.close()
  })
})

/**
 * 🔴 **W4.189 · a give's folder is a work-folder grant on the conversation** — on Codex, extra
 * `writableRoots` of the `ask` sandbox: on every `turn/start`, and on the thread itself at
 * `thread/start` and `thread/resume`. ⛔ Nothing in `auto`. ⚑ Next-turn, like the settings 076 made.
 */
describe('W4.189 · work folders are writable roots of the ask sandbox — Codex', () => {
  const turnParams = (transport: FakeTransport) =>
    transport.requests
      .filter((r) => r.method === 'turn/start')
      .map((r) => r.params as Record<string, unknown>)
  const sandboxOf = (transport: FakeTransport, turn: number) =>
    turnParams(transport)[turn]?.['sandboxPolicy']
  const configOf = (transport: FakeTransport, method: 'thread/start' | 'thread/resume') =>
    (transport.requests.find((r) => r.method === method)?.params as { config?: unknown }).config
  /** What the fixture's handshake echoes for `ask` — no root, no network, no temp dir excluded. */
  const ECHOED = {
    type: 'workspaceWrite',
    writableRoots: [] as string[],
    networkAccess: false,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false,
  }
  const AUTO_ECHO = {
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    sandbox: { type: 'dangerFullAccess' },
  }

  async function launch(
    opts: {
      approvalMode?: 'ask' | 'auto'
      workFolders?: readonly string[]
      /** The `ask` sandbox the handshake echoes, when a test is about the echo. */
      echoed?: Record<string, unknown>
    } = {},
  ) {
    const transport = new FakeTransport()
    transport.onRequest('thread/start', () => ({
      ...okThread('th_1'),
      ...(opts.approvalMode === 'auto' ? AUTO_ECHO : {}),
      ...(opts.echoed ? { sandbox: opts.echoed } : {}),
    }))
    const handle = await new CodexRuntime(adopt(transport)).start({
      cwd: '/tmp/x',
      providerHome: '/tmp/x/home',
      ...(opts.approvalMode ? { approvalMode: opts.approvalMode } : {}),
      ...(opts.workFolders ? { workFolders: opts.workFolders } : {}),
    })
    return { transport, handle }
  }

  /** End the running turn as the server would, and wait for the session to be idle again. */
  async function endTurn(transport: FakeTransport, handle: SessionHandle): Promise<void> {
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn(transport.lastTurnId)),
    )
    await vi.waitFor(() => expect(handle.status()).toBe('idle'))
  }

  /** The server echoing the `ask` sandbox it now runs, as it does after a turn's override. */
  function echo(transport: FakeTransport, sandboxPolicy: Record<string, unknown>): void {
    transport.notification('thread/settings/updated', {
      threadId: 'th_1',
      threadSettings: { approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy },
    })
  }

  it('🔴 a launch’s work folders are writable roots of its first turn — and of the thread it opened', async () => {
    const { transport, handle } = await launch({ workFolders: ['/w/a', '/w/b'] })
    expect(configOf(transport, 'thread/start'), 'the thread’s own sandbox agrees').toEqual({
      ...EVERY_THREAD_OVERLAY,
      'sandbox_workspace_write.writable_roots': ['/w/a', '/w/b'],
    })
    expect(handle.workFolders).toEqual({ effective: ['/w/a', '/w/b'], requested: ['/w/a', '/w/b'] })
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual({ ...ECHOED, writableRoots: ['/w/a', '/w/b'] })
    await handle.close()
  })

  it('⚑ THE CONTROL — no work folder: the overlay names no roots, and the turn re-pins the echo as it was', async () => {
    const { transport, handle } = await launch()
    expect(configOf(transport, 'thread/start')).toEqual({ ...EVERY_THREAD_OVERLAY })
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual(ECHOED)
    expect(handle.workFolders).toEqual({ effective: [], requested: [] })
    await handle.close()
  })

  it('⛔ auto carries none — no overlay key, and `dangerFullAccess` alone on the turn', async () => {
    const { transport, handle } = await launch({ approvalMode: 'auto', workFolders: ['/w/a'] })
    expect(configOf(transport, 'thread/start')).toEqual({ ...EVERY_THREAD_OVERLAY })
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual({ type: 'dangerFullAccess' })
    // ⚑ Still the session's grants: a switch to `ask` carries them on its next turn.
    expect(handle.workFolders.effective).toEqual(['/w/a'])
    await handle.setApprovalMode('ask')
    await endTurn(transport, handle)
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, writableRoots: ['/w/a'] })
    await handle.close()
  })

  it('🔴 a change mid-turn rides the NEXT turn, never the one running — and nothing goes on the wire for it', async () => {
    const { transport, handle } = await launch()
    await handle.send('one')
    handle.setWorkFolders(['/w/a'])
    expect(handle.workFolders).toEqual({ effective: [], requested: ['/w/a'] })
    expect(transport.requests.filter((r) => r.method === 'thread/settings/update')).toHaveLength(0)
    await endTurn(transport, handle)
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, writableRoots: ['/w/a'] })
    expect(handle.workFolders).toEqual({ effective: ['/w/a'], requested: ['/w/a'] })
    await handle.close()
  })

  it('⛔ a turn/start that FAILS un-adopts the list it was carrying, and keeps it asked for', async () => {
    const { transport, handle } = await launch({ workFolders: ['/w/a'] })
    transport.failRequest('turn/start')
    handle.setWorkFolders(['/w/a', '/w/b'])
    await handle.send('one')
    expect(sandboxOf(transport, 0), 'it was sent').toEqual({
      ...ECHOED,
      writableRoots: ['/w/a', '/w/b'],
    })
    await vi.waitFor(() => expect(handle.workFolders.effective).toEqual(['/w/a']))
    expect(handle.workFolders.requested, 'the person’s choice did not fail — the turn did').toEqual(
      ['/w/a', '/w/b'],
    )
    await handle.close()
  })

  it('🔴 THE BASELINE TRAP — a folder taken away is gone from the next turn, though the server echoed it back', async () => {
    // ⚠️ The re-pin re-sends the server's own echo (034), and after a turn that carried work folders
    // the echo carries them too. Taken as it came, a removed folder would ride every later turn.
    const { transport, handle } = await launch()
    handle.setWorkFolders(['/w/a', '/w/b'])
    await handle.send('one')
    echo(transport, { ...ECHOED, writableRoots: ['/w/a', '/w/b'] })
    await endTurn(transport, handle)

    handle.setWorkFolders(['/w/b'])
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, writableRoots: ['/w/b'] })
    echo(transport, { ...ECHOED, writableRoots: ['/w/b'] })
    await endTurn(transport, handle)

    handle.setWorkFolders([])
    await handle.send('three')
    expect(sandboxOf(transport, 2)).toEqual(ECHOED)
    await handle.close()
  })

  it('🔴 …and a folder the LAUNCH named, which the handshake echoed, is taken away the same way', async () => {
    const { transport, handle } = await launch({
      workFolders: ['/w/a'],
      echoed: { ...ECHOED, writableRoots: ['/w/a'] },
    })
    handle.setWorkFolders([])
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual(ECHOED)
    await handle.close()
  })

  it('⚑ a root the thread had BEFORE any work folder is the thread’s own — a grant of the same path ending leaves it', async () => {
    const { transport, handle } = await launch({ echoed: { ...ECHOED, writableRoots: ['/w/own'] } })
    handle.setWorkFolders(['/w/own', '/w/a'])
    await handle.send('one')
    expect(sandboxOf(transport, 0), 'once each').toEqual({
      ...ECHOED,
      writableRoots: ['/w/own', '/w/a'],
    })
    echo(transport, { ...ECHOED, writableRoots: ['/w/own', '/w/a'] })
    await endTurn(transport, handle)
    handle.setWorkFolders([])
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, writableRoots: ['/w/own'] })
    await handle.close()
  })

  it('⚑ the server’s network and temp-dir flags ride through every change, as it reported them', async () => {
    const flags = { networkAccess: true, excludeTmpdirEnvVar: true, excludeSlashTmp: true }
    const { transport, handle } = await launch({
      workFolders: ['/w/a'],
      echoed: { ...ECHOED, ...flags, writableRoots: ['/w/a'] },
    })
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual({ ...ECHOED, ...flags, writableRoots: ['/w/a'] })
    await endTurn(transport, handle)
    handle.setWorkFolders([])
    await handle.send('two')
    expect(sandboxOf(transport, 1)).toEqual({ ...ECHOED, ...flags, writableRoots: [] })
    await handle.close()
  })

  it('🔴 a RESUME names them on the thread again — beside the effort the overlay already carries', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => okThread('th_1'))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', workFolders: ['/w/a'], reasoningEffort: 'high' },
    )
    expect(configOf(transport, 'thread/resume')).toEqual({
      ...EVERY_THREAD_OVERLAY,
      'sandbox_workspace_write.writable_roots': ['/w/a'],
      model_reasoning_effort: 'high',
    })
    expect(handle.workFolders.effective).toEqual(['/w/a'])
    await handle.send('one')
    expect(sandboxOf(transport, 0)).toEqual({ ...ECHOED, writableRoots: ['/w/a'] })
    await handle.close()
  })

  it('⛔ …and an `auto` resume does not', async () => {
    const transport = new FakeTransport()
    transport.onRequest('thread/resume', () => ({ ...okThread('th_1'), ...AUTO_ECHO }))
    const handle = await new CodexRuntime(adopt(transport)).resume(
      { provider: 'codex', sessionId: 'th_1', cwd: '/tmp/x', rotation: 0 },
      { providerHome: '/tmp/x/home', approvalMode: 'auto', workFolders: ['/w/a'] },
    )
    expect(configOf(transport, 'thread/resume')).toEqual({ ...EVERY_THREAD_OVERLAY })
    await handle.close()
  })
})
