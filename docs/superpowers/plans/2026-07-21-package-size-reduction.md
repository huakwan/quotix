# Package Size Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the nested Electron runtime from the macOS package and trim files and locales that Quotix does not use.

**Architecture:** Keep esbuild output and the existing `dist/main.js` entry point unchanged, but move electron-builder products to `release`. Define explicit file-set boundaries for runtime code and assets, then guard those boundaries with a package configuration test and verify them against a real ASAR build.

**Tech Stack:** Node.js test runner, electron-builder 26, Electron 43, pnpm, `@electron/asar`

## Global Constraints

- Preserve `main: dist/main.js` and current runtime behavior.
- Keep packaged products outside the compiled `dist` directory.
- Exclude source maps and legacy `mac-*` output directories from ASAR.
- Package only `anthropic.svg` and `openai.svg` as runtime assets.
- Keep only English (`en`) and Thai (`th`) Electron locales.
- Do not replace Electron or add dependencies.

---

### Task 1: Lock and Correct the Package Boundary

**Files:**
- Create: `tests/packageConfig.test.mjs`
- Modify: `package.json:16-31`

**Interfaces:**
- Consumes: electron-builder configuration from the root `package.json`.
- Produces: an explicit `build.directories.output`, two `build.files` file sets, and `build.electronLanguages` enforced by a regression test.

- [ ] **Step 1: Write the failing package configuration test**

```js
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("electron-builder keeps packaged output outside compiled app files", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  assert.equal(pkg.build.directories.output, "release");
  assert.deepEqual(pkg.build.files, [
    {
      from: "dist",
      to: "dist",
      filter: ["**/*", "!**/*.map", "!mac-*/**"],
    },
    {
      from: "assets",
      to: "assets",
      filter: ["anthropic.svg", "openai.svg"],
    },
  ]);
  assert.deepEqual(pkg.build.electronLanguages, ["en", "th"]);
});
```

- [ ] **Step 2: Run the test and verify the current unsafe config fails**

Run: `node --test tests/packageConfig.test.mjs`

Expected: FAIL because `pkg.build.directories` is absent in the current configuration.

- [ ] **Step 3: Apply the minimal electron-builder configuration**

Replace the current `build.files` block and add `directories` and `electronLanguages`:

```json
"build": {
  "appId": "com.huakwan.quotix",
  "productName": "Quotix",
  "directories": {
    "output": "release"
  },
  "files": [
    {
      "from": "dist",
      "to": "dist",
      "filter": [
        "**/*",
        "!**/*.map",
        "!mac-*/**"
      ]
    },
    {
      "from": "assets",
      "to": "assets",
      "filter": [
        "anthropic.svg",
        "openai.svg"
      ]
    }
  ],
  "electronLanguages": [
    "en",
    "th"
  ],
  "mac": {
    "icon": "assets/icon.icns",
    "target": "dir",
    "category": "public.app-category.utilities",
    "extendInfo": {
      "LSUIElement": true
    }
  }
}
```

- [ ] **Step 4: Run the focused test and complete test suite**

Run: `node --test tests/packageConfig.test.mjs`

Expected: one passing test and zero failures.

Run: `pnpm test`

Expected: all repository tests pass with zero failures.

- [ ] **Step 5: Commit the package-boundary fix**

```bash
git add package.json tests/packageConfig.test.mjs
git commit -m "fix: exclude packaged app from electron bundle"
```

### Task 2: Verify the Real macOS Artifact

**Files:**
- Modify: none; this task verifies the generated `release` artifact.
- Test: `release/mac-arm64/Quotix.app/Contents/Resources/app.asar`

**Interfaces:**
- Consumes: the package boundary produced by Task 1 and the existing `dist:mac` script.
- Produces: measured app size and evidence that ASAR contains no nested app, source maps, or README poster.

- [ ] **Step 1: Run static verification**

Run: `pnpm run typecheck`

Expected: exit code 0 with no TypeScript errors.

- [ ] **Step 2: Build a fresh macOS directory artifact**

Run: `pnpm run dist:mac`

Expected: electron-builder exits with code 0 and writes `release/mac-arm64/Quotix.app`.

- [ ] **Step 3: Inspect ASAR package boundaries**

Run:

```bash
node -e 'const asar=require("@electron/asar");const p="release/mac-arm64/Quotix.app/Contents/Resources/app.asar";const files=asar.listPackage(p);const bad=files.filter(f=>/\.app(?:\/|$)|mac-(?:arm64|x64)|\.map$|poster\.png$/.test(f));if(bad.length){console.error(bad.join("\n"));process.exit(1)}console.log(`ASAR entries: ${files.length}; forbidden entries: 0`)'
```

Expected: `forbidden entries: 0` and exit code 0.

- [ ] **Step 4: Measure the output and retained locales**

Run: `du -sh release/mac-arm64/Quotix.app release/mac-arm64/Quotix.app/Contents/Resources/app.asar`

Expected: the application is materially smaller than 573 MB and ASAR is no longer hundreds of megabytes.

Run: `find 'release/mac-arm64/Quotix.app/Contents/Frameworks/Electron Framework.framework/Versions/A/Resources' -maxdepth 1 -type d -name '*.lproj' -print | sort`

Expected: only English and Thai locale directories retained by electron-builder, allowing Electron's platform-specific naming variants.

- [ ] **Step 5: Review final changes and evidence**

Run: `git diff HEAD^ --check && git status --short`

Expected: no whitespace errors; only generated ignored artifacts may be untracked or modified outside the committed source changes.
