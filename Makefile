COMPOSE=docker compose -f infrastructure/docker/docker-compose.yml --env-file .env

up:        ; $(COMPOSE) up -d --build
down:      ; $(COMPOSE) down
logs:      ; $(COMPOSE) logs -f --tail=100
ps:        ; $(COMPOSE) ps
db:        ; $(COMPOSE) up -d postgres minio
verify:    ; npm run verify

.PHONY: up down logs ps db verify
