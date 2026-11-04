import esbuild from "esbuild";
import fs from "fs";

const outDir = "public/dist";

// Ensure output directories exist
fs.mkdirSync(outDir, { recursive: true });

await esbuild.build({
    entryPoints: ["frontend/index.ts"],
    outdir: outDir,
    bundle: true,
});

// Perspective for the Explore view (frontend/extensions/explore-view/perspective.ts), loaded by the view on first use
// as an ES module: public/dist/perspective.js and perspective.css, its wasm files beside them under stable names,
// fetched from /public/dist (the Go server embeds public/dist and serves .wasm as application/wasm).
await esbuild.build({
    entryPoints: { perspective: "frontend/extensions/explore-view/perspective.ts" },
    outdir: outDir,
    bundle: true,
    format: "esm",
    minify: true,
    loader: { ".wasm": "file" },
    assetNames: "[name]",
    publicPath: "/public/dist",
});

// The SQL editor, CodeMirror 6 (frontend/extensions/sql-library/codemirror.ts), loaded on first use as an ES module
// (loadSqlEditors): public/dist/sql-editor.js; its styles are CodeMirror's own, injected by it.
await esbuild.build({
    entryPoints: { "sql-editor": "frontend/extensions/sql-library/codemirror.ts" },
    outdir: outDir,
    bundle: true,
    format: "esm",
    minify: true,
});

console.log("✅ Frontend built successfully!");
console.log(`   Main:        ${outDir}`);