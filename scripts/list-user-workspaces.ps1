param(
  [ValidateSet('inoraxium', 'horaghfus', 'all')]
  [string]$System = 'all'
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
$systems = if ($System -eq 'all') { @('inoraxium', 'horaghfus') } else { @($System) }
$workspaceSummaries = @()

foreach ($currentSystem in $systems) {
  $registryPath = Join-Path $repoRoot "src\data\$currentSystem\user-pages\registry.json"
  $registry = Read-JsonFile $registryPath
  $pages = @($registry.pages)

  if ($pages.Count -eq 0) {
    continue
  }

  $grouped = $pages | Group-Object workspaceId
  foreach ($group in $grouped) {
    $entries = @($group.Group)
    $pageEntries = @($entries | Where-Object { -not $_.isFolder })
    $workspaceId = [string]$group.Name
    $workspaceTitle = [string]($entries[0].workspaceTitle)
    if ([string]::IsNullOrWhiteSpace($workspaceTitle)) {
      $workspaceTitle = $workspaceId
    }

    $workspacePath = "src/data/$currentSystem/user-pages/workspaces/$workspaceId"

    $workspaceSummaries += [pscustomobject]@{
      System = $currentSystem
      WorkspaceId = $workspaceId
      WorkspaceTitle = $workspaceTitle
      PageCount = $pageEntries.Count
      Pages = (($pageEntries | Sort-Object title, id | ForEach-Object { $_.id }) -join ', ')
      Path = $workspacePath
    }
  }
}

if ($workspaceSummaries.Count -eq 0) {
  Write-Host 'No imported user workspaces were found.'
  exit 0
}

$workspaceSummaries |
  Sort-Object System, WorkspaceTitle, WorkspaceId |
  Format-Table -AutoSize System, WorkspaceId, WorkspaceTitle, PageCount, Pages, Path
