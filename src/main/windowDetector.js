const koffi = require('koffi');
const path = require('path');

let user32 = null;
let kernel32 = null;
let gdi32 = null;
let isSupported = false;

// Cached function references
let GetForegroundWindow = null;
let GetWindowThreadProcessId = null;
let OpenProcess = null;
let QueryFullProcessImageNameA = null;
let GetWindowTextA = null;
let EnumWindows = null;
let GetWindowRect = null;
let IsWindowVisible = null;
let GetWindowDC = null;
let ReleaseDC = null;
let PrintWindow = null;
let CreateCompatibleDC = null;
let CreateCompatibleBitmap = null;
let SelectObject = null;
let GetBitmapBits = null;
let DeleteDC = null;
let DeleteObject = null;
let CloseHandle = null;
let EnumWindowsProc = null;

try {
    user32 = koffi.load('user32.dll');
    kernel32 = koffi.load('kernel32.dll');
    gdi32 = koffi.load('gdi32.dll');

    const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    GetForegroundWindow = user32.func('__stdcall', 'GetForegroundWindow', 'void *', []);
    GetWindowThreadProcessId = user32.func('__stdcall', 'GetWindowThreadProcessId', 'uint32', ['void *', 'uint32 *']);
    OpenProcess = kernel32.func('__stdcall', 'OpenProcess', 'void *', ['uint32', 'int', 'uint32']);
    QueryFullProcessImageNameA = kernel32.func('__stdcall', 'QueryFullProcessImageNameA', 'int', ['void *', 'uint32', 'char *', 'uint32 *']);
    GetWindowTextA = user32.func('__stdcall', 'GetWindowTextA', 'int', ['void *', 'char *', 'int']);
    GetWindowRect = user32.func('__stdcall', 'GetWindowRect', 'int', ['void *', 'int *']);
    IsWindowVisible = user32.func('__stdcall', 'IsWindowVisible', 'int', ['void *']);
    GetWindowDC = user32.func('__stdcall', 'GetWindowDC', 'void *', ['void *']);
    ReleaseDC = user32.func('__stdcall', 'ReleaseDC', 'int', ['void *', 'void *']);
    PrintWindow = user32.func('__stdcall', 'PrintWindow', 'int', ['void *', 'void *', 'uint32']);
    CloseHandle = kernel32.func('__stdcall', 'CloseHandle', 'int', ['void *']);

    CreateCompatibleDC = gdi32.func('__stdcall', 'CreateCompatibleDC', 'void *', ['void *']);
    CreateCompatibleBitmap = gdi32.func('__stdcall', 'CreateCompatibleBitmap', 'void *', ['void *', 'int', 'int']);
    SelectObject = gdi32.func('__stdcall', 'SelectObject', 'void *', ['void *', 'void *']);
    GetBitmapBits = gdi32.func('__stdcall', 'GetBitmapBits', 'int', ['void *', 'uint32', 'void *']);
    DeleteDC = gdi32.func('__stdcall', 'DeleteDC', 'int', ['void *']);
    DeleteObject = gdi32.func('__stdcall', 'DeleteObject', 'int', ['void *']);

    EnumWindowsProc = koffi.proto('__stdcall', 'EnumWindowsProc', 'int', ['void *', 'void *']);
    EnumWindows = user32.func('__stdcall', 'EnumWindows', 'int', [koffi.pointer(EnumWindowsProc), 'void *']);

    isSupported = true;
} catch (e) {
    console.error('Failed to load Win32 DLLs for window detection:', e);
}

const PROCESS_QUERY_LIMITED_INFORMATION_VAL = 0x1000;
const PW_RENDERFULLCONTENT = 2;

function getProcessName(pid) {
    let processHandle = null;
    try {
        processHandle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION_VAL, 0, pid);
        if (!processHandle) return null;
        const pathBuf = Buffer.alloc(1024);
        const sizeArr = new Uint32Array([1024]);
        if (QueryFullProcessImageNameA(processHandle, 0, pathBuf, sizeArr)) {
            const appPath = pathBuf.toString('utf8', 0, sizeArr[0]).replace(/\0/g, '').trim();
            return path.basename(appPath);
        }
    } catch (e) {
        return null;
    } finally {
        if (processHandle) {
            try { CloseHandle(processHandle); } catch (err) {}
        }
    }
    return null;
}

function getWindowTitle(hwnd) {
    try {
        const titleBuf = Buffer.alloc(512);
        const titleLen = GetWindowTextA(hwnd, titleBuf, 512);
        if (titleLen > 0) {
            return titleBuf.toString('utf8', 0, titleLen).replace(/\0/g, '').trim();
        }
    } catch (e) {}
    return '';
}

/**
 * Returns info about the active foreground window.
 */
function getActiveWindow() {
    if (!isSupported) return null;
    let processHandle = null;
    try {
        const hwnd = GetForegroundWindow();
        if (!hwnd) return null;
        const pidArray = new Uint32Array(1);
        GetWindowThreadProcessId(hwnd, pidArray);
        const pid = pidArray[0];
        if (!pid) return null;
        const title = getWindowTitle(hwnd);
        processHandle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION_VAL, 0, pid);
        let appName = 'Unknown';
        let appPath = '';
        if (processHandle) {
            const pathBuf = Buffer.alloc(1024);
            const sizeArr = new Uint32Array([1024]);
            if (QueryFullProcessImageNameA(processHandle, 0, pathBuf, sizeArr)) {
                appPath = pathBuf.toString('utf8', 0, sizeArr[0]).replace(/\0/g, '').trim();
                appName = path.basename(appPath);
            }
        }
        return { hwnd: koffi.address(hwnd), title, appName, appPath, pid };
    } catch (e) {
        console.error('Error during active window detection:', e);
        return null;
    } finally {
        if (processHandle) {
            try { CloseHandle(processHandle); } catch (err) {}
        }
    }
}

/**
 * Returns an array of visible top-level windows with their info.
 * Each entry: { hwnd, appName, title, rect: { left, top, right, bottom }, pid }
 */
function getVisibleWindows() {
    if (!isSupported) return [];
    const windows = [];
    const results = [];

    const enumResult = EnumWindows((hwnd, lParam) => {
        try {
            if (IsWindowVisible(hwnd)) {
                const pidArray = new Uint32Array(1);
                GetWindowThreadProcessId(hwnd, pidArray);
                const pid = pidArray[0];
                const appName = getProcessName(pid);
                if (appName) {
                    windows.push({
                        hwnd: koffi.address(hwnd),
                        appName,
                        title: getWindowTitle(hwnd),
                        pid
                    });
                }
            }
        } catch (e) {}
        return 1;
    }, 0);

    for (const w of windows) {
        try {
            const rectArr = new Int32Array(4);
            if (GetWindowRect(w.hwnd, rectArr)) {
                const [left, top, right, bottom] = rectArr;
                if (right > left && bottom > top) {
                    if (left > -30000 && top > -30000) {
                        results.push({
                            hwnd: w.hwnd,
                            appName: w.appName,
                            title: w.title,
                            pid: w.pid,
                            rect: { left, top, right, bottom }
                        });
                    }
                }
            }
        } catch (e) {}
    }

    return results;
}

/**
 * Capture a single window's content using PrintWindow with PW_RENDERFULLCONTENT.
 * Returns a Buffer of BGRA pixel data, or null on failure.
 * The buffer is row-major, 4 bytes per pixel (B, G, R, A).
 */
function captureWindow(hwnd, width, height) {
    if (!isSupported || !hwnd || width <= 0 || height <= 0) return null;
    let hdc = null;
    let memDC = null;
    let bitmap = null;
    try {
        hdc = GetWindowDC(hwnd);
        if (!hdc) return null;
        memDC = CreateCompatibleDC(hdc);
        if (!memDC) return null;
        bitmap = CreateCompatibleBitmap(hdc, width, height);
        if (!bitmap) return null;
        SelectObject(memDC, bitmap);

        const printResult = PrintWindow(hwnd, memDC, PW_RENDERFULLCONTENT);
        if (!printResult) return null;

        const bufferSize = width * height * 4;
        const buffer = Buffer.alloc(bufferSize);
        GetBitmapBits(bitmap, bufferSize, buffer);
        return buffer;
    } catch (e) {
        console.error('Failed to capture window:', e);
        return null;
    } finally {
        if (bitmap) try { DeleteObject(bitmap); } catch (err) {}
        if (memDC) try { DeleteDC(memDC); } catch (err) {}
        if (hdc) try { ReleaseDC(hwnd, hdc); } catch (err) {}
    }
}

module.exports = {
    getActiveWindow,
    getVisibleWindows,
    captureWindow,
    isSupported: () => isSupported
};
