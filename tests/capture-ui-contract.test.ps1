$ErrorActionPreference = 'Stop'
$html = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\index.html')

if ($html -notmatch "\.capture-overlay\{[^}]*position:fixed" -or
    $html -notmatch "\.capture-overlay\{[^}]*inset:0" -or
    $html -notmatch "\.capture-overlay\{[^}]*z-index:3[0-9]{3}" -or
    $html -notmatch "\.capture-rect\{" -or
    $html -notmatch "\.capture-tip\{") {
  throw 'capture overlay contract missing'
}

Write-Output "capture-ui-contract: PASS"
