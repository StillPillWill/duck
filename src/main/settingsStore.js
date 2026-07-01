const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let storageDir = '';
try {
    storageDir = app ? app.getPath('userData') : path.join(process.env.APPDATA || process.env.USERPROFILE || '.', 'screenie');
} catch (e) {
    storageDir = path.join(process.env.APPDATA || process.env.USERPROFILE || '.', 'screenie');
}

const settingsPath = path.join(storageDir, 'settings.json');

const DEFAULTS = {
    interval: 60, // seconds
    idleThreshold: 300, // seconds
    allowlistEnabled: false,
    allowlist: [], // e.g. ['Code.exe', 'chrome.exe', 'idea64.exe']
    storagePath: path.join(storageDir, 'sessions'),
    maxStorageGb: 10,
    timelapseFps: 1,
    timelapseCrf: 23,
    timelapsePreset: 'medium',
    timelapseResolution: '1.0',
    timelapseSubtitles: true,
    quality: 'medium',
    selectedDisplay: 'primary', // 'primary' or display id like '192837465' or index '0','1',...
    minimizeToTray: true,
    launchOnStartup: false
};

let settings = { ...DEFAULTS };

function load() {
    try {
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        if (fs.existsSync(settingsPath)) {
            const fileData = fs.readFileSync(settingsPath, 'utf8');
            const parsed = JSON.parse(fileData);
            
            // Migrate old default values to new defaults
            let migrated = false;
            if (parsed.interval === 30) {
                parsed.interval = 60;
                migrated = true;
            }
            if (parsed.idleThreshold === 30) {
                parsed.idleThreshold = 300;
                migrated = true;
            }
            
            settings = { ...DEFAULTS, ...parsed };
            if (migrated) {
                save();
            }
        } else {
            settings = { ...DEFAULTS };
            save();
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
        settings = { ...DEFAULTS };
    }
}

function save() {
    try {
        if (!fs.existsSync(storageDir)) {
            fs.mkdirSync(storageDir, { recursive: true });
        }
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

// Initial load
load();

module.exports = {
    get(key) {
        if (key === undefined) {
            return { ...settings };
        }
        return settings[key];
    },
    set(key, value) {
        if (typeof key === 'object') {
            settings = { ...settings, ...key };
        } else {
            settings[key] = value;
        }
        save();
        return settings;
    },
    reset() {
        settings = { ...DEFAULTS };
        save();
        return settings;
    },
    getSettingsPath: () => settingsPath,
    getStorageDir: () => storageDir
};
