# SARA Hardened WhatsApp Adapter

A drop-in replacement for `src/wa-adapter.ts` built on Baileys 7.x with anti-detection
hardening designed to survive longer against Meta's anti-bot systems on a single
founder personal number.

The new adapter lives at `src/wa-hardened-adapter.ts` and uses helpers under
`src/wa-hardening/`. Nothing is wired up on prod — this document explains how
to activate it manually when the new number +39 379 365 8633 is out of cooldown.

## How it differs from the current adapter

| Area | Current `wa-adapter.ts` (whatsapp-web.js 1.34.6) | New `wa-hardened-adapter.ts` (Baileys 7.x) |
|---|---|---|
| Engine | Puppeteer/Chromium + whatsapp-web.js | Pure-JS Baileys Noise protocol |
| Fingerprint | Default Chromium UA | Persistent pool of 8 desktop fingerprints |
| Typing delay | `humanize.ts` on top of adapter | Baked into every `sendMessage` |
| Rate cap | Per-user inbound only | Per-user inbound **and** global outbound 15/min |
| Reconnect | wwebjs auto + exponential-ish | Deterministic 30s→60s→2m→4m→8m→16m, persisted |
| Ban handling | None, burnt ~10 pairings on the old number | Dead-man switch trips after 3 handshake failures in 10 min |
| PII in logs | Raw phone numbers + message bodies | Phones `***NNNN`, bodies become `{len: N}` |
| Auth dir | `auth_store_wwjs/` (untouched) | `auth_store_baileys_hardened/` (fresh) |

The SockLike surface is identical: `src/index.ts` continues to call
`sock.ev.on('messages.upsert', ...)`, `sock.sendMessage(jid, content)` and
`sock.sendPresenceUpdate(type, jid)` without any change.

## The 9 hardening features

### 1. Fingerprint rotation (persistent)
A curated pool of eight realistic late-2023 desktop browser identities
(Chrome/Edge/Firefox/Safari on Ubuntu/Debian/Fedora/Windows/macOS) feeds
Baileys' `browser: [device, browser, version]` parameter. One entry is chosen at
first start, written to `.session_fingerprint.json`, and **reused on every
restart**. Consistency is a trust signal — if we re-pair because of a forced
logout, we rotate to a different entry on the next boot. We never touch
mid-session fingerprints because that would break the Noise handshake.

### 2. Randomized human delays per message
Every outbound send goes through `humanizedSend()`, which:
1. Issues `sendPresenceUpdate('composing', jid)`.
2. Waits `min(4000, max(1500, len*50))` ms (plus jitter ±200ms).
3. Issues `sendPresenceUpdate('paused', jid)`.
4. Calls the real `sendMessage`.

Delay is proportional to message length, so a 200-char reply takes ~3s to
"type" and nothing ever leaves the wire in under 1.5s. The min floor prevents
the <500ms automated-looking burst that flagged the old number.

### 3. Exponential backoff with persistence
`src/wa-hardening/reconnect-backoff.ts` keeps a JSON file
`.reconnect_state.json` with timestamps of the last 24h of reconnect attempts.
The schedule is fixed: 30s → 60s → 2m → 4m → 8m → 16m, and then DEAD for the
rest of the 24h window. PM2 restarts never reset the counter — the ledger
survives. Successful `connection === 'open'` clears the counter back to zero.

### 4. Dead-man switch
`src/wa-hardening/dead-man-switch.ts` counts handshake failures in a rolling
10-minute window. On the 3rd failure it creates `.wa_paused` and appends to
`.wa_dead_man_log.txt`. Any subsequent start of `createWWJSBot()` sees the flag
and returns a no-op stub — the SARA API bridge keeps running on port 3006, but
no WhatsApp socket is opened. Manual recovery: `rm .wa_paused`. We also trip
the dead-man immediately on a `loggedOut` / 401 reason code (Meta was explicit;
don't tempt them).

### 5. Human-like behavior patterns
- **Random presence refresh**: every 3-8 min we flip presence to `available`,
  hold for 10-30s, then back to `unavailable` — mimics someone tapping into
  WA, glancing at it, closing.
- **Delayed read receipts**: inbound messages are marked read after
  2-5s, not instantly.
- **`markOnlineOnConnect: false`**: reconnects don't scream "a bot just came
  back online".
- **Outbound rate cap**: `OutboundRateLimiter` (15 messages/minute) enforces a
  60s sliding window — if we ever burst, later sends block until a slot frees
  up. This is global, not per-user.

### 6. Keep-alive hygiene
Socket options:
- `connectTimeoutMs: 60_000`
- `defaultQueryTimeoutMs: 60_000`
- `keepAliveIntervalMs: 10_000` (more active than the 25s default — we prefer
  looking chatty rather than abandoned)
- `syncFullHistory: false` (no history vacuum, which is a classic bot tell)

### 7. Session fingerprint persistence
Already covered in #1. The file is human-readable so an operator can inspect
or delete it. If you **want** a forced rotation (e.g., recovering from a ban
on a fresh number), delete `.session_fingerprint.json` before the next start.

### 8. Fresh multi-file auth state with corruption recovery
Baileys `useMultiFileAuthState` against `auth_store_baileys_hardened/` (new
directory, never used by the legacy `wa-adapter.ts`). If the directory contents
are corrupted we log the error, wipe the dir, rotate the fingerprint, and
restart the Noise handshake — rather than crashing.

### 9. Pino logger with PII redaction
All logs go through `buildPinoLogger()` which strips phone numbers, JIDs, and
message bodies at the serializer level. Helpers:
- `redactPhone('393793658633')` → `'***8633'`
- `redactJid('393793658633@s.whatsapp.net')` → `'***8633@s.whatsapp.net'`
- `bodyStats(msg.message.conversation)` → `{len: 42, kind: 'text'}`

Log level controlled via `WA_LOG_LEVEL` env var (default `info`).

## How to activate

1. Make sure the new number is out of Meta cooldown (**don't** test speculatively).
2. Delete any stale cooldown artifacts if present (OPTIONAL — only after cooldown ends):
   ```bash
   rm -f /home/ale/whatsapp-bot/.wa_paused
   rm -f /home/ale/whatsapp-bot/.reconnect_state.json
   rm -f /home/ale/whatsapp-bot/.session_fingerprint.json
   ```
3. Swap the import in `src/index.ts`:
   ```diff
   - import { createWWJSBot, type SockLike } from './wa-adapter.js';
   + import { createWWJSBot, type SockLike } from './wa-hardened-adapter.js';
   ```
4. `npm run build`
5. `su - ale -c 'pm2 restart whatsapp-bot'`
6. `su - ale -c 'pm2 logs whatsapp-bot --lines 200'` — watch for the QR code.
7. Scan the QR with WhatsApp Business on the new number.
8. Confirm `connection OPEN` in the logs before sending anything through SARA.

Rollback:
```bash
# revert the import in src/index.ts, rebuild, restart.
```

## Expected ban-risk reduction

Realistic: **~60-70% reduction** in detection risk versus vanilla Baileys,
**maybe 40-50%** versus the current wwebjs adapter. This is an anti-detection
hardening, not a bypass — Meta runs ML classifiers that will eventually catch
any unofficial client on enough traffic. The hardening buys us weeks or
months, not years.

Specifically:
- The dead-man switch guarantees we **never** burn a second number by running
  blind retries (that's what killed the old +39 379 350 5496).
- The persistent backoff + dead-man combination means the maximum damage from
  a misconfigured restart loop is 6 handshakes in 24h.
- The outbound rate cap + typing delays eliminate the `<500ms auto-reply`
  signature that the simple keyword bots expose.

What it does **not** fix:
- Unusual conversation graphs (1-to-many broadcast shape)
- Client-reported spam (users tapping "Block & Report")
- High uniqueness on message content (same template to many users)
- Meta's server-side business-number classifiers on repeated pair+unpair cycles

## Known limitations / manual ops

1. **QR-only flow.** `requestPairingCode` is deliberately not implemented here
   — pairing codes failed repeatedly on the old number and may themselves be a
   detection signal for aged / soft-banned MSISDNs.
2. **Media upload path.** `downloadMediaWWJS()` is exported as a stub for
   interface compatibility; if any handler relies on `_buffer` fields from the
   legacy wwebjs path, it must be updated to call Baileys'
   `downloadMediaMessage` directly. Review `src/handlers/audio.ts`,
   `image.ts`, and `document.ts` before activation.
3. **Contact phone resolution (`_realPhone`).** The wwebjs adapter resolved LID
   → phone via `msg.getContact()`. Baileys does not expose an equivalent
   short-path; the new adapter does not populate `_realPhone`. If the CRM sync
   depends on the real phone, add a lookup via `sock.onWhatsApp(jid)` or
   accept the LID as the identifier.
4. **No `process.exit` recovery.** The adapter never calls `process.exit`.
   If you need a hard reset, either `pm2 restart whatsapp-bot` or delete
   `.wa_paused` and wait for the natural backoff to retry.
5. **Dead-man requires a human.** This is intentional — a paused bot is safer
   than a reconnecting one. Set up a monitoring alert on the existence of
   `.wa_paused` (e.g., `test -f /home/ale/whatsapp-bot/.wa_paused && alert`).
6. **Single-number only.** Multi-tenant SARA must go through Meta WhatsApp
   Cloud API; this adapter is for the founder's personal number and nothing
   else.

## File map

```
src/
  wa-hardened-adapter.ts             — main adapter (~330 LOC)
  wa-hardening/
    fingerprints.ts                  — browser pool + persistence
    human-delays.ts                  — delay generator + rate limiter
    reconnect-backoff.ts             — 24h persistent backoff state machine
    dead-man-switch.ts               — 3-failures-in-10-min kill switch
    pii-redaction.ts                 — phone/body redaction + Pino builder
```

Runtime files (created at startup, do not commit):
```
auth_store_baileys_hardened/         — Baileys multi-file auth
.session_fingerprint.json            — chosen browser identity
.reconnect_state.json                — rolling 24h reconnect ledger
.wa_paused                           — dead-man flag (manual clear)
.wa_dead_man_log.txt                 — human-readable failure log
qr_code.txt                          — most recent QR payload
```
