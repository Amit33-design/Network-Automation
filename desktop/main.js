"use strict";

const { app, BrowserWindow, Tray, Menu, shell, ipcMain, nativeImage, dialog } = require("electron");
const path    = require("path");
const fs      = require("fs");
const os      = require("os");
const { execSync, spawn } = require("child_process");

// ── Paths ──────────────────────────────────────────────────────────────────────
const DATA_DIR      = path.join(app.getPath("userData"), "netdesign");
const COMPOSE_FILE  = path.join(DATA_DIR, "docker-compose.yml");
const ENV_FILE      = path.join(DATA_DIR, ".env");
const LOG_FILE      = path.join(DATA_DIR, "app.log");

const RESOURCE_COMPOSE = path.join(process.resourcesPath, "docker-compose.yml");
const RESOURCE_ENV_EX  = path.join(process.resourcesPath, ".env.example");

// In dev mode, resolve relative to repo root
const DEV = process.env.NODE_ENV === "development";
const DEV_COMPOSE = DEV ? path.join(__dirname, "..", "docker-compose.dist.yml") : null;
const DEV_ENV_EX  = DEV ? path.join(__dirname, "..", ".env.example")            : null;

const WEB_URL   = "http://localhost:8080";
const SETUP_URL = `file://${path.join(__dirname, "renderer", "setup.html")}`;

let mainWindow = null;
let tray       = null;
let servicesUp = false;
let composeProc = null;

// ── Logging ────────────────────────────────────────────────────────────────────
fs.mkdirSync(DATA_DIR, { recursive: true });
const logStream = fs.createWriteStream(LOG_FILE, { flags: "a" });
function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    logStream.write(line + "\n");
}

// ── Docker helpers ─────────────────────────────────────────────────────────────
function dockerAvailable() {
    try { execSync("docker info", { stdio: "ignore", timeout: 5000 }); return true; }
    catch { return false; }
}

function composeCmd() {
    try { execSync("docker compose version", { stdio: "ignore" }); return ["docker", "compose"]; }
    catch { return ["docker-compose"]; }
}

function ensureFiles() {
    if (!fs.existsSync(COMPOSE_FILE)) {
        const src = DEV ? DEV_COMPOSE : RESOURCE_COMPOSE;
        fs.copyFileSync(src, COMPOSE_FILE);
        log("Copied docker-compose.yml to " + COMPOSE_FILE);
    }
    if (!fs.existsSync(ENV_FILE)) {
        const src = DEV ? DEV_ENV_EX : RESOURCE_ENV_EX;
        fs.copyFileSync(src, ENV_FILE);
        log("Copied .env.example to " + ENV_FILE);
    }
}

function startServices() {
    log("Starting Docker services...");
    const [bin, ...args] = composeCmd();
    composeProc = spawn(bin, [...args, "-f", COMPOSE_FILE, "--env-file", ENV_FILE, "up", "-d"], {
        stdio: ["ignore", "pipe", "pipe"],
    });
    composeProc.stdout.on("data", d => log("[compose] " + d.toString().trim()));
    composeProc.stderr.on("data", d => log("[compose-err] " + d.toString().trim()));
    composeProc.on("close", code => {
        log("docker compose up exited with code " + code);
        if (code === 0) {
            servicesUp = true;
            updateTray();
            waitForUI();
        } else {
            dialog.showErrorBox("NetDesign AI", "Failed to start services. Check the log at:\n" + LOG_FILE);
        }
    });
}

function stopServices() {
    log("Stopping Docker services...");
    const [bin, ...args] = composeCmd();
    execSync([bin, ...args, "-f", COMPOSE_FILE, "--env-file", ENV_FILE, "down"].join(" "), { stdio: "inherit" });
    servicesUp = false;
    updateTray();
    log("Services stopped.");
}

// ── Wait for web UI ────────────────────────────────────────────────────────────
function waitForUI(attempt = 0) {
    const http = require("http");
    http.get(WEB_URL, res => {
        if (res.statusCode < 500) {
            log("UI reachable — loading in window");
            if (mainWindow) mainWindow.loadURL(WEB_URL);
        } else {
            retry(attempt);
        }
    }).on("error", () => retry(attempt));
}

function retry(attempt) {
    if (attempt > 30) { log("UI never became ready"); return; }
    setTimeout(() => waitForUI(attempt + 1), 2000);
}

// ── Env helpers (sent to renderer) ────────────────────────────────────────────
function readEnv() {
    if (!fs.existsSync(ENV_FILE)) return {};
    const out = {};
    fs.readFileSync(ENV_FILE, "utf8").split("\n").forEach(line => {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m) out[m[1]] = m[2];
    });
    return out;
}

function writeEnvKey(key, value) {
    let content = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
    const re = new RegExp(`^${key}=.*$`, "m");
    if (re.test(content)) {
        content = content.replace(re, `${key}=${value}`);
    } else {
        content += `\n${key}=${value}`;
    }
    fs.writeFileSync(ENV_FILE, content);
}

// ── IPC handlers ───────────────────────────────────────────────────────────────
ipcMain.handle("env:read",  ()            => readEnv());
ipcMain.handle("env:write", (_, key, val) => { writeEnvKey(key, val); });
ipcMain.handle("services:start",  ()      => startServices());
ipcMain.handle("services:stop",   ()      => stopServices());
ipcMain.handle("services:status", ()      => servicesUp);
ipcMain.handle("app:openDataDir", ()      => shell.openPath(DATA_DIR));
ipcMain.handle("app:openLogFile", ()      => shell.openPath(LOG_FILE));
ipcMain.handle("docker:available", ()     => dockerAvailable());

// ── Tray ───────────────────────────────────────────────────────────────────────
function buildTrayMenu() {
    return Menu.buildFromTemplate([
        { label: "NetDesign AI", enabled: false },
        { type: "separator" },
        { label: servicesUp ? "● Running" : "○ Stopped", enabled: false },
        { type: "separator" },
        { label: "Open UI",       click: () => { if (mainWindow) mainWindow.show(); } },
        { label: "Start Services", enabled: !servicesUp, click: startServices },
        { label: "Stop Services",  enabled:  servicesUp, click: stopServices },
        { type: "separator" },
        { label: "Open data folder", click: () => shell.openPath(DATA_DIR) },
        { label: "View logs",        click: () => shell.openPath(LOG_FILE) },
        { type: "separator" },
        { label: "Quit", click: () => { stopServices(); app.quit(); } },
    ]);
}

function updateTray() {
    if (tray) tray.setContextMenu(buildTrayMenu());
}

function createTray() {
    const iconPath = path.join(__dirname, "assets", "tray-icon.png");
    const icon = fs.existsSync(iconPath)
        ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
        : nativeImage.createEmpty();
    tray = new Tray(icon);
    tray.setToolTip("NetDesign AI");
    tray.setContextMenu(buildTrayMenu());
    tray.on("double-click", () => { if (mainWindow) mainWindow.show(); });
}

// ── Main window ────────────────────────────────────────────────────────────────
function createMainWindow() {
    mainWindow = new BrowserWindow({
        width:           1280,
        height:          800,
        minWidth:        900,
        minHeight:       600,
        title:           "NetDesign AI",
        backgroundColor: "#0f172a",
        webPreferences: {
            preload:          path.join(__dirname, "preload.js"),
            contextIsolation: true,
            nodeIntegration:  false,
        },
    });

    mainWindow.on("close", e => {
        e.preventDefault();
        mainWindow.hide();  // keep running in tray
    });

    // Load setup page first; waitForUI() will redirect once backend is ready
    mainWindow.loadURL(SETUP_URL);
    mainWindow.webContents.on("did-fail-load", () => mainWindow.loadURL(SETUP_URL));
}

// ── App lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
    log("NetDesign AI desktop starting — data dir: " + DATA_DIR);
    createTray();
    createMainWindow();

    ensureFiles();

    if (!dockerAvailable()) {
        dialog.showMessageBox(mainWindow, {
            type:    "warning",
            title:   "Docker not running",
            message: "Docker Desktop is not running.\n\nStart Docker Desktop, then use the tray icon to start services.",
            buttons: ["OK"],
        });
        return;
    }

    // Auto-start if .env is already configured (not first run)
    const env = readEnv();
    const configured = env.ADMIN_PASS && env.ADMIN_PASS !== "change_me_admin_password_here";
    if (configured) {
        startServices();
    }
});

app.on("window-all-closed", () => {
    // Keep app running in tray (do not quit)
});

app.on("before-quit", () => {
    if (servicesUp) {
        try { stopServices(); } catch {}
    }
});

app.on("activate", () => {
    if (mainWindow) mainWindow.show();
});
