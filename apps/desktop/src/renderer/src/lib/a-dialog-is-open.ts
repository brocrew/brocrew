/**
 * Whether a dialog is on screen: a sheet, the command palette, or a popover such as the model
 * picker. Every one in the window is marked `role="dialog"` (or `alertdialog`), and a closed popover
 * takes no room, so this needs no surface to remember to say it opened.
 */
export function aDialogIsOpen(root: ParentNode = document): boolean {
  for (const one of root.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
    if (one.getClientRects().length > 0) return true
  }
  return false
}
