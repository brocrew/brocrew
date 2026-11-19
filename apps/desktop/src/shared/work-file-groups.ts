import type { DocumentForm, ResourceRole } from './documents'

export const WORK_FILE_GROUPS = ['brief', 'result', 'attachments', 'working'] as const
export type WorkFileGroup = (typeof WORK_FILE_GROUPS)[number]

export function workFileGroup(
  file: { readonly role: ResourceRole; readonly form: DocumentForm | null },
  returned: boolean | null,
): WorkFileGroup | null {
  if (file.role === 'made' && returned === null) return null
  if (file.role === 'made' && !returned) return 'working'
  return file.form === 'markdown' || file.form === 'page'
    ? file.role === 'input'
      ? 'brief'
      : 'result'
    : 'attachments'
}
