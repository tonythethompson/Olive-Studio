# Multi-stage build for Olive MCP Server
# Image size is dominated by CPU PyTorch + sentence-transformers + MiniLM
# (~1.5–3GB depending on platform wheels — not a slim ~120MB image).

# ── Stage 1: Install dependencies ────────────────────────────────────────────
FROM python:3.12-slim AS builder

WORKDIR /build

COPY pyproject.toml ./
COPY olive_mcp_server/ ./olive_mcp_server/

# Install torch from the CPU-only index first. --extra-index-url does not
# prioritize this index over PyPI, so a plain combined install can still
# resolve PyPI's CUDA-bundled torch wheel; installing torch alone against
# --index-url forces the CPU build, and PYTHONPATH makes it visible as
# "already satisfied" to the next install so it isn't pulled again from PyPI.
RUN pip install --no-cache-dir --prefix=/install \
    --index-url https://download.pytorch.org/whl/cpu \
    "torch==2.5.1" \
 && PYTHONPATH="$(echo /install/lib/python*/site-packages)" \
    pip install --no-cache-dir --prefix=/install \
    . "mcp<2"

# Pre-cache the embedding model so the runtime image does not need network
# access on first semantic search. Cache lands under /root/.cache/huggingface.
RUN PYTHONPATH="$(echo /install/lib/python*/site-packages)" \
    python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

# ── Stage 2: Runtime ─────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

LABEL org.opencontainers.image.title="olive-mcp-server"
LABEL org.opencontainers.image.description="MCP server for Microsoft Olive model optimization guidance"
LABEL org.opencontainers.image.licenses="MIT"

RUN useradd --create-home --shell /bin/bash mcp

WORKDIR /app

COPY --from=builder /install /usr/local

COPY --from=builder --chown=mcp:mcp /root/.cache/huggingface /home/mcp/.cache/huggingface

COPY olive_mcp_server/ ./olive_mcp_server/
COPY pyproject.toml ./

VOLUME /app/olive_mcp_server/knowledge_base

USER mcp

EXPOSE 8000

ENV MCP_TRANSPORT=sse
ENV MCP_HOST=0.0.0.0
ENV MCP_PORT=8000
ENV HF_HOME=/home/mcp/.cache/huggingface
ENV HF_HUB_OFFLINE=1

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD python -c "import urllib.request; r=urllib.request.urlopen('http://localhost:8000/sse',timeout=3); r.close()" || exit 1

ENTRYPOINT ["python", "-m", "olive_mcp_server"]
