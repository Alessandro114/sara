# Vertical packs

A vertical pack is a JSON file. That's the whole interface.

```json
{
  "vertical": "dine",
  "prompts": {
    "it": "Sei l'assistente di un ristorante...",
    "en": "You are a restaurant's assistant...",
    "es": "...",
    "pt": "..."
  }
}
```

Only `it` is required — the loader falls back to it for any missing language,
and to the `general` pack for any missing vertical. **A missing pack is never
an error**: the agent answers generically rather than failing.

## Writing your own

1. Create `vertical.<name>.json` in this directory (or anywhere, see below).
2. Write the prompt. Look at `vertical.dine.json` for a complete example.
3. Map your sector words to it in `SECTOR_TO_VERTICAL` (`src/vertical-prompts.ts`)
   — that's how `ristorante`, `restaurant`, `trattoria` all reach the `dine` pack.

No code changes. No recompilation. No plugin API.

## Sector packs

Same shape, filename `sector.<name>.json`, key `"sector"` instead of
`"vertical"`. Vertical packs describe *what the agent knows*; sector packs
describe *how it talks to that audience*.

## Loading from elsewhere

```bash
SARA_VERTICAL_PACKS=/path/to/my-packs:/another/path npm start
```

Later directories win, so you can override a bundled pack without touching
this repo.

## What ships here

`general` (the fallback, always loaded) and `dine` (a complete worked example
in four languages, with matching tools in
[`@scala-ai/agent-definitions`](https://github.com/Alessandro114/scala-agent-definitions)).

20 verticals are defined in that schema. The remaining prompt packs are
maintained commercially at [get-scala.com](https://get-scala.com) — or write
your own, which is the point of this format.
