import esbuild from "esbuild";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const outDir = "public/dist";
const speedscopeSrcDir = path.resolve("../app/speedscope");
const speedscopeOutDir = path.resolve("speedscope_viewer/dist");

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

// Build the embedded Speedscope viewer (served per-widget by SpeedscopeLink).
// The build output is consumed by speedscope_viewer/embed.go via //go:embed.
if (!fs.existsSync(path.join(speedscopeSrcDir, "node_modules"))) {
    console.log("📦 Installing speedscope dependencies...");
    execSync("npm install --prefer-offline --no-audit", {
        cwd: speedscopeSrcDir,
        stdio: "inherit",
    });
}

// Wipe previous output so stale hashed chunks don't get embedded alongside the new ones.
fs.rmSync(speedscopeOutDir, { recursive: true, force: true });
fs.mkdirSync(speedscopeOutDir, { recursive: true });
// Re-create the .gitkeep so the directory is never empty (//go:embed needs ≥1 file).
fs.writeFileSync(path.join(speedscopeOutDir, ".gitkeep"), "");

console.log("🔥 Building speedscope viewer...");
execSync(
    `node_modules/.bin/tsx scripts/build-release.ts --outdir "${speedscopeOutDir}" --protocol http`,
    { cwd: speedscopeSrcDir, stdio: "inherit" }
);

console.log("✅ Frontend built successfully!");
console.log(`   Main:        ${outDir}`);
console.log(`   Speedscope:  ${speedscopeOutDir}`);