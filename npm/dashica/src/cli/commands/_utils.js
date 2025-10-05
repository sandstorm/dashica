import {dirname, join, resolve, relative} from "path";
import {existsSync} from "fs";
import {readdir, rm, symlink, mkdir, cp} from "fs/promises";
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
    await rm(dashicaPath, {recursive: true, force: true});

    // Create symlink from src/dashica to the found dashica module
    await symlink(dashicaModulePath, dashicaPath, 'dir');
    console.log(`Created symlink: ${dashicaPath} -> ${dashicaModulePath}`);
}

/**
 * Resolve the dashica-server binary to use, or build it if requested.
 *
 * - understands the "build" and "bin" and "embed" flags.
 *
 * @param flags
 * @returns {Promise<void>}
 */
export async function resolveDashicaServerAndCompileIfNeeded(flags) {

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
            console.error(`ERROR: Server source directory "${join(flags['build'], 'server')}" does not exist.`);
            process.exit(1);
        }

        // Build the Go server & wait for build to complete
        dashicaServerBin = join(serverSourceDirectory, 'build', 'dashica-server');
        let buildArgs = ['build-server'];
        if (flags['embed']) {
            console.log(`embedding ./dist into server at ${serverSourceDirectory}/dist`);
            if (existsSync(join(serverSourceDirectory, 'dist'))) {
                await rm(join(serverSourceDirectory, 'dist'), {recursive: true, force: true});
            }
            await copyFiles(
                'dist/',
                join(serverSourceDirectory, 'dist'),
                // copy all files for embedding except for dashica-server and dashica_config*.yaml
                (entry) =>
                    entry.name !== 'dashica-server' &&
                    !entry.name.startsWith('dashica_config')
            );
            buildArgs = ['build-server-embedded'];
        }
        const buildProcess = spawn(resolve(join(flags['build'], 'dev.sh')), buildArgs, {
            stdio: 'inherit',
            cwd: resolve(flags['build']),
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
    } else {
        if (flags['embed']) {
            console.error(`ERROR: --embed must be used together with --build.`);
            process.exit(1);
        }
    }

    // Take a pre-built dashica-server binary if requested
    if (flags['bin']) {
        if (!existsSync(flags['bin'])) {
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


export async function copyFiles(srcRoot, destRoot, filterFn) {
    async function walk(dir) {
        const entries = await readdir(dir, {withFileTypes: true});
        for (const entry of entries) {
            const fullPath = join(dir, entry.name);
            if (entry.isDirectory()) {
                await walk(fullPath);
            } else if (entry.isFile() && filterFn(entry)) {
                const rel = relative(srcRoot, fullPath);
                const destPath = join(destRoot, rel);
                await mkdir(dirname(destPath), {recursive: true});
                console.log("SRC", srcRoot, "dir", dir, "fullpath", fullPath, "destpath", destPath);
                await cp(fullPath, destPath);
            }
        }
    }

    try {
        await walk(srcRoot);
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            console.warn(`Warning: '${srcRoot}' directory not found; no files copied.`);
            return;
        }
        console.warn(`Warning: Error while copying files: ${err.message}`);
    }
}