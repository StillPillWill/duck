const fs = require('fs');
const path = require('path');
const settingsStore = require('./settingsStore');

let currentSession = null;
let sessionIndex = [];

function getIndexFilePath() {
    const storagePath = settingsStore.get('storagePath');
    return path.join(storagePath, 'index.json');
}

function loadIndex() {
    const indexPath = getIndexFilePath();
    const storagePath = settingsStore.get('storagePath');
    try {
        if (!fs.existsSync(storagePath)) {
            fs.mkdirSync(storagePath, { recursive: true });
        }
        if (fs.existsSync(indexPath)) {
            const data = fs.readFileSync(indexPath, 'utf8');
            sessionIndex = JSON.parse(data);
        } else {
            sessionIndex = [];
            saveIndex();
        }
    } catch (e) {
        console.error('Failed to load session index:', e);
        sessionIndex = [];
    }
}

function saveIndex() {
    const indexPath = getIndexFilePath();
    try {
        fs.writeFileSync(indexPath, JSON.stringify(sessionIndex, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save session index:', e);
    }
}

/**
 * Start a new contiguous session
 */
function startNewSession() {
    loadIndex();
    
    const now = new Date();
    const timestampStr = now.toISOString()
        .replace(/T/, '_')
        .replace(/\..+/, '')
        .replace(/:/g, '-'); // e.g. 2026-06-25_12-34-56
    
    const sessionId = `session_${timestampStr}`;
    const storagePath = settingsStore.get('storagePath');
    const sessionPath = path.join(storagePath, sessionId);
    
    if (!fs.existsSync(sessionPath)) {
        fs.mkdirSync(sessionPath, { recursive: true });
    }
    
    currentSession = {
        id: sessionId,
        path: sessionPath,
        startTime: Date.now(),
        endTime: Date.now(),
        frameCount: 0,
        appsUsed: [],
        frames: []
    };
    
    // Save initial session metadata
    saveSessionMetadata(currentSession);
    
    // Add to index
    const indexEntry = {
        id: sessionId,
        path: sessionPath,
        startTime: currentSession.startTime,
        endTime: currentSession.endTime,
        frameCount: 0,
        appsUsed: [],
        hasTimelapse: false,
        timelapsePath: null
    };
    
    sessionIndex.unshift(indexEntry); // Newest first
    saveIndex();
    
    return currentSession;
}

/**
 * Add a frame to the current active session
 */
function addFrame(imageBuffer, activeWindowInfo) {
    if (!currentSession) {
        startNewSession();
    }
    
    currentSession.frameCount++;
    const frameIndexStr = String(currentSession.frameCount).padStart(5, '0');
    const filename = `capture_${frameIndexStr}.jpg`;
    const filepath = path.join(currentSession.path, filename);
    
    // Write image file
    fs.writeFileSync(filepath, imageBuffer);
    
    // Track frame metadata
    const appName = activeWindowInfo ? activeWindowInfo.appName : 'Unknown';
    const windowTitle = activeWindowInfo ? activeWindowInfo.title : 'No active window';
    
    currentSession.frames.push({
        filename,
        timestamp: Date.now(),
        appName,
        windowTitle
    });
    
    currentSession.endTime = Date.now();
    
    if (appName && !currentSession.appsUsed.includes(appName) && appName !== 'Unknown') {
        currentSession.appsUsed.push(appName);
    }
    
    // Save updated session metadata
    saveSessionMetadata(currentSession);
    
    // Update index entry
    const indexEntry = sessionIndex.find(e => e.id === currentSession.id);
    if (indexEntry) {
        indexEntry.endTime = currentSession.endTime;
        indexEntry.frameCount = currentSession.frameCount;
        indexEntry.appsUsed = [...currentSession.appsUsed];
        indexEntry.lastFrameFilename = filename;
        saveIndex();
    }
    
    return {
        filename,
        frameCount: currentSession.frameCount
    };
}

function saveSessionMetadata(session) {
    try {
        const metadataPath = path.join(session.path, 'metadata.json');
        fs.writeFileSync(metadataPath, JSON.stringify(session, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save session metadata:', e);
    }
}

function finalizeCurrentSession() {
    if (!currentSession) return;
    
    // If a session has 0 frames, remove it from the index and delete the directory
    if (currentSession.frameCount === 0) {
        const indexVal = sessionIndex.findIndex(e => e.id === currentSession.id);
        if (indexVal > -1) {
            sessionIndex.splice(indexVal, 1);
            saveIndex();
        }
        try {
            if (fs.existsSync(currentSession.path)) {
                fs.rmSync(currentSession.path, { recursive: true, force: true });
            }
        } catch (err) {
            console.error('Failed to clean up empty session folder:', err);
        }
    }
    
    currentSession = null;
}

function getSessions() {
    loadIndex();
    return sessionIndex;
}

function getSessionDetails(sessionId) {
    const storagePath = settingsStore.get('storagePath');
    const metadataPath = path.join(storagePath, sessionId, 'metadata.json');
    try {
        if (fs.existsSync(metadataPath)) {
            const data = fs.readFileSync(metadataPath, 'utf8');
            const session = JSON.parse(data);
            
            // Merge with global index entry to sync hasTimelapse and timelapsePath
            loadIndex();
            const indexEntry = sessionIndex.find(e => e.id === sessionId);
            if (indexEntry) {
                if (indexEntry.hasTimelapse) session.hasTimelapse = true;
                if (indexEntry.timelapsePath) session.timelapsePath = indexEntry.timelapsePath;
            }
            
            return session;
        }
    } catch (e) {
        console.error(`Failed to load metadata for session ${sessionId}:`, e);
    }
    return null;
}

function deleteSession(sessionId) {
    loadIndex();
    const indexIndex = sessionIndex.findIndex(e => e.id === sessionId);
    if (indexIndex > -1) {
        const sessionPath = sessionIndex[indexIndex].path;
        // Delete session files
        try {
            if (fs.existsSync(sessionPath)) {
                fs.rmSync(sessionPath, { recursive: true, force: true });
            }
        } catch (e) {
            console.error(`Failed to delete session files for ${sessionId}:`, e);
        }
        
        sessionIndex.splice(indexIndex, 1);
        saveIndex();
        return true;
    }
    return false;
}

function updateSessionTimelapse(sessionId, timelapsePath) {
    loadIndex();
    const indexEntry = sessionIndex.find(e => e.id === sessionId);
    if (indexEntry) {
        indexEntry.hasTimelapse = true;
        indexEntry.timelapsePath = timelapsePath;
        saveIndex();
    }
    
    // Also update session-specific metadata.json
    const session = getSessionDetails(sessionId);
    if (session) {
        session.hasTimelapse = true;
        session.timelapsePath = timelapsePath;
        saveSessionMetadata(session);
    }
}

function resumeSession(sessionId) {
    loadIndex();
    const indexEntry = sessionIndex.find(e => e.id === sessionId);
    if (!indexEntry) {
        throw new Error(`Session ${sessionId} not found in index.`);
    }

    // Load full session metadata
    const details = getSessionDetails(sessionId);
    if (!details) {
        throw new Error(`Session metadata file not found.`);
    }

    // If it has a timelapse rendered, reset timelapse status since new frames will be appended
    if (indexEntry.hasTimelapse) {
        indexEntry.hasTimelapse = false;
        indexEntry.timelapsePath = null;
        saveIndex();
        
        const oldVideoPath = path.join(indexEntry.path, 'timelapse.mp4');
        if (fs.existsSync(oldVideoPath)) {
            try { fs.unlinkSync(oldVideoPath); } catch (e) {}
        }
    }

    currentSession = {
        id: details.id,
        path: details.path,
        startTime: details.startTime,
        endTime: Date.now(),
        frameCount: details.frameCount || 0,
        appsUsed: details.appsUsed || [],
        frames: details.frames || []
    };

    saveSessionMetadata(currentSession);
    return currentSession;
}

/**
 * Archive a session: move timelapse to archive folder, delete session files
 */
function archiveSession(sessionId) {
    loadIndex();
    const indexEntry = sessionIndex.find(e => e.id === sessionId);
    if (!indexEntry) return { success: false, error: 'Session not found' };
    if (!indexEntry.hasTimelapse || !indexEntry.timelapsePath) {
        return { success: false, error: 'No timelapse to archive. Render one first.' };
    }

    const storagePath = settingsStore.get('storagePath');
    const archiveDir = path.join(storagePath, '..', 'archive');
    if (!fs.existsSync(archiveDir)) {
        fs.mkdirSync(archiveDir, { recursive: true });
    }

    // Move timelapse to archive
    const archiveName = `${sessionId}_timelapse.mp4`;
    const archivePath = path.join(archiveDir, archiveName);
    try {
        fs.copyFileSync(indexEntry.timelapsePath, archivePath);
    } catch (e) {
        return { success: false, error: `Failed to copy video: ${e.message}` };
    }

    // Delete session folder
    try {
        if (fs.existsSync(indexEntry.path)) {
            fs.rmSync(indexEntry.path, { recursive: true, force: true });
        }
    } catch (e) {
        console.error('Failed to delete session folder:', e);
    }

    // Remove from index
    const idx = sessionIndex.findIndex(e => e.id === sessionId);
    if (idx > -1) sessionIndex.splice(idx, 1);
    saveIndex();

    return { success: true, archivePath };
}

/**
 * Calculate total size of sessions directory
 */
function getStorageSize() {
    const storagePath = settingsStore.get('storagePath');
    let totalBytes = 0;
    let sessionCount = 0;

    function dirSize(dir) {
        try {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    dirSize(fullPath);
                } else {
                    try {
                        totalBytes += fs.statSync(fullPath).size;
                    } catch (e) {}
                }
            }
        } catch (e) {}
    }

    try {
        if (fs.existsSync(storagePath)) {
            const entries = fs.readdirSync(storagePath, { withFileTypes: true });
            sessionCount = entries.filter(e => e.isDirectory()).length;
            dirSize(storagePath);
        }
    } catch (e) {}

    // Also count archive folder
    const archiveDir = path.join(storagePath, '..', 'archive');
    dirSize(archiveDir);

    return { totalBytes, sessionCount };
}

// Initial load on import
loadIndex();

module.exports = {
    startNewSession,
    resumeSession,
    addFrame,
    finalizeCurrentSession,
    getSessions,
    getSessionDetails,
    deleteSession,
    updateSessionTimelapse,
    getCurrentSession: () => currentSession,
    archiveSession,
    getStorageSize
};
