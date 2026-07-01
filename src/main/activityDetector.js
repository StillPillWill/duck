const koffi = require('koffi');

let GetLastInputInfo = null;
let GetTickCount = null;
let LASTINPUTINFO = null;
let isSupported = false;

try {
    const user32 = koffi.load('user32.dll');
    const kernel32 = koffi.load('kernel32.dll');

    LASTINPUTINFO = koffi.struct('LASTINPUTINFO', {
        cbSize: 'uint',
        dwTime: 'uint'
    });

    GetLastInputInfo = user32.func('__stdcall', 'GetLastInputInfo', 'int', [koffi.out(koffi.pointer(LASTINPUTINFO))]);
    GetTickCount = kernel32.func('__stdcall', 'GetTickCount', 'uint', []);
    isSupported = true;
} catch (e) {
    console.error('Failed to load Win32 DLLs for activity detection:', e);
}

/**
 * Returns idle time in milliseconds.
 * Returns 0 if active or if the platform is not supported.
 */
function getIdleTime() {
    if (!isSupported) {
        return 0; // Fallback to active on unsupported platforms
    }

    try {
        let lii = { cbSize: 8, dwTime: 0 };
        if (GetLastInputInfo(lii)) {
            const tickCount = GetTickCount();
            let idle = 0;
            if (tickCount >= lii.dwTime) {
                idle = tickCount - lii.dwTime;
            } else {
                idle = (0xFFFFFFFF - lii.dwTime) + tickCount;
            }
            return idle;
        }
    } catch (e) {
        console.error('Error getting idle time:', e);
    }
    return 0;
}

module.exports = {
    getIdleTime,
    isActive: (thresholdMs) => getIdleTime() < thresholdMs,
    isSupported: () => isSupported
};
