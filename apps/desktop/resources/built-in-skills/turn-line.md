# Default skill lines on every turn

List each enabled default skill in each turn; restore the list after context shortening. The current app requires eight named entries, so build-a-team remains a short pointer to delegate until the catalogue changes.

Codex list:

```text
delegate — Before handoff: one fitting owner, reusable profile or service, and supported model.
hand-back — Before returning: resolve dependencies, keep evidence and report once.
split-work — Before dividing: bounded pieces, dependencies and integration.
ask-and-wait — When the person must answer or act: track it and name the wait.
remember — Before unfamiliar work or handback: use relevant methods; save tested lessons if allowed.
build-a-team — Before choosing helpers: see delegate.
add-a-capability — When a tool is missing: existing connection first; build only if wanted.
build-software — Before building or file-changing code: owner and checker verify it.
```

Claude plugin list:

```text
brobot:delegate — Before handoff: one fitting owner, reusable profile or service, and supported model.
brobot:hand-back — Before returning: resolve dependencies, keep evidence and report once.
brobot:split-work — Before dividing: bounded pieces, dependencies and integration.
brobot:ask-and-wait — When the person must answer or act: track it and name the wait.
brobot:remember — Before unfamiliar work or handback: use relevant methods; save tested lessons if allowed.
brobot:build-a-team — Before choosing helpers: see delegate.
brobot:add-a-capability — When a tool is missing: existing connection first; build only if wanted.
brobot:build-software — Before building or file-changing code: owner and checker verify it.
```

Offer only skills installed and enabled for the profile. The app gates build-a-team on agent-creation permission and add-a-capability on its applicable role. The provider catalogue supplies descriptions and paths; if it cannot discover a skill, show its full SKILL.md path in the offered line. Show the actual offered list and loaded text in “What this agent receives.” Measure filtered or path-extended lists as sent.

Codex: 660 characters, 676 UTF-8 bytes, 94 words.
Claude: 716 characters, 732 UTF-8 bytes, 94 words.

Sizes include LF endings and a final LF; full skill bodies are not in these reminders.
