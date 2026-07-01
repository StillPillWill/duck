const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegStatic = require('ffmpeg-static');
const settingsStore = require('./settingsStore');
const sessionManager = require('./sessionManager');

// Set prebuilt FFmpeg path
ffmpeg.setFfmpegPath(ffmpegStatic);

/**
 * Format seconds into ASS subtitle timestamp: H:MM:SS.CC
 */
function formatASSTime(seconds) {
    const cs = Math.round((seconds % 1) * 100);
    const s = Math.floor(seconds) % 60;
    const m = Math.floor(seconds / 60) % 60;
    const h = Math.floor(seconds / 3600);

    const pad = (num, size) => ('000' + num).slice(-size);
    return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(cs, 2)}`;
}

/**
 * Generate a timelapse MP4 from the screenshots in a session.
 *
 * @param {string} sessionId - The session ID to render
 * @param {string} outputPath - Destination file path (optional, defaults to session folder)
 * @param {object} options - Options: fps (default settings FPS), progressCb (progress callback)
 */
function generateTimelapse(sessionId, outputPath = null, options = {}) {
    return new Promise((resolve, reject) => {
        const session = sessionManager.getSessionDetails(sessionId);
        if (!session) {
            return reject(new Error(`Session ${sessionId} not found.`));
        }

        if (session.frameCount === 0) {
            return reject(new Error(`Session ${sessionId} has no captured frames.`));
        }

        // Read render settings
        const defaultFps = settingsStore.get('timelapseFps') || 1;
        const fps = options.fps || defaultFps;
        const crf = settingsStore.get('timelapseCrf') || 23;
        const preset = settingsStore.get('timelapsePreset') || 'medium';
        const resolution = settingsStore.get('timelapseResolution') || '1.0';
        const subtitlesEnabled = settingsStore.get('timelapseSubtitles') !== false;

        const finalOutputPath = (outputPath || path.join(session.path, 'timelapse.mp4')).replace(/\\/g, '/');

        console.log(`Generating timelapse for session ${sessionId}...`);
        console.log(`FPS: ${fps}, CRF: ${crf}, Preset: ${preset}, Resolution: ${resolution}x, Subtitles: ${subtitlesEnabled}`);

        // Ensure target directory for output exists
        const outDir = path.dirname(finalOutputPath);
        if (!fs.existsSync(outDir)) {
            fs.mkdirSync(outDir, { recursive: true });
        }

        // If the output file already exists, delete it first to prevent FFmpeg prompts
        if (fs.existsSync(finalOutputPath)) {
            try {
                fs.unlinkSync(finalOutputPath);
            } catch (err) {
                console.error(`Failed to delete existing file: ${finalOutputPath}`, err);
            }
        }

        // 1. Generate subtitles.ass file (if enabled)
        const assPath = path.join(session.path, 'subtitles.ass');

        if (subtitlesEnabled) {
            let assContent = [
                '[Script Info]',
                'Title: Screenie Timelapse Subtitles',
                'ScriptType: v4.00+',
                'PlayResX: 1280',
                'PlayResY: 720',
                '',
                '[V4+ Styles]',
                'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
                'Style: Default,Arial,14,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,3,1,0,3,15,15,15,1',
                '',
                '[Events]',
                'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
            ].join('\n') + '\n';

            if (session.frames && session.frames.length > 0) {
                session.frames.forEach((frame, index) => {
                    const startTimeStr = formatASSTime(index / fps);
                    const endTimeStr = formatASSTime((index + 1) / fps);

                    const dateStr = new Date(frame.timestamp).toLocaleString();
                    const appNameStr = frame.appName || 'Unknown';
                    const windowTitleStr = frame.windowTitle ? ` - ${frame.windowTitle}` : '';

                    const escapedTitle = windowTitleStr.replace(/,/g, ' ').replace(/\n/g, ' ');
                    const cleanAppName = appNameStr.replace(/,/g, ' ');

                    // \N represents a newline in ASS subtitle text
                    const text = `${cleanAppName}${escapedTitle}\\N${dateStr}`;

                    assContent += `Dialogue: 0,${startTimeStr},${endTimeStr},Default,,0,0,0,,${text}\n`;
                });
            }

            try {
                fs.writeFileSync(assPath, assContent, 'utf8');
                console.log(`Generated subtitles at: ${assPath}`);
            } catch (err) {
                return reject(new Error(`Failed to write subtitles file: ${err.message}`));
            }
        }

        // 2. Build video filter chain
        const scale = parseFloat(resolution) || 1.0;
        const scaleFilter = scale < 1
            ? `scale=trunc(iw*${scale}/2)*2:trunc(ih*${scale}/2)*2`
            : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
        const filters = subtitlesEnabled
            ? `${scaleFilter},subtitles=subtitles.ass`
            : scaleFilter;

        // 3. Configure fluent-ffmpeg
        const cmd = ffmpeg({ cwd: session.path })
            .input('capture_%05d.jpg')
            .inputFPS(fps)
            .videoCodec('libx264')
            .videoFilters(filters)
            .outputOptions([
                '-pix_fmt yuv420p',
                `-preset ${preset}`,
                `-crf ${crf}`
            ])
            .output(finalOutputPath)
            .on('start', (commandLine) => {
                console.log('Spawned FFmpeg with command: ' + commandLine);
            })
            .on('progress', (progress) => {
                if (options.progressCb && progress.frames) {
                    const percent = Math.min(100, Math.round((progress.frames / session.frameCount) * 100));
                    options.progressCb(percent);
                } else if (options.progressCb && progress.percent) {
                    options.progressCb(Math.round(progress.percent));
                }
            })
            .on('end', () => {
                console.log('Timelapse generation completed successfully!');

                // Clean up temporary ASS file
                if (subtitlesEnabled) {
                    try {
                        if (fs.existsSync(assPath)) {
                            fs.unlinkSync(assPath);
                        }
                    } catch (e) {
                        console.error('Failed to delete temporary ASS file:', e);
                    }
                }

                // Mark in session index
                sessionManager.updateSessionTimelapse(sessionId, finalOutputPath);
                resolve(finalOutputPath);
            })
            .on('error', (err) => {
                console.error('Error rendering timelapse:', err);
                reject(err);
            });

        cmd.run();
    });
}

module.exports = {
    generateTimelapse
};
