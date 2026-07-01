const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const settingsStore = require('./settingsStore');
const activityDetector = require('./activityDetector');
const windowDetector = require('./windowDetector');
const sessionManager = require('./sessionManager');
const captureEngine = require('./captureEngine');
const timelapseGenerator = require('./timelapseGenerator');

let mainWindow = null;
let tray = null;
let isQuitting = false;

function createMainWindow() {
    mainWindow = new BrowserWindow({
        width: 1000,
        height: 700,
        minWidth: 800,
        minHeight: 600,
        frame: false, // Frameless window for ultra-modern look
        titleBarStyle: 'hidden',
        backgroundColor: '#04040f',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false, // Simple node access in renderer for this app
            devTools: true
        }
    });

    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

    // Redirect console messages from renderer to terminal stdout
    mainWindow.webContents.on('console-message', (event, level, message, line, sourceId) => {
        console.log(`[Renderer Console] ${message} (line ${line} in ${path.basename(sourceId)})`);
    });

    // Handle close event to minimize to tray if configured
    mainWindow.on('close', (e) => {
        if (!isQuitting && settingsStore.get('minimizeToTray')) {
            e.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

process.on('uncaughtException', (err) => {
    console.error('[Main Process Uncaught Exception]:', err);
});

function createTray() {
    try {
        const { nativeImage } = require('electron');
        // Valid 16x16 red dot PNG base64
        const dummyPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAn0lEQVR42mNkQAIuxkEGcQwiGEYGoIFD9T3c62CgA9tA1jG41/3+e81mYGD4B8VgDkEM3Gtg6kAYbACeWw2uG7ABaG7lXYNLH9wAsICDcx2UjC8A0t3OuwanNrwBYAGHZx2UjC8AiX/4/597HUxteAPAAs45UG6G0r0OaACew/8518HUhk8A2EAmOFAavgCke/k/5zqY2vACALgH0R5hW3qNAAAAAElFTkSuQmCC';
        const trayIcon = nativeImage.createFromBuffer(Buffer.from(dummyPngBase64, 'base64'));
        tray = new Tray(trayIcon);
        const contextMenu = Menu.buildFromTemplate([
            { label: 'Open Screenie', click: () => mainWindow.show() },
            { type: 'separator' },
            { 
                label: 'Start Recording', 
                id: 'tray-toggle',
                click: () => {
                    const state = captureEngine.getState();
                    if (state.isRecording) {
                        if (state.isPaused) {
                            captureEngine.resume();
                        } else {
                            captureEngine.pause();
                        }
                    } else {
                        captureEngine.start();
                    }
                } 
            },
            { type: 'separator' },
            { 
                label: 'Quit', 
                click: () => {
                    isQuitting = true;
                    captureEngine.stop();
                    app.quit();
                } 
            }
        ]);
        
        tray.setToolTip('Screenie - Screenshot Timelapse');
        tray.setContextMenu(contextMenu);
        
        // Double click tray icon to restore window
        tray.on('double-click', () => {
            mainWindow.show();
        });
    } catch (e) {
        console.error('Failed to create system tray:', e);
    }
}

// Watch status and update tray menu label dynamically
captureEngine.setEventCallback((event, data) => {
    if (mainWindow) {
        mainWindow.webContents.send(event, data);
    }
    
    // Update tray menu label based on recording status
    if (tray) {
        const toggleItem = tray.menu && tray.menu.items.find(item => item.id === 'tray-toggle');
        if (toggleItem) {
            if (data.isRecording) {
                toggleItem.label = data.isPaused ? 'Resume Recording' : 'Pause Recording';
            } else {
                toggleItem.label = 'Start Recording';
            }
        }
    }
});

// App Lifecycle
app.whenReady().then(() => {
    createMainWindow();
    createTray();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createMainWindow();
        } else if (mainWindow) {
            mainWindow.show();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('before-quit', () => {
    isQuitting = true;
    captureEngine.stop();
});

// --- IPC Handlers ---

// Window Controls
ipcMain.on('window-minimize', () => {
    if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) {
        if (settingsStore.get('minimizeToTray')) {
            mainWindow.hide();
        } else {
            mainWindow.close();
        }
    }
});

// Settings IPC
ipcMain.handle('settings-get', (event, key) => {
    try {
        return settingsStore.get(key);
    } catch (e) {
        console.error('Error in settings-get IPC:', e);
        throw e;
    }
});

ipcMain.handle('settings-set', (event, key, value) => {
    try {
        return settingsStore.set(key, value);
    } catch (e) {
        console.error('Error in settings-set IPC:', e);
        throw e;
    }
});

ipcMain.handle('settings-reset', () => {
    try {
        return settingsStore.reset();
    } catch (e) {
        console.error('Error in settings-reset IPC:', e);
        throw e;
    }
});

// Recording Control IPC
ipcMain.handle('recording-start', (event, resumeSessionId = null) => {
    try {
        captureEngine.start(resumeSessionId);
        return captureEngine.getState();
    } catch (e) {
        console.error('Error in recording-start IPC:', e);
        throw e;
    }
});

ipcMain.handle('recording-pause', () => {
    try {
        captureEngine.pause();
        return captureEngine.getState();
    } catch (e) {
        console.error('Error in recording-pause IPC:', e);
        throw e;
    }
});

ipcMain.handle('recording-resume', () => {
    try {
        captureEngine.resume();
        return captureEngine.getState();
    } catch (e) {
        console.error('Error in recording-resume IPC:', e);
        throw e;
    }
});

ipcMain.handle('recording-stop', () => {
    try {
        captureEngine.stop();
        return captureEngine.getState();
    } catch (e) {
        console.error('Error in recording-stop IPC:', e);
        throw e;
    }
});

ipcMain.handle('recording-get-status', () => {
    try {
        captureEngine.emitStatus();
        return captureEngine.getState();
    } catch (e) {
        console.error('Error in recording-get-status IPC:', e);
        return {
            isRecording: false,
            isPaused: false,
            lastStatus: 'Error getting status: ' + e.message,
            countdown: 0,
            activeWindow: null,
            frameCount: 0,
            sessionId: null
        };
    }
});

// Session IPC
ipcMain.handle('sessions-get-all', () => {
    return sessionManager.getSessions();
});

ipcMain.handle('session-get-details', (event, sessionId) => {
    return sessionManager.getSessionDetails(sessionId);
});

ipcMain.handle('session-delete', (event, sessionId) => {
    return sessionManager.deleteSession(sessionId);
});

// Timelapse IPC
ipcMain.handle('timelapse-generate', async (event, sessionId, fps) => {
    try {
        const finalPath = await timelapseGenerator.generateTimelapse(sessionId, null, {
            fps,
            progressCb: (percent) => {
                if (mainWindow) {
                    mainWindow.webContents.send('timelapse-progress', { sessionId, percent });
                }
            }
        });
        return { success: true, path: finalPath };
    } catch (e) {
        console.error('Timelapse generation failed IPC:', e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('timelapse-export', async (event, sessionId) => {
    const session = sessionManager.getSessionDetails(sessionId);
    if (!session) return { success: false, error: 'Session not found' };

    const defaultTimelapsePath = path.join(session.path, 'timelapse.mp4');
    if (!fs.existsSync(defaultTimelapsePath)) {
        return { success: false, error: 'Timelapse file does not exist yet. Render it first.' };
    }

    const { filePath } = await dialog.showSaveDialog(mainWindow, {
        title: 'Export Timelapse',
        defaultPath: `timelapse_${sessionId}.mp4`,
        filters: [{ name: 'Movies', extensions: ['mp4'] }]
    });

    if (filePath) {
        try {
            fs.copyFileSync(defaultTimelapsePath, filePath);
            return { success: true, path: filePath };
        } catch (e) {
            console.error('Export failed:', e);
            return { success: false, error: e.message };
        }
    }
    return { success: false, cancelled: true };
});

// Dialog directory selection
ipcMain.handle('storage-select-directory', async () => {
    const { filePaths } = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        title: 'Select Session Storage Folder'
    });
    if (filePaths && filePaths.length > 0) {
        return filePaths[0];
    }
    return null;
});

ipcMain.handle('apps-get-running', () => {
    try {
        if (!windowDetector.isSupported()) return [];
        const visibleWins = windowDetector.getVisibleWindows();
        // Extract unique, sorted process names
        const appNames = [...new Set(visibleWins.map(w => w.appName))].sort((a, b) => a.localeCompare(b));
        return appNames;
    } catch (e) {
        console.error('Failed to get running apps from FFI:', e);
        return [];
    }
});
