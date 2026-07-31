# ⛔ SARA WhatsApp NON deve girare su DEV

**Il 17 luglio 2026 questa istanza è stata spenta, disabilitata e ripulita. NON riattivarla.**

## Perché
Girava un `sara-whatsapp.service` anche qui, con lo **stesso BOT_PHONE di PROD**. Due istanze sulla
stessa utenza WhatsApp si scalciano a vicenda: quando una vince, l'altra finisce in **QR loop**.

Danno misurato: **SARA è rimasta scollegata ~38 ore** (14→16 lug 2026), zero messaggi processati,
e **nessun alert** è mai partito. Questa istanza generava **1.118 QR in 24 ore**. In più intercettava
qualche messaggio scrivendolo nel database di DEV, invisibile a PROD (split-brain dei dati).

A tenerla in vita era `sara-health-check.sh` (cron */5) che faceva `systemctl start` ogni 5 minuti:
ora è commentato nel crontab.

## Stato attuale
- `sara-whatsapp.service` su DEV: **stopped + disabled**
- `auth_store_wwjs/` e `vendor-chrome/`: **rimossi** (809M liberati)
- SARA WhatsApp gira **SOLO su PROD** (65.108.208.117) — lì `auth_store_wwjs` e `vendor-chrome`
  NON si toccano MAI (cancellarli = QR re-pair = downtime).

## Se serve sviluppare su SARA
Modifica il sorgente qui (DEV è la fonte di verità, è il repo git), fai la build, e **deploya il
`dist/` su PROD**. NON avviare il servizio qui: il bot non ti serve acceso per scrivere codice.
