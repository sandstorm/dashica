import {dirname, join} from "path";
import {existsSync} from "fs";
import {rm, symlink} from "fs/promises";
import {createRequire} from 'module';

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