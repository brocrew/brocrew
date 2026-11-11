let revision = 0
let closed = false
const { rpc, pending } = window.createPluginUiRpc(
  () => revision,
  () => closed,
)
let deleting = null
let deletionError = ''
let deletionPending = false
let lastSnapshot = null
// Cards the person opened; every redraw keeps them open.
const expanded = new Set()
// The rename field is one node reused by every redraw, so typing keeps its text.
let renaming = null
// A redraw mid-composition would cut an input method's unfinished word, so a read waits for it.
let composing = false
let heldSnapshot = null
let clearing = false
// Profiles whose on/off change is in flight, with the asked-for state, so every redraw shows it busy.
const switching = new Map()
// The snapshot a refused switch is put back on; its redraws keep the refusal in the status.
let refusedOn = null
const RENAME_ERRORS = {
  invalid: 'Profile name must be 1–60 characters.',
  duplicate: 'Another profile already uses that name.',
  deleting: 'This profile is being deleted. Try again after deletion finishes.',
}
const UNAVAILABLE = 'Plugin unavailable. Try again.'
// eslint-disable-next-line no-control-regex -- The same characters the plugin refuses in a name.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/
const status = document.querySelector('#status')
function say(words, tone) {
  status.textContent = words
  status.dataset.tone = tone
}
function text(tag, value) {
  const node = document.createElement(tag)
  node.textContent = value
  return node
}
async function propose(payload, afterSuccess) {
  try {
    await rpc('proposeConfig', payload)
    afterSuccess?.()
    await refresh()
  } catch {
    say(UNAVAILABLE, 'warn')
  }
}
function refocus(key) {
  document
    .querySelector(`#profiles [data-focus="${CSS.escape(key)}"]`)
    ?.focus({ preventScroll: true })
}
function shownName(profile) {
  return typeof profile.displayName === 'string' ? profile.displayName.slice(0, 120) : profile.name
}
// The plugin checks these too; the page says them before sending because a refusal reaches it without words.
function renameRefusal(profiles, name, value) {
  const label = value.trim()
  const length = [...label].length
  if (length < 1 || length > 60 || CONTROL.test(label)) return RENAME_ERRORS.invalid
  if (profiles.find((p) => p.name === name)?.status === 'deleting') return RENAME_ERRORS.deleting
  if (profiles.some((p) => p.name !== name && shownName(p).toLowerCase() === label.toLowerCase()))
    return RENAME_ERRORS.duplicate
  return ''
}
function startRename(profile) {
  if (!renaming || renaming.profile !== profile.name) {
    const input = focusKey(document.createElement('input'), `rename-field:${profile.name}`)
    input.value = shownName(profile)
    input.ariaLabel = 'Profile name'
    input.autocomplete = 'off'
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') stopRename()
    })
    input.addEventListener('compositionstart', () => (composing = true))
    input.addEventListener('compositionend', endComposition)
    input.addEventListener('blur', endComposition)
    renaming = { profile: profile.name, input, error: '', pending: false }
    draw(lastSnapshot)
  }
  renaming.input.focus()
  renaming.input.select()
}
function endComposition() {
  if (!composing) return
  composing = false
  // Clearing the cards blurs the field; drawing again from inside that draw would duplicate them.
  if (heldSnapshot && !clearing) show(heldSnapshot)
}
function stopRename() {
  if (!renaming || renaming.pending) return
  const { profile } = renaming
  renaming = null
  composing = false
  redraw()
  refocus(`rename:${profile}`)
}
async function saveRename() {
  if (!renaming || renaming.pending) return
  const { profile, input } = renaming
  const newName = input.value.trim()
  const current = lastSnapshot.profiles.find((p) => p.name === profile)
  if (current && newName === shownName(current)) return stopRename()
  renaming.error = renameRefusal(lastSnapshot.profiles, profile, newName)
  if (renaming.error) return redraw()
  renaming.pending = true
  redraw()
  try {
    await rpc('proposeConfig', { action: 'rename-profile', profile, newName })
    if (renaming?.profile === profile) {
      renaming.pending = false
      stopRename()
    }
    await refresh()
  } catch {
    let refusal = UNAVAILABLE
    try {
      const snapshot = checked(await rpc('read', { surface: 'chrome' }))
      show(snapshot)
      refusal = renameRefusal(snapshot.profiles, profile, newName) || UNAVAILABLE
    } catch {
      // Without a fresh read, the generic line is the only true one.
    }
    if (renaming?.profile !== profile) return
    renaming.error = refusal
    renaming.pending = false
    redraw()
    renaming.input.focus()
  }
}
function renameForm(profile) {
  const form = document.createElement('form')
  form.className = 'profile-rename'
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void saveRename()
  })
  const deletingNow = profile.status === 'deleting'
  const save = focusKey(text('button', 'Save'), `save-rename:${profile.name}`)
  save.disabled = renaming.pending || deletingNow
  const cancel = focusKey(text('button', 'Cancel'), `cancel-rename:${profile.name}`)
  cancel.type = 'button'
  cancel.disabled = renaming.pending
  cancel.addEventListener('click', stopRename)
  form.append(renaming.input, save, cancel)
  const error = deletingNow ? RENAME_ERRORS.deleting : renaming.error
  if (error) form.append(text('p', error))
  return form
}
// The page redraws every refresh, so each control carries a key that lets focus come back to it.
function focusKey(node, key) {
  node.dataset.focus = key
  return node
}
function action(label, payload) {
  const button = focusKey(text('button', label), `${payload.action}:${payload.profile}`)
  button.addEventListener('click', () => propose(payload))
  return button
}
async function setEnabled(profile, enabled) {
  if (switching.has(profile)) return
  switching.set(profile, enabled)
  redraw()
  const asked = revision
  try {
    await rpc('proposeConfig', { action: 'set-enabled', profile, enabled })
  } catch {
    switching.delete(profile)
    refusedOn = heldSnapshot ?? lastSnapshot
    redraw()
    say(UNAVAILABLE, 'warn')
    return
  }
  switching.delete(profile)
  // The plugin took the change, so redraws show it even if the next read fails. Replies are not
  // ordered, so a read of a later revision than the one asked against already knows better.
  for (const snapshot of [lastSnapshot, heldSnapshot]) {
    const known = snapshot?.profiles.find((p) => p.name === profile)
    if (known && snapshot.configRevision <= asked) known.enabled = enabled
  }
  redraw()
  await refresh()
}
// A switch with the same words in both states; its knob, colour and aria-checked say which state it is in.
function onSwitch(profile, label) {
  const words = profile.shared ? 'On here' : 'On'
  const control = focusKey(text('button', words), `set-enabled:${profile.name}`)
  const asked = switching.get(profile.name)
  control.role = 'switch'
  control.ariaChecked = String(asked ?? profile.enabled === true)
  control.ariaLabel = `${label}: ${words.toLowerCase()}`
  if (asked !== undefined) {
    control.ariaBusy = 'true'
    control.ariaDisabled = 'true'
  }
  control.addEventListener('click', () => void setEnabled(profile.name, !profile.enabled))
  return control
}
function checkbox(label, checked, key, onChange) {
  const control = text('label', label)
  control.className = 'check'
  const box = focusKey(document.createElement('input'), key)
  box.type = 'checkbox'
  box.checked = checked
  box.addEventListener('change', () => onChange(box.checked))
  control.prepend(box)
  return control
}
function stateTone(profile) {
  if (profile.status === 'deleting' || profile.status === 'moving') return 'warn'
  return profile.inUseIn || profile.open ? 'live' : 'idle'
}
async function confirmDelete(profile, displayedConfirmation, shared) {
  if (deletionPending) return
  const wasEnabled = lastSnapshot.profiles.find((value) => value.name === profile)?.enabled === true
  deletionPending = true
  deletionError = ''
  redraw()
  try {
    await rpc('proposeConfig', {
      action: 'delete-profile',
      profile,
      confirm: profile,
      ...(shared ? { deleteConfirmation: displayedConfirmation } : {}),
    })
    deleting = null
    await refresh()
  } catch {
    deletionError =
      'Couldn’t delete this profile. Turn it off and wait for agent work to finish, then try again.'
    try {
      const snapshot = checked(await rpc('read', { surface: 'chrome' }))
      show(snapshot)
      const retained = snapshot.profiles.find((value) => value.name === profile)
      if (!retained) deleting = null
      else if (retained.enabled === false)
        deletionError = wasEnabled
          ? 'Couldn’t remove all of this profile’s data; it’s turned off. Try again.'
          : 'Couldn’t delete this profile. It’s turned off. Wait for agent work to finish, then try again.'
    } catch {
      // Keep the refusal and the last known state when the fresh read is unavailable.
    }
  } finally {
    deletionPending = false
    if (lastSnapshot) redraw()
  }
}
function checked(snapshot) {
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.configRevision) ||
    !Array.isArray(snapshot.profiles) ||
    !Array.isArray(snapshot.tabs)
  )
    throw new Error('invalid')
  return snapshot
}
function draw(snapshot) {
  checked(snapshot)
  revision = snapshot.configRevision
  lastSnapshot = snapshot
  if (snapshot === refusedOn) say(UNAVAILABLE, 'warn')
  else {
    refusedOn = null
    say('Running', 'live')
  }
  if (renaming && !snapshot.profiles.some((p) => p.name === renaming.profile)) {
    renaming = null
    composing = false
    heldSnapshot = null
  }
  const active = document.activeElement
  const focused = active?.dataset?.focus
  const caret =
    active && active === renaming?.input
      ? [active.selectionStart, active.selectionEnd, active.selectionDirection]
      : null
  const profiles = document.querySelector('#profiles')
  clearing = true
  profiles.replaceChildren()
  clearing = false
  for (const profile of snapshot.profiles.slice(0, 128)) {
    if (!/^[a-z0-9-]{1,32}$/.test(profile.name)) continue
    const row = document.createElement('article')
    row.dataset.profile = profile.name
    if (!profile.enabled) row.dataset.off = 'true'
    const details = document.createElement('div')
    details.className = 'profile-details'
    if (profile.shared) {
      const settings = document.createElement('fieldset')
      settings.append(text('legend', 'Applies to this profile in every workspace'))
      for (const [flag, label] of [
        ['allowSync', 'Allow sync'],
        ['allowExtensions', 'Allow extensions'],
        ['allowSettings', 'Allow settings'],
      ])
        settings.append(
          checkbox(label, profile[flag] === true, `${flag}:${profile.name}`, (checked) =>
            propose({ action: 'set-flags', profile: profile.name, [flag]: checked }),
          ),
        )
      details.append(settings)
      const notes = document.createElement('div')
      notes.className = 'profile-notes'
      notes.append(
        text(
          'p',
          'Workspaces using the default Chrome setup share these switches. Workspaces with their own Chrome setup have separate switches.',
        ),
      )
      if (profile.migratedFrom && profile.migratedFrom !== profile.name)
        notes.append(text('p', `Renamed from ${profile.migratedFrom}.`))
      if (profile.appliesAtNextLaunch)
        notes.append(
          text(
            'p',
            'Launch settings apply when this profile next starts. Revoked agent access applies to new work immediately.',
          ),
        )
      details.append(notes)
    } else if (profile.migration && profile.migration !== 'chrome-unknown')
      // Any other code is the plugin's own wording, so the page names none of it.
      details.append(
        text(
          'p',
          profile.migration === 'qualification-required'
            ? 'Sharing awaits migration qualification.'
            : 'This profile is still only in this workspace. You can keep using it here.',
        ),
      )
    const tabs = document.createElement('ul')
    tabs.className = 'profile-tabs'
    for (const tab of snapshot.tabs.slice(0, 200)) {
      if (tab.profile !== profile.name) continue
      const item = document.createElement('li')
      const title = text('span', String(tab.title).slice(0, 512))
      title.className = 'tab-title'
      const url = text('span', String(tab.url).slice(0, 2048))
      url.className = 'tab-url'
      item.title = `${title.textContent}\n${url.textContent}`
      item.append(title, url)
      tabs.append(item)
    }
    const tabCount = tabs.childElementCount
    if (tabCount) details.append(text('h2', 'Open tabs'), tabs)
    const heading = document.createElement('header')
    heading.className = 'profile-heading'
    // A card with nothing to fold shows its name; any other card folds on its name.
    let name
    const label = shownName(profile)
    if (details.childElementCount) {
      const open = expanded.has(profile.name)
      name = focusKey(text('button', label), `toggle:${profile.name}`)
      name.className = 'profile-toggle'
      name.ariaExpanded = String(open)
      name.addEventListener('click', () => {
        if (expanded.has(profile.name)) expanded.delete(profile.name)
        else expanded.add(profile.name)
        redraw()
      })
      details.hidden = !open
    } else {
      name = text('strong', label)
      name.className = 'profile-name'
    }
    // Agents still use the original name, so it stays readable beside a new one.
    const key = label === profile.name ? [] : [text('span', profile.name)]
    for (const k of key) k.className = 'profile-key'
    const state = text(
      'span',
      profile.inUseIn
        ? `In use in ${profile.inUseIn}`
        : profile.status === 'deleting'
          ? 'Deletion incomplete; name reserved'
          : profile.status === 'moving'
            ? 'Migration pending'
            : profile.open
              ? 'Open'
              : 'Closed',
    )
    state.className = 'profile-state'
    state.dataset.tone = stateTone(profile)
    const actions = document.createElement('div')
    actions.className = 'profile-actions'
    const openWindow = action('Open window', { action: 'open-window', profile: profile.name })
    openWindow.className = 'primary'
    actions.append(onSwitch(profile, label), openWindow)
    const rename = focusKey(text('button', 'Rename'), `rename:${profile.name}`)
    rename.disabled = profile.status === 'deleting'
    rename.addEventListener('click', () => startRename(profile))
    actions.append(rename)
    const remove = focusKey(text('button', 'Delete'), `delete:${profile.name}`)
    remove.className = 'quiet-danger'
    remove.addEventListener('click', () => {
      if (deletionPending) return
      deleting = profile.name
      deletionError = ''
      redraw()
    })
    actions.append(remove)
    heading.append(name, ...key, state, actions)
    const summary = [
      ...(profile.shared ? [`On in ${(profile.onIn ?? []).join(', ') || 'no workspaces'}`] : []),
      ...(tabCount ? [tabCount === 1 ? '1 open tab' : `${tabCount} open tabs`] : []),
    ]
    if (summary.length) {
      const line = text('p', summary.join(' · '))
      line.className = 'profile-summary'
      heading.append(line)
    }
    row.append(heading)
    if (renaming?.profile === profile.name) row.append(renameForm(profile))
    if (profile.migration === 'chrome-unknown') {
      const sharing = text(
        'p',
        "This profile is still only in this workspace because Chrome couldn't be checked. You can keep using it here. We'll try to share it again next time the plugin starts.",
      )
      sharing.className = 'profile-notice'
      row.append(sharing)
    }
    if (profile.enabled && profile.helperOff === true) {
      const helper = document.createElement('p')
      helper.className = 'profile-helper'
      helper.append(
        text('span', 'Helper off.'),
        action('Turn on', { action: 'helper-on', profile: profile.name }),
      )
      row.append(helper)
    }
    if (deleting === profile.name) {
      const confirmation = document.createElement('section')
      confirmation.className = 'profile-delete-confirmation'
      confirmation.append(
        text(
          'p',
          profile.shared
            ? `Delete “${label}” for every workspace? It is on in ${(profile.onIn ?? []).join(', ') || 'no workspaces'}. This removes its Chrome data, sign-ins and history. This cannot be undone.`
            : `Delete “${label}”? This removes its browsing data, cookies, sign-ins and profile downloads. Agents can no longer use it.`,
        ),
      )
      const cancel = focusKey(text('button', 'Cancel'), `cancel-delete:${profile.name}`)
      cancel.disabled = deletionPending
      cancel.addEventListener('click', () => {
        if (deletionPending) return
        deleting = null
        deletionError = ''
        redraw()
      })
      const confirm = focusKey(
        text(
          'button',
          deletionPending ? 'Deleting…' : deletionError ? 'Try again' : 'Delete profile',
        ),
        `confirm-delete:${profile.name}`,
      )
      confirm.className = 'danger'
      confirm.disabled = deletionPending
      confirm.addEventListener(
        'click',
        () => void confirmDelete(profile.name, profile.deleteConfirmation, profile.shared === true),
      )
      confirmation.append(cancel, confirm)
      if (deletionError) confirmation.append(text('p', deletionError))
      row.append(confirmation)
    }
    if (details.childElementCount) row.append(details)
    profiles.append(row)
  }
  if (snapshot.profiles.length === 0) {
    const empty = text('p', 'No profiles yet. Create one to get started.')
    empty.className = 'profiles-empty'
    profiles.append(empty)
  }
  // Without preventScroll, every refresh would scroll the page back to the focused control.
  if (focused) refocus(focused)
  if (caret && document.activeElement === renaming?.input)
    renaming.input.setSelectionRange(...caret)
  window.settingsLoadState.ready()
}
// Redraws go through here, so none lands in the middle of a composition.
function redraw() {
  show(heldSnapshot ?? lastSnapshot)
}
function show(snapshot) {
  heldSnapshot = composing ? snapshot : null
  if (composing) return
  try {
    draw(snapshot)
  } catch {
    window.settingsLoadState.fail()
  }
}
async function refresh() {
  try {
    const snapshot = await rpc('read', { surface: 'chrome' })
    if (!closed) show(snapshot)
  } catch {
    window.settingsLoadState.fail()
  }
}
document.querySelector('#create').addEventListener('submit', (event) => {
  event.preventDefault()
  const input = document.querySelector('#name')
  if (input.checkValidity())
    void propose({ action: 'create-profile', profile: input.value }, () => {
      input.value = ''
    })
})
const timer = setInterval(() => {
  if (!closed && !composing && pending.size === 0) void refresh()
}, 1500)
window.addEventListener('pagehide', () => {
  closed = true
  clearInterval(timer)
  for (const p of pending.values()) {
    clearTimeout(p.timer)
    p.reject(new Error('closed'))
  }
  pending.clear()
})
void refresh()
