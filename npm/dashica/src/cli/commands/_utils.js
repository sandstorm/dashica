import {dirname, join} from "path";
import {existsSync} from "fs";
import {rm, symlink} from "fs/promises";
import {createRequire} from 'module';
import {spawn} from "node:child_process";

const require = createRequire(import.meta.url);


function findDashicaModulePath() {
    try {
        // This will find dashica/package.json in node_modules, traversing up as needed
        const packageJsonPath = require.resolve('dashica/package.json');
        const dashicaModulePath = dirname(packageJsonPath);
        console.log(`Found dashica at: ${dashicaModulePath}`);
        return dashicaModulePath;
    } catch (error) {
        console.error('Could not find dashica module in node_modules');
        throw error;
    }
}

export async function symlinkDashicaFrontendSourceCode() {
    const dashicaModulePath = findDashicaModulePath();

    const dashicaPath = join(process.cwd(), 'src', 'dashica');
    if (existsSync(dashicaPath)) {
        await rm(dashicaPath, {recursive: true, force: true});
        console.log(`Removed ${dashicaPath}`);
    }

    // Create symlink from src/dashica to the found dashica module
    await symlink(dashicaModulePath, dashicaPath, 'dir');
    console.log(`Created symlink: ${dashicaPath} -> ${dashicaModulePath}`);
}

/**
 * Resolve the dashica-server binary to use, or build it if requested.
 *
 * - understands the "build" and "bin" flags.
 *
 * @param flags
 * @returns {Promise<void>}
 */
export async function resolveDashicaServer(flags) {

    let dashicaServerBin = null;

    // Build the Go Server if requested
    if (flags['build']) {
        if (flags['bin']) {
            console.error(`ERROR: --bin and --build cannot be used together.`);
            process.exit(1);
        }

        console.log(`Building dashica-server with base directory: ${flags['build']}`);

        const serverSourceDirectory = join(flags['build'], 'server');
        if (!existsSync(serverSourceDirectory)) {
            console.error(`ERROR: Server source directory "${serverSourceDirectory}" does not exist.`);
            process.exit(1);
        }

        // Build the Go server & wait for build to complete
        dashicaServerBin = join(serverSourceDirectory, 'build', 'dashica-server');
        const buildProcess = spawn('go', ['build', '-C', serverSourceDirectory, '-o', 'build/dashica-server', './cmd/dashica-server'], {
            stdio: 'inherit',
            cwd: process.cwd(),
            env: process.env,
        });
        await new Promise((resolve, reject) => {
            buildProcess.on('exit', (code, signal) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Build failed with code ${code ?? signal}`));
                }
            });
        });

        console.log(`build complete: ${serverSourceDirectory}/build/dashica-server`);
    }

    // Take a pre-built dashica-server binary if requested
    if (flags['bin']) {
        if (!existsSync(flags['bin']) ) {
            console.error(`ERROR: dashica-server binary "${flags['bin']}" does not exist.`);
            process.exit(1);
        }

        console.log(`Using pre-built dashica-server binary: ${flags['bin']}`);
        dashicaServerBin = flags['bin'];
    }

    if (!dashicaServerBin) {
        // TODO: FALLBACK to pre-built binary
        console.error(`ERROR: No dashica-server binary specified; and pre-built binaries are not yet ready to use. Use --bin or --build to specify.`);
        process.exit(1);
    }

    return dashicaServerBin;
}