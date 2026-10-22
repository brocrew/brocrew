<p align="center"><img src="docs/images/logo.png" alt="BroCrew's logo: a small white robot on a navy tile" width="128"></p>

# BroCrew

**An open-source desktop app where AI agents hand work to each other — and you decide how much they do on their own.**

[![Latest release](https://img.shields.io/github/v/release/brocrew/brocrew)](https://github.com/brocrew/brocrew/releases/latest) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE) ![Platforms: macOS Apple Silicon and Windows beta](https://img.shields.io/badge/platform-macOS%20Apple%20Silicon%20%C2%B7%20Windows%20beta-lightgrey)

## What it is

BroCrew brings AI agents together on your computer.
Give an agent a task, and it can share the work with other agents.
Each agent keeps its own memory and rules across conversations.
Use it for coding, writing, research or other projects, with your own Claude or Codex account.

![BroCrew's window showing agents working on a project.](docs/images/conversation.png)

## Install

Get the latest build from the [Releases page](https://github.com/brocrew/brocrew/releases/latest):

| Your computer | File |
| --- | --- |
| Mac with Apple Silicon (M1 or later) | `BroCrew-<version>-arm64.dmg` |
| Windows 10 or 11, 64-bit (beta) | `BroCrew-Setup-<version>-x64.exe` |

The downloads aren't signed yet, so your computer will warn you the first time. Follow the [Mac install guide](docs/install-macos.md) or [Windows install guide](docs/install-windows.md) to open the app.

Prefer the terminal? [Run from source](docs/run-from-source.md).

## First steps

- For Claude in the downloaded app, install [Claude Code first](docs/first-steps.md). Codex is included.
- Open **Settings → Providers** and connect Claude or Codex: sign in, or use an API key. See [setup help](docs/first-steps.md).
- Choose **New conversation**, pick a model and type what you want done.

## Learn more

- [How it works](docs/how-it-works.md)
- [Plugins](docs/plugins.md)
- [Safety](docs/safety.md)
- [Requirements and cost](docs/requirements-and-cost.md)
- [Providers](docs/providers.md)
- [Updates](docs/updates.md)
- [Data folder](docs/data-folder.md)
- [Contributing](docs/development.md#contributing)

## License

BroCrew is licensed under [Apache-2.0](LICENSE).
