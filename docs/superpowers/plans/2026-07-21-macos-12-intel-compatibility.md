# macOS 12 Intel Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce one validly signed Universal Quotix application that supports Intel and Apple Silicon Macs running macOS 12.0 or newer.

**Architecture:** Keep Electron 43 and the existing application bundle contents. Make electron-builder request the Universal architecture explicitly, declare macOS 12.0 as the minimum system version, and ad-hoc sign the app and helpers with the two Electron runtime entitlements required by hardened runtime.

**Tech Stack:** Electron 43, electron-builder 26, Node.js test runner, macOS `lipo`, `plutil`, and `codesign` tools

## Global Constraints

- Produce one application bundle containing both `x86_64` and `arm64` executable slices.
- Preserve `12.0` as the minimum supported macOS version.
- Use ad-hoc signing for local/internal builds without a Developer ID certificate.
- Do not downgrade Electron or change application runtime behavior.
- Public distribution signing and Apple notarization remain outside this change.

---

## File Structure

- `package.json` — requests a Universal macOS build and configures the minimum system version and signing inputs.
- `build/entitlements.mac.plist` — grants Electron JIT execution and permits its pre-signed frameworks under an ad-hoc outer signature.
- `tests/packageConfig.test.mjs` — guards the source-controlled packaging and entitlement contract.

### Task 1: Universal macOS 12 Packaging

**Files:**
- Create: `build/entitlements.mac.plist`
- Modify: `package.json`
- Modify: `tests/packageConfig.test.mjs`
- Test: `tests/packageConfig.test.mjs`

**Interfaces:**
- Consumes: electron-builder's `--universal` CLI flag and `MacConfiguration` fields.
- Produces: `pnpm run dist:mac`, which creates `release/mac-universal/Quotix.app` with x64 and arm64 slices and an ad-hoc signature.

- [ ] **Step 1: Write the failing package compatibility tests**

Append these tests to `tests/packageConfig.test.mjs`; its existing imports
already provide every helper they use:

```js
test("macOS build targets Intel and Apple Silicon from one command", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

  assert.match(pkg.scripts["dist:mac"], /electron-builder --mac --universal --dir$/);
  assert.equal(pkg.build.mac.minimumSystemVersion, "12.0");
});

test("macOS local build uses Electron-compatible ad-hoc signing", () => {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const entitlementPath = join(root, "build", "entitlements.mac.plist");
  const entitlements = readFileSync(entitlementPath, "utf8");

  assert.equal(pkg.build.mac.identity, "-");
  assert.equal(pkg.build.mac.entitlements, "build/entitlements.mac.plist");
  assert.equal(pkg.build.mac.entitlementsInherit, "build/entitlements.mac.plist");
  assert.match(entitlements, /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\/>/);
  assert.match(
    entitlements,
    /<key>com\.apple\.security\.cs\.disable-library-validation<\/key>\s*<true\/>/,
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm run compile
node --test tests/packageConfig.test.mjs
```

Expected: the first new test fails because `dist:mac` does not contain `--universal`; the signing test also fails because `build/entitlements.mac.plist` does not exist.

- [ ] **Step 3: Add the minimal Universal and signing configuration**

Change `package.json` as follows:

```json
"dist:mac": "npm run compile && electron-builder --mac --universal --dir"
```

Add these fields inside `build.mac` while preserving its existing icon, target, category, and `extendInfo` fields:

```json
"minimumSystemVersion": "12.0",
"identity": "-",
"entitlements": "build/entitlements.mac.plist",
"entitlementsInherit": "build/entitlements.mac.plist"
```

Create `build/entitlements.mac.plist` with this exact content:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
</dict>
</plist>
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/packageConfig.test.mjs
```

Expected: all package configuration tests pass.

- [ ] **Step 5: Run the complete static and automated verification**

Run:

```bash
pnpm run typecheck
pnpm test
```

Expected: TypeScript reports no errors and the complete Node.js test suite passes.

- [ ] **Step 6: Build the Universal application**

Run:

```bash
pnpm run dist:mac
```

Expected: electron-builder downloads or reuses both Electron architectures, merges them into `release/mac-universal/Quotix.app`, and reports ad-hoc code signing rather than skipping signing.

- [ ] **Step 7: Verify the actual artifact**

Run:

```bash
lipo -archs "release/mac-universal/Quotix.app/Contents/MacOS/Quotix"
plutil -extract LSMinimumSystemVersion raw "release/mac-universal/Quotix.app/Contents/Info.plist"
codesign --verify --deep --strict --verbose=4 "release/mac-universal/Quotix.app"
open "release/mac-universal/Quotix.app"
```

Expected:

- `lipo` prints both `x86_64` and `arm64`.
- `plutil` prints `12.0`.
- `codesign` reports the bundle is valid on disk and satisfies its designated requirement.
- Quotix launches and appears in the menu bar on the build host.

- [ ] **Step 8: Commit the tested fix**

```bash
git add package.json build/entitlements.mac.plist tests/packageConfig.test.mjs
git commit -m "fix: support macos 12 intel builds"
```
