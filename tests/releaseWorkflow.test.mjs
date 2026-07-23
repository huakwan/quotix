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
  const buildJobStart = workflow.indexOf("  build-and-package:");
  const uploadJobStart = workflow.indexOf("  upload-to-release:");

  assert.notEqual(buildJobStart, -1, "workflow should contain a build job");
  assert.notEqual(uploadJobStart, -1, "workflow should contain an upload job");
  assert.ok(buildJobStart < uploadJobStart, "build job should precede upload job");

  const buildJob = workflow.slice(buildJobStart, uploadJobStart);
  const pnpmSetupIndex = buildJob.indexOf("uses: pnpm/action-setup@v5");
  const nodeSetupIndex = buildJob.indexOf("uses: actions/setup-node@v6");

  assert.notEqual(
    pnpmSetupIndex,
    -1,
    "build job should use pnpm/action-setup@v5",
  );
  assert.notEqual(
    nodeSetupIndex,
    -1,
    "build job should use actions/setup-node@v6",
  );
  assert.ok(
    pnpmSetupIndex < nodeSetupIndex,
    "pnpm should be installed before setup-node configures its cache",
  );
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /lipo -archs/);
  assert.match(workflow, /PlistBuddy -c 'Print :CFBundleShortVersionString'/);
  assert.match(workflow, /build-info-\$\{arch\}\.json/);
  assert.match(workflow, /uses: actions\/upload-artifact@v6/);
  assert.match(workflow, /retention-days: 1/);
  assert.match(workflow, /build-and-package:[\s\S]*?needs: prepare-release/);
  assert.match(workflow, /upload-to-release:\s*\n\s+needs: \[prepare-release, build-and-package\]/);
  assert.match(workflow, /upload-to-release:[\s\S]*?permissions:\s*\n\s+contents: write/);
  assert.match(workflow, /uses: actions\/download-artifact@v7/);
  assert.match(workflow, /Create and verify signed update manifest/);
  assert.match(workflow, /UPDATE_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.UPDATE_SIGNING_PRIVATE_KEY \}\}/);
  assert.match(workflow, /node scripts\/create-update-manifest\.mjs/);
  assert.match(workflow, /--public-key src\/update\/quotix-update-public\.pem/);
  assert.match(workflow, /release-assets\/quotix-update\.json/);
  assert.match(workflow, /release-assets\/quotix-update\.json\.sig/);
  assert.doesNotMatch(workflow, /(?:pnpm\/action-setup|actions\/(?:upload|download)-artifact)@v4/);
  assert.doesNotMatch(workflow, /gh release create/);
  assert.match(workflow, /release_id=.*gh api .*--method POST .*\/releases/);
  assert.match(workflow, /-F draft=true/);
  const releaseBodyMatch = workflow.match(
    /cat > release-body\.md <<'RELEASE_BODY'\n([\s\S]*?)\n\s*RELEASE_BODY(?:\n|$)/,
  );
  assert.ok(
    releaseBodyMatch,
    "release-body.md heredoc should be present and terminated",
  );
  const releaseBody = releaseBodyMatch[1];
  const englishMarker = "**English**";
  const thaiMarker = "**ภาษาไทย**";
  const englishIndex = releaseBody.indexOf(englishMarker);
  const thaiIndex = releaseBody.indexOf(thaiMarker);

  assert.match(releaseBody, /macOS blocks the app\? \/ macOS ไม่ยอมเปิดแอป\?/);
  assert.notEqual(
    englishIndex,
    -1,
    "release body should contain an English section",
  );
  assert.notEqual(thaiIndex, -1, "release body should contain a Thai section");
  assert.ok(
    englishIndex < thaiIndex,
    "English section should occur before Thai section",
  );

  const englishSection = releaseBody.slice(
    englishIndex + englishMarker.length,
    thaiIndex,
  );
  const thaiSection = releaseBody.slice(thaiIndex + thaiMarker.length);
  const quarantineCommand =
    "xattr -dr com.apple.quarantine /Applications/Quotix.app";
  const openCommand = "open /Applications/Quotix.app";

  for (const [language, section] of [
    ["English", englishSection],
    ["Thai", thaiSection],
  ]) {
    assert.ok(
      section.includes(quarantineCommand),
      `${language} section should include xattr command`,
    );
    assert.ok(
      section.includes(openCommand),
      `${language} section should include open command`,
    );
  }
  assert.ok(
    englishSection.includes(
      "Only run these commands for an app downloaded from this official release.",
    ),
    "English section should restrict commands to apps from the official release",
  );
  assert.ok(
    thaiSection.includes(
      "โปรดรันเฉพาะกับแอปที่ดาวน์โหลดจาก Release อย่างเป็นทางการนี้เท่านั้น",
    ),
    "Thai section should restrict commands to apps from the official release",
  );

  const releaseCreationMatch = workflow.match(
    /(release_id="\$\(gh api --method POST "repos\/\$\{GH_REPO\}\/releases" \\\n[\s\S]*?\n\s+--jq '\.id'\)")/,
  );
  assert.ok(
    releaseCreationMatch,
    "release_id assignment should contain the releases POST through its jq result",
  );
  const releaseCreationAssignment = releaseCreationMatch[1];
  assert.match(
    releaseCreationAssignment,
    /-F body=@release-body\.md/,
    "release_id assignment should use release-body.md",
  );
  assert.match(
    releaseCreationAssignment,
    /-F generate_release_notes=true/,
    "release_id assignment should retain generated release notes",
  );
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /GH_REPO: \$\{\{ github\.repository \}\}/);
  assert.match(workflow, /RELEASE_TAG: \$\{\{ needs\.prepare-release\.outputs\.release_tag \}\}/);
  assert.match(workflow, /TARGET_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /gh api .*--method POST .*git\/refs/);
  assert.match(workflow, /ref="refs\/tags\/\$\{RELEASE_TAG\}"/);
  assert.match(workflow, /sha="\$TARGET_SHA"/);
  assert.match(workflow, /test "\$\{#assets\[@\]\}" -eq 4/);
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
  assert.match(workflow, /ditto -c -k --keepParent/);
  assert.doesNotMatch(workflow, /--sequesterRsrc/);
});
