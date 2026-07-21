import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = join(root, ".github", "workflows", "release-macos.yml");

test("manual releases derive their tag and app archives from package.json", () => {
  assert.ok(existsSync(workflowPath), "release workflow should exist");

  const workflow = readFileSync(workflowPath, "utf8");

  assert.match(workflow, /on:\s*\n\s+workflow_dispatch:/);
  assert.doesNotMatch(workflow, /types: \[published\]/);
  assert.match(workflow, /^permissions:\s*\n\s+contents: read$/m);
  assert.match(workflow, /prepare-release:\s*\n\s+outputs:\s*\n\s+release_tag:/);
  assert.match(workflow, /require\(['"]\.\/package\.json['"]\)\.version/);
  assert.match(workflow, /CURRENT_REF: \$\{\{ github\.ref \}\}/);
  assert.match(workflow, /refs\/heads\/\$\{DEFAULT_BRANCH\}/);
  assert.match(workflow, /\(0\|\[1-9\]\\d\*\)/);
  assert.match(workflow, /release_tag="v\$\{version\}"/);
  assert.match(workflow, /gh api --include .*git\/ref\/tags/);
  assert.match(workflow, /HTTP\/\[\^ \]\+ 404/);
  assert.match(workflow, /existing_release_id=.*releases\?per_page=100/);
  assert.match(
    workflow,
    /arch: x64\s*\n\s+binary_arch: x86_64\s*\n\s+runner: macos-15-intel\s*\n\s+target: dist-mac-x64/,
  );
  assert.match(
    workflow,
    /arch: arm64\s*\n\s+binary_arch: arm64\s*\n\s+runner: macos-15\s*\n\s+target: dist-mac-arm64/,
  );
  const buildJob = workflow.slice(workflow.indexOf("  build-and-package:"));

  assert.ok(
    buildJob.indexOf("uses: pnpm/action-setup@v4") <
      buildJob.indexOf("uses: actions/setup-node@v6"),
    "pnpm should be installed before setup-node configures its cache",
  );
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /lipo -archs/);
  assert.match(workflow, /uses: actions\/upload-artifact@v4/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /build-and-package:[\s\S]*?needs: prepare-release/);
  assert.match(workflow, /upload-to-release:\s*\n\s+needs: \[prepare-release, build-and-package\]/);
  assert.match(workflow, /upload-to-release:[\s\S]*?permissions:\s*\n\s+contents: write/);
  assert.match(workflow, /uses: actions\/download-artifact@v4/);
  assert.doesNotMatch(workflow, /gh release create/);
  assert.match(workflow, /release_id=.*gh api .*--method POST .*\/releases/);
  assert.match(workflow, /-F draft=true/);
  assert.match(workflow, /-F generate_release_notes=true/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.match(workflow, /RELEASE_TAG: \$\{\{ needs\.prepare-release\.outputs\.release_tag \}\}/);
  assert.match(workflow, /TARGET_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /gh api .*--method POST .*git\/refs/);
  assert.match(workflow, /ref="refs\/tags\/\$\{RELEASE_TAG\}"/);
  assert.match(workflow, /sha="\$TARGET_SHA"/);
  assert.match(workflow, /test "\$\{#assets\[@\]\}" -eq 2/);
  assert.doesNotMatch(workflow, /--target "\$TARGET_SHA"/);
  assert.match(workflow, /--method PATCH .*releases\/\$\{release_id\}/);
  assert.match(workflow, /-F draft=false/);
  assert.doesNotMatch(workflow, /draft_id=/);
  assert.match(workflow, /gh api .*--method DELETE .*releases\/\$\{release_id\}/);
  assert.match(workflow, /remaining_release_id=.*releases\?per_page=100/);
  assert.match(workflow, /current_sha.*TARGET_SHA/);
  assert.match(workflow, /-z "\$remaining_release_id"/);
  assert.match(workflow, /gh api --method DELETE .*git\/refs\/tags/);
  assert.match(workflow, /Quotix-.*macos-.*\.zip/);
});
