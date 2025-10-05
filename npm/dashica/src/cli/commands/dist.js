import {build as observableBuild} from "@observablehq/framework/dist/build.js"
import {readConfig as observableReadConfig} from "@observablehq/framework/dist/config.js"
import {copyFiles, resolveDashicaServerAndCompileIfNeeded, symlinkDashicaFrontendSourceCode} from "./_utils.js";
import {cp, rm} from "fs/promises";
import {join} from "path";
import {existsSync} from "fs";

export default async function dist({ flags, args, packageRoot }) {
    // Validate flags - throw error if unknown flags
    const knownFlags = ['build', 'bin', 'embed', 'skip-server-build'];
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

    config.root = 'src';

    if (existsSync("src/style.css")) {
        config.style = { path: "style.css" } ;
    } else {
        // Fallback to default dashica styles
        config.style = { path: "dashica/style.css" } ;
    }

    await observableBuild({ config: config });

    console.log('Copying all *.sql files from src/ to dist/');
    await copyFiles('src', 'dist/src', (entry) => entry.name.endsWith('.sql'));

    if (!flags['skip-server-build']) {
        console.log('Copying dashica_config.yaml to dist/');
        await cp('dashica_config.yaml', 'dist/dashica_config.yaml');

        console.log('Copying dashica-server binary to dist/');
        const dashicaServerBin = await resolveDashicaServerAndCompileIfNeeded(flags);
        await cp(dashicaServerBin, 'dist/dashica-server');
    }

    if (flags['embed']) {
        await rm("dist/public", {recursive: true, force: true});
        await rm("dist/src", {recursive: true, force: true});
    }

    console.log('✓ Build complete');
}
