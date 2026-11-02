<#
.SYNOPSIS
    Automated Release Publisher for Server Command Center
    Powered by Falah Tech (falah-tech.com)

.DESCRIPTION
    Validates the workspace, commits changes, creates an annotated release tag,
    and pushes to GitHub to fire the automated release workflow.

.EXAMPLE
    .\scripts\publish-release.ps1 -Version "1.0.0"
#>

param (
    [Parameter(Mandatory=$false)]
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"

$cleanVersion = $Version.TrimStart('v')
$tagName = "v$cleanVersion"

Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "🚀 Server Command Center Release Flow ($tagName)" -ForegroundColor Green
Write-Host "   Powered by Falah Tech (falah-tech.com)" -ForegroundColor DarkGray
Write-Host "==================================================" -ForegroundColor Cyan

# 1. Verify working directory
$repoRoot = Resolve-Path "$PSScriptRoot\.."
Set-Location $repoRoot

# 2. Run TypeScript checks
Write-Host "`n[1/5] Verifying TypeScript types..." -ForegroundColor Yellow
npm run typecheck
if ($LASTEXITCODE -ne 0) {
    Write-Error "TypeScript check failed. Aborting release."
}
Write-Host "✓ TypeScript check passed." -ForegroundColor Green

# 3. Stage & Commit any pending changes
Write-Host "`n[2/5] Checking Git working tree..." -ForegroundColor Yellow
$gitStatus = git status --porcelain
if ($gitStatus) {
    Write-Host "Staging uncommitted changes..." -ForegroundColor DarkGray
    git add -A
    git commit -m "chore(release): prepare $tagName release"
    Write-Host "✓ Committed pending files." -ForegroundColor Green
} else {
    Write-Host "✓ Working tree clean." -ForegroundColor Green
}

# 4. Create annotated tag
Write-Host "`n[3/5] Tagging release $tagName..." -ForegroundColor Yellow
git tag -a -f $tagName -m "Server Command Center $tagName Release - Powered by Falah Tech"
Write-Host "✓ Created tag $tagName." -ForegroundColor Green

# 5. Check remote and push
Write-Host "`n[4/5] Checking GitHub remote origin..." -ForegroundColor Yellow
$remoteUrl = git remote get-url origin 2>$null
if (-not $remoteUrl) {
    Write-Host "Adding default remote origin: https://github.com/Abdulllah321/server-command-center.git" -ForegroundColor DarkGray
    git remote add origin https://github.com/Abdulllah321/server-command-center.git
}

Write-Host "Pushing to origin master and tags..." -ForegroundColor Yellow
git push -u origin master --tags

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[5/5] Release triggered successfully!" -ForegroundColor Green
    Write-Host "GitHub Actions is now compiling the Windows Setup (.exe) and Portable Binary." -ForegroundColor Cyan
    Write-Host "Track build progress at: https://github.com/Abdulllah321/server-command-center/actions" -ForegroundColor Cyan
} else {
    Write-Host "`n⚠ Notice: If push failed due to repository permissions, ensure you have created" -ForegroundColor Yellow
    Write-Host "  https://github.com/Abdulllah321/server-command-center on GitHub first." -ForegroundColor Yellow
}

