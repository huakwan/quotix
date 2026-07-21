# Bilingual Release Troubleshooting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepend safe English and Thai macOS quarantine troubleshooting instructions to every automatically generated GitHub Release.

**Architecture:** The existing `upload-to-release` shell step writes the approved Markdown into an ephemeral `release-body.md`, then supplies that file as the `body` field of the existing draft-release API call. `generate_release_notes=true` remains enabled, so GitHub appends its generated changelog after the custom body.

**Tech Stack:** GitHub Actions YAML, Bash, GitHub CLI REST API, Node.js built-in test runner

## Global Constraints

- Preserve automatic version and tag derivation from `package.json`.
- Preserve both `x64` and `arm64` artifact names and release uploads.
- Preserve `generate_release_notes=true` and the existing draft/publish/cleanup flow.
- Present English first and Thai second.
- Describe quarantine removal as troubleshooting only for apps downloaded from the official release.
- Preserve the existing uncommitted Node.js 24 action-version upgrades in the workflow and regression test.

---

### Task 1: Add bilingual troubleshooting to generated releases

**Files:**
- Modify: `.github/workflows/release-macos.yml:143-180`
- Test: `tests/releaseWorkflow.test.mjs:53-59`

**Interfaces:**
- Consumes: the existing `Create release with app archives` Bash step and its `gh api --method POST "repos/${GH_REPO}/releases"` call.
- Produces: an ephemeral `release-body.md` passed as the release API's `body`; no new repository runtime files or outputs.

- [ ] **Step 1: Write the failing regression assertions**

Add these assertions immediately after the existing `generate_release_notes` assertion in `tests/releaseWorkflow.test.mjs`:

```js
  assert.match(workflow, /macOS blocks the app\? \/ macOS ไม่ยอมเปิดแอป\?/);
  assert.match(workflow, /\*\*English\*\*/);
  assert.match(workflow, /\*\*ภาษาไทย\*\*/);
  assert.equal(
    workflow.match(/xattr -dr com\.apple\.quarantine \/Applications\/Quotix\.app/g)?.length,
    2,
  );
  assert.equal(workflow.match(/open \/Applications\/Quotix\.app/g)?.length, 2);
  assert.match(workflow, /-F body=@release-body\.md/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test tests/releaseWorkflow.test.mjs
```

Expected: FAIL because the workflow does not yet contain `macOS blocks the app? / macOS ไม่ยอมเปิดแอป?`.

- [ ] **Step 3: Write the approved release body and pass it to GitHub**

In `.github/workflows/release-macos.yml`, insert this block after `test -z "$existing_release_id"` and before tag creation:

````yaml
          cat > release-body.md <<'RELEASE_BODY'
          ### macOS blocks the app? / macOS ไม่ยอมเปิดแอป?

          **English**

          If you downloaded Quotix from this official GitHub release and macOS prevents it from opening, move the app to `/Applications`, then run:

          ```sh
          xattr -dr com.apple.quarantine /Applications/Quotix.app
          open /Applications/Quotix.app
          ```

          This removes macOS quarantine metadata from this copy of Quotix. Only run these commands for an app downloaded from this official release.

          **ภาษาไทย**

          หากดาวน์โหลด Quotix จาก GitHub Release อย่างเป็นทางการนี้แล้ว macOS ไม่ยอมเปิดแอป ให้ย้ายแอปไปที่ `/Applications` แล้วรัน:

          ```sh
          xattr -dr com.apple.quarantine /Applications/Quotix.app
          open /Applications/Quotix.app
          ```

          คำสั่งนี้จะลบข้อมูล quarantine ของ macOS ออกจาก Quotix ชุดนี้ โปรดรันเฉพาะกับแอปที่ดาวน์โหลดจาก Release อย่างเป็นทางการนี้เท่านั้น
          RELEASE_BODY
````

Add the body field to the existing release creation request while retaining the generated-notes field:

```bash
              -F draft=true \
              -F body=@release-body.md \
              -F generate_release_notes=true \
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
node --test tests/releaseWorkflow.test.mjs
```

Expected: 1 test passes and 0 tests fail.

- [ ] **Step 5: Verify the complete repository**

Run each command independently:

```bash
CI=true pnpm test
CI=true pnpm run typecheck
ruby -ryaml -e 'YAML.parse_file(ARGV.fetch(0))' .github/workflows/release-macos.yml
git diff --check
```

Expected: 73 tests pass, typecheck exits 0, YAML parsing exits 0, and the diff check exits 0.

- [ ] **Step 6: Review and commit the workflow change**

Inspect the complete diff first because both target files already contain the approved Node.js 24 action-version upgrades:

```bash
git diff -- .github/workflows/release-macos.yml tests/releaseWorkflow.test.mjs
```

After confirming the diff contains only the action upgrades and bilingual release instructions/tests, commit both related workflow-maintenance changes together:

```bash
git add .github/workflows/release-macos.yml tests/releaseWorkflow.test.mjs docs/superpowers/plans/2026-07-21-bilingual-release-troubleshooting.md
git commit -m "ci: improve macOS release workflow"
```
