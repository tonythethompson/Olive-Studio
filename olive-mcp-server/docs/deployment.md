# Olive MCP Server — Deployment Guide

This guide covers deploying the Olive MCP server in containerized and serverless environments. The server supports two transports:

- **stdio** (default) — for local AI coding agents (Claude Desktop, Cursor, etc.)
- **SSE/HTTP** — for remote/cloud-hosted scenarios (Docker, serverless, multi-agent orchestration)

---

## Docker

### Build

```bash
cd olive-mcp-server
docker build -t olive-mcp-server .
```

The multi-stage build produces a ~120MB image based on `python:3.12-slim`.

### Run (SSE transport)

```bash
docker run -p 8000:8000 olive-mcp-server
```

The server listens on `http://localhost:8000/sse` for SSE connections.

### Run with custom port

```bash
docker run -p 9000:9000 -e MCP_PORT=9000 olive-mcp-server
```

### Docker Compose (development with KB hot-reload)

```bash
docker compose up
```

This mounts `./olive_mcp_server/knowledge_base` as a read-only volume, so you can edit KB JSON files locally and restart the container to pick up changes.

### Environment Variables

| Variable        | Default     | Description                                           |
| --------------- | ----------- | ----------------------------------------------------- |
| `MCP_TRANSPORT` | `stdio`     | Transport mode: `stdio` or `sse`                      |
| `MCP_HOST`      | `127.0.0.1` | Bind address (SSE mode). Use `0.0.0.0` in containers. |
| `MCP_PORT`      | `8000`      | Listen port (SSE mode)                                |

---

## Azure Container Apps (Serverless)

Azure Container Apps provides scale-to-zero HTTP hosting — ideal for low-traffic MCP server deployments.

### 1. Push image to Azure Container Registry

```bash
az acr create --resource-group rg-olive --name oliveacr --sku Basic
az acr login --name oliveacr
docker tag olive-mcp-server oliveacr.azurecr.io/olive-mcp-server:latest
docker push oliveacr.azurecr.io/olive-mcp-server:latest
```

### 2. Deploy to Container Apps

```bash
az containerapp create \
  --name olive-mcp \
  --resource-group rg-olive \
  --image oliveacr.azurecr.io/olive-mcp-server:latest \
  --target-port 8000 \
  --ingress external \
  --environment-vars "MCP_TRANSPORT=sse" "MCP_HOST=0.0.0.0" "MCP_PORT=8000" \
  --min-replicas 0 \
  --max-replicas 2 \
  --scale-rule-name http-scale \
  --scale-rule-type http \
  --scale-rule-metadata "concurrentRequests=10"
```

### 3. Connect from Olive Studio

Set the MCP proxy URL in your Olive Studio `.env`:

```env
MCP_REMOTE_URL=https://olive-mcp.<region>.azurecontainerapps.io/sse
```

---

## AWS Lambda (via Mangum adapter)

For AWS Lambda, wrap the SSE app with [Mangum](https://github.com/jordaneremieff/mangum):

### 1. Install Mangum

```bash
pip install mangum
```

### 2. Create handler

```python
# handler.py
from mangum import Mangum
from olive_mcp_server.mcp_server import mcp

# FastMCP's SSE mode creates a Starlette app internally.
# Access it after calling run() setup, or create the app directly:
app = mcp.sse_app()
handler = Mangum(app)
```

### 3. Deploy with AWS SAM or Serverless Framework

```yaml
# serverless.yml (example)
service: olive-mcp
provider:
  name: aws
  runtime: python3.12
  memorySize: 256
  timeout: 30
functions:
  mcp:
    handler: handler.handler
    events:
      - httpApi: "*"
```

> **Note:** Lambda cold-start adds ~1-2s. For latency-sensitive agent workflows, prefer Container Apps or a long-running Docker container.

---

## Local Production (systemd)

For a dedicated Linux server without Docker:

### 1. Install

```bash
cd olive-mcp-server
python -m venv /opt/olive-mcp/.venv
/opt/olive-mcp/.venv/bin/pip install . "mcp<2"
```

### 2. Create systemd unit

```ini
# /etc/systemd/system/olive-mcp.service
[Unit]
Description=Olive MCP Server (SSE)
After=network.target

[Service]
Type=simple
User=olive-mcp
WorkingDirectory=/opt/olive-mcp
Environment=MCP_TRANSPORT=sse
Environment=MCP_HOST=127.0.0.1
Environment=MCP_PORT=8000
ExecStart=/opt/olive-mcp/.venv/bin/python -m olive_mcp_server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 3. Enable and start

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now olive-mcp
```

---

## Connecting AI Agents to a Remote MCP Server

### Claude Desktop / Cursor (via mcp-proxy)

```json
{
  "mcpServers": {
    "olive-remote": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-proxy", "--url", "http://your-server:8000/sse"]
    }
  }
}
```

### Olive Studio (Express proxy)

The Olive Studio web app proxies MCP tool calls via `POST /api/mcp/tool`. When a remote MCP server is configured, the Express backend forwards requests to the SSE endpoint instead of spawning a local stdio process.

---

## Health Checks

The SSE transport exposes a `/sse` endpoint. Use it for health monitoring:

```bash
curl -f http://localhost:8000/sse
```

The Docker image includes a built-in `HEALTHCHECK` instruction. Container orchestrators (Kubernetes, ECS, Container Apps) can use this for liveness probes.
