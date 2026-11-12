export function checkBetaKeyContract({ beta, sealedRows, status, entries, entryFor, check }) {
  const version = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(beta?.version ?? '')
  const parts = version?.slice(1).map(Number)
  const known = parts !== undefined && parts.every(Number.isSafeInteger)
  const newer = known && (parts[0] > 0 || parts[1] > 2 || (parts[1] === 2 && parts[2] >= 19))
  const fileBacked = newer && sealedRows === 0
  const sealed = known && !newer && Number.isSafeInteger(sealedRows) && sealedRows > 0
  const entry =
    sealed && Array.isArray(entries) && entries.length === 1 ? (entries[0] ?? null) : null
  const knownEntry = entry === null ? null : entryFor(entry.appName)
  const facts = {
    storage: fileBacked ? 'file-backed' : sealed ? 'legacy-sealed' : 'unknown',
    legacySealed: fileBacked ? 'not-exercised' : sealed ? 'required' : 'unknown',
    source: beta?.build?.commit ?? null,
    sealedRows: sealedRows ?? null,
    status: status ?? null,
    entries,
    entry,
    preservedEntry: fileBacked ? entries?.[0] ?? null : entry,
  }
  if (fileBacked) {
    check(status?.keyFilePresent === true, 'the beta saved its API keys in api-keys.json', facts)
    check(
      status?.set === true && status.inUse === true && status.readState === undefined,
      'the file-backed beta reports its saved key readable and in use after restart',
      facts,
    )
  } else if (sealed) {
    check(
      entry !== null &&
        entry.service === knownEntry.service &&
        entry.account === knownEntry.account,
      'the beta keeps its sealing key in one Keychain entry, under a name this check knows',
      facts,
    )
  } else {
    check(
      false,
      'the beta key storage contract is not established by its release and fixture',
      facts,
    )
  }
  return facts
}

export function keyEntryPreserved(before, entries) {
  return (
    entries.length === 1 &&
    entries[0].service === before.service &&
    entries[0].account === before.account &&
    entries[0].created === before.created &&
    entries[0].modified === before.modified
  )
}
