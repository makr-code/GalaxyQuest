param(
    [string]$BaseUrl = 'http://localhost:8080/api/textures.php',
    [int]$Size = 256,
    [string]$Algo = 'v1'
)

$descriptorObjects = @(
    @{ seed = 101; variant = 'rocky'; palette = @{ base = '#8aa2bf'; secondary = '#6f879e'; accent = '#a8c0da'; ice = '#e0ecf8' }; banding = 0.18; clouds = 0.16; craters = 0.19; ice_caps = 0.00; glow = 0.00 },
    @{ seed = 202; variant = 'gas';   palette = @{ base = '#cd9796'; secondary = '#a86f8b'; accent = '#f2ca7d'; ice = '#f0e4d0' }; banding = 0.42; clouds = 0.32; craters = 0.00; ice_caps = 0.00; glow = 0.05 },
    @{ seed = 303; variant = 'ocean'; palette = @{ base = '#4b7eb5'; secondary = '#2d5283'; accent = '#9abcff'; ice = '#e8f4ff' }; banding = 0.11; clouds = 0.38; craters = 0.03; ice_caps = 0.33; glow = 0.00 },
    @{ seed = 404; variant = 'lava';  palette = @{ base = '#644f4b'; secondary = '#4b3b39'; accent = '#ff8c42'; ice = '#dbccc5' }; banding = 0.14; clouds = 0.08; craters = 0.24; ice_caps = 0.00; glow = 0.72 }
)

$objectDescriptorSets = @(
    @{ object = 'ship'; descriptor = @{ seed = 911; variant = 'desert'; palette = @{ base = '#6f8fb3'; secondary = '#4d6680'; accent = '#9fc4eb'; ice = '#dce8f7' }; banding = 0.08; clouds = 0.00; craters = 0.12; ice_caps = 0.00; glow = 0.20 } },
    @{ object = 'moon'; descriptor = @{ seed = 1121; variant = 'rocky'; palette = @{ base = '#9da5ae'; secondary = '#7f8792'; accent = '#c6ced8'; ice = '#eef4fb' }; banding = 0.06; clouds = 0.00; craters = 0.28; ice_caps = 0.06; glow = 0.04 } },
    @{ object = 'star'; descriptor = @{ seed = 1517; variant = 'lava'; palette = @{ base = '#ffb268'; secondary = '#ff8d46'; accent = '#ffe0a2'; ice = '#fff4da' }; banding = 0.34; clouds = 0.00; craters = 0.03; ice_caps = 0.00; glow = 0.90 } },
    @{ object = 'building'; descriptor = @{ seed = 1879; variant = 'desert'; palette = @{ base = '#6ea4d8'; secondary = '#4d7aa1'; accent = '#9dc5ea'; ice = '#d9e9f7' }; banding = 0.12; clouds = 0.00; craters = 0.08; ice_caps = 0.00; glow = 0.18 } }
)

$maps = @('albedo', 'bump', 'emissive', 'cloud')
$ok = 0
$fail = 0

foreach ($descriptor in $descriptorObjects) {
    $json = $descriptor | ConvertTo-Json -Compress -Depth 5
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
    $encodedParam = [System.Uri]::EscapeDataString($encoded)

    foreach ($map in $maps) {
        $url = "${BaseUrl}?action=planet_map&map=${map}&size=${Size}&algo=${Algo}&d=${encodedParam}"
        try {
            $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 30
            $contentType = [string]$response.Headers['Content-Type']
            if ($response.StatusCode -eq 200 -and $contentType.StartsWith('image/')) {
                $ok++
            } else {
                $fail++
                Write-Output "WARN map=$map status=$($response.StatusCode) ctype=$contentType"
            }
        } catch {
            $fail++
            Write-Output "ERR map=$map message=$($_.Exception.Message)"
        }
    }
}

foreach ($objectSet in $objectDescriptorSets) {
    $objectType = [string]$objectSet.object
    $json = $objectSet.descriptor | ConvertTo-Json -Compress -Depth 5
    $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($json))
    $encodedParam = [System.Uri]::EscapeDataString($encoded)

    foreach ($map in $maps) {
        $url = "${BaseUrl}?action=object_map&object=$([System.Uri]::EscapeDataString($objectType))&map=${map}&size=${Size}&algo=${Algo}&d=${encodedParam}"
        try {
            $response = Invoke-WebRequest -Uri $url -Method GET -TimeoutSec 30
            $contentType = [string]$response.Headers['Content-Type']
            if ($response.StatusCode -eq 200 -and $contentType.StartsWith('image/')) {
                $ok++
            } else {
                $fail++
                Write-Output "WARN object=$objectType map=$map status=$($response.StatusCode) ctype=$contentType"
            }
        } catch {
            $fail++
            Write-Output "ERR object=$objectType map=$map message=$($_.Exception.Message)"
        }
    }
}

Write-Output "WARMUP_OK=$ok"
Write-Output "WARMUP_FAIL=$fail"
