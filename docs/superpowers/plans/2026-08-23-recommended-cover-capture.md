# Recommended Cover Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade current-view cover capture so the browser recommends a `5:7` crop, previews it, and lets the user accept or adjust it without leaving local processing.

**Architecture:** Add a small pure geometry/scoring module that can be tested directly in Node, then let `app.js` adapt rendered PDF canvases to that module and own the preview/save interaction. Reuse the existing modal and cover persistence paths; replace the mouse-only freeform overlay with a pointer-driven, fixed-ratio adjustment overlay.

**Tech Stack:** Vanilla JavaScript, Canvas 2D API, Pointer Events, existing HTML/CSS modal system, Node `assert` tests.

**Spec:** `docs/superpowers/specs/2026-08-23-recommended-cover-capture-design.md`

## Global Constraints

- Recommendation scope is only the currently visible rendered comic canvas.
- Cover crop ratio is fixed at `5:7` throughout recommendation and adjustment.
- Comic pixels remain local; no external service or AI model is added.
- Saving must crop from the source PDF canvas resolution.
- Existing upload, text-cover, and page-candidate flows remain unchanged.
- Mouse, touch, and pen input must use Pointer Events.

---

### Task 1: Pure crop geometry and recommendation scoring

**Files:**
- Create: `cover-capture.js`
- Create: `tests/cover-capture-geometry.test.js`
- Modify: `index.html`

**Interfaces:**
- Produces: `CoverCapture.fitRect(bounds, ratio, margin)` returning `{x, y, width, height}`.
- Produces: `CoverCapture.buildCandidates(bounds, ratio)` returning fixed-ratio candidate rectangles inside `bounds`.
- Produces: `CoverCapture.chooseCandidate(candidates, scoreCandidate)` returning the highest-scoring rectangle, with stable first-candidate tie breaking.
- Produces: `CoverCapture.clampRect(rect, bounds, ratio, minWidth)` for pointer adjustment.

- [ ] **Step 1: Write the failing geometry test**

```js
const assert = require('assert');
const capture = require('../cover-capture.js');

const bounds = {x: 100, y: 50, width: 700, height: 600};
const fitted = capture.fitRect(bounds, 5 / 7, 20);
assert.strictEqual(fitted.width / fitted.height, 5 / 7);
assert.ok(fitted.x >= 120 && fitted.y >= 70);
assert.ok(fitted.x + fitted.width <= 780);
assert.ok(fitted.y + fitted.height <= 630);

const candidates = capture.buildCandidates(bounds, 5 / 7);
assert.ok(candidates.length > 1);
candidates.forEach(rect => {
  assert.ok(Math.abs(rect.width / rect.height - 5 / 7) < 1e-9);
  assert.ok(rect.x >= bounds.x && rect.y >= bounds.y);
  assert.ok(rect.x + rect.width <= bounds.x + bounds.width);
  assert.ok(rect.y + rect.height <= bounds.y + bounds.height);
});

const chosen = capture.chooseCandidate(candidates, rect => rect.x);
assert.strictEqual(chosen.x, Math.max(...candidates.map(rect => rect.x)));

const clamped = capture.clampRect(
  {x: -100, y: -100, width: 1000, height: 10},
  bounds,
  5 / 7,
  80
);
assert.ok(clamped.x >= bounds.x && clamped.y >= bounds.y);
assert.ok(clamped.x + clamped.width <= bounds.x + bounds.width);
assert.ok(clamped.y + clamped.height <= bounds.y + bounds.height);
assert.ok(Math.abs(clamped.width / clamped.height - 5 / 7) < 1e-9);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/cover-capture-geometry.test.js`

Expected: FAIL because `cover-capture.js` does not exist.

- [ ] **Step 3: Implement the pure module**

Create a UMD-style module so Node tests receive `module.exports` and the browser receives `window.CoverCapture`. Candidate generation must use three useful scales and a small 3-by-3 position grid, deduplicate identical rectangles, and always fall back to `fitRect`. `clampRect` must preserve `5:7`, enforce `minWidth`, and keep the result within bounds.

- [ ] **Step 4: Load the module before `app.js`**

```html
<script src="db.js"></script>
<script src="cover-capture.js"></script>
<script src="app.js"></script>
```

- [ ] **Step 5: Run tests and verify GREEN**

Run: `node tests/cover-capture-geometry.test.js`

Expected: `cover-capture-geometry: PASS`.

- [ ] **Step 6: Commit**

```bash
git add cover-capture.js index.html tests/cover-capture-geometry.test.js
git commit -m "添加封面推荐裁切算法"
```

### Task 2: Recommend a crop from visible canvas pixels

**Files:**
- Modify: `app.js`
- Create: `tests/cover-capture-recommendation.test.js`

**Interfaces:**
- Consumes: `CoverCapture.buildCandidates(bounds, 5 / 7)` and `CoverCapture.chooseCandidate(candidates, scorer)`.
- Produces: `getVisibleCaptureSource()` returning `{canvas, canvasRect, visibleBounds}` or `null`.
- Produces: `scoreCaptureCandidate(canvas, canvasRect, candidate)` returning a finite numeric score.
- Produces: `recommendVisibleCoverCrop()` returning `{canvas, canvasRect, rect, originalRect, dataUrl}` or `null`.
- Produces: `cropCanvasToDataUrl(capture)` returning a high-resolution JPEG data URL.

- [ ] **Step 1: Write a failing recommendation behavior test**

Build two fake visible canvases with deterministic `getBoundingClientRect()` values and real-enough 2D pixel fixtures. Assert that the canvas with the largest visible intersection is selected, every scored candidate is `5:7`, a detailed non-white center candidate beats a blank candidate, and the returned preview data URL is produced from source canvas coordinates.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/cover-capture-recommendation.test.js`

Expected: FAIL because `recommendVisibleCoverCrop` is missing.

- [ ] **Step 3: Implement visible-source selection and scoring**

Use the intersection of each `.page-wrapper canvas`, `#viewer-area`, and the browser viewport. Score a downsampled candidate using independently weighted coverage, luminance variance, edge change, and white/black penalties. Catch unreadable pixel data and fall back to the centered fitted rectangle rather than failing the flow.

- [ ] **Step 4: Implement high-resolution crop conversion**

Map viewport-space crop coordinates into source canvas pixels with `canvas.width / canvasRect.width` and `canvas.height / canvasRect.height`, clamp all source coordinates, render to an output canvas, and return `toDataURL('image/jpeg', 0.92)`.

- [ ] **Step 5: Run recommendation and regression tests**

Run: `node tests/cover-capture-recommendation.test.js`

Run: `node tests/capture-start.test.js`

Expected: both print `PASS`.

- [ ] **Step 6: Commit**

```bash
git add app.js tests/cover-capture-recommendation.test.js
git commit -m "推荐当前画面的封面构图"
```

### Task 3: Recommendation preview and decision flow

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Create: `tests/cover-capture-preview.test.js`

**Interfaces:**
- Consumes: `recommendVisibleCoverCrop()` and `setSeriesCover(sid, dataUrl)`.
- Produces: `showCoverRecommendation(sid, capture)` with accept, adjust, and cancel actions.
- Changes: `startCoverCapture(sid)` computes a recommendation before opening preview.

- [ ] **Step 1: Write the failing preview behavior test**

Exercise `startCoverCapture('series-1')` against the lightweight DOM harness. Assert that no visible canvas produces the toast `当前画面还未加载完成`; a valid recommendation opens modal content containing `系统推荐`, `使用推荐`, and `调整一下`; accepting calls `setSeriesCover` exactly once; cancelling calls it zero times.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/cover-capture-preview.test.js`

Expected: FAIL because the existing function opens the manual overlay immediately.

- [ ] **Step 3: Implement loading and preview states**

Close the setup modal, show `正在分析当前画面…`, calculate the recommendation on the next animation frame, and render a `5:7` preview inside the existing modal. Use the current theme variables and existing button hierarchy. The primary action is `使用推荐`; `调整一下` is secondary; `取消` is neutral.

- [ ] **Step 4: Wire decision actions**

`使用推荐` calls `setSeriesCover` with the preview crop. `调整一下` closes the modal and passes the same capture object into Task 4's adjustment overlay. `取消`, backdrop click, and `Escape` discard the capture without changing the cover.

- [ ] **Step 5: Run preview and regression tests**

Run: `node tests/cover-capture-preview.test.js`

Run: `node tests/capture-start.test.js`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tests/capture-ui-contract.test.ps1`

Expected: all tests print `PASS`.

- [ ] **Step 6: Commit**

```bash
git add app.js index.html tests/cover-capture-preview.test.js tests/capture-start.test.js tests/capture-ui-contract.test.ps1
git commit -m "添加推荐封面预览确认流程"
```

### Task 4: Fixed-ratio pointer adjustment

**Files:**
- Modify: `app.js`
- Modify: `index.html`
- Create: `tests/cover-capture-adjustment.test.js`

**Interfaces:**
- Consumes: `CoverCapture.clampRect`, `cropCanvasToDataUrl`, and the capture object from `showCoverRecommendation`.
- Produces: `startCoverAdjustment(sid, capture)`.

- [ ] **Step 1: Write the failing adjustment behavior test**

Start from a known recommendation rectangle, dispatch pointer drag and resize sequences, and assert that the resulting rectangle remains inside the visible canvas and retains `5:7`. Assert that `恢复推荐位置` restores the exact original rectangle, `Escape` saves nothing, and `保存为封面` crops and calls `setSeriesCover` once.

- [ ] **Step 2: Run the test and verify RED**

Run: `node tests/cover-capture-adjustment.test.js`

Expected: FAIL because `startCoverAdjustment` is missing.

- [ ] **Step 3: Implement the adjustment overlay**

Render the selected area, dim its surroundings, add four corner handles with minimum `44×44` pointer hit areas, and add a compact action bar containing `保存为封面`, `恢复推荐位置`, and `取消`. Use `pointerdown`, `pointermove`, `pointerup`, pointer capture, and `touch-action:none`. Dragging moves the box; corner dragging resizes from the opposite corner while `CoverCapture.clampRect` locks `5:7` and canvas bounds.

- [ ] **Step 4: Implement cleanup and error handling**

One cleanup function must remove the overlay, action bar, key listener, and pointer listeners. All exits call cleanup exactly once. Save errors keep the old cover and show `封面保存失败，请重试`.

- [ ] **Step 5: Run adjustment and full automated suite**

Run: `node tests/cover-capture-adjustment.test.js`

Run: `node tests/cover-capture-geometry.test.js`

Run: `node tests/cover-capture-recommendation.test.js`

Run: `node tests/cover-capture-preview.test.js`

Run: `node tests/capture-start.test.js`

Run: `powershell -NoProfile -ExecutionPolicy Bypass -File tests/capture-ui-contract.test.ps1`

Run: `node --check app.js`

Run: `node --check cover-capture.js`

Expected: every test prints `PASS`; both syntax checks exit `0`.

- [ ] **Step 6: Commit**

```bash
git add app.js index.html tests/cover-capture-adjustment.test.js
git commit -m "支持固定比例调整推荐封面"
```

### Task 5: Browser acceptance and documentation

**Files:**
- Modify: `docs/ACCEPTANCE-CHECKLIST.md`
- Modify: `CURRENT-PROGRESS.md`

**Interfaces:**
- Consumes: the complete recommendation and adjustment flow from Tasks 1-4.
- Produces: repeatable acceptance coverage and an updated project handoff.

- [ ] **Step 1: Add acceptance cases**

Document desktop and touch-width checks for: loading state, visible-only recommendation, `5:7` preview, direct accept, adjust from recommended position, drag, resize, restore, cancel, `Escape`, no-canvas fallback, day/night themes, and unchanged upload/text/page-candidate paths.

- [ ] **Step 2: Run automated verification**

Run the complete Task 4 suite plus `git diff --check`.

Expected: all tests pass and `git diff --check` has no output.

- [ ] **Step 3: Perform local browser acceptance**

Open `http://localhost:8765`, enter a rendered chapter, test one ordinary PDF page and one long-strip page, and verify that the saved cover matches the preview. If browser automation cannot access localhost, provide the exact short manual checklist to the user and record only user-confirmed results as passed.

- [ ] **Step 4: Update handoff**

Record implemented behavior, test commands/results, remaining limitations (no person recognition and one recommendation only), and the commit IDs created by this plan.

- [ ] **Step 5: Commit**

```bash
git add docs/ACCEPTANCE-CHECKLIST.md CURRENT-PROGRESS.md
git commit -m "记录推荐截图验收结果"
```
