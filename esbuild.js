const esbuild = require("esbuild");
const watch = process.argv.includes("--watch");

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/main.ts"],
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "node20",
    outfile: "dist/main.js",
    external: ["electron"],
    sourcemap: true,
    logLevel: "info",
  });
  if (watch) { await ctx.watch(); } else { await ctx.rebuild(); await ctx.dispose(); }
}
main().catch((e) => { console.error(e); process.exit(1); });
