import {build as observableBuild} from "@observablehq/framework/dist/build.js"
import {readConfig as observableReadConfig} from "@observablehq/framework/dist/config.js"
import {resolveDashicaServer, symlinkDashicaFrontendSourceCode} from "./_utils.js";
import {cp} from "fs/promises";

export default async function dist({ flags, args, packageRoot }) {
    // Validate flags - throw error if unknown flags
    const knownFlags = ['build', 'bin'];
    const unknownFlags = Object.keys(flags).filter(flag => !knownFlags.includes(flag));
    if (unknownFlags.length > 0) {
        console.error(`ERROR: Unknown flags: ${unknownFlags.join(', ')}. Known flags: ${knownFlags.join(', ')}`);
        process.exit(1);
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
    config.output = 'dist/web';
    await observableBuild({ config: config });

    console.log('Copying dashica-server binary to dist/');
    const dashicaServerBin = await resolveDashicaServer(flags);
    cp(dashicaServerBin, 'dist/dashica-server');

    console.log('Copying dashica_config.yaml to dist/');
    cp('dashica_config.yaml', 'dist/dashica_config.yaml');

    console.log('✓ Build complete');
}