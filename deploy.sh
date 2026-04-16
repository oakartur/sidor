#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="sidor"
APP_PORT="${APP_PORT:-1183}"
API_PORT="${API_PORT:-1184}"
POSTGRES_PORT="${POSTGRES_PORT:-15483}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

cd "$PROJECT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker nao encontrado. Instale Docker Engine antes do deploy." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin nao encontrado. Instale o plugin docker compose." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Arquivo .env criado a partir de .env.example."
  echo "Revise senhas e JWT_SECRET antes de expor em producao."
fi

if ! grep -q '^POSTGRES_PORT=' .env; then
  printf '\nPOSTGRES_PORT=%s\n' "$POSTGRES_PORT" >> .env
fi

if grep -Eq '^API_PORT=3000$|^POSTGRES_PORT=5432$|127\.0\.0\.1:5432|@postgres:5432' .env; then
  echo "O .env ainda referencia portas antigas/conflitantes do SIDOR." >&2
  echo "Ajuste para API_PORT=1184, POSTGRES_PORT=15483 e DATABASE_URL apontando para 127.0.0.1:15483." >&2
  exit 1
fi

export COMPOSE_PROJECT_NAME="$APP_NAME"

for port in "$APP_PORT" "$API_PORT" "$POSTGRES_PORT"; do
  if ss -ltn "( sport = :${port} )" | grep -q ":${port}"; then
    owner="$(docker compose ps -q 2>/dev/null | head -n 1 || true)"
    if [ -z "$owner" ]; then
      echo "A porta ${port} ja esta em uso no host. Ajuste APP_PORT/API_PORT/POSTGRES_PORT ou libere a porta." >&2
      exit 1
    fi
  fi
done

docker compose build
docker compose up -d --remove-orphans

echo "Aguardando Nginx/API responderem em http://127.0.0.1:${APP_PORT}/health ..."
for attempt in $(seq 1 40); do
  if curl -fsS --connect-timeout 2 --max-time 5 "http://127.0.0.1:${APP_PORT}/health" >/dev/null 2>&1; then
    HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
    echo "Deploy concluido."
    echo "Acesso local:   http://127.0.0.1:${APP_PORT}"
    if [ -n "${HOST_IP:-}" ]; then
      echo "Acesso na rede: http://${HOST_IP}:${APP_PORT}"
    fi
    exit 0
  fi
  sleep 3
done

echo "Deploy iniciado, mas o healthcheck nao respondeu a tempo." >&2
echo "Status dos containers:" >&2
docker compose ps >&2 || true
echo "" >&2
echo "Ultimos logs da API:" >&2
docker compose logs --tail=80 api >&2 || true
echo "" >&2
echo "Ultimos logs do Nginx web:" >&2
docker compose logs --tail=80 web >&2 || true
echo "" >&2
echo "Ultimos logs do PostgreSQL:" >&2
docker compose logs --tail=80 postgres >&2 || true
echo "Verifique os logs com: docker compose logs -f" >&2
exit 1
