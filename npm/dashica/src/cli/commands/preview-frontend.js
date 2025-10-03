import {preview as observablePreview} from "@observablehq/framework/dist/preview.js"
import {readConfig as observableReadConfig} from "@observablehq/framework/dist/config.js"
import {rm, symlink} from 'fs/promises';
import {existsSync} from 'fs';
import {join, dirname} from 'path';
import {createRequire} from 'module';

const require = createRequire(import.meta.url);

export default async function build({ flags, args, packageRoot }) {
    console.log('Building dashica...');
    console.log('packageRoot', packageRoot);
    console.log('cwd', process.cwd());

    const output = flags.output || flags.o || 'dist';
    const verbose = flags.verbose || flags.v || false;

    if (verbose) {
        console.log(`Output directory: ${output}`);
        console.log(`Args:`, args);
    }

    // Find dashica package location
    let dashicaModulePath;
    try {
        // This will find dashica/package.json in node_modules, traversing up as needed
        const packageJsonPath = require.resolve('dashica/package.json');
        dashicaModulePath = dirname(packageJsonPath);
        if (verbose) console.log(`Found dashica at: ${dashicaModulePath}`);
    } catch (error) {
        console.error('Could not find dashica module in node_modules');
        throw error;
    }

    // Remove src/dashica if it exists
    const dashicaPath = join(process.cwd(), 'src', 'dashica');
    if (existsSync(dashicaPath)) {
        await rm(dashicaPath, { recursive: true, force: true });
        if (verbose) console.log(`Removed ${dashicaPath}`);
    }

    // Create symlink from src/dashica to the found dashica module
    await symlink(dashicaModulePath, dashicaPath, 'dir');
    if (verbose) console.log(`Created symlink: ${dashicaPath} -> ${dashicaModulePath}`);


    await observableReadConfig(undefined, undefined)

    observablePreview({
        hostname: '127.0.0.1',
        config: undefined,
        root: undefined,
        port: undefined,
        origins: undefined,
        open: false
    });

    console.log('✓ Build complete');
}