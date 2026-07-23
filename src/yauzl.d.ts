declare module "yauzl" {
  import type { Readable } from "node:stream";

  export interface Entry {
    fileName: string;
    externalFileAttributes: number;
  }

  export interface ZipFile {
    readEntry(): void;
    close(): void;
    on(event: "entry", listener: (entry: Entry) => void): this;
    on(event: "end" | "error", listener: (error?: Error) => void): this;
    openReadStream(
      entry: Entry,
      callback: (error: Error | null, stream?: Readable) => void,
    ): void;
  }

  interface Yauzl {
    open(
      path: string,
      options: { lazyEntries: boolean; decodeStrings: boolean },
      callback: (error: Error | null, zip?: ZipFile) => void,
    ): void;
  }

  const yauzl: Yauzl;
  export default yauzl;
}
