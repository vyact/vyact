const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const {persistPythonRuntime, isPythonRuntimeUsable} = require("../python-runtime");

test("persisted interpreter survives source mount removal and is reused", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyact-python-test-"));
    try {
        const source = path.join(root, "mount", "python");
        fs.mkdirSync(path.join(source, "bin"), {recursive: true});
        fs.writeFileSync(path.join(source, "bin", "python3.12"), "interpreter");
        fs.symlinkSync("python3.12", path.join(source, "bin", "python3"));
        const sourceExecutable = path.join(source, "bin", "python3");
        const userDir = path.join(root, "user");
        const saved = persistPythonRuntime(sourceExecutable, userDir, "1.0", () => true);
        fs.rmSync(path.join(root, "mount"), {recursive: true});
        assert.equal(fs.readFileSync(saved, "utf8"), "interpreter");
        assert.equal(persistPythonRuntime(sourceExecutable, userDir, "1.0", () => true), saved);
        assert.equal(path.isAbsolute(fs.readlinkSync(saved)), false);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test("an unusable completed copy is replaced before creating a venv", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyact-python-repair-"));
    try {
        const source = path.join(root, "mount", "bin", "python3");
        fs.mkdirSync(path.dirname(source), {recursive: true});
        fs.writeFileSync(source, "valid");
        const validate = executable => fs.readFileSync(executable, "utf8") === "valid";
        const saved = persistPythonRuntime(source, path.join(root, "user"), "1.0", validate);
        fs.writeFileSync(saved, "corrupt");
        assert.equal(persistPythonRuntime(source, path.join(root, "user"), "1.0", validate), saved);
        assert.equal(fs.readFileSync(saved, "utf8"), "valid");
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});

test("real venv survives a removed AppImage mount", {skip: !process.env.TEST_BUNDLED_PYTHON}, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "vyact-venv-test-"));
    try {
        const mounted = path.join(root, "mount", "python");
        fs.mkdirSync(path.dirname(mounted), {recursive: true});
        execFileSync("cp", ["-a", path.dirname(path.dirname(process.env.TEST_BUNDLED_PYTHON)), mounted]);
        const saved = persistPythonRuntime(path.join(mounted, "bin", "python3"), root, "1.0");
        const venv = path.join(root, "venv");
        execFileSync(saved, ["-m", "venv", venv]);
        fs.rmSync(path.join(root, "mount"), {recursive: true});
        assert.match(execFileSync(path.join(venv, "bin", "python3"), ["--version"], {encoding: "utf8"}), /Python 3.12/);
        execFileSync(path.join(venv, "bin", "python3"), ["-m", "pip", "--version"]);
        const sslModule = path.join(path.dirname(path.dirname(saved)), "lib", "python3.12", "ssl.py");
        fs.renameSync(sslModule, `${sslModule}.disabled`);
        const venvPython = path.join(venv, "bin", "python3");
        // --version alone still succeeds when modules needed by pip are broken.
        assert.match(execFileSync(venvPython, ["--version"], {encoding: "utf8"}), /Python 3.12/);
        assert.equal(isPythonRuntimeUsable(venvPython), false);
        fs.renameSync(`${sslModule}.disabled`, sslModule);
        assert.equal(isPythonRuntimeUsable(venvPython), true);
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
});
