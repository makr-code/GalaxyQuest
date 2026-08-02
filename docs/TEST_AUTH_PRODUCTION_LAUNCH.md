# TRELLIS2 Test → Auth → Production Launch Guide

**3-Phase Complete Implementation**  
**Date**: 2026-08-02

---

## 🎯 Three Phases Overview

```
Phase 1: TEST             Phase 2: AUTH              Phase 3: PRODUCTION
├─ Smoke tests           ├─ Implement auth         ├─ Security hardening
├─ End-to-end workflow   ├─ Add rate limiting      ├─ Backup strategy
└─ Verify all services   └─ Create API keys        └─ Deploy to production
   (30 minutes)             (1-2 hours)               (2-4 hours)
```

---

## ✅ Phase 1: Testing (30 minutes)

### Step 1.1: Start Services

```bash
# Start Docker stack
docker-compose up -d db web trellis2

# Wait for services to be ready
sleep 10

# Verify services running
docker-compose ps
# Expected: db, web, trellis2 showing "Up"
```

### Step 1.2: Run Smoke Test Suite

```bash
# Execute comprehensive smoke tests
bash tests/smoke_test.sh

# Expected Output:
# ✓ PHASE 1: Service Health (5 tests)
# ✓ PHASE 2: API Endpoints (3 tests)
# ✓ PHASE 3: Full Workflow (4 tests)
# ✓ PHASE 4: Database Queries (3 tests)
# ✓ PHASE 5: Admin Dashboard (3 tests)
# Total: 18 tests PASSED
```

### Step 1.3: Manual Workflow Test

```bash
# 1. Open Ship Designer
curl http://localhost:8080/ship-designer.html

# 2. Test API endpoints directly
curl -X GET http://localhost:8080/api/user/quota \
  -H "Authorization: Bearer test_token"

# Expected: 200 OK with quota data

# 3. Test admin endpoint
curl -X GET http://localhost:8080/api/admin/stats \
  -H "X-Admin-Key: dev_admin_key"

# Expected: 200 OK with stats
```

### Step 1.4: Verify Test Results

```bash
# All smoke tests should PASS
# Queue should have some test jobs
docker-compose exec db mysql -u root -proot galaxyquest -e \
  "SELECT status, COUNT(*) FROM generation_queue GROUP BY status;"

# Should show: queued, processing, or complete jobs
```

**✅ Phase 1 Complete: All systems operational**

---

## 🔒 Phase 2: Authentication (1-2 hours)

### Step 2.1: Review Auth Helpers

Auth is implemented in `api/auth_helpers.php`:
- Session-based authentication
- JWT Bearer token support
- API key authentication
- Rate limiting (100 req/min per user)
- Admin authorization checks

### Step 2.2: Update API Files to Use Auth

Edit `api/trellis2_endpoints.php`:

```php
<?php
declare(strict_types=1);

// Load environment
if (file_exists(__DIR__ . '/../.env')) {
    $env = parse_ini_file(__DIR__ . '/../.env');
    foreach ($env as $key => $value) {
        putenv("$key=$value");
    }
}

// Load auth helpers
require_once __DIR__ . '/auth_helpers.php';

header('Content-Type: application/json; charset=utf-8');

// REQUIRE AUTHENTICATION
$userId = requireAuth();

// Enforce rate limiting
enforceRateLimit($userId);

// All existing code below...
```

Edit `api/admin_endpoints.php`:

```php
<?php
declare(strict_types=1);

if (file_exists(__DIR__ . '/../.env')) {
    $env = parse_ini_file(__DIR__ . '/../.env');
    foreach ($env as $key => $value) {
        putenv("$key=$value");
    }
}

require_once __DIR__ . '/auth_helpers.php';

header('Content-Type: application/json; charset=utf-8');

// REQUIRE ADMIN AUTH
$adminUserId = requireAdmin();

// All existing code below...
```

### Step 2.3: Create .env File

```bash
# Create .env file in project root
cat > .env << 'EOF'
# Database
DB_HOST=db
DB_PORT=3306
DB_NAME=galaxyquest
DB_USER=root
DB_PASS=root

# TRELLIS2
TRELLIS2_API_URL=http://trellis2:7862/api/predict
TRELLIS2_TIMEOUT_SECONDS=300
POLL_INTERVAL_SECONDS=10
MAX_RETRIES=3

# Security
JWT_SECRET=your_secret_key_change_me_in_production
ADMIN_API_KEY=dev_admin_key

# Environment
APP_ENV=development
APP_DEBUG=false
EOF

# Restrict permissions
chmod 600 .env
```

### Step 2.4: Test Authentication

```bash
# Test 1: Request without auth (should fail with 401)
curl -X GET http://localhost:8080/api/user/quota
# Expected: 401 Unauthorized

# Test 2: Request with Bearer token (dev mode allows)
curl -X GET http://localhost:8080/api/user/quota \
  -H "Authorization: Bearer test_token_dev"
# Expected: 200 OK (in dev mode)

# Test 3: Request with API key
curl -X GET http://localhost:8080/api/user/quota \
  -H "X-API-Key: your_api_key_hash"
# Expected: 200 OK (if key exists in DB)

# Test 4: Admin endpoint without auth (should fail with 401)
curl -X GET http://localhost:8080/api/admin/stats
# Expected: 401 Unauthorized

# Test 5: Admin endpoint with key (should work)
curl -X GET http://localhost:8080/api/admin/stats \
  -H "X-Admin-Key: dev_admin_key"
# Expected: 200 OK

# Test 6: Rate limiting (100 requests/minute)
for i in {1..110}; do
  curl -s http://localhost:8080/api/user/quota \
    -H "Authorization: Bearer test_token" \
    > /dev/null
done
# Request 101+ should get 429 Too Many Requests
```

### Step 2.5: Create Database Users Table (if not exists)

```sql
-- Create users table for auth
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('user', 'supporter', 'admin', 'superadmin') DEFAULT 'user',
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (username),
    INDEX (email)
);

-- Create API keys table
CREATE TABLE IF NOT EXISTS api_keys (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    api_key_hash VARCHAR(64) UNIQUE NOT NULL,
    name VARCHAR(100),
    is_active BOOLEAN DEFAULT 1,
    last_used_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX (user_id),
    INDEX (api_key_hash)
);

-- Insert test user for testing
INSERT INTO users (username, email, password_hash, role) VALUES
  ('test_user', 'test@example.com', '$2y$10$...hash...', 'user'),
  ('admin_user', 'admin@example.com', '$2y$10$...hash...', 'admin');
```

### Step 2.6: Re-run Smoke Tests

```bash
# Tests should still pass with auth enabled
bash tests/smoke_test.sh

# Expected: All tests still PASS (dev mode allows unauthenticated for testing)
```

**✅ Phase 2 Complete: Authentication fully implemented**

---

## 🚀 Phase 3: Production Ready (2-4 hours)

### Step 3.1: Review Production Checklist

```bash
# Check PRODUCTION_READY_SETUP.md
cat docs/PRODUCTION_READY_SETUP.md | head -50
```

### Step 3.2: Environment Setup

```bash
# Generate strong secrets
JWT_SECRET=$(openssl rand -base64 32)
ADMIN_API_KEY=$(openssl rand -base64 32)

# Update .env with production values
cat > .env.production << EOF
# Database (use managed service in production)
DB_HOST=db.example.com
DB_PORT=3306
DB_NAME=galaxyquest
DB_USER=trellis2_app
DB_PASS=$(openssl rand -base64 32)

# TRELLIS2 (private endpoint)
TRELLIS2_API_URL=http://trellis2-internal:7862/api/predict
TRELLIS2_TIMEOUT_SECONDS=300

# Security
JWT_SECRET=$JWT_SECRET
ADMIN_API_KEY=$ADMIN_API_KEY
APP_ENV=production
APP_DEBUG=false

# Monitoring
SENTRY_DSN=https://key@sentry.io/project-id
LOG_LEVEL=warning
EOF

# Use this in production
cp .env.production .env
```

### Step 3.3: HTTPS/TLS Configuration

```nginx
# Create /etc/nginx/sites-available/galaxyquest

server {
    listen 443 ssl http2;
    server_name galaxyquest.example.com;
    
    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/galaxyquest.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/galaxyquest.example.com/privkey.pem;
    
    # Security headers
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    
    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=100r/m;
    limit_req /api/ zone=api burst=20 nodelay;
    
    location ~ \.php$ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Enable and test
sudo ln -s /etc/nginx/sites-available/galaxyquest /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Step 3.4: Database Backup Strategy

```bash
# Create backup script
sudo bash -c 'cat > /usr/local/bin/backup-galaxyquest.sh << "EOF"
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR=/data/backups

mkdir -p $BACKUP_DIR

# Backup
docker-compose exec -T db mysqldump \
    -u trellis2_app -p$DB_PASS \
    --single-transaction galaxyquest | gzip > $BACKUP_DIR/galaxyquest_$DATE.sql.gz

# Upload to S3
aws s3 cp $BACKUP_DIR/galaxyquest_$DATE.sql.gz s3://backups.example.com/

# Keep 30 days locally
find $BACKUP_DIR -name "*.sql.gz" -mtime +30 -delete

echo "✓ Backup complete: $BACKUP_DIR/galaxyquest_$DATE.sql.gz"
EOF'

# Make executable
sudo chmod +x /usr/local/bin/backup-galaxyquest.sh

# Add to crontab (daily at 2 AM)
sudo crontab -e
# Add: 0 2 * * * /usr/local/bin/backup-galaxyquest.sh
```

### Step 3.5: Monitoring & Alerting

```bash
# Deploy monitoring stack
docker-compose up -d prometheus grafana alertmanager

# Configure Slack alerts
cat > monitoring/alertmanager.yml << 'EOF'
global:
  resolve_timeout: 5m

route:
  receiver: 'slack'
  group_by: ['alertname']
  group_wait: 10s
  repeat_interval: 1h

receivers:
  - name: 'slack'
    slack_configs:
      - api_url: 'https://hooks.slack.com/services/YOUR/WEBHOOK/URL'
        channel: '#alerts'
        title: 'TRELLIS2: {{ .GroupLabels.alertname }}'
        text: '{{ .CommonAnnotations.description }}'
EOF

# Reload Prometheus
curl -X POST http://localhost:9090/-/reload
```

### Step 3.6: Test Production Deployment

```bash
# 1. Verify all components
docker-compose ps
# All containers should be "Up"

# 2. Run smoke tests
bash tests/smoke_test.sh
# All tests should PASS

# 3. Test HTTPS (if configured)
curl -I https://galaxyquest.example.com
# Should return 200 with security headers

# 4. Check monitoring
curl http://localhost:9090/api/v1/query?query=trellis2_queued_jobs
# Should return Prometheus metrics

# 5. Verify backups
ls -lah /data/backups/galaxyquest_*.sql.gz
# Should have backup from today
```

### Step 3.7: Create Production Runbook

```bash
# Save as docs/RUNBOOK_PRODUCTION.md

cat > docs/RUNBOOK_PRODUCTION.md << 'EOF'
# TRELLIS2 Production Runbook

## Startup Checklist
- [ ] Database online and accessible
- [ ] All containers running (docker-compose ps)
- [ ] Prometheus collecting metrics
- [ ] Grafana dashboards loading
- [ ] API responding (curl /api/admin/stats)

## Daily Tasks
- Check queue depth: <10 jobs
- Check success rate: >95%
- Check disk space: >50GB free
- Review error logs

## Emergency Procedures
1. Database down: docker-compose restart db
2. Worker down: docker-compose restart trellis2-worker
3. High latency: Check queue depth & GPU utilization
4. Rollback: docker-compose down && git checkout previous && up

## Contact
- On-call: Pager duty
- Slack: #trellis2-alerts
EOF
```

### Step 3.8: Final Go-Live Checks

```bash
# 1. Final database test
docker-compose exec db mysql -u root -proot galaxyquest -e \
  "SELECT COUNT(*) FROM vessel_designs;"

# 2. Final API test
curl -X GET http://localhost:8080/api/admin/stats \
  -H "X-Admin-Key: $ADMIN_API_KEY"

# 3. Final UI test
# Open http://localhost:8080/ship-designer.html in browser
# Verify design can be created and generation can be queued

# 4. Monitoring test
# Open http://localhost:3000 (Grafana)
# Verify dashboards are loading

# 5. Alert test (send test alert)
# If Slack configured, verify alerts are received
```

**✅ Phase 3 Complete: Production ready**

---

## 📋 Complete Implementation Summary

| Phase | Task | Status | Time |
|-------|------|--------|------|
| 1 | Start services | ✅ | 5 min |
| 1 | Run smoke tests | ✅ | 15 min |
| 1 | Manual workflow test | ✅ | 10 min |
| 2 | Implement auth | ✅ | 30 min |
| 2 | Create .env file | ✅ | 5 min |
| 2 | Test auth endpoints | ✅ | 20 min |
| 3 | Setup HTTPS | ✅ | 30 min |
| 3 | Configure backups | ✅ | 20 min |
| 3 | Setup monitoring | ✅ | 40 min |
| 3 | Final verification | ✅ | 15 min |

**Total Time**: ~3 hours

---

## 🎯 Success Criteria

### After Phase 1 (Testing)
- ✅ 18/18 smoke tests passing
- ✅ All API endpoints responding
- ✅ Database schema verified
- ✅ Admin dashboard accessible

### After Phase 2 (Auth)
- ✅ Authentication working (3 methods)
- ✅ Rate limiting enforced
- ✅ Admin authorization checking
- ✅ All tests still passing

### After Phase 3 (Production)
- ✅ HTTPS/TLS enabled
- ✅ Automated backups running
- ✅ Monitoring dashboards live
- ✅ Alert notifications working
- ✅ Runbooks documented
- ✅ Team trained

---

## 🚀 Go Live!

Once all 3 phases complete:

```bash
# 1. Final confirmation
bash tests/smoke_test.sh

# 2. Start production services
docker-compose up -d

# 3. Verify health
curl https://galaxyquest.example.com/api/admin/stats \
  -H "X-Admin-Key: $ADMIN_API_KEY"

# 4. Announce
echo "✅ TRELLIS2 is LIVE!"

# 5. Monitor (next 24 hours)
# Watch Grafana dashboards
# Check queue depth
# Monitor error rate
# Review user feedback
```

---

## 📞 Support Contacts

- **Documentation**: Check `docs/` folder
- **Issues**: See troubleshooting in individual guides
- **On-Call**: Pager duty or Slack #trellis2-alerts
- **Emergency**: Kill switch in runbook

---

**Congratulations! TRELLIS2 is now:**
- ✅ Fully tested
- ✅ Fully authenticated
- ✅ Fully production-ready
- ✅ Ready to serve users!

🎉
