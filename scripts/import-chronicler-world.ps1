param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$SourcePath,
  [Parameter(Mandatory = $true)]
  [ValidateSet('inoraxium', 'horaghfus')]
  [string]$System,
  [string]$WorkspaceTitle,
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

function Convert-RelativeMarkdownPathToId {
  param(
    [string]$WorkspaceId,
    [string]$RelativeMarkdownPath
  )

  $withoutExtension = [System.IO.Path]::ChangeExtension($RelativeMarkdownPath, $null)
  $normalizedPath = Convert-RelativePathToPosix $withoutExtension
  $pathSlug = ConvertTo-Slug ($normalizedPath -replace '/', ' ')
  if ([string]::IsNullOrWhiteSpace($pathSlug)) {
    $pathSlug = 'page'
  }

  return "$WorkspaceId--$pathSlug"
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

function Get-FrontmatterBlock {
  param([string]$Text)

  $match = [regex]::Match($Text, '^(---\s*\r?\n)([\s\S]*?)(\r?\n---\s*\r?\n?)')
  if (-not $match.Success) {
    return $null
  }

  return [pscustomobject]@{
    Prefix = $match.Groups[1].Value
    Content = $match.Groups[2].Value
    Suffix = $match.Groups[3].Value
    Length = $match.Length
  }
}

function Get-FrontmatterValue {
  param(
    [string]$Frontmatter,
    [string]$Key
  )

  if ([string]::IsNullOrWhiteSpace($Frontmatter)) {
    return $null
  }

  $match = [regex]::Match($Frontmatter, "(?m)^\s*$([regex]::Escape($Key))\s*:\s*(.+?)\s*$")
  if (-not $match.Success) {
    return $null
  }

  $value = $match.Groups[1].Value.Trim()
  return $value.Trim("'`"")
}

function Get-FrontmatterTags {
  param([string]$Frontmatter)

  if ([string]::IsNullOrWhiteSpace($Frontmatter)) {
    return @()
  }

  $inlineMatch = [regex]::Match($Frontmatter, '(?m)^\s*tags\s*:\s*\[(.*?)\]\s*$')
  if ($inlineMatch.Success) {
    return @(
      $inlineMatch.Groups[1].Value.Split(',') |
      ForEach-Object { $_.Trim().Trim("'`"") } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
  }

  $singleMatch = [regex]::Match($Frontmatter, '(?m)^\s*tags\s*:\s*([^\r\n\[\]].+?)\s*$')
  if ($singleMatch.Success) {
    $singleValue = $singleMatch.Groups[1].Value.Trim().Trim("'`"")
    if (-not [string]::IsNullOrWhiteSpace($singleValue)) {
      return @($singleValue)
    }
  }

  $blockMatch = [regex]::Match($Frontmatter, '(?ms)^\s*tags\s*:\s*\r?\n((?:\s*-\s*.+\r?\n?)*)')
  if ($blockMatch.Success) {
    return @(
      [regex]::Matches($blockMatch.Groups[1].Value, '(?m)^\s*-\s*(.+?)\s*$') |
      ForEach-Object { $_.Groups[1].Value.Trim().Trim("'`"") } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
  }

  return @()
}

function Convert-RelativePathToPosix {
  param([string]$PathValue)

  return ($PathValue -replace '\\', '/').TrimStart('./')
}

function Should-SkipFile {
  param(
    [string]$RelativePath,
    [string]$Extension
  )

  if ($RelativePath -match '(^|/)\.obsidian(/|$)') { return $true }
  if ($RelativePath -match '(^|/)_system(/|$)') { return $true }
  if ($RelativePath -match '(^|/)\.git(/|$)') { return $true }
  if ($RelativePath -match '(^|/)_trash(/|$)') { return $true }
  if ($Extension -ieq '.md') { return $false }
  return $false
}

function Replace-ImageFieldValue {
  param(
    [string]$LineValue,
    [hashtable]$AssetByRelative,
    [hashtable]$AssetByBaseName
  )

  return [regex]::Replace($LineValue, '([A-Za-z0-9_\-./\\ ]+\.(png|jpg|jpeg|webp|avif|gif|svg))', {
    param($match)

    $original = $match.Groups[1].Value.Trim()
    $normalized = Convert-RelativePathToPosix $original

    if ($AssetByRelative.ContainsKey($normalized)) {
      return $AssetByRelative[$normalized]
    }

    $basename = [System.IO.Path]::GetFileName($normalized)
    if ($AssetByBaseName.ContainsKey($basename) -and $AssetByBaseName[$basename].Count -eq 1) {
      return $AssetByBaseName[$basename][0]
    }

    return $original
  })
}

function Rewrite-ChroniclerMarkdown {
  param(
    [string]$Text,
    [hashtable]$AssetByRelative,
    [hashtable]$AssetByBaseName
  )

  $rewritten = [regex]::Replace($Text, '!\[\[([^\]]+)\]\]', {
    param($match)

    $inner = $match.Groups[1].Value
    $parts = $inner.Split('|', 2)
    $target = $parts[0].Trim()
    $suffix = if ($parts.Count -gt 1) { "|$($parts[1])" } else { '' }

    $normalized = Convert-RelativePathToPosix $target
    $candidate = $null
    if ($AssetByRelative.ContainsKey($normalized)) {
      $candidate = $AssetByRelative[$normalized]
    } else {
      $basename = [System.IO.Path]::GetFileName($normalized)
      if ($AssetByBaseName.ContainsKey($basename) -and $AssetByBaseName[$basename].Count -eq 1) {
        $candidate = $AssetByBaseName[$basename][0]
      }
    }

    if ($candidate) {
      return "![[${candidate}${suffix}]]"
    }

    return $match.Value
  })

  $rewritten = [regex]::Replace($rewritten, '(?m)^(\s*image\s*:\s*)(.+?)\s*$', {
    param($match)
    $prefix = $match.Groups[1].Value
    $value = $match.Groups[2].Value
    return $prefix + (Replace-ImageFieldValue -LineValue $value -AssetByRelative $AssetByRelative -AssetByBaseName $AssetByBaseName)
  })

  $rewritten = [regex]::Replace($rewritten, '(<img\b[^>]*\bsrc=")([^"]+)(")', {
    param($match)
    $prefix = $match.Groups[1].Value
    $value = $match.Groups[2].Value
    $suffix = $match.Groups[3].Value

    $normalized = Convert-RelativePathToPosix $value
    if ($AssetByRelative.ContainsKey($normalized)) {
      return $prefix + $AssetByRelative[$normalized] + $suffix
    }

    $basename = [System.IO.Path]::GetFileName($normalized)
    if ($AssetByBaseName.ContainsKey($basename) -and $AssetByBaseName[$basename].Count -eq 1) {
      return $prefix + $AssetByBaseName[$basename][0] + $suffix
    }

    return $match.Value
  })

  return $rewritten
}

$repoRoot = Resolve-ExistingPath (Join-Path $PSScriptRoot '..')
$resolvedSourcePath = Resolve-ExistingPath $SourcePath
$sourceItem = Get-Item -LiteralPath $resolvedSourcePath

$temporaryRoot = Join-Path $repoRoot '.import-temp'
Ensure-Directory $temporaryRoot

$cleanupPath = $null
$sourceRoot = $resolvedSourcePath

try {
  if ($sourceItem.PSIsContainer) {
    $children = @(Get-ChildItem -LiteralPath $resolvedSourcePath)
    if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
      $sourceRoot = $children[0].FullName
    }
  } elseif ($sourceItem.Extension -ieq '.zip') {
    $cleanupPath = Join-Path $temporaryRoot ([guid]::NewGuid().ToString())
    Ensure-Directory $cleanupPath
    Expand-Archive -LiteralPath $resolvedSourcePath -DestinationPath $cleanupPath -Force

    $children = @(Get-ChildItem -LiteralPath $cleanupPath)
    if ($children.Count -eq 1 -and $children[0].PSIsContainer) {
      $sourceRoot = $children[0].FullName
    } else {
      $sourceRoot = $cleanupPath
    }
  } else {
    throw 'Source must be either a Chronicler vault folder or a .zip archive.'
  }

  $workspaceFolderName = Split-Path -Leaf $sourceRoot
  $resolvedWorkspaceTitle = if ($WorkspaceTitle) { $WorkspaceTitle } else { $workspaceFolderName }
  $resolvedWorkspaceId = if ($WorkspaceId) { $WorkspaceId } else { ConvertTo-Slug $workspaceFolderName }
  if ([string]::IsNullOrWhiteSpace($resolvedWorkspaceId)) {
    $resolvedWorkspaceId = 'chronicler-vault'
  }

  $registryDirectory = Join-Path $repoRoot "src\data\$System\user-pages"
  $registryPath = Join-Path $registryDirectory 'registry.json'
  $workspaceDirectory = Join-Path $registryDirectory "workspaces\$resolvedWorkspaceId"
  $workspaceAssetsDirectory = Join-Path $workspaceDirectory 'assets'

  Ensure-Directory $registryDirectory
  Ensure-Directory (Join-Path $registryDirectory 'workspaces')

  if (Test-Path -LiteralPath $workspaceDirectory) {
    Remove-Item -LiteralPath $workspaceDirectory -Recurse -Force
  }
  Ensure-Directory $workspaceDirectory
  Ensure-Directory $workspaceAssetsDirectory

  $allFiles = @(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File)
  $markdownFiles = @()
  $assetFiles = @()

  foreach ($file in $allFiles) {
    $relativePath = Convert-RelativePathToPosix ($file.FullName.Substring($sourceRoot.Length).TrimStart('\', '/'))
    if (Should-SkipFile -RelativePath $relativePath -Extension $file.Extension) {
      continue
    }

    if ($file.Extension -ieq '.md') {
      $markdownFiles += [pscustomobject]@{
        File = $file
        RelativePath = $relativePath
      }
    } else {
      $assetFiles += [pscustomobject]@{
        File = $file
        RelativePath = $relativePath
      }
    }
  }

  if ($markdownFiles.Count -eq 0) {
    throw 'No markdown files were found in the Chronicler vault.'
  }

  $assetByRelative = @{}
  $assetByBaseName = @{}

  foreach ($assetFile in $assetFiles) {
    $assetRelativePath = "assets/$($assetFile.RelativePath)"
    $assetRelativePath = Convert-RelativePathToPosix $assetRelativePath
    $assetByRelative[$assetFile.RelativePath] = $assetRelativePath

    $baseName = [System.IO.Path]::GetFileName($assetFile.RelativePath)
    if (-not $assetByBaseName.ContainsKey($baseName)) {
      $assetByBaseName[$baseName] = New-Object System.Collections.ArrayList
    }
    [void]$assetByBaseName[$baseName].Add($assetRelativePath)

    $targetAssetPath = Join-Path $workspaceDirectory ($assetRelativePath -replace '/', '\')
    Ensure-Directory (Split-Path -Parent $targetAssetPath)
    Copy-Item -LiteralPath $assetFile.File.FullName -Destination $targetAssetPath -Force
  }

  $registryObject = Read-JsonFile $registryPath
  if (-not $registryObject) {
    $registryObject = [pscustomobject]@{
      version = 1
      pages = @()
    }
  }

  $filteredPages = @(
    @($registryObject.pages) | Where-Object {
      -not (($_.workspaceId -eq $resolvedWorkspaceId) -and ($_.system -eq $System))
    }
  )

  $pageEntries = @()
  $visibleMainPageIds = New-Object System.Collections.ArrayList

  foreach ($markdownFile in $markdownFiles) {
    $rawText = Get-Content -LiteralPath $markdownFile.File.FullName -Raw
    $rewrittenText = Rewrite-ChroniclerMarkdown -Text $rawText -AssetByRelative $assetByRelative -AssetByBaseName $assetByBaseName
    $frontmatterBlock = Get-FrontmatterBlock -Text $rewrittenText
    $frontmatterText = if ($frontmatterBlock) { $frontmatterBlock.Content } else { '' }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($markdownFile.File.Name)
    $defaultTitle = ($baseName -replace '[_-]+', ' ').Trim()
    $title = Get-FrontmatterValue -Frontmatter $frontmatterText -Key 'title'
    if ([string]::IsNullOrWhiteSpace($title)) {
      $title = $defaultTitle
    }
    $subtitle = Get-FrontmatterValue -Frontmatter $frontmatterText -Key 'subtitle'
    $tags = @(Get-FrontmatterTags -Frontmatter $frontmatterText)
    $id = Convert-RelativeMarkdownPathToId -WorkspaceId $resolvedWorkspaceId -RelativeMarkdownPath $markdownFile.RelativePath
    if ([string]::IsNullOrWhiteSpace($id)) {
      $id = ConvertTo-Slug $title
    }

    $relativeDirectory = Convert-RelativePathToPosix ([System.IO.Path]::GetDirectoryName($markdownFile.RelativePath))
    if ($relativeDirectory -eq '.') {
      $relativeDirectory = ''
    }

    $parentId = ''
    $sidebarVisible = $false
    if ($baseName.ToLowerInvariant() -eq 'main') {
      $sidebarVisible = $true
      [void]$visibleMainPageIds.Add($id)
    }

    $targetPageDirectory = Join-Path $workspaceDirectory $id
    Ensure-Directory $targetPageDirectory
    Set-Content -LiteralPath (Join-Path $targetPageDirectory 'page.md') -Value $rewrittenText

    $bodyText = if ($frontmatterBlock) { $rewrittenText.Substring($frontmatterBlock.Length).TrimStart("`r", "`n") } else { $rewrittenText }
    Set-Content -LiteralPath (Join-Path $targetPageDirectory 'body.md') -Value $bodyText

    $pageEntries += [pscustomobject]@{
      workspaceId = $resolvedWorkspaceId
      workspaceTitle = $resolvedWorkspaceTitle
      id = $id
      aliases = @($baseName, $title)
      title = $title
      subtitle = $subtitle
      icon = ''
      content = "src/data/$System/user-pages/workspaces/$resolvedWorkspaceId/$id/page.md"
      system = $System
      parentId = $parentId
      sidebarVisible = $sidebarVisible
      order = $baseName
      width = ''
      folderPath = $relativeDirectory
      sourceFile = $markdownFile.RelativePath
      tags = $tags
      isFolder = $false
    }
  }

  if ($pageEntries.Count -gt 0 -and $visibleMainPageIds.Count -eq 0) {
    $pageEntries[0].sidebarVisible = $true
  }

  $combinedEntries = @($filteredPages + $pageEntries)
  $updatedRegistry = [pscustomobject]@{
    version = 1
    pages = @($combinedEntries | Sort-Object system, workspaceTitle, folderPath, title, id)
  }

  $updatedRegistry | ConvertTo-Json -Depth 100 | Set-Content -LiteralPath $registryPath

  Write-Host "Imported Chronicler vault '$resolvedWorkspaceTitle' as workspace '$resolvedWorkspaceId' for system '$System'."
  Write-Host "Markdown pages: $($markdownFiles.Count)"
  Write-Host "Copied assets: $($assetFiles.Count)"
  Write-Host "Updated registry: src/data/$System/user-pages/registry.json"
} finally {
  if ($cleanupPath -and (Test-Path -LiteralPath $cleanupPath)) {
    Remove-Item -LiteralPath $cleanupPath -Recurse -Force
  }
}
