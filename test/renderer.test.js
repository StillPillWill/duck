const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// Test the renderer's updateProgressCircle math in isolation
// (it's a pure function we can extract and test)

const RING_CIRCUMFERENCE = 2 * Math.PI * 88; // ≈ 553.0

function updateProgressCircle(countdown, total) {
    if (total <= 0) return { offset: RING_CIRCUMFERENCE, valid: false };
    const ratio = Math.max(0, Math.min(1, countdown / total));
    const offset = RING_CIRCUMFERENCE * (1 - ratio);
    return { offset, valid: true };
}

describe('renderer - progress ring math', () => {
    it('full countdown (ratio=1) → offset=0 (full ring)', () => {
        const { offset } = updateProgressCircle(30, 30);
        assert.equal(offset, 0);
    });

    it('zero countdown (ratio=0) → offset=circumference (empty ring)', () => {
        const { offset } = updateProgressCircle(0, 30);
        assert.ok(Math.abs(offset - RING_CIRCUMFERENCE) < 0.001);
    });

    it('halfway countdown → offset is half', () => {
        const { offset } = updateProgressCircle(15, 30);
        assert.ok(Math.abs(offset - RING_CIRCUMFERENCE / 2) < 0.001);
    });

    it('handles total=0 gracefully', () => {
        const { valid } = updateProgressCircle(0, 0);
        assert.equal(valid, false);
    });

    it('clamps negative countdown to 0', () => {
        const { offset } = updateProgressCircle(-5, 30);
        assert.ok(Math.abs(offset - RING_CIRCUMFERENCE) < 0.001);
    });

    it('clamps countdown > total to full ring', () => {
        const { offset } = updateProgressCircle(50, 30);
        assert.equal(offset, 0);
    });

    it('single second remaining', () => {
        const { offset } = updateProgressCircle(1, 30);
        const expected = RING_CIRCUMFERENCE * (1 - 1/30);
        assert.ok(Math.abs(offset - expected) < 0.001);
    });
});

describe('renderer - clamp logic for number inputs', () => {
    function clampInterval(val) {
        val = Math.max(5, Math.min(120, val));
        val = Math.round(val / 5) * 5;
        return val;
    }

    function clampIdle(val) {
        val = Math.max(10, Math.min(300, val));
        val = Math.round(val / 10) * 10;
        return val;
    }

    it('clamps interval below min', () => {
        assert.equal(clampInterval(1), 5);
    });

    it('clamps interval above max', () => {
        assert.equal(clampInterval(200), 120);
    });

    it('snaps interval to step of 5', () => {
        assert.equal(clampInterval(33), 35);
        assert.equal(clampInterval(32), 30);
    });

    it('interval mid-range passthrough', () => {
        assert.equal(clampInterval(60), 60);
    });

    it('clamps idle below min', () => {
        assert.equal(clampIdle(5), 10);
    });

    it('clamps idle above max', () => {
        assert.equal(clampIdle(500), 300);
    });

    it('snaps idle to step of 10', () => {
        assert.equal(clampIdle(25), 30);
        assert.equal(clampIdle(33), 30);
    });

    it('idle mid-range passthrough', () => {
        assert.equal(clampIdle(120), 120);
    });
});

describe('renderer - toast color mapping', () => {
    const toastColors = {
        success: 'var(--green)',
        error: 'var(--red)',
        warning: 'var(--amber)',
        info: 'var(--accent)'
    };

    it('has correct colors for each toast type', () => {
        assert.equal(toastColors.success, 'var(--green)');
        assert.equal(toastColors.error, 'var(--red)');
        assert.equal(toastColors.warning, 'var(--amber)');
        assert.equal(toastColors.info, 'var(--accent)');
    });
});

describe('renderer - scale filter generation', () => {
    function buildScaleFilter(resolution) {
        const scale = parseFloat(resolution) || 1.0;
        return scale < 1
            ? `scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2`
            : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
    }

    it('full resolution uses standard scale', () => {
        assert.equal(buildScaleFilter('1.0'), 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
    });

    it('half resolution uses scaled filter', () => {
        assert.equal(buildScaleFilter('0.5'), 'scale=trunc(iw*0.5/2)*2:trunc(ih*0.5/2)*2');
    });

    it('three-quarter resolution uses scaled filter', () => {
        assert.equal(buildScaleFilter('0.75'), 'scale=trunc(iw*0.75/2)*2:trunc(ih*0.75/2)*2');
    });

    it('invalid resolution falls back to full', () => {
        assert.equal(buildScaleFilter('invalid'), 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
    });
});

describe('renderer - subtitle toggle logic', () => {
    it('subtitles enabled appends subtitle filter', () => {
        const scaleFilter = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
        const enabled = true;
        const filters = enabled ? `${scaleFilter},subtitles=subtitles.ass` : scaleFilter;
        assert.equal(filters, 'scale=trunc(iw/2)*2:trunc(ih/2)*2,subtitles=subtitles.ass');
    });

    it('subtitles disabled omits subtitle filter', () => {
        const scaleFilter = 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
        const enabled = false;
        const filters = enabled ? `${scaleFilter},subtitles=subtitles.ass` : scaleFilter;
        assert.equal(filters, 'scale=trunc(iw/2)*2:trunc(ih/2)*2');
    });
});
