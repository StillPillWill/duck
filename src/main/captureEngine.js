const { desktopCapturer, nativeImage, screen } = require('electron');
const activityDetector = require('./activityDetector');
const windowHelper = require('./windowDetector');
const sessionManager = require('./sessionManager');
const settingsStore = require('./settingsStore');
const fs = require('fs');
const path = require('path');

function logDebug(msg) {
    try {
        const storagePath = settingsStore.get('storagePath');
        if (!storagePath) return;
        const logPath = path.join(storagePath, '..', 'debug.log');
        const timestamp = new Date().toISOString();
        fs.appendFileSync(logPath, `[${timestamp}] ${msg}\n`, 'utf8');
    } catch (e) {
        console.error('Failed to write debug log:', e);
    }
}

let captureIntervalId = null;
let isRecording = false;
let isPaused = false;
let lastCaptureTime = 0;
let lastStatus = 'Idle';
let countdown = 0;
let countdownIntervalId = null;
let eventCallback = null;
let lastFrameBase64 = null;

function setEventCallback(cb) {
    eventCallback = cb;
}

function emitStatus() {
    if (eventCallback) {
        const activeWin = windowHelper.getActiveWindow();
        const currentSession = sessionManager.getCurrentSession();
        
        eventCallback('capture-status-update', {
            isRecording,
            isPaused,
            lastStatus,
            countdown,
            activeWindow: activeWin ? { appName: activeWin.appName, title: activeWin.title } : null,
            frameCount: currentSession ? currentSession.frameCount : 0,
            sessionId: currentSession ? currentSession.id : null,
            lastFramePreview: lastFrameBase64
        });
    }
}

async function captureScreen() {
    try {
        const allowlistEnabled = settingsStore.get('allowlistEnabled');
        const allowlist = settingsStore.get('allowlist') || [];
        
        const quality = settingsStore.get('quality');
        const scaleMap = { 'low': 0.5, 'medium': 0.75, 'high': 1.0 };
        const scale = scaleMap[quality] || 0.75;

        let img = null;
        let capturedApp = 'Screen';
        let capturedTitle = 'Primary Display';

        if (allowlistEnabled && allowlist.length > 0) {
            const filterMode = settingsStore.get('filterMode') || 'allowlist';
            logDebug(`Filter mode: ${filterMode}. List: [${allowlist.join(', ')}]`);
            
            // 1. Get all visible windows from Win32 FFI
            const allWindows = windowHelper.getVisibleWindows();
            logDebug(`Visible windows found: ${allWindows.length}`);
            allWindows.forEach(w => {
                logDebug(`  - HWND: ${w.hwnd} | App: ${w.appName} | Title: "${w.title}" | Rect: ${JSON.stringify(w.rect)}`);
            });
            
            // 2. Filter by mode
            let targetWindows;
            if (filterMode === 'blocklist') {
                // Blocklist: keep everything EXCEPT the listed apps
                targetWindows = allWindows.filter(w =>
                    !allowlist.some(a => a.toLowerCase() === w.appName.toLowerCase())
                );
                logDebug(`Blocklist filter: ${targetWindows.length} windows remaining after excluding [${allowlist.join(', ')}].`);
            } else {
                // Allowlist: keep only the listed apps
                targetWindows = allWindows.filter(w =>
                    allowlist.some(a => a.toLowerCase() === w.appName.toLowerCase())
                );
                logDebug(`Allowlist filter: ${targetWindows.length} matching windows found.`);
            }

            if (targetWindows.length === 0) {
                logDebug('No matching windows found after filtering.');
                throw new Error(filterMode === 'blocklist'
                    ? 'All visible windows are blocked by the filter list.'
                    : 'No allowlisted apps are currently running/visible.');
            }

            // 3. Select the best window: focused/active or topmost visible
            const activeWin = windowHelper.getActiveWindow();
            let selectedWin = null;
            
            if (activeWin) {
                logDebug(`Active Window in OS: HWND=${activeWin.hwnd || 'N/A'} | App=${activeWin.appName} | Title="${activeWin.title}"`);
                selectedWin = targetWindows.find(w => w.hwnd === activeWin.hwnd || (w.pid === activeWin.pid && w.appName === activeWin.appName));
            }
            
            if (selectedWin) {
                logDebug(`Selected active window for capture: HWND=${selectedWin.hwnd} (${selectedWin.appName})`);
            } else {
                selectedWin = targetWindows[0]; // Topmost window in z-order
                logDebug(`Active window is not allowlisted or HWND mismatch. Selected topmost visible window: HWND=${selectedWin.hwnd} (${selectedWin.appName})`);
            }

            // 4. Capture the window buffer
            const winW = selectedWin.rect.right - selectedWin.rect.left;
            const winH = selectedWin.rect.bottom - selectedWin.rect.top;
            logDebug(`Target window size: ${winW}x${winH}`);
            
            if (winW <= 0 || winH <= 0) {
                throw new Error(`Invalid window dimensions: ${winW}x${winH}`);
            }

            let capturedViaPrint = false;
            try {
                logDebug(`Attempting direct PrintWindow capture for HWND=${selectedWin.hwnd}...`);
                const bgraBuffer = windowHelper.captureWindow(selectedWin.hwnd, winW, winH);
                
                if (bgraBuffer) {
                    img = nativeImage.createFromBitmap(bgraBuffer, {
                        width: winW,
                        height: winH
                    });
                    capturedViaPrint = true;
                    logDebug('Direct PrintWindow capture succeeded.');
                } else {
                    logDebug('PrintWindow returned null (possible hardware-acceleration or OS boundary block).');
                }
            } catch (err) {
                logDebug(`PrintWindow threw an error: ${err.message}. Falling back to Screen Crop.`);
            }

            // 5. Fallback if PrintWindow failed
            if (!capturedViaPrint) {
                logDebug('Falling back to desktop screenshot + crop...');
                const primaryDisplay = screen.getPrimaryDisplay();
                const { width: scrW, height: scrH } = primaryDisplay.size;
                
                const sources = await desktopCapturer.getSources({
                    types: ['screen'],
                    thumbnailSize: { width: scrW, height: scrH }
                });
                
                const primarySource = sources.find(source => 
                    source.id.startsWith('screen:') || 
                    source.name.toLowerCase().includes('entire screen') ||
                    source.name.toLowerCase().includes('screen 1')
                ) || sources[0];

                if (!primarySource) {
                    throw new Error('Screen crop fallback failed: No screen source found');
                }

                // Crop to window rect bounds
                const rect = selectedWin.rect;
                const x = Math.max(0, Math.min(rect.left, scrW - 1));
                const y = Math.max(0, Math.min(rect.top, scrH - 1));
                const cropW = Math.max(1, Math.min(rect.right - rect.left, scrW - x));
                const cropH = Math.max(1, Math.min(rect.bottom - rect.top, scrH - y));

                logDebug(`Cropping screen capture to: x=${x}, y=${y}, w=${cropW}, h=${cropH}`);
                img = primarySource.thumbnail.crop({ x, y, width: cropW, height: cropH });
                logDebug('Screen crop fallback succeeded.');
            }
            
            capturedApp = selectedWin.appName;
            capturedTitle = selectedWin.title;
        } else {
            logDebug('Allowlist disabled. Capturing selected display.');

            // Resolve which display to capture
            const selectedDisplaySetting = settingsStore.get('selectedDisplay') || 'primary';
            const allDisplays = screen.getAllDisplays();
            const primaryDisplay = screen.getPrimaryDisplay();

            let targetDisplay;
            if (selectedDisplaySetting === 'primary') {
                targetDisplay = primaryDisplay;
            } else {
                const displayId = parseInt(selectedDisplaySetting, 10);
                targetDisplay = allDisplays.find(d => d.id === displayId) || primaryDisplay;
            }

            const { width, height } = targetDisplay.size;
            logDebug(`Target display: id=${targetDisplay.id}, size=${width}x${height}`);

            const sources = await desktopCapturer.getSources({
                types: ['screen'],
                thumbnailSize: { width, height }
            });

            // Match by display_id (Electron 31+), then fall back to name/first source
            let selectedSource = sources.find(s => String(s.display_id) === String(targetDisplay.id));
            if (!selectedSource) {
                selectedSource = sources.find(s =>
                    s.name.toLowerCase().includes('entire screen') ||
                    s.name.toLowerCase().includes('screen 1')
                ) || sources[0];
            }

            if (!selectedSource) {
                throw new Error('No screen source found');
            }

            logDebug(`Selected source: id=${selectedSource.id}, name=${selectedSource.name}`);
            img = selectedSource.thumbnail;

            const activeWin = windowHelper.getActiveWindow();
            if (activeWin) {
                capturedApp = activeWin.appName;
                capturedTitle = activeWin.title;
            }
        }

        if (!img) {
            throw new Error('Capture returned null image');
        }

        // Apply quality scaling if configured
        const imgSize = img.getSize();
        if (scale < 1 && imgSize.width > 0 && imgSize.height > 0) {
            img = img.resize({
                width: Math.round(imgSize.width * scale),
                height: Math.round(imgSize.height * scale),
                quality: 'best'
            });
        }

        return {
            buffer: img.toJPEG(85),
            appName: capturedApp,
            title: capturedTitle
        };
    } catch (e) {
        logDebug(`Failed in captureScreen: ${e.message}\nStack: ${e.stack}`);
        throw e;
    }
}

async function tick() {
    if (!isRecording || isPaused) return;

    logDebug('--- Tick started ---');
    const idleThreshold = settingsStore.get('idleThreshold');
    const interval = settingsStore.get('interval');
    
    const active = activityDetector.isActive(idleThreshold * 1000);
    if (!active) {
        logDebug('Tick skipped: User is idle.');
        lastStatus = 'Idle - No activity';
        emitStatus();
        return;
    }

    const now = Date.now();
    const timeSinceLastCapture = now - lastCaptureTime;
    const autoSegmentThresholdMs = 5 * 60 * 1000;
    
    const currentSession = sessionManager.getCurrentSession();
    if (currentSession && lastCaptureTime > 0 && timeSinceLastCapture > autoSegmentThresholdMs) {
        logDebug('Time since last capture exceeds auto-segment threshold (5m). Finalizing current session.');
        sessionManager.finalizeCurrentSession();
    }

    try {
        const captureResult = await captureScreen();
        const imageBuffer = captureResult.buffer;
        const capturedWindowInfo = {
            appName: captureResult.appName,
            title: captureResult.title
        };
        
        if (!sessionManager.getCurrentSession()) {
            logDebug('Starting new recording session...');
            sessionManager.startNewSession();
        }
        
        const frameRes = sessionManager.addFrame(imageBuffer, capturedWindowInfo);
        logDebug(`Frame successfully added: ${frameRes.filename} (count: ${frameRes.frameCount}) for App: ${capturedWindowInfo.appName}`);
        
        lastFrameBase64 = imageBuffer.toString('base64');
        lastCaptureTime = Date.now();
        lastStatus = 'Recording';
        resetCountdown(interval);
    } catch (e) {
        logDebug(`Tick failed: ${e.message}`);
        lastStatus = 'Error capturing screenshot: ' + e.message;
    }
    
    emitStatus();
}

function startCountdown(seconds) {
    if (countdownIntervalId) clearInterval(countdownIntervalId);
    countdown = seconds;
    countdownIntervalId = setInterval(() => {
        if (isRecording && !isPaused) {
            if (countdown > 0) countdown--;
            else countdown = settingsStore.get('interval');
            emitStatus();
        }
    }, 1000);
}

function resetCountdown(seconds) {
    countdown = seconds;
    emitStatus();
}

function start(resumeSessionId = null) {
    if (isRecording) return;
    isRecording = true;
    isPaused = false;
    lastStatus = 'Recording';
    lastCaptureTime = Date.now();
    
    if (resumeSessionId) {
        logDebug(`Resuming existing session: ${resumeSessionId}`);
        sessionManager.resumeSession(resumeSessionId);
    } else {
        logDebug('Starting new recording session...');
        sessionManager.startNewSession();
    }
    
    const interval = settingsStore.get('interval');
    tick();
    captureIntervalId = setInterval(tick, interval * 1000);
    startCountdown(interval);
    emitStatus();
}

function pause() {
    if (!isRecording || isPaused) return;
    isPaused = true;
    lastStatus = 'Paused';
    emitStatus();
}

function resume() {
    if (!isRecording || !isPaused) return;
    isPaused = false;
    lastStatus = 'Recording';
    const interval = settingsStore.get('interval');
    tick();
    startCountdown(interval);
    emitStatus();
}

function stop() {
    if (!isRecording) return;
    isRecording = false;
    isPaused = false;
    lastStatus = 'Stopped';
    countdown = 0;
    if (captureIntervalId) { clearInterval(captureIntervalId); captureIntervalId = null; }
    if (countdownIntervalId) { clearInterval(countdownIntervalId); countdownIntervalId = null; }
    sessionManager.finalizeCurrentSession();
    emitStatus();
}

module.exports = {
    start, pause, resume, stop,
    setEventCallback, emitStatus,
    getState: () => ({ isRecording, isPaused, lastStatus, countdown })
};
