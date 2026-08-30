// Minimal asar writer: [Pickle: uint32 headerLength][Pickle: uint32 jsonLength +
// json + padding][file bytes]. Electron reports a valid archive as a directory,
// which is what makes a recursive remove walk into it instead of unlinking it.
export function packAsar(files) {
  let offset = 0;
  const entries = {};
  const blobs = [];
  for (const [name, contents] of Object.entries(files)) {
    const blob = Buffer.from(contents, "utf8");
    entries[name] = { size: blob.length, offset: String(offset) };
    offset += blob.length;
    blobs.push(blob);
  }
  const json = Buffer.from(JSON.stringify({ files: entries }), "utf8");
  const padding = (4 - (json.length % 4)) % 4;
  const headerPayload = 4 + json.length + padding;
  const head = Buffer.alloc(16 + json.length + padding);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(4 + headerPayload, 4);
  head.writeUInt32LE(headerPayload, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  return Buffer.concat([head, ...blobs]);
}
