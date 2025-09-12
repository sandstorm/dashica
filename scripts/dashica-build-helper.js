const childProcess = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const repoDir = path.dirname(__dirname)
const npmDir = path.join(repoDir, 'npm', 'dashica')
const version = fs.readFileSync(path.join(repoDir, 'version.txt'), 'utf8').trim()


// Writing a file atomically is important for watch mode tests since we don't
// want to read the file after it has been truncated but before the new contents
// have been written.
exports.writeFileAtomic = (where, contents) => {
    // Note: Can't use "os.tmpdir()" because that doesn't work on Windows. CI runs
    // tests on D:\ and the temporary directory is on C:\ or the other way around.
    // And apparently it's impossible to move files between C:\ and D:\ or something.
    // So we have to write the file in the same directory as the destination. This is
    // unfortunate because it will unnecessarily trigger extra watch mode rebuilds.
    // So we have to make our tests extra robust so they can still work with random
    // extra rebuilds thrown in.
    const file = path.join(path.dirname(where), '.dashica-atomic-file-' + Math.random().toString(36).slice(2))
    fs.writeFileSync(file, contents)
    fs.renameSync(file, where)
}

exports.buildBinary = () => {
    childProcess.execFileSync('go', ['build', '-ldflags=-s -w', '-trimpath', './cmd/dashica'], { cwd: repoDir, stdio: 'ignore' })
    return path.join(repoDir, process.platform === 'win32' ? 'dashica.exe' : 'dashica')
}

exports.removeRecursiveSync = path => {
    try {
        fs.rmSync(path, { recursive: true })
    } catch (e) {
        // Removing stuff on Windows is flaky and unreliable. Don't fail tests
        // on CI if Windows is just being a pain. Common causes of flakes include
        // random EPERM and ENOTEMPTY errors.
        //
        // The general "solution" to this is to try asking Windows to redo the
        // failing operation repeatedly until eventually giving up after a
        // timeout. But that doesn't guarantee that flakes will be fixed so we
        // just give up instead. People that want reasonable file system
        // behavior on Windows should use WSL instead.
    }
}

const updateVersionPackageJSON = pathToPackageJSON => {
    const version = fs.readFileSync(path.join(path.dirname(__dirname), 'version.txt'), 'utf8').trim()
    const json = JSON.parse(fs.readFileSync(pathToPackageJSON, 'utf8'))

    if (json.version !== version) {
        json.version = version
        fs.writeFileSync(pathToPackageJSON, JSON.stringify(json, null, 2) + '\n')
    }
}

exports.installForTests = () => {
    // Build the "dashica" binary and library
    const dashicaPath = exports.buildBinary()
    buildNeutralLib(dashicaPath)

    // Install the "dashica" package to a temporary directory. On Windows, it's
    // sometimes randomly impossible to delete this installation directory. My
    // best guess is that this is because the dashica process is kept alive until
    // the process exits for "buildSync" and "transformSync", and that sometimes
    // prevents Windows from deleting the directory it's in. The call in tests to
    // "rimraf.sync()" appears to hang when this happens. Other operating systems
    // don't have a problem with this. This has only been a problem on the Windows
    // VM in GitHub CI. I cannot reproduce this issue myself.
    const installDir = path.join(os.tmpdir(), 'dashica-' + Math.random().toString(36).slice(2))
    const env = { ...process.env, ESBUILD_BINARY_PATH: dashicaPath }
    fs.mkdirSync(installDir)
    fs.writeFileSync(path.join(installDir, 'package.json'), '{}')
    childProcess.execSync(`npm pack --silent "${npmDir}"`, { cwd: installDir, stdio: 'inherit' })
    childProcess.execSync(`npm install --silent --no-audit --no-optional --ignore-scripts=false --progress=false dashica-${version}.tgz`, { cwd: installDir, env, stdio: 'inherit' })

    // Evaluate the code
    const ESBUILD_PACKAGE_PATH = path.join(installDir, 'node_modules', 'dashica')
    const mod = require(ESBUILD_PACKAGE_PATH)
    Object.defineProperty(mod, 'ESBUILD_PACKAGE_PATH', { value: ESBUILD_PACKAGE_PATH })
    return mod
}

const updateVersionGo = () => {
    const version_txt = fs.readFileSync(path.join(repoDir, 'version.txt'), 'utf8').trim()
    const version_go = `package main\n\nconst dashicaVersion = "${version_txt}"\n`
    const version_go_path = path.join(repoDir, 'server', 'cmd', 'dashica-server', 'version.go')

    // Update this atomically to avoid issues with this being overwritten during use
    const temp_path = version_go_path + Math.random().toString(36).slice(1)
    fs.writeFileSync(temp_path, version_go)
    fs.renameSync(temp_path, version_go_path)
}

// This is helpful for ES6 modules which don't have access to __dirname
exports.dirname = __dirname

// The main Makefile invokes this script before publishing
if (require.main === module) {
    if (process.argv.indexOf('--version') >= 0) updateVersionPackageJSON(process.argv[2])
    else if (process.argv.indexOf('--update-version-go') >= 0) updateVersionGo()
    else throw new Error('Expected a flag')
}
