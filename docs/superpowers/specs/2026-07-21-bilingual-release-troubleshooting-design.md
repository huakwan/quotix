# Bilingual macOS Release Troubleshooting Design

## Goal

Add English and Thai troubleshooting instructions to every automatically created GitHub Release without removing GitHub's generated release notes.

## Release content

The custom content appears before the generated changelog and contains this Markdown:

````markdown
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
````

## Workflow design

The `upload-to-release` job writes the Markdown to a temporary file immediately before creating the draft release. The existing release creation request sends that file as the release `body` while retaining `generate_release_notes=true`. GitHub prepends the supplied body to its generated notes.

Artifact naming, package version derivation, tag creation, draft publishing, cleanup, and generated changelog behavior remain unchanged.

## Error handling

The release body is created locally within the job and requires no additional network request. If release creation fails, the existing cleanup path remains responsible for removing the release and its matching tag.

## Verification

The workflow regression test will verify that:

- both English and Thai instructions are present;
- both shell commands are present;
- the release request supplies the custom body;
- `generate_release_notes=true` remains enabled;
- the existing artifact and release invariants continue to pass.
