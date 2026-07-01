const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Setup isolated env
let tmpDir;

before(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenie-engine-test-'));
    process.env.APPDATA = tmpDir;
    delete require.cache[require.resolve('../src/main/settingsStore')];
    delete require.cache[require.resolve('../src/main/sessionManager')];
    delete require.cache[require.resolve('../src/main/captureEngine')];
});

after(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    delete process.env.APPDATA;
});

describe('captureEngine - state machine', () => {
    it('exports expected API', () => {
        const ce = require('../src/main/captureEngine');
        assert.equal(typeof ce.start, 'function');
        assert.equal(typeof ce.pause, 'function');
        assert.equal(typeof ce.resume, 'function');
        assert.equal(typeof ce.stop, 'function');
        assert.equal(typeof ce.getState, 'function');
        assert.equal(typeof ce.emitStatus, 'function');
        assert.equal(typeof ce.setEventCallback, 'function');
    });

    it('starts in stopped state', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        const state = ce.getState();
        assert.equal(state.isRecording, false);
        assert.equal(state.isPaused, false);
        assert.equal(state.lastStatus, 'Idle');
    });

    it('start() transitions to recording', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        ce.start();
        const state = ce.getState();
        assert.equal(state.isRecording, true);
        assert.equal(state.isPaused, false);
        ce.stop();
    });

    it('pause() transitions to paused', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        ce.start();
        ce.pause();
        const state = ce.getState();
        assert.equal(state.isRecording, true);
        assert.equal(state.isPaused, true);
        ce.stop();
    });

    it('resume() transitions from paused to recording', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        ce.start();
        ce.pause();
        ce.resume();
        const state = ce.getState();
        assert.equal(state.isRecording, true);
        assert.equal(state.isPaused, false);
        ce.stop();
    });

    it('stop() transitions to stopped', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        ce.start();
        ce.stop();
        const state = ce.getState();
        assert.equal(state.isRecording, false);
        assert.equal(state.isPaused, false);
    });

    it('start() is idempotent (no-op if already recording)', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        ce.start();
        ce.start(); // should not throw
        assert.equal(ce.getState().isRecording, true);
        ce.stop();
    });

    it('pause() is idempotent (no-op if not recording or already paused)', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        ce.pause(); // no-op, not recording
        assert.equal(ce.getState().isRecording, false);
        ce.start();
        ce.pause();
        ce.pause(); // no-op, already paused
        assert.equal(ce.getState().isPaused, true);
        ce.stop();
    });

    it('stop() is idempotent (no-op if not recording)', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        ce.stop(); // no-op
        assert.equal(ce.getState().isRecording, false);
    });

    it('resume() is no-op if not paused', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        ce.start();
        ce.resume(); // no-op, not paused
        assert.equal(ce.getState().isPaused, false);
        ce.stop();
    });

    it('setEventCallback and emitStatus work together', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        let received = null;
        ce.setEventCallback((event, data) => {
            received = { event, data };
        });
        ce.emitStatus();
        assert.ok(received !== null);
        assert.equal(received.event, 'capture-status-update');
        assert.ok(typeof received.data === 'object');
        assert.ok('isRecording' in received.data);
        assert.ok('countdown' in received.data);
    });

    it('emits status with correct shape on start', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        let received = null;
        ce.setEventCallback((event, data) => { received = data; });
        ce.start();
        received = null;
        ce.emitStatus();
        assert.ok(received);
        assert.equal(received.isRecording, true);
        assert.equal(received.isPaused, false);
        assert.ok(typeof received.countdown === 'number');
        assert.ok(typeof received.lastStatus === 'string');
        ce.stop();
    });

    it('emits stop status after stop()', () => {
        delete require.cache[require.resolve('../src/main/captureEngine')];
        const ce = require('../src/main/captureEngine');
        ce.start();
        let received = null;
        ce.setEventCallback((event, data) => { received = data; });
        ce.stop();
        assert.equal(received.isRecording, false);
    });
});
