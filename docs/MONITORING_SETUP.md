# TRELLIS2 Monitoring Setup Guide

## Overview

TRELLIS2 provides comprehensive monitoring via Prometheus + Grafana + Alert Rules.

**Components:**
- **Prometheus** (9090): Time-series database, metrics collection
- **Grafana** (3000): Visualization dashboards
- **Node Exporter** (9100): System metrics (CPU, memory, disk)
- **MySQL Exporter** (9104): Database performance metrics
- **cAdvisor** (8081): Docker container metrics
- **Alertmanager** (9093): Alert routing & notification

---

## Quick Setup (5 minutes)

### Step 1: Create monitoring directories
```bash
mkdir -p monitoring/grafana/{dashboards,datasources}
mkdir -p monitoring/rules
```

### Step 2: Copy configuration files
```bash
# Already created:
cp monitoring/prometheus.yml /etc/prometheus/ 2>/dev/null || echo "Using container"
cp monitoring/rules/trellis2.yml /etc/prometheus/rules/
```

### Step 3: Add monitoring to docker-compose
```bash
# Copy the services from monitoring/docker-compose.monitoring.yml
# Into your existing docker-compose.yml
```

### Step 4: Create Prometheus datasource config
```bash
cat > monitoring/grafana/datasources/prometheus.yml << 'EOF'
apiVersion: 1
datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
EOF
```

### Step 5: Start monitoring stack
```bash
docker-compose up -d prometheus grafana node-exporter mysql-exporter cadvisor
```

### Step 6: Verify services
```bash
# Prometheus: http://localhost:9090
curl http://localhost:9090/-/healthy

# Grafana: http://localhost:3000 (admin/admin)
curl http://localhost:3000/api/health

# Metrics endpoint: http://localhost:8080/api/metrics.php
curl http://localhost:8080/api/metrics.php | head -20
```

---

## Key Metrics

### Queue Metrics
```
trellis2_queued_jobs          # Jobs waiting to process
trellis2_active_jobs          # Jobs currently processing
trellis2_failed_jobs_24h      # Failed jobs in last 24h
```

### Processing Metrics
```
trellis2_avg_processing_ms    # Average processing time
trellis2_p95_processing_ms    # 95th percentile time
trellis2_min_processing_ms    # Minimum time
trellis2_max_processing_ms    # Maximum time
```

### Success Metrics
```
trellis2_success_rate_today   # Today's success rate %
trellis2_cache_hit_ratio      # Cache effectiveness %
trellis2_completions_per_hour # Throughput
```

### Storage Metrics
```
trellis2_storage_used_gb                # Total storage
trellis2_avg_user_storage_percent       # Average user quota %
trellis2_users_at_storage_limit         # Users >95% quota
```

### System Metrics
```
trellis2_total_users          # Active users
trellis2_total_vessel_designs # Total designs
trellis2_total_generations    # Total generations
trellis2_database_connected   # DB health (1=ok, 0=error)
```

---

## Alert Rules

### Critical Alerts
- **TrellisDatabaseDown** - Database connection lost
- **TrellisCriticalSuccessRate** - Success rate <50%
- **TrellisQueueStalled** - No progress but queue not empty

### Warning Alerts
- **TrellisTooManyQueuedJobs** - >100 jobs queued
- **TrellisLowSuccessRate** - <80% success rate
- **TrellisSlowProcessing** - Avg time >30 seconds
- **TrellisStorageAlmostFull** - Users >90% quota
- **TrellisHighRetryRate** - >50 retries

### Info Alerts
- **TrellisCacheMiss** - Cache <25% hit ratio
- **TrellisUnusuallyHighThroughput** - >100 jobs/hour
- **TrellisActiveUsersHigh** - >1000 active users

---

## Create Grafana Dashboard

### Step 1: Open Grafana
```
http://localhost:3000
Login: admin / admin
```

### Step 2: Create new dashboard
```
+ Create → Dashboard → Add panel
```

### Step 3: Add Queue Panel (Graph)
```
Metrics:
  trellis2_queued_jobs
  trellis2_active_jobs

Title: Queue Status
Y-axis: Number of Jobs
Refresh: Every 30s
```

### Step 4: Add Processing Time Panel
```
Metrics:
  trellis2_avg_processing_ms
  trellis2_p95_processing_ms

Title: Processing Time
Y-axis: Milliseconds
```

### Step 5: Add Success Rate Panel (Gauge)
```
Metrics:
  trellis2_success_rate_today

Title: Today's Success Rate
Min: 0, Max: 100, Threshold: 80
```

### Step 6: Add Cache Hit Panel (Gauge)
```
Metrics:
  trellis2_cache_hit_ratio

Title: Cache Hit Ratio
Min: 0, Max: 100
```

### Step 7: Add Storage Panel (Gauge)
```
Metrics:
  trellis2_avg_user_storage_percent

Title: Avg User Storage %
Min: 0, Max: 100, Threshold: 90
```

### Step 8: Add Throughput Panel (Graph)
```
Metrics:
  rate(trellis2_completions_per_hour[5m])

Title: Completion Rate
Y-axis: Jobs/second
```

### Step 9: Save dashboard
```
Save → Name: TRELLIS2 Overview → Save
```

---

## Example Dashboard JSON

Import this dashboard into Grafana:

```json
{
  "dashboard": {
    "title": "TRELLIS2 Overview",
    "panels": [
      {
        "title": "Queue Status",
        "targets": [
          {
            "expr": "trellis2_queued_jobs",
            "legendFormat": "Queued"
          },
          {
            "expr": "trellis2_active_jobs",
            "legendFormat": "Active"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Processing Time",
        "targets": [
          {
            "expr": "trellis2_avg_processing_ms",
            "legendFormat": "Average"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Success Rate",
        "targets": [
          {
            "expr": "trellis2_success_rate_today"
          }
        ],
        "type": "gauge"
      }
    ]
  }
}
```

---

## Testing Metrics

### Query metrics in Prometheus

Open http://localhost:9090 and test queries:

```promql
# All queue jobs
trellis2_queue_count

# Success rate last hour
rate(trellis2_success_rate_today[1h])

# Processing time trend
rate(trellis2_avg_processing_ms[5m])

# Cache effectiveness
trellis2_cache_hit_ratio > 50

# Storage alerts
trellis2_avg_user_storage_percent > 90
```

---

## Alerting Setup (Optional)

### Step 1: Configure Alertmanager
```bash
cat > monitoring/alertmanager.yml << 'EOF'
global:
  resolve_timeout: 5m

route:
  receiver: 'default'
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h

receivers:
  - name: 'default'
    # Send to Slack
    slack_configs:
      - api_url: 'YOUR_SLACK_WEBHOOK_URL'
        channel: '#alerts'
        title: '{{ .CommonAnnotations.summary }}'
        text: '{{ .CommonAnnotations.description }}'
        
    # Or send to PagerDuty
    pagerduty_configs:
      - service_key: 'YOUR_PAGERDUTY_KEY'
EOF
```

### Step 2: Start Alertmanager
```bash
docker-compose up -d alertmanager
```

### Step 3: Test alert
```bash
# In Prometheus, manually fire an alert:
# Go to http://localhost:9090/alerts
```

---

## Performance Tuning

### Prometheus Retention
```yaml
# In docker-compose.yml command:
- '--storage.tsdb.retention.time=30d'  # Keep 30 days of data
```

### Grafana Auto-Refresh
- Set dashboard refresh to 30s for real-time monitoring
- Use "last 24 hours" time range by default

### Alert Thresholds (Tune based on your needs)
```yaml
# Adjust in monitoring/rules/trellis2.yml:
trellis2_queued_jobs > 100       # Change to match your queue size
trellis2_avg_processing_ms > 30000  # Change to match SLA
trellis2_success_rate_today < 80    # Change to match expectations
```

---

## Troubleshooting

### Metrics not appearing
```bash
# Check if metrics endpoint is working
curl http://localhost:8080/api/metrics.php

# Check Prometheus scrape targets
http://localhost:9090/targets

# Verify database connection
docker-compose exec db mysql -u root -proot galaxyquest -e "SELECT 1"
```

### Prometheus not scraping
```bash
# Check logs
docker-compose logs prometheus | grep -i error

# Verify config
docker-compose exec prometheus promtool check config /etc/prometheus/prometheus.yml

# Restart Prometheus
docker-compose restart prometheus
```

### Grafana dashboards not loading
```bash
# Check Grafana logs
docker-compose logs grafana | grep -i error

# Verify datasource connection
# In Grafana: Configuration → Data Sources → Prometheus → Test Connection

# Restart Grafana
docker-compose restart grafana
```

### Alerts not firing
```bash
# Check alert rules
http://localhost:9090/rules

# Manually test a query in Prometheus
# If it returns data, alert should fire

# Verify Alertmanager is receiving alerts
docker-compose logs alertmanager
```

---

## Production Checklist

- [ ] Prometheus retention configured (30+ days)
- [ ] Grafana dashboards created and tested
- [ ] Alert rules configured and tested
- [ ] Alertmanager integrated with Slack/PagerDuty/Email
- [ ] Monitoring data backed up
- [ ] Prometheus scrape interval tuned (15-30s)
- [ ] Grafana admin password changed
- [ ] SSL certificates configured (if HTTPS)
- [ ] Monitoring stack in Docker Compose or systemd

---

## Access Points

| Service | URL | Credentials |
|---------|-----|-------------|
| Prometheus | http://localhost:9090 | None |
| Grafana | http://localhost:3000 | admin/admin |
| Alertmanager | http://localhost:9093 | None |
| Metrics Endpoint | http://localhost:8080/api/metrics.php | None |

---

## Next Steps

1. **Create dashboards** in Grafana
2. **Test alert rules** manually
3. **Configure notifications** (Slack, PagerDuty, email)
4. **Set up backups** for Prometheus data
5. **Monitor your first generation job** end-to-end

Happy monitoring! 🚀
