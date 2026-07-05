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

/**
 * Trim a session: delete frames outside [startIndex, endIndex] (0-based, inclusive)
 * Renames remaining frames to sequential filenames.
 */
function trimSession(sessionId, startIndex, endIndex) {
    loadIndex();
    const indexEntry = sessionIndex.find(e => e.id === sessionId);
    if (!indexEntry) return { success: false, error: 'Session not found' };

    const details = getSessionDetails(sessionId);
    if (!details || !details.frames || details.frames.length === 0) {
        return { success: false, error: 'No frames in session' };
    }

    const frames = details.frames;
    const keepFrames = frames.slice(startIndex, endIndex + 1);

    // Delete frames outside range
    for (let i = 0; i < frames.length; i++) {
        if (i < startIndex || i > endIndex) {
            const fp = path.join(details.path, frames[i].filename);
            try { if (fs.existsSync(fp)) fs.unlinkSync(fp); } catch (e) {}
        }
    }

    // Rename kept frames to sequential filenames
    const renamedFrames = keepFrames.map((frame, i) => {
        const newIdx = String(i + 1).padStart(5, '0');
        const newFilename = `capture_${newIdx}.jpg`;
        const oldPath = path.join(details.path, frame.filename);
        const newPath = path.join(details.path, newFilename);
        if (frame.filename !== newFilename && fs.existsSync(oldPath)) {
            try { fs.renameSync(oldPath, newPath); } catch (e) {}
        }
        return { ...frame, filename: newFilename };
    });

    // Update metadata
    details.frames = renamedFrames;
    details.frameCount = renamedFrames.length;
    if (renamedFrames.length > 0) {
        details.endTime = renamedFrames[renamedFrames.length - 1].timestamp;
    }
    saveSessionMetadata(details);

    // Update index
    indexEntry.frameCount = renamedFrames.length;
    indexEntry.endTime = details.endTime;
    indexEntry.lastFrameFilename = renamedFrames.length > 0 ? renamedFrames[renamedFrames.length - 1].filename : null;
    indexEntry.hasTimelapse = false;
    indexEntry.timelapsePath = null;
    saveIndex();

    // Delete old timelapse if it exists
    const oldTimelapse = path.join(details.path, 'timelapse.mp4');
    try { if (fs.existsSync(oldTimelapse)) fs.unlinkSync(oldTimelapse); } catch (e) {}

    return { success: true, frameCount: renamedFrames.length };
}

/**
 * Split a session at a frame index (0-based). Frames [0..splitIndex] stay,
 * frames [splitIndex+1..] go to a new session.
 */
function splitSession(sessionId, splitIndex) {
    loadIndex();
    const indexEntry = sessionIndex.find(e => e.id === sessionId);
    if (!indexEntry) return { success: false, error: 'Session not found' };

    const details = getSessionDetails(sessionId);
    if (!details || !details.frames || details.frames.length === 0) {
        return { success: false, error: 'No frames in session' };
    }

    if (splitIndex < 0 || splitIndex >= details.frames.length - 1) {
        return { success: false, error: 'Split index must be within the session (not first or last frame)' };
    }

    const keepFrames = details.frames.slice(0, splitIndex + 1);
    const movedFrames = details.frames.slice(splitIndex + 1);

    // Create new session for moved frames
    const newSessionId = `session_${new Date().toISOString().replace(/T/, '_').replace(/\..+/, '').replace(/:/g, '-')}`;
    const storagePath = settingsStore.get('storagePath');
    const newSessionPath = path.join(storagePath, newSessionId);
    if (!fs.existsSync(newSessionPath)) {
        fs.mkdirSync(newSessionPath, { recursive: true });
    }

    // Move frame files to new session and rename
    const newFrames = movedFrames.map((frame, i) => {
        const newIdx = String(i + 1).padStart(5, '0');
        const newFilename = `capture_${newIdx}.jpg`;
        const oldPath = path.join(details.path, frame.filename);
        const newPath = path.join(newSessionPath, newFilename);
        try { if (fs.existsSync(oldPath)) fs.renameSync(oldPath, newPath); } catch (e) {}
        return { ...frame, filename: newFilename };
    });

    // Rename kept frames in original session
    const renamedKeepFrames = keepFrames.map((frame, i) => {
        const newIdx = String(i + 1).padStart(5, '0');
        const newFilename = `capture_${newIdx}.jpg`;
        const oldPath = path.join(details.path, frame.filename);
        const newPath = path.join(details.path, newFilename);
        if (frame.filename !== newFilename && fs.existsSync(oldPath)) {
            try { fs.renameSync(oldPath, newPath); } catch (e) {}
        }
        return { ...frame, filename: newFilename };
    });

    // Update original session metadata
    details.frames = renamedKeepFrames;
    details.frameCount = renamedKeepFrames.length;
    if (renamedKeepFrames.length > 0) {
        details.endTime = renamedKeepFrames[renamedKeepFrames.length - 1].timestamp;
    }
    details.hasTimelapse = false;
    details.timelapsePath = null;
    saveSessionMetadata(details);

    // Create new session metadata
    const newSession = {
        id: newSessionId,
        path: newSessionPath,
        startTime: newFrames.length > 0 ? newFrames[0].timestamp : Date.now(),
        endTime: newFrames.length > 0 ? newFrames[newFrames.length - 1].timestamp : Date.now(),
        frameCount: newFrames.length,
        appsUsed: [...new Set(newFrames.map(f => f.appName).filter(a => a && a !== 'Unknown'))],
        frames: newFrames,
        hasTimelapse: false,
        timelapsePath: null
    };
    saveSessionMetadata(newSession);

    // Update index
    indexEntry.frameCount = renamedKeepFrames.length;
    indexEntry.endTime = details.endTime;
    indexEntry.lastFrameFilename = renamedKeepFrames.length > 0 ? renamedKeepFrames[renamedKeepFrames.length - 1].filename : null;
    indexEntry.hasTimelapse = false;
    indexEntry.timelapsePath = null;
    saveIndex();

    // Add new session to index
    sessionIndex.unshift({
        id: newSessionId,
        path: newSessionPath,
        startTime: newSession.startTime,
        endTime: newSession.endTime,
        frameCount: newSession.frameCount,
        appsUsed: newSession.appsUsed,
        hasTimelapse: false,
        timelapsePath: null,
        lastFrameFilename: newFrames.length > 0 ? newFrames[newFrames.length - 1].filename : null
    });
    saveIndex();

    // Delete old timelapses
    const oldTimelapse = path.join(details.path, 'timelapse.mp4');
    try { if (fs.existsSync(oldTimelapse)) fs.unlinkSync(oldTimelapse); } catch (e) {}

    return { success: true, newSessionId, originalFrames: renamedKeepFrames.length, splitFrames: newFrames.length };
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
    getStorageSize,
    trimSession,
    splitSession
};
