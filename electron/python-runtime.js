const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");

function isPythonRuntimeUsable(executable) {
    const result = spawnSync(executable, ["-I", "-c", "import ensurepip, ssl, venv, sys; assert sys.version_info[:2] == (3, 12)"], {timeout: 15000});
    return result.status === 0;
}

function copyRuntimeTree(source, destination, sourceRoot, destinationRoot) {
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink()) {
        const relativeTarget = path.relative(sourceRoot, fs.realpathSync(source));
        if (relativeTarget === ".." || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
            throw new Error("Bundled Python link points outside its runtime");
        }
        fs.symlinkSync(path.relative(path.dirname(destination), path.join(destinationRoot, relativeTarget)), destination);
    } else if (stat.isDirectory()) {
        fs.mkdirSync(destination, {recursive: true, mode: stat.mode});
        for (const entry of fs.readdirSync(source)) {
            copyRuntimeTree(path.join(source, entry), path.join(destination, entry), sourceRoot, destinationRoot);
        }
    } else {
        fs.copyFileSync(source, destination);
        fs.chmodSync(destination, stat.mode);
    }
}

// AppImage mount points disappear at exit. venv retains both symlinks and
// pyvenv.cfg references to its base interpreter, so persist the entire runtime.
function persistPythonRuntime(sourceExecutable, installDir, version, validate = isPythonRuntimeUsable) {
    const target = path.join(installDir, "python-runtimes", version);
    const executable = path.join(target, "bin", "python3");
    const marker = path.join(target, ".complete");
    if (fs.existsSync(marker) && fs.existsSync(executable) && validate(executable)) return executable;

    const staging = `${target}.staging`;
    fs.mkdirSync(path.dirname(target), {recursive: true});
    fs.rmSync(staging, {recursive: true, force: true});
    try {
        const source = fs.realpathSync(path.dirname(path.dirname(sourceExecutable)));
        copyRuntimeTree(source, staging, source, staging);
        if (!validate(path.join(staging, "bin", "python3"))) {
            throw new Error("Copied Python runtime is incomplete or cannot execute");
        }
        fs.writeFileSync(path.join(staging, ".complete"), version);
        fs.rmSync(target, {recursive: true, force: true});
        fs.renameSync(staging, target);
    } catch (error) {
        fs.rmSync(staging, {recursive: true, force: true});
        throw error;
    }
    return executable;
}

module.exports = {persistPythonRuntime, isPythonRuntimeUsable};
