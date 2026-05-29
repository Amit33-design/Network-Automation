#!/bin/bash
set -e

# Start Colima if not running
if ! colima status 2>/dev/null | grep -q "running"; then
  echo "Starting Colima..."
  colima start --arch aarch64 --vm-type vz --vz-rosetta
fi

# Start services
DOCKER_HOST="unix://${HOME}/.colima/default/docker.sock" \
  docker compose -f "$(dirname "$0")/docker-compose.local.yml" --env-file "$(dirname "$0")/.env" up -d

# Open app
open http://localhost:8080
echo "NetDesign AI is running at http://localhost:8080"
