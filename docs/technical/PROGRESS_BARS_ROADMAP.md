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

### Phase 9 (Completed)
- **Colony Events Progress** — `RuntimeColonyViewController.js` (event duration vs. `ends_in_min`, tone-aware)
- **Fleet Movement Progress** — `RuntimeOverviewLists.js` (departure/arrival timestamps, Transit bar)
- **Storage Capacity** — `RuntimeOverviewController.js` (Metal/Crystal/Deuterium vs. `max_*`)

### Phase 10 (Completed)
- **Energy Balance** — `RuntimeOverviewController.js` (energy amount vs. 10 000 cap, DEFICIT/LOW/OK label)
- **Population Capacity** — `RuntimeOverviewController.js` (pop vs. max_population)

---

## LOW Priority (Polish/Nice-to-Have)

---

## Remaining Polish Items (Low Priority)

#### Phase 11 (Optional Polish)
- **Quest Objective Progress** — QuestsController: replace simple progress-bar with entity-bar pattern for visual consistency (~15 lines)
- **Message Delivery Timers** — MessagesController: show time-decay indicator if `expires_at` available (~20 lines)
- **Alliance Cooperation Cooldowns** — AlliancesController: show cooldown before next diplomatic action if data available (~20 lines)
- **Diplomatic Standing Recovery** — Factions controller: standing recovery progress toward neutral (~25 lines)
- **Leader Assignment Cooldowns** — LeadersController: when leader can be reassigned (~20 lines)
- **Resource Production Completion Timers** — Resource insight tooltips, needs API changes (~30 lines)

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

## API Data Availability

- ✅ Buildings: `upgrade_start`, `upgrade_end` — implemented
- ✅ Research: `research_start`, `research_end` — implemented
- ✅ Shipyard: `started_at`, `eta` — implemented
- ✅ FTL: `ftl_cooldown_remaining_s` — implemented
- ✅ Trade routes: `next_execution_at`, `last_execution_at` — implemented
- ✅ Fleet: `departure_time`, `arrival_time` — implemented (Transit bar in RuntimeOverviewLists)
- ✅ Colony events: `ends_in_min`, `active_event.type` — implemented (RuntimeColonyViewController)
- ✅ Storage capacity: `max_metal`, `max_crystal`, `max_deuterium` — implemented (RuntimeOverviewController)
- ✅ Energy balance: `colony.energy` vs. cap — implemented (simplified, RuntimeOverviewController)
- ✅ Population capacity: `colony.population`, `colony.max_population` — implemented
- ? Message delivery: `expires_at` availability unclear
- ? Alliance cooperation: cooldown data availability unclear
