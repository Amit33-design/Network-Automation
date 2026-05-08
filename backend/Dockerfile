FROM python:3.11

LABEL maintainer="Amit Tiwari <atiwari824@gmail.com>"
LABEL description="NetDesign AI — FastAPI backend + MCP server"

WORKDIR /app

# Install system tools (build tools already present in full python image)
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client iputils-ping curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .

# Install in groups — each layer is cached separately so failures are visible
# Group 1: core web framework
RUN pip install --no-cache-dir --prefer-binary \
    fastapi==0.111.0 "uvicorn[standard]==0.29.0" \
    jinja2==3.1.4 pydantic==2.7.1 pydantic-settings==2.2.1 \
    python-multipart==0.0.9 httpx==0.27.0 rich==13.7.1 \
    pyyaml==6.0.1 python-dotenv

# Group 2: auth + database
RUN pip install --no-cache-dir --prefer-binary \
    pyjwt==2.8.0 structlog==24.2.0 hvac==2.1.0 \
    "sqlalchemy[asyncio]==2.0.30" asyncpg==0.29.0 alembic==1.13.1 \
    "redis[hiredis]==5.0.4" celery==5.4.0

# Group 3: network automation
RUN pip install --no-cache-dir --prefer-binary \
    nornir==3.4.1 nornir-netmiko==1.0.1 nornir-utils==0.2.0 \
    nornir-napalm==0.4.0 netmiko==4.3.0 napalm==5.0.0 \
    ncclient==0.6.15 textfsm==1.1.3 ntc-templates==5.1.0 paramiko==3.4.0

# Group 4: MCP + license
RUN pip install --no-cache-dir --prefer-binary \
    "mcp>=1.0.0" cryptography prometheus-client==0.20.0

# Group 5: optional telemetry (grpcio — fails silently if unavailable)
RUN pip install --no-cache-dir --prefer-binary pygnmi==0.8.13 || \
    echo "WARNING: pygnmi/grpcio unavailable — telemetry disabled"

COPY . .

RUN mkdir -p /app/backups /app/logs

EXPOSE 8000
EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8000/health || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
