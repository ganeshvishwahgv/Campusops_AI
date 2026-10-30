[CmdletBinding()]
param(
  [string]$CloudflaredPath,
  [ValidateRange(1024, 65535)][int]$Port = 3001
)

$ErrorActionPreference = 'Stop'
$workspacePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedSha256 = '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2'
if (-not $CloudflaredPath) { $CloudflaredPath = Join-Path $workspacePath '.tools\cloudflared.exe' }
$CloudflaredPath = (Resolve-Path -LiteralPath $CloudflaredPath).Path
if ((Get-FileHash -LiteralPath $CloudflaredPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedSha256) {
  throw 'cloudflared checksum does not match the reviewed 2026.10.3 Windows amd64 release. See docs/PUBLIC_DEMO.md.'
}
if (-not (Test-Path -LiteralPath (Join-Path $workspacePath '.next\BUILD_ID'))) {
  throw 'Build CampusOps first with npm.cmd run build.'
}
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
$nextPath = Join-Path $workspacePath 'node_modules\next\dist\bin\next'
if (-not (Test-Path -LiteralPath $nextPath)) { throw 'Install project dependencies first.' }

# Refuse to publish an unrelated service already using the selected local port.
$portProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try { $portProbe.Start() } finally { $portProbe.Stop() }

$runDirectory = Join-Path $workspacePath ('.public-demo\run-' + [Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $runDirectory -Force)
$tunnelOutput = Join-Path $runDirectory 'tunnel.stdout.log'
$tunnelError = Join-Path $runDirectory 'tunnel.stderr.log'
$serverOutput = Join-Path $runDirectory 'server.stdout.log'
$serverError = Join-Path $runDirectory 'server.stderr.log'
$tunnelProcess = $null
$serverProcess = $null

try {
  Write-Host 'Opening a temporary public tunnel. CampusOps login remains required.'
  $tunnelProcess = Start-Process -FilePath $CloudflaredPath -ArgumentList @(
    'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', "http://127.0.0.1:$Port"
  ) -WorkingDirectory $workspacePath -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $tunnelOutput -RedirectStandardError $tunnelError

  $publicOrigin = $null
  $tunnelDeadline = [DateTime]::UtcNow.AddSeconds(90)
  while (-not $publicOrigin -and [DateTime]::UtcNow -lt $tunnelDeadline) {
    if ($tunnelProcess.HasExited) { throw "Tunnel exited. Inspect $tunnelError" }
    $log = ''
    foreach ($path in @($tunnelOutput, $tunnelError)) {
      if (Test-Path -LiteralPath $path) { $log += Get-Content -LiteralPath $path -Raw -ErrorAction SilentlyContinue }
    }
    $match = [regex]::Match($log, 'https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com')
    if ($match.Success) { $publicOrigin = $match.Value }
    else { Start-Sleep -Milliseconds 500 }
  }
  if (-not $publicOrigin) { throw "No public URL was issued. Inspect $tunnelError" }

  # Pass the exact HTTPS origin to this production child only. Do not rewrite
  # .env or change the development server's origin. Existing sessions are kept.
  $originalOrigin = [Environment]::GetEnvironmentVariable('APP_ORIGIN', 'Process')
  $originalNodeEnv = [Environment]::GetEnvironmentVariable('NODE_ENV', 'Process')
  $originalTelemetry = [Environment]::GetEnvironmentVariable('NEXT_TELEMETRY_DISABLED', 'Process')
  try {
    [Environment]::SetEnvironmentVariable('APP_ORIGIN', $publicOrigin, 'Process')
    [Environment]::SetEnvironmentVariable('NODE_ENV', 'production', 'Process')
    [Environment]::SetEnvironmentVariable('NEXT_TELEMETRY_DISABLED', '1', 'Process')
    $serverProcess = Start-Process -FilePath $nodePath -ArgumentList @(
      ('"' + $nextPath + '"'), 'start', '--hostname', '127.0.0.1', '--port', "$Port"
    ) -WorkingDirectory $workspacePath -WindowStyle Hidden -PassThru `
      -RedirectStandardOutput $serverOutput -RedirectStandardError $serverError
  } finally {
    [Environment]::SetEnvironmentVariable('APP_ORIGIN', $originalOrigin, 'Process')
    [Environment]::SetEnvironmentVariable('NODE_ENV', $originalNodeEnv, 'Process')
    [Environment]::SetEnvironmentVariable('NEXT_TELEMETRY_DISABLED', $originalTelemetry, 'Process')
  }

  $serverReady = $false
  $serverDeadline = [DateTime]::UtcNow.AddSeconds(45)
  while (-not $serverReady -and [DateTime]::UtcNow -lt $serverDeadline) {
    if ($serverProcess.HasExited) { throw "CampusOps exited. Inspect $serverError" }
    try {
      $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/login" -UseBasicParsing -TimeoutSec 3
      $serverReady = $response.StatusCode -eq 200
    } catch { Start-Sleep -Milliseconds 500 }
  }
  if (-not $serverReady) { throw "CampusOps did not become ready. Inspect $serverError" }

  [System.IO.File]::WriteAllText((Join-Path $runDirectory 'url.txt'), $publicOrigin)
  Write-Host "PUBLIC_DEMO_URL=$publicOrigin"
  Write-Host "PUBLIC_DEMO_LOG_DIR=$runDirectory"
  Write-Host 'Keep this terminal and computer running. Press Ctrl+C here to stop this demo.'
  Write-Host 'Do not rebuild .next while this production server is running.'
  while (-not $tunnelProcess.HasExited -and -not $serverProcess.HasExited) { Start-Sleep -Seconds 2 }
  throw "A demo process stopped. Inspect the logs in $runDirectory"
} finally {
  # Stop only the two processes launched by this script, never other servers.
  foreach ($ownedProcess in @($serverProcess, $tunnelProcess)) {
    if ($null -ne $ownedProcess -and -not $ownedProcess.HasExited) {
      Stop-Process -Id $ownedProcess.Id -ErrorAction SilentlyContinue
    }
  }
}
