export const SHARED_DATA_FEATURE = 'shared-data-v1'
export const SHARED_DATA_PERMISSION = 'brocrew-shared-data'
export const WORKSPACE_LABEL_LIMIT = 80

/** Display text only; identity and paths never use this label. */
export function sharedWorkspaceLabel(label: string): string {
  return (
    Array.from(
      label
        .normalize('NFC')
        .replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, ' ')
        .replace(/\s+/gu, ' ')
        .trim(),
    )
      .slice(0, WORKSPACE_LABEL_LIMIT)
      .join('') || 'Workspace'
  )
}
