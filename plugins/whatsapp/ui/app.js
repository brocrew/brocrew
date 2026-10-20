const channel = 'brocrew-plugin-ui:v1'
const pending = new Map()
let revision = 0
let next = 0
let closed = false
let drawnCode = ''
let drawnGroups = ''
let groups = []
let refreshingGroups = false
let confirming = null
const $ = (id) => document.querySelector('#' + id)
const status = $('status')
const UNAVAILABLE = 'Plugin unavailable. Try again.'
function rpc(method, payload) {
  if (pending.size >= 4 || closed) return Promise.reject(new Error('busy'))
  const requestId = String(++next)
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('timeout'))
    }, 10000)
    pending.set(requestId, { resolve, reject, timer })
    window.postMessage(
      { channel, requestId, method, payload, configRevision: revision },
      location.origin,
    )
  })
}
window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== location.origin) return
  const packet = event.data
  if (!packet || packet.channel !== channel || typeof packet.ok !== 'boolean') return
  const request = pending.get(packet.requestId)
  if (!request) return
  clearTimeout(request.timer)
  pending.delete(packet.requestId)
  if (!packet.ok) request.reject(new Error('unavailable'))
  else request.resolve(packet.data)
})
async function propose(payload) {
  try {
    await rpc('proposeConfig', payload)
    await refresh()
  } catch {
    status.textContent = UNAVAILABLE
  }
}
function show(id, visible) {
  $(id).hidden = !visible
}
function drawCode(qr) {
  if (qr.bits === drawnCode) return
  drawnCode = qr.bits
  const canvas = $('code'),
    scale = 6,
    quiet = 4,
    side = (qr.size + quiet * 2) * scale
  canvas.width = side
  canvas.height = side
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, side, side)
  context.fillStyle = '#000000'
  for (let y = 0; y < qr.size; y++)
    for (let x = 0; x < qr.size; x++)
      if (qr.bits[y * qr.size + x] === '1')
        context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale)
}
function endConfirming() {
  clearTimeout(confirming)
  confirming = null
  show('unlink-question', false)
  show('unlink-confirmed', false)
}
function drawLink(state, snapshot) {
  const linked = state === 'linked' || state === 'connecting'
  status.textContent =
    state === 'linked'
      ? 'Linked.'
      : state === 'unlinked' || state === 'pairing'
        ? 'Not linked.'
        : state === 'unavailable'
          ? UNAVAILABLE
          : 'Connecting…'
  $('account').textContent = state === 'linked' ? snapshot.status.account : ''
  show('account', state === 'linked' && snapshot.status.account !== '')
  const qr = state === 'pairing' ? snapshot.status.qr : null
  if (qr) drawCode(qr)
  else drawnCode = ''
  show('pairing', qr !== null)
  show('expired', state === 'unlinked' && snapshot.status.expired)
  show('remove-on-phone', snapshot.status.removeOnPhone === true)
  show('link-phone', state === 'unlinked' && !snapshot.status.expired)
  show('new-code', state === 'unlinked' && snapshot.status.expired)
  show('unlink', linked && confirming === null)
  if (!linked && confirming !== null) endConfirming()
}
function drawSwitch(id, value) {
  const input = $(id)
  input.disabled = false
  input.checked = value
}
function drawGroups() {
  const query = $('group-filter').value.trim().toLowerCase()
  const shown = groups
    .filter((group) => group.name.toLowerCase().includes(query))
    .sort(
      (a, b) =>
        Number(b.canWrite) - Number(a.canWrite) ||
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
        a.jid.localeCompare(b.jid),
    )
  const key = JSON.stringify(shown)
  if (key === drawnGroups) return
  drawnGroups = key
  const list = $('groups')
  list.replaceChildren()
  for (const group of shown) {
    const item = document.createElement('li')
    const name = document.createElement('span')
    name.className = 'group-name'
    name.textContent = group.name
    const label = document.createElement('label')
    label.className = 'switch'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.setAttribute('role', 'switch')
    input.checked = group.canWrite
    input.addEventListener('change', () => {
      // Redraw from what the plugin saved, whether or not the change went through.
      drawnGroups = ''
      void propose({ action: 'set-group-write', group: group.jid, enabled: input.checked })
    })
    label.append(input, ' Can write')
    item.append(name, label)
    list.append(item)
  }
  if (groups.length === 0) {
    const empty = document.createElement('li')
    empty.className = 'empty'
    empty.textContent = 'No groups yet.'
    list.append(empty)
  }
}
function draw(snapshot) {
  if (
    !snapshot ||
    !Number.isSafeInteger(snapshot.configRevision) ||
    !snapshot.status ||
    typeof snapshot.status.state !== 'string' ||
    typeof snapshot.read !== 'boolean' ||
    typeof snapshot.prefix !== 'boolean' ||
    !Array.isArray(snapshot.groups)
  )
    throw new Error('invalid')
  revision = snapshot.configRevision
  drawLink(snapshot.status.state, snapshot)
  drawSwitch('read', snapshot.read)
  drawSwitch('prefix', snapshot.prefix)
  groups = snapshot.groups.slice(0, 1024)
  drawGroups()
}
async function refresh() {
  try {
    draw(await rpc('read', { surface: 'whatsapp' }))
  } catch {
    status.textContent = UNAVAILABLE
  }
}
$('group-filter').addEventListener('input', drawGroups)
$('refresh-groups').addEventListener('click', async () => {
  if (refreshingGroups) return
  refreshingGroups = true
  const button = $('refresh-groups')
  button.disabled = true
  button.textContent = 'Refreshing…'
  try {
    await rpc('proposeConfig', { action: 'refresh-groups' })
    await refresh()
  } catch {
    status.textContent = UNAVAILABLE
  } finally {
    refreshingGroups = false
    button.disabled = false
    button.textContent = 'Refresh'
  }
})
$('link-phone').addEventListener('click', () => propose({ action: 'link-phone' }))
$('new-code').addEventListener('click', () => propose({ action: 'link-phone' }))
$('unlink').addEventListener('click', (event) => {
  event.stopPropagation()
  show('unlink', false)
  show('unlink-question', true)
  show('unlink-confirmed', true)
  confirming = setTimeout(() => {
    endConfirming()
    void refresh()
  }, 10000)
})
$('unlink-confirmed').addEventListener('click', (event) => {
  event.stopPropagation()
  endConfirming()
  void propose({ action: 'unlink-phone' })
})
document.addEventListener('click', () => {
  if (confirming !== null) {
    endConfirming()
    void refresh()
  }
})
$('read').addEventListener('change', (event) =>
  propose({ action: 'set-read', enabled: event.target.checked }),
)
$('prefix').addEventListener('change', (event) =>
  propose({ action: 'set-prefix', enabled: event.target.checked }),
)
const timer = setInterval(() => {
  if (!closed && pending.size === 0) void refresh()
}, 1500)
window.addEventListener('pagehide', () => {
  closed = true
  clearInterval(timer)
  clearTimeout(confirming)
  for (const p of pending.values()) {
    clearTimeout(p.timer)
    p.reject(new Error('closed'))
  }
  pending.clear()
})
void refresh()
