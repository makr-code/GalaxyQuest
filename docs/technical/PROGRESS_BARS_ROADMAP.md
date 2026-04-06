# Progressbar Implementation Roadmap

## Currently Implemented ✅

### Phase 1-8 (Completed)
- Fleet integrity/shield (overview)
- Colony health/shield (overview)
- Building health/shield (cards)
- Building **upgrades** (in-progress)
- Research **queue** (in-progress)
- Ship **build queue** (in-progress)
- FTL gates health (Syl'Nar drive)
- **FTL cooldown** recharge (in-progress)
- Trade route **next-execution** (in-progress)
- Battle reports (power/integrity)
- Foreign intel (scan-based, optional)

---

## Recommended Next Priorities 🎯

### HIGH Priority (High Impact, Low Effort)

#### 1. **Colony Events Progress** ⭐ HIGH
- **Location**: ColonyViewController (line ~7605-7615)
- **Data Available**: `currentColony.active_event.ends_in_min`, `active_event.type`
- **UI**: Replace text "ends in 45m" with entity-bar showing event countdown
- **Example**:
  ```
  Solar Flare: [████░░░░] 45%
  Disease:    [██░░░░░░] 20%
  ```
- **Tone Classes**: is-critical when <20% remaining, is-warning 20-70%, is-good >70%
- **Effort**: ~15 lines, reuses existing pattern

#### 2. **Fleet Movement Progress** ⭐ HIGH
- **Location**: OverviewController fleet rows (line ~6880-6895)
- **Data Available**: `fleet.departure_time`, `fleet.arrival_time`
- **Current UI**: Has skeleton progress-bar but not styled with new entity-bar pattern
- **Enhancement**: Replace old `.fleet-progress-bar` with entity-bars showing travel progress
- **Display**: "Transit: {percentage}%" with estimated time or ETA countdown
- **Effort**: ~20 lines, high user benefit (players always want to know how far fleet is)

#### 3. **Storage Capacity Utilization** ⭐ MEDIUM
- **Location**: Overview resource bars or colony detail
- **Data Available**: `colony.metal`, `colony.crystal`, `colony.deuterium` vs max capacity
- **UI**: Show "Storage: {used}/{max} ({percentage}%)"
- **Tone**: Red when >90% full (overflow risk), yellow >70%, green <70%
- **Benefit**: Players can see at-a-glance if storage is filling up
- **Effort**: ~20 lines

#### 4. **Energy Balance (Supply vs Drain)** ⭐ MEDIUM
- **Location**: Colony detail or overview
- **Data Available**: `colony.energy`, `colony.energy_production`, `colony.energy_drain`
- **UI**: Show energy status as bar or dual-bar (production/drain)
- **Logic**:
  - Green: Production > Drain (surplus)
  - Yellow: Production = Drain (balanced)
  - Red: Production < Drain (deficit, efficiency loss)
- **Effort**: ~25 lines

---

## MEDIUM Priority (Good Polish Items)

#### 5. **Population Growth to Max** 
- **Location**: Colony welfare bars (line ~7483-7493)
- **Data Available**: `colony.population`, `colony.max_population`
- **Enhancement**: Already has welfare-bar, could enhance with entity-bar pattern + growth rate
- **Tone**: Red near capacity (risk of stagnation), green if room to grow
- **Effort**: ~15 lines

#### 6. **Message Assembly/Delivery** 
- **Location**: MessagesController (line ~12147+)
- **Data Available**: `message.created_at`, `message.expires_at` or delivery timers
- **UI**: Show how long message remains valid (time-decay indicator)
- **Effort**: ~20 lines if data available

#### 7. **Alliance Cooperation Cooldowns**
- **Location**: AlliancesController diplomacy dialog
- **Data Available**: `alliance.next_cooperation_available` or similar
- **UI**: Show cooldown progress before next diplomatic action
- **Effort**: ~20 lines if data available

#### 8. **Wormhole/FTL Construction Progress**
- **Location**: Wormhole panel (line ~5108+) or research
- **Data Available**: Construction start/end timestamps if applicable
- **UI**: Show gate/node construction progress
- **Effort**: ~25 lines, depends on data model

---

## LOW Priority (Polish/Nice-to-Have)

#### 9. **Quest Objective Progress**
- **Location**: QuestsController (line ~16528+)
- **Data Available**: Already has `quest.progress / quest.goal`
- **Current**: Uses simple progress-bar
- **Enhancement**: Replace with entity-bar pattern for consistency
- **Effort**: ~15 lines

#### 10. **Resource Production Completion Timers**
- **Location**: Resource insight tooltips
- **Data Available**: Next harvest/extraction time if tracked
- **Effort**: ~30 lines, needs API changes possibly

#### 11. **Leader Assignment Cooldowns**
- **Location**: LeadersController marketplace
- **Data Available**: Last assignment time + cooldown period
- **UI**: Show when leader can be reassigned
- **Effort**: ~20 lines if data available

#### 12. **Diplomatic Standing Recovery**
- **Location**: Factions controller politics view
- **Data Available**: Faction standing trend or recovery timer
- **UI**: Show standing recovery progress toward neutral
- **Effort**: ~25 lines

---

## Recommended Implementation Order

### Phase 9 (Recommended) - Next 
1. **Colony Events Progress** (15 min) → High impact, very visible
2. **Fleet Movement Progress** (20 min) → Players check this constantly
3. **Storage Capacity** (20 min) → Critical game mechanic

### Phase 10 (Quick Wins)
4. **Energy Balance** (25 min) → Game balance feedback
5. **Population Growth** (15 min) → Existing bar enhancement

### Future (Polish)
- Message/delivery timers if applicable
- Alliance cooldowns
- Quest objectives (if polishing consistency)
- Diplomatic recovery

---

## Implementation Pattern (Template)

All new progress bars follow this pattern:

```javascript
let progressPct = 0;
let progressTone = 'is-good';

if (startTime && endTime) {
  const now = Date.now();
  const startMs = new Date(startTime).getTime();
  const endMs = new Date(endTime).getTime();
  const totalMs = endMs - startMs;
  
  if (totalMs > 0) {
    progressPct = Math.min(100, Math.round(Math.max(0, (now - startMs) / totalMs * 100)));
    progressTone = progressPct < 30 ? 'is-critical' 
                 : (progressPct < 70 ? 'is-warning' : 'is-good');
  }
}

// Output:
// <div class="entity-bars">
//   <div class="entity-bar-row" title="Feature progress {progressPct}%">
//     <span class="entity-bar-label">Label</span>
//     <div class="bar-wrap">
//       <div class="bar-fill bar-integrity {progressTone}" style="width:{progressPct}%"></div>
//     </div>
//     <span class="entity-bar-value">{progressPct}%</span>
//   </div>
// </div>
```

---

## API Data Check Required Before Implementation

- ✓ Buildings: `upgrade_start`, `upgrade_end` - READY
- ✓ Research: `research_start`, `research_end` - READY
- ✓ Shipyard: `started_at`, `eta` - READY
- ✓ FTL: `ftl_cooldown_remaining_s` - READY
- ✓ Trade routes: `next_execution_at`, `last_execution_at` - READY
- ✓ Fleet: `departure_time`, `arrival_time` - READY
- ✓ Colony events: `ends_in_min`, `active_event.type` - READY
- ⚠️ Storage capacity: Need max values in API
- ⚠️ Energy: `energy_production`, `energy_drain` - Check if available
- ⚠️ Population growth rate - Check if calculated server-side
- ? Message delivery: Unclear if expiry timestamps exist
- ? Alliance cooperation: Unclear if cooldown data exists
