FROM python:3.11-slim

LABEL maintainer="Amit Tiwari <atiwari824@gmail.com>"
LABEL description="NetDesign AI — FastAPI backend + MCP server"

WORKDIR /app

# System libs: ssh/ping tools + build deps for grpcio/cryptography/asyncpg
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client iputils-ping curl \
    gcc g++ libssl-dev libffi-dev libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps in two passes:
# Pass 1: core packages (always succeed)
# Pass 2: heavy optional packages (telemetry/gnmi — gracefully imported, ok to skip)
COPY requirements.txt requirements-optional.txt* ./
RUN pip install --no-cache-dir --prefer-binary -r requirements.txt
RUN pip install --no-cache-dir --prefer-binary pygnmi==0.8.13 || \
    echo "WARNING: pygnmi optional telemetry package failed to install — continuing"

# Copy source
COPY . .

# Create backup directory
RUN mkdir -p /tmp/netdesign_backups

# FastAPI REST API port
EXPOSE 8000

# MCP SSE transport port (for remote AI clients)
EXPOSE 8001

# Healthcheck for FastAPI
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import httpx; httpx.get('http://localhost:8000/').raise_for_status()"

# Default: run FastAPI backend
# Override CMD to run MCP server instead:
#   docker run netdesign-ai python mcp_server.py --transport sse --port 8001
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
