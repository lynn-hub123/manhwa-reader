$ErrorActionPreference = 'Stop'
$html = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '..\index.html')

if ($html -notmatch "\.cover-recommendation\{[^}]*align-items:center" -or
    $html -notmatch "\.cover-recommendation-image\{[^}]*aspect-ratio:5/7" -or
    $html -notmatch "\.cover-recommendation-image\{[^}]*max-height" -or
    $html -notmatch "\.cover-recommendation-label\{[^}]*var\(--text" -or
    $html -notmatch "\.cover-recommendation-actions\{[^}]*flex-wrap:wrap") {
  throw 'cover recommendation preview contract missing'
}

if ($html -notmatch "\.cover-adjustment-handle\{[^}]*width:44px[^}]*height:44px[^}]*margin:0" -or
    $html -notmatch "\.cover-adjustment-handle-nw\{[^}]*left:0[^}]*top:0" -or
    $html -notmatch "\.cover-adjustment-handle-ne\{[^}]*right:0[^}]*top:0" -or
    $html -notmatch "\.cover-adjustment-handle-sw\{[^}]*left:0[^}]*bottom:0" -or
    $html -notmatch "\.cover-adjustment-handle-se\{[^}]*right:0[^}]*bottom:0") {
  throw 'Important 6: 44x44 corner hit boxes must stay fully inside an edge-touching crop'
}

if ($html -notmatch "\.cover-adjustment-rect\{[^}]*z-index:1" -or
    $html -notmatch "\.cover-adjustment-tip\{[^}]*z-index:2" -or
    $html -notmatch "\.cover-adjustment-actions\{[^}]*z-index:3") {
  throw 'Important 6: adjustment rectangle, hint, and actions need explicit ordered stacking'
}

Write-Output "capture-ui-contract: PASS"
