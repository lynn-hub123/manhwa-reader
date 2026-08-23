# Final review fix wave report

Date: 2026-08-23
Worktree: `F:\manhwa-reader\.worktrees\recommended-cover-capture`
Branch: `feature/recommended-cover-capture`
Main checkout (read-only during this wave): `F:\manhwa-reader`, `master@ba00baf`

## Outcome

All six Important findings and all six Minor findings in `final-fix-brief.md` were implemented in the feature worktree. Behavior changes followed test-first RED→GREEN cycles. No browser, visual, touch, or persistence checkbox was promoted to complete without real manual verification.

## RED evidence

### Important 1 — reject incomplete rendering canvases

- Command: `node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\cover-capture-recommendation.test.js`
- RED: `Important 1: a geometrically visible canvas is ineligible while PDF rendering is incomplete`; actual returned the visible canvas object, expected `null`.
- Command: `node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\capture-render-state.test.js`
- RED: `Important 1: render start leaves the visible canvas recommendation-ineligible`; actual state `undefined`, expected `rendering`.
- Production change: explicit canvas/wrapper `idle`/`rendering`/`complete` state; only fulfilled `page.render(...).promise` sets `complete`; failure, cancellation/rerender invalidation, chapter replacement, and reader teardown leave canvases ineligible.

### Important 2 — keep direct recommendation preview on save failure

- Command: `node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\cover-capture-preview.test.js`
- RED: direct save call had no dedicated options object (`undefined` instead of `{errorMessage:'封面保存失败，请重试'}`), reflecting the old close-before-save path.
- Production change: async guarded action, disabled during save, exactly one call per accepted click, closes only on result `=== true`, false/rejection keeps preview open and re-enables retry, rejection emits one dedicated toast while false relies on `setSeriesCover`'s one boundary toast.

### Important 3 — isolate reader keyboard/focus while capture UI is active

- Command: `node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\cover-capture-preview.test.js`
- RED: with the real reader handler loaded, preview keys produced `nextPage,nextPage,prevPage,nextChapter,prevChapter,fit,sidebar` instead of no reader actions.
- Production change: shared `captureUiActive` lifecycle for preview/adjustment, named reader entry guard, `role=dialog`/`aria-modal=true`, first-action focus, Tab/Shift+Tab trap, prior-focus restoration, and normal Enter/Space propagation. Adjustment keeps explicit capture-phase shortcut interception. Wheel uses one `{capture:true,passive:false}` options object for add/remove.

### Important 4 — four-corner projection resize and narrow restore

- Command: `node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\cover-capture-adjustment.test.js`
- RED 1: `Important 4 vertical-only resize changes size for nw`; actual width remained `200`, proving resize used only horizontal motion. (The test was first calibrated so the horizontal case was genuinely unconstrained before recording this RED.)
- RED 2: `Important 4: starting adjustment preserves a valid 60×84 recommendation`; actual `{width:80,height:112}`, expected `{width:60,height:84}`.
- Production change: pointer vector is projected onto the signed `5:7` diagonal from each opposite anchor, producing a positive width before real `CoverCapture.clampRect`; tests cover all four handles with horizontal-only, vertical-only, boundary, and crossing-pointer motion. The preferred minimum is narrowed to the valid original width when below 80px, and `rect`/`originalRect` are normalized once with the same rule.

### Important 5 — penalize black, transparent, and edge crops

- Command: `node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\cover-capture-recommendation.test.js`
- RED: `Important 5: a literal white-background line-art fixture outranks a pure-black crop` failed under the former non-white-heavy score.
- Production change: sampled RGB is alpha-composited onto white; continuous white and black dominance penalties outweigh raw non-white coverage; a small continuous visible-bounds edge penalty is passed into scoring. Literal black, transparent, white-background line-art, and identical centered/edge fixtures are covered.

### Important 6 — keep 44×44 handle targets inside crop/viewport

- Command: `powershell -NoProfile -ExecutionPolicy Bypass -File F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\capture-ui-contract.test.ps1`
- RED: `Important 6: 44x44 corner hit boxes must stay fully inside an edge-touching crop`.
- Production change: hit boxes use `width:44px;height:44px;margin:0` with their relevant inside edges at `0`; only the 14px visual dot centers on the border. Rectangle/hint/actions use explicit ordered z-index `1/2/3`.

### Minor behavior REDs

- Minor 1 command: recommendation test above. RED output target was `1000×500`, expected exact shared-unit `355×497` while preserving the full source sampling arguments `0,0,1000,500`.
- Minor 2 command: `node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\capture-modal-cleanup.test.js`. RED: backdrop listener count remained `1`, expected `0` after capture entry.
- Production changes: crop output uses integer unit `floor(min(sourceWidth/5,sourceHeight/7))`; `showModal` owns one idempotent cleanup and `startCoverCapture` invokes it immediately.
- Minor 3 is enforced by importing the real `cover-capture.js` helper in `cover-capture-adjustment.test.js`.
- Minor 4 is included in Important 6's z-index contract.
- Minor 5 and 6 are reflected in `CURRENT-PROGRESS.md` and `docs/ACCEPTANCE-CHECKLIST.md` without marking manual checks complete.

## GREEN evidence

Targeted GREEN commands returned:

```text
node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\cover-capture-recommendation.test.js  -> cover-capture-recommendation: PASS
node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\capture-render-state.test.js          -> capture-render-state: PASS
node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\cover-capture-preview.test.js         -> cover-capture-preview: PASS
node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\cover-capture-adjustment.test.js      -> cover-capture-adjustment: PASS
node F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\capture-modal-cleanup.test.js         -> capture-modal-cleanup: PASS
powershell -NoProfile -ExecutionPolicy Bypass -File F:\manhwa-reader\.worktrees\recommended-cover-capture\tests\capture-ui-contract.test.ps1 -> capture-ui-contract: PASS
```

Full automated suite command (PowerShell loop over every Node test, followed by the contract test) exited `0` with exact output:

```text
cover-capture-geometry: PASS
cover-capture-recommendation: PASS
capture-render-state: PASS
cover-capture-preview: PASS
cover-capture-adjustment: PASS
capture-start: PASS
capture-modal-cleanup: PASS
capture-ui-contract: PASS
```

Required verification commands:

```text
node --check F:\manhwa-reader\.worktrees\recommended-cover-capture\app.js           -> exit 0
node --check F:\manhwa-reader\.worktrees\recommended-cover-capture\cover-capture.js -> exit 0
node --check F:\manhwa-reader\.worktrees\recommended-cover-capture\db.js            -> exit 0
node --check F:\manhwa-reader\.worktrees\recommended-cover-capture\server.js        -> exit 0
git -C F:\manhwa-reader\.worktrees\recommended-cover-capture diff --check            -> exit 0
```

## Files

- Production: `app.js`, `index.html`
- Modified tests: `tests/cover-capture-recommendation.test.js`, `tests/cover-capture-preview.test.js`, `tests/cover-capture-adjustment.test.js`, `tests/capture-ui-contract.test.ps1`
- New tests: `tests/capture-render-state.test.js`, `tests/capture-modal-cleanup.test.js`
- Documentation: `CURRENT-PROGRESS.md`, `docs/ACCEPTANCE-CHECKLIST.md`, this report

## Commits

- `25a8b3f` — `修复推荐封面最终审查问题` (production and automated tests)
- `9d115d8` — `更新最终修复验收交接` (progress and acceptance evidence)
- Report archival: this file's containing commit, listed in the final handoff log.

## Self-review

- Re-read all six Important and six Minor findings against the final diff; each has implementation and evidence above.
- Confirmed the recommendation scope remains the current visible rendered canvas only, fixed `5:7`, local-only, and source-canvas crop; upload/text/candidate cover entry behavior was not intentionally changed.
- Confirmed direct recommendation and adjustment failures retain their own UI for retry; direct close is strict `=== true`.
- Confirmed real `CoverCapture.clampRect` is used in adjustment behavior tests.
- Confirmed manual browser/visual/touch/persistence checklist items remain unchecked.
- No plan/spec conflict required a product decision.

## Concerns / manual follow-up

- Real PDF.js cancellation timing, actual focus behavior across supported browsers, touch target feel, dimming/contrast in day and night themes, and IndexedDB persistence still require the existing manual browser checklist.
- Automated tests use DOM/canvas behavior harnesses rather than a full browser; they establish state, geometry, listener, focus, scoring, and layout contracts but do not replace visual/touch verification.
