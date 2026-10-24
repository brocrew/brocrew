# Updates

Downloadable release builds check for updates shortly after launch and once a day when **Check automatically** is on. Stable checks ask `https://brocrew.app/update/` for release information. The request includes the installed app version. The requested file identifies Mac or Windows. The app sends no user or installation ID, cookies, account details, files, projects or conversations with these requests. As with any internet connection, the server receives the connection’s IP address.

If a check through brocrew.app times out after 60 seconds, encounters a network error or receives a server error (5xx), that check uses GitHub instead. A client error (4xx) or invalid update information stops the check without a GitHub retry. Beta checks use GitHub directly.

Turn off **Check automatically** in the menu that opens when you press the workspace name at the bottom of the left rail. With it off, the app starts no new update requests to brocrew.app. Manual **Check** and **Download** still work through GitHub, including for an update offered before you turned the switch off.

Nothing downloads or installs until you choose it. With automatic checks on and the stable channel selected, downloads offered through brocrew.app start there. The installed app version is the only query parameter the app adds to requests to brocrew.app. The existing SHA-512 download checks and Windows installer signature checks remain in place. A failed download check prevents installation.

On Windows, BroCrew installs when you choose to restart, once nothing is running. On Mac, **Download** fetches and checks the disk image, then opens it for you to drag into Applications after you quit BroCrew. BroCrew run from source never checks; update it with `git pull`.
