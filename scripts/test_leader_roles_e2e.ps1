$ErrorActionPreference = 'Stop'

$base = 'http://localhost:8080'
$jar = '.tmp-leader-e2e.cookies.txt'
if (Test-Path $jar) { Remove-Item $jar -Force }

# Auth
$csrf = ((curl.exe -s -c $jar "$base/api/auth.php?action=csrf") | ConvertFrom-Json).token
$loginBody = @{ username = 'default_user'; password = 'User!23456' } | ConvertTo-Json -Compress
curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $loginBody "$base/api/auth.php?action=login" | Out-Null

# Home colony snapshot
$overview = (curl.exe -s -b $jar "$base/api/game.php?action=overview") | ConvertFrom-Json
$col = $overview.colonies | Select-Object -First 1
if (-not $col) { throw 'No colony found for default_user.' }
$colonyId = [int]$col.id

$before = [pscustomobject]@{
    metal     = [double]$col.metal
    crystal   = [double]$col.crystal
    deuterium = [double]$col.deuterium
}

# Standing snapshot before
$factionsBefore = ((curl.exe -s -b $jar "$base/api/factions.php?action=list") | ConvertFrom-Json).factions
$standingBefore = @{}
foreach ($f in $factionsBefore) {
    $standingBefore[[int]$f.id] = [int]$f.standing
}

# Hire leaders
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$hireDiploBody = @{ name = "E2E Diplo $ts"; role = 'diplomacy_officer' } | ConvertTo-Json -Compress
$hireTradeBody = @{ name = "E2E Trade $ts"; role = 'trade_director' } | ConvertTo-Json -Compress
$h1 = (curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $hireDiploBody "$base/api/leaders.php?action=hire") | ConvertFrom-Json
$h2 = (curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $hireTradeBody "$base/api/leaders.php?action=hire") | ConvertFrom-Json
if (-not $h1.success -or -not $h2.success) { throw 'Hiring new leaders failed.' }
$diploId = [int]$h1.leader.id
$tradeId = [int]$h2.leader.id

try {
    # Assign leaders
    $assign1 = @{ leader_id = $diploId; colony_id = $colonyId } | ConvertTo-Json -Compress
    $assign2 = @{ leader_id = $tradeId; colony_id = $colonyId } | ConvertTo-Json -Compress
    $a1 = (curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $assign1 "$base/api/leaders.php?action=assign") | ConvertFrom-Json
    $a2 = (curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $assign2 "$base/api/leaders.php?action=assign") | ConvertFrom-Json
    if (-not $a1.success -or -not $a2.success) { throw 'Assign failed.' }

    # Set autonomy to full auto
    $auto1 = @{ leader_id = $diploId; autonomy = 2 } | ConvertTo-Json -Compress
    $auto2 = @{ leader_id = $tradeId; autonomy = 2 } | ConvertTo-Json -Compress
    $aut1 = (curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $auto1 "$base/api/leaders.php?action=autonomy") | ConvertFrom-Json
    $aut2 = (curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $auto2 "$base/api/leaders.php?action=autonomy") | ConvertFrom-Json
    if (-not $aut1.success -or -not $aut2.success) { throw 'Autonomy setup failed.' }

    # Run AI tick
    $ai = (curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d '{}' "$base/api/leaders.php?action=ai_tick") | ConvertFrom-Json

    # Snapshot after
    $overviewAfter = (curl.exe -s -b $jar "$base/api/game.php?action=overview") | ConvertFrom-Json
    $colAfter = $overviewAfter.colonies | Where-Object { [int]$_.id -eq $colonyId } | Select-Object -First 1
    $after = [pscustomobject]@{
        metal     = [double]$colAfter.metal
        crystal   = [double]$colAfter.crystal
        deuterium = [double]$colAfter.deuterium
    }

    $factionsAfter = ((curl.exe -s -b $jar "$base/api/factions.php?action=list") | ConvertFrom-Json).factions
    $standingDelta = @()
    foreach ($f in $factionsAfter) {
        $id = [int]$f.id
        $b = if ($standingBefore.ContainsKey($id)) { $standingBefore[$id] } else { 0 }
        $a = [int]$f.standing
        if ($a -ne $b) {
            $standingDelta += [pscustomobject]@{
                faction = $f.name
                before  = $b
                after   = $a
                delta   = ($a - $b)
            }
        }
    }

    [pscustomobject]@{
        success          = $true
        colony_id        = $colonyId
        hired_leaders    = @($diploId, $tradeId)
        ai_actions       = @($ai.actions)
        resources_before = $before
        resources_after  = $after
        resource_delta   = [pscustomobject]@{
            metal     = ($after.metal - $before.metal)
            crystal   = ($after.crystal - $before.crystal)
            deuterium = ($after.deuterium - $before.deuterium)
        }
        standing_changes = $standingDelta
    } | ConvertTo-Json -Depth 8
}
finally {
    # Cleanup leaders
    $d1 = @{ leader_id = $diploId } | ConvertTo-Json -Compress
    $d2 = @{ leader_id = $tradeId } | ConvertTo-Json -Compress
    curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $d1 "$base/api/leaders.php?action=dismiss" | Out-Null
    curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $d2 "$base/api/leaders.php?action=dismiss" | Out-Null
}
