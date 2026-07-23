# Update Manifest Signing

Quotix remains an unsigned macOS application, but assisted-update metadata is
signed independently with Ed25519. The application contains only the public
key. GitHub Actions receives the private key through the
`UPDATE_SIGNING_PRIVATE_KEY` repository secret.

## Initial setup

Run these commands yourself on a trusted machine. Do not paste the private key
into chat, an issue, a commit, or a captured terminal session.

```sh
umask 077
openssl genpkey -algorithm ED25519 -out quotix-update-private.pem
openssl pkey -in quotix-update-private.pem -pubout -out quotix-update-public.pem
```

Then:

1. Copy the public key to `src/update/key/quotix-update-public.pem` and commit that
   public file.
2. In GitHub repository settings, create the Actions secret
   `UPDATE_SIGNING_PRIVATE_KEY` and paste the complete private PKCS#8 PEM.
3. Keep the private file in an encrypted secret store or offline backup.
4. Delete any unprotected local copy after confirming the secret and backup.

The release workflow refuses to publish while the committed file contains
`UNCONFIGURED`, when the secret is missing, or when the two keys do not match.

## Fingerprint

Record and compare the public-key SHA-256 fingerprint:

```sh
openssl pkey -pubin -in quotix-update-public.pem -outform DER |
  openssl dgst -sha256
```

The fingerprint is public. Add it below when provisioning the production key:

```text
Production Ed25519 SPKI SHA-256: c9ca70ae4614c45e2b0dd177ed6923967d68247bea49d3d93179071e2d228e56
```

## Rotation

Do not replace the only trusted public key and immediately sign with the new
private key. First ship a version that trusts both the old and new public keys,
using a manifest signed by the old key. After that version is broadly
available, sign future manifests with the new key and later remove the old key.

If the private key may be compromised, stop publishing updates, remove the
GitHub secret, announce manual installation from a reviewed release, and ship a
new trusted public key through that manual release.

## Release artifacts

Every stable GitHub Release must contain exactly:

- `Quotix-vVERSION-macos-arm64.zip`
- `Quotix-vVERSION-macos-x64.zip`
- `quotix-update.json`
- `quotix-update.json.sig`

The manifest generator verifies build-info version and architecture, archive
size and SHA-256, the private/public key match, and its own detached signature
before the workflow publishes the release.
