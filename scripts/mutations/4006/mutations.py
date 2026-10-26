"""Near-limit display figures, confirmation and per-window reset pairing."""

MUTATIONS = [('M1 · retained warnings replace current usage figures — killed by '
  '`the-provider-warning-uses-the-card-reading.dom.test.ts`',
  [('apps/desktop/src/renderer/src/components/ProviderCard.vue',
    "    if (props.limit?.standing === 'about-to-stop') {\n",
    '    if (false) {\n')]),
 ('M2 · unconfirmed readings revive a numeric warning — killed by '
  '`the-provider-warning-uses-the-card-reading.dom.test.ts`',
  [('apps/desktop/src/renderer/src/components/ProviderCard.vue',
    '        { [props.provider]: (props.readings ?? []).filter((one) => one.unconfirmed !== true) '
    '},\n',
    '        { [props.provider]: props.readings ?? [] },\n')]),
 ('M3 · different windows share one reset time — killed by '
  '`the-provider-warning-uses-the-card-reading.dom.test.ts`',
  [('apps/desktop/src/renderer/src/components/ProviderCard.vue',
    '      const near = wallsFromUsage(\n'
    '        { [props.provider]: (props.readings ?? []).filter((one) => one.unconfirmed !== true) '
    '},\n'
    '        [],\n'
    '        props.clock,\n'
    '      ).flatMap((wall) => providerConditions([wall], props.clock))\n',
    '      const near = providerConditions(wallsFromUsage(\n'
    '        { [props.provider]: (props.readings ?? []).filter((one) => one.unconfirmed !== true) '
    '},\n'
    '        [],\n'
    '        props.clock,\n'
    '      ), props.clock)\n')])]
