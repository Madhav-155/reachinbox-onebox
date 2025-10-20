param(
    [int]$maxAttempts = 60,
    [int]$delaySeconds = 5
)

Write-Host "Starting Docker Compose stack..."
docker compose up -d

$attempt = 0
while ($attempt -lt $maxAttempts) {
    $attempt++
    Write-Host "Checking services (attempt $attempt/$maxAttempts)..."
    try {
        npm run check:services
        if ($LASTEXITCODE -eq 0) {
            Write-Host "All services are reachable."
            exit 0
        }
    } catch {
        # ignore and retry
    }
    Start-Sleep -Seconds $delaySeconds
}

Write-Error "Timed out waiting for services to become healthy. Check 'docker compose logs' for details."
exit 1
