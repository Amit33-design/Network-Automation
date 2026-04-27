FROM python:3.11-slim

LABEL maintainer="Amit Tiwari <atiwari824@gmail.com>"
LABEL description="NetDesign AI — FastAPI backend"

WORKDIR /app

# Install system deps for Netmiko/paramiko
RUN apt-get update && apt-get install -y --no-install-recommends \
    openssh-client \
    iputils-ping \
    && rm -rf /var/lib/apt/lists/*

# Install Python deps first (layer-cached)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Create backup directory
RUN mkdir -p /tmp/netdesign_backups

EXPOSE 8000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import httpx; httpx.get('http://localhost:8000/').raise_for_status()"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
