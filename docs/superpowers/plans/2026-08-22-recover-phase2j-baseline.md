# Phase 2J Baseline Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the current Phase 2J build so the page initializes and the PDF import-to-reading loop works without reverting to the older `.2E.bak` files.

**Architecture:** Keep the existing single-page HTML/CSS/JavaScript application and IndexedDB model. Repair the HTML/JavaScript contract first, then make event binding tolerant of optional elements, and finally verify the browser flow manually.

**Tech Stack:** Static HTML/CSS, vanilla JavaScript, Node.js HTTP server, PDF.js 3.11.174, IndexedDB.

**Spec:** `docs/superpowers/specs/2026-08-22-recover-phase2j-baseline-design.md`

## Global Constraints

- Preserve the current Phase 2J UI and behavior; do not restore `.2E.bak` wholesale.
- Do not change IndexedDB stores, schema, or migration behavior.
- Do not add public deployment, desktop packaging, synchronization, or unrelated refactors.
- Keep the existing zero-build, zero-third-party-dependency application structure.

---

### Task 1: Restore the HTML elements required by the current JavaScript

**Files:**
- Modify: `index.html` near the reader toolbar and hidden file inputs
- Test: browser DOM inspection and page startup

**Interfaces:**
- Consumes: existing selectors in `app.js` for `btn-set-cover`, `hidden-cover-input`, and `rack-pager`.
- Produces: DOM nodes with those exact IDs, preserving existing CSS classes and event semantics.

- [ ] **Step 1: Add the missing cover action button**

  Add `<button id="btn-set-cover">🖼️ 设封面</button>` beside the existing reader toolbar actions, so the existing `btn-set-cover` event binding has a concrete target.

- [ ] **Step 2: Add the hidden cover file input**

  Add `<input type="file" id="hidden-cover-input" accept="image/*" style="display:none">` near `hidden-file-input`. `pickImageCover()` clones this node before opening the chooser.

- [ ] **Step 3: Add the bookshelf pager container**

  Add `<div id="rack-pager" style="display:none"></div>` immediately after the `bs-grid` rack. `renderBookshelf()` fills this container only when more than one page exists.

- [ ] **Step 4: Run syntax and static checks**

  Run:

  ```powershell
  node --check F:\manhwa-reader\app.js
  node --check F:\manhwa-reader\db.js
  node --check F:\manhwa-reader\server.js
  ```

  Expected: all commands exit successfully.

- [ ] **Step 5: Commit the HTML contract repair**

  ```powershell
  git -c safe.directory=F:/manhwa-reader -C F:\manhwa-reader add index.html
  git -c safe.directory=F:/manhwa-reader -C F:\manhwa-reader commit -m "修复 Phase 2J 缺失 HTML 接线"
  ```

### Task 2: Make startup event binding resilient to optional UI nodes

**Files:**
- Modify: `app.js` in the `Event Bindings` section around lines 405-430
- Test: page startup and console logs in the local browser

**Interfaces:**
- Consumes: the existing `$()` helper and event handler functions.
- Produces: the same event behavior when nodes exist, without aborting initialization when an optional node is absent.

- [ ] **Step 1: Guard the cover-button binding**

  Replace the unconditional binding with a null-safe binding:

  ```js
  const setCoverBtn = $('btn-set-cover');
  if (setCoverBtn) setCoverBtn.addEventListener('click', function () {
    if (!currentSeries) return;
    showModal('set-cover', {sid: currentSeries});
  });
  ```

- [ ] **Step 2: Keep required controls explicit**

  Do not hide failures for required controls such as `viewer-area`, `page-slider`, `bs-add-files`, or `hidden-file-input`; verify those IDs exist in `index.html` and leave their normal bindings unchanged.

- [ ] **Step 3: Run syntax and served-source checks**

  Run:

  ```powershell
  node --check F:\manhwa-reader\app.js
  (Invoke-WebRequest -Uri http://localhost:8765/app.js -UseBasicParsing).StatusCode
  ```

  Expected: syntax passes and the server returns HTTP 200.

- [ ] **Step 4: Commit the binding hardening**

  ```powershell
  git -c safe.directory=F:/manhwa-reader -C F:\manhwa-reader add app.js
  git -c safe.directory=F:/manhwa-reader -C F:\manhwa-reader commit -m "避免可选控件阻断应用启动"
  ```

### Task 3: Verify the restored local reading baseline

**Files:**
- Modify: none
- Test: local browser at `http://localhost:8765/`

**Interfaces:**
- Consumes: repaired HTML/JavaScript contract and existing IndexedDB/PDF.js flow.
- Produces: evidence that startup, import, reading, and persistence work together.

- [ ] **Step 1: Restart the local server**

  Run from `F:\manhwa-reader`:

  ```powershell
  node server.js
  ```

  Confirm `http://localhost:8765/` responds with HTTP 200.

- [ ] **Step 2: Verify startup**

  Reload the page and confirm the bookshelf renders, the header buttons are clickable, and there is no startup-level JavaScript exception.

- [ ] **Step 3: Verify import**

  Click `选择文件`, choose one local PDF, select `创建新系列`, enter a name, and confirm a new series appears and the reader opens.

- [ ] **Step 4: Verify reading and progress**

  Confirm at least one PDF page renders, navigate to another page, return to the bookshelf, reopen the series, and confirm the last chapter/page is restored.

- [ ] **Step 5: Verify persistence after reload**

  Reload the browser page and confirm the imported series remains visible. Record any browser-only issue in `CURRENT-PROGRESS.md` instead of making unrelated changes.

- [ ] **Step 6: Commit only after the manual baseline passes**

  ```powershell
  git -c safe.directory=F:/manhwa-reader -C F:\manhwa-reader status --short
  git -c safe.directory=F:/manhwa-reader -C F:\manhwa-reader log --oneline -3
  ```

  Expected: no uncommitted source changes and the two repair commits are visible.
