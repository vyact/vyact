const {contextBridge, ipcRenderer} = require("electron");

// 렌더러에서 사용할 수 있는 시스템 API 브릿지
// 추후 음성인식, 시스템 자동화 등 여기서 확장
contextBridge.exposeInMainWorld("ragAPI", {
    openExternal: (url) => ipcRenderer.invoke("open-external", url),
    showNotification: (opts) => ipcRenderer.invoke("show-notification", opts),
    getLogPath: () => ipcRenderer.invoke("get-log-path"),
    screenshot: () => ipcRenderer.invoke("screenshot"),
    setWindowAspectRatio: (aspectRatio) => ipcRenderer.invoke("window-set-aspect-ratio", aspectRatio),
    getLoginItem: () => ipcRenderer.invoke("get-login-item"),
    setLoginItem: (enable) => ipcRenderer.invoke("set-login-item", enable),
    selectFolder: () => ipcRenderer.invoke("select-folder"),
    selectFolders: () => ipcRenderer.invoke("select-folders"),
    browserOpen: (url) => ipcRenderer.invoke("browser-open", url),
    browserClose: () => ipcRenderer.invoke("browser-close"),
    browserNavigate: (url) => ipcRenderer.invoke("browser-navigate", url),
    browserBack: () => ipcRenderer.invoke("browser-back"),
    browserForward: () => ipcRenderer.invoke("browser-forward"),
    browserReload: () => ipcRenderer.invoke("browser-reload"),
    browserSetBounds: (bounds) => ipcRenderer.invoke("browser-set-bounds", bounds),
    onBrowserState: (callback) => {
        const handler = (_event, state) => callback(state);
        ipcRenderer.on("browser-state", handler);
        return () => ipcRenderer.removeListener("browser-state", handler);
    },
    notifyAppReady: () => ipcRenderer.send("app-ready"),
    // loading.html 전용 — 메인 프로세스(main.js)의 log()가 보내는 진행 상황 문자열을 구독.
    // (loading.html은 contextIsolation:true라 ipcRenderer를 직접 못 쓰므로 이 브릿지를 통해서만 받는다)
    onLoadingLog: (callback) => {
        const handler = (_event, msg) => callback(msg);
        ipcRenderer.on("loading-log", handler);
        return () => ipcRenderer.removeListener("loading-log", handler);
    },
    onLoadingStatus: (callback) => {
        const handler = (_event, message) => callback(message);
        ipcRenderer.on("loading-status", handler);
        return () => ipcRenderer.removeListener("loading-status", handler);
    },
    platform: process.platform,
    version: process.versions.electron,
    onFullscreenChange: (callback) => {
        const handler = (_event, isFull) => callback(_event, isFull);
        ipcRenderer.on("window-fullscreen-change", handler);
        return () => ipcRenderer.removeListener("window-fullscreen-change", handler);
    },
});
