$ErrorActionPreference = 'Stop'
$html = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\index.html')

if ($html -notmatch "\.cover-recommendation\{[^}]*align-items:center" -or
    $html -notmatch "\.cover-recommendation-image\{[^}]*aspect-ratio:5/7" -or
    $html -notmatch "\.cover-recommendation-image\{[^}]*max-height" -or
    $html -notmatch "\.cover-recommendation-label\{[^}]*var\(--text" -or
    $html -notmatch "\.cover-recommendation-actions\{[^}]*flex-wrap:wrap") {
  throw 'cover recommendation preview contract missing'
}

Write-Output "capture-ui-contract: PASS"
