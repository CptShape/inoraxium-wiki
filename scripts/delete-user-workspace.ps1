param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('inoraxium', 'horaghfus')]
  [string]$System,
  [Parameter(Mandatory = $true)]
  [string]$WorkspaceId
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Resolve-ExistingPath {
  param([string]$PathValue)

  $resolved = Resolve-Path -LiteralPath $PathValue -ErrorAction SilentlyContinue
  if ($resolved) {
    return $resolved.Path
  }

  throw "Path not found: $PathValue"
}

function Read-JsonFile {
  param([string]$PathValue)

  if (-not (Test-Path -LiteralPath $PathValue)) {
    return $null
  }

  $raw = Get-Content -LiteralPath $PathValue -Raw
  if ([string]::IsNullOrWhiteSpace($raw)) {
    return $null
  }

  return $raw | ConvertFrom-Json
}

$repoRoot = Resolve-ExistingPath (Join-Path $PSScriptRoot '..')
$registryPath = Join-Path $repoRoot "src\data\$System\user-pages\registry.json"
$workspaceDirectory = Join-Path $repoRoot "src\data\$System\user-pages\workspaces\$WorkspaceId"

$registry = Read-JsonFile $registryPath
if (-not $registry) {
  throw "Registry not found or empty: $registryPath"
}

$existingPages = @($registry.pages)
$matchingPages = @($existingPages | Where-Object { $_.workspaceId -eq $WorkspaceId -and $_.system -eq $System })

if ($matchingPages.Count -eq 0) {
  throw "Workspace '$WorkspaceId' was not found in system '$System'."
}

$remainingPages = @($existingPages | Where-Object { -not ($_.workspaceId -eq $WorkspaceId -and $_.system -eq $System) })

if (Test-Path -LiteralPath $workspaceDirectory) {
  $resolvedWorkspaceDirectory = Resolve-ExistingPath $workspaceDirectory
  $expectedWorkspaceRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot "src\data\$System\user-pages\workspaces"))
  $fullWorkspaceDirectory = [System.IO.Path]::GetFullPath($resolvedWorkspaceDirectory)

  if (-not $fullWorkspaceDirectory.StartsWith($expectedWorkspaceRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to delete path outside workspace root: $fullWorkspaceDirectory"
  }

  Remove-Item -LiteralPath $resolvedWorkspaceDirectory -Recurse -Force
}

$updatedRegistry = [pscustomobject]@{
  version = 1
  pages = @($remainingPages | Sort-Object system, workspaceTitle, title, id)
}

$updatedRegistry | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $registryPath

$workspaceTitle = [string]$matchingPages[0].workspaceTitle
if ([string]::IsNullOrWhiteSpace($workspaceTitle)) {
  $workspaceTitle = $WorkspaceId
}

Write-Host "Deleted workspace '$workspaceTitle' ($WorkspaceId) from $System."
Write-Host "Removed $($matchingPages.Count) page(s)."
