#!/bin/bash
#
# TRELLIS2 Quick Start — Get up and running in 5 minutes
#
# This script automates the deployment process
# Usage: bash scripts/trellis2_quickstart.sh
#

set -e

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║  🚀 TRELLIS2 Quick Start Deployment                           ║"
echo "║  GalaxyQuest - 3D Ship Generation System                      ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_step() {
    echo -e "${BLUE}→${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# ─── Phase 1: Verify Prerequisites ─────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 1: Verifying Prerequisites${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check Docker
if command -v docker &> /dev/null; then
    print_success "Docker installed"
else
    print_error "Docker not found. Please install Docker first."
    exit 1
fi

# Check Docker Compose
if command -v docker-compose &> /dev/null; then
    print_success "Docker Compose installed"
else
    print_error "Docker Compose not found. Please install Docker Compose first."
    exit 1
fi

# Check MySQL client
if command -v mysql &> /dev/null; then
    print_success "MySQL client installed"
else
    print_warning "MySQL client not found. Some checks will be skipped."
fi

# Check PHP
if command -v php &> /dev/null; then
    print_success "PHP installed"
else
    print_warning "PHP not found. Worker will need to run via Docker."
fi

# ─── Phase 2: Database Setup ──────────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 2: Database Setup${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

print_step "Checking if database is running..."
if docker-compose ps db 2>/dev/null | grep -q "Up"; then
    print_success "Database is running"
else
    print_step "Starting database..."
    docker-compose up -d db
    sleep 10
    print_success "Database started"
fi

# Check if migration already applied
print_step "Checking if TRELLIS2 schema already exists..."
if mysql -h 127.0.0.1 -u root -proot galaxyquest -e "SELECT 1 FROM vessel_designs LIMIT 1;" 2>/dev/null; then
    print_success "TRELLIS2 schema already applied"
else
    print_step "Running database migration..."
    docker-compose exec -T db mysql -u root -proot galaxyquest < sql/migrate_trellis2_integration_v1.sql
    print_success "Database schema migrated"
fi

# ─── Phase 3: Start Services ──────────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 3: Starting Services${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

print_step "Starting Docker containers..."
docker-compose up -d web db
print_success "Docker services started"

print_step "Waiting for services to be ready..."
sleep 5

# ─── Phase 4: Start Worker ────────────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 4: Start TRELLIS2 Worker${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

print_step "Starting worker service..."
read -p "Run worker in (1) Docker, (2) PHP direct, or (3) Skip: " -n 1 worker_choice
echo ""

case $worker_choice in
    1)
        docker-compose run -d --name trellis2-worker \
            -e TRELLIS2_API_URL=http://trellis2:7862/api/predict \
            -e POLL_INTERVAL_SECONDS=10 \
            web php scripts/trellis2_worker.php
        print_success "Worker started in Docker"
        ;;
    2)
        nohup php scripts/trellis2_worker.php > /tmp/trellis2-worker.log 2>&1 &
        print_success "Worker started (check /tmp/trellis2-worker.log)"
        ;;
    3)
        print_warning "Worker will not run. Start it manually later."
        ;;
    *)
        print_error "Invalid option"
        exit 1
        ;;
esac

# ─── Phase 5: Verify Installation ────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 5: Verification${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

print_step "Testing API endpoints..."

# Test user quota endpoint
if curl -s http://localhost:8080/api/user/quota &>/dev/null; then
    print_success "User quota API responding"
else
    print_warning "User quota API not responding yet (may need more time)"
fi

# Test admin stats endpoint
if curl -s -H "X-Admin-Key: dev_admin_key" http://localhost:8080/api/admin/stats &>/dev/null; then
    print_success "Admin API responding"
else
    print_warning "Admin API not responding yet"
fi

# ─── Phase 6: Display Access URLs ────────────────────────────────

echo ""
echo -e "${BLUE}PHASE 6: Access Points${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
echo -e "${GREEN}✓ TRELLIS2 is ready! Access at:${NC}"
echo ""
echo "  🎮 Ship Designer:"
echo "     ${BLUE}http://localhost:8080/ship-designer.html${NC}"
echo ""
echo "  ⚙️  Admin Dashboard:"
echo "     ${BLUE}http://localhost:8080/admin-dashboard.html${NC}"
echo "     (Add header: -H 'X-Admin-Key: dev_admin_key')"
echo ""
echo "  📚 Documentation:"
echo "     - Integration Guide:    ${BLUE}docs/SHIP_DESIGNER_INTEGRATION.md${NC}"
echo "     - Complete Guide:       ${BLUE}TRELLIS2_COMPLETE_INTEGRATION.md${NC}"
echo "     - Deployment Checklist: ${BLUE}DEPLOYMENT_CHECKLIST.md${NC}"
echo ""

# ─── Phase 7: Next Steps ─────────────────────────────────────────

echo -e "${BLUE}NEXT STEPS:${NC}"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. Open Ship Designer and generate your first ship:"
echo "   ${BLUE}http://localhost:8080/ship-designer.html${NC}"
echo ""
echo "2. Monitor queue status in admin dashboard:"
echo "   ${BLUE}http://localhost:8080/admin-dashboard.html${NC}"
echo ""
echo "3. Check logs:"
echo "   ${BLUE}docker-compose logs -f web${NC}"
echo "   ${BLUE}docker-compose logs -f db${NC}"
echo "   ${BLUE}tail -50 /tmp/trellis2-worker.log${NC}"
echo ""
echo "4. Test API directly:"
echo "   ${BLUE}curl -X GET http://localhost:8080/api/user/quota${NC}"
echo ""
echo "5. When ready for production:"
echo "   - Review DEPLOYMENT_CHECKLIST.md"
echo "   - Configure authentication"
echo "   - Setup monitoring"
echo "   - Deploy!"
echo ""

print_success "Quick start complete!"
echo ""
echo "Questions? Check the documentation or run:"
echo "  ${BLUE}docker-compose logs -f${NC}"
echo ""
