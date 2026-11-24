import { describe, expect, it, vi } from 'vitest'
import { type RuntimeEvent } from '../src/index'
import { MAX_PERMISSION_DETAIL_CHARS } from '../src/events'
import { completedTurn, turnCompletedNotification } from './fixtures/codex-protocol'
import { has, startCodexInTurn, scopeOf, commandParams } from './helpers/fake-codex-transport'

describe('CodexRuntime — approval scope disclosure (007 P1-7)', () => {
  it('maps a command approval to the full neutral scope', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(50, 'item/commandExecution/requestApproval', commandParams)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope).toEqual({
      cwd: '/tmp/x',
      paths: ['/tmp/x/a.txt'],
      networkHosts: ['https://api.example.com', 'cdn.example.com'], // egress protocol folded in
      persistence: 'session', // acceptForSession is ON the card (697: a proposal alone never is)
      amendments: [
        { kind: 'exec', detail: 'curl *' },
        { kind: 'network', detail: 'allow cdn.example.com' },
      ],
      availableDecisions: ['allow', 'allow_for_session', 'deny', 'cancel'],
      underDisclosed: true, // additionalPermissions present → surfaced, not dropped
      approvalMode: 'ask', // the mode is part of the honest scope (078)
    })
    await handle.close()
    await consumer
  })

  /**
   * A command card warns only when something is not shown. It shows the whole command and its
   * folder; the paths and hosts Codex picks out of a command are best-effort, so a card that draws
   * them keeps the warning, as does one asking for more than the command (extra permissions,
   * network access) or carrying a field this app does not know.
   */
  describe('a command card warns only when something is not shown', () => {
    const WHOLE = {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_1',
      startedAtMs: 123,
      kind: 'command',
      approvalId: null,
      environmentId: null,
      reason: null,
      command: 'touch notes.txt',
      cwd: '/tmp/x',
      commandActions: [{ type: 'unknown', command: 'touch notes.txt' }],
      networkApprovalContext: null,
      additionalPermissions: null,
      proposedExecpolicyAmendment: ['touch', 'notes.txt'],
      proposedNetworkPolicyAmendments: null,
      availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
    }
    const flagOf = async (params: Record<string, unknown>): Promise<boolean> => {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.serverRequest(80, 'item/commandExecution/requestApproval', params)
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      const { scope } = scopeOf(events)
      await handle.close()
      await consumer
      return scope.underDisclosed
    }

    it('⚑ the whole command, in its folder, with nothing picked out of it: no warning', async () => {
      expect(await flagOf(WHOLE)).toBe(false)
      // Older servers send no `kind`, and fields left out say nothing.
      const older: Record<string, unknown> = {
        ...WHOLE,
        commandActions: [],
        additionalPermissions: {},
      }
      delete older.kind
      delete older.environmentId
      expect(await flagOf(older)).toBe(false)
    })

    it('🔴 a path Codex picked out of the command is drawn, and may not be all it touches', async () => {
      // `curl … | tee /etc/cron.d/x`: what Codex parsed names one file; the card cannot say it is all.
      const partial = {
        ...WHOLE,
        command: 'cat a.txt | tee /etc/cron.d/x',
        commandActions: [
          { type: 'read', command: 'cat a.txt', name: 'a.txt', path: '/tmp/x/a.txt' },
          { type: 'unknown', command: 'tee /etc/cron.d/x' },
        ],
      }
      expect(await flagOf(partial)).toBe(true)
      expect(
        await flagOf({
          ...WHOLE,
          commandActions: [{ type: 'listFiles', command: 'ls src', path: 'src' }],
        }),
      ).toBe(true)
    })

    it('🔴 a host, by its context or a proposed rule, is more than the command shows', async () => {
      expect(
        await flagOf({
          ...WHOLE,
          networkApprovalContext: { host: 'example.com', protocol: 'https' },
        }),
      ).toBe(true)
      expect(
        await flagOf({
          ...WHOLE,
          proposedNetworkPolicyAmendments: [{ host: 'cdn.example.com', action: 'allow' }],
        }),
      ).toBe(true)
      // A context that names no host is still a network ask.
      expect(await flagOf({ ...WHOLE, networkApprovalContext: {} })).toBe(true)
    })

    it('🔴 extra permissions, network access, or a profile the card cannot draw', async () => {
      expect(
        await flagOf({
          ...WHOLE,
          additionalPermissions: { network: null, fileSystem: { write: ['/etc'] } },
        }),
      ).toBe(true)
      expect(
        await flagOf({ ...WHOLE, additionalPermissions: { network: { enabled: true } } }),
      ).toBe(true)
      expect(await flagOf({ ...WHOLE, additionalPermissions: { unknownKey: true } })).toBe(true)
    })

    it('🔴 no command to show, another kind of approval, or a field this app does not know', async () => {
      expect(await flagOf({ ...WHOLE, command: null })).toBe(true)
      expect(await flagOf({ ...WHOLE, command: '' })).toBe(true)
      expect(await flagOf({ ...WHOLE, kind: 'writeStdin' })).toBe(true)
      expect(await flagOf({ ...WHOLE, sandboxPolicy: { mode: 'danger-full-access' } })).toBe(true)
    })

    it('🔴 an answer Codex offered that the card cannot draw', async () => {
      expect(
        await flagOf({
          ...WHOLE,
          availableDecisions: ['accept', { applyNetworkPolicyAmendment: { host: 'x' } }],
        }),
      ).toBe(true)
    })
  })

  /**
   * 🔴 **697 · `672` F1 — `persistence` is what the card's BUTTONS can grant.** ⛔ On `main` it was
   * `session` whenever the server PROPOSED an exec-policy amendment — and no answer this app sends
   * applies one — so an ordinary command card said *"for the whole conversation"* over a one-shot
   * Allow. ⚑ The server's real wire shape for the amendment answer (`CommandExecutionApprovalDecision`:
   * `{ acceptWithExecpolicyAmendment: { execpolicy_amendment } }`), and one fact moved per arm.
   * 🔴 **736 · R95 — that answer is a button now** (`allow_always`), so a card that OFFERS it is
   * `always`; a card that only PROPOSES the amendment is still `once`, which is 697's subject.
   */
  describe('697 · 672 F1 — persistence follows the offer, never the proposal', () => {
    const AMENDMENT_ANSWER = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['curl'] } }
    const ORDINARY = {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_1',
      startedAtMs: 123,
      command: 'curl https://api.example.com',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['curl'],
      availableDecisions: ['accept', AMENDMENT_ANSWER, 'cancel'],
    }
    const cardFor = async (id: number, params: Record<string, unknown>) => {
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.serverRequest(id, 'item/commandExecution/requestApproval', params)
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      const { scope } = scopeOf(events)
      await handle.close()
      await consumer
      return scope
    }

    it('🔴 736 · R95 — an ordinary command that OFFERS its amendment is `always`; one that only proposes it is `once`', async () => {
      // ⛔ On `main`: the offered amendment answer was not on the card (it mapped to nothing), so
      // this card was `['allow', 'deny', 'cancel']` and `once`.
      const scope = await cardFor(90, ORDINARY)
      expect(scope.availableDecisions).toEqual(['allow', 'allow_always', 'deny', 'cancel'])
      expect(scope.amendments).toEqual([{ kind: 'exec', detail: 'curl' }]) // still disclosed
      expect(scope.persistence).toBe('always')
      // ⚑ **697's subject, one fact over**: the SAME proposal with the amendment answer NOT offered
      // — no button can grant beyond now, so the proposal alone still moves nothing.
      const proposed = await cardFor(95, { ...ORDINARY, availableDecisions: ['accept', 'cancel'] })
      expect(proposed.availableDecisions).toEqual(['allow', 'deny', 'cancel'])
      expect(proposed.amendments).toEqual([{ kind: 'exec', detail: 'curl' }])
      expect(proposed.persistence).toBe('once')
    })

    it('🔴 736 · R95 — a card whose only accept is the amendment offers Always allow — so it HAS a positive', async () => {
      // ⛔ On `main`: `['deny', 'cancel']` and `once` — it had no Allow at all.
      const scope = await cardFor(91, {
        ...ORDINARY,
        availableDecisions: [AMENDMENT_ANSWER, 'decline'],
      })
      expect(scope.availableDecisions).toEqual(['allow_always', 'deny', 'cancel'])
      expect(scope.noPositiveBecause).toBeUndefined()
      expect(scope.persistence).toBe('always')
    })

    it('🔴 a session accept the GATE withheld is `once` — the raw list is not the offer', async () => {
      const scope = await cardFor(92, {
        ...ORDINARY,
        proposedExecpolicyAmendment: undefined,
        availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
        additionalPermissions: {
          network: { enabled: false },
          fileSystem: {
            read: null,
            write: null,
            entries: [
              {
                path: { type: 'special', value: { kind: 'unknown', path: '/???' } },
                access: 'write',
              },
            ],
          },
        },
      })
      expect(scope.noPositiveBecause).toBe('could-not-describe-the-grant')
      expect(scope.persistence).toBe('once')
    })

    it('⚑ control: the SAME card plus `acceptForSession` is `session` — the one button is the cause', async () => {
      // ⚑ 736 · re-aimed onto the proposal-only card: with the amendment answer offered as well the
      // widest button is *Always allow* (R95), so the session grant is measured where it is widest.
      const scope = await cardFor(93, {
        ...ORDINARY,
        availableDecisions: ['accept', 'acceptForSession', 'cancel'],
      })
      expect(scope.availableDecisions).toContain('allow_for_session')
      expect(scope.persistence).toBe('session')
      // ⚑ …and the amendment answer added to it makes it `always` — the widest button decides.
      const both = await cardFor(96, {
        ...ORDINARY,
        availableDecisions: ['accept', 'acceptForSession', AMENDMENT_ANSWER, 'cancel'],
      })
      expect(both.availableDecisions).toEqual([
        'allow',
        'allow_for_session',
        'allow_always',
        'deny',
        'cancel',
      ])
      expect(both.persistence).toBe('always')
    })

    it('⚑ control: no amendment, a one-shot list — `once` before and after', async () => {
      const scope = await cardFor(94, {
        ...ORDINARY,
        proposedExecpolicyAmendment: undefined,
        availableDecisions: ['accept', 'cancel'],
      })
      expect(scope.amendments).toEqual([])
      expect(scope.persistence).toBe('once')
    })
  })

  it('assumes the standard decision set when the provider enumerates none, and flags it', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const bare: Record<string, unknown> = { ...commandParams }
    delete bare.availableDecisions
    delete bare.additionalPermissions
    transport.serverRequest(54, 'item/commandExecution/requestApproval', bare)
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.availableDecisions).toEqual(['allow', 'allow_for_session', 'deny', 'cancel'])
    expect(req.scope.underDisclosed).toBe(true) // decisions assumed, not enumerated
    await handle.respondPermission('number:54', { outcome: 'allow' }) // unrestricted → accepted
    await handle.close()
    await consumer
  })

  it('flags a file approval as under-disclosed (changed files are not in the params)', async () => {
    // ⚠️ **§1b, and it is the PAIRED NEGATIVE for the four tests below** (181): an approval whose
    // item this session was never told about names nothing, because there is nothing to name. The
    // params really do carry no paths — that half of the PM's diagnosis was right — so this is the
    // case where the old stance stands, and the card says so instead of showing the word `file`.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(55, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_3',
      startedAtMs: 0,
      reason: 'apply patch',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.underDisclosed).toBe(true)
    expect(req.scope.paths, 'no item, no paths — never an invented one').toEqual([])
    // ⛔ **The invention check, on the string a person reads.** A path is the one thing this card
    // must not make up, and a fallback that quietly rendered the cwd, the grant root or the itemId
    // would satisfy every assertion above.
    //
    // ⚠️ **EQUALITY, and 182 L3 is why it is not `not.toMatch(/[/\\]/)` any more** (188 §2). A
    // separator check calls `README.md` and `secrets.env` clean — a basename is a path with no
    // slash in it, and a fallback that leaked one would have passed. There is exactly one sentence
    // this card may say, so the test says which one, and nothing can be appended to it unseen.
    expect(req.detail, 'the fixed sentence, whole — nothing appended, nothing interpolated').toBe(
      'file change — the provider did not name the files this patch touches; ' +
        'they appear in Changes once it has run',
    )
    await handle.close()
    await consumer
  })

  /** The `fileChange` item Codex announces two frames before it asks (181, measured). */
  const fileItem = (id: string, changes: unknown[]): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId: 'tn_1',
    item: { type: 'fileChange', id, changes, status: 'pending' },
  })

  it('names the files a patch will write, correlated by itemId (181 §1)', async () => {
    // ⛔ **The defect: `apply_patch · file` and nothing else**, measured live by the PM on
    // `gpt-5.6-sol`. `FileChangeRequestApprovalParams` carries no paths — but the `fileChange` item
    // under the SAME `itemId` does, and `probe:file-approval-paths` measured it arriving **two
    // frames earlier** in four approvals across two runs. So the card can name the file, and 071's
    // ruling — the card shows the whole of what Approve does — reaches file changes at last.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      fileItem('it_9', [
        { path: '/w/added.txt', kind: { type: 'add' }, diff: '@@' },
        { path: '/w/edited.txt', kind: { type: 'update', move_path: null }, diff: '@@' },
        { path: '/w/gone.txt', kind: { type: 'delete' }, diff: '@@' },
        { path: '/w/from.txt', kind: { type: 'update', move_path: '/w/to.txt' }, diff: '@@' },
      ]),
    )
    await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
    transport.serverRequest(57, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_9',
      startedAtMs: 0,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // Every file, with what happens to it — in the Changes pane's own vocabulary, and a rename says
    // where it came from rather than appearing as a file nobody has seen before.
    expect(req.detail.split('\n')).toEqual([
      'added /w/added.txt',
      'modified /w/edited.txt',
      'deleted /w/gone.txt',
      'renamed /w/to.txt (from /w/from.txt)',
    ])
    expect(req.scope.paths).toEqual(['/w/added.txt', '/w/edited.txt', '/w/gone.txt', '/w/to.txt'])
    // ⚠️ The banner that was the ONLY thing on this card is gone, on the same test Claude's file
    // cards already pass: every file is named, so "treat its scope as broader than shown" is no
    // longer the truth about it.
    expect(req.scope.underDisclosed).toBe(false)
    expect(req.action, 'the tool is still named — it is what a session grant would cover').toBe(
      'apply_patch',
    )
    await handle.close()
    await consumer
  })

  it('the provider’s reason is a label BESIDE the files, not instead of them (181)', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'item/started',
      fileItem('it_10', [{ path: '/w/one.txt', kind: { type: 'add' }, diff: '@@' }]),
    )
    await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
    transport.serverRequest(58, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_10',
      startedAtMs: 0,
      reason: 'needs write access outside the workspace',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // The reason used to BE the disclosure, which is how a card about a write ended up showing a
    // sentence and no file. `summary` is the field the event schema defines for exactly this.
    expect(req.summary).toBe('needs write access outside the workspace')
    expect(req.detail).toBe('added /w/one.txt')
    // ⚑ **709 · and NOT the agent's.** A file approval's `reason` was `null` on every file approval
    // measured (`704` §6 — a patch through `exec_command` with a justification included), so whose
    // words it would be is not established; only the command card, where it is measured to be the
    // model's, carries `agentReason`.
    expect('agentReason' in req).toBe(false)
    await handle.close()
    await consumer
  })

  /**
   * ⛔ **704 · a COMMAND approval's `reason` is the MODEL's words, where it was measured.** On the
   * bundled 0.146.0 through the product's `ask` profile, WITH a command: an `exec_command` escalated
   * with a `justification` arrives with `reason` equal to that justification, verbatim; without one,
   * the key is absent — Codex wrote no reason of its own on any path 704 drove. So it may not stand
   * in for the command, which is what Allow authorizes (181's rule for the file card, one kind over).
   * ⚠️ The EMPTY command planted below is the shape the old fallback served; 704 did not produce one
   * live, so this pins the rule, not a measurement of that shape.
   */
  it('⛔ 704 · a command’s `reason` never stands in for the command — measured as the model’s justification', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // ⚠️ **709 · WITH the offered rule** — so the empty command is the one fact this request lacks
    // of the measured escalation, and it is the command check that refuses it, not the rule's.
    transport.serverRequest(59, 'item/commandExecution/requestApproval', {
      command: '',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
      reason: 'Do you want me to clean the build folder?',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.detail).toBe('command')
    // ⚑ **709 · and not the agent's either** — an approval with NO command is not the shape measured
    // to carry the model's words (the managed-network one is Codex's to word), so its `reason` is
    // carried nowhere, as 704 left it.
    expect('agentReason' in req).toBe(false)
    expect(JSON.stringify(req)).not.toContain('clean the build folder')
    await handle.close()
    await consumer
  })

  /**
   * ⛔ **709 · R44's controls — the shapes whose `reason` was NOT measured to be the model's.** Each
   * is the measured `justified` shape plus ONE fact, and each carries no `agentReason`: a network
   * approval (Codex's protocol types call its reason *"e.g. request for network access"*), a
   * zsh-exec-bridge subcommand (`approvalId`), and a command asking for additional permissions. The
   * policy shape — the measured request, with no offered rule — is the test after this one.
   */
  it.each([
    [
      'a managed-network approval',
      { networkApprovalContext: { host: 'api.example.com', protocol: 'https' } },
    ],
    ['a subcommand approval', { approvalId: '0d7f0f8e-5b3a-4c1e-9d0a-2f3b4c5d6e7f' }],
    [
      'a command asking for additional permissions',
      { additionalPermissions: { network: { enabled: true }, fileSystem: null } },
    ],
  ])('⛔ 709 · %s carries its reason as nobody’s', async (_shape, extra) => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(65, 'item/commandExecution/requestApproval', {
      command: 'curl https://api.example.com',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['curl', 'https://api.example.com'],
      reason: 'WORDS OF UNMEASURED AUTHORSHIP',
      ...extra,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect('agentReason' in req).toBe(false)
    expect(JSON.stringify(req)).not.toContain('WORDS OF UNMEASURED AUTHORSHIP')
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **720 · R73 — a command an exec-policy `prompt` rule stopped carries CODEX's words as the
   * PROVIDER's, labelled as its rule — and never as the agent's.** ⚑ The ruling (`709` F-5): *"A
   * policy's own words are the provider's. Codex's '… requires approval: <rule text>' is carried as
   * the provider's words (`providerReason`), labelled as Codex's rule. `700`'s 'marked asks only'
   * contract widens to this one named case, and no further."*
   *
   * ⛔ **`709`'s pin MOVED ON PURPOSE.** It asserted the words appeared NOWHERE on the card (`709`
   * fenced them off from `agentReason`, rightly, and left them carried by nobody — F-5). ⚑ Measured
   * (`probe:codex-approval-reason`, the `policy` arm, bundled 0.146.0): the request has the `command`
   * and none of the fields below, NO offered prefix rule, and Codex writes the `reason` itself, over
   * the model's escalation — *"`<command>` requires approval: <the rule's text>"*. The reason below
   * is that measured shape, verbatim but for the path. `709` M44 still guards the agent's half.
   */
  it('🔴 720 · R73 — a command a POLICY rule stopped carries Codex’s words as the PROVIDER’s, labelled as its rule', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    const said =
      "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval: POLICY-JUSTIFICATION"
    transport.serverRequest(66, 'item/commandExecution/requestApproval', {
      command: "/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'",
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'cancel'],
      reason: said,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    // ⚑ The whole of Codex's sentence, cleaned and never reworded, under the provider's name…
    expect(req.providerReason).toBe(said)
    // ⚑ …labelled as a policy's rule, so a surface can say whose rule it was.
    expect(req.providerReasonFrom).toBe('a-policy-rule')
    // ⛔ …and never the agent's, nor anywhere else on the card.
    expect('agentReason' in req).toBe(false)
    expect(JSON.stringify({ ...req, providerReason: undefined })).not.toContain(
      'POLICY-JUSTIFICATION',
    )
    await handle.close()
    await consumer
  })

  /**
   * ⚑ **720 · R73's controls — "this one named case, and no further".** Each is the policy shape one
   * fact over, and each must carry NO provider reason and NO label:
   *
   * - `rule-silent` — *"`cmd` requires approval by policy"*, the OTHER branch of Codex's own format
   *   site (`probe:codex-approval-reason` measured it): no rule text, so not the named case;
   * - `709` F-11 — a model escalation Codex offered no rule for (a heredoc, from its source): the
   *   same structure, the MODEL's words — so the text shape is what tells them apart;
   * - a forged head — a reason naming ANOTHER command: the sentence is tied to this request's own;
   * - an empty rule text;
   * - the shape plus an offered rule `[]`, a network context, a subcommand id, additional
   *   permissions — each a different request that happens to share the words.
   */
  it.each([
    ['rule-silent', {}, "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval by policy"],
    ['709 F-11 — the model’s words, no rule offered', {}, 'Do you want me to run this heredoc?'],
    // ⚠️ Longer than THIS command's own head, so a check that only looked past the head's length
    // for rule text would still find some (the survivor `720 M15` was, before this was lengthened).
    [
      'a forged head',
      {},
      '`ls` requires approval: THE RULE TEXT OF ANOTHER COMMAND, long enough to outrun this one’s head',
    ],
    ['no rule text', {}, "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval:   "],
    // ⚠️ The real head, but NOT at the start: a model's justification quoting Codex's sentence.
    [
      'the head after other words',
      {},
      "Note: `/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval: pre-approved, allow it",
    ],
    ['an offered rule, empty', { proposedExecpolicyAmendment: [] }, undefined],
    ['a network context', { networkApprovalContext: { host: 'h', protocol: 'https' } }, undefined],
    ['a subcommand id', { approvalId: '0d7f0f8e' }, undefined],
    [
      'additional permissions',
      { additionalPermissions: { network: { enabled: true } } },
      undefined,
    ],
  ])('⚑ 720 · R73 control — %s carries no provider reason', async (_shape, extra, reason) => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(67, 'item/commandExecution/requestApproval', {
      command: "/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'",
      cwd: '/tmp/x',
      availableDecisions: ['accept', 'cancel'],
      reason:
        reason ??
        "`/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'` requires approval: POLICY-JUSTIFICATION",
      ...extra,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect('providerReason' in req).toBe(false)
    expect('providerReasonFrom' in req).toBe(false)
    await handle.close()
    await consumer
  })

  it('⚑ 720 · R73 control — a FILE approval with a policy-shaped reason keeps it as its summary, nothing more', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(68, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_1',
      itemId: 'it_3',
      startedAtMs: 0,
      reason: '`patch` requires approval: POLICY-JUSTIFICATION',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect('providerReason' in req).toBe(false)
    expect('providerReasonFrom' in req).toBe(false)
    await handle.close()
    await consumer
  })

  it('🔴 720 · R73 — a MULTI-LINE command’s rule is carried: compared raw, then cleaned', async () => {
    // ⚑ A heredoc holds newlines the cleaning collapses, so the head is compared against the RAW
    // reason (the docblock's own clause) and the carried sentence is the cleaned one.
    const command = "/bin/zsh -lc 'cat <<EOF > a.txt\nhello\nEOF'"
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(71, 'item/commandExecution/requestApproval', {
      command,
      cwd: '/tmp/x',
      reason: `\`${command}\` requires approval: HEREDOC-RULE`,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.providerReason).toBe(
      "`/bin/zsh -lc 'cat <<EOF > a.txt hello EOF'` requires approval: HEREDOC-RULE",
    )
    expect(req.providerReasonFrom).toBe('a-policy-rule')
    await handle.close()
    await consumer
  })

  it('⚑ 720 · R73 — the policy’s words are CLEANED like every card’s words, and dropped past the ceiling', async () => {
    const escape = String.fromCharCode(27)
    const command = "/bin/zsh -lc '/usr/bin/touch /tmp/x/a.txt'"
    const cleaned = await startCodexInTurn()
    cleaned.transport.serverRequest(69, 'item/commandExecution/requestApproval', {
      command,
      cwd: '/tmp/x',
      reason: `\`${command}\` requires approval: ${escape}[31mRED RULE${escape}[0m`,
    })
    await vi.waitFor(has(cleaned.events, (e) => e.type === 'permission_request'))
    const said = scopeOf(cleaned.events).providerReason
    expect(said).toContain('RED RULE')
    expect(said).not.toContain(escape)
    await cleaned.handle.close()
    await cleaned.consumer
    const huge = await startCodexInTurn()
    huge.transport.serverRequest(70, 'item/commandExecution/requestApproval', {
      command,
      cwd: '/tmp/x',
      reason: `\`${command}\` requires approval: ${'x'.repeat(70_000)}`,
    })
    await vi.waitFor(has(huge.events, (e) => e.type === 'permission_request'))
    expect('providerReason' in scopeOf(huge.events)).toBe(false)
    await huge.handle.close()
    await huge.consumer
  })

  it('⚑ 704 control: with a command, the card discloses the command — and 709 carries the model’s justification as the AGENT’s, nowhere else', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    // ⚑ The measured `justified` shape: a command the model escalated, with the rule Codex offers.
    transport.serverRequest(60, 'item/commandExecution/requestApproval', {
      command: 'rm -rf build',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
      reason: 'Do you want me to clean the build folder?',
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.detail).toBe('rm -rf build')
    expect(req.agentReason).toBe('Do you want me to clean the build folder?')
    // ⛔ Not the provider's (`providerReason`), not the file card's `summary`, not the action.
    expect(JSON.stringify({ ...req, agentReason: undefined })).not.toContain(
      'clean the build folder',
    )
    // ⚑ 720 · R73's control: an escalation WITH the offered rule is the model's, and no policy's.
    expect('providerReason' in req).toBe(false)
    await handle.close()
    await consumer
  })

  /**
   * 🔴 **709 · R44 — the model's words on a command card, carried by their author.** ⚑ Measured by
   * `probe:codex-approval-reason` on the bundled 0.146.0: `reason` is the model's `justification`,
   * verbatim, and absent without one. The pair: with one, `agentReason` is it; without one, the key is
   * ABSENT (`in`, never `toBeUndefined`, which a key present-as-undefined would pass).
   */
  it('⚑ 709 control · a command escalated WITHOUT a justification carries no `agentReason` at all', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(61, 'item/commandExecution/requestApproval', {
      command: 'rm -rf build',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    expect('agentReason' in scopeOf(events)).toBe(false)
    await handle.close()
    await consumer
  })

  it('⛔ 709 · the agent’s words are CLEANED like the provider’s, never reworded — and dropped past the ceiling', async () => {
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.serverRequest(62, 'item/commandExecution/requestApproval', {
      command: 'rm -rf build',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'build'],
      reason: '\u001b[1mClean\u001b[0m the\u202e build\n folder?',
    })
    transport.serverRequest(63, 'item/commandExecution/requestApproval', {
      command: 'rm -rf dist',
      cwd: '/tmp/x',
      proposedExecpolicyAmendment: ['rm', '-rf', 'dist'],
      reason: 'x'.repeat(MAX_PERMISSION_DETAIL_CHARS + 1),
    })
    await vi.waitFor(() =>
      expect(events.filter((e) => e.type === 'permission_request')).toHaveLength(2),
    )
    const [cleaned, tooLong] = events.filter(
      (e): e is Extract<RuntimeEvent, { type: 'permission_request' }> =>
        e.type === 'permission_request',
    )
    expect(cleaned?.agentReason).toBe('Clean the build folder?')
    expect(tooLong !== undefined && 'agentReason' in tooLong).toBe(false)
    await handle.close()
    await consumer
  })

  it('an item from a FINISHED turn cannot put paths on the live turn’s card (181)', async () => {
    // ⛔ The correlation is only as honest as the gate above it. `patches.note` sits BELOW the
    // turn-scope check, so a stale item is not merely un-rendered — it never enters the map, and a
    // card for a different turn's patch cannot inherit its filenames.
    const { transport, handle, events, consumer } = await startCodexInTurn()
    transport.notification(
      'turn/completed',
      turnCompletedNotification('th_1', completedTurn('tn_1')),
    )
    await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))
    await handle.send('two') // now bound to tn_2
    transport.notification('item/started', {
      ...fileItem('it_11', [{ path: '/w/stale.txt', kind: { type: 'add' }, diff: '@@' }]),
      turnId: 'tn_1', // STALE
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    transport.serverRequest(59, 'item/fileChange/requestApproval', {
      threadId: 'th_1',
      turnId: 'tn_2',
      itemId: 'it_11',
      startedAtMs: 0,
    })
    await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
    const req = scopeOf(events)
    expect(req.scope.paths).toEqual([])
    expect(req.detail).not.toContain('stale.txt')
    expect(req.scope.underDisclosed, 'and it says so rather than showing an empty list').toBe(true)
    await handle.close()
    await consumer
  })

  /** The card raised for ONE request id — 184's tests publish more than one in a session. */
  const cardFor = (events: RuntimeEvent[], id: string) => {
    const p = events.find((e) => e.type === 'permission_request' && e.id === id)
    if (!p || p.type !== 'permission_request') throw new Error(`no permission_request ${id}`)
    return p
  }

  /** A `patchUpdated` frame — the notification 092 designed on and nobody has ever received. */
  const patchUpdated = (
    itemId: string,
    changes: unknown[],
    ids: { threadId?: string; turnId?: string } = {},
  ): Record<string, unknown> => ({
    threadId: 'th_1',
    turnId: 'tn_1',
    ...ids,
    itemId,
    changes,
  })

  describe('⛔ a card that names the wrong file (184, from 182 H3)', () => {
    it('a foreign or stale patchUpdated cannot move the live card off its file', async () => {
      // ⛔ **The real shape, which the tests before it did not compose.** 181 correlated on `itemId`
      // ALONE and read `item/fileChange/patchUpdated` from OUTSIDE the turn gate, so a late, child or
      // stale frame reusing an active id replaced the active entry — and the card then named a file
      // it was not about while `underDisclosed: false` claimed it had named them all.
      //
      // ⚠️ **What this test proves, exactly: the COMPOSITE behaviour, not either half.** Both fixes
      // are load-bearing here and each alone is sufficient for these two frames — the gate stops
      // them entering the tracker, and the key would refuse them if they did — so reverting one does
      // NOT turn this red. That is a fact about the fix, not a hole in the test: `⚑ …an id reused by
      // a LATER turn` below holds the key on its own (M1, M6, M7), and `⚑ foreign frames cannot fill
      // the tracker` holds the gate on its own (M4). This one is the sentence 182 wrote, asserted as
      // written, and the two beside it are why it is not the only evidence.
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.notification(
        'item/started',
        fileItem('it_12', [{ path: '/etc/hosts', kind: { type: 'update' }, diff: '@@' }]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
      // A CHILD thread reuses the id and reports something harmless…
      transport.notification(
        'item/fileChange/patchUpdated',
        patchUpdated('it_12', [{ path: '/w/benign.txt', kind: { type: 'add' } }], {
          threadId: 'th_child',
        }),
      )
      // …and so does a frame from a turn that has already finished.
      transport.notification(
        'item/fileChange/patchUpdated',
        patchUpdated('it_12', [{ path: '/w/benign.txt', kind: { type: 'add' } }], {
          turnId: 'tn_0',
        }),
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      transport.serverRequest(101, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_12',
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      const req = cardFor(events, 'number:101')
      expect(req.detail, 'the card still names what Approve actually writes').toBe(
        'modified /etc/hosts',
      )
      expect(req.detail).not.toContain('benign')
      expect(req.scope.paths).toEqual(['/etc/hosts'])
      expect(req.scope.underDisclosed, 'and the claim of full disclosure is still true').toBe(false)
      await handle.close()
      await consumer
    })

    it('…but the ACTIVE item’s own later frame still replaces the answer', async () => {
      // ⚠️ **The paired positive, and it is the one that has to be here** (181's M8: *"never erase"
      // must not become "never update"*). Two things could have made the test above pass for the
      // wrong reason — dropping `patchUpdated` from the tracker, or gating it into oblivion — and a
      // patch the model REVISED would then be approved against the version it first proposed.
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.notification(
        'item/started',
        fileItem('it_13', [{ path: '/w/first.txt', kind: { type: 'add' }, diff: '@@' }]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
      transport.notification(
        'item/fileChange/patchUpdated',
        patchUpdated('it_13', [
          { path: '/w/first.txt', kind: { type: 'add' } },
          { path: '/w/second.txt', kind: { type: 'delete' } },
        ]),
      )
      await new Promise((resolve) => setTimeout(resolve, 30))
      transport.serverRequest(102, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_13',
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      const req = cardFor(events, 'number:102')
      expect(req.detail.split('\n')).toEqual(['added /w/first.txt', 'deleted /w/second.txt'])
      expect(req.scope.underDisclosed).toBe(false)
      await handle.close()
      await consumer
    })

    it('an id reused by a LATER turn does not inherit the earlier turn’s files', async () => {
      // ⛔ **The failure the gate cannot reach, and the reason the key had to widen.** Every frame
      // here is legitimate and in-turn: the item is announced during the turn it belongs to and the
      // gate lets it through. It is the APPROVAL, one turn later, that used to read it — because
      // `itemId` alone was the whole correlation and nothing promises an id is unique beyond its
      // turn. The card named `/etc/shadow` for a patch that had nothing to do with it.
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.notification(
        'item/started',
        fileItem('it_14', [{ path: '/etc/shadow', kind: { type: 'delete' }, diff: '@@' }]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
      transport.serverRequest(103, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_14',
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      // ⚑ The paired positive FIRST, in the same session: the turn that was told gets its answer.
      expect(cardFor(events, 'number:103').detail).toBe('deleted /etc/shadow')
      await handle.respondPermission('number:103', { outcome: 'allow' })
      transport.notification(
        'turn/completed',
        turnCompletedNotification('th_1', completedTurn('tn_1')),
      )
      await vi.waitFor(() => expect(events.filter((e) => e.type === 'turn').length).toBe(1))
      await handle.send('two') // now bound to tn_2
      transport.serverRequest(104, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_2',
        itemId: 'it_14', // the SAME item id, one turn later
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request' && e.id === 'number:104'))
      const stale = cardFor(events, 'number:104')
      expect(stale.detail, 'this turn was told nothing, and the card says so').not.toContain(
        'shadow',
      )
      expect(stale.scope.paths).toEqual([])
      expect(stale.scope.underDisclosed).toBe(true)
      await handle.close()
      await consumer
    })

    it('foreign frames cannot fill the tracker and evict the live turn’s entry', async () => {
      // ⚠️ **182's second route to the same card.** The bound is 64 and eviction takes the oldest, so
      // an ungated stream of unique foreign ids could push out the entry the running turn needs —
      // and the card would fall back to *"the provider did not name the files"* for a patch we WERE
      // told about. Nothing foreign reaches the tracker now, so 70 of them change nothing.
      const { transport, handle, events, consumer } = await startCodexInTurn()
      transport.notification(
        'item/started',
        fileItem('it_15', [{ path: '/etc/hosts', kind: { type: 'update' }, diff: '@@' }]),
      )
      await vi.waitFor(has(events, (e) => e.type === 'tool_call'))
      for (let i = 0; i < 70; i += 1) {
        transport.notification(
          'item/fileChange/patchUpdated',
          patchUpdated(`foreign-${i}`, [{ path: `/w/${i}.txt`, kind: { type: 'add' } }], {
            threadId: 'th_child',
          }),
        )
      }
      await new Promise((resolve) => setTimeout(resolve, 30))
      transport.serverRequest(105, 'item/fileChange/requestApproval', {
        threadId: 'th_1',
        turnId: 'tn_1',
        itemId: 'it_15',
        startedAtMs: 0,
      })
      await vi.waitFor(has(events, (e) => e.type === 'permission_request'))
      expect(cardFor(events, 'number:105').detail).toBe('modified /etc/hosts')
      expect(cardFor(events, 'number:105').scope.underDisclosed).toBe(false)
      await handle.close()
      await consumer
    })
  })
})
