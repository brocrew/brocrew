# Run from source (encouraged)

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
