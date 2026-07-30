# Cache Implementation Roadmap – GalaxyQuest

## Executive Summary

- **Current Coverage:** 10/62 endpoints cached (16.1%)
- **Missing Coverage:** 52 endpoints (83.9%)
- **High-Impact Gaps:** economy.php, fleet.php, war.php, market.php, glossary.php
- **Estimated Impact:** 30–70% reduction in DB queries + LLM costs
- **Time to Implement:** Phase 1 (CRITICAL): 3–4 sprints

---

## Priority Queue

### 🔴 CRITICAL (Implement First Sprint)

#### 1. `economy.php` – Production Calculations
- **Why:** Expensive computation (war modifiers, supply/demand), hits every user session
- **Operations to cache:**
  - `get_overview` → 15–30 sec TTL, user+colony-scoped
  - `get_production` → 15–30 sec, user+colony-scoped
  - `get_policy` → 2–5 min, user-scoped
  - `get_pop_status` → 20–40 sec, user+colony-scoped
- **Estimated Speedup:** 50–100x
- **Implementation:** Pattern 2 (multi-parameter scoped)
- **Invalidation:** `gq_invalidate_domain('economy', $colony_id)` after production update

#### 2. `fleet.php` – Fleet Management
- **Why:** Real-time fleet status, frequently queried
- **Operations to cache:**
  - `list` → 5–10 sec, user-scoped
  - `check` (arrivals) → 5 sec, user-scoped
  - `ftl_map` → 1 hour, global
  - `wormholes` → 5 min, user+colony-scoped
- **Estimated Speedup:** 30–50x
- **Implementation:** Pattern 4 (binary) for fleet list if compressed
- **Invalidation:** On fleet departure/arrival, call `gq_invalidate_domain('fleet', $fleet_id)`

#### 3. `war.php` – War Strategy
- **Why:** Frequently checked by players in active wars
- **Operations to cache:**
  - `list` → 10–20 sec, user-scoped
  - `get_status` → 15–30 sec, user+war-scoped
  - `get_goal_progress` → 10–20 sec, user+war-scoped
- **Estimated Speedup:** 40–80x
- **Implementation:** Pattern 5 (with invalidation hooks)
- **Invalidation:** On combat resolution, peace offer, goal progress

#### 4. `glossary.php` – LLM Definitions
- **Why:** Massive LLM cost savings, already has 5-day TTL (verify it's working)
- **Operations to cache:**
  - `generate` → Already cached with 5 days, verify working
- **Estimated Speedup:** 600–8000x (LLM avoidance)
- **Implementation:** Verify existing cache is functional
- **Verification:** Check `glossary_cache` scope metrics

---

### 🟠 HIGH (Implement Second Sprint)

#### 5. `politics.php` – Government & Civics
- **Why:** Static catalog data, zero computation overhead
- **Operations to cache:**
  - `catalog` → 7 days, global
  - `presets` → 7 days, global
  - `status` → 2–5 min, user-scoped
- **Estimated Speedup:** 10–30x for catalog, 20–50x for status
- **Implementation:** Pattern 3 (global static) + Pattern 2 (status)
- **Invalidation:** `gq_invalidate_domain('politics', $uid)` on configuration change

#### 6. `diplomacy.php` – Treaties & Agreements
- **Why:** Frequently read, rarely change mid-session
- **Operations to cache:**
  - `list` → 30–60 sec, user-scoped
  - `types` → 1 day, global (static agreement types)
- **Estimated Speedup:** 30–50x
- **Implementation:** Pattern 1 (simple user-scoped) + Pattern 3 (static types)
- **Invalidation:** On agreement status change, `gq_invalidate_domain('diplomacy', $faction_id)`

#### 7. `market.php` – Price Calculations
- **Why:** Expensive elasticity model, frequently accessed
- **Operations to cache:**
  - `get_prices` → 30–60 sec, global (per-good)
  - `get_region_prices` → 30–60 sec, regional (per-system+good)
  - `get_active_events` → 60–120 sec, global
- **Estimated Speedup:** 50–100x (demand model computation)
- **Implementation:** Pattern 2 (multi-param) with careful key design
- **Invalidation:** On trade completion, supply/demand tick, event creation

#### 8. `leaders.php` – Officer Marketplace
- **Why:** Static marketplace + user roster
- **Operations to cache:**
  - `list` → 30–60 sec, user-scoped
  - `marketplace` → 1–2 hours, user-scoped
- **Estimated Speedup:** 20–40x
- **Implementation:** Pattern 2 + Pattern 3
- **Invalidation:** On hire/dismiss/assign, `gq_invalidate_domain('leader', $leader_id)`

---

### 🟡 MEDIUM (Implement Third Sprint)

#### 9. `trade.php` – Trade Routes
- **Why:** Frequently queried but moderately complex
- **Operations:** Trade route list, cost calculations
- **Cache TTL:** 30–60 sec, user-scoped
- **Estimated Speedup:** 20–30x

#### 10. `events.php` – Game Events
- **Why:** Mostly append-only, can safely cache
- **Operations:** Event list, event details
- **Cache TTL:** 2–5 min, user-scoped + global
- **Estimated Speedup:** 10–20x

#### 11. `npc_ai.php` – NPC Logic
- **Why:** Deterministic AI decisions, can be memoized
- **Operations:** AI move suggestions, threat assessments
- **Cache TTL:** 30–120 sec, entity-scoped
- **Estimated Speedup:** 30–60x

---

### 🟢 LOW (Nice-to-Have)

#### 12. `admin_stats.php` – Admin Dashboard
- **Why:** Not performance-critical but still beneficial
- **Cache TTL:** 5–10 min, global
- **Operations:** User counts, resource statistics

#### 13. `textures.php` – Texture Metadata
- **Why:** Static catalog, rare updates
- **Cache TTL:** 1 day, global

#### 14. `project.php` – Projection Data
- **Why:** Read-model, can cache locally
- **Cache TTL:** 30–60 sec, user-scoped

---

## Implementation Timeline

### **Week 1–2: Preparation**
- [ ] Review CACHING_ARCHITECTURE.md with team
- [ ] Set up cache metrics dashboard (admin endpoint)
- [ ] Establish baseline metrics (pre-cache hit rates = 0%)
- [ ] Configure development environment cache settings

### **Week 3–6: Phase 1 – CRITICAL Endpoints**
- [ ] Implement cache in `economy.php` (1 day)
  - Add cache layer to `get_overview`, `get_production`, `get_policy`, `get_pop_status`
  - Test invalidation on building upgrade, production tick
  - Verify metrics show >80% hit rate
  
- [ ] Implement cache in `fleet.php` (1 day)
  - Add cache layer to `list`, `check`, `ftl_map`, `wormholes`
  - Test invalidation on fleet departure/arrival
  
- [ ] Implement cache in `war.php` (1 day)
  - Add cache layer to `list`, `get_status`, `get_goal_progress`
  - Test invalidation on combat, peace offer
  
- [ ] Verify `glossary.php` cache working (0.5 day)
  - Check if 5-day TTL is in effect
  - Monitor LLM token usage reduction

- [ ] Deploy to staging, A/B test (1 day)
  - Compare response times: cached vs. uncached
  - Document performance improvements

- [ ] Code review + merge to main (0.5 day)

**Phase 1 Total:** ~5 days (1 sprint)

### **Week 7–10: Phase 2 – HIGH Impact Endpoints**
- [ ] Implement cache in `politics.php` (0.5 day – mostly static)
- [ ] Implement cache in `diplomacy.php` (0.5 day)
- [ ] Implement cache in `market.php` (1 day – complex key design)
- [ ] Implement cache in `leaders.php` (0.5 day)
- [ ] Staging deployment + A/B test (0.5 day)

**Phase 2 Total:** ~3.5 days (0.5–1 sprint)

### **Week 11–14: Phase 3 – MEDIUM Priority**
- [ ] Implement cache in remaining endpoints (trade, events, npc_ai, etc.)
- [ ] Distributed cache coordination (Redis pubsub for multi-server invalidation)
- [ ] Advanced metrics: cache efficiency report, per-endpoint ROI

**Phase 3 Total:** ~3–5 days (depending on complexity)

---

## Success Metrics

### Before Optimization (Baseline)
- [ ] Measure current response times for critical endpoints
- [ ] Count DB queries per session
- [ ] Monitor LLM token usage (glossary)
- [ ] Record CPU usage, memory footprint

### After Phase 1 Implementation
- [ ] Response time improvement: **>50% for cached endpoints**
- [ ] Cache hit rate: **>80%** across all scopes
- [ ] DB query reduction: **30–50%** for typical session
- [ ] LLM token reduction: **50–70%** (glossary)
- [ ] CPU usage: **20–30%** reduction
- [ ] Memory: <500 MB additional (cache files + APCu)

### Phase 1 Rollout Criteria
- [ ] All critical endpoints have cache implemented
- [ ] Hit rates verified >70%
- [ ] No stale data reported in QA
- [ ] Invalidation hooks firing correctly
- [ ] Load testing passes (no cache contention)

---

## Code Review Checklist

Before merging cache implementation, verify:

- [ ] **Security:** No user-sensitive data in cache (Fog-of-War, private messages, passwords)
- [ ] **Correctness:** Cache key includes all relevant parameters (user_id, colony_id, etc.)
- [ ] **Invalidation:** Mutation endpoints call `gq_invalidate_domain()` or `gq_cache_delete()`
- [ ] **TTL:** Reasonable for data freshness (not 0, not infinity)
- [ ] **Metrics:** `gq_metrics_record_hit()` called appropriately
- [ ] **Testing:** Both cache hit and cache miss paths tested
- [ ] **Performance:** No regression vs. uncached (should be faster)
- [ ] **Documentation:** Function comments explain cache scope & TTL
- [ ] **Error Handling:** Gracefully degrades if cache unavailable
- [ ] **Disk Space:** Cache directory not growing unbounded

---

## Testing Strategy

### Unit Tests
```php
// Test 1: Cache get/set cycle
function test_cache_basic_workflow() {
    gq_cache_set('test_scope', ['id' => 1], ['data' => 'value'], 60);
    $cached = gq_cache_get('test_scope', ['id' => 1]);
    assert($cached === ['data' => 'value']);
    gq_cache_delete('test_scope', ['id' => 1]);
    assert(gq_cache_get('test_scope', ['id' => 1]) === null);
}

// Test 2: Multi-parameter keys don't cross-contaminate
function test_cache_key_isolation() {
    gq_cache_set('scope', ['user_id' => 1], 'user1_data', 60);
    gq_cache_set('scope', ['user_id' => 2], 'user2_data', 60);
    assert(gq_cache_get('scope', ['user_id' => 1]) === 'user1_data');
    assert(gq_cache_get('scope', ['user_id' => 2]) === 'user2_data');
}

// Test 3: Cache invalidation
function test_cache_invalidation() {
    gq_cache_set('war', ['war_id' => 1], ['status' => 'active'], 60);
    gq_invalidate_domain('war', 1);
    assert(gq_cache_get('war', ['war_id' => 1]) === null);
}

// Test 4: Metrics recording
function test_metrics_hit_miss() {
    gq_metrics_flush('test_scope');
    gq_metrics_record_hit('test_scope', ['id' => 1], true);
    gq_metrics_record_hit('test_scope', ['id' => 2], false);
    $metrics = gq_metrics_query('test_scope');
    assert($metrics['hits'] === 1);
    assert($metrics['misses'] === 1);
}
```

### Integration Tests
```php
// Test 1: Economy endpoint caching
// Call GET /api/economy.php?action=get_overview&colony_id=1 twice
// First call: should compute (miss), ~200ms
// Second call: should hit cache, ~2ms
// Wait 35 seconds (past TTL), call again: should recompute

// Test 2: Invalidation on mutation
// Call GET /api/economy.php (cache hits)
// Call POST /api/economy.php?action=set_policy (update)
// Call GET /api/economy.php (should miss, recompute)

// Test 3: Metrics visibility
// Call GET /api/cache_diagnostics.php
// Verify hit rate > 80% for critical endpoints
```

### Load Testing
```bash
# Simulate 100 concurrent users accessing cached endpoints
wrk -t4 -c100 -d30s \
  http://localhost/api/economy.php?action=get_overview
# Should maintain <50ms response time under load
# (uncached: 200–500ms)
```

---

## Rollback Plan

If cache causes issues in production:

1. **Immediate:** Set `CACHE_ENABLED = false` in config.php (no restart needed)
2. **Verify:** Response times return to normal
3. **Diagnose:** Check error logs, metrics
4. **Fix:** Address issue (stale data, invalidation bug, etc.)
5. **Re-enable:** Set `CACHE_ENABLED = true` (optional: increment CACHE_VERSION to flush)

---

## Monitoring & Maintenance

### Daily Checks
```php
// Query hit rates
$telemetry = gq_metrics_export_telemetry();
if ($telemetry['aggregate_hit_rate'] < 70) {
    log_alert('Cache hit rate low: ' . $telemetry['aggregate_hit_rate']);
}

// Check disk usage
$cache_size = shell_exec('du -sh ' . CACHE_DIR);
if ($cache_size > 1000) {  // > 1GB
    gq_cache_flush();  // Manual cleanup if needed
}
```

### Weekly Review
- [ ] Review metrics by scope (which endpoints have poor hit rates?)
- [ ] Adjust TTLs based on observed freshness requirements
- [ ] Check for cache-related bug reports
- [ ] Monitor APCu hit rates (if available)

### Monthly Optimization
- [ ] Analyze cache invalidation patterns (which domains invalidated most?)
- [ ] Consider longer TTLs for stable data
- [ ] Review cache key design (are we invalidating more than necessary?)
- [ ] Update performance baselines

---

## References

- **Architecture:** `/docs/CACHING_ARCHITECTURE.md`
- **Implementation Patterns:** `/docs/CACHE_IMPLEMENTATION_PATTERNS.php`
- **Core APIs:**
  - `/api/cache.php` – Cache get/set/delete/flush
  - `/api/cache_metrics.php` – Hit/miss tracking
  - `/api/cache_invalidation.php` – Domain-based invalidation

---

## FAQ

**Q: Why not just use Redis for everything?**
A: File-based cache is simpler to deploy (no additional service), and APCu tier provides massive speed boost. Redis can be added later for multi-server environments.

**Q: What if APCu is disabled?**
A: Cache still works! File tier alone provides 50–100x speedup (though slower than APCu+file). System degrades gracefully.

**Q: How often should we invalidate the entire cache?**
A: Only on major deployments (increment CACHE_VERSION). For normal game changes, use domain-based invalidation (much faster).

**Q: Can we cache user-private data?**
A: **NO.** Never cache Fog-of-War, private messages, or user credentials. Include user_id in cache key to prevent cross-user leaks.

**Q: What happens if cache gets out of sync?**
A: TTL will eventually expire stale entries. Meanwhile, increment CACHE_VERSION to flush immediately.

**Q: Performance impact of metrics recording?**
A: Negligible (<1ms per request). Recommended for production to track effectiveness.

---

## Next Steps

1. **Review this roadmap with stakeholders**
2. **Schedule Phase 1 sprint** (1 week)
3. **Set up staging environment** with cache enabled
4. **Create JIRA tickets** for each endpoint
5. **Assign implementation tasks** to team members
6. **Plan Performance Testing Day** after Phase 1 completion
