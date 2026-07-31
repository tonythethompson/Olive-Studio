# Multi-stage build for Olive MCP Server
# Produces a slim image (~120MB) that runs the MCP server over SSE/HTTP transport.

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

COPY pyproject.toml ./
COPY olive_mcp_server/ ./olive_mcp_server/

RUN pip install --no-cache-dir --prefix=/install . "mcp<2"

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="olive-mcp-server"
LABEL org.opencontainers.image.description="MCP server for Microsoft Olive model optimization guidance"
LABEL org.opencontainers.image.licenses="MIT"

# Create non-root user
RUN useradd --create-home --shell /bin/bash mcp

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy source (needed for knowledge_base JSON files)
COPY olive_mcp_server/ ./olive_mcp_server/
COPY pyproject.toml ./

# Volume mount point for knowledge base hot-reload
VOLUME /app/olive_mcp_server/knowledge_base

USER mcp

# SSE transport listens on port 8000 by default
EXPOSE 8000

ENV MCP_TRANSPORT=sse
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; r=urllib.request.urlopen('http://localhost:8000/sse',timeout=3); r.close()" || exit 1

ENTRYPOINT ["python", "-m", "olive_mcp_server"]
