param([switch]$Deploy)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Invoke-NodeStep {
    param([string]$Label, [string[]]$NodeArguments)
    Write-Host $Label
    & node @NodeArguments
    if ($LASTEXITCODE -ne 0) { throw "$Label failed (exit $LASTEXITCODE)." }
}

if (-not (Test-Path '.\node_modules\vite\bin\vite.js')) {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
Invoke-NodeStep 'Build and site tests' @('scripts/test.mjs')
Invoke-NodeStep 'MCP settlement tests' @('--test', '--import', './mcp/tests/register.mjs', 'mcp/tests/settlement.test.mjs')

if ($Deploy) {
    # Apply schema before publishing code that reads the new columns.
    Invoke-NodeStep 'Apply additive production database migration' @('--env-file-if-exists=.env.cloudflare', 'node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB', '--remote', '--config', 'wrangler.jsonc')
    Invoke-NodeStep 'Publish production Worker' @('--env-file-if-exists=.env.cloudflare', 'node_modules/wrangler/bin/wrangler.js', 'deploy', '--config', 'dist/server/wrangler.json')
    Write-Host 'Published. Run Salesforce sync for each dealer, then check the new columns.'
} else {
    Write-Host 'Validation complete. To publish, run this script again with -Deploy.'
}
