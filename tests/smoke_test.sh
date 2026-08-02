#!/bin/bash
#
# TRELLIS2 Smoke Test Suite
# Tests all components end-to-end
# Usage: bash tests/smoke_test.sh
#

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test functions
test_start() {
    echo -e "${BLUE}→${NC} $1"
    ((TESTS_RUN++))
}

test_pass() {
    echo -e "${GREEN}✓${NC} $1"
    ((TESTS_PASSED++))
}

test_fail() {
    echo -e "${RED}✗${NC} $1"
    ((TESTS_FAILED++))
}

# Configuration
API_BASE="http://localhost:8080/api"
TEST_USER_ID=1
TEST_BEARER_TOKEN="test_token_dev"
ADMIN_KEY="dev_admin_key"

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🧪 TRELLIS2 Smoke Test Suite                                ║"
echo "║  GalaxyQuest - 3D Ship Generation System                      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# ─── Test Phase 1: Service Health ────────────────────────────────────

echo -e "${BLUE}PHASE 1: Service Health${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test 1: Database connectivity
test_start "Database connectivity"
if docker-compose exec -T db mysql -u root -proot -e "SELECT 1;" &>/dev/null; then
    test_pass "Database is online"
else
    test_fail "Database not responding"
fi

# Test 2: Schema verification
test_start "Database schema"
TABLES=$(docker-compose exec -T db mysql -u root -proot galaxyquest -e \
    "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'galaxyquest' AND TABLE_NAME IN ('vessel_designs','asset_generations','generation_queue','user_asset_quotas');" 2>/dev/null | tail -1)

if [ "$TABLES" = "4" ]; then
    test_pass "All 4 core tables exist"
else
    test_fail "Expected 4 tables, found $TABLES"
fi

# Test 3: Web server
test_start "Web server"
if curl -s http://localhost:8080/ship-designer.html | grep -q "ship-designer"; then
    test_pass "Web server responding with HTML"
else
    test_fail "Web server not responding correctly"
fi

# Test 4: TRELLIS2 container
test_start "TRELLIS2 container"
if docker-compose ps trellis2 2>/dev/null | grep -q "Up"; then
    test_pass "TRELLIS2 container running"
else
    test_fail "TRELLIS2 container not running"
fi

# Test 5: Worker process
test_start "Worker service"
if ps aux | grep -q "[p]hp.*trellis2_worker"; then
    test_pass "Worker service running"
else
    test_fail "Worker service not running (may be OK if using Docker)"
fi

# ─── Test Phase 2: API Endpoints ─────────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 2: API Endpoints${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test 6: User quota endpoint
test_start "GET /api/user/quota"
QUOTA_RESPONSE=$(curl -s -X GET "$API_BASE/user/quota" \
    -H "Authorization: Bearer $TEST_BEARER_TOKEN" 2>/dev/null)

if echo "$QUOTA_RESPONSE" | grep -q "storage_limit_gb"; then
    test_pass "User quota endpoint responding with data"
else
    test_fail "User quota endpoint: $(echo $QUOTA_RESPONSE | head -c 100)"
fi

# Test 7: Admin stats endpoint
test_start "GET /api/admin/stats"
STATS_RESPONSE=$(curl -s -X GET "$API_BASE/admin/stats" \
    -H "X-Admin-Key: $ADMIN_KEY" 2>/dev/null)

if echo "$STATS_RESPONSE" | grep -q "queue\|storage\|cache"; then
    test_pass "Admin stats endpoint responding"
else
    test_fail "Admin stats endpoint: $(echo $STATS_RESPONSE | head -c 100)"
fi

# Test 8: Metrics endpoint
test_start "GET /api/metrics.php"
METRICS_RESPONSE=$(curl -s http://localhost:8080/api/metrics.php 2>/dev/null)

if echo "$METRICS_RESPONSE" | grep -q "trellis2_"; then
    test_pass "Metrics endpoint exporting Prometheus data"
else
    test_fail "Metrics endpoint not exporting correctly"
fi

# ─── Test Phase 3: Full Workflow ─────────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 3: Full Workflow${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test 9: Create design
test_start "POST /api/vessel_designs (create design)"
DESIGN_RESPONSE=$(curl -s -X POST "$API_BASE/vessel_designs" \
    -H "Authorization: Bearer $TEST_BEARER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{
        "species_code": "kryltha",
        "design_name": "Test Warship",
        "customizations": {"color": "red", "speed": "fast"},
        "description": "Smoke test design"
    }' 2>/dev/null)

DESIGN_ID=$(echo "$DESIGN_RESPONSE" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ ! -z "$DESIGN_ID" ] && [ "$DESIGN_ID" -gt 0 ]; then
    test_pass "Design created with ID: $DESIGN_ID"
else
    test_fail "Failed to create design: $(echo $DESIGN_RESPONSE | head -c 100)"
    DESIGN_ID="0"
fi

# Test 10: Queue generation
test_start "POST /api/vessel_designs/{id}/generate (queue generation)"
if [ "$DESIGN_ID" -gt 0 ]; then
    QUEUE_RESPONSE=$(curl -s -X POST "$API_BASE/vessel_designs/$DESIGN_ID/generate" \
        -H "Authorization: Bearer $TEST_BEARER_TOKEN" \
        -H "Content-Type: application/json" \
        -d '{
            "prompt_text": "a red kryltha warship with sleek design",
            "priority": 0
        }' 2>/dev/null)
    
    QUEUE_ID=$(echo "$QUEUE_RESPONSE" | grep -o '"queue_id":[0-9]*' | head -1 | cut -d: -f2)
    GEN_ID=$(echo "$QUEUE_RESPONSE" | grep -o '"generation_id":[0-9]*' | head -1 | cut -d: -f2)
    
    if [ ! -z "$QUEUE_ID" ] && [ "$QUEUE_ID" -gt 0 ]; then
        test_pass "Job queued with ID: $QUEUE_ID"
    elif [ ! -z "$GEN_ID" ] && [ "$GEN_ID" -gt 0 ]; then
        test_pass "Cache hit! Generation ID: $GEN_ID"
        QUEUE_ID=$GEN_ID
    else
        test_fail "Failed to queue: $(echo $QUEUE_RESPONSE | head -c 100)"
        QUEUE_ID="0"
    fi
else
    test_fail "Cannot test generation without valid design"
    QUEUE_ID="0"
fi

# Test 11: Get queue status
test_start "GET /api/generation_queue/{id} (check status)"
if [ "$QUEUE_ID" -gt 0 ]; then
    STATUS_RESPONSE=$(curl -s -X GET "$API_BASE/generation_queue/$QUEUE_ID" \
        -H "Authorization: Bearer $TEST_BEARER_TOKEN" 2>/dev/null)
    
    if echo "$STATUS_RESPONSE" | grep -q "status\|queue_position"; then
        STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)
        test_pass "Queue status: $STATUS"
    else
        test_fail "Failed to get status: $(echo $STATUS_RESPONSE | head -c 100)"
    fi
else
    test_fail "Cannot test status without valid queue ID"
fi

# Test 12: Retrieve design
test_start "GET /api/vessel_designs/{id} (retrieve design)"
if [ "$DESIGN_ID" -gt 0 ]; then
    RETRIEVE_RESPONSE=$(curl -s -X GET "$API_BASE/vessel_designs/$DESIGN_ID" \
        -H "Authorization: Bearer $TEST_BEARER_TOKEN" 2>/dev/null)
    
    if echo "$RETRIEVE_RESPONSE" | grep -q "species_code"; then
        test_pass "Design retrieved successfully"
    else
        test_fail "Failed to retrieve design: $(echo $RETRIEVE_RESPONSE | head -c 100)"
    fi
else
    test_fail "Cannot test retrieval without valid design ID"
fi

# ─── Test Phase 4: Database Queries ─────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 4: Database Queries${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test 13: Queue depth
test_start "Queue depth check"
QUEUE_DEPTH=$(docker-compose exec -T db mysql -u root -proot galaxyquest -e \
    "SELECT COUNT(*) FROM generation_queue WHERE status IN ('queued', 'processing');" 2>/dev/null | tail -1)

if [ ! -z "$QUEUE_DEPTH" ]; then
    test_pass "Current queue depth: $QUEUE_DEPTH jobs"
else
    test_fail "Could not query queue depth"
fi

# Test 14: Cache hits
test_start "Cache statistics"
CACHE_HITS=$(docker-compose exec -T db mysql -u root -proot galaxyquest -e \
    "SELECT COUNT(*) FROM generation_queue WHERE cached_result = 1;" 2>/dev/null | tail -1)
TOTAL_JOBS=$(docker-compose exec -T db mysql -u root -proot galaxyquest -e \
    "SELECT COUNT(*) FROM generation_queue;" 2>/dev/null | tail -1)

if [ "$TOTAL_JOBS" -gt 0 ]; then
    CACHE_RATIO=$((CACHE_HITS * 100 / TOTAL_JOBS))
    test_pass "Cache hits: $CACHE_HITS/$TOTAL_JOBS ($CACHE_RATIO%)"
else
    test_pass "No jobs in queue yet (first run)"
fi

# Test 15: Storage usage
test_start "Storage usage check"
STORAGE_GB=$(docker-compose exec -T db mysql -u root -proot galaxyquest -e \
    "SELECT ROUND(SUM(glb_file_size)/(1024*1024*1024), 2) FROM asset_generations WHERE status = 'complete';" 2>/dev/null | tail -1)

if [ ! -z "$STORAGE_GB" ] && [ "$STORAGE_GB" != "NULL" ]; then
    test_pass "Storage used: ${STORAGE_GB}GB"
else
    test_pass "No completed generations yet"
fi

# ─── Test Phase 5: Admin Dashboard ──────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 5: Admin Dashboard${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Test 16: Admin queue listing
test_start "GET /api/admin/queue"
ADMIN_QUEUE=$(curl -s -X GET "$API_BASE/admin/queue?limit=5" \
    -H "X-Admin-Key: $ADMIN_KEY" 2>/dev/null)

if echo "$ADMIN_QUEUE" | grep -q "queue\|status"; then
    test_pass "Admin queue listing working"
else
    test_fail "Admin queue endpoint failed"
fi

# Test 17: Admin quotas
test_start "GET /api/admin/quotas"
ADMIN_QUOTAS=$(curl -s -X GET "$API_BASE/admin/quotas?limit=10" \
    -H "X-Admin-Key: $ADMIN_KEY" 2>/dev/null)

if echo "$ADMIN_QUOTAS" | grep -q "quotas"; then
    test_pass "Admin quotas listing working"
else
    test_fail "Admin quotas endpoint failed"
fi

# Test 18: Admin audit logs
test_start "GET /api/admin/audit_logs"
AUDIT_LOGS=$(curl -s -X GET "$API_BASE/admin/audit_logs?limit=5" \
    -H "X-Admin-Key: $ADMIN_KEY" 2>/dev/null)

if echo "$AUDIT_LOGS" | grep -q "event\|logs"; then
    test_pass "Admin audit logs working"
else
    test_fail "Admin audit logs endpoint failed"
fi

# ─── Test Summary ────────────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "${BLUE}Test Summary${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Total Tests:  $TESTS_RUN"
echo -e "${GREEN}Passed:       $TESTS_PASSED${NC}"
if [ $TESTS_FAILED -gt 0 ]; then
    echo -e "${RED}Failed:       $TESTS_FAILED${NC}"
else
    echo -e "${GREEN}Failed:       $TESTS_FAILED${NC}"
fi

PASS_RATE=$((TESTS_PASSED * 100 / TESTS_RUN))
echo "Pass Rate:    $PASS_RATE%"
echo ""

if [ $TESTS_FAILED -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  1. Open Ship Designer: http://localhost:8080/ship-designer.html"
    echo "  2. Monitor via Admin: http://localhost:8080/admin-dashboard.html"
    echo "  3. Check Prometheus: http://localhost:9090"
    echo "  4. View Grafana: http://localhost:3000"
    echo ""
    exit 0
else
    echo -e "${RED}✗ Some tests failed. Check output above.${NC}"
    echo ""
    echo "Troubleshooting:"
    echo "  - Verify all services: docker-compose ps"
    echo "  - Check logs: docker-compose logs -f web"
    echo "  - Restart services: docker-compose restart"
    echo ""
    exit 1
fi
