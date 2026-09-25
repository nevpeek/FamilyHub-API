const { randomUUID } = require("crypto");

class CameraInputError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function validateCamera(input) {
  const name =
    typeof input?.name === "string"
      ? input.name.trim()
      : "";

  const rtspUrl =
    typeof input?.rtspUrl === "string"
      ? input.rtspUrl.trim()
      : "";

  if (
    !name ||
    name.length > 80 ||
    /[\x00-\x1f\x7f]/.test(name)
  ) {
    throw new CameraInputError(
      "Enter a camera name between 1 and 80 characters."
    );
  }

  let parsed;

  try {
    parsed = new URL(rtspUrl);
  } catch {
    // Report a safe message below.
  }

  if (
    !parsed ||
    !["rtsp:", "rtsps:"].includes(
      parsed.protocol
    ) ||
    !parsed.hostname ||
    rtspUrl.length > 4096 ||
    /\s|[\x00-\x1f\x7f]/.test(
      rtspUrl
    ) ||
    parsed.hash
  ) {
    throw new CameraInputError(
      "Enter a valid RTSP stream URL starting with rtsp:// or rtsps://."
    );
  }

  return {
    name,
    rtspUrl,
  };
}

function createCameraStore(
  db,
  legacyCameras
) {
  const listSaved = db.prepare(`
    SELECT
      id,
      name,
      rtsp_url AS rtspUrl
    FROM cameras
    ORDER BY created_at, rowid
  `);

  const findSaved = db.prepare(`
    SELECT
      id,
      name,
      rtsp_url AS rtspUrl
    FROM cameras
    WHERE id = ?
  `);

  const insert = db.prepare(`
    INSERT INTO cameras (
      id,
      name,
      rtsp_url
    )
    VALUES (?, ?, ?)
  `);

  const updateSaved = db.prepare(`
    UPDATE cameras
    SET
      name = ?,
      rtsp_url = ?
    WHERE id = ?
  `);

  const list = () => [
    ...legacyCameras,
    ...listSaved.all(),
  ];

  const find = (id) =>
    list().find(
      (camera) =>
        camera.id === id
    );

  const add = db.transaction(
    (input) => {
      const camera =
        validateCamera(input);

      const existing = list();

      if (
        existing.some(
          (item) =>
            item.name.toLowerCase() ===
            camera.name.toLowerCase()
        )
      ) {
        throw new CameraInputError(
          "A camera with that name already exists. Choose a different name.",
          409
        );
      }

      if (
        existing.some(
          (item) =>
            item.rtspUrl ===
            camera.rtspUrl
        )
      ) {
        throw new CameraInputError(
          "That camera stream has already been added.",
          409
        );
      }

      const id = randomUUID();

      insert.run(
        id,
        camera.name,
        camera.rtspUrl
      );

      return {
        id,
        name: camera.name,
      };
    }
  );

  const update = db.transaction(
    (id, input) => {
      const existingCamera =
        find(id);

      if (!existingCamera) {
        throw new CameraInputError(
          "Camera not found.",
          404
        );
      }

      const savedCamera =
        findSaved.get(id);

      if (!savedCamera) {
        throw new CameraInputError(
          "This camera is currently managed by the server configuration and cannot be edited yet.",
          409
        );
      }

      const camera =
        validateCamera(input);

      const otherCameras =
        list().filter(
          (item) =>
            item.id !== id
        );

      if (
        otherCameras.some(
          (item) =>
            item.name.toLowerCase() ===
            camera.name.toLowerCase()
        )
      ) {
        throw new CameraInputError(
          "A camera with that name already exists. Choose a different name.",
          409
        );
      }

      if (
        otherCameras.some(
          (item) =>
            item.rtspUrl ===
            camera.rtspUrl
        )
      ) {
        throw new CameraInputError(
          "That camera stream is already being used by another camera.",
          409
        );
      }

      updateSaved.run(
        camera.name,
        camera.rtspUrl,
        id
      );

      return {
        id,
        name: camera.name,
      };
    }
  );

  const remove = db.transaction(
    (id) => {
      const existingCamera =
        find(id);

      if (!existingCamera) {
        throw new CameraInputError(
          "Camera not found.",
          404
        );
      }

      const savedCamera =
        findSaved.get(id);

      if (!savedCamera) {
        throw new CameraInputError(
          "This camera cannot be deleted.",
          409
        );
      }

      const result =
        db.prepare(`
          DELETE FROM cameras
          WHERE id = ?
        `).run(id);

      if (
        result.changes !== 1
      ) {
        throw new CameraInputError(
          "Unable to delete camera.",
          500
        );
      }

      return {
        id: existingCamera.id,
        name: existingCamera.name,
      };
    }
  );

  return {
    list,
    find,
    add,
    update,
    remove,
  };
}

module.exports = {
  createCameraStore,
  CameraInputError,
};