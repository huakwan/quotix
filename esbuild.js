const esbuild = require("esbuild");
const { copyFileSync } = require("node:fs");
const pkg = require("./package.json");
const watch = process.argv.includes("--watch");

const copyHtml = {
  name: "copy-html",
  setup(build) {
    const { mkdirSync } = require("node:fs");
    build.onEnd(() => {
      mkdirSync("dist", { recursive: true });
      copyFileSync("src/ui/popover/popover.html", "dist/popover.html");
      copyFileSync("src/ui/about/about.html", "dist/about.html");
    });
  },
};

async function main() {
  const node = {
    bundle: true, format: "cjs", platform: "node", target: "node20",
    external: ["electron"], sourcemap: true, logLevel: "info",
    loader: { ".svg": "base64", ".html": "text", ".pem": "text" },
  };
  const contexts = await Promise.all([
    esbuild.context({ ...node, entryPoints: ["src/main.ts"], outfile: "dist/main.js" }),
    esbuild.context({
      ...node,
      entryPoints: ["src/update/installerHelper.ts"],
      outfile: "dist/installerHelper.js",
    }),
    esbuild.context({ ...node, entryPoints: ["src/ui/popover/preload.ts"], outfile: "dist/preload.js" }),
    esbuild.context({
      ...node,
      entryPoints: ["src/ui/about/aboutPreload.ts"],
      outfile: "dist/aboutPreload.js",
    }),
    esbuild.context({
      entryPoints: ["src/ui/popover/popoverRenderer.ts"], outfile: "dist/popoverRenderer.js",
      bundle: true, format: "iife", platform: "browser", target: "es2020",
      define: { __APP_VERSION__: JSON.stringify(pkg.version) },
      sourcemap: true, logLevel: "info", plugins: [copyHtml],
    }),
    esbuild.context({
      entryPoints: ["src/ui/about/aboutRenderer.ts"], outfile: "dist/aboutRenderer.js",
      bundle: true, format: "iife", platform: "browser", target: "es2020",
      define: { __APP_VERSION__: JSON.stringify(pkg.version) },
      sourcemap: true, logLevel: "info",
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
