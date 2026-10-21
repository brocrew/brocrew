import { describe, expect, it } from 'vitest'
import { approvalModeLabel } from '../../src/renderer/src/lib/approval-mode'

// The old agent-card disclosure panel is replaced by Ask/Auto. Its switch and
// first-choice wording are covered by first-approval-choice.dom.test.ts.
// List labels are unchanged by that scoped screen change.
describe('§2 · the mode is named what the CLIs name it', () => {
  it('⛔ a session in a LIST reads as yolo too, and an unrecorded one is neither mode', async () => {
    // The resume list rendered `session.approvalMode` raw, so a session that had run allow-all came
    // back on screen saying `auto` — the one word this dispatch is about. `approvalModeLabel` is the
    // only place the renderer is allowed to turn the enum into a word.
    //
    // ⚑ **The only member of §2 that `417` left standing**, and the only place in the repo that
    // pins the `auto → yolo` word: `the-bar-and-the-shelf.test.ts` covers `ask`, `null` and
    // `undefined`, and the header pill's `YOLO_LABEL` is a different constant on a different
    // surface. Its subject — the shelf and the resume list — is untouched by HO-022 §2.
    expect(approvalModeLabel('auto')).toBe('yolo')
    expect(approvalModeLabel('ask')).toBe('ask')
    // ⚠️ `null` is not a mode. A row recorded before the column existed has no answer, and guessing
    // `ask` would present a yolo session as a careful one.
    expect(approvalModeLabel(null)).toBe('unrecorded')
    expect(approvalModeLabel(undefined)).toBe('unrecorded')
  })
})
