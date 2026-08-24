# Contributing to SARA

Thanks for your interest in contributing to SARA! Here's how to get started.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/sara.git`
3. Install dependencies: `npm install`
4. Copy `.env.example` to `.env` and configure your API keys
5. Start with Docker: `docker compose up`

## Development

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js 20+
- **Database**: PostgreSQL 16 + pgvector
- **Style**: Use existing code conventions — no linter config to follow, just match the patterns

## What to Contribute

### Good First Issues

- Add a new vertical agent definition in `src/data/verticals/`
- Improve language detection or translation coverage
- Add tests for existing tool handlers

### Bigger Contributions

- New AI provider integrations (add to the provider chain in `src/ai-providers.ts`)
- New WhatsApp message type handlers
- Performance improvements to RAG retrieval
- Documentation improvements

## Pull Request Process

1. Create a feature branch from `main`: `git checkout -b feat/my-feature`
2. Make your changes with clear, descriptive commits
3. Ensure the project builds: `npm run build`
4. Open a PR against `main` with a clear description of what changed and why
5. Wait for review — we aim to respond within 48 hours

## Branch Naming

Use descriptive branch names:
- `feat/<short-description>` — new feature
- `fix/<short-description>` — bug fix
- `docs/<short-description>` — documentation only
- `refactor/<short-description>` — code refactor, no functional change

## Code Style

- TypeScript throughout — no plain JS files in `src/`.
- Use `const` / `let`; avoid `var`.
- Prefer explicit types over `any`.
- No `console.log` in production paths — use the project logger.
- Commit messages in the imperative mood: `fix: …`, `feat: …`, `docs: …`.

## Pricing & Commercial Content

If you modify any text referencing plans or pricing, the canonical values are:

| Plan   | Price         | Notes                                      |
|--------|---------------|--------------------------------------------|
| GROWTH | €97/month     | 5 verticals, 6 users, 30K AI credits, 14-day trial |
| SCALE  | €197/month    | All 20 verticals, unlimited users, SARA WhatsApp |

- **No FREE plan exists** — do not introduce a free tier.
- **SARA WhatsApp is SCALE-only** — do not list it under GROWTH.
- Do not introduce pricing text that contradicts the table above.

## Code of Conduct

Be respectful, constructive, and inclusive. We're building something useful together.

## License

By contributing, you agree that your contributions will be licensed under the **Apache License 2.0**.

See [LICENSE](./LICENSE) for the full license text.

## Questions?

Open an issue or start a discussion on GitHub.
