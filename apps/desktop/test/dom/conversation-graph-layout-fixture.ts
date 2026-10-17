import { conv, task, viewOf } from './forest-fixture'

export const siblingIds = Array.from({ length: 8 }, (_, i) => `sess_planner_${String(i + 1)}`)

/** Made-up planning work, shared by geometry tests and review captures. */
export function conversationGraphFixture() {
  return viewOf([
    conv('sess_brobot', null),
    ...siblingIds.map((id) => conv(id, 'sess_brobot')),
    conv('sess_reader', siblingIds[0]!),
    conv('sess_editor', siblingIds[0]!),
    task('sess_brobot', 'work_root', 'W1', 'Plan a community garden', null),
    ...Array.from({ length: 6 }, (_, i) =>
      task(
        siblingIds[0]!,
        `work_${String(i + 1)}`,
        `W1.${String(i + 1)}`,
        `Planning step ${String(i + 1)}`,
        'sess_brobot',
      ),
    ),
    conv('sess_other', null),
    conv('sess_other_helper', 'sess_other'),
  ])
}
