# GalaxyQuest Cache Quick Reference Card

## 🚀 Quick Start (30 seconds)

### 1. Check Cache Status
```bash
curl http://localhost/api/cache_diagnostics.php | jq .health
# Shows: status, hit_rate, total_requests
```

### 2. Add Cache to an Endpoint (2 min)
Copy-paste from appropriate pattern in `/docs/CACHE_IMPLEMENTATION_PATTERNS.php`:
```php
require_once __DIR__ . '/cache.php';

$cacheKey = ['user_id' => $uid];  // Adjust params based on endpoint
$cached = gq_cache_get('scope_name', $cacheKey);
if ($cached !== null) {
    json_ok($cached);
    return;
}

$data = compute_data(...);
gq_cache_set('scope_name', $cacheKey, $data, 60);  // 60 sec TTL
json_ok($data);
```

### 3. Invalidate on Mutation (1 line)
```php
require_once __DIR__ . '/cache_invalidation.php';
gq_invalidate_domain('my_domain', $entity_id);
```

---

## 📚 Core APIs

### Cache Operations
| Function | Purpose | Example |
|----------|---------|---------|
| `gq_cache_get($scope, $params)` | Get JSON value | `gq_cache_get('diplomacy', ['uid' => 1])` |
| `gq_cache_set($scope, $params, $data, $ttl)` | Store JSON value | `gq_cache_set('diplomacy', ['uid' => 1], $data, 60)` |
| `gq_cache_get_raw($scope, $params)` | Get binary | For Binary-V3 payloads |
| `gq_cache_set_raw($scope, $params, $bytes, $ttl)` | Store binary | For Binary-V3 payloads |
| `gq_cache_delete($scope, $params)` | Delete entry | `gq_cache_delete('scope', ['key' => $val])` |
| `gq_cache_flush($scope)` | Clear scope | `gq_cache_flush('diplomacy')` |

### Invalidation
| Function | Purpose | Example |
|----------|---------|---------|
| `gq_invalidate_domain($domain, $id)` | Invalidate affected scopes | `gq_invalidate_domain('war', $war_id)` |
| `gq_invalidate_user($uid)` | Clear user caches | After user policy change |
| `gq_invalidate_system($gal, $sys)` | Clear system caches | After colonization |
| `gq_invalidate_batch($invalidations)` | Bulk invalidation | Multiple domains at once |

### Metrics
| Function | Purpose | Example |
|----------|---------|---------|
| `gq_metrics_record_hit($scope, $params, $hit, $bytes, $ms)` | Track access | Auto-called if metrics.php loaded |
| `gq_metrics_query($scope)` | Get scope metrics | `$m = gq_metrics_query('game_overview')` |
| `gq_metrics_hit_rate($scope)` | Hit rate % | `echo gq_metrics_hit_rate();` |
| `gq_metrics_export_telemetry()` | Full dashboard | Returns JSON for admin panel |

---

## 🎯 Cache Key Patterns

### Global (Everyone sees same data)
```php
$key = [];                      // Completely static
$key = ['term' => 'white_dwarf'];  // Parameterized global
```

### User-Scoped
```php
$key = ['user_id' => $uid];     // User-level
$key = ['user_id' => $uid, 'colony_id' => $c];  // User + entity
```

### System-Scoped
```php
$key = ['galaxy' => $g, 'system' => $s];  // System level
```

---

## ⏱️ Recommended TTLs

| Data Type | TTL | Examples |
|-----------|-----|----------|
| Real-time volatile | 5–10s | Fleet lists, FTL status |
| High-frequency compute | 15–60s | Economy overview, war status |
| Stable but mutable | 2–5m | Policies, agreements, leadership |
| Static catalog | 1 day–7 days | Politics catalog, glossary, ship definitions |

---

## 🔄 Invalidation Map

| Domain | Affected Scopes | Trigger Event |
|--------|-----------------|---------------|
| `colony` | game_overview, game_resources, system_payload_base | Building placed/upgraded |
| `fleet` | game_overview, system_payload_base | Fleet departure/arrival |
| `war` | faction_relations, war_status | War declared/ended |
| `economy` | game_overview, game_resources | Tax/subsidy change |
| `building` | system_payload_base, game_overview | Construction completed |
| `leader` | game_overview, leaders_list | Leader hired/dismissed |

**Full mapping in:** `/api/cache_invalidation.php` (INVALIDATION_MAP constant)

---

## 📊 Admin Dashboard

**URL:** `/api/cache_diagnostics.php`

**Key Actions:**
```
?action=summary              # Overall health
?action=scope_detail&scope=X # Drill into scope X
?action=system_info         # APCu + disk status
?action=invalidation_hooks  # Hook registrations

POST ?action=clear_scope&scope=X        # Manual clear
POST ?action=clear_all&confirm=yes      # Nuke everything
POST ?action=reset_metrics&scope=X      # Reset stats
```

**Dashboard Shows:**
- Aggregate hit rate (target: >80%)
- Recommendations (auto-generated based on metrics)
- Top-performing scopes
- Disk usage, memory footprint
- Entry counts and freshness

---

## ✅ Before Deploying Cache

- [ ] Cache key includes **all** user-scoped params (user_id, colony_id)
- [ ] No user-private data cached (Fog-of-War, messages, passwords)
- [ ] TTL is reasonable (not 0, not infinity)
- [ ] Mutation endpoints call `gq_invalidate_domain()`
- [ ] Tested cache hit and cache miss separately
- [ ] Metrics show >70% hit rate
- [ ] Hit rates improving over time (not degrading)
- [ ] No stale data in testing

---

## 🚨 Troubleshooting

### Cache not working?
```php
var_dump(CACHE_ENABLED);        // Should be true
var_dump(CACHE_DIR);            // Should be writable
var_dump(is_dir(CACHE_DIR));    // Should exist
```

### Hit rate too low?
1. Check if enabled: `CACHE_ENABLED = true`
2. Use `/api/cache_diagnostics.php?action=scope_detail&scope=X` to inspect
3. Increase TTL if data stable longer than expected
4. Check for aggressive invalidation clearing cache too often

### Disk growing?
```php
$size = shell_exec('du -sh ' . CACHE_DIR);
if ($size > 500) gq_cache_flush();  // Manual cleanup
```

### Memory usage?
- Check APCu: `php -i | grep apc.shm_size` (default 32MB)
- Increase if needed: `apc.shm_size = 256M` in php.ini

---

## 📍 File Locations

| File | Purpose |
|------|---------|
| `/api/cache.php` | Core cache API (gq_cache_get/set) |
| `/api/cache_metrics.php` | Metrics tracking |
| `/api/cache_invalidation.php` | Domain invalidation |
| `/api/cache_diagnostics.php` | Admin dashboard |
| `/config/config.php` (lines 98–105) | Cache configuration |
| `/docs/CACHING_ARCHITECTURE.md` | Full architecture guide |
| `/docs/CACHE_IMPLEMENTATION_PATTERNS.php` | Copy-paste code examples |
| `/docs/CACHE_IMPLEMENTATION_ROADMAP.md` | 3-phase plan |

---

## 🎓 Learning Path

1. **Start here:** Read `/CACHE_AUDIT_SUMMARY.md` (5 min)
2. **Then:** Review `/docs/CACHING_ARCHITECTURE.md` section 1-3 (10 min)
3. **Hands-on:** Copy pattern from `/docs/CACHE_IMPLEMENTATION_PATTERNS.php` (5 min)
4. **Test:** Use `/api/cache_diagnostics.php` to verify metrics (2 min)
5. **Deploy:** Follow checklist before committing (5 min)

**Total time to first cache:** ~30 minutes

---

## 💡 Pro Tips

### Tip 1: Composite Keys
Combine multiple parameters for precise cache isolation:
```php
$key = [
    'user_id' => $uid,
    'colony_id' => $colony_id,
    'filter_type' => 'military',  // Include filter params
];
```

### Tip 2: Lazy Invalidation
Use TTL for automatic expiration instead of complex invalidation:
```php
gq_cache_set('data', $key, $value, 30);  // Expires in 30s anyway
// No need for sophisticated hook if TTL is short enough
```

### Tip 3: Binary Payloads
For large responses (100+ KB), use binary caching:
```php
$encoded = compress_v3($data);  // Compress first
gq_cache_set_raw('scope', $key, $encoded, 60);  // Store binary
// Saves serialization/deserialization overhead
```

### Tip 4: Monitor Hit Rates
Set up daily metric checks:
```php
$rate = gq_metrics_hit_rate();
if ($rate < 70) alert("Cache hit rate low: $rate%");
```

### Tip 5: Staggered TTLs
Use slightly different TTLs to avoid thundering herd:
```php
$ttl = $baseTime + rand(-5, 5);  // Spread expiration
gq_cache_set('scope', $key, $data, $ttl);
```

---

## 🔗 Related Documentation

- **Architecture Deep Dive:** `/docs/CACHING_ARCHITECTURE.md`
- **Code Patterns:** `/docs/CACHE_IMPLEMENTATION_PATTERNS.php`
- **Execution Plan:** `/docs/CACHE_IMPLEMENTATION_ROADMAP.md`
- **Executive Summary:** `/CACHE_AUDIT_SUMMARY.md`

---

## 📞 Questions?

Check the comprehensive guides in `/docs/` or grep the source:
```bash
grep -n "function gq_cache" api/cache.php       # API reference
grep -n "INVALIDATION_MAP" api/cache_invalidation.php  # Domain map
grep -A 30 "Pattern 2" docs/CACHE_IMPLEMENTATION_PATTERNS.php  # Examples
```

---

**Last Updated:** 2026-07-30  
**Status:** Production Ready  
**Maintenance:** Check `/api/cache_diagnostics.php` weekly
