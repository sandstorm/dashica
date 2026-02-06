import esbuild from "esbuild";
import tailwindPlugin from "esbuild-plugin-tailwindcss";
import fs from "fs";
import path from "path";

const outDir = "dashica-src/public/dist";
const devServerOutDir = "docs/dev-server/dashica-src/public/dist";

// Ensure output directories exist
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(devServerOutDir, { recursive: true });

await esbuild.build({
    entryPoints: ["frontend/index.js"],
    outdir: outDir,
    bundle: true,
    plugins: [tailwindPlugin()],
});

// Copy to dev-server location
fs.cpSync(outDir, devServerOutDir, { recursive: true });

console.log("✅ Frontend built successfully!");
console.log(`   Main: ${outDir}`);
console.log(`   Dev:  ${devServerOutDir}`);