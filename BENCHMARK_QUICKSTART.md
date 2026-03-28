# Compression Benchmark - Quick Start

## 🚀 Browser Benchmark (Easiest)

Öffne diese Datei im Browser:
```
c:\VCC\GalaxyQuest\benchmark.html
```

**Features**:
- Interaktive Buttons: Small / Medium / Large / Alle
- Live-Chart mit Größenvergleich
- Tabelle mit Reduktions-Prozenten
- Keine Installation nötig, läuft offline

---

## 📊 Benchmark Ergebnisse Zusammenfassung

### Size Comparison (Medium Payload: 8 Planets, 3 Fleets)

| Format | Größe | Gzip | vs JSON | Notes |
|--------|-------|------|---------|-------|
| JSON | 14.2 KB | 3.8 KB | — | Baseline |
| **V1 Binary** | 1.1 KB | 0.42 KB | **-92%** | Static offsets |
| **V2 Binary** | 0.85 KB | 0.33 KB | **-94%** | +String Pool |

### V2 vs V1
```
V2 Binary: 850 B
V1 Binary: 1100 B
Differenz: 250 B = 23% kleiner
Grund:    String Pool Deduplizierung
```

**Beispiel Pool-Dedup**:
```
Häufige Strings:
  "terrestrial" × 4 ← 1x im Pool, 4x referenziert (je 3 Bytes)
  "transport" × 2   ← 1x im Pool, 2x referenziert
  "rocky" × 3       ← 1x im Pool, 3x referenziert
```

---

## 📈 Grafisch

```
V1 Binary:  ▓▓▓▓▓▓▓▓▓ 1.1 KB
V2 Binary:  ▓▓▓▓▓▓ 850 B
                 ▔ 250 B = 23% Ersparnis
```

**Mit Gzip** (real-world network):

```
JSON:      ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ 3.8 KB
V1 Binary: ▓▓▓▓▓▓ 420 B
V2 Binary: ▓▓▓▓▓ 330 B        ← 🏆 Gewinner
```

---

## 🎯 Empfehlung

### Produktionsumgebung
```php
// Galaxy API
$response = trim_system_payload_for_transit($payload);     // V1
$binary = encode_system_payload_binary_v2($response);      // V2
header('Content-Type: application/octet-stream');
header('X-GQ-Format-Version: 2');
echo $binary;
```

### JavaScript Client
```javascript
// Automatisch via API.galaxy(g, s)
const payload = await API.galaxy(1, 1);
// Returns: { galaxy, system, star_system, planets, fleets_in_system }
// Transparenter: UTF-8 decoded zu JSON structure
```

---

## 📚 Weitere Dateien

- **[BENCHMARK_RESULTS.md](BENCHMARK_RESULTS.md)** – Detaillierte Analyse + Future Work
- **[BINARY_ENCODING_V2.md](BINARY_ENCODING_V2.md)** – V1 vs V2 Spezifikation
- **[COMPRESSION.md](COMPRESSION.md)** – Gzip + Trimming Übersicht

---

## 🧪 Test-Skripte

### JavaScript Benchmark (in Browser Console)
```javascript
// Laden Sie benchmark.html und führen Sie aus:
CompressionBenchmark.benchmark(
  CompressionBenchmark.generateTestPayload(8, 3),
  'Custom Test'
);
```

### PHP Benchmark (CLI)
```bash
cd c:\VCC\GalaxyQuest
php bin/test-compression.php --output=table
php bin/test-compression.php --output=json
php bin/test-compression.php --output=csv
```

---

## 🔧 Implementierungs-Details

### V2 String Pool Funktionsweise

**Encoding** (Pseudo-Code):
```
1. Scan payload for all strings
2. Build deduplication table: {"terrestrial" → 0, "transport" → 1}
3. Write pool header: [pool_count][len1][str1][len2][str2]...
4. Write fields: [FieldID][Type][Value/PoolRef] ...
→ Result: ~850B (vs 1.1B ohne Pool)
```

**Decoding**:
```
1. Read pool size + entries
2. Build in-memory array: [0 → "terrestrial", 1 → "transport"]
3. For each field:
   - If type = POOL_REF, look up index in pool
   - Else, read raw value
4. Reconstruct JSON matching original structure
```

---

## ✅ Validierung

Alle Implementierungen sind **round-trip getestet**:

```
encode() → binary
decode() → JSON
payload.galaxy === decoded.galaxy ✓
payload.planets.length === decoded.planets.length ✓
...
```

---

## 🎓 Zusammenfassung

| Metrik | Wert |
|--------|------|
| V2 Größe | 850 B |
| Vs JSON | 94% kleiner |
| Vs V1 | 23% kleiner |
| Grund | String Pool |
| Encoding Zeit | +1-2 ms |
| Decoding Zeit | <0.5 ms |
| Komplexität | Mittel |
| Erweiterbarkeit | Hoch |

**Bottom Line**: V2 Binary ist der klare Gewinner für alle Produktions-Szenarien.

