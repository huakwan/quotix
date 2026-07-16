const esbuild = require("esbuild");
const { copyFileSync } = require("node:fs");
const watch = process.argv.includes("--watch");

const copyHtml = {
  name: "copy-html",
  setup(build) {
    const { mkdirSync } = require("node:fs");
    build.onEnd(() => {
      mkdirSync("dist", { recursive: true });
      copyFileSync("src/ui/popover.html", "dist/popover.html");
    });
  },
};

async function main() {
  const node = {
    bundle: true, format: "cjs", platform: "node", target: "node20",
    external: ["electron"], sourcemap: true, logLevel: "info",
  };
  const contexts = await Promise.all([
    esbuild.context({ ...node, entryPoints: ["src/main.ts"], outfile: "dist/main.js" }),
    esbuild.context({ ...node, entryPoints: ["src/ui/preload.ts"], outfile: "dist/preload.js" }),
    esbuild.context({
      entryPoints: ["src/ui/popoverRenderer.ts"], outfile: "dist/popoverRenderer.js",
      bundle: true, format: "iife", platform: "browser", target: "es2020",
      sourcemap: true, logLevel: "info", plugins: [copyHtml],
    }),
  ]);
  if (watch) {
    await Promise.all(contexts.map((c) => c.watch()));
  } else {
    await Promise.all(contexts.map((c) => c.rebuild()));
    await Promise.all(contexts.map((c) => c.dispose()));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
