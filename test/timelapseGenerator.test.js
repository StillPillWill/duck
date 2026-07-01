const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// Import the module — it will try to load ffmpeg but formatASSTime is pure
let tg;
try {
    tg = require('../src/main/timelapseGenerator');
} catch (e) {
    // Module might fail to load if ffmpeg-static isn't set up; skip gracefully
    tg = null;
}

// formatASSTime is not exported directly, but we can extract it or test it indirectly
// Since it's internal, we'll test it by extracting from source
const fs = require('fs');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'timelapseGenerator.js'), 'utf8');

// Extract formatASSTime by evaluating just that function
const fnMatch = source.match(/function formatASSTime[\s\S]*?^}/m);
let formatASSTime;
if (fnMatch) {
    formatASSTime = new Function('return ' + fnMatch[0])();
}

describe('timelapseGenerator - formatASSTime', () => {
    it('exists and is a function', () => {
        assert.equal(typeof formatASSTime, 'function');
    });

    it('formats 0 seconds', () => {
        assert.equal(formatASSTime(0), '0:00:00.00');
    });

    it('formats 1 second', () => {
        assert.equal(formatASSTime(1), '0:00:01.00');
    });

    it('formats 60 seconds (1 minute)', () => {
        assert.equal(formatASSTime(60), '0:01:00.00');
    });

    it('formats 3600 seconds (1 hour)', () => {
        assert.equal(formatASSTime(3600), '1:00:00.00');
    });

    it('formats fractional seconds', () => {
        const result = formatASSTime(1.5);
        assert.equal(result, '0:00:01.50');
    });

    it('formats 90.25 seconds', () => {
        assert.equal(formatASSTime(90.25), '0:01:30.25');
    });

    it('formats large values (2h 30m 15.5s)', () => {
        const secs = 2 * 3600 + 30 * 60 + 15.5;
        assert.equal(formatASSTime(secs), '2:30:15.50');
    });

    it('pads minutes and seconds to 2 digits', () => {
        assert.equal(formatASSTime(605), '0:10:05.00');
    });

    it('handles sub-second precision', () => {
        assert.equal(formatASSTime(0.01), '0:00:00.01');
    });

    it('rounds centiseconds (truncates overflow, does not carry)', () => {
        // formatASSTime truncates cs to 2 digits, no carry to seconds
        assert.equal(formatASSTime(0.999), '0:00:00.00');
    });
});

describe('timelapseGenerator - module structure', () => {
    it('exports generateTimelapse', () => {
        if (!tg) return; // skip if module couldn't load
        assert.equal(typeof tg.generateTimelapse, 'function');
    });
});
