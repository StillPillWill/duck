const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// State tracking
let currentInterval = 60;
let allowlist = [];
let isRenderingTimelapse = false;

// --- DOM ELEMENTS ---
// Titlebar
const btnMinimize = document.getElementById('btn-minimize');
const btnMaximize = document.getElementById('btn-maximize');
const btnClose = document.getElementById('btn-close');

// Navigation (top tabs)
const menuItems = document.querySelectorAll('.nav-tab');
const pages = document.querySelectorAll('.page');

// Status (hidden compat element + visual elements)
const sidebarStatusText = document.getElementById('sidebar-status-text');
const sidebarStatusDot = document.getElementById('sidebar-status-dot');
const sidebarCountdownText = document.getElementById('sidebar-countdown-text');

// Dashboard — Record control
const btnToggleRecording = document.getElementById('btn-toggle-recording');
const btnPauseRecording = document.getElementById('btn-pause-recording');
const progressCircle = document.getElementById('control-progress-circle');
const recordIconPlay = btnToggleRecording.querySelector('.record-icon-play');
const recordIconStop = btnToggleRecording.querySelector('.record-icon-stop');
const dashboardStatusLabel = document.getElementById('dashboard-status-label');
const dashboardCountdownLabel = document.getElementById('dashboard-countdown-label');

// Dashboard — Stats
const statFrames = document.getElementById('stat-frames');
const statSessionId = document.getElementById('stat-session-id');
const statInterval = document.getElementById('stat-interval');

// Dashboard — Active window
const currentAppBadge = document.getElementById('current-app-badge');
const currentWindowTitle = document.getElementById('current-window-title');

// Dashboard — Preview
const previewImage = document.getElementById('preview-image');
const previewEmpty = document.getElementById('preview-empty');
const previewTimestamp = document.getElementById('preview-timestamp');

// Sessions
const sessionsContainer = document.getElementById('sessions-container');

// Settings
const settingInterval = document.getElementById('setting-interval');
const settingIntervalInput = document.getElementById('setting-interval-input');
const settingIdle = document.getElementById('setting-idle');
const settingIdleInput = document.getElementById('setting-idle-input');
const settingQuality = document.getElementById('setting-quality');
const settingDisplay = document.getElementById('setting-display');
const settingAllowlistEnabled = document.getElementById('setting-allowlist-enabled');
const filterModeRow = document.getElementById('filter-mode-row');
const filterHint = document.getElementById('filter-hint');
const btnFilterAllow = document.getElementById('btn-filter-allow');
const btnFilterBlock = document.getElementById('btn-filter-block');
const allowlistManager = document.getElementById('allowlist-manager');
const runningAppsPicker = document.getElementById('running-apps-picker');
const btnRefreshRunningApps = document.getElementById('btn-refresh-running-apps');
const btnAddApp = document.getElementById('btn-add-app');
const allowlistTagsContainer = document.getElementById('allowlist-tags-container');
const settingStoragePath = document.getElementById('setting-storage-path');
const btnBrowseStorage = document.getElementById('btn-browse-storage');
const settingMinimizeTray = document.getElementById('setting-minimize-tray');
const btnResetSettings = document.getElementById('btn-reset-settings');

// Render settings
const settingFps = document.getElementById('setting-fps');
const settingFpsInput = document.getElementById('setting-fps-input');
const settingCrf = document.getElementById('setting-crf');
const settingCrfInput = document.getElementById('setting-crf-input');
const settingPreset = document.getElementById('setting-preset');
const settingResolution = document.getElementById('setting-resolution');
const settingSubtitles = document.getElementById('setting-subtitles');

// Viewer Modal
const viewerModal = document.getElementById('viewer-modal');
const viewerTitle = document.getElementById('viewer-title');
const btnCloseViewer = document.getElementById('btn-close-viewer');
const viewerFrameImage = document.getElementById('viewer-frame-image');
const viewerVideo = document.getElementById('viewer-video');
const viewerActiveApp = document.getElementById('viewer-active-app');
const viewerActiveTitle = document.getElementById('viewer-active-title');
const viewerTime = document.getElementById('viewer-time');
const viewerScrubSlider = document.getElementById('viewer-scrub-slider');
const viewerScrubControls = document.getElementById('viewer-scrub-controls');
const btnViewerPlay = document.getElementById('btn-viewer-play');
const viewerFrameCounter = document.getElementById('viewer-frame-counter');
const toastContainer = document.getElementById('toast-container');

// Ring circumference (r=88 → C = 2 * π * 88)
const RING_CIRCUMFERENCE = 2 * Math.PI * 88; // ≈ 553.0


// --- TOAST NOTIFICATIONS ---
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(10px)';
        toast.style.transition = 'all 0.25s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}


// --- WINDOW CONTROLS ---
btnMinimize.addEventListener('click', () => ipcRenderer.send('window-minimize'));
btnMaximize.addEventListener('click', () => ipcRenderer.send('window-maximize'));
btnClose.addEventListener('click', () => ipcRenderer.send('window-close'));


// --- NAVIGATION ---
menuItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        const pageId = item.getAttribute('data-page');

        menuItems.forEach(mi => mi.classList.remove('active'));
        item.classList.add('active');

        pages.forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${pageId}`).classList.add('active');

        if (pageId === 'sessions') {
            loadSessions();
        } else if (pageId === 'settings') {
            loadSettings();
        }
    });
});


// --- DASHBOARD AND RECORDING ---
btnToggleRecording.addEventListener('click', async () => {
    try {
        const status = await ipcRenderer.invoke('recording-get-status');

        if (status.isRecording) {
            const newState = await ipcRenderer.invoke('recording-stop');
            updateUIState(newState);
            showToast('Recording session stopped', 'info');
        } else {
            const newState = await ipcRenderer.invoke('recording-start');
            updateUIState(newState);
            showToast('Recording session started', 'success');
        }
    } catch (e) {
        console.error('Failed to toggle recording:', e);
        showToast('Error: ' + e.message, 'error');
    }
});

btnPauseRecording.addEventListener('click', async () => {
    try {
        const status = await ipcRenderer.invoke('recording-get-status');
        if (!status.isRecording) return;

        if (status.isPaused) {
            const newState = await ipcRenderer.invoke('recording-resume');
            updateUIState(newState);
            showToast('Recording resumed', 'success');
        } else {
            const newState = await ipcRenderer.invoke('recording-pause');
            updateUIState(newState);
            showToast('Recording paused', 'warning');
        }
    } catch (e) {
        console.error('Failed to pause/resume recording:', e);
        showToast('Error: ' + e.message, 'error');
    }
});

// Update the ring progress countdown
function updateProgressCircle(countdown, total) {
    if (total <= 0) return;
    const ratio = Math.max(0, Math.min(1, countdown / total));
    const offset = RING_CIRCUMFERENCE * (1 - ratio);
    progressCircle.style.strokeDashoffset = offset;
}

// Receive continuous status updates from CaptureEngine
ipcRenderer.on('capture-status-update', (event, data) => {
    updateUIState(data);
});

function updateUIState(data) {
    const { isRecording, isPaused, lastStatus, countdown, activeWindow, frameCount, sessionId } = data;

    // 1. Status indicator (hidden compat + visual)
    if (sidebarStatusDot) {
        sidebarStatusDot.className = 'status-dot';
    }

    // 2. Record button icon swap
    if (isRecording) {
        recordIconPlay.style.display = 'none';
        recordIconStop.style.display = 'block';
        btnPauseRecording.disabled = false;

        if (isPaused) {
            btnPauseRecording.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>
                Resume
            `;
            dashboardStatusLabel.textContent = 'Paused';
            dashboardStatusLabel.style.color = 'var(--amber)';
            if (sidebarStatusText) sidebarStatusText.textContent = 'Paused';
            if (sidebarCountdownText) sidebarCountdownText.style.display = 'none';
        } else {
            btnPauseRecording.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                Pause
            `;
            dashboardStatusLabel.textContent = 'Recording';
            dashboardStatusLabel.style.color = 'var(--green)';
            if (sidebarStatusText) sidebarStatusText.textContent = 'Recording';
            if (sidebarCountdownText) {
                sidebarCountdownText.style.display = 'block';
                sidebarCountdownText.textContent = `${countdown}s`;
            }
        }
        dashboardCountdownLabel.textContent = `Next capture in ${countdown}s`;
    } else {
        recordIconPlay.style.display = 'block';
        recordIconStop.style.display = 'none';
        btnPauseRecording.disabled = true;
        btnPauseRecording.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
            Pause
        `;
        dashboardStatusLabel.textContent = 'Inactive';
        dashboardStatusLabel.style.color = 'var(--text-2)';
        dashboardCountdownLabel.textContent = 'Press to start capturing';
        if (sidebarStatusText) sidebarStatusText.textContent = 'Stopped';
        if (sidebarCountdownText) sidebarCountdownText.style.display = 'none';
        updateProgressCircle(0, 1);
    }

    if (isRecording && !isPaused) {
        updateProgressCircle(countdown, currentInterval);
    }

    // 3. Stats
    statFrames.textContent = frameCount;
    statSessionId.textContent = sessionId || '—';
    statSessionId.title = sessionId || '';

    // 4. Active Window
    if (activeWindow) {
        currentAppBadge.style.display = 'inline-block';
        currentAppBadge.textContent = activeWindow.appName;
        currentWindowTitle.textContent = activeWindow.title || 'Untitled Window';
    } else {
        currentAppBadge.style.display = 'none';
        currentWindowTitle.textContent = 'No foreground window activity detected';
    }

    // 5. Last capture preview
    if (data.lastFramePreview) {
        previewImage.src = `data:image/jpeg;base64,${data.lastFramePreview}`;
        previewImage.style.display = 'block';
        previewEmpty.style.display = 'none';
        if (previewTimestamp) {
            previewTimestamp.textContent = new Date().toLocaleTimeString();
        }
    }
}


// --- SESSIONS PAGE ---
async function loadSessions() {
    const sessions = await ipcRenderer.invoke('sessions-get-all');
    sessionsContainer.innerHTML = '';

    // Storage monitor
    const storage = await ipcRenderer.invoke('sessions-get-storage-size');
    const sizeMB = (storage.totalBytes / (1024 * 1024)).toFixed(1);
    const sizeLabel = storage.totalBytes > 1024 * 1024 * 1024
        ? `${(storage.totalBytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
        : `${sizeMB} MB`;

    const monitorHTML = `
        <div class="storage-monitor">
            <div class="storage-monitor-info">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span>${storage.sessionCount} session${storage.sessionCount !== 1 ? 's' : ''}</span>
                <span class="storage-sep">·</span>
                <span>${sizeLabel} used</span>
            </div>
            <span class="storage-monitor-path">📁 ${storagePath || 'Default'}</span>
        </div>
    `;
    sessionsContainer.innerHTML = monitorHTML;

    if (sessions.length === 0) {
        sessionsContainer.innerHTML += `
            <div class="empty-state">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>
                </svg>
                <p>No recording sessions found. Start recording above!</p>
            </div>
        `;
        return;
    }

    // Fetch thumbnails in parallel
    const thumbPromises = sessions.map(s =>
        s.frameCount > 0
            ? ipcRenderer.invoke('session-get-last-frame', s.id)
            : Promise.resolve(null)
    );
    const thumbnails = await Promise.all(thumbPromises);

    sessions.forEach((session, i) => {
        const dateStr = new Date(session.startTime).toLocaleString();
        const durationMin = Math.round((session.endTime - session.startTime) / 60000);

        const card = document.createElement('div');
        card.className = 'session-card';
        card.id = `session-card-${session.id}`;

        const appsHTML = session.appsUsed.map(app => `<span class="app-micro-badge">${app}</span>`).join(' ');
        const thumbSrc = thumbnails[i] ? `data:image/jpeg;base64,${thumbnails[i]}` : '';
        const thumbHTML = thumbSrc
            ? `<img class="session-thumb" src="${thumbSrc}" alt="Last frame">`
            : `<div class="session-thumb session-thumb-empty"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></div>`;

        card.innerHTML = `
            <div class="session-card-layout">
                <div class="session-thumb-wrap">
                    ${thumbHTML}
                </div>
                <div class="session-card-content">
                    <div class="session-card-header">
                        <div class="session-header-info">
                            <h3>${session.id.replace('session_', '').replace(/_/g, ' ').replace(/-/g, ':')}</h3>
                            <div class="session-meta-info">
                                <span>Started: ${dateStr}</span>
                                <span>Duration: ${durationMin} min</span>
                                <span>Frames: ${session.frameCount}</span>
                            </div>
                        </div>
                        <div class="session-header-actions">
                            <button class="btn btn-ghost btn-sm" onclick="viewSession('${session.id}')">View Frames</button>

                            ${session.hasTimelapse ?
                                `<button class="btn btn-ghost btn-sm" style="color: var(--accent);" onclick="watchTimelapse('${session.id}')">Watch Timelapse</button>
                                 <button class="btn btn-ghost btn-sm" onclick="exportTimelapse('${session.id}')">Export</button>
                                 <button class="btn btn-ghost btn-sm" style="color: var(--amber);" onclick="archiveSession('${session.id}')">Archive</button>` :
                                `<button class="btn btn-primary-sm btn-sm btn-render-${session.id}" onclick="renderTimelapse('${session.id}')">Render Video</button>`
                            }

                            <button class="btn btn-ghost btn-sm" style="color: var(--green);" onclick="resumeSession('${session.id}')">Resume</button>
                            <button class="btn btn-ghost btn-sm" style="color: var(--red);" onclick="confirmDeleteSession('${session.id}')">Delete</button>
                        </div>
                    </div>
                    <div class="session-card-body">
                        <div class="session-apps-used">
                            <div class="session-apps-used-title">Applications Tracked</div>
                            <div class="session-apps-list">
                                ${appsHTML || '<span style="color:var(--text-4);font-size:11px;">No app details captured</span>'}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        sessionsContainer.appendChild(card);
    });
}

// Global functions for inline onclick
window.resumeSession = async function(sessionId) {
    try {
        const status = await ipcRenderer.invoke('recording-get-status');
        if (status.isRecording) {
            showToast('A recording session is already active. Please stop it first.', 'warning');
            return;
        }

        const newState = await ipcRenderer.invoke('recording-start', sessionId);
        updateUIState(newState);

        // Navigate to Capture tab
        menuItems.forEach(mi => mi.classList.remove('active'));
        const dashboardTab = Array.from(menuItems).find(mi => mi.getAttribute('data-page') === 'dashboard');
        if (dashboardTab) dashboardTab.classList.add('active');
        pages.forEach(p => p.classList.remove('active'));
        document.getElementById('page-dashboard').classList.add('active');

        showToast('Session recording resumed successfully!', 'success');
    } catch (e) {
        console.error('Failed to resume session:', e);
        showToast('Error resuming session: ' + e.message, 'error');
    }
};

window.confirmDeleteSession = async function(sessionId) {
    if (confirm('Are you sure you want to delete this session and all its captured screenshots? This cannot be undone.')) {
        const deleted = await ipcRenderer.invoke('session-delete', sessionId);
        if (deleted) {
            showToast('Session deleted successfully', 'success');
            loadSessions();
        } else {
            showToast('Failed to delete session', 'error');
        }
    }
};

window.archiveSession = async function(sessionId) {
    if (!confirm('Archive this session? The timelapse video will be saved and the session removed from this list.')) return;
    const result = await ipcRenderer.invoke('session-archive', sessionId);
    if (result.success) {
        showToast(`Video archived to: ${result.archivePath}`, 'success');
        loadSessions();
    } else {
        showToast(`Archive failed: ${result.error}`, 'error');
    }
};

window.renderTimelapse = async function(sessionId) {
    if (isRenderingTimelapse) {
        showToast('Another timelapse render is currently in progress.', 'warning');
        return;
    }

    const renderBtn = document.querySelector(`.btn-render-${sessionId}`);
    if (renderBtn) {
        renderBtn.disabled = true;
        renderBtn.textContent = 'Rendering (0%)...';
    }

    isRenderingTimelapse = true;
    showToast('Starting timelapse generation...', 'info');

    const result = await ipcRenderer.invoke('timelapse-generate', sessionId);
    isRenderingTimelapse = false;

    if (result.success) {
        showToast('Timelapse rendered successfully!', 'success');
        loadSessions();
    } else {
        showToast(`Render failed: ${result.error}`, 'error');
        if (renderBtn) {
            renderBtn.disabled = false;
            renderBtn.textContent = 'Render Video';
        }
    }
};

ipcRenderer.on('timelapse-progress', (event, data) => {
    const { sessionId, percent } = data;
    const renderBtn = document.querySelector(`.btn-render-${sessionId}`);
    if (renderBtn) {
        renderBtn.textContent = `Rendering (${percent}%)...`;
    }
});

window.exportTimelapse = async function(sessionId) {
    showToast('Exporting timelapse video...', 'info');
    const res = await ipcRenderer.invoke('timelapse-export', sessionId);
    if (res.success) {
        showToast(`Video exported to: ${res.path}`, 'success');
    } else if (res.error) {
        showToast(`Export failed: ${res.error}`, 'error');
    }
};


// --- VIEWER MODAL ---
let currentViewerFrames = [];
let viewerPlayInterval = null;
let currentViewerIndex = 0;

window.viewSession = async function(sessionId) {
    const details = await ipcRenderer.invoke('session-get-details', sessionId);
    if (!details || details.frameCount === 0) {
        showToast('No frame data available for this session', 'warning');
        return;
    }

    viewerTitle.textContent = `Scrubbing Session - ${sessionId.replace('session_', '').replace(/_/g, ' ')}`;
    currentViewerFrames = details.frames.map(f => ({
        ...f,
        fullPath: path.join(details.path, f.filename)
    }));

    viewerVideo.style.display = 'none';
    viewerFrameImage.style.display = 'block';
    viewerScrubControls.style.display = 'block';

    viewerScrubSlider.min = 0;
    viewerScrubSlider.max = currentViewerFrames.length - 1;
    viewerScrubSlider.value = 0;

    loadViewerFrame(0);
    viewerModal.classList.add('active');
};

function loadViewerFrame(index) {
    if (index < 0 || index >= currentViewerFrames.length) return;

    currentViewerIndex = index;
    const frame = currentViewerFrames[index];

    try {
        const fileBuffer = fs.readFileSync(frame.fullPath);
        viewerFrameImage.src = `data:image/jpeg;base64,${fileBuffer.toString('base64')}`;

        viewerActiveApp.textContent = frame.appName;
        viewerActiveTitle.textContent = frame.windowTitle || 'Untitled Window';
        viewerTime.textContent = new Date(frame.timestamp).toLocaleTimeString();

        viewerFrameCounter.textContent = `${index + 1} / ${currentViewerFrames.length}`;
        viewerScrubSlider.value = index;
    } catch (e) {
        console.error('Failed to load frame image:', e);
        viewerFrameImage.src = '';
    }
}

viewerScrubSlider.addEventListener('input', (e) => {
    loadViewerFrame(parseInt(e.target.value));
});

btnViewerPlay.addEventListener('click', () => {
    if (viewerPlayInterval) {
        clearInterval(viewerPlayInterval);
        viewerPlayInterval = null;
        btnViewerPlay.textContent = 'Play';
    } else {
        btnViewerPlay.textContent = 'Pause';
        viewerPlayInterval = setInterval(() => {
            let nextIndex = currentViewerIndex + 1;
            if (nextIndex >= currentViewerFrames.length) {
                nextIndex = 0;
            }
            loadViewerFrame(nextIndex);
        }, 500);
    }
});

window.watchTimelapse = async function(sessionId) {
    const details = await ipcRenderer.invoke('session-get-details', sessionId);
    if (!details || !details.timelapsePath) {
        showToast('Timelapse video not found', 'warning');
        return;
    }

    viewerTitle.textContent = `Watching Timelapse - ${sessionId.replace('session_', '').replace(/_/g, ' ')}`;

    viewerFrameImage.style.display = 'none';
    viewerScrubControls.style.display = 'none';
    viewerVideo.style.display = 'block';

    viewerVideo.src = `file:///${details.timelapsePath.replace(/\\/g, '/')}`;
    viewerVideo.load();
    viewerVideo.play().catch(e => {
        console.error('Failed to auto-play video.', e);
    });

    viewerModal.classList.add('active');
};

function closeViewerModal() {
    if (viewerPlayInterval) {
        clearInterval(viewerPlayInterval);
        viewerPlayInterval = null;
    }
    btnViewerPlay.textContent = 'Play';
    viewerVideo.pause();
    viewerVideo.src = '';
    viewerFrameImage.src = '';
    viewerModal.classList.remove('active');
}

btnCloseViewer.addEventListener('click', closeViewerModal);
viewerModal.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-backdrop')) closeViewerModal();
});


// --- SETTINGS PAGE ---
async function loadSettings() {
    const interval = await ipcRenderer.invoke('settings-get', 'interval');
    const idleThreshold = await ipcRenderer.invoke('settings-get', 'idleThreshold');
    const quality = await ipcRenderer.invoke('settings-get', 'quality');
    const allowlistEnabled = await ipcRenderer.invoke('settings-get', 'allowlistEnabled');
    allowlist = await ipcRenderer.invoke('settings-get', 'allowlist') || [];
    const storagePath = await ipcRenderer.invoke('settings-get', 'storagePath');
    const minimizeTray = await ipcRenderer.invoke('settings-get', 'minimizeToTray');

    currentInterval = interval;

    settingInterval.value = interval;
    settingIntervalInput.value = interval;

    settingIdle.value = idleThreshold;
    settingIdleInput.value = idleThreshold;

    settingQuality.value = quality;

    // Display selector
    await populateDisplayDropdown();
    const selectedDisplay = await ipcRenderer.invoke('settings-get', 'selectedDisplay');
    settingDisplay.value = selectedDisplay || 'primary';

    settingAllowlistEnabled.checked = allowlistEnabled;
    allowlistManager.style.display = allowlistEnabled ? 'block' : 'none';
    filterModeRow.style.display = allowlistEnabled ? 'block' : 'none';

    // Filter mode
    const filterMode = await ipcRenderer.invoke('settings-get', 'filterMode');
    updateFilterUI(filterMode || 'allowlist');

    settingStoragePath.value = storagePath;
    settingMinimizeTray.checked = minimizeTray;

    // Render settings
    const fps = await ipcRenderer.invoke('settings-get', 'timelapseFps');
    const crf = await ipcRenderer.invoke('settings-get', 'timelapseCrf');
    const preset = await ipcRenderer.invoke('settings-get', 'timelapsePreset');
    const resolution = await ipcRenderer.invoke('settings-get', 'timelapseResolution');
    const subtitles = await ipcRenderer.invoke('settings-get', 'timelapseSubtitles');

    settingFps.value = fps;
    settingFpsInput.value = fps;
    settingCrf.value = crf;
    settingCrfInput.value = crf;
    settingPreset.value = preset;
    settingResolution.value = resolution;
    settingSubtitles.checked = subtitles;

    renderAllowlistTags();
    refreshRunningAppsList();
}

function renderAllowlistTags() {
    allowlistTagsContainer.innerHTML = '';

    if (allowlist.length === 0) {
        allowlistTagsContainer.innerHTML = '<span style="color:var(--text-4);font-size:11px;">No applications added yet.</span>';
        return;
    }

    allowlist.forEach(app => {
        const tag = document.createElement('span');
        tag.className = 'app-tag';
        tag.innerHTML = `
            <span>${app}</span>
            <span class="app-tag-remove" onclick="removeAppFromAllowlist('${app}')">&times;</span>
        `;
        allowlistTagsContainer.appendChild(tag);
    });
}

settingInterval.addEventListener('input', (e) => {
    settingIntervalInput.value = e.target.value;
});
settingInterval.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value);
    currentInterval = val;
    settingIntervalInput.value = val;
    await ipcRenderer.invoke('settings-set', 'interval', val);
    statInterval.textContent = `${val}s`;
    showToast('Capture interval updated', 'success');
});

// Number input → slider + save
settingIntervalInput.addEventListener('input', (e) => {
    const raw = parseInt(e.target.value);
    if (!isNaN(raw)) {
        const clamped = Math.max(5, Math.min(120, raw));
        settingInterval.value = clamped;
    }
});
settingIntervalInput.addEventListener('change', async (e) => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) val = 30;
    val = Math.max(5, Math.min(120, val));
    // Snap to step
    val = Math.round(val / 5) * 5;
    settingInterval.value = val;
    settingIntervalInput.value = val;
    currentInterval = val;
    await ipcRenderer.invoke('settings-set', 'interval', val);
    statInterval.textContent = `${val}s`;
    showToast('Capture interval updated', 'success');
});

settingIdle.addEventListener('input', (e) => {
    settingIdleInput.value = e.target.value;
});
settingIdle.addEventListener('change', async (e) => {
    const val = parseInt(e.target.value);
    settingIdleInput.value = val;
    await ipcRenderer.invoke('settings-set', 'idleThreshold', val);
    showToast('Idle activity timeout updated', 'success');
});

// Number input → slider + save
settingIdleInput.addEventListener('input', (e) => {
    const raw = parseInt(e.target.value);
    if (!isNaN(raw)) {
        const clamped = Math.max(10, Math.min(300, raw));
        settingIdle.value = clamped;
    }
});
settingIdleInput.addEventListener('change', async (e) => {
    let val = parseInt(e.target.value);
    if (isNaN(val)) val = 30;
    val = Math.max(10, Math.min(300, val));
    val = Math.round(val / 10) * 10;
    settingIdle.value = val;
    settingIdleInput.value = val;
    await ipcRenderer.invoke('settings-set', 'idleThreshold', val);
    showToast('Idle activity timeout updated', 'success');
});

settingQuality.addEventListener('change', async (e) => {
    await ipcRenderer.invoke('settings-set', 'quality', e.target.value);
    showToast('Screenshot quality updated', 'success');
});

// --- Display selector ---
async function populateDisplayDropdown() {
    const displays = await ipcRenderer.invoke('displays-get');
    settingDisplay.innerHTML = '';
    if (displays.length === 0) {
        settingDisplay.innerHTML = '<option value="primary">Primary Display</option>';
        return;
    }
    displays.forEach((d, i) => {
        const opt = document.createElement('option');
        opt.value = d.id;
        const res = `${d.width}×${d.height}`;
        const tag = d.isPrimary ? ' (Primary)' : '';
        opt.textContent = `${d.label} — ${res}${tag}`;
        settingDisplay.appendChild(opt);
    });
}

settingDisplay.addEventListener('change', async (e) => {
    await ipcRenderer.invoke('settings-set', 'selectedDisplay', e.target.value);
    showToast('Display selection updated', 'success');
});

settingAllowlistEnabled.addEventListener('change', async (e) => {
    const enabled = e.target.checked;
    await ipcRenderer.invoke('settings-set', 'allowlistEnabled', enabled);
    allowlistManager.style.display = enabled ? 'block' : 'none';
    filterModeRow.style.display = enabled ? 'block' : 'none';
    updateFilterHint();
    showToast(`Application filtering ${enabled ? 'enabled' : 'disabled'}`, 'info');
});

// Filter mode buttons
function updateFilterUI(mode) {
    btnFilterAllow.classList.toggle('active', mode === 'allowlist');
    btnFilterBlock.classList.toggle('active', mode === 'blocklist');
    updateFilterHint();
}

function updateFilterHint() {
    const mode = btnFilterAllow.classList.contains('active') ? 'allowlist' : 'blocklist';
    filterHint.textContent = mode === 'allowlist'
        ? 'Only capture when working in approved apps.'
        : 'Capture everything except the listed apps.';
}

btnFilterAllow.addEventListener('click', async () => {
    updateFilterUI('allowlist');
    await ipcRenderer.invoke('settings-set', 'filterMode', 'allowlist');
});

btnFilterBlock.addEventListener('click', async () => {
    updateFilterUI('blocklist');
    await ipcRenderer.invoke('settings-set', 'filterMode', 'blocklist');
});

settingMinimizeTray.addEventListener('change', async (e) => {
    await ipcRenderer.invoke('settings-set', 'minimizeToTray', e.target.checked);
});

btnBrowseStorage.addEventListener('click', async () => {
    const dir = await ipcRenderer.invoke('storage-select-directory');
    if (dir) {
        settingStoragePath.value = dir;
        await ipcRenderer.invoke('settings-set', 'storagePath', dir);
        showToast('Storage folder updated', 'success');
    }
});

async function addAppToAllowlist(appName) {
    if (!appName) return;
    const cleanName = appName.trim();
    if (!allowlist.includes(cleanName)) {
        allowlist.push(cleanName);
        await ipcRenderer.invoke('settings-set', 'allowlist', allowlist);
        renderAllowlistTags();
        showToast(`Added ${cleanName} to allowlist`, 'success');
    }
}

btnAddApp.addEventListener('click', () => {
    const pickerVal = runningAppsPicker.value;
    if (pickerVal) {
        addAppToAllowlist(pickerVal);
        runningAppsPicker.value = '';
    } else {
        showToast('Please select a running application from the list', 'warning');
    }
});

window.removeAppFromAllowlist = async function(appName) {
    const index = allowlist.indexOf(appName);
    if (index > -1) {
        allowlist.splice(index, 1);
        await ipcRenderer.invoke('settings-set', 'allowlist', allowlist);
        renderAllowlistTags();
        showToast(`Removed ${appName} from allowlist`, 'warning');
    }
};

async function refreshRunningAppsList() {
    runningAppsPicker.innerHTML = '<option value="">— Loading running apps... —</option>';
    const apps = await ipcRenderer.invoke('apps-get-running');

    runningAppsPicker.innerHTML = '<option value="">— Select from running apps —</option>';
    if (apps && apps.length > 0) {
        apps.forEach(app => {
            const option = document.createElement('option');
            option.value = app;
            option.textContent = app;
            runningAppsPicker.appendChild(option);
        });
    } else {
        runningAppsPicker.innerHTML = '<option value="">— No apps discovered —</option>';
    }
}

btnRefreshRunningApps.addEventListener('click', (e) => {
    e.preventDefault();
    refreshRunningAppsList();
    showToast('Discovered active windows refreshed', 'info');
});

// --- Render settings ---
// FPS
settingFps.addEventListener('input', (e) => { settingFpsInput.value = e.target.value; });
settingFps.addEventListener('change', async (e) => {
    const val = Math.max(1, Math.min(30, parseInt(e.target.value) || 1));
    settingFps.value = val; settingFpsInput.value = val;
    await ipcRenderer.invoke('settings-set', 'timelapseFps', val);
    showToast('Render FPS updated', 'success');
});
settingFpsInput.addEventListener('input', (e) => {
    const v = parseInt(e.target.value); if (!isNaN(v)) settingFps.value = Math.max(1, Math.min(30, v));
});
settingFpsInput.addEventListener('change', async (e) => {
    let val = Math.max(1, Math.min(30, parseInt(e.target.value) || 1));
    settingFps.value = val; settingFpsInput.value = val;
    await ipcRenderer.invoke('settings-set', 'timelapseFps', val);
    showToast('Render FPS updated', 'success');
});

// CRF
settingCrf.addEventListener('input', (e) => { settingCrfInput.value = e.target.value; });
settingCrf.addEventListener('change', async (e) => {
    const val = Math.max(18, Math.min(35, parseInt(e.target.value) || 23));
    settingCrf.value = val; settingCrfInput.value = val;
    await ipcRenderer.invoke('settings-set', 'timelapseCrf', val);
    showToast('Render quality updated', 'success');
});
settingCrfInput.addEventListener('input', (e) => {
    const v = parseInt(e.target.value); if (!isNaN(v)) settingCrf.value = Math.max(18, Math.min(35, v));
});
settingCrfInput.addEventListener('change', async (e) => {
    let val = Math.max(18, Math.min(35, parseInt(e.target.value) || 23));
    settingCrf.value = val; settingCrfInput.value = val;
    await ipcRenderer.invoke('settings-set', 'timelapseCrf', val);
    showToast('Render quality updated', 'success');
});

// Preset / Resolution / Subtitles
settingPreset.addEventListener('change', async (e) => {
    await ipcRenderer.invoke('settings-set', 'timelapsePreset', e.target.value);
    showToast('Encoding preset updated', 'success');
});
settingResolution.addEventListener('change', async (e) => {
    await ipcRenderer.invoke('settings-set', 'timelapseResolution', e.target.value);
    showToast('Render resolution updated', 'success');
});
settingSubtitles.addEventListener('change', async (e) => {
    await ipcRenderer.invoke('settings-set', 'timelapseSubtitles', e.target.checked);
    showToast(`Subtitles ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
});

btnResetSettings.addEventListener('click', async () => {
    if (confirm('Are you sure you want to reset all configurations to their original default values?')) {
        await ipcRenderer.invoke('settings-reset');
        loadSettings();
        showToast('Settings reset to defaults', 'success');
    }
});


// --- INITIAL STARTUP ---
async function init() {
    try {
        const interval = await ipcRenderer.invoke('settings-get', 'interval');
        currentInterval = interval;
        statInterval.textContent = `${interval}s`;

        const status = await ipcRenderer.invoke('recording-get-status');
        updateUIState(status);
    } catch (e) {
        console.error('Failed to initialize Screenie app:', e);
        showToast('Initialization Error: ' + e.message, 'error');
    }
}

init();
