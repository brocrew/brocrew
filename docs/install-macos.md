# Installing BroCrew on the Mac

BroCrew is signed "ad hoc" but not by a registered Apple developer, so macOS can't check it for malware and blocks it the first time you open it. These steps get you past that once, and set up your API keys.

## Before you install

- **A Mac with Apple silicon** (M1 or later). Intel Macs are not supported.
- **macOS 15 (Sequoia) or later.** The steps below are for these versions.
- **Claude Code, to use Claude agents.** Install Claude Code first, from Anthropic: <https://code.claude.com/docs/en/setup>. BroCrew does not include it: it runs the Claude Code installed on your Mac. Codex comes with BroCrew.
- **An API key for each agent you want to use:**
  - Claude: an Anthropic API key, from <https://platform.claude.com/settings/keys>.
  - Codex: an OpenAI API key, from <https://platform.openai.com/api-keys>.

  What the agents do is billed to the account the key belongs to. See [API keys](api-keys.md).

## Install

1. Download `BroCrew-….dmg` from the latest release on the repository's **Releases** page.
2. Open it, and drag **BroCrew** into the **Applications** folder.
3. Open **BroCrew** from Applications. macOS says it could not verify BroCrew. Choose **Done**.
4. Within the hour, open **System Settings → Privacy & Security** and scroll down to **Security**. Next to the line about BroCrew, choose **Open Anyway**. Confirm with your password or Touch ID, then choose **Open Anyway** once more.

macOS remembers this, so BroCrew opens normally from then on.

- On macOS 15 and later, right-click → Open no longer gets past this. Use Privacy & Security as above.
- **Open Anyway** shows for about an hour after macOS blocked BroCrew. If it isn't there, open BroCrew again from Applications, then go back to Privacy & Security.
- On a standard (non-administrator) account, macOS asks for an administrator's name and password.
- On a Mac your company manages, **Open Anyway** may not be offered at all. Ask whoever manages the Mac.

### If macOS says BroCrew "is damaged"

This should not happen with this build. If it does, open **Terminal** and run:

```
xattr -dr com.apple.quarantine /Applications/BroCrew.app
```

Then open BroCrew again. This removes the mark macOS puts on files downloaded from the internet, for BroCrew only.

## Add your API keys

1. In BroCrew, open **Settings** in the left rail, then **Providers**. If the setup window opens first, choose **Use an API key instead** to reach the same tab.
2. On the **Claude** card, paste your Anthropic key under **API key** and press **Save key**.
3. On the **Codex** card, do the same with your OpenAI key.
4. Press **Check it works** on each card. Claude's check sends one short message, which costs a tiny amount; Codex's model-list check costs nothing.

BroCrew seals each key it saves with a key kept in your Mac's Keychain. To change a key, save the new one in the same place. To stop using a key, remove it there.

**The Keychain may ask** whether BroCrew may use "@brobot2/desktop Safe Storage". On your own Mac, enter your login password and choose **Always Allow**: that is how BroCrew opens the keys it saved. It may ask again after you update BroCrew, because macOS sees each build as a new app. On someone else's Mac, choose **Deny**.

## Your first conversation

Choose **New conversation** in the left rail, pick a Claude or Codex model, and type what you want done. It works in BroCrew's own workspace folder. To give an agent a folder of your own, open it on the **Team** page, choose **New conversation…**, then **Choose a folder…**.

## Where your data is

BroCrew keeps your conversations, settings and saved keys in `~/Library/Application Support/@brobot2/desktop`.

**A BroCrew you run from source code on the same Mac uses the same folder.** They share your conversations, settings and keys, and only one of them runs at a time. See [Where BroCrew keeps its data](data-folder.md).

## Running from source instead

You can also run BroCrew from its source code, with no download to approve. See the repository's README. A BroCrew run from source never checks for updates; update it with `git pull`.

## Updating and removing

- **Updates.** Stable automatic checks use brocrew.app, with GitHub as a fallback if the service cannot be reached. The request includes the installed app version; the requested file identifies Mac or Windows. Turn off **Check automatically** to send no update requests to brocrew.app. Manual checks and downloads then use GitHub. See [Updates](updates.md) for the request details and installation steps.
  - When there is a new version, BroCrew downloads it, checks it against the SHA-512 checksum the release publishes (fetched over HTTPS), and opens it for you. Quit every BroCrew, then drag the new one into Applications, replacing the old one.
  - **An update BroCrew downloads opens without the Gatekeeper prompt.** macOS asks about apps a browser downloaded; BroCrew downloads its own update, and trusts it because the checksum matches. A `.dmg` you download yourself from the Releases page needs **Open Anyway** once more, as above.
- **If you had BroBot or BroBot2** (the beta's earlier names) in Applications, move it to the Trash once BroCrew works, and take it out of the Dock if you kept it there. They use the same data, and an old copy opened by mistake would run old code on it.
- **To remove BroCrew**, drag it from Applications to the Trash. Your conversations and settings stay in `~/Library/Application Support/@brobot2/desktop`. Delete that folder too if you want nothing left behind.

## If something goes wrong

- **"No Anthropic API key is set"**: the Claude card in Providers has no key yet. Add it as above.
- **"BroCrew found no Claude Code where its installers put it"**: install Claude Code as above, then start the conversation again.
- **A key was refused**: press **Check it works** under **API key** on that card, and replace the key if the provider refuses it. See [API keys](api-keys.md#if-a-key-stops-working).
- **Anything else**: note what you did and what BroCrew said, and send it to whoever gave you the link.

## More download details

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

[Run from source](run-from-source.md).
