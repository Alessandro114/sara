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

## Code of Conduct

Be respectful, constructive, and inclusive. We're building something useful together.

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 license.

## Questions?

Open an issue or start a discussion on GitHub.
