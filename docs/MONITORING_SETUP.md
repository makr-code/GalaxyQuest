# GalaxyQuest monitoring

## Production and staging

Use the [Plesk deployment runbook](technical/PLESK_DEPLOYMENT.md) and
[production Compose stack](../deploy/compose.yml). Do not publish the local
development monitoring services on a Plesk host.

The production stack provides:

- Prometheus with bounded retention and service-DNS targets.
- Grafana with provisioned datasource and operations dashboard.
- A dedicated, non-root MySQL monitoring account.
- Linux host metrics via Node Exporter.
- Blackbox probes for the app's database/schema readiness endpoint.
- Alertmanager with a private, explicitly configured notification recipient.

Only Grafana has a loopback host port; Prometheus, exporters and Alertmanager
are internal. The public Plesk proxy denies application metrics endpoints.
No privileged cAdvisor or Docker socket is required in production.

## Local Docker Desktop

Start the game first, then the separate monitoring project:

```powershell
docker compose up -d web db
docker compose -f monitoring/docker-compose.monitoring.yml up -d
```

Prometheus joins the existing game network `galaxyquest_default`. If the game
uses a different Compose project/network, set `GQ_GAME_NETWORK` before starting
monitoring. All six monitoring services keep their existing local data volumes.

| Service | Local URL / port |
|---|---|
| Grafana | http://localhost:3000 |
| Prometheus | http://localhost:9090 |
| Node Exporter | http://localhost:9100/metrics |
| MySQL Exporter | http://localhost:9104/metrics |
| cAdvisor | http://localhost:8082 |
| Alertmanager | http://localhost:9093 |
| Application metrics | http://localhost:8081/api/metrics.php |

Set `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` for local initialization.
The development fallback is `admin/admin`; changing an environment variable
does not reset an already initialized Grafana account. The separate production
stack requires an explicitly configured password.

The development MySQL exporter still uses the local developer DB endpoint and
credentials; this is not the production exporter configuration.

## Verify collection, not just container health

```powershell
docker exec prometheus promtool check config /etc/prometheus/prometheus.yml
$targets = Invoke-RestMethod http://localhost:9090/api/v1/targets
$targets.data.activeTargets | Select-Object scrapeUrl, health, lastError
Invoke-RestMethod http://localhost:9090/api/v1/alertmanagers
```

The five local scrape jobs should be `up`:

| Job | Container target | Metrics path |
|---|---|---|
| prometheus | localhost:9090 | /metrics |
| mysql | mysql-exporter:9104 | /metrics |
| node | node-exporter:9100 | /metrics |
| cadvisor | cadvisor:8080 | /metrics |
| trellis2 | web:8080 | /api/metrics.php |

`localhost` inside Prometheus is only Prometheus, not the Docker host or another
container. A URL path belongs in `metrics_path`, not inside the target address.

After editing the local Prometheus configuration:

```powershell
docker compose -f monitoring/docker-compose.monitoring.yml up -d --no-deps prometheus
docker compose -f monitoring/docker-compose.monitoring.yml restart prometheus
```

The explicit restart reloads a bind-mounted configuration when Compose did not
recreate the container.

The local Alertmanager target is `alertmanager:9093`. Its checked-in
[receiver](../monitoring/alertmanager.yml) intentionally has no notification
integration: a running Alertmanager does not prove that an operator receives
alerts. Configure and test a real receiver before relying on notifications.

## Useful queries

```promql
up
mysql_up
trellis2_database_connected
trellis2_queue_count
trellis2_queued_jobs
trellis2_active_jobs
trellis2_failed_jobs_24h
trellis2_avg_processing_ms
trellis2_success_rate_today
trellis2_completions_per_hour
trellis2_storage_used_gb
```

The success percentage and processing averages are gauges; do not apply `rate()`
to them. Daily counts and rolling-hour counts are not monotonic lifetime
counters. The current legacy metrics endpoint's reported p95 is approximate,
not acceptance evidence for a true latency percentile. Desktop host metrics
describe Docker's Linux environment, not necessarily native Windows.

The local historical TRELLIS alert rules are development diagnostics, not the
production acceptance contract. Production uses its separate
[operations rules](../deploy/monitoring/rules.yml), actual readiness probes and
an explicitly tested mail receiver.

## Troubleshooting

- Targets down: inspect `lastError`, container DNS and the external game network.
- `mysql_up=0`: check the exporter connection, DB credentials and account grants.
- Metrics HTTP 200 but `trellis2_database_connected=0`: the exporter could not
  collect its application data; HTTP reachability is not DB health.
- `/health/live` 200 and `/health/ready` 503: inspect canonical migration status;
  never replay migrations or reset volumes merely to make a probe green.
- Empty dashboards: verify Prometheus queries and Grafana's datasource URL
  `http://prometheus:9090`.
- Missing notifications: check the receiver, SMTP TLS/authentication and actual
  message receipt. Connected Alertmanager alone is insufficient.

Do not use `docker compose down -v`, delete monitoring volumes, or disable
readiness checks as troubleshooting shortcuts.
