"""Normal-agent conversations chosen per provider.

The table is reserved as 4002, with M1 onward. Each row names its observable fault and a focused
killer. Proofs use fictional providers/homes through verify_row.py, with a green baseline before
each group and byte restoration afterwards. Focused proofs do not change table-run verdicts.
Services keep one conversation; identity defaults, native stores and selected approval facts must
remain distinct from a conversation's provider. No row reads credentials or runs a native CLI.
"""

MUTATIONS = [('M1 · the give schema refuses its advertised provider argument — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/spawn-rails.ts', '    provider: providerSchema.optional(),\n', '')]),
 ('M2 · an explicit provider loses to the identity default — killed by `one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/spawn-rails.ts',
    '  if (asked.provider !== undefined) return asked.provider\n',
    '')]),
 ('M3 · a model held only by the other provider cannot choose its conversation — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/spawn-rails.ts',
    '  if (theNamedModels !== null) return theNamedModels\n',
    '')]),
 ('M4 · recorded child lookup ignores its provider while keeping both SQL bindings — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/db/session-store.ts',
    '            AND (? IS NULL OR provider = ?)\n',
    '            AND (? IS NULL OR ? IS NOT NULL)\n')]),
 ('M5 · a first-start reservation forgets its chosen provider — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      provider: held.provider ?? this.deps.store.recordedOne(id)?.provider ?? null,\n',
    '      provider: this.deps.store.recordedOne(id)?.provider ?? null,\n')]),
 ('M6 · an in-flight child on another provider is treated as the requested child — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      if (provider !== undefined && slot.provider !== provider) return false\n',
    '')]),
 ('M7 · ordinary worker selection ignores the chosen provider — killed by `normal-worker-selection.test.ts`',
  [('apps/desktop/src/main/normal-worker-pools.ts',
    '      .find((worker) => onProvider(worker.conversation))',
    '      .find(() => true)')]),
 ('M8 · parallel work takes a free worker from another provider — killed by '
  '`normal-worker-selection.test.ts`',
  [('apps/desktop/src/main/normal-worker-pools.ts', '            onProvider(one.conversation) &&\n', '')]),
 ('M9 · a provider loses its ordinary legacy conversation after a pool is added — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    "        if (this.legacyHelperAs(giver, profile, provider, bound) !== null) return { is: 'legacy' }\n",
    "        if (false) return { is: 'legacy' }\n")]),
 ('M10 · a service silently accepts work naming another provider — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/spawn-rails.ts',
    '      requestedProvider !== service.provider\n',
    '      requestedProvider !== service.provider && false\n')]),
 ('M11 · a service provider refusal omits the models the giver may use — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/spawn-rails.ts',
    '        choices: facts.serviceModels?.() ?? [],\n',
    '        choices: [],\n')]),
 ('M12 · first use of another provider mistakes the identity’s old home for its own — killed by '
  '`provider-first-use-models.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '    const standIn = this.hasNeverRun(profileId, provider) ? STAND_IN_PROFILE : null\n',
    '    const standIn = this.hasNeverRun(profileId) ? STAND_IN_PROFILE : null\n')]),
 ('M13 · provider-filtered home metadata lists the other provider’s homes too — killed by '
  '`provider-profile-list.test.ts`',
  [('apps/desktop/src/main/runtime/provider-homes.ts',
    '    if (provider !== undefined && home.provider !== provider) continue\n',
    '')]),
 ('M14 · an own-provider model still probes the other provider’s catalogue — killed by '
  '`provider-first-use-models.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '        (first !== null && theListedRow(first.rows, asked.model) !== undefined)\n',
    '        false\n')]),
 ('M15 · parallel work promises a retry when a full pool has no matching provider — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    "        return { is: 'full', ...(noProvider ? { noProvider: true as const } : {}) }\n",
    "        return { is: 'full' }\n")]),
 ('M16 · the tool no longer advertises supported provider choices — killed by `dual-provider-tools.test.ts`',
  [('apps/desktop/src/main/runtime/agent-tools.ts',
    '          provider: documentedToolEnum(\n'
    "            TOOL_INPUT_ENUMS['give_work:provider'],\n"
    "            'Which provider this piece runs on. It selects that provider’s conversation with this "
    'normal agent, or starts one; never switches an existing conversation or changes the agent’s default. '
    "Services refuse a different provider.',\n"
    "            'Leave it out to use the named model’s unique provider, else the agent’s default.',\n"
    '          ).optional(),\n',
    '          provider: z.string().optional(),\n')]),
 ('M17 · a starting conversation’s card forgets the reserved provider — killed by '
  '`dual-provider-tools.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      provider: slot.provider ?? session?.provider ?? null,\n',
    '      provider: session?.provider ?? null,\n')]),
 ('M18 · a new-conversation pick launches the identity default instead — killed by '
  '`start-as-agent-provider-choice.dom.test.ts`',
  [('apps/desktop/src/renderer/src/components/StartAsAgent.vue',
    '      provider: provider.value,\n',
    '      provider: props.provider,\n')]),
 ('M19 · a new-conversation pick loses its selected model — killed by '
  '`start-as-agent-provider-choice.dom.test.ts`',
  [('apps/desktop/src/renderer/src/components/StartAsAgent.vue',
    '      ...(picked.value === null ? {} : { model: picked.value.model }),\n',
    '')]),
 ('M20 · approval disclosure stays on the identity default after another provider is selected — killed by '
  '`start-as-agent-provider-choice.dom.test.ts`',
  [('apps/desktop/src/renderer/src/components/StartAsAgent.vue',
    '  const status = props.capabilities?.[provider.value]?.approvals\n',
    '  const status = props.capabilities?.[props.provider]?.approvals\n')]),
 ('M21 · giving work writes the launch provider into the identity’s saved default — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      const { start } = goes\n',
    '      const { start } = goes\n      this.setAgentProvider(start.profileId, start.provider)\n')]),
 ('M22 · a Codex memory correction is sent to Claude’s same-named store — killed by '
  '`memory-book.dom.test.ts`',
  [('apps/desktop/src/renderer/src/components/MemoryBook.vue',
    '        provider: chosen.provider,\n',
    "        provider: 'claude',\n")]),
 ('M23 · a new default-provider conversation’s receipt hides where its provider came from — killed by '
  '`dual-provider-tools.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '        ...(startedOnDefault ? { startedOnDefault: true as const } : {}),\n',
    '')]),
 ('M24 · settings omit how the new default routes new gives — killed by `provider-default-wording.test.ts`',
  [('apps/desktop/src/renderer/src/lib/front-door-words.ts',
    '    `on. Once you choose a default here, new gives without a provider or model use that provider’s '
    'conversation, starting one if needed. ` +\n',
    '    `on. ` +\n')]),
 ('M25 · the rules panel no longer states that a grant stays on its provider — killed by '
  '`kept-rules-on-the-providers-page.dom.test.ts`',
  [('apps/desktop/src/renderer/src/components/KeptRules.vue',
    '        provider, not to other providers. If you remove one, agents will ask again the next time a\n',
    '        provider. If you remove one, agents will ask again the next time a\n')]),
 ('M26 · settings promise a person-started conversation for a service — killed by '
  '`the-model-control-reads-r31.dom.test.ts`',
  [('apps/desktop/src/renderer/src/components/CapabilitiesSheet.vue',
    'providerTakesEffectNextTime(props.runsOn, true, isService)',
    'providerTakesEffectNextTime(props.runsOn, true, false)')]),
 ('M27 · identity-shared standing rules are omitted from both provider conversations — killed by '
  '`one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      configured: profileSlug === null ? null : this.deps.store.configuredLayerFor(profileSlug),\n',
    '      configured: null,\n')]),
 ('M28 · a full provider pool hides its remedy past the person-visible cut — killed by '
  '`the-act-inside-the-cut.test.ts`',
  [('apps/desktop/src/main/runtime/spawn-rails.ts',
    "        'Give work on a provider already in that pool, or choose another agent. ' +\n"
    "        `Your worker pool for “${detail.profileId ?? '?'}” is full and has no conversation on "
    "${detail.provider === undefined ? 'the chosen provider' : PROVIDER_NAME[detail.provider]}. ` +\n",
    "        `Your worker pool for “${detail.profileId ?? '?'}” is full and has no conversation on "
    "${detail.provider === undefined ? 'the chosen provider' : PROVIDER_NAME[detail.provider]}. ` +\n"
    "        'Give work on a provider already in that pool, or choose another agent. ' +\n")]),
 ('M29 · an owned in-flight reservation is treated as an unreadable database binding — killed by '
  '`worker-birth-delivery.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '      ? [current]\n',
    '      ? this.deps.store.workerLineage(current)\n')]),
 ('M30 · an older ordinary conversation is lost while another provider has an unrecorded worker birth — '
  'killed by `one-agent-on-both-providers.test.ts`',
  [('apps/desktop/src/main/runtime/runtime-host.ts',
    '            ...this.normalWorkerLineage(worker),\n',
    '            ...this.deps.store.workerLineage(worker.conversation),\n')])]
