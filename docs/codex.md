# Connecting Codex

BroCrew runs Codex agents with the Codex that comes bundled with it. To run them, give BroCrew an OpenAI API key. That is the supported way.

## Add your key

1. Create an API key in your OpenAI dashboard: <https://platform.openai.com/api-keys>.
2. In BroCrew, open **Settings** in the left rail, then **Providers**. If the setup window opens first, choose **Use an API key instead** to reach the same tab.
3. On the **Codex** card, paste the key under **API key** and press **Save key**.
4. Press **Check it works**. BroCrew asks OpenAI for its list of models with the key, which costs nothing, and tells you whether OpenAI accepted it.

New Codex conversations start on the key. A conversation that is already running may go on with what it started with until it starts again.

OpenAI bills what your agents use to the account the key belongs to, at its standard API rates. BroCrew never pays for, resells or passes on your usage.

## Where the key lives

- **In BroCrew's own data:** BroCrew encrypts the key with Electron's `safeStorage`. On macOS the encryption key is kept in your Keychain. BroCrew's database holds only the encrypted key.
- **In each Codex profile:** each agent profile has its own Codex folder in BroCrew's data folder, `~/Library/Application Support/@brobot2/desktop/provider-homes/`. BroCrew logs that folder in with your key through Codex's own login. Codex then keeps the key in that folder's `auth.json`, readable only by your macOS user.

## What BroCrew does with it

- It hands the key to Codex on this Mac, through Codex's own login, and sends it to OpenAI when you press **Check it works**. It sends it nowhere else.
- It never puts the key in a command line, an environment variable, a log, an error or a transcript.
- It never shows the key back to you. The window only knows whether a key is saved, since when, and whether it is in use.

## What it doesn't protect against

Your agents run as you, with your permissions. An agent's shell can read any file your macOS user can read, including the `auth.json` in its profile's folder. Give agents a key you are comfortable with them using. Your OpenAI dashboard shows what it spends.

## If the key stops working

If OpenAI refuses the key, the conversation says *"The API key this conversation was started with was refused"*, and tells you to check or replace it on the Codex card and start a new conversation. See [API keys](api-keys.md#if-a-key-stops-working).

## Removing it

Press **Remove** under **API key** on the Codex card. BroCrew logs every Codex profile out of the key, and new conversations start without it. To stop the key working anywhere, delete it in your OpenAI dashboard too.
