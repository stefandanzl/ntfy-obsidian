# obsidian-ntfy

An [Obsidian](https://obsidian.md) plugin that integrates [ntfy](https://ntfy.sh) push notifications directly into your vault.

## Features

- **Persistent streaming** – uses `fetch()` + `ReadableStream` (JSON stream endpoint) for full header-based auth support. Auto-reconnects on drop.
- **Send & receive** – sidebar chat view per topic; Ctrl+Enter sends.
- **Vault file attachments** – attach `.md` or any vault file; uploaded via ntfy's binary PUT endpoint.
- **File downloads** – attachments from incoming messages download into a configurable vault folder.
- **Per-topic Notice styling** – accent color, duration (0 = persistent until clicked), mute, sound.
- **New declarative Settings API** (Obsidian ≥ 1.13) – `getSettingDefinitions()` with `group`, `list`, `page`, nested dot-notation keys.

---

## Stream Transport: Why JSON-stream over SSE

ntfy offers three stream formats:

| Format | Endpoint | Auth headers | Auto-reconnect |
|---|---|---|---|
| SSE / EventSource | `/sse` | ❌ (no custom headers) | ✅ built-in |
| **JSON stream** | `/json` | ✅ `Authorization:` | manual (implemented) |
| WebSocket | `/ws` | ✅ via subprotocol | manual |

`EventSource` (SSE) cannot send custom headers in browsers/Electron, making token/basic auth impossible without the `?auth=<base64>` query-param workaround (exposes credentials in server logs). The **JSON stream via `fetch()`** approach supports full `Authorization:` headers and requires no additional server-side configuration beyond standard ntfy.

---

## Authentication modes

| Mode | What's sent |
|---|---|
| **None** | No auth header – works for public ntfy.sh topics |
| **Basic** | `Authorization: Basic base64(user:pass)` |
| **Token** | `Authorization: Bearer tk_…` (ntfy access tokens) |

Tokens are generated in the ntfy web UI under **Settings → Access tokens**, or via:
```
ntfy token add --label=obsidian
```

---

## Settings (declarative API)

```
Server
  ├── Server URL           (text)
  ├── Download folder      (folder picker)
  ├── Reconnect delay      (number, ms)
  └── Fetch history since  (text: "all", "1h", "10m", etc.)

Authentication
  ├── Auth mode            (dropdown: none / basic / token)
  ├── Username             (visible only when basic)
  ├── Password             (visible only when basic)
  └── Access token         (visible only when token)

Topics                     (list – add / delete / click to edit)
  └── [TopicModal] per entry:
        name · color · notice duration · mute · sound · enabled
```

Nested keys (`auth.mode`, `auth.username`, etc.) are handled via custom `getControlValue` / `setControlValue` with dot-notation path walking.

---

## Architecture

```
main.ts (NtfyPlugin)
  ├── NtfyStreamClient    – fetch() JSON stream, reconnect, publish, poll, download
  ├── MessageStore        – per-topic in-memory sorted message list + reactive subscriptions
  ├── NotificationService – new Notice() with per-topic color/duration/mute/sound
  ├── NtfyView            – sidebar ItemView (topic select, chat, compose, file chips)
  └── NtfySettingTab      – declarative 1.13 settings (groups, list, dot-notation)
```

---

## Setup

```bash
npm install
npm run build
```

Copy `main.js`, `manifest.json`, `styles/styles.css` to your vault's `.obsidian/plugins/obsidian-ntfy/`.

---

## Roadmap / not yet implemented

- [ ] Message deletion via ntfy `DELETE /<topic>/message/<id>` (removes notification from server, keeps local history)
- [ ] Multiple server profiles
- [ ] External file attachments (outside vault)
- [ ] Priority picker in compose toolbar
- [ ] Tag input in compose
- [ ] Message search / filter in sidebar
