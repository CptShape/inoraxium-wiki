param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$PackagePath
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

function Ensure-Directory {
  param([string]$PathValue)

  if (-not (Test-Path -LiteralPath $PathValue)) {
    New-Item -ItemType Directory -Path $PathValue | Out-Null
  }
}

function ConvertTo-Slug {
  param([string]$Value)

  $lower = $Value.Trim().ToLowerInvariant()
  $slug = [regex]::Replace($lower, '[^a-z0-9]+', '-')
  return $slug.Trim('-')
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

function Get-ObjectPropertyValue {
  param(
    [Parameter(Mandatory = $true)]
    [object]$ObjectValue,
    [Parameter(Mandatory = $true)]
    [string]$PropertyName
  )

  if ($null -eq $ObjectValue) {
    return $null
  }

  $property = $ObjectValue.PSObject.Properties[$PropertyName]
  if ($null -eq $property) {
    return $null
  }

  return $property.Value
}

$repoRoot = Resolve-ExistingPath (Join-Path $PSScriptRoot '..')
$resolvedPackagePath = Resolve-ExistingPath $PackagePath
$packageItem = Get-Item -LiteralPath $resolvedPackagePath

$temporaryRoot = Join-Path $repoRoot '.import-temp'
Ensure-Directory $temporaryRoot

$cleanupPath = $null
$sourceRoot = $resolvedPackagePath

try {
  if ($packageItem.PSIsContainer) {
    $children = @(Get-ChildItem -LiteralPath $resolvedPackagePath)
    if ($children.Count -eq 1 -and $children[0].PSIsContainer -and (Test-Path -LiteralPath (Join-Path $children[0].FullName 'manifest.json'))) {
      $sourceRoot = $children[0].FullName
    }
  } elseif ($packageItem.Extension -ieq '.zip') {
    $cleanupPath = Join-Path $temporaryRoot ([guid]::NewGuid().ToString())
    Ensure-Directory $cleanupPath
    Expand-Archive -LiteralPath $resolvedPackagePath -DestinationPath $cleanupPath -Force

    $children = @(Get-ChildItem -LiteralPath $cleanupPath)
    if ($children.Count -eq 1 -and $children[0].PSIsContainer -and (Test-Path -LiteralPath (Join-Path $children[0].FullName 'manifest.json'))) {
      $sourceRoot = $children[0].FullName
    } else {
      $sourceRoot = $cleanupPath
    }
  } else {
    throw 'Package must be either a .zip export or an extracted export directory.'
  }

  $manifestPath = Join-Path $sourceRoot 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) {
    throw "manifest.json not found under $sourceRoot"
  }

  $manifest = Read-JsonFile $manifestPath
  if (-not $manifest) {
    throw 'manifest.json could not be read.'
  }

  $workspaceFolderName = Split-Path -Leaf $sourceRoot
  $manifestWorkspaceTitle = Get-ObjectPropertyValue -ObjectValue $manifest -PropertyName 'workspaceTitle'
  $manifestWorkspaceId = Get-ObjectPropertyValue -ObjectValue $manifest -PropertyName 'workspaceId'

  $workspaceTitle = if ($manifestWorkspaceTitle) { [string]$manifestWorkspaceTitle } else { $workspaceFolderName -replace '-export$','' }
  $workspaceId = if ($manifestWorkspaceId) { [string]$manifestWorkspaceId } else { ConvertTo-Slug ($workspaceFolderName -replace '-export$','') }
  if ([string]::IsNullOrWhiteSpace($workspaceId)) {
    $workspaceId = 'user-workspace'
  }

  $pageEntries = @(Get-ObjectPropertyValue -ObjectValue $manifest -PropertyName 'pages')
  if ($pageEntries.Count -eq 0) {
    throw 'No pages were found in the export manifest.'
  }

  foreach ($system in @('inoraxium', 'horaghfus')) {
    $registryDirectory = Join-Path $repoRoot "src\data\$system\user-pages"
    $registryPath = Join-Path $registryDirectory 'registry.json'
    $workspaceDirectory = Join-Path $registryDirectory "workspaces\$workspaceId"

    Ensure-Directory $registryDirectory
    Ensure-Directory (Join-Path $registryDirectory 'workspaces')

    $registryObject = Read-JsonFile $registryPath
    if (-not $registryObject) {
      $registryObject = [pscustomobject]@{
        version = 1
        pages = @()
      }
    }

    $existingPages = @($registryObject.pages)
    $filteredPages = @(
      $existingPages | Where-Object {
        -not (($_.workspaceId -eq $workspaceId) -and ($_.system -eq $system))
      }
    )

    if (Test-Path -LiteralPath $workspaceDirectory) {
      Remove-Item -LiteralPath $workspaceDirectory -Recurse -Force
    }

    $systemPages = @(
      $pageEntries | Where-Object {
        (Get-ObjectPropertyValue -ObjectValue (Get-ObjectPropertyValue -ObjectValue $_ -PropertyName 'metadata') -PropertyName 'system') -eq $system
      }
    )

    if ($systemPages.Count -gt 0) {
      Ensure-Directory $workspaceDirectory
    }

    foreach ($page in $systemPages) {
      $pageMetadata = Get-ObjectPropertyValue -ObjectValue $page -PropertyName 'metadata'
      $pageId = [string](Get-ObjectPropertyValue -ObjectValue $pageMetadata -PropertyName 'id')
      if ([string]::IsNullOrWhiteSpace($pageId)) {
        throw "A page in the manifest is missing an id for system '$system'."
      }

      $pageSourceDirectory = Join-Path $sourceRoot "pages\$pageId"
      $pageMarkdownSource = Join-Path $pageSourceDirectory 'page.md'
      $bodyMarkdownSource = Join-Path $pageSourceDirectory 'body.md'

      if (-not (Test-Path -LiteralPath $pageMarkdownSource)) {
        throw "Expected page markdown not found: $pageMarkdownSource"
      }

      $targetPageDirectory = Join-Path $workspaceDirectory $pageId
      $targetAssetsDirectory = Join-Path $targetPageDirectory 'assets'
      Ensure-Directory $targetPageDirectory

      Copy-Item -LiteralPath $pageMarkdownSource -Destination (Join-Path $targetPageDirectory 'page.md') -Force

      if (Test-Path -LiteralPath $bodyMarkdownSource) {
        Copy-Item -LiteralPath $bodyMarkdownSource -Destination (Join-Path $targetPageDirectory 'body.md') -Force
      }

      $assetsSourceDirectory = Join-Path $pageSourceDirectory 'assets'
      if (Test-Path -LiteralPath $assetsSourceDirectory) {
        Copy-Item -LiteralPath $assetsSourceDirectory -Destination $targetAssetsDirectory -Recurse -Force
      }

      $contentPath = "src/data/$system/user-pages/workspaces/$workspaceId/$pageId/page.md"
      $registryEntry = [pscustomobject]@{
        workspaceId = $workspaceId
        workspaceTitle = $workspaceTitle
        id = $pageId
        title = [string](Get-ObjectPropertyValue -ObjectValue $pageMetadata -PropertyName 'title')
        subtitle = [string](Get-ObjectPropertyValue -ObjectValue $pageMetadata -PropertyName 'subtitle')
        icon = [string](Get-ObjectPropertyValue -ObjectValue $pageMetadata -PropertyName 'icon')
        content = $contentPath
        system = $system
        parentId = [string](Get-ObjectPropertyValue -ObjectValue $pageMetadata -PropertyName 'parentId')
        sidebarVisible = [bool](Get-ObjectPropertyValue -ObjectValue $pageMetadata -PropertyName 'sidebarVisible')
        order = [string](Get-ObjectPropertyValue -ObjectValue $pageMetadata -PropertyName 'order')
        width = Get-ObjectPropertyValue -ObjectValue $pageMetadata -PropertyName 'width'
      }

      $filteredPages += $registryEntry
    }

    $registryObject = [pscustomobject]@{
      version = 1
      pages = @($filteredPages | Sort-Object system, workspaceTitle, title, id)
    }

    $json = $registryObject | ConvertTo-Json -Depth 100
    Set-Content -LiteralPath $registryPath -Value $json
  }

  Write-Host "Imported workspace '$workspaceTitle' as '$workspaceId'."
  Write-Host 'Updated registries:'
  Write-Host ' - src/data/inoraxium/user-pages/registry.json'
  Write-Host ' - src/data/horaghfus/user-pages/registry.json'
} finally {
  if ($cleanupPath -and (Test-Path -LiteralPath $cleanupPath)) {
    Remove-Item -LiteralPath $cleanupPath -Recurse -Force
  }
}
