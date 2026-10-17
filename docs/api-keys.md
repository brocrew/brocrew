# API keys

BroCrew runs Claude and Codex agents on API keys you save in it: an Anthropic key for Claude, an OpenAI key for Codex. This page says how to get each key, where to save it, what BroCrew does with it, and what you see if a key stops working.

## Get a key

- **Claude:** create an Anthropic API key at <https://platform.claude.com/settings/keys>.
- **Codex:** create an OpenAI API key at <https://platform.openai.com/api-keys>.

What your agents use is billed to the account the key belongs to, at that provider's standard API rates. BroCrew never pays for, resells or passes on your usage.

## Save it

1. In BroCrew, open **Settings** in the left rail, then **Providers**. If the setup window opens first, choose **Use an API key instead** to reach the same tab.
2. On the **Claude** card, paste your Anthropic key under **API key** and press **Save key**. Do the same on the **Codex** card with your OpenAI key.
3. Press **Check it works**. BroCrew asks the provider for its model list. For Claude, it also sends one short message, which costs a tiny amount; Codex's model-list check costs nothing. BroCrew tells you whether the provider accepted the key.

New conversations start on the key. A conversation that is already running goes on with what it started with until it starts again.

**About Check it works:**
- It runs only when you press it.
- A key restricted to fewer permissions may be refused that one request. The check says so, and that agents may still run on it.
- For Codex, BroCrew first logs its Codex profiles in with the key, and Codex must say it runs on it.
- The answer never contains the key.

## What BroCrew does with your keys

On a Mac, BroCrew hands your Anthropic key to Claude without putting it anywhere an agent's commands can see. On Windows the key is in the Claude CLI's own environment: the CLI keeps it out of the commands it runs, but a command running as you could still read it from there. Codex keeps your OpenAI key in a file in BroCrew's data folder, readable by your user account, so any command an agent runs could read it, even one Codex runs in its sandbox without asking you.

**Where BroCrew keeps them:**
- BroCrew encrypts each key it saves with Electron's `safeStorage`. On macOS the encryption key is kept in your Keychain; on Windows the key is encrypted for your Windows account.
- BroCrew's database holds only the encrypted key and when it was saved. The database alone cannot give a key back.
- The window is never sent a key. It is told only whether one is saved, since when, and whether it is in use.
- No log, error, event or transcript carries a key.
- BroCrew sends a key nowhere but to that provider's own program on your computer, and to the provider when you press **Check it works**.

**How Claude gets its key:**
- **On a Mac,** through a pipe BroCrew opens for each start. The Claude CLI reads the key once, so it is never in an environment, and the agent's shell, hooks and MCP servers never see it.
- **On Windows,** the CLI can't read such a pipe, so BroCrew hands the key over in the CLI's environment, beside a switch Claude Code [documents](https://code.claude.com/docs/en/env-vars) for apps that embed it. With that switch, the CLI removes the key from the environment of everything it runs. A same-user command that reads the CLI's own environment could still find it.

**How Codex gets its key:**
- BroCrew logs each Codex profile in with the key, through Codex's own login. The key reaches Codex on its standard input, never in a command line or an environment.
- Codex then keeps the key in that profile's `auth.json`, in BroCrew's data folder, readable only by your user account. Saving or removing the key logs every Codex profile in or out right away. A profile BroCrew couldn't reach then is brought in line when it next starts.

**What no key setting protects against:** your agents run as you, with your permissions. Give agents a key you are comfortable with them using, and watch what it spends in the provider's dashboard.

## If a key stops working

If the provider refuses a saved key (for example, it was revoked), the conversation says so in plain words:

- **Claude:** *"Anthropic refused the API key this conversation was started with, so it cannot continue on it."* It tells you to press **Check it works** under **API key** on the Claude card, to replace the key if it is refused, and then to send the conversation a message: that starts it again and reads the key afresh.
- **Codex:** *"The API key this conversation was started with was refused, so this conversation cannot run on it."* It tells you to check or replace the key on the Codex card, then to start a new conversation, which runs on the key saved then.

An agent that gave work to the refused one is told that a person needs to check or replace the key.

**If a saved key can no longer be decrypted,** for example after its Keychain entry changed, BroCrew refuses to start that provider's agents and says so.

## Remove a key

Press **Remove** under **API key** on the card.

- **Claude:** new conversations no longer use the key.
- **Codex:** BroCrew logs every Codex profile out of the key.

To stop a key working anywhere, delete it in the provider's dashboard too.
