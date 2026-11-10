# Raccourcis RecallFarm. `make help` pour la liste.
SHELL := /bin/bash
COMPOSE := docker compose

.PHONY: help env up down logs ps seed demo backup restore test test-api test-web build-mobile clean

help: ## Afficher cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

env: ## Créer .env à partir du modèle avec des secrets aléatoires
	@test -f .env && echo ".env existe déjà" || ( cp .env.example .env && \
	  for k in POSTGRES_PASSWORD REDIS_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET PAYMENT_WEBHOOK_SECRET; do \
	    v=$$(openssl rand -hex 24); sed -i "s|^$$k=.*|$$k=$$v|" .env; done && echo ".env créé" )

up: env ## Construire et démarrer la pile
	$(COMPOSE) up -d --build

down: ## Arrêter la pile
	$(COMPOSE) down

logs: ## Suivre les journaux
	$(COMPOSE) logs -f --tail=100

ps: ## État des services
	$(COMPOSE) ps

seed: ## (Re)charger les données de démonstration
	$(COMPOSE) exec api node dist/scripts/seed.js

demo: ## Démarrer aussi le simulateur de capteurs
	$(COMPOSE) --profile demo up -d

backup: ## Démarrer les sauvegardes quotidiennes
	$(COMPOSE) --profile backup up -d backup

restore: ## Restaurer : make restore FILE=backups/recallfarm-....dump
	@test -n "$(FILE)" || (echo "FILE=... requis" && exit 1)
	$(COMPOSE) exec -T postgres pg_restore -U $${POSTGRES_USER:-recallfarm} -d $${POSTGRES_DB:-recallfarm} --clean --if-exists < $(FILE)

test: test-api test-web ## Tous les tests (hors mobile)

test-api: ## Tests de l'API (PostgreSQL local requis)
	cd apps/api && npm ci && npm test && npm run test:e2e

test-web: ## Tests du web
	cd apps/web && npm ci && npm test && npm run build

build-mobile: ## APK de recette (SDK Flutter requis)
	cd apps/mobile && flutter pub get && flutter test && flutter build apk --release --dart-define=API_BASE_URL=$${API_BASE_URL:-https://pilote.recallfarm.app/v1}

clean: ## Supprimer conteneurs ET volumes (données perdues)
	$(COMPOSE) down -v
