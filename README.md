<p align="center"><img src="docs/images/logo.png" alt="BroCrew's logo: a small white robot on a navy tile" width="128"></p>

# BroCrew

**An open-source desktop app where AI agents hand work to each other — and you decide how much they do on their own.**

> **Alpha.** BroCrew is early, so expect rough edges. Your agents, conversations and settings live in one folder on your machine: `~/Library/Application Support/@brobot2/desktop/` on a Mac, and `%APPDATA%\@brobot2\desktop` on Windows. The downloaded app and a copy run from source use this same folder, so run only one of them at a time ([details](docs/data-folder.md)). Before an update changes how your conversations are stored, BroCrew saves a checked copy of them. If you then go back to an older version, it won't open the newer data. It says so, and offers to restore that copy to read your history, with agents stopped. Your newer data is kept, so you can return to it.

BroCrew runs a small team of AI agents on your own machine, using your own Anthropic and OpenAI API keys. You give one agent a task, and it can hand pieces of it to other agents. Each agent keeps its own memory and standing rules across sessions, and agents ask you before going further than their provider's permission system allows on its own (see [Safety](#safety)). It's built for any kind of project, not just code.

![BroCrew's window: the agent Glint asks permission to run a build, after handing parts of a notes app to two other agents, Loom on Codex and Pebble on Claude.](docs/images/conversation.png)

## Install

You can download a ready-made build, or run BroCrew from source. Both give you the same app.

### Download

Get the latest build from the [Releases page](https://github.com/brocrew/brocrew/releases/latest):

| Your computer                        | File                              |
| ------------------------------------ | --------------------------------- |
| Mac with Apple Silicon (M1 or later) | `BroCrew-<version>-arm64.dmg`     |
| Windows 10 or 11, 64-bit (beta)      | `BroCrew-Setup-<version>-x64.exe` |

There's no Linux or Intel Mac build yet.

**The builds aren't signed yet,** because signing needs a paid Apple or Microsoft certificate. So the first time you open BroCrew, your computer warns you; the steps below get you past that once. Download BroCrew only from this repo's Releases page. Each file's SHA-256 checksum is shown next to it there, if you want to check your download. If you'd rather not run an unsigned app at all, run BroCrew from source instead (below).

**On a Mac** (these steps are for macOS 15 Sequoia or later):

1. Open the `.dmg` and drag **BroCrew** into **Applications**.
2. Open BroCrew from Applications. macOS says it can't verify the app: click **Done**, not Move to Trash.
3. Open **System Settings → Privacy & Security**, scroll down to **Security**, and click **Open Anyway** next to the line about BroCrew. Enter your password, then click **Open Anyway** once more. From then on, BroCrew opens normally.
4. If macOS says instead that BroCrew "is damaged and can't be opened", it couldn't check the app's signature. If you downloaded it from this repo's Releases page, clear the download flag in Terminal, then open it again:

   ```bash
   xattr -dr com.apple.quarantine /Applications/BroCrew.app
   ```

On macOS 14 or earlier, you can also right-click the app, choose **Open**, then **Open** again.

**On Windows** (beta):

1. If your browser says the file isn't commonly downloaded, choose **Keep**.
2. Open the installer. Windows shows **"Windows protected your PC"**: click **More info**, then **Run anyway**.
3. Choose **Only for me**, so no administrator is needed, and finish the install.
4. Open **BroCrew** from the Start menu. The first start takes a little longer.

We recommend installing [Git for Windows](https://git-scm.com/download/win) first, with its default options: Claude runs its commands best in Git Bash.

More detail, including uninstalling: [Mac](docs/install-macos.md) · [Windows](docs/install-windows.md).

**Updates.** The downloadable BroCrew checks GitHub for a newer version when it starts and once a day. GitHub sees your IP address and whether it is a Windows or a Mac BroCrew, and nothing else. Turn it off with **Check automatically**, in the menu that opens when you press the workspace name at the bottom of the left rail. On Windows BroCrew installs an update when you choose to restart, once nothing is running. On the Mac, when you choose **Download**, it fetches the new version, checks it, and opens it for you to drag into Applications after you quit BroCrew. BroCrew run from source never checks; update it with `git pull`.

### Run from source (encouraged)

If you're comfortable with a terminal, we encourage running BroCrew from source. You can read exactly what runs on your machine, you get the newest changes first, and there's no unsigned-app warning to get past. It's also how BroCrew is developed every day.

**You need** Node 24 and Git. Tested on Macs with Apple Silicon; on Windows it should work the same way, and if it doesn't, please open an issue.

On a Mac:

```bash
git clone https://github.com/brocrew/brocrew
cd brocrew
nvm install        # Node 24, from .nvmrc (or install Node 24 another way)
corepack enable    # pnpm, the version the project pins
pnpm install
pnpm start         # builds BroCrew, then opens it
```

On Windows, in PowerShell, with Node 24 installed from [nodejs.org](https://nodejs.org) or nvm-windows:

```powershell
git clone https://github.com/brocrew/brocrew
cd brocrew
corepack enable
pnpm install
pnpm start
```

To update a copy run from source: `git pull`, `pnpm install`, then `pnpm start` again.

### First steps

1. **Using a downloaded BroCrew? Install Claude Code first** to use Claude, from Anthropic: see their [install guide](https://code.claude.com/docs/en/setup). BroCrew gives it your API key. If Claude Code is missing, or older than the versions BroCrew was tested with, BroCrew tells you and shows how to install or update it. Running from source, you can skip this step: it uses the Claude Code that comes with Anthropic's SDK. Codex comes with BroCrew either way.
2. Open BroCrew. If a setup window opens, follow it until it asks you to sign in, then choose **Use an API key instead**, which takes you to the **Providers** tab in **Settings**. Otherwise, open **Settings** in the left rail; **Providers** is its first tab.
3. On the **Claude** card, paste your Anthropic key under **API key** ([get one here](https://platform.claude.com/settings/keys)) and save it. On the **Codex** card, do the same with an OpenAI key ([get one here](https://platform.openai.com/api-keys)). You need only one to start.
4. Choose **New conversation** in the left rail, pick a Claude or Codex model, and type what you want done. It works in BroCrew's own workspace folder. To give an agent a folder of your own, open it on the **Team** page, choose **New conversation…**, then **Choose a folder…**.

BroCrew keeps each key encrypted on your machine: on a Mac with a key held in your Keychain, and on Windows tied to your Windows account. Your Mac may ask whether BroCrew may use its Keychain entry, "@brobot2/desktop Safe Storage": enter your Mac password and choose **Always Allow**. Expect it again after each update: the Mac app isn't signed with an Apple certificate yet, so macOS treats each version as a new app. If you don't allow it, BroCrew can't read the saved key and tells you so: save the key again under **API key** on that provider's card, in **Settings → Providers**.

## How it works

- **Work is a tree, not a thread.** Every request becomes a labelled piece of work with an owner. An agent can hand part of it to another agent, which shows up as a child piece: you can watch one request become several agents' work, and trace any result back to what asked for it.
- **Agents remember.** Each agent keeps its own memory and standing rules across sessions, so it doesn't start from nothing every time you talk to it.
- **You stay in charge.** Agents ask you before going further than their provider's permission system allows on its own. [Safety](#safety), below, says exactly what that means for Claude and for Codex.
- **Any project, either provider.** The same app that hands out a coding task can hand out any other kind, and an agent in that same window can run on Claude or on Codex.

## Safety

BroCrew doesn't sandbox its agents itself. What an agent may do is decided by Claude's or Codex's own permission system, the same one you'd get running their command-line tools directly:

- **Claude**, in the default "ask" mode, asks you before each new kind of action, such as running a command or changing a file.
- **Codex**, in the default "ask" mode, works the way Codex itself does by default: it runs commands inside its own sandbox without asking you, and asks before anything past that. Inside the sandbox, commands can read anything your account can, change files only in the conversation's folder and temporary folders, and have no network access.
- **"Auto" mode**, which you turn on per conversation, switches the approvals off, and Codex then runs without its sandbox. It's a deliberate choice you make, never the default.

One rule BroCrew enforces itself: when an agent starts another agent, the new one runs in the starter's mode, so an agent in "ask" mode can't start one in "auto" mode.

Agents run with your user account's permissions. A command an agent runs can read anything your account can: your files, and credentials stored for your account, such as other apps' saved logins and keys. So approve commands the way you would in your own terminal.

**BroCrew can start turns by itself.** A job an agent scheduled, work one agent hands another, a reminder to an agent that stopped with work still open, or a turn picked up again after a restart, or after Claude Code or Codex stopped in the middle of one: each is a turn you didn't type, and your provider bills it like any other. BroCrew never picks up again a turn that was stopped, and sends no reminders to a conversation you stopped until you write to it again.

**Your API keys.** On a Mac, BroCrew hands your Anthropic key to Claude without putting it anywhere an agent's commands can see. On Windows the key is in the Claude CLI's own environment: the CLI keeps it out of the commands it runs, but a command running as you could still read it from there. Codex keeps your OpenAI key in a file in BroCrew's data folder, readable by your user account, so any command an agent runs could read it, even one Codex runs in its sandbox without asking you.

## Requirements and cost

- A Mac with Apple Silicon (download or source), or Windows 10 or 11, 64-bit (download, beta). No Linux yet. The downloads aren't signed yet; see [Install](#install).
- To run from source: Node 24 and Git.
- To use Claude in a downloaded BroCrew: [Claude Code](https://code.claude.com/docs/en/setup), installed from Anthropic. Running from source includes it.
- An Anthropic API key, an OpenAI API key, or both. BroCrew doesn't bill you; you pay each provider directly, at their own rates, and you can watch your usage on their own dashboards. Heavy use can add up, and BroCrew has no spending cap of its own yet.

## Providers

- **Claude**, through Anthropic's Claude Agent SDK and Claude Code, with your Anthropic API key. A downloaded BroCrew uses the Claude Code you install; run from source, it uses the one that comes with the SDK.
- **Codex**, through the bundled Codex app server, with your OpenAI API key.

Either way, you bring your own key and pay the provider directly. BroCrew has no servers of its own. It contacts GitHub, to check for updates, and Anthropic or OpenAI when you press **Check it works** on a key. The Claude Code and Codex programs it runs talk to their own providers.

## License

BroCrew is licensed under [Apache-2.0](LICENSE).

The downloadable builds also include the Codex CLI, Anthropic's Claude Agent SDK library and other components, each under its own license or terms. The Claude Agent SDK isn't open source: its use is subject to Anthropic's terms. Claude Code isn't included in the downloads; you install it from Anthropic. Running from source, `pnpm install` fetches these components, Claude Code included, from npm under their own terms. See [THIRD-PARTY-NOTICES.md](apps/desktop/THIRD-PARTY-NOTICES.md) for all of them.

OpenAI and the OpenAI logo are trademarks of OpenAI. They are not covered by this project's licence.

## Contributing

BroCrew has only just been released as open source. Issues and pull requests are welcome. Since it's so new, please open an issue before a large pull request, so the approach can be discussed first. Working on BroCrew itself? See [docs/development.md](docs/development.md).
