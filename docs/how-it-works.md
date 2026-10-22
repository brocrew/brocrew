# How it works

BroCrew runs a small team of AI agents on your own machine, using your own Anthropic and OpenAI API keys. You give one agent a task, and it can hand pieces of it to other agents. Each agent keeps its own memory and standing rules across sessions, and agents ask you before going further than their provider's permission system allows on its own (see [Safety](safety.md)). It's built for any kind of project, not just code.

- **Work is a tree, not a thread.** Every request becomes a labelled piece of work with an owner. An agent can hand part of it to another agent, which shows up as a child piece: you can watch one request become several agents' work, and trace any result back to what asked for it.
- **Agents remember.** Each agent keeps its own memory and standing rules across sessions, so it doesn't start from nothing every time you talk to it.
- **You stay in charge.** Agents ask you before going further than their provider's permission system allows on its own. [Safety](safety.md), below, says exactly what that means for Claude and for Codex.
- **Any project, either provider.** The same app that hands out a coding task can hand out any other kind, and an agent in that same window can run on Claude or on Codex.
