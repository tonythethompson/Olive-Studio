# Docker Deployment Guide — Olive MCP Server

Deploy the Olive MCP Server as a standalone container or alongside the Olive Studio
Express application using Docker Compose.

## Prerequisites

| Requirement | Minimum Version |
|-------------|-----------------|
| Docker Engine | 20.10+ |
| Docker Compose | v2.x (bundled with Docker Desktop) |

> **Note:** The multi-stage Dockerfile produces an image of approximately **1.5–3 GB**
> because it bundles CPU PyTorch, sentence-transformers, and the BGE-small embedding model.

## Building the Image

The Dockerfile lives at `olive-mcp-server/Dockerfile`. Build from the `olive-mcp-server/`
directory as the context:

```bash
cd olive-mcp-server
docker build -t olive-mcp-server .
```

The build pre-caches the `BAAI/bge-small-en-v1.5` embedding model so the runtime container
does not require network access for semantic search on first request.

## Running the Container

Run these commands from the **repository root** unless noted. The host knowledge-base
path is `olive-mcp-server/olive_mcp_server/knowledge_base`. If you `cd olive-mcp-server`
first (same as the build step), use `./olive_mcp_server/knowledge_base` instead.

### Basic Run

```bash
docker run -d \
  --name olive-mcp \
  -p 8000:8000 \
  -e MCP_TRANSPORT=sse \
  -e MCP_HOST=0.0.0.0 \
  -e MCP_PORT=8000 \
  -e OLIVE_MCP_RETRIEVAL_MODE=auto \
  -v ./olive-mcp-server/olive_mcp_server/knowledge_base:/app/olive_mcp_server/knowledge_base:ro \
  olive-mcp-server
```

The container exposes port **8000** for SSE-based MCP communication. The knowledge base
directory is mounted read-only so you can update pass catalogs and hardware profiles
without rebuilding the image.

## Environment Variables

| Variable | Accepted Values | Default | Description |
|----------|----------------|---------|-------------|
| `MCP_TRANSPORT` | `sse`, `stdio` | `stdio` | Transport protocol — use `sse` for containerized deployments. |
| `MCP_HOST` | Any bind address | `0.0.0.0` | Network interface the server listens on inside the container. |
| `MCP_PORT` | Integer | `8000` | Port the MCP server listens on. |
| `OLIVE_MCP_RETRIEVAL_MODE` | `auto`, `keyword`, `semantic` | `auto` | Search strategy for knowledge base queries. `auto` uses semantic when budget allows, falls back to keyword. |
| `OLIVE_MCP_SEMANTIC_BUDGET_MS` | Non-negative integer | `8000` | Maximum milliseconds for semantic search in `auto` mode; `0` means unlimited. |
| `OLIVE_MCP_PRELOAD_EMBEDDINGS` | `1`, `0` | `0` | When `1`, loads the embedding model and KB indexes at startup before accepting traffic. Increases cold-start time but eliminates first-request latency. |
| `SYNC_KB_TOKEN` | Any string | _(unset)_ | When set, requires matching `x-sync-token` header on `POST /api/mcp/sync-kb` requests. |
| `HF_HUB_OFFLINE` | `1`, `0` | `1` | Prevents Hugging Face Hub downloads at runtime (model is pre-cached in the image). |

## Volume Mounts

| Host Path | Container Path | Mode | Purpose |
|-----------|---------------|------|---------|
| `./olive-mcp-server/olive_mcp_server/knowledge_base` (repo root) | `/app/olive_mcp_server/knowledge_base` | `ro` | Pass catalog, hardware profiles, troubleshooting KB |

## Docker Compose

There is no Studio Dockerfile at the repository root. Use Compose for the **MCP
server only**. A checked-in example lives at `olive-mcp-server/docker-compose.yml`
(build context is that directory). From the **repository root**, this equivalent
file works:

```yaml
services:
  olive-mcp:
    build:
      context: ./olive-mcp-server
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - MCP_TRANSPORT=sse
      - MCP_HOST=0.0.0.0
      - MCP_PORT=8000
      - OLIVE_MCP_RETRIEVAL_MODE=auto
      - OLIVE_MCP_PRELOAD_EMBEDDINGS=1
    volumes:
      - ./olive-mcp-server/olive_mcp_server/knowledge_base:/app/olive_mcp_server/knowledge_base:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; r=urllib.request.urlopen('http://localhost:8000/sse',timeout=3); r.close()"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 5s
```

Start the MCP service:

```bash
docker compose up -d
```

Olive Studio itself is not containerized in this repo. Run it on the host with
`pnpm start` (or `pnpm dev`). The Express MCP client launches a **local stdio**
subprocess; it does not read `OLIVE_MCP_URL`. Tools that call Studio HTTP
(`validate_ui_state_recipe`, `get_recipe_for_ui_state`, and similar) need
`OLIVE_STUDIO_API_URL` pointing at the Studio process (typically
`http://127.0.0.1:3000`), not a Docker-internal hostname from Studio to MCP.

## Health Check

The MCP server exposes an SSE endpoint at `GET /sse` on port 8000. A successful
connection (HTTP 200 with `text/event-stream` content type) indicates readiness.

The built-in `HEALTHCHECK` instruction in the Dockerfile uses this endpoint:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; r=urllib.request.urlopen('http://localhost:8000/sse',timeout=3); r.close()" || exit 1
```

## Verification

After starting the container, verify it is healthy:

```bash
# Check container health status
docker inspect --format='{{.State.Health.Status}}' olive-mcp
# Expected output: healthy

# Or test the endpoint directly
curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/sse
# Expected output: 200
```

## Security Notes

> **Warning:** The Olive Studio Express server defaults to loopback-only (`127.0.0.1`).
> Setting `OLIVE_BIND=0.0.0.0` exposes the API on all network interfaces. Only do this
> on a trusted network or behind a reverse proxy with TLS termination.

- **Loopback-gated routes** (`/api/olive/run`, `/api/olive/status`, `/api/mcp/sync-kb`)
  remain restricted to loopback even when bound to all interfaces.
- When exposing to a network, place a reverse proxy (nginx, Caddy, Traefik) in front
  with HTTPS and authentication.
- Set `SYNC_KB_TOKEN` to protect the knowledge base sync endpoint.
- The MCP server runs as a non-root user (`mcp`) inside the container.

## Troubleshooting

| Issue | Cause | Solution |
|-------|-------|----------|
| Port 8000 already in use | Another service on the host uses 8000 | Map to a different host port: `-p 9000:8000` |
| Container exits immediately | Missing or corrupt embedding model cache | Rebuild image to re-cache: `docker build --no-cache -t olive-mcp-server .` |
| Slow first request | Embedding model loading on demand | Set `OLIVE_MCP_PRELOAD_EMBEDDINGS=1` to front-load at startup |
| `HfHubHTTPError` at runtime | Container attempting to download models | Ensure `HF_HUB_OFFLINE=1` (set by default in image); rebuild if model cache is missing |
| Health check failing | Server not yet ready within start period | Increase `start_period` in compose or Dockerfile healthcheck |
| Studio MCP tools fail | Express uses stdio, not `OLIVE_MCP_URL` | Run Studio on the host (`pnpm start`); set `OLIVE_STUDIO_API_URL` on the MCP process for loopback tools |
