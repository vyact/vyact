const os = require("os");
const path = require("path");

const isWindows = process.platform === "win32";
const windowsUserInstallDir = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"),
    "Vyact",
);
const defaultInstallDir = isWindows
    ? windowsUserInstallDir
    : path.join(os.homedir(), ".vyact");

const installDir = process.env.VYACT_INSTALL_DIR || defaultInstallDir;
const venvDir = path.join(installDir, "venv");
const WINDOWS_LLAMA_CPP_PYTHON_WHEEL = "https://github.com/abetlen/llama-cpp-python/releases/download/v0.3.34-vulkan/llama_cpp_python-0.3.34-py3-none-win_amd64.whl";

module.exports = {
    isWindows,
    installDir,
    venvDir,
    venvPython: path.join(venvDir, isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python3"),
    bundledPython(resourcesPath, isPackaged) {
        if (!isPackaged) return process.env.VYACT_PYTHON || (isWindows ? "python" : "python3");
        return path.join(resourcesPath, "python", isWindows ? "python.exe" : path.join("bin", "python3"));
    },
    uvicornPath: path.join(
        venvDir,
        isWindows ? "Lib" : "lib",
        ...(isWindows ? [] : ["python3.12"]),
        "site-packages",
        "uvicorn",
    ),
    venvBinDir: path.join(venvDir, isWindows ? "Scripts" : "bin"),
    executableSearchPaths: isWindows
        ? []
        : ["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"],
    childProcessOptions: isWindows ? {windowsHide: true} : {},
    pythonBootstrapPackages: isWindows ? [WINDOWS_LLAMA_CPP_PYTHON_WHEEL] : [],
    windowOptions: isWindows
        ? {frame: false}
        : {titleBarStyle: "hiddenInset", trafficLightPosition: {x: 12, y: 12}},
    childProcessEnv() {
        const env = {...process.env, VYACT_INSTALL_DIR: installDir};
        delete env.MallocStackLogging;
        delete env.MallocStackLoggingNoCompact;
        return env;
    },
};
