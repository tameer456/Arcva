# Arcva MCP Server

## Overview
A Node.js Express server exposing the Arcva startup OS as MCP (Model Context Protocol) tools.
Entry point: `oauth-server.js` (per `package.json` → `npm start`). `index.js` is an alternate/older stdio-based MCP server, not the one that runs in the preview.

## Running in Base44
- `docker compose -f docker-compose.base44.yml up -d` — starts the server on port 3000.
- Uses `node:22-slim`, bind-mounts the repo at `/app`, runs `npm install --omit=dev` then `node oauth-server.js`.
- Health check: `GET /health` → `{"status":"ok",...}`.
- No database or other infrastructure services — it's a stateless proxy to the Arcva/Base44 REST API (`arcva.app`).

## Environment Variables
- `PORT` — set to `3000` in compose (code defaults to 8080).
- `OAUTH_CLIENT_SECRET` — needed for the `/oauth/register` endpoint; a dev placeholder is in `.env.base44-defaults`, overridden by the platform secret.
- `ANTHROPIC_API_KEY` — needed only for the `business_advisor` tool (calls the Anthropic API). Not required to boot; the rest of the server works without it.
- `OAUTH_CLIENT_ID`, `BASE44_APP_ID` — set in `.env.base44-defaults`.

## Notes
- This is a backend API server, not a web frontend — the preview shows JSON API responses, not a UI.
- OAuth flow, MCP tool calls (JSON-RPC at `/mcp`), and discovery endpoints are all served by the single Express app.
