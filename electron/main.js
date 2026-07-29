const {app, BrowserView, BrowserWindow, dialog, ipcMain, session} = require("electron");
const path = require("path");
const {spawn, execSync, execFileSync, spawnSync} = require("child_process");
const fs = require("fs");
const os = require("os");
const http = require("http");

// ── 기본 경로 ─────────────────────────────
const HOME = os.homedir();
const INSTALL_DIR = path.resolve(HOME, ".vyact");
const VENV_DIR = path.join(INSTALL_DIR, "venv");
const VENV_PYTHON = path.join(VENV_DIR, "bin", "python3");

const APP_RES = app.isPackaged
    ? path.join(process.resourcesPath, "app")
    : path.join(__dirname, "..", "app");
const I18N_LOCALES_DIR = app.isPackaged
    ? path.join(process.resourcesPath, "locales")
    : path.join(__dirname, "..", "frontend", "src", "i18n", "locales");

const LOGS_DIR = path.join(INSTALL_DIR, "logs");
const SERVER_PORT = 8000;
const ES_PORT = Number(process.env.ES_PORT || 9251);
const AUTO_START_DELAY_SECONDS = 15;
const MAC_AUTO_START_LABEL = "com.vyact.app";

let mainWindow = null;
// The initial setup app is rendered in a child view.  Keeping loading.html in
// the window underneath avoids a native-window teardown/recreate flash.
let initialSetupView = null;
let serverProc = null;

function resizeInitialSetupView() {
    if (!mainWindow || mainWindow.isDestroyed() || !initialSetupView || initialSetupView.webContents.isDestroyed()) return;

    const {width, height} = mainWindow.getContentBounds();
    initialSetupView.setBounds({x: 0, y: 0, width, height});
}

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

function getDelayedLoginItemPath() {
    return path.join(HOME, "Library", "LaunchAgents", `${MAC_AUTO_START_LABEL}.plist`);
}

function escapeXml(value) {
    return value.replace(/[<>&'\"]/g, (character) => ({
        "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;",
    }[character]));
}

function getMacAppBundlePath() {
    return path.resolve(app.getPath("exe"), "..", "..");
}

function isDelayedLoginItemEnabled() {
    return fs.existsSync(getDelayedLoginItemPath());
}

function setDelayedLoginItem(enable) {
    const plistPath = getDelayedLoginItemPath();
    const userDomain = `gui/${process.getuid()}`;
    try {
        execFileSync("launchctl", ["bootout", userDomain, plistPath], {stdio: "ignore"});
    } catch {}

    if (!enable) {
        fs.rmSync(plistPath, {force: true});
        return false;
    }

    fs.mkdirSync(path.dirname(plistPath), {recursive: true});
    const bundlePath = escapeXml(getMacAppBundlePath());
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${MAC_AUTO_START_LABEL}</string>
<key>ProgramArguments</key><array><string>/bin/sh</string><string>-c</string><string>sleep ${AUTO_START_DELAY_SECONDS}; exec /usr/bin/open -gj "$1"</string><string>sh</string><string>${bundlePath}</string></array>
<key>RunAtLoad</key><true/>
</dict></plist>`;
    fs.writeFileSync(plistPath, plist, "utf8");
    execFileSync("launchctl", ["bootstrap", userDomain, plistPath], {stdio: "ignore"});
    return true;
}

function migrateLegacyLoginItem() {
    if (!app.getLoginItemSettings().openAtLogin || isDelayedLoginItemEnabled()) return;
    app.setLoginItemSettings({openAtLogin: false});
    setDelayedLoginItem(true);
    log("Migrated startup registration to delayed LaunchAgent");
}

function migrateDelayedLoginItemToLoginItem() {
    if (!isDelayedLoginItemEnabled()) return;
    setDelayedLoginItem(false);
    app.setLoginItemSettings({openAtLogin: true, openAsHidden: true});
    log("Migrated delayed LaunchAgent to Login Item");
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
    const sorted = Object.keys(dateMap).sort().reverse(); // 최신순
    for (const old of sorted.slice(keepDays)) {
        for (const f of dateMap[old]) {
            try {
                fs.unlinkSync(f);
            } catch {
            }
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

// ── pyenv + system python 자동 선택 ────────
function isSupportedPython(pythonBin, env) {
    try {
        const result = spawnSync(pythonBin, ["--version"], {encoding: "utf8", env});
        const versionMatch = `${result.stdout || ""}${result.stderr || ""}`.match(/Python (\d+)\.(\d+)/i);
        const major = Number(versionMatch?.[1]);
        const minor = Number(versionMatch?.[2]);
        return result.status === 0 && major === 3 && minor === 12;
    } catch {
        return false;
    }
}

function resolvePython() {
    const baseEnv = {
        ...process.env,
        PYENV_ROOT: `${process.env.HOME}/.pyenv`,
        PATH: `${process.env.HOME}/.pyenv/shims:${process.env.HOME}/.pyenv/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH || ""}`,
    };

    try {
        const pyenvInit = `
            export PYENV_ROOT="$HOME/.pyenv";
            export PATH="$PYENV_ROOT/bin:$PYENV_ROOT/shims:$PATH";
            eval "$(pyenv init -)";
        `;

        const pyenvPython = execSync(
            `${pyenvInit} pyenv which python3`,
            {shell: "/bin/bash", env: baseEnv}
        ).toString().trim();

        if (isSupportedPython(pyenvPython, baseEnv)) {
            log(`✅ Using pyenv Python 3.12: ${pyenvPython}`);
            return pyenvPython;
        }
        log(`⚠️ pyenv Python is not 3.12: ${pyenvPython}`);

    } catch (e) {
        log("⚠️ pyenv not found → checking system python3");
    }

    const systemCandidates = ["python3.12", "python3"];
    for (const pythonBin of systemCandidates) {
        if (isSupportedPython(pythonBin, baseEnv)) {
            log(`✅ Using system Python 3.12: ${pythonBin}`);
            return pythonBin;
        }
    }

    log("❌ Python 3.12 not found");
    return null;
}

// ── Docker 설치 여부 조용히 확인 (자동 설치/팝업 없음) ────
// ES는 백엔드 setup(es_native)에서 네이티브 바이너리로 처리하므로 Docker는 선택 사항이다.
// Docker가 있으면 활용하고, 없으면 조용히 건너뛴다.
function getDockerEnv() {
    return {
        ...process.env,
        PATH: [
            "/usr/local/bin",           // Intel Mac Homebrew
            "/opt/homebrew/bin",        // Apple Silicon Homebrew
            "/Applications/Docker.app/Contents/Resources/bin",  // Docker Desktop CLI
            "/usr/bin",
            "/bin",
            process.env.PATH || ""
        ].join(":")
    };
}

function isDockerRunning() {
    log("▸ Checking Docker (optional)...");

    // Docker Desktop CLI 경로를 포함해야 앱에서 실행한 명령도 Docker를 찾을 수 있다.
    const env = getDockerEnv();

    try {
        execSync("docker --version", {stdio: "pipe", env});
    } catch {
        log("ℹ️ Docker not installed — will use native Elasticsearch");
        return false;
    }
    try {
        execSync("docker info", {stdio: "pipe", env});
        log("✅ Docker is running");
        return true;
    } catch {
        log("ℹ️ Docker installed but not running — will use native Elasticsearch");
        return false;
    }
}

// ── Ollama 설치 확인 및 자동 설치 ──────────
function checkAndInstallOllama() {
    log("▸ Checking Ollama installation...");

    // PATH에 Homebrew 경로 추가
    const env = {
        ...process.env,
        PATH: [
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "/usr/bin",
            "/bin",
            process.env.PATH || ""
        ].join(":")
    };

    try {
        execSync("ollama --version", {stdio: "pipe", env});
        log("✅ Ollama installed");
        return true;
    } catch (e) {
        log("❌ Ollama not installed — auto-installing...");

        try {
            log("▸ Running brew install ollama...");
            execSync("brew install ollama", {stdio: "inherit", env});
            log("✅ Ollama installed successfully");
            return true;
        } catch (installErr) {
            log(`❌ Ollama auto-install failed: ${installErr.message}`);
            log("💡 Manual install: https://ollama.ai/download");

            const {dialog} = require("electron");
            dialog.showMessageBox({
                type: "warning",
                title: "Ollama Installation Failed",
                message: "Failed to auto-install Ollama.",
                detail: "Only cloud models (OpenAI, Gemini, Claude) will be available.\n\nTo use local models, install manually from https://ollama.ai/download",
                buttons: ["OK"]
            });
            return false;
        }
    }
}

// ── Elasticsearch 설치 확인 및 자동 실행 ───
function checkAndStartElasticsearch() {
    log("▸ Checking Elasticsearch...");
    const env = getDockerEnv();

    try {
        // ES 컨테이너 존재 여부 확인
        const containers = execSync(
            "docker ps -a --filter name=elasticsearch --format '{{.Names}}'",
            {encoding: "utf-8", env}
        ).trim();

        if (containers.includes("elasticsearch")) {
            // 실행 상태 확인
            const running = execSync(
                "docker ps --filter name=elasticsearch --format '{{.Names}}'",
                {encoding: "utf-8", env}
            ).trim();

            if (running.includes("elasticsearch")) {
                log("✅ Elasticsearch is running");
                return true;
            } else {
                log("▸ Starting Elasticsearch...");
                execSync("docker start elasticsearch", {stdio: "inherit", env});
                log("✅ Elasticsearch started");
                return true;
            }
        } else {
            // 컨테이너 없음 — setup wizard에서 설치하므로 여기서는 건너뜀
            log("ℹ️ Elasticsearch not installed — will be configured in setup wizard");
            return false;
        }
    } catch (e) {
        log(`⚠️ Elasticsearch check failed: ${e.message}`);
        return false;
    }
}

// ── 모든 의존성 확인 ───────────────────────
function checkAllDependencies() {
    log("========================================");
    log("Checking dependencies");
    log("========================================");

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

    return true; // Docker는 선택 사항 — 네이티브 ES로 대체 가능
}

// ── 서버 시작 ─────────────────────────────
function runCommand(command, args, options = {}) {
    const {onOutput, ...spawnOptions} = options;
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {stdio: ["ignore", "pipe", "pipe"], ...spawnOptions});
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

    const python = VENV_PYTHON;

    // ── venv 및 서버 필수 패키지 준비 ─────────────────────────
    // 서버는 setup 화면을 제공하기 전부터 FastAPI/uvicorn이 필요하므로,
    // requirements 설치는 이 단계에서 한 번만 수행한다.
    const uvicornCheck = path.join(VENV_DIR, "lib", "python3.12", "site-packages", "uvicorn");
    const hasUvicorn = fs.existsSync(uvicornCheck);
    if (!fs.existsSync(python) || !hasUvicorn) {
        log("▸ Creating virtual environment (venv)");

        try {
            const pythonBin = resolvePython();
            if (!pythonBin) {
                throw new Error("Python 3.12 is required");
            }
            log(`👉 Using python: ${pythonBin}`);

            execSync(`"${pythonBin}" -m venv "${VENV_DIR}"`);

            log("▸ Installing packages from requirements.txt...");
            sendLoadingStatus(getStartupTranslation().pythonPackagesInstalling);

            // 1. pip 자체 업그레이드 (권장)
            await runCommand(python, ["-m", "pip", "install", "--upgrade", "pip", "--quiet"]);

            // 2. requirements.txt 경로 설정
            const reqPath = path.join(serverAppDir, "requirements.txt");

            if (fs.existsSync(reqPath)) {
                await runCommand(python, ["-m", "pip", "install", "-r", reqPath], {onOutput: createRequirementsProgressReporter(reqPath)});
                // 해시 저장 (이후 변경 감지용)
                const crypto = require("crypto");
                const hash = crypto.createHash("md5").update(fs.readFileSync(reqPath)).digest("hex");
                fs.writeFileSync(path.join(INSTALL_DIR, ".req_hash"), hash);
                log("✅ requirements.txt installed");
            } else {
                log("⚠️ requirements.txt not found — installing base packages");
                await runCommand(python, ["-m", "pip", "install", "fastapi", "uvicorn", "aiofiles", "pydantic", "httpx", "elasticsearch", "playwright", "bs4", "--quiet"]);
            }

            log("✅ venv setup complete");

        } catch (err) {
            log(`❌ venv creation or package install failed: ${err.message}`);
        }
    } else {
        // ── venv 존재 시 requirements.txt 변경 감지 → 패키지 동기화 ──
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
                    await runCommand(python, ["-m", "pip", "install", "-r", reqPath], {onOutput: createRequirementsProgressReporter(reqPath)});
                    fs.writeFileSync(reqHashFile, currentHash);
                    log("✅ Package sync complete");
                } catch (err) {
                    log(`⚠️ Package sync failed: ${err.message}`);
                }
            }
        }
    }

    // ── 실행 환경 ─────────────────────────
    const env = {
        ...process.env,
        PATH: [
            path.join(VENV_DIR, "bin"),
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin",
            process.env.PATH || ""
        ].join(":"),
        PYTHONPATH: serverAppDir,
        PYTHONUNBUFFERED: "1",
        // 설치된 앱 번들은 읽기 전용일 수 있으므로 __pycache__를 만들지 않는다.
        PYTHONDONTWRITEBYTECODE: "1",
        VYACT_SYSTEM_LANGUAGE: app.getLocale(),
    };

    const finalPython = fs.existsSync(python) ? python : "python3";
    log(`🚀 Starting server: ${finalPython}`);

    serverProc = spawn(finalPython, ["-u", "main.py"], {
        cwd: serverAppDir,
        env,
        stdio: ["ignore", "pipe", "pipe"],
    });

    // 파이썬 서버는 이미 자체 FileHandler로 같은 로그 파일에 직접 기록한다.
    // 여기서 stdout/stderr를 받아 같은 파일에 또 appendFileSync 하면 모든 로그가
    // 두 번씩 쌓인다(PID까지 동일하게 중복). 그래서 파일에는 쓰지 않고,
    // 디버깅용으로 Electron 콘솔에만 흘려보낸다.
    const forwardServerOutput = (data, isError = false) => {
        for (const line of data.toString().split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
            if (isError) console.error(`[server:err] ${line}`);
            else console.log(`[server] ${line}`);
            // Python의 초기화 로그는 자체 파일에도 기록되므로, 파일 중복 없이
            // 로딩 화면에만 전달한다.
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

// ── 서버 준비 대기 ─────────────────────────
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
            const req = http.get(`http://localhost:${SERVER_PORT}/api/setup/status`, res => {
                if (res.statusCode === 200) {
                    resolve();
                } else {
                    retry();
                }
            });
            req.on("error", () => {
                retry();
            });
        };
        check();
    });
}

// ── 창 생성 ───────────────────────────────
function createWindow() {
    log("▸ Creating Electron window");

    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        backgroundColor: "#0f1117",
        titleBarStyle: "hiddenInset",
        trafficLightPosition: { x: 12, y: 12 },
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration: false,
            webSecurity: false,                  // 외부 API 요청 허용 (Web Speech API)
            allowRunningInsecureContent: true,
            experimentalFeatures: true,          // Web Speech API 활성화
            spellcheck: false,
        },
        show: true,
    });
    mainWindow.maximize();

    // 전체화면 상태 변경 → 렌더러 알림
    mainWindow.on("enter-full-screen", () => mainWindow?.webContents.send("window-fullscreen-change", true));
    mainWindow.on("leave-full-screen", () => mainWindow?.webContents.send("window-fullscreen-change", false));

    // 마이크 + Web Speech API 네트워크 요청 권한 허용
    session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
        const allowed = ["media", "microphone", "camera", "notifications", "mediaKeySystem", "fullscreen"];
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
            // 동기식 pip/brew 작업 중에도 첫 화면과 진행 로그가 즉시 보인다.
            mainWindow.webContents.once("did-finish-load", resolve);
        };

        if (fs.existsSync(loadingPath)) {
            // venv가 이미 있으면 = 예전에 설치가 끝난 상태(재실행) → 간단한 화면만.
            // venv가 없으면 = 최초 설치 → 상세 로그를 보여줘서 뭘 하고 있는지 알 수 있게 한다.
            const isFirstRun = !fs.existsSync(VENV_PYTHON);
            finishLoading();
            mainWindow.loadFile(loadingPath, {query: {firstRun: isFirstRun ? "1" : "0"}});
        } else {
            resolve();
        }
    });

    // target="_blank" 링크 → 시스템 브라우저로 열기
    mainWindow.webContents.setWindowOpenHandler(({url}) => {
        if (url.startsWith("http://") || url.startsWith("https://")) {
            require("electron").shell.openExternal(url);
        }
        return {action: "deny"};
    });

    // YouTube iframe 풀스크린 지원
    let cursorHideTimer = null;
    mainWindow.webContents.on("enter-html-full-screen", () => {
        mainWindow.setFullScreen(true);
        // 마우스 움직임 감지해서 커서 숨김/표시
        const { screen } = require("electron");
        let lastPos = screen.getCursorScreenPoint();
        const checkCursor = () => {
            const pos = screen.getCursorScreenPoint();
            if (pos.x !== lastPos.x || pos.y !== lastPos.y) {
                lastPos = pos;
                mainWindow.webContents.executeJavaScript(`document.documentElement.style.cursor = 'default';`);
                clearTimeout(cursorHideTimer);
                cursorHideTimer = setTimeout(() => {
                    mainWindow.webContents.executeJavaScript(`document.documentElement.style.cursor = 'none';`);
                }, 3000);
            }
        };
        cursorHideTimer = setTimeout(() => {
            mainWindow.webContents.executeJavaScript(`document.documentElement.style.cursor = 'none';`);
        }, 3000);
        mainWindow._cursorInterval = setInterval(checkCursor, 100);
    });
    mainWindow.webContents.on("leave-html-full-screen", () => {
        mainWindow.setFullScreen(false);
        clearTimeout(cursorHideTimer);
        clearInterval(mainWindow._cursorInterval);
        mainWindow.webContents.executeJavaScript(`document.documentElement.style.cursor = '';`);
    });

    // 혹시 내부 navigate 시도 시에도 차단 (로컬호스트 제외)
    mainWindow.webContents.on("will-navigate", (e, url) => {
        if (!url.startsWith(`http://localhost`) && !url.startsWith(`http://127.0.0.1`)) {
            e.preventDefault();
            require("electron").shell.openExternal(url);
        }
    });

    return loadingReady;
}

// waitForServer 완료 후 실제 앱 화면으로 전환. createWindow()에서 분리한 이유:
// 의존성 확인/서버 기동이 끝나기 전부터 폴링을 시작하면 retry 예산을 헛되이 소모하므로,
// checkAllDependencies()+startServer()가 끝난 뒤에 호출한다 (app.whenReady()에서 순서 제어).
function waitForServerAndLoad() {
    waitForServer()
        .then(() => {
            log("✅ Server ready");
            loadServerApp();
        })
        .catch(err => {
            log(`❌ Server failed: ${err.message}`);
            // data: URL 은 charset 이슈로 한글이 깨지므로 error.html 파일을 로드한다.
            const errorPath = path.join(__dirname, "error.html");
            if (fs.existsSync(errorPath)) {
                mainWindow.loadFile(errorPath, {query: {msg: err.message}});
            } else {
                mainWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(`<meta charset="utf-8"><h1>Server Failed</h1><p>${err.message}</p>`));
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
        if (url.startsWith("http://") || url.startsWith("https://")) require("electron").shell.openExternal(url);
        return {action: "deny"};
    });
    setupView.webContents.on("will-navigate", (event, url) => {
        if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1")) {
            event.preventDefault();
            require("electron").shell.openExternal(url);
        }
    });

    const rendererReady = waitForRendererReady(setupView);
    await setupView.webContents.loadURL(`http://localhost:${SERVER_PORT}?initialSetup=1`);
    await rendererReady;

    if (!mainWindow || mainWindow.isDestroyed()) return;

    // Attach only after React has painted SetupPage.  This keeps the progress
    // screen visible right up to the first fully rendered setup frame.
    initialSetupView = setupView;
    mainWindow.setBrowserView(setupView);
    resizeInitialSetupView();
    // BrowserView auto-resize can briefly collapse during unmaximize on macOS.
    // Keep its bounds in sync explicitly so loading.html cannot become visible.
    mainWindow.on("resize", resizeInitialSetupView);
    mainWindow.on("enter-full-screen", () => {
        resizeInitialSetupView();
        setupView.webContents.send("window-fullscreen-change", true);
    });
    mainWindow.on("leave-full-screen", () => {
        resizeInitialSetupView();
        setupView.webContents.send("window-fullscreen-change", false);
    });
}

// ── 앱 생명주기 ───────────────────────────
// Web Speech API 활성화를 위한 크롬 플래그
app.commandLine.appendSwitch("enable-features", "WebRtcHideLocalIpsWithMdns");
app.commandLine.appendSwitch("disable-features", "WebRtcAllowInputVolumeAdjustment");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");  // 권한 팝업 없이 허용
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
    log("✅ App started");

    const startupDelayMs = app.getLoginItemSettings().wasOpenedAtLogin
        ? AUTO_START_DELAY_SECONDS * 1000
        : 0;

    // 1. 창부터 먼저 띄운다(loading.html) — 이래야 이어지는 의존성 확인/서버 기동 로그가
    //    실시간으로 화면에 표시된다. (예전엔 창 생성 전에 의존성 확인을 끝내버려서
    //    그 단계의 진행 상황을 사용자가 전혀 볼 수 없었다.)
    setTimeout(() => createWindow().then(() => {
        // 로딩 화면이 한 번 그려진 다음에만 동기식 설치 작업을 시작한다.
        setTimeout(async () => {
            const depsOk = checkAllDependencies();

            if (!depsOk) {
                log("❌ Required dependencies not met — exiting");
                const errorPath = path.join(__dirname, "error.html");
                if (mainWindow && !mainWindow.isDestroyed() && fs.existsSync(errorPath)) {
                    mainWindow.loadFile(errorPath, {
                        query: {title: "Dependency Installation Failed", msg: "Required dependencies could not be installed. Please check logs and restart the app."},
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
            await fetch("http://localhost:8000/api/shutdown", {method: "POST"})
                .catch(() => {
                });
        } catch (_) {
        }
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (!serverProc.killed) serverProc.kill("SIGKILL");
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

ipcMain.handle("get-log-path", () => getLogFile());

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

// ── 부팅 시 자동 시작 설정 ──────────────────────────────────────────────────
ipcMain.handle("get-login-item", () => {
    return app.getLoginItemSettings().openAtLogin;
});

ipcMain.handle("set-login-item", (_, enable) => {
    // 이전 버전이 만든 지연 LaunchAgent를 정리하고 macOS Login Item을 사용한다.
    setDelayedLoginItem(false);
    app.setLoginItemSettings({openAtLogin: enable, openAsHidden: true});
    return app.getLoginItemSettings().openAtLogin;
});

// 스크린샷 — 현재 앱의 웹 콘텐츠만 캡처한다.
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

    if (mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
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
