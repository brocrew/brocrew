# Settings → Plugins (slice 12b)

`SettingsScreen` includes Plugins only when its injected client exists or the
fixed main IPC availability check confirms a real lifecycle controller. The
shipped registration has no controller until slices 9–10 attach one, so it
exposes no fictional catalogue or broken tab. Direct calls without a controller
return the approved unavailable words. Test and look fixtures inject fakes.

`registerPluginSettings` checks the owning main frame and accepts list selection,
package inspection and ordinary install/update actions. A package URL or local
path can be selected directly; details show its authors and permissions before
Install or Update. The selected byte reference travels through the preload and
person-control protocol without a preparation token or a shared source list.
The [production source contract](../contracts/plugin-production.md) describes
references, list formats and offline archives.

Configure asks the controller for its verified package and current own-peer
binding, then opens the host as a native child view at the measured Settings
placeholder. Bounds must fit the owning window. Changing screens, navigation,
renderer loss and window close revoke its generation and tear it down. Delayed
reads cannot attach a screen after close. Each opening has its own screen ID,
so an old screen's destruction cannot clear a newer screen's renderer state.
Uninstall closes the view and invokes the separate global lifecycle operation.

The package page proposes actions through the existing host, never committing
configuration itself. The controller's BroCrew-owned proposal callback remains
responsible for person confirmation and revision-checked Apply. This slice starts
no supervisor, Node host or Chrome and performs no real install/admin mutation.

Chrome UI files and the manifest template come from `6f9aa9213`. Only the page's
reply decoder changes to the reviewed host's `ok/data` and `ok:false/error` shape.
The later screen-look correction keeps the approved words and RPC/actions, groups tabs within their profile card using text nodes, and adds a neutral light/dark palette with BroCrew’s font stack, rounded controls and cards. No theme bridge is added; the isolated page follows the OS colour scheme. `plugins/chrome/UI-PROVENANCE.json` pins the
source/destination digests. The offline smoke helper rebuilds the reviewed
archive, preserves its server/runtime bytes, updates file digests and manifest,
and verifies it using an in-memory fictional catalogue key. It publishes neither
a catalogue nor a production signature. The handback records the final archive
SHA256 and source commit; no binary is added to the repository.

The fixture uses birch/fir profiles and fictional example.invalid tabs. Browser
controls measure painted text in catalogue/configuration states across eight
themes at 1180/760. The separate real-Electron fixture exercises Settings,
preload, main registration, verified Chrome assets, own-peer reads, install and
uninstall fakes, and destruction. Chrome's own flat system-colour surfaces are
measured separately in that isolated view. Captures include the main Settings
page/card and the native plugin-page crop; Electron captures child views
separately. The fixture sizes its container at both widths without changing the
application's existing global minimum-width policy.
