# Beacon

An AI-powered research assistant for the web. Beacon searches the live internet, grounds an answer in those sources, and returns follow-up questions so you can keep digging.

This repository is a Bun + Turborepo monorepo. The research pipeline lives in `apps/api`; a Next.js client lives in `apps/web`.

## How it works

```
User query  →  Tavily web search  →  context-engineered prompt  →  LLM  →  answer + follow-ups
```

1. A client sends a query to `POST /chat`.
2. The API runs an advanced Tavily search and collects page-level results.
3. Those results are injected into a prompt template with the original question.
4. `gpt-4o-mini` produces a structured response: the answer and suggested follow-ups.

Access control, result caching, source streaming, and a finished web UI are still in progress.

## Repository layout

| Path | Role |
| --- | --- |
| `apps/api` | Express research API (`POST /chat`) |
| `apps/web` | Next.js frontend |
| `packages/ui` | Shared React components |
| `packages/typescript-config` | Shared TypeScript configs |
| `packages/eslint-config` | Shared ESLint configs |

## Prerequisites

- [Bun](https://bun.com) 1.3+
- A [Tavily](https://tavily.com) API key
- An [OpenAI](https://platform.openai.com) API key

## Setup

```bash
git clone https://github.com/sahilkhedkar/beacon.git
cd beacon
bun install
cp .env.example .env
```

Fill in `TAVILY_API_KEY` and `OPENAI_API_KEY` in `.env`.

## Run locally

Start the research API (listens on port `3000`):

```bash
cd apps/api
bun run index.ts
```

Start the Next.js app from the repo root (configured for port `3000`; run it on a different port if the API is already bound):

```bash
bun run dev --filter=web
```

Build everything:

```bash
bun run build
```

## API

### `POST /chat`

Request:

```json
{
  "query": "What changed in the latest Turborepo release?"
}
```

The handler currently:

- searches the web with Tavily (`searchDepth: "advanced"`)
- builds a prompt from `apps/api/prompts.ts`
- calls `streamText` with `gpt-4o-mini`

Streaming the answer, sources, and follow-up questions back to the client is the next step on this endpoint.

## Tech stack

- **Runtime & workspace:** Bun, Turborepo
- **API:** Express
- **Search:** Tavily
- **LLM:** Vercel AI SDK (`ai`, `@ai-sdk/openai`)
- **Web:** Next.js 16, React 19, TypeScript

## License

Private / unpublished. All rights reserved unless otherwise noted.
