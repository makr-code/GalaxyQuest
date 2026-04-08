# Wave 17 – Full Domain Feature Completion

**Target**: 100% feature parity Pirates + Economy + War  
**Strategy**: Integrated implementation (dependencies first)  
**Estimated Effort**: ~240-300 hours  
**Last Updated**: 7 April 2026

---

## Dependency Graph

```
Foundation Layer
├─ Pop Satisfaction System (Economy) [PHASE 1.1]
├─ War Supply Mechanics (War) [PHASE 1.2]
└─ Pirate Defense Framework (Pirates) [PHASE 1.3]
    ↓
Integration Layer
├─ War→Economy Coupling [PHASE 2.1]
├─ Pirates→Colony Damage [PHASE 2.2]
├─ Economy→Production Impact [PHASE 2.3]
└─ NPC Reactions [PHASE 2.4]
    ↓
Feature Layer
├─ Pirates Contracts & Standing [PHASE 3.1]
├─ Economy Tier-3 Goods [PHASE 3.2]
├─ War Diplomacy UI [PHASE 3.3]
└─ Complex Goal Tracking [PHASE 3.4]
    ↓
UI/UX Layer
├─ War Declaration UI [PHASE 4.1]
├─ Economy Production Warnings [PHASE 4.2]
├─ Pirates Threat Dashboard [PHASE 4.3]
└─ Unified Conflict Dashboard [PHASE 4.4]
    ↓
Testing & Validation [PHASE 5]
```

---

## PHASE 1: FOUNDATION LAYER (60-80 hours)

### 1.1 Pop Satisfaction System (Economy)
**Files to modify:**
- `sql/economy_init.sql` — Add satisfaction_index, migration_rate to economy_pop_classes
- `api/economy.php` — New endpoints: `get_pop_status`, `set_pop_policy`
- `api/game_engine.php` — Tick: Apply satisfaction decay/migration logic

**Gap Items:**
- [ ] Database schema for pop satisfaction tracking
- [ ] Satisfaction calculation algorithm (employment, wages, happiness, culture)
- [ ] Population migration mechanics (move between colonies/factions)
- [ ] Satisfaction → production multiplier coupling
- [ ] UI display for pop satisfaction per class

**Acceptance Criteria:**
- Pop satisfaction changes affect production yield
- Migration between colonies visible in UI
- Each tick recalculates and applies effects

---

### 1.2 War Supply Mechanics (War)
**Files to modify:**
- `sql/war_init.sql` — Add supply_lines, attrition_rate, logistics tables
- `api/war.php` — New endpoints: `get_supply_status`, `set_supply_route`
- `api/game_engine.php` — Tick: Apply attrition logic

**Gap Items:**
- [ ] Supply line database schema
- [ ] Distance-based logistics cost calculation
- [ ] Attrition mechanics (damage without direct combat)
- [ ] Supply interdiction by enemy (block routes)
- [ ] Resource consumption during war

**Acceptance Criteria:**
- Wars with distant theaters generate attrition
- Supply routes visible on galaxy map
- Attrition displayed in war status

---

### 1.3 Pirate Defense Framework (Pirates)
**Files to modify:**
- `sql/colony_init.sql` — Add defense_budget, countermeasure_level to colonies
- `api/pirates.php` — New endpoints: `set_defense_budget`, `get_countermeasures`
- `api/game_engine.php` — Tick: Apply pirate raid resolution

**Gap Items:**
- [ ] Defense budget allocation system
- [ ] Countermeasure effectiveness calculation
- [ ] Raid resolution logic (countermeasure vs raid intensity)
- [ ] Damage application (when raid succeeds)
- [ ] Insurance/recovery mechanics

**Acceptance Criteria:**
- Defense spending reduces raid success rate
- Successful raids damage colony resources
- Players see raid damage in colony status

---

## PHASE 2: INTEGRATION LAYER (80-120 hours)

### 2.1 War → Economy Coupling
**Files to modify:**
- `api/war.php` — Check economy_policies when declaring war
- `api/economy.php` — Economy tick applies war modifiers (tax penalties, production boost)
- `api/game_engine.php` — Unified tick that coordinates both

**Gap Items:**
- [ ] War policies modify tax efficiency
- [ ] War policies modify production multipliers
- [ ] War policies reduce trade route income
- [ ] Armistice → normalized policy recovery
- [ ] Peace treaty economic bonuses

**Acceptance Criteria:**
- Declaring war causes economy taxes (20-50% production loss)
- Peace treaties restore economy gradually
- Players see "War Status" effects in economy overview

---

### 2.2 Pirates → Colony Damage
**Files to modify:**
- `api/pirates.php` — Raid resolution applies damage
- `api/economy.php` — Track colony damage in processed_goods
- `api/buildings.php` — Damage affects building production temporarily

**Gap Items:**
- [ ] Raid damage calculation (intensity × colony size)
- [ ] Damage to specific goods (infrastructure, population)
- [ ] Damage recovery mechanics (repairs, investment)
- [ ] Casualty system (pop reduction on severe raids)
- [ ] Morale effects (damages → pop unhappiness)

**Acceptance Criteria:**
- Pirate raids reduce colony goods by 5-20%
- Damage visibly displayed in colony status
- Repairs cost money/time

---

### 2.3 Economy → Production Impact
**Files to modify:**
- `api/economy.php` — Recalculate production yield based on satisfaction/policies
- `api/game_engine.php` — Apply production calculations on tick

**Gap Items:**
- [ ] Satisfaction multiplier (0.5x at 0% → 1.5x at 100%)
- [ ] Policy production modifiers (fixed + variable)
- [ ] Subsidy effectiveness tracking
- [ ] Tier-1/2 goods always available; Tier-3 blocked until resolved
- [ ] Production method switching costs (cooldown/credits)

**Acceptance Criteria:**
- Production numbers change based on satisfaction
- Players see before/after production scenarios
- Tier-3 goods conditionally unavailable

---

### 2.4 NPC Reactions to Player Actions
**Files to modify:**
- `api/npc_ai.php` — Add reaction logic for player war declarations, pirate treaties
- `api/npc_controller.php` — Request-time NPC decision updates

**Gap Items:**
- [ ] NPCs declare counter-wars based on player aggression
- [ ] NPCs adjust pirate tolerance based on player defense spending
- [ ] NPCs form alliances against aggressive players
- [ ] Alliance wars propagate from primary to allied combatants
- [ ] NPC trade embargo logic

**Acceptance Criteria:**
- AI declares war if player too aggressive
- Alliance wars auto-declare for allies
- Trade embargoes reduce player market income

---

## PHASE 3: FEATURE COMPLETENESS (50-80 hours)

### 3.1 Pirates Contracts & Standing
**Files to modify:**
- `api/pirates.php` — New endpoints: `propose_contract`, `set_tributaries`
- `sql/pirate_contracts.sql` — New table for pirate relations

**Gap Items:**
- [ ] Tributary agreement (pay tribute → raids cease)
- [ ] Mercenary contracts (hire pirates for faction warfare)
- [ ] Historical standing archival
- [ ] Standing bonuses/penalties per faction
- [ ] Pirate faction intelligence (allegiance, historical actions)

**Acceptance Criteria:**
- Players can pay tribute to specific pirate factions
- Tribute reduces raid frequency for that faction
- Standing visible with decay rates

---

### 3.2 Economy Tier-3 Goods Production
**Files to modify:**
- `sql/economy_init.sql` — Define Tier-3 goods + production chains
- `api/economy.php` — Unlock conditions, production timing
- `api/market.php` — Price curve for T3 goods

**Gap Items:**
- [ ] T3 goods require multiple T2 inputs (production chain)
- [ ] T3 goods production blocked until economy stable
- [ ] T3 profits > T2 but higher risk
- [ ] T3 goods affected by war (trade embargoes)
- [ ] Manufacturing queue (async production)

**Acceptance Criteria:**
- T3 goods production chains work end-to-end
- Conditional production based on economy state
- Profits scale with risk/complexity

---

### 3.3 War Diplomacy UI & Goal Tracking
**Files to modify:**
- `js/engine/runtime/RuntimeWarController.js` — Expand UI panels
- `api/war.php` — New endpoints: `get_goal_progress`, `propose_terms`
- `html/templates/war-*.html` — War negotiation forms

**Gap Items:**
- [ ] Goal progress display (capital takeover %, attrition %, alliance status)
- [ ] Negotiation UI (propose peace terms, reparations)
- [ ] Alliance war declarations visible in UI
- [ ] Casualty tracking per war theater
- [ ] Victory conditions display

**Acceptance Criteria:**
- War UI shows goal progress per goal type
- Peace negotiations visible with reparation options
- Casualty counters for each war

---

### 3.4 Complex Goal Tracking
**Files to modify:**
- `api/war.php` — Goal calculation engine refinement
- `sql/war_goals.sql` — Add goal_progress_cache, calculation_timestamp

**Gap Items:**
- [ ] Goal type: Attrition (damage threshold)
- [ ] Goal type: Occupation (control % of territory)
- [ ] Goal type: Economic (steal resources)
- [ ] Goal type: Diplomatic (alliance formation)
- [ ] Goal progress caching (avoid recalc every call)

**Acceptance Criteria:**
- All 4 goal types calculate accurately
- Progress visible in war panel
- Goals resolve when conditions met

---

## PHASE 4: UI/UX LAYER (30-50 hours)

### 4.1 War Declaration UI
**Files to modify:**
- `html/war-declaration.html` — New form
- `js/engine/runtime/RuntimeWarController.js` — Declaration flow
- `index.php` → Add war window button

**Gap Items:**
- [ ] Declaration form (target faction, cause, initial goals)
- [ ] AI response preview
- [ ] Alliance notifications
- [ ] Confirmation dialog

---

### 4.2 Economy Production Warnings
**Files to modify:**
- `js/engine/runtime/RuntimeEconomyController.js` — Warning display logic
- `html/war-*.html` → Embed economy warnings

**Gap Items:**
- [ ] "War reduces production by X%" warning
- [ ] "Tier-3 goods blocked during war" notification
- [ ] "Pop satisfaction below X%" alert
- [ ] Policy recommendations based on state

---

### 4.3 Pirates Threat Dashboard
**Files to modify:**
- `js/engine/runtime/RuntimePiratesController.js` — Expand threat visualization
- `html/pirates-dashboard.html` — New template

**Gap Items:**
- [ ] Faction threat gauge (0-100%)
- [ ] Raid threat timeline (predicted raids in next N days)
- [ ] Defense ROI calculator
- [ ] Countermeasure effectiveness meter

---

### 4.4 Unified Conflict Dashboard
**Files to modify:**
- `js/engine/runtime/layers/integration/galaxy/StatusPanel.js` — Aggregate conflict data
- `html/conflict-dashboard.html` — New unified view

**Gap Items:**
- [ ] Wars + pirates + economy crisis on one screen
- [ ] Timeline of recent conflicts
- [ ] Resource allocation suggestions
- [ ] Threats ranked by urgency

---

## PHASE 5: TESTING & VALIDATION (20-40 hours)

### 5.1 Unit Tests
- [ ] Pop satisfaction calculation (10 test cases)
- [ ] War supply attrition (8 test cases)
- [ ] Pirate raid resolution (12 test cases)
- [ ] Economy coupling (15 test cases)

### 5.2 Integration Tests
- [ ] War→Economy flow end-to-end
- [ ] Pirates→Colony damage flow
- [ ] NPC reaction chain (aggression → alliance → war)
- [ ] Trade embargo effects cascade

### 5.3 E2E Smoke Tests
- [ ] Declare war → economy affected → UI updates ✓
- [ ] Pirate raid → colony damaged → recovery visible ✓
- [ ] Player pays tribute → raid frequency decreases ✓
- [ ] Tier-3 goods unlock after economy stabilizes ✓

### 5.4 Load Testing
- [ ] Tick performance with 100+ wars active
- [ ] Market price calculation with 1000+ trade routes
- [ ] Pirate simulation with 50+ factions

---

## Implementation Sequence

### Starting Now:
1. **PHASE 1.1** → Pop Satisfaction (8-12h) — Foundation for all economy features
2. **PHASE 1.2** → War Supply (6-10h) — Needed for war integration
3. **PHASE 1.3** → Pirate Defense (8-12h) — Needed for pirate integration

### After Foundation Complete:
4. **PHASE 2** → All integration (80-120h) — Connects foundation to gameplay
5. **PHASE 3** → Feature polish (50-80h) — Completes system depth
6. **PHASE 4** → UI layer (30-50h) — Makes features discoverable
7. **PHASE 5** → Testing (20-40h) — Validates all systems

---

## Success Metrics

| System | Current | Target | Completion |
|--------|---------|--------|------------|
| Pirates | 60% | 100% | Gap coverage: Defense + Contracts + Damage |
| Economy | 75% | 100% | Gap coverage: Pop + Tier3 + War coupling |
| War | 80% | 100% | Gap coverage: UI + Supply + Diplomacy |
| Integration | 0% | 100% | All 3 systems coupled + working together |
| Testing | 85% | 100% | New smoke tests for all features |

---

## Critical Path (Blocking Items)

1. **Pop Satisfaction DB schema** — Blocks economy feature layer
2. **War→Economy coupling API** — Blocks all economy integration
3. **Pirate damage calculation** — Blocks pirate integration
4. **NPC reaction logic** — Blocks multiplayer alliance wars

These must be done before parallel work on other features.

