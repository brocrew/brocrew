# Updates

Downloadable release builds check for updates shortly after launch and once a day when **Check automatically** is on. Stable checks ask `https://brocrew.app/update/` for release information. The request includes the installed app version. The requested file identifies Mac or Windows. The app sends no user or installation ID, cookies, account details, files, projects or conversations with these requests. As with any internet connection, the server receives the connection’s IP address.

If brocrew.app times out, returns a server error, or cannot be reached, that check uses GitHub instead. An invalid release file is refused rather than treated as an outage. Beta checks continue to use GitHub directly.

Turn off **Check automatically** in the menu that opens when you press the workspace name at the bottom of the left rail. With it off, the app sends no update requests to brocrew.app. Manual **Check** and **Download** still work through GitHub, including for an update offered before you turned the switch off.

Nothing downloads or installs until you choose it. After a stable check that used brocrew.app, the download starts there too; the service redirects it to the release file on GitHub. The installed app version is the only query parameter the app adds to requests to brocrew.app. The existing SHA-512 download checks and Windows installer signature checks remain in place. A failed download check prevents installation.

On Windows, BroCrew installs when you choose to restart, once nothing is running. On Mac, **Download** fetches and checks the disk image, then opens it for you to drag into Applications after you quit BroCrew. BroCrew run from source never checks; update it with `git pull`.
