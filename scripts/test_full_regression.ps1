param(
    [switch]$FreshReset,
    [switch]$ApiOnly
)

$ErrorActionPreference = 'Stop'

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Action
    )

    Write-Host "==> $Name"
    & $Action
    if ($LASTEXITCODE -ne 0) {
        throw "Step failed: $Name (exit $LASTEXITCODE)"
    }
}

function Wait-DbReady {
    param(
        [int]$TimeoutSeconds = 120
    )

    $deadline = (Get-Date).AddSeconds([Math]::Max(10, $TimeoutSeconds))
    do {
        docker compose exec -T db mysqladmin ping -h localhost -proot > $null 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-Host 'DB is ready.'
            return
        }
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)

    throw 'DB not ready within timeout.'
}

Push-Location (Resolve-Path "$PSScriptRoot\..")
try {
    if ($FreshReset) {
        Invoke-Step 'Docker: down -v' { docker compose down -v }
        Invoke-Step 'Docker: up -d --build' { docker compose up -d --build }
        Wait-DbReady -TimeoutSeconds 240
    } else {
        Wait-DbReady -TimeoutSeconds 120
    }

    Invoke-Step 'API smoke: auth rate limit' { docker compose exec -T web php scripts/test_auth_rate_limit.php }
    Invoke-Step 'API smoke: admin stats' { docker compose exec -T web php scripts/test_admin_stats_endpoint.php }
    Invoke-Step 'API smoke: wormhole beacon unlock' { docker compose exec -T web php scripts/test_wormhole_beacon_unlock.php }

    if (-not $ApiOnly) {
        Invoke-Step 'PHPUnit' { docker compose exec -T web php /var/www/html/tools/phpunit.phar -c /var/www/html/phpunit.xml }
        Invoke-Step 'JS unit tests' { npm run test:unit:js }
    }

    Write-Host 'RESULT: PASS'
    exit 0
} catch {
    Write-Error $_
    Write-Host 'RESULT: FAIL'
    exit 1
} finally {
    Pop-Location
}
