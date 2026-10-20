# Plugins in conversation instructions

The real plugin controller is one composition-root object, passed to Settings
registration and RuntimeHost. Until it exists, the tab is hidden and instructions
contain no Plugins section. Test catalogues/controllers are explicitly fictional;
no demo is shipped.

Its synchronous `instructionCatalogue()` returns one row per catalogue plugin:
ID, the Plugins-page display name when one exists, signed one-line purpose, current state, broker tool availability (`all agents`
or `none`) and current service name or null. It reads the controller's current
verified snapshot; prompt composition performs no network, install, launch or
provider-home operation. It lists no tool names. Catalogue release selection and
state/broker readings remain the lifecycle controller's responsibility.

The section is per conversation, after Saved methods when that section exists;
it is never written into the shared profile instructions file. Both providers
use the existing conversation composer. The fixed guidance/trust overhead is
under 60 words, plus one line per plugin.

At each ordinary framed turn the host re-reads the snapshot and sends a changed
section only if its text changed. The accepted turn's record commits the marker;
a rejected send does not consume it. An uninstall can therefore return a plugin
to Available on the next turn, including when that equals its launch state.
A cold reopen and a compaction reassert current metadata, because launch-lead
history alone cannot account for live updates. The provider's verbatim commands
and compaction requests retain their existing path; metadata is owed to the next
ordinary framed turn. Updates use the existing replacement-section heading.

The signed Release now permits optional `description` (one nonempty line, ≤240 characters). Legacy catalogue entries still verify. Curators provide this field for agent suggestions; Chrome’s approved catalogue copy is kept in `plugins/chrome/catalogue-metadata.json`. No display name is duplicated into the wire schema.

Older releases without a description still get their state line. No purpose is invented, and one legacy entry does not suppress the rest of the catalogue.
