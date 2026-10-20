# Changes from the copied code

## whatsapp-mcp bridge (Go)

- **SQLite** is `modernc.org/sqlite` (pure Go) instead of `mattn/go-sqlite3`, so the bridge builds without cgo. whatsmeow takes the driver name `sqlite`.
- **Paths:** the session and the message store live in the folder the server names, inside the plugin's private root. Nothing is written elsewhere; the process umask is 077.
- **The REST API** is replaced. The server passes a per-run token on standard input, and every route needs it as a bearer token; requests with an Origin are refused. Bodies are bounded JSON with only known fields. The bridge exits when its standard input closes.
- **Pairing:** the QR code is no longer printed to a terminal. The rotating code is turned into a module pattern for the settings page to draw, and is never logged or written to disk. A code that runs out is reported, and a new one is shown on request.
- **Log out:** whatsmeow's Logout, which asks WhatsApp to remove this linked device; a bridge that is reconnecting connects first. After a log out, or when the phone removes the device, the bridge exits with code 3 and the server deletes the session, the messages and the downloads; a marker file makes the next start finish a log out the app quit during. A failed first connection keeps retrying (`InitialAutoReconnect`).
- **Sending:** only to a group the account is in, named by the server after checking the person's choices. No sending to a person, no voice notes (`analyzeOggOpus` is not ported), no drafts.
- **Files to send** are opened without following links, must be in the plugin's files folder, have one name, keep the size and SHA-256 the server measured, and have a type read from their bytes. What is uploaded is checked to be what was measured.
- **Own sends** are stored, since WhatsApp does not echo them back, and marked as sent for an agent.
- **Stored messages** are upserted, not replaced, so a later copy keeps what was recorded.
- **Media download** is bounded (25 MB) for photos and PDFs only. The type comes from the bytes. The file is written exclusively in the plugin's downloads folder, and a photo also comes back as a re-encoded preview without its metadata.
- **Queries** that the Python server ran on the SQLite file directly are now bridge routes; the server never opens the database. Searches escape `%` and `_`.
- **Not ported:** the terminal QR, the voice-note analysis, broadcast and newsletter chats.

## whatsapp-mcp server (Python)

Rewritten as the Node server's tools: `list_chats`, `read_messages`, `search_messages`, `search_contacts`, `get_media`, `list_groups` and `send_to_group`. Direct sends to a person, `send_audio_message` and `download_media` are not ported.

## Source project's additions

- **Group sending limits** (five per group in ten minutes, twenty an hour, the same message once an hour) and the 🤖 start of each message, from its Python group tools, now in the Node server. The allowlist is the person's "Can write" switches instead of labels.
- **File typing and archive checks** (`sniff.go`, `archive.go`) are copied with their tests. The largest document is 100 MB instead of 2 GB.
- **The bridge's own limiter** (forty an hour, two seconds apart) and bounded media transport are copied.
- **Not ported:** drafts, the security code sent to another messenger, the notify-me tool, its panels, its container build.
