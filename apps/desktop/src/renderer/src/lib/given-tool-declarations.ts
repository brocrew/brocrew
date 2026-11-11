import type { WhatThisAgentWasGiven } from '../../../shared/what-this-agent-was-given'

export function toolWasSent(given: WhatThisAgentWasGiven, name: string): boolean {
  const omitted = given.tools.notSentDeclarations
  if (omitted !== undefined) return !omitted.includes(name)
  const settings = given.launchSettings
  if (settings?.recorded !== true) return true
  const off = settings.settings.find((one) => one.key === 'tools-off')?.atLaunch
  return !Array.isArray(off) || !off.includes(name)
}

export function toolDeclarationWords(given: WhatThisAgentWasGiven) {
  const { declarationNames, list, listedByTheProvider: listed } = given.tools
  return {
    origin: listed ? 'withMessage' : declarationNames === undefined ? 'notRecorded' : 'thisBuild',
    text: (listed?.names ?? declarationNames ?? list.map((one) => one.name)).join('\n'),
    missing:
      !listed && declarationNames === undefined
        ? 'Provider declaration names were not recorded; these are the stored tool names.'
        : null,
  } as const
}
