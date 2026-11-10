# Tests de charge RecallFarm API (k6)

## Prerequis

Installer k6 :

```bash
# Windows (Chocolatey)
choco install k6

# Windows (winget)
winget install grafana.k6

# macOS
brew install k6

# Docker (sans installation)
docker run --rm -i --network host grafana/k6 run - <tests/load/k6-api.js
```

Verifier : `k6 version`

## Lancer les tests

La pile Docker doit tourner (`docker compose up -d`).

### Test rapide (smoke)
```bash
k6 run tests/load/k6-api.js --duration 30s --vus 50
```

### Test complet (ramp-up -> peak -> ramp-down)
```bash
k6 run tests/load/k6-api.js
```

### Scenario sync realiste
```bash
k6 run tests/load/k6-sync.js --duration 30s --vus 20
```

## Seuils attendus

| Metrique            | Seuil      |
|---------------------|------------|
| `http_req_duration` | p95 < 300ms |
| `http_req_failed`   | < 1 %      |
| `error_rate`        | < 1 %      |
