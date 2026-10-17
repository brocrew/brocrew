import type { MenuItemConstructorOptions } from 'electron'

/**
 * **The application menu, because Electron's default one ends every conversation** (203, from
 * 195 H2).
 *
 * ## What was there before this file
 *
 * Nothing. `Menu` was not imported anywhere in `src/main`, `setApplicationMenu` had no hits in the
 * repository, no accelerator was registered, and no `before-input-event` listener existed — so this
 * app shipped Electron's default darwin menu, untouched, for the whole of Slice 2. That menu has a
 * **View → Reload (⌘R)** and a **View → Force Reload (⇧⌘R)**.
 *
 * ⛔ **In this app a reload is not a refresh, it is an ending.** `webContents.reload()` commits a
 * navigation, `did-navigate` fires, and {@link installSessionRelease} calls
 * `closeSessionsForOwner` — every live conversation this window STARTED, closed, with no
 * confirmation and no undo. ⚠️ **It said *every live conversation in the window* until `523`**, and
 * `336` had already made that a universal this loop does not perform: one the window merely took
 * over is released back to nobody and keeps running. 🔴 The argument below is unchanged — half of
 * this loss is still permanent, and a keystroke is still no place for it. 094 measured exactly that row (*"`webContents.reload()` (⌘R, devtools, menu)"* — the one
 * gesture in its table that reaches `did-navigate`), and pinned it as the case the release exists
 * FOR. What nobody noticed is that a menu this app never authored puts it one keystroke away.
 *
 * ## Why the affordance is REMOVED rather than confirmed or disclosed
 *
 * ⚑ **Because the app already refuses the same gesture through the other door, silently.** A
 * renderer-initiated `location.reload()` raises `will-frame-navigate`, the navigation guard prevents
 * it, and nothing is destroyed — 074 made that call deliberately and argued it: *"our own document,
 * reached by a GESTURE — refused, and this is data loss if it is not."* ⛔ **A confirm dialog on ⌘R
 * would be a SECOND answer to that same question**, one door apart, and the friendlier of two
 * statements of one rule drifting is the defect shape this repository keeps paying for (076 §3,
 * 187 §1). One rule: **this window does not re-navigate to its own document.**
 *
 * ⚠️ **And a confirm asks a question with only one good answer.** A reload gives a user of this app
 * nothing — the renderer's state is not a page of fetched data, it is the host's sessions, arriving
 * over IPC — so "reload anyway?" is a prompt whose Yes is always the wrong button. 106/118's rule is
 * about controls that cannot act; this is its sibling — a control that can only harm.
 *
 * ⚠️ **What removal costs, said out loud:** every other View item comes with it unless it is
 * re-declared here, which is why this template restates the standard roles rather than deleting the
 * menu. `Menu.setApplicationMenu(null)` on darwin would take Copy, Paste, Quit and Minimise with it
 * — the accelerators on macOS are menu items, so an app with no menu is an app you cannot ⌘C in.
 *
 * ## The residual, named rather than implied
 *
 * ⛔ **DevTools has its own ⌘R and it is out of this menu's reach.** It drives the inspected page's
 * `webContents.reload()` from a different WebContents, so no template can remove it. The item is
 * therefore offered only when the app is NOT packaged: in a shipped build there is no menu route to
 * DevTools and so none to its reload; in a development build a developer has it, and a developer is
 * the person who knows what it costs. That is a narrowing, not a closure, and it is the honest
 * description of what this file can do.
 */

/**
 * ⛔ **The roles this app must never offer**, as a value a test can walk.
 *
 * Both of them commit a navigation to our own document, which is the one thing
 * {@link installNavigationGuard} exists to refuse and the one thing `did-navigate` treats as the end
 * of every session in the window. Listed rather than merely omitted, so "we forgot" and "we decided"
 * are different states of this file.
 */
export const ENDS_EVERY_CONVERSATION = ['reload', 'forceReload'] as const

/**
 * ⚑ **The roles a macOS app cannot do without**, also as a value a test can walk — because the
 * cheapest way to pass a test that says "no reload" is to ship a menu with nothing in it.
 */
export const MUST_STILL_WORK = [
  'quit',
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'selectAll',
  'minimize',
  'close',
  'togglefullscreen',
] as const

/**
 * Build the template. **Pure**, and in this file rather than in `index.ts`, for the reason 202
 * recorded about that file: it imports `electron` as a VALUE, so nothing in the gate can load it and
 * no mutation can reach it. `single-instance.ts` is the shape being followed — the policy is here
 * and testable; the two lines that hand it to Electron are there.
 *
 * @param appName the name a person reads — *BroBot* — in the first menu and its About, Hide and Quit
 *   items. ⛔ Never `app.getName()`: that is the technical name, which also places the data folder,
 *   and it stays as it is (W4.80).
 * @param devTools whether to offer the DevTools item — false in a packaged build (see above)
 */
export function appMenuTemplate(options: {
  appName: string
  devTools: boolean
  defaultLook?: () => void
}): MenuItemConstructorOptions[] {
  const { appName, devTools } = options
  return [
    // The application menu. On darwin the FIRST submenu is this one whatever it is called, and
    // `role: 'appMenu'` would rebuild the default — including nothing we object to — but naming it
    // explicitly is what lets the test below read one template rather than trust a role expansion.
    {
      label: appName,
      submenu: [
        { role: 'about', label: `About ${appName}` },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: `Hide ${appName}` },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        // ⚠️ Quit is `app.quit()`, which is what `before-quit` hangs off — the bounded `closeAll`
        // that 202 measured. It is the ONE menu item that ends conversations and is meant to.
        { role: 'quit', label: `Quit ${appName}` },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      // ⛔ **View, minus Reload and Force Reload.** Everything here is a change of how the one
      // document is displayed; nothing here replaces it.
      label: 'View',
      submenu: [
        ...(options.defaultLook ? [{ label: 'Default look', click: options.defaultLook }] : []),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(devTools ? [{ type: 'separator' as const }, { role: 'toggleDevTools' as const }] : []),
      ],
    },
    {
      label: 'Window',
      submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'close' }],
    },
  ]
}

/** Every role in a template, flattened — the walk both the app and its test need. */
export function rolesIn(template: readonly MenuItemConstructorOptions[]): string[] {
  return template.flatMap((item) => [
    ...(item.role === undefined ? [] : [item.role as string]),
    ...(Array.isArray(item.submenu) ? rolesIn(item.submenu) : []),
  ])
}
