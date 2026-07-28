const {app, BrowserView, BrowserWindow, dialog, ipcMain, session, shell} = require("electron");
const path = require("path");
const {spawn, execSync, execFileSync, spawnSync} = require("child_process");
const fs = require("fs");
const os = require("os");
const http = require("http");

// ── 기본 경로 ─────────────────────────────
const INSTALL_DIR = "C:\\.vyact";
const VENV_DIR = path.join(INSTALL_DIR, "venv");
const VENV_PYTHON = path.join(VENV_DIR, "Scripts", "python.exe");

const APP_RES = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(__dirname, "..", "app");
const I18N_LOCALES_DIR = app.isPackaged
    ? path.join(process.resourcesPath, "locales")
    : path.join(__dirname, "..", "..", "frontend", "src", "i18n", "locales");

const LOGS_DIR = path.join(INSTALL_DIR, "logs");
const SERVER_PORT = 8000;
const ES_PORT = Number(process.env.ES_PORT || 9251);
const AUTO_START_DELAY_SECONDS = 15;
const WINDOWS_AUTO_START_TASK = "Vyact Delayed Startup";

// Chocolatey 기본 설치 경로
const CHOCO_BIN = "C:\\ProgramData\\chocolatey\\bin";
const CHOCO_EXE = path.join(CHOCO_BIN, "choco.exe");

let mainWindow = null;
// Keep loading.html alive beneath the prepared setup view to avoid a native
// window replacement flash on the first-install transition.
let initialSetupView = null;
let serverProc = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
    app.quit();
}

function sendLoadingLog(message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send("loading-log", message); } catch {}
    }
}

function sendLoadingStatus(message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        try { mainWindow.webContents.send("loading-status", message); } catch {}
    }
}

function isDelayedLoginItemEnabled() {
    try {
        execFileSync("schtasks.exe", ["/Query", "/TN", WINDOWS_AUTO_START_TASK], {stdio: "ignore"});
        return true;
    } catch {
        return false;
    }
}

function setDelayedLoginItem(enable) {
    try {
        if (!enable) {
            execFileSync("schtasks.exe", ["/Delete", "/TN", WINDOWS_AUTO_START_TASK, "/F"], {stdio: "ignore"});
            return false;
        }

        const delay = `0000:${String(AUTO_START_DELAY_SECONDS).padStart(2, "0")}`;
        execFileSync("schtasks.exe", [
            "/Create", "/TN", WINDOWS_AUTO_START_TASK,
            "/TR", `\"${process.execPath}\"`,
            "/SC", "ONLOGON", "/DELAY", delay, "/F",
        ], {stdio: "ignore"});
        return true;
    } catch (error) {
        log(`Failed to update delayed startup task: ${error.message}`);
        throw error;
    }
}

function migrateLegacyLoginItem() {
    if (!app.getLoginItemSettings().openAtLogin || isDelayedLoginItemEnabled()) return;
    app.setLoginItemSettings({openAtLogin: false});
    setDelayedLoginItem(true);
    log("Migrated startup registration to delayed scheduled task");
}

function migrateDelayedLoginItemToLoginItem() {
    if (!isDelayedLoginItemEnabled()) return;
    setDelayedLoginItem(false);
    app.setLoginItemSettings({openAtLogin: true});
    log("Migrated delayed scheduled task to Login Item");
}

// ── 로그 함수 ─────────────────────────────
function getLogFile() {
    const d = new Date();
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
    return path.join(LOGS_DIR, `app_${ymd}.log`);
}

function cleanupOldLogs(keepDays = 20) {
    if (!fs.existsSync(LOGS_DIR)) return;
    const pattern = /_(20\d{6})\.log$/;
    const dateMap = {};
    for (const name of fs.readdirSync(LOGS_DIR)) {
        const m = name.match(pattern);
        if (m) {
            const date = m[1];
            if (!dateMap[date]) dateMap[date] = [];
            dateMap[date].push(path.join(LOGS_DIR, name));
        }
    }
    const sorted = Object.keys(dateMap).sort().reverse();
    for (const old of sorted.slice(keepDays)) {
        for (const f of dateMap[old]) {
            try { fs.unlinkSync(f); } catch {}
        }
    }
}

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}\n`;
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, {recursive: true});
    fs.appendFileSync(getLogFile(), line);
    console.log(msg);
    sendLoadingLog(msg);
}

function getStartupTranslation() {
    const language = app.getLocale().split("-")[0].toLowerCase();
    const readTranslation = (locale) => JSON.parse(fs.readFileSync(
        path.join(I18N_LOCALES_DIR, locale, "settings.json"), "utf8",
    )).general;

    try {
        return readTranslation(language);
    } catch {
        return readTranslation("en");
    }
}

function getElasticsearchStartupMessage() {
    const translation = getStartupTranslation();
    return [translation.elasticsearchStartupTitle, translation.elasticsearchStartupMessage];
}

function isElasticsearchReady() {
    return new Promise((resolve) => {
        const request = http.get(`http://127.0.0.1:${ES_PORT}`, (response) => {
            response.resume();
            resolve(response.statusCode === 200);
        });
        request.setTimeout(1500, () => request.destroy());
        request.on("error", () => resolve(false));
    });
}

async function waitForElasticsearch(retries = 10, retryDelayMs = 3000) {
    const startedAt = Date.now();
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        if (await isElasticsearchReady()) {
            log("✅ Elasticsearch ready");
            // ES 연결 뒤에도 Python 서버의 모델 초기화가 이어진다. 이전 ES 대기 문구의
            // 타이머를 해제하지 않으면 실제로는 연결됐는데도 경과 초가 계속 표시된다.
            sendLoadingStatus("");
            return true;
        }
        // 일반적인 기동 지연에는 문구를 노출하지 않는다. 다섯 번째 재시도 이후에도
        // 준비되지 않았을 때만 사용자에게 현재 대기 상태를 안내한다.
        if (attempt > 5) {
            sendLoadingStatus({
                template: getStartupTranslation().elasticsearchWaiting,
                startedAt,
            });
        }
        if (attempt < retries) await new Promise(resolve => setTimeout(resolve, retryDelayMs));
    }
    return false;
}

function showElasticsearchUnavailableAndQuit() {
    const [title, message] = getElasticsearchStartupMessage();
    log("❌ Elasticsearch was not ready before startup timeout");
    dialog.showErrorBox(title, message);
    app.exit(1);
}

// ── PATH에 choco bin 포함한 env ─────────────
function envWithChoco() {
    const extraPaths = [
        CHOCO_BIN,
        "C:\\Program Files\\Ollama",
        "C:\\Users\\Public\\ollama",
        process.env.PATH || "",
    ].join(";");
    return {...process.env, PATH: extraPaths};
}

// ── Chocolatey 설치 여부 확인 ────────────────
function isChocoInstalled() {
    try {
        spawnSync(CHOCO_EXE, ["--version"], {encoding: "utf8"});
        return fs.existsSync(CHOCO_EXE);
    } catch {
        return false;
    }
}

// ── Chocolatey 자동 설치 (PowerShell, 관리자 권한 필요) ──
function installChoco() {
    log("▸ Chocolatey 설치 중...");
    try {
        const psCmd = [
            "Set-ExecutionPolicy Bypass -Scope Process -Force;",
            "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072;",
            "iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))",
        ].join(" ");
        execSync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCmd}"`, {
            stdio: "inherit",
            timeout: 120_000,
            windowsHide: true,
        });
        log("✅ Chocolatey installed");
        return true;
    } catch (e) {
        log(`❌ Chocolatey installation failed: ${e.message}`);
        return false;
    }
}

// ── choco install 래퍼 ───────────────────────
function chocoInstall(packageName) {
    log(`▸ choco install ${packageName} -y`);
    try {
        execSync(`"${CHOCO_EXE}" install ${packageName} -y --no-progress`, {
            stdio: "inherit",
            env: envWithChoco(),
            timeout: 300_000,
            windowsHide: true,
        });
        log(`✅ ${packageName} installed`);
        return true;
    } catch (e) {
        log(`❌ ${packageName} installation failed: ${e.message}`);
        return false;
    }
}

// ── Python 탐색 (Windows) ────────────────────
function isSupportedPython(pythonBin, args = [], env = envWithChoco()) {
    try {
        const result = spawnSync(pythonBin, [...args, "--version"], {encoding: "utf8", env});
        const versionMatch = `${result.stdout || ""}${result.stderr || ""}`.match(/Python (\d+)\.(\d+)/i);
        const major = Number(versionMatch?.[1]);
        const minor = Number(versionMatch?.[2]);
        return result.status === 0 && major === 3 && minor >= 11 && minor <= 12;
    } catch {
        return false;
    }
}

function resolvePython() {
    const candidates = [
        // Kokoro supports Python 3.11 and 3.12, so prefer those explicitly.
        {cmd: "py", args: ["-3.12"]},
        {cmd: "py", args: ["-3.11"]},
        {cmd: "py", args: ["-3"]},
        {cmd: "python", args: []},
        {cmd: "python3", args: []},
    ];
    for (const {cmd, args} of candidates) {
        try {
            const result = spawnSync(cmd, [...args, "--version"], {encoding: "utf8", env: envWithChoco()});
            const versionMatch = `${result.stdout || ""}${result.stderr || ""}`.match(/Python (\d+)\.(\d+)/i);
            const major = Number(versionMatch?.[1]);
            const minor = Number(versionMatch?.[2]);
            if (result.status === 0 && major === 3 && minor >= 11 && minor <= 12) {
                log(`✅ Python found: ${cmd} ${args.join(" ")} (${versionMatch[0]})`);
                return {cmd, args};
            }
        } catch {}
    }
    log("❌ Python 3.11 or 3.12 not found");
    return null;
}

// ── Docker 설치 여부 조용히 확인 (자동 설치/팝업 없음) ────
// ES는 백엔드 setup(es_native)에서 네이티브 바이너리로 처리하므로 Docker는 선택 사항이다.
// Docker가 있으면 활용하고, 없으면 조용히 건너뛴다.
function isDockerRunning() {
    log("▸ Checking Docker (optional)...");
    try {
        execSync("docker --version", {stdio: "pipe", env: envWithChoco()});
    } catch {
        log("ℹ️ Docker not installed — will use native Elasticsearch");
        return false;
    }
    try {
        execSync("docker info", {stdio: "pipe", env: envWithChoco()});
        log("✅ Docker is running");
        return true;
    } catch {
        log("ℹ️ Docker installed but not running — will use native Elasticsearch");
        return false;
    }
}

// ── Ollama 확인 / Chocolatey로 자동 설치 ────
function checkAndInstallOllama() {
    log("▸ Checking Ollama installation...");

    const tryOllama = () => {
        try {
            execSync("ollama --version", {stdio: "pipe", env: envWithChoco()});
            return true;
        } catch {
            const direct = [
                "C:\\Program Files\\Ollama\\ollama.exe",
                "C:\\Users\\Public\\ollama\\ollama.exe",
                path.join(os.homedir(), "AppData\\Local\\Programs\\Ollama\\ollama.exe"),
            ];
            return direct.some(p => fs.existsSync(p));
        }
    };

    if (tryOllama()) {
        log("✅ Ollama installed");
        return true;
    }

    log("⚠️ Ollama not installed — attempting auto-install via Chocolatey");

    if (!isChocoInstalled()) {
        log("▸ Chocolatey not found — installing first");
        if (!installChoco()) {
            log("⚠️ Chocolatey installation failed — manual Ollama install required");
            const {dialog} = require("electron");
            const choice = dialog.showMessageBoxSync({
                type: "question",
                buttons: ["Install Ollama manually", "Later"],
                title: "Ollama Required",
                message: "Failed to auto-install Ollama.\nPlease install from https://ollama.com",
            });
            if (choice === 0) shell.openExternal("https://ollama.com");
            return false;
        }
    }

    if (chocoInstall("ollama")) {
        log("✅ Ollama installed (choco)");
        return true;
    }

    log("⚠️ choco ollama failed — manual install required");
    const {dialog} = require("electron");
    const choice = dialog.showMessageBoxSync({
        type: "question",
        buttons: ["Install Ollama manually", "Later"],
        title: "Ollama Required",
        message: "Failed to auto-install Ollama.\nPlease install from https://ollama.com",
    });
    if (choice === 0) shell.openExternal("https://ollama.com");
    return false;
}

// ── Python 확인 / Chocolatey로 자동 설치 ────
function checkAndInstallPython() {
    log("▸ Checking Python installation...");

    if (resolvePython()) {
        log("✅ Python already installed");
        return true;
    }

    log("⚠️ Python not installed — attempting auto-install via Chocolatey");

    if (!isChocoInstalled()) {
        log("▸ Chocolatey not found — installing first");
        if (!installChoco()) {
            log("⚠️ Chocolatey installation failed — manual Python install required");
            const {dialog} = require("electron");
            const choice = dialog.showMessageBoxSync({
                type: "question",
                buttons: ["Install Python manually", "Later"],
                title: "Python Required",
                message: "Failed to auto-install Python.\nPlease install Python 3.11 or 3.12 from https://www.python.org/downloads/",
            });
            if (choice === 0) shell.openExternal("https://www.python.org/downloads/");
            return false;
        }
    }

    if (chocoInstall("python311")) {
        log("✅ Python 3.11 installed (choco)");
        process.env.PATH = `C:\\Python311;C:\\Python311\\Scripts;${process.env.PATH}`;
        return true;
    }

    log("❌ Python auto-install failed");
    const {dialog} = require("electron");
    const choice = dialog.showMessageBoxSync({
        type: "question",
        buttons: ["Install Python manually", "Later"],
        title: "Python Required",
        message: "Failed to auto-install Python.\nPlease install Python 3.11 or 3.12 from https://www.python.org/downloads/",
    });
    if (choice === 0) shell.openExternal("https://www.python.org/downloads/");
    return false;
}

// ── Elasticsearch 확인/시작 (Docker) ─────────
function checkAndStartElasticsearch() {
    log("▸ Checking Elasticsearch...");
    try {
        const env = envWithChoco();
        const result = execSync("docker ps --filter name=vyact-es --format {{.Names}}", {stdio: "pipe", env}).toString().trim();
        if (result.includes("vyact-es")) {
            log("✅ Elasticsearch is running");
            return true;
        }

        const stopped = execSync("docker ps -a --filter name=vyact-es --format {{.Names}}", {stdio: "pipe", env}).toString().trim();
        if (stopped.includes("vyact-es")) {
            log("▸ Restarting Elasticsearch container...");
            execSync("docker start vyact-es", {stdio: "pipe", env});
            log("▸ Waiting for Elasticsearch...");
            try { execSync("timeout /t 5 /nobreak", {stdio: "pipe"}); } catch { execSync("ping -n 6 127.0.0.1 > nul", {stdio: "pipe"}); }
            log("✅ Elasticsearch started");
            return true;
        } else {
            log("ℹ️ Elasticsearch not installed — will be configured in setup wizard");
            return false;
        }
    } catch (e) {
        log(`⚠️ Elasticsearch check failed: ${e.message}`);
        return false;
    }
}

// ── 의존성 전체 확인 ─────────────────────────
function checkAllDependencies() {
    log("========================================");
    log("Checking dependencies");
    log("========================================");

    const pythonOk = checkAndInstallPython();
    if (!pythonOk) {
        log("❌ Python not found — exiting");
        return false;
    }

    const dockerOk = isDockerRunning();
    if (!dockerOk) {
        log("ℹ️ Docker not available — Elasticsearch will be configured in setup wizard");
    }

    const ollamaOk = checkAndInstallOllama();
    if (!ollamaOk) {
        log("⚠️ Continuing without Ollama (cloud models only)");
    }

    if (dockerOk) {
        checkAndStartElasticsearch();
    }

    log("========================================");
    log("Dependency check complete");
    log("========================================");

    return pythonOk;
}

// ── 서버 시작 ─────────────────────────────────
function runCommand(command, args, options = {}) {
    const {onOutput, ...spawnOptions} = options;
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {stdio: ["ignore", "pipe", "pipe"], windowsHide: true, ...spawnOptions});
        let output = "";
        const captureOutput = data => {
            const text = data.toString();
            output += text;
            onOutput?.(text);
        };
        child.stdout.on("data", captureOutput);
        child.stderr.on("data", captureOutput);
        child.on("error", reject);
        child.on("close", code => code === 0 ? resolve(output) : reject(new Error(output || `Command failed (${code})`)));
    });
}

function createRequirementsProgressReporter(requirementsPath) {
    const packageNames = fs.readFileSync(requirementsPath, "utf8")
        .split(/\r?\n/)
        .map(line => line.trim().replace(/\s+#.*$/, ""))
        .filter(line => line && !line.startsWith("#") && !line.startsWith("-"))
        .map(line => line.match(/^([A-Za-z0-9][A-Za-z0-9_.-]*)/)?.[1])
        .filter(Boolean);
    let currentPackage = "";
    return output => {
        const packageName = packageNames.find(name => new RegExp(`(?:Collecting|Requirement already satisfied:|Using cached)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(output));
        if (packageName && packageName !== currentPackage) {
            currentPackage = packageName;
            sendLoadingStatus(getStartupTranslation().pythonPackageDownloading.replace("{{package}}", packageName));
        }
    };
}

async function startServer() {
    log("▸ Starting server process");

    if (!fs.existsSync(INSTALL_DIR)) fs.mkdirSync(INSTALL_DIR, {recursive: true});

    // 패키지의 extraResources/app을 그대로 실행한다. 사용자 데이터와 venv는
    // INSTALL_DIR에만 두므로, 설치 번들을 매번 복사하거나 수정할 필요가 없다.
    const serverAppDir = APP_RES;
    if (!fs.existsSync(path.join(serverAppDir, "main.py"))) {
        log(`❌ Server app resource not found: ${serverAppDir}`);
        return;
    }

    const uvicornCheck = path.join(VENV_DIR, "Lib", "site-packages", "uvicorn");
    const needsSetup = !fs.existsSync(VENV_PYTHON) || !fs.existsSync(uvicornCheck);
    if (needsSetup) {
        log("▸ Creating virtual environment (venv)");

        const python = resolvePython();
        if (!python) {
            log("❌ Python not found — cannot start server");
            const {dialog} = require("electron");
            dialog.showErrorBox("Python Required", "Python is not installed.\nRestart the app to attempt auto-installation.");
            return;
        }

        try {
            const venvArgs = [python.cmd, ...python.args, "-m", "venv", VENV_DIR];

            execSync(venvArgs.join(" "), {stdio: "inherit", env: envWithChoco(), windowsHide: true});
            log("✅ venv created");

            log("▸ Upgrading pip...");
            await runCommand(VENV_PYTHON, ["-m", "pip", "install", "--upgrade", "pip", "--quiet"]);

            const reqPath = path.join(serverAppDir, "requirements.txt");
            if (fs.existsSync(reqPath)) {
                log("▸ Installing packages from requirements.txt...");
                sendLoadingStatus(getStartupTranslation().pythonPackagesInstalling);
                await runCommand(VENV_PYTHON, ["-m", "pip", "install", "-r", reqPath], {onOutput: createRequirementsProgressReporter(reqPath)});
                const crypto = require("crypto");
                const hash = crypto.createHash("md5").update(fs.readFileSync(reqPath)).digest("hex");
                fs.writeFileSync(path.join(INSTALL_DIR, ".req_hash"), hash);
                log("✅ Packages installed");
            } else {
                await runCommand(VENV_PYTHON, ["-m", "pip", "install", "fastapi", "uvicorn", "aiofiles", "pydantic", "httpx", "elasticsearch", "--quiet"]);
            }
            log("✅ venv setup complete");
        } catch (err) {
            log(`❌ venv creation failed: ${err.message}`);
        }
    } else {
        // 앱 업데이트로 requirements.txt가 바뀐 경우에만 가상환경을 동기화한다.
        const reqPath = path.join(serverAppDir, "requirements.txt");
        const reqHashFile = path.join(INSTALL_DIR, ".req_hash");

        if (fs.existsSync(reqPath)) {
            const crypto = require("crypto");
            const currentHash = crypto.createHash("md5").update(fs.readFileSync(reqPath)).digest("hex");
            let savedHash = "";
            try { savedHash = fs.readFileSync(reqHashFile, "utf-8").trim(); } catch {}

            if (currentHash !== savedHash) {
                log("▸ requirements.txt changed — syncing packages...");
                try {
                    sendLoadingStatus(getStartupTranslation().pythonPackagesInstalling);
                    await runCommand(VENV_PYTHON, ["-m", "pip", "install", "-r", reqPath], {onOutput: createRequirementsProgressReporter(reqPath)});
                    fs.writeFileSync(reqHashFile, currentHash);
                    log("✅ Package sync complete");
                } catch (err) {
                    log(`⚠️ Package sync failed: ${err.message}`);
                }
            }
        }
    }

    const env = {
        ...envWithChoco(),
        PYTHONPATH: serverAppDir,
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
        PYTHONUTF8: "1",
        // 설치된 앱 번들은 읽기 전용일 수 있으므로 __pycache__를 만들지 않는다.
        PYTHONDONTWRITEBYTECODE: "1",
        VYACT_SYSTEM_LANGUAGE: app.getLocale(),
    };

    const finalPython = fs.existsSync(VENV_PYTHON) ? VENV_PYTHON : "python";
    log(`🚀 Starting server: ${finalPython}`);

    serverProc = spawn(finalPython, ["-u", "main.py"], {
        cwd: serverAppDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
    });

    // 파이썬 서버는 이미 자체 FileHandler로 같은 로그 파일에 직접 기록한다.
    // 여기서 log()로 파일에 또 쓰면 모든 서버 로그가 두 번씩 쌓이므로(PID까지 중복),
    // 파일에는 쓰지 않고 콘솔에만 흘려보낸다.
    const forwardServerOutput = (data, isError = false) => {
        for (const line of data.toString().split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
            if (isError) console.error(`[server:err] ${line}`);
            else console.log(`[server] ${line}`);
            sendLoadingLog(line);
            if (line.includes("[startup-status] models")) {
                sendLoadingStatus(getStartupTranslation().preparingModels);
            } else if (line.includes("[startup-status] tts")) {
                sendLoadingStatus(getStartupTranslation().preparingTts);
            } else if (line.includes("[startup-status] stt")) {
                sendLoadingStatus(getStartupTranslation().preparingStt);
            }
        }
    };
    serverProc.stdout.on("data", (data) => forwardServerOutput(data));
    serverProc.stderr.on("data", (data) => forwardServerOutput(data, true));
}

// ── 서버 준비 대기 ────────────────────────────
function waitForServer(retries = 180) {
    // 첫 실행은 venv 생성 + pip install + Playwright Chromium 설치 +
    // Whisper/reranker 모델 다운로드로 startup 완료까지 오래 걸린다(수십 초~수 분).
    // 30초로는 부족해 첫 실행이 "서버 시작 실패"로 멈추는 문제가 있어 넉넉히 잡는다.
    return new Promise((resolve, reject) => {
        let count = 0;
        const retry = () => {
            count += 1;
            if (count >= retries) {
                reject(new Error("Server failed to start"));
                return;
            }
            if (count === 1 || count % 5 === 0) {
                sendLoadingLog(`⏳ Waiting for server... ${count}s elapsed`);
            }
            setTimeout(check, 1000);
        };
        const check = () => {
            http.get(`http://localhost:${SERVER_PORT}/api/setup/status`, res => {
                if (res.statusCode === 200) resolve();
                else retry();
            }).on("error", () => {
                retry();
            });
        };
        check();
    });
}

// ── 창 생성 ──────────────────────────────────
function createWindow() {
    log("▸ Creating Electron window");

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: "#0f1117",
        frame: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
            allowRunningInsecureContent: true,
            experimentalFeatures: true,
            spellcheck: false,
        },
        show: true,
    });

    // maximize 상태 변경 → 렌더러 알림
    mainWindow.on("maximize", () => mainWindow?.webContents.send("window-maximize-change", true));
    mainWindow.on("unmaximize", () => mainWindow?.webContents.send("window-maximize-change", false));

    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ["media", "microphone", "camera", "notifications", "mediaKeySystem"];
        callback(allowed.includes(permission));
    });

    session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
        const allowed = ["media", "microphone", "camera", "notifications", "mediaKeySystem"];
        return allowed.includes(permission);
    });

    const loadingPath = path.join(__dirname, "loading.html");
    const loadingReady = new Promise((resolve) => {
        const finishLoading = () => {
            // loading.html의 렌더러와 preload 브릿지가 준비된 뒤에 설치 작업을 시작해야
            // 동기식 설치 중에도 첫 화면과 진행 로그가 즉시 보인다.
            mainWindow.webContents.once("did-finish-load", resolve);
        };

        if (fs.existsSync(loadingPath)) {
            // startServer()의 needsSetup과 동일한 기준 — venv/uvicorn이 이미 있으면 재실행으로 보고
            // 간단한 화면만, 없으면 최초 설치로 보고 상세 로그를 보여준다.
            const uvicornCheck = path.join(VENV_DIR, "Lib", "site-packages", "uvicorn");
            const isFirstRun = !fs.existsSync(VENV_PYTHON) || !fs.existsSync(uvicornCheck);
            finishLoading();
            mainWindow.loadFile(loadingPath, {query: {firstRun: isFirstRun ? "1" : "0"}});
        } else {
            resolve();
        }
    });

    mainWindow.webContents.setWindowOpenHandler(({url}) => {
        if (url.startsWith("http://") || url.startsWith("https://")) shell.openExternal(url);
        return {action: "deny"};
    });

    mainWindow.webContents.on("will-navigate", (e, url) => {
        if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
            e.preventDefault();
            shell.openExternal(url);
        }
    });

    return loadingReady;
}

function waitForServerAndLoad() {
    waitForServer()
        .then(() => {
            log("✅ Server ready");
            loadServerApp();
        })
        .catch(err => {
            log(`❌ Server failed: ${err.message}`);
            const errorPath = path.join(__dirname, "error.html");
            if (fs.existsSync(errorPath)) {
                mainWindow.loadFile(errorPath, {
                    query: {
                        title: "Server Failed to Start",
                        msg: `First launch may take a while. Please restart the app. (${err.message})`,
                    },
                });
            } else {
                mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<!DOCTYPE html><meta charset="utf-8"><body style="background:#0f1117;color:#e2e8f0;font-family:sans-serif;text-align:center;padding-top:80px;"><h1>⚠️ Server Failed</h1><p>First launch may take a while. Please restart the app.</p><p style="color:#64748b;font-size:12px;">${err.message}</p></body>`));
            }
        });
}

async function loadServerApp() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    // 이전 버전의 CSS/JS가 Electron HTTP 캐시에 남아 있어도 업데이트된 정적
    // 리소스를 사용하도록, 앱을 로드하기 전에 이 창의 HTTP 캐시를 비운다.
    try {
        await mainWindow.webContents.session.clearCache();
    } catch (error) {
        log(`⚠️ Failed to clear HTTP cache: ${error.message}`);
    }

    if (mainWindow.isDestroyed()) return;

    if (!fs.existsSync(path.join(INSTALL_DIR, ".setup_done"))) {
        await preloadInitialSetupWindow();
        return;
    }

    await mainWindow.loadURL(`http://localhost:${SERVER_PORT}`);
}

function waitForRendererReady(browserWindow) {
    return new Promise(resolve => {
        const handler = (event) => {
            if (event.sender !== browserWindow.webContents) return;
            ipcMain.removeListener("app-ready", handler);
            resolve();
        };
        ipcMain.on("app-ready", handler);
    });
}

async function preloadInitialSetupWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const setupView = new BrowserView({
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,
            allowRunningInsecureContent: true,
            experimentalFeatures: true,
            spellcheck: false,
        },
    });
    setupView.webContents.setBackgroundThrottling(false);
    setupView.webContents.setWindowOpenHandler(({url}) => {
        if (url.startsWith("http://") || url.startsWith("https://")) shell.openExternal(url);
        return {action: "deny"};
    });
    setupView.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
            event.preventDefault();
            shell.openExternal(url);
        }
    });

    const rendererReady = waitForRendererReady(setupView);
    await setupView.webContents.loadURL(`http://localhost:${SERVER_PORT}?initialSetup=1`);
    await rendererReady;

    if (!mainWindow || mainWindow.isDestroyed()) return;

    const {width, height} = mainWindow.getContentBounds();
    initialSetupView = setupView;
    mainWindow.setBrowserView(setupView);
    setupView.setBounds({x: 0, y: 0, width, height});
    setupView.setAutoResize({width: true, height: true});
    mainWindow.on("maximize", () => setupView.webContents.send("window-maximize-change", true));
    mainWindow.on("unmaximize", () => setupView.webContents.send("window-maximize-change", false));
}

// ── 앱 생명주기 ──────────────────────────────
app.commandLine.appendSwitch("enable-features", "WebRtcHideLocalIpsWithMdns");
app.commandLine.appendSwitch("disable-features", "WebRtcAllowInputVolumeAdjustment");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("enable-speech-input");
app.commandLine.appendSwitch("enable-web-speech-api");

app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
});

if (hasSingleInstanceLock) app.whenReady().then(() => {
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, {recursive: true});
    cleanupOldLogs();
    migrateDelayedLoginItemToLoginItem();
    log("✅ App started (Windows)");

    const startupDelayMs = app.getLoginItemSettings().wasOpenedAtLogin
        ? AUTO_START_DELAY_SECONDS * 1000
        : 0;

    setTimeout(() => createWindow().then(() => {
        setTimeout(async () => {
            const depsOk = checkAllDependencies();
            if (!depsOk) {
                log("❌ Required dependencies (Python) not met — exiting");
                const errorPath = path.join(__dirname, "error.html");
                if (mainWindow && !mainWindow.isDestroyed() && fs.existsSync(errorPath)) {
                    mainWindow.loadFile(errorPath, {
                        query: {title: "Dependency Installation Failed", msg: "Required dependencies (Python) could not be installed. Please check logs and restart the app."},
                    });
                }
                return;
            }
            if (fs.existsSync(path.join(INSTALL_DIR, ".setup_done")) && !await waitForElasticsearch()) {
                showElasticsearchUnavailableAndQuit();
                return;
            }
            await startServer();
            waitForServerAndLoad();
        }, 100);
    }), startupDelayMs);
});

let isQuitting = false;
app.on("before-quit", async (e) => {
    if (isQuitting) return;
    if (serverProc && !serverProc.killed) {
        e.preventDefault();
        isQuitting = true;
        log("🛑 Shutting down — unloading Ollama...");
        try {
            await fetch("http://localhost:8000/api/shutdown", {method: "POST"}).catch(() => {});
        } catch {}
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (!serverProc.killed) serverProc.kill();
                resolve();
            }, 5000);
            serverProc.on("exit", () => {
                clearTimeout(timer);
                resolve();
            });
        });
        log("✅ Server shutdown complete");
        app.quit();
    }
});

app.on("window-all-closed", () => { app.quit(); });

ipcMain.handle("get-log-path", () => getLogFile());

// ── 부팅 시 자동 시작 설정 ──────────────────────────────────────────────────
ipcMain.handle("get-login-item", () => app.getLoginItemSettings().openAtLogin);
ipcMain.handle("set-login-item", (_, enable) => {
    // 이전 버전이 만든 지연 작업을 정리하고 Windows Login Item을 사용한다.
    try { setDelayedLoginItem(false); } catch {}
    app.setLoginItemSettings({openAtLogin: enable});
    return app.getLoginItemSettings().openAtLogin;
});

// ── 폴더 선택 다이얼로그 ──
ipcMain.handle("select-folder", async () => {
    const {dialog} = require("electron");
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory"],
        title: "Select folder",
    });
    if (result.canceled || !result.filePaths.length) return null;
    return result.filePaths[0];
});

ipcMain.handle("select-folders", async () => {
    const {dialog} = require("electron");
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ["openDirectory", "multiSelections"],
        title: "Select folders",
    });
    return result.canceled ? [] : result.filePaths;
});

ipcMain.handle("screenshot", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    const contents = initialSetupView?.webContents || mainWindow.webContents;
    const image = await contents.capturePage();
    return image.toPNG().toString("base64");
});

const SCREENSHOT_ASPECT_RATIOS = {
    "16:9": 16 / 9,
    "4:3": 4 / 3,
    "1:1": 1,
};

ipcMain.handle("window-set-aspect-ratio", (_event, aspectRatio) => {
    const ratio = SCREENSHOT_ASPECT_RATIOS[aspectRatio];
    if (!mainWindow || mainWindow.isDestroyed() || !ratio) return false;

    if (mainWindow.isMaximized()) mainWindow.unmaximize();

    const {screen} = require("electron");
    const display = screen.getDisplayMatching(mainWindow.getBounds());
    const {x, y, width: workAreaWidth, height: workAreaHeight} = display.workArea;
    const outerMargin = 80;
    const maxWidth = workAreaWidth - outerMargin * 2;
    const maxHeight = workAreaHeight - outerMargin * 2;
    let width = Math.min(maxWidth, Math.round(maxHeight * ratio));
    let height = Math.round(width / ratio);

    if (height > maxHeight) {
        height = maxHeight;
        width = Math.round(height * ratio);
    }

    mainWindow.setBounds({
        x: x + Math.round((workAreaWidth - width) / 2),
        y: y + Math.round((workAreaHeight - height) / 2),
        width,
        height,
    });
    return true;
});

// ── 창 컨트롤 (frameless window) ──
ipcMain.handle("window-minimize", () => mainWindow?.minimize());
ipcMain.handle("window-maximize", () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize();
    else mainWindow?.maximize();
});
ipcMain.handle("window-close", () => mainWindow?.close());
