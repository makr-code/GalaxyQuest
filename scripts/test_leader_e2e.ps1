$ErrorActionPreference = 'Stop'

$base = 'http://localhost:8080'
$jar = '.tmp-leader-e2e.cookies.txt'
if (Test-Path $jar) { Remove-Item $jar -Force }

$csrf = ((curl.exe -s -c $jar "$base/api/auth.php?action=csrf") | ConvertFrom-Json).token
$loginBody = @{ username = 'default_user'; password = 'User!23456' } | ConvertTo-Json -Compress
$login = (curl.exe -s -b $jar -c $jar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrf" -d $loginBody "$base/api/auth.php?action=login" | ConvertFrom-Json)
if (-not $login.success) { throw 'Login failed' }

$ov = (curl.exe -s -b $jar "$base/api/game.php?action=overview" | ConvertFrom-Json)
$colonyId = $null
if ($ov.success -and $ov.colonies -and $ov.colonies.Count -gt 0) { $colonyId = [int]$ov.colonies[0].id }
if (-not $colonyId -and $ov.success -and $ov.offline_progress -and $ov.offline_progress.entries -and $ov.offline_progress.entries.Count -gt 0) { $colonyId = [int]$ov.offline_progress.entries[0].colony_id }
if (-not $colonyId) { throw 'No colony_id found in overview' }

function Invoke-ApiPostJson([string]$url, $obj, [string]$cookieJar, [string]$csrfToken) {
    $body = $obj | ConvertTo-Json -Compress -Depth 8
    return (curl.exe -s -b $cookieJar -c $cookieJar -H "Content-Type: application/json" -H "X-CSRF-Token: $csrfToken" -d $body $url | ConvertFrom-Json)
}

function Get-LeaderByName([string]$name, [string]$cookieJar, [string]$baseUrl) {
    $ls = (curl.exe -s -b $cookieJar "$baseUrl/api/leaders.php?action=list" | ConvertFrom-Json)
    if (-not $ls.success) { throw 'leaders list failed' }
    return ($ls.leaders | Where-Object { $_.name -eq $name } | Select-Object -First 1)
}

# Ensure enough hire budget on homeworld for deterministic E2E test.
docker compose exec -T db mysql -uroot -proot galaxyquest -e "UPDATE colonies c JOIN users u ON u.id=c.user_id SET c.metal=GREATEST(c.metal,200000), c.crystal=GREATEST(c.crystal,200000), c.deuterium=GREATEST(c.deuterium,120000) WHERE u.username='default_user' AND c.is_homeworld=1;" | Out-Null

$beforeRow = docker compose exec -T db mysql -N -uroot -proot galaxyquest -e "SELECT metal,crystal,deuterium FROM colonies WHERE id=$colonyId LIMIT 1;"
$parts = ($beforeRow -split '\s+') | Where-Object { $_ -ne '' }
$before = [pscustomobject]@{ metal = [double]$parts[0]; crystal = [double]$parts[1]; deuterium = [double]$parts[2] }

$dipBeforeRow = docker compose exec -T db mysql -N -uroot -proot galaxyquest -e "SELECT d.faction_id,d.standing,f.name FROM diplomacy d JOIN npc_factions f ON f.id=d.faction_id JOIN users u ON u.id=d.user_id WHERE u.username='default_user' ORDER BY d.standing ASC LIMIT 1;"
$dipParts = ($dipBeforeRow -split "`t")
$dipBefore = [pscustomobject]@{ faction_id = [int]$dipParts[0]; standing = [int]$dipParts[1]; name = $dipParts[2] }

$leadersToSetup = @(
    @{ name = 'E2E Diplo'; role = 'diplomacy_officer' },
    @{ name = 'E2E Trade'; role = 'trade_director' }
)

foreach ($x in $leadersToSetup) {
    $leader = Get-LeaderByName $x.name $jar $base
    if (-not $leader) {
        $hire = Invoke-ApiPostJson "$base/api/leaders.php?action=hire" @{ name = $x.name; role = $x.role } $jar $csrf
        if (-not $hire.success) { throw "hire failed for $($x.name): $($hire.error)" }
        $leader = $hire.leader
    }

    $assign = Invoke-ApiPostJson "$base/api/leaders.php?action=assign" @{ leader_id = [int]$leader.id; colony_id = $colonyId; fleet_id = $null } $jar $csrf
    if (-not $assign.success) { throw "assign failed for $($x.name): $($assign.error)" }

    $auto = Invoke-ApiPostJson "$base/api/leaders.php?action=autonomy" @{ leader_id = [int]$leader.id; autonomy = 2 } $jar $csrf
    if (-not $auto.success) { throw "autonomy failed for $($x.name): $($auto.error)" }
}

# Isolate test signal: disable all other auto leaders for this user.
docker compose exec -T db mysql -uroot -proot galaxyquest -e "UPDATE leaders l JOIN users u ON u.id=l.user_id SET l.autonomy=0 WHERE u.username='default_user' AND l.name NOT IN ('E2E Diplo','E2E Trade'); UPDATE leaders l JOIN users u ON u.id=l.user_id SET l.autonomy=2 WHERE u.username='default_user' AND l.name IN ('E2E Diplo','E2E Trade');" | Out-Null

docker compose exec -T db mysql -uroot -proot galaxyquest -e "UPDATE leaders l JOIN users u ON u.id=l.user_id SET l.last_action_at=DATE_SUB(NOW(), INTERVAL 20 MINUTE) WHERE u.username='default_user' AND l.name IN ('E2E Diplo','E2E Trade');" | Out-Null

$tick = Invoke-ApiPostJson "$base/api/leaders.php?action=ai_tick" @{} $jar $csrf
if (-not $tick.success) { throw "ai_tick failed: $($tick.error)" }

Start-Sleep -Milliseconds 500

$afterRow = docker compose exec -T db mysql -N -uroot -proot galaxyquest -e "SELECT metal,crystal,deuterium FROM colonies WHERE id=$colonyId LIMIT 1;"
$parts2 = ($afterRow -split '\s+') | Where-Object { $_ -ne '' }
$after = [pscustomobject]@{ metal = [double]$parts2[0]; crystal = [double]$parts2[1]; deuterium = [double]$parts2[2] }

$dipAfterRow = docker compose exec -T db mysql -N -uroot -proot galaxyquest -e "SELECT d.standing FROM diplomacy d JOIN users u ON u.id=d.user_id WHERE u.username='default_user' AND d.faction_id=$($dipBefore.faction_id) LIMIT 1;"
$dipAfterStanding = [int]($dipAfterRow.Trim())

$result = [pscustomobject]@{
    success = $true
    colony_id = $colonyId
    ai_actions = $tick.actions
    trade_delta = [pscustomobject]@{
        metal = ($after.metal - $before.metal)
        crystal = ($after.crystal - $before.crystal)
        deuterium = ($after.deuterium - $before.deuterium)
    }
    diplomacy_delta = [pscustomobject]@{
        faction_id = $dipBefore.faction_id
        faction_name = $dipBefore.name
        before = $dipBefore.standing
        after = $dipAfterStanding
        delta = ($dipAfterStanding - $dipBefore.standing)
    }
}

$result | ConvertTo-Json -Depth 8
