const express = require("express");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const db = require("../database/db");
const { createCameraStore, CameraInputError } = require("../services/cameraStore");
const cameraSnapshot = require("../services/cameraSnapshot");
const router = express.Router();
router.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

const cameras = createCameraStore(
  db,
  []
);

function ensureGarageCamera() {
  const existingGarage =
    cameras.find("garage");

  if (existingGarage) {
    return;
  }

  const rtspUrl =
    process.env.GARAGE_CAMERA_RTSP;

  if (!rtspUrl) {
    return;
  }

  try {
    db.prepare(`
      INSERT OR IGNORE INTO cameras (
        id,
        name,
        rtsp_url
      )
      VALUES (?, ?, ?)
    `).run(
      "garage",
      "Garage",
      rtspUrl
    );
  } catch {
    console.error(
      "Unable to migrate Garage camera configuration"
    );
  }
}

ensureGarageCamera();

router.get("/", async (req, res) => {
  res.json({
    success: true,
    cameras: cameras.list().map(({ id, name }) => ({
      id,
      name,
    })),
  });
});

router.post("/", (req, res) => {
  try {
    const camera = cameras.add(req.body);
    res.status(201).json({ success: true, camera });
  } catch (error) {
    if (error instanceof CameraInputError) {
      return res.status(error.status).json({ success: false, error: error.message });
    }
    // Database errors may contain connection details; do not log or return them.
    console.error("Unable to save camera configuration");
    res.status(500).json({ success: false, error: "Unable to save the camera. Please try again." });
  }
});

router.put("/:id", (req, res) => {
  try {
    const camera =
      cameras.update(
        req.params.id,
        req.body
      );

    res.json({
      success: true,
      camera,
    });
  } catch (error) {
    if (
      error instanceof
      CameraInputError
    ) {
      return res
        .status(error.status)
        .json({
          success: false,
          error: error.message,
        });
    }

    console.error(
      "Unable to update camera configuration"
    );

    res.status(500).json({
      success: false,
      error:
        "Unable to update the camera. Please try again.",
    });
  }
});

router.delete(
  "/:id",
  (req, res) => {
    try {
      const camera =
        cameras.remove(
          req.params.id
        );

      res.json({
        success: true,
        camera,
      });
    } catch (error) {
      if (
        error instanceof
        CameraInputError
      ) {
        return res
          .status(error.status)
          .json({
            success: false,
            error:
              error.message,
          });
      }

      console.error(
        "Unable to delete camera configuration"
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to delete the camera. Please try again.",
      });
    }
  }
);

router.get(
  "/:id/settings",
  (req, res) => {
    const camera =
      cameras.find(req.params.id);

    if (!camera) {
      return res.status(404).json({
        success: false,
        error: "Camera not found",
      });
    }

    res.json({
      success: true,

      camera: {
        id: camera.id,
        name: camera.name,
        rtspUrl: camera.rtspUrl,
      },
    });
  }
);

router.get("/:id", async (req, res) => {
  const camera = cameras.find(req.params.id);

  if (!camera) {
    return res.status(404).json({
      success: false,
      error: "Camera not found",
    });
  }

  res.json({
    success: true,
    camera: {
      id: camera.id,
      name: camera.name,
    },
  });
});

router.get("/:id/snapshot", async (req, res) => {
  const camera = cameras.find(req.params.id);

  if (!camera) {
    return res.status(404).json({
      success: false,
      error: "Camera not found",
    });
  }

  if (!camera.rtspUrl) {
    return res.status(500).json({
      success: false,
      error: "Camera RTSP URL is not configured",
    });
  }

  cameraSnapshot(req, res, camera.rtspUrl);
});

router.get("/:id/live", (req, res) => {
  const camera = cameras.find(req.params.id);

  if (!camera) {
    return res.status(404).json({
      success: false,
      error: "Camera not found",
    });
  }

  if (!camera.rtspUrl) {
    return res.status(500).json({
      success: false,
      error: "Camera RTSP URL is not configured",
    });
  }

  res.setHeader("Content-Type", "application/octet-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");

  const ffmpeg = spawn(ffmpegPath, [
    "-hide_banner",
    "-loglevel",
    "error",

    "-rtsp_transport",
    "tcp",

    "-i",
    camera.rtspUrl,

    "-an",

    "-vf",
    "fps=8",

    "-q:v",
    "3",

    "-f",
    "image2pipe",

    "-vcodec",
    "mjpeg",

    "pipe:1",
  ]);

  ffmpeg.stdout.pipe(res);

  ffmpeg.stderr.on("data", () => {
    // FFmpeg output can include stream credentials. Consume it without logging.
  });

  ffmpeg.on("error", (error) => {
    console.error("Unable to start camera live stream");

    if (!res.headersSent) {
      res.status(500).end();
    }
  });

  const stopStream = () => {
    if (!ffmpeg.killed) {
      ffmpeg.kill("SIGTERM");
    }
  };

  req.on("close", stopStream);
  res.on("close", stopStream);
});

module.exports = router;