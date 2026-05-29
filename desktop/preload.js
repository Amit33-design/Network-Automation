"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("netdesign", {
    env: {
        read:  ()           => ipcRenderer.invoke("env:read"),
        write: (key, value) => ipcRenderer.invoke("env:write", key, value),
    },
    services: {
        start:  () => ipcRenderer.invoke("services:start"),
        stop:   () => ipcRenderer.invoke("services:stop"),
        status: () => ipcRenderer.invoke("services:status"),
    },
    app: {
        openDataDir: () => ipcRenderer.invoke("app:openDataDir"),
        openLogFile: () => ipcRenderer.invoke("app:openLogFile"),
    },
    docker: {
        available: () => ipcRenderer.invoke("docker:available"),
    },
});
