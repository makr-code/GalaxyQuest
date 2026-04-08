#!/usr/bin/env node
/**
 * GalaxyQuest – Side Faction Spec Validator
 *
 * Validates that each targeted side faction spec.json contains:
 *   - meta (with faction_tier, faction_tier_label_de, playable, npc_only, canon_note)
 *   - history_timeline (at least 6 entries)
 *   - important_npcs (at least 3 entries, each with name/title/public_face/private_goal)
 *   - plot_hooks (with act1, act2, act3, aftershock)
 *
 * Usage: node scripts/validate_side_faction_specs.js
 * Exits non-zero on validation failures.
 */

'use strict';

const fs   = require('fs');
const path = require('path');

const REQUIRED_META_KEYS = [
  'faction_tier',
  'faction_tier_label_de',
  'playable',
  'npc_only',
  'canon_note',
];

const REQUIRED_NPC_KEYS = ['name', 'title', 'public_face', 'private_goal'];
const REQUIRED_PLOT_ACTS = ['act1', 'act2', 'act3', 'aftershock'];

const FRACTIONS_DIR = path.join(__dirname, '..', 'fractions');

// Auto-discover side factions by scanning fractions/ for spec.json files where
// meta.faction_tier === 'side'.  Factions with a mini_factions/ subdirectory (e.g.
// iron_fleet) are compound factions validated separately and are excluded here.
// This replaces the former hardcoded SIDE_FACTIONS list.
function discoverSideFactions() {
  const codes = [];
  if (!fs.existsSync(FRACTIONS_DIR)) return codes;
  for (const entry of fs.readdirSync(FRACTIONS_DIR)) {
    const specPath      = path.join(FRACTIONS_DIR, entry, 'spec.json');
    const miniFacDir    = path.join(FRACTIONS_DIR, entry, 'mini_factions');
    if (!fs.existsSync(specPath)) continue;
    if (fs.existsSync(miniFacDir)) continue;   // compound faction – skip
    let spec;
    try { spec = JSON.parse(fs.readFileSync(specPath, 'utf8')); } catch { continue; }
    if (spec && spec.meta && spec.meta.faction_tier === 'side') {
      codes.push(entry);
    }
  }
  return codes.sort();
}

const SIDE_FACTIONS = discoverSideFactions();

let failures = 0;

function fail(msg) {
  console.error(`  FAIL: ${msg}`);
  failures++;
}

for (const code of SIDE_FACTIONS) {
  const specPath = path.join(FRACTIONS_DIR, code, 'spec.json');
  process.stdout.write(`Checking ${code} ... `);

  if (!fs.existsSync(specPath)) {
    console.log('');
    fail(`spec.json not found at ${specPath}`);
    continue;
  }

  let spec;
  try {
    spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  } catch (e) {
    console.log('');
    fail(`spec.json is not valid JSON: ${e.message}`);
    continue;
  }

  const errors = [];

  // --- meta ---
  if (!spec.meta || typeof spec.meta !== 'object') {
    errors.push('missing "meta" block');
  } else {
    for (const key of REQUIRED_META_KEYS) {
      if (!(key in spec.meta)) {
        errors.push(`meta missing key "${key}"`);
      }
    }
    if (spec.meta.npc_only !== true) {
      errors.push('meta.npc_only must be true');
    }
    if (spec.meta.faction_tier !== 'side') {
      errors.push('meta.faction_tier must be "side"');
    }
  }

  // --- history_timeline ---
  if (!Array.isArray(spec.history_timeline)) {
    errors.push('missing "history_timeline" array');
  } else if (spec.history_timeline.length < 6) {
    errors.push(`history_timeline has ${spec.history_timeline.length} entries (need ≥6)`);
  }

  // --- important_npcs ---
  if (!Array.isArray(spec.important_npcs)) {
    errors.push('missing "important_npcs" array');
  } else {
    if (spec.important_npcs.length < 3) {
      errors.push(`important_npcs has ${spec.important_npcs.length} entries (need ≥3)`);
    }
    spec.important_npcs.forEach((npc, i) => {
      for (const key of REQUIRED_NPC_KEYS) {
        if (!npc[key]) {
          errors.push(`important_npcs[${i}] missing "${key}"`);
        }
      }
    });
  }

  // --- plot_hooks ---
  if (!spec.plot_hooks || typeof spec.plot_hooks !== 'object') {
    errors.push('missing "plot_hooks" block');
  } else {
    for (const act of REQUIRED_PLOT_ACTS) {
      const hook = spec.plot_hooks[act];
      const valid = (typeof hook === 'string' && hook.trim().length > 0)
                 || (Array.isArray(hook) && hook.length > 0);
      if (!valid) {
        errors.push(`plot_hooks missing or empty "${act}"`);
      }
    }
  }

  if (errors.length === 0) {
    console.log('OK');
  } else {
    console.log('FAILED');
    errors.forEach(e => fail(e));
  }
}

if (failures > 0) {
  console.error(`\n${failures} validation failure(s). Aborting.`);
  process.exit(1);
} else {
  console.log(`\nAll ${SIDE_FACTIONS.length} side faction specs valid.`);
}
