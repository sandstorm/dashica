import {build as observableBuild} from "@observablehq/framework/dist/build.js"
import {readConfig as observableReadConfig} from "@observablehq/framework/dist/config.js"
import {resolveDashicaServer, symlinkDashicaFrontendSourceCode} from "./_utils.js";
import {cp, readdir, mkdir, rm} from "fs/promises";
import path from "path";
import {existsSync} from "fs";

export default async function dist({ flags, args, packageRoot }) {
    // Validate flags - throw error if unknown flags
    const knownFlags = ['build', 'bin'];
    const unknownFlags = Object.keys(flags).filter(flag => !knownFlags.includes(flag));
    if (unknownFlags.length > 0) {
        console.error(`ERROR: Unknown flags: ${unknownFlags.join(', ')}. Known flags: ${knownFlags.join(', ')}`);
        process.exit(1);
    }

    if (existsSync("dist")) {
        await rm("dist", {recursive: true, force: true});
    }

    console.log('Building dashica frontend...');
    await symlinkDashicaFrontendSourceCode();

    const output = flags.output || flags.o || 'dist';
    const verbose = flags.verbose || flags.v || false;

    if (verbose) {
        console.log(`Output directory: ${output}`);
        console.log(`Args:`, args);
    }

    const config = await observableReadConfig(undefined, undefined);
    config.output = 'dist/public';
    await observableBuild({ config: config });

    console.log('Copying dashica-server binary to dist/');
    const dashicaServerBin = await resolveDashicaServer(flags);
    cp(dashicaServerBin, 'dist/dashica-server');

    console.log('Copying dashica_config.yaml to dist/');
    cp('dashica_config.yaml', 'dist/dashica_config.yaml');

    console.log('Copying all *.sql files from src/ to dist/');
    await copySqlFiles('src', 'dist/src');

    console.log('✓ Build complete');
}

async function copySqlFiles(srcRoot, destRoot) {
    async function walk(dir) {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile() && entry.name.endsWith('.sql')) {
                const rel = path.relative(srcRoot, fullPath);
                const destPath = path.join(destRoot, rel);
                await mkdir(path.dirname(destPath), { recursive: true });
                await cp(fullPath, destPath);
            }
        }
    }

    try {
        await walk(srcRoot);
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            console.warn("Warning: 'src' directory not found; no SQL files copied.");
            return;
        }
        console.warn(`Warning: Error while copying SQL files: ${err.message}`);
    }
}