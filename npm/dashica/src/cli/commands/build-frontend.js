import {build as observableBuild} from "@observablehq/framework/dist/build.js"
import {readConfig as observableReadConfig} from "@observablehq/framework/dist/config.js"
import {symlinkDashicaFrontendSourceCode} from "./_utils.js";

export default async function buildFrontend({ flags, args, packageRoot }) {
    console.log('Building dashica...');
    console.log('packageRoot', packageRoot);
    console.log('cwd', process.cwd());

    await symlinkDashicaFrontendSourceCode();

    const output = flags.output || flags.o || 'dist';
    const verbose = flags.verbose || flags.v || false;

    if (verbose) {
        console.log(`Output directory: ${output}`);
        console.log(`Args:`, args);
    }

    observableBuild({ config: await observableReadConfig(undefined, undefined) });

    console.log('✓ Build complete');
}