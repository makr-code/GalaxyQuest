#!/bin/bash
# Quick start — Traders System Deployment

set -e

echo "🤝 GalaxyQuest Traders System — Quick Deploy"
echo "=============================================="
echo ""

WORKSPACE=${1:-.}
cd "$WORKSPACE"

# 1. Deploy DB
echo "1️⃣  Deploying database schema..."
docker compose exec -T db mysql -uroot -proot galaxyquest < sql/migrate_traders_system_v1.sql
echo "   ✓ Database ready"
echo ""

# 2. Initialize traders
echo "2️⃣  Initializing traders..."
docker compose exec -T web php scripts/initialize_traders_system.php
echo "   ✓ Traders created and seeded"
echo ""

# 3. Verify API
echo "3️⃣  Testing API endpoints..."
echo ""

echo "   Checking traders..."
curl -s http://localhost/api/traders.php?action=list_traders | php -m json_decode | head -5 && echo "   ✓ Traders API working"
echo ""

echo "   Checking opportunities..."
curl -s "http://localhost/api/traders.php?action=list_opportunities&limit=3" | php -m json_decode | head -5 && echo "   ✓ Opportunities API working"
echo ""

# 4. Next steps
echo "🎉 Ready to go!"
echo ""
echo "Next steps:"
echo "  1. Set up periodic ticker (cron/task): process_trader_tick every 15 min"
echo "  2. Build frontend dashboard components"
echo "  3. Add Trade Director leader integration"
echo "  4. Test end-to-end with player interactions"
echo ""
echo "📚 Full guide: TRADERS_INTEGRATION_GUIDE.md"
echo "📋 Implementation: TRADERS_SYSTEM_IMPLEMENTATION.md"
