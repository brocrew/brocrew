# Safety

BroCrew doesn't sandbox its agents itself. What an agent may do is decided by Claude's or Codex's own permission system, the same one you'd get running their command-line tools directly:

- **Claude**, in the default "ask" mode, asks you before each new kind of action, such as running a command or changing a file.
- **Codex**, in the default "ask" mode, works the way Codex itself does by default: it runs commands inside its own sandbox without asking you, and asks before anything past that. Inside the sandbox, commands can read anything your account can, change files only in the conversation's folder and temporary folders, and have no network access.
- **"Auto" mode**, which you turn on per conversation, switches the approvals off, and Codex then runs without its sandbox. It's a deliberate choice you make, never the default.

One rule BroCrew enforces itself: when an agent starts another agent, the new one runs in the starter's mode, so an agent in "ask" mode can't start one in "auto" mode.

Agents run with your user account's permissions. A command an agent runs can read anything your account can: your files, and credentials stored for your account, such as other apps' saved logins and keys. So approve commands the way you would in your own terminal.

**BroCrew can start turns by itself.** A job an agent scheduled, work one agent hands another, a reminder to an agent that stopped with work still open, or a turn picked up again after a restart, or after Claude Code or Codex stopped in the middle of one: each is a turn you didn't type, and your provider bills it like any other. BroCrew never picks up again a turn that was stopped, and sends no reminders to a conversation you stopped until you write to it again.

Plugins run with your computer user’s rights; they are not sandboxed. Install only plugins you trust.

**Your API keys.** On a Mac, BroCrew hands your Anthropic key to Claude without putting it anywhere an agent's commands can see. On Windows the key is in the Claude CLI's own environment: the CLI keeps it out of the commands it runs, but a command running as you could still read it from there. Codex keeps your OpenAI key in a file in BroCrew's data folder, readable by your user account, so any command an agent runs could read it, even one Codex runs in its sandbox without asking you.
