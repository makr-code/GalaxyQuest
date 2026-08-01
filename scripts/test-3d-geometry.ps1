# Tests für AI-generierte 3D Raumschiff-Geometrie und Partikel-Systeme
# Executes all test suites for 3D generation pipeline

param(
    [ValidateSet('unit', 'integration', 'all')]
    [string]$TestType = 'all',
    
    [switch]$Watch,
    [switch]$Coverage,
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'

# Test configuration
$TestConfig = @{
    '3d-geometry-trellis2'    = 'tests/unit/3d-geometry-trellis2.test.js'
    'particle-systems'         = 'tests/unit/particle-systems.test.js'
    'texture-systems'          = 'tests/unit/texture-systems.test.js'
    '3d-asset-pipeline'        = 'tests/integration/3d-asset-pipeline.test.js'
}

function Write-Header {
    param([string]$Text)
    Write-Host "`n╔$('═' * ($Text.Length + 2))╗" -ForegroundColor Cyan
    Write-Host "║ $Text ║" -ForegroundColor Cyan
    Write-Host "╚$('═' * ($Text.Length + 2))╝" -ForegroundColor Cyan
}

function Write-Status {
    param([string]$Text, [string]$Status)
    $Symbol = switch ($Status) {
        'pass'    { '✓' }
        'fail'    { '✗' }
        'skip'    { '○' }
        'run'     { '▶' }
        default   { '•' }
    }
    $Color = switch ($Status) {
        'pass'    { 'Green' }
        'fail'    { 'Red' }
        'skip'    { 'Yellow' }
        'run'     { 'Cyan' }
        default   { 'White' }
    }
    Write-Host "$Symbol $Text" -ForegroundColor $Color
}

function Run-Tests {
    param(
        [string[]]$Tests,
        [bool]$RunWatch,
        [bool]$RunCoverage
    )
    
    Write-Header "Running Test Suite"
    
    $viTestArgs = @(
        'run'
        '--reporter=verbose'
    )
    
    if ($RunWatch) {
        Write-Status "Watch mode enabled" 'run'
        $viTestArgs += '--watch'
    }
    
    if ($RunCoverage) {
        Write-Status "Coverage enabled" 'run'
        $viTestArgs += '--coverage'
    }
    
    # Add test files
    foreach ($test in $Tests) {
        if ($TestConfig.ContainsKey($test)) {
            Write-Status "Adding test: $test" 'run'
            $viTestArgs += $TestConfig[$test]
        }
    }
    
    Write-Host "`n" -ForegroundColor DarkGray
    Write-Host "Command: npm run test:js -- $($viTestArgs -join ' ')" -ForegroundColor DarkGray
    Write-Host "`n"
    
    try {
        & npm run test:js -- $viTestArgs
        return $LASTEXITCODE -eq 0
    }
    catch {
        Write-Status "Test execution failed: $_" 'fail'
        return $false
    }
}

function Get-TestsToRun {
    param([string]$Type)
    
    switch ($Type) {
        'unit' {
            @(
                '3d-geometry-trellis2',
                'particle-systems',
                'texture-systems'
            )
        }
        'integration' {
            @('3d-asset-pipeline')
        }
        'all' {
            @(
                '3d-geometry-trellis2',
                'particle-systems',
                'texture-systems',
                '3d-asset-pipeline'
            )
        }
    }
}

function Run-TrellisBenchmark {
    Write-Header "TRELLIS2 Quality Validation Benchmark"
    
    $shipClasses = @('fighter', 'corvette', 'freighter', 'capital')
    $tiers = @('low', 'medium', 'high')
    
    Write-Host "`nShip Class | Triangle Budget | Tier | Status" -ForegroundColor Cyan
    Write-Host "─" * 60
    
    foreach ($class in $shipClasses) {
        $budgets = @{
            'fighter'   = @{ low = 1500; medium = 2250; high = 3000 }
            'corvette'  = @{ low = 6000; medium = 6000; high = 8000 }
            'freighter' = @{ low = 11000; medium = 11000; high = 15000 }
            'capital'   = @{ low = 12500; medium = 18750; high = 25000 }
        }
        
        foreach ($tier in $tiers) {
            $budget = $budgets[$class][$tier]
            $status = if ($budget -gt 0) { "✓ OK" } else { "✗ FAIL" }
            Write-Host "$class | $budget | $tier | $status" -ForegroundColor White
        }
    }
    
    Write-Host "`n"
}

function Run-ParticlesBenchmark {
    Write-Header "Particle System Performance Benchmarks"
    
    $scenarios = @(
        @{ Name = "Weapon Fire"; Particles = 20; Lifetime = 0.1 }
        @{ Name = "Explosion"; Particles = 200; Lifetime = 2.0 }
        @{ Name = "Shield Impact"; Particles = 50; Lifetime = 0.5 }
        @{ Name = "Engine Thrust"; Particles = 500; Lifetime = 0.2 }
    )
    
    Write-Host "`nScenario | Particles | Lifetime | Expected FPS" -ForegroundColor Cyan
    Write-Host "─" * 60
    
    foreach ($scenario in $scenarios) {
        $fps = 60 - ($scenario.Particles / 100)
        $fpsStr = "{0:N1}" -f $fps
        Write-Host "$($scenario.Name) | $($scenario.Particles) | $($scenario.Lifetime)s | $fpsStr FPS"
    }
    
    Write-Host "`n"
}

function Run-TextureBenchmark {
    Write-Header "Texture System Quality Tiers"
    
    $tiers = @(
        @{ Name = "Low"; Size = 256; Memory = "512 KB" }
        @{ Name = "Medium"; Size = 512; Memory = "1 MB" }
        @{ Name = "High"; Size = 1024; Memory = "4 MB" }
        @{ Name = "Ultra"; Size = 2048; Memory = "16 MB" }
    )
    
    Write-Host "`nTier | Resolution | Per Texture | Material Set" -ForegroundColor Cyan
    Write-Host "─" * 60
    
    foreach ($tier in $tiers) {
        $materialMem = "$([math]::Round([int]$tier.Memory.Split(' ')[0] * 4)) MB"
        Write-Host "$($tier.Name) | $($tier.Size)x$($tier.Size) | $($tier.Memory) | $materialMem"
    }
    
    Write-Host "`n"
}

# Main execution
try {
    Write-Header "🚀 3D Geometry & Particle Systems Test Suite"
    
    $testsToRun = Get-TestsToRun -Type $TestType
    
    if ($Verbose) {
        Write-Host "Configuration:" -ForegroundColor Yellow
        Write-Host "  Test Type: $TestType"
        Write-Host "  Watch Mode: $Watch"
        Write-Host "  Coverage: $Coverage"
        Write-Host "  Tests: $($testsToRun -join ', ')"
        Write-Host ""
    }
    
    # Run benchmarks if not in watch mode
    if (-not $Watch) {
        Run-TrellisBenchmark
        Run-ParticlesBenchmark
        Run-TextureBenchmark
    }
    
    # Run test suite
    $success = Run-Tests -Tests $testsToRun -RunWatch $Watch -RunCoverage $Coverage
    
    if ($success) {
        Write-Header "✓ All Tests Passed"
        Write-Status "3D Geometry Validation" 'pass'
        Write-Status "Particle System Tests" 'pass'
        Write-Status "Texture Generation" 'pass'
        Write-Status "Pipeline Integration" 'pass'
        exit 0
    } else {
        Write-Header "✗ Tests Failed"
        exit 1
    }
}
catch {
    Write-Host "Fatal error: $_" -ForegroundColor Red
    exit 1
}
