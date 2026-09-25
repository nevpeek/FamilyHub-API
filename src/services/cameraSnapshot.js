const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

function cameraSnapshot(req, res, rtspUrl, options = {}) {
  const startProcess = options.spawn || spawn;
  const timeoutMs = options.timeoutMs ?? 12000;
  let child;
  let settled = false;
  let timer;
  let size = 0;
  const chunks = [];

  function stop() {
    clearTimeout(timer);
    if (child && child.exitCode == null && !child.killed) child.kill();
  }
  function fail(status, message) {
    if (settled) return;
    settled = true;
    stop();
    if (!res.destroyed) res.status(status).json({ success: false, error: message });
  }
  res.once("close", () => { settled = true; stop(); });
  try {
    child = startProcess(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-rtsp_transport", "tcp",
      "-i", rtspUrl, "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
    ]);
  } catch {
    fail(502, "Unable to start camera preview.");
    return;
  }
  timer = setTimeout(() => fail(504, "Camera did not respond. Check its stream URL and connection."), timeoutMs);
  child.stderr.on("data", () => { /* Stream URLs may contain credentials. */ });
  child.stdout.on("data", (chunk) => {
    if (settled) return;
    size += chunk.length;
    if (size > 8 * 1024 * 1024) { fail(502, "Camera preview is too large."); return; }
    chunks.push(chunk);
  });
  child.on("error", () => fail(502, "Unable to start camera preview."));
  child.on("close", (code) => {
    if (settled) return;
    const frame = Buffer.concat(chunks);
    if (code !== 0 || frame.length < 4 || frame[0] !== 0xff || frame[1] !== 0xd8 ||
        frame[frame.length - 2] !== 0xff || frame[frame.length - 1] !== 0xd9) {
      fail(502, "Camera preview unavailable. Check its stream URL and connection.");
      return;
    }
    settled = true;
    clearTimeout(timer);
    res.setHeader("Cache-Control", "no-store");
    res.type("image/jpeg").send(frame);
  });
}

module.exports = cameraSnapshot;
