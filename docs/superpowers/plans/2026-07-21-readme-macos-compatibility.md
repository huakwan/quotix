# README macOS Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** State the supported macOS versions and CPU architectures clearly in the README.

**Architecture:** Make a documentation-only edit under the existing Requirements section. Keep the wording aligned with the source-controlled macOS 12.0 floor and Universal build configuration.

**Tech Stack:** Markdown, Node.js test runner

## Global Constraints

- Document macOS 12 Monterey or later as supported.
- Document Intel (`x86_64`) and Apple Silicon (`arm64`) support.
- State that macOS 11 Big Sur and older are unsupported.
- Do not change runtime or packaging configuration.

---

### Task 1: Document macOS Compatibility

**Files:**
- Modify: `README.md`
- Test: `tests/packageConfig.test.mjs`

**Interfaces:**
- Consumes: `build.mac.minimumSystemVersion` and the `--universal` packaging flag in `package.json`.
- Produces: A Requirements section that users can consult before installing Quotix.

- [ ] **Step 1: Update the Requirements section**

Replace the existing `- macOS` requirement with:

```markdown
- macOS 12 Monterey or later
  - Supports both Intel (`x86_64`) and Apple Silicon (`arm64`) Macs
  - macOS 11 Big Sur and older are not supported
```

- [ ] **Step 2: Verify the documented compatibility text**

Run:

```bash
rg -n "macOS 12 Monterey|Intel.*x86_64|Apple Silicon.*arm64|macOS 11 Big Sur" README.md
```

Expected: all three compatibility lines appear under **Requirements**.

- [ ] **Step 3: Verify the matching package contract**

Run:

```bash
node --test tests/packageConfig.test.mjs
```

Expected: all four package configuration tests pass, including the Universal architecture and macOS 12.0 floor checks.

- [ ] **Step 4: Commit the documentation**

```bash
git add README.md
git commit -m "docs: document macos compatibility"
```
