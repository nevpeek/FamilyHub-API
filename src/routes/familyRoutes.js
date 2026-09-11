const express = require("express");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const db = require("../database/db");

const router = express.Router();

const memberUploadDir = path.join(
  __dirname,
  "../../uploads/members"
);

fs.mkdirSync(memberUploadDir, {
  recursive: true,
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, memberUploadDir);
  },

  filename: (req, file, cb) => {
    const extension =
      path.extname(file.originalname) || ".jpg";

    cb(
      null,
      `member-${Date.now()}${extension}`
    );
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
});

router.get("/", (req, res) => {
  const members = db
    .prepare(`
SELECT
  id,
  name,
  colour,
  initials,
  photo_url,
  birthday,
  role,
  is_active,
  display_order,
  created_at,
  updated_at
FROM family_members
WHERE is_active = 1
ORDER BY display_order ASC, name ASC
    `)
    .all();

  res.json({
    success: true,
    members,
  });
});

router.post("/", (req, res) => {
const {
  name,
  colour = "#3B82F6",
  initials = null,
  birthday = null,
  role = "member",
  displayOrder = 0,
} = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      error: "Name is required",
    });
  }

  const result = db
    .prepare(`
INSERT INTO family_members (
  name,
  colour,
  initials,
  birthday,
  role,
  display_order
)
VALUES (?, ?, ?, ?, ?, ?)
    `)
.run(
  name.trim(),
  colour,
  initials,
  birthday || null,
  role,
  Number(displayOrder) || 0
);

  const member = db
    .prepare(`
      SELECT *
      FROM family_members
      WHERE id = ?
    `)
    .get(result.lastInsertRowid);

  res.status(201).json({
    success: true,
    member,
  });
});

router.patch("/:id", (req, res) => {
  const memberId = Number(req.params.id);

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid family member ID",
    });
  }

  const existingMember = db
    .prepare(`
      SELECT *
      FROM family_members
      WHERE id = ?
    `)
    .get(memberId);

  if (!existingMember) {
    return res.status(404).json({
      success: false,
      error: "Family member not found",
    });
  }

const {
  name,
  colour,
  initials,
  birthday,
  role,
  isActive,
  displayOrder,
} = req.body;

  const nextName =
    name !== undefined
      ? String(name).trim()
      : existingMember.name;

  if (!nextName) {
    return res.status(400).json({
      success: false,
      error: "Name is required",
    });
  }

  const nextColour =
    colour !== undefined
      ? colour
      : existingMember.colour;

const nextInitials =
  initials !== undefined
    ? initials
    : existingMember.initials;

const nextBirthday =
  birthday !== undefined
    ? birthday || null
    : existingMember.birthday;

const nextRole =
    role !== undefined
      ? role
      : existingMember.role;

  const nextIsActive =
    isActive !== undefined
      ? isActive
        ? 1
        : 0
      : existingMember.is_active;

  const nextDisplayOrder =
    displayOrder !== undefined
      ? Number(displayOrder) || 0
      : existingMember.display_order;

  db.prepare(`
    UPDATE family_members
SET
  name = ?,
  colour = ?,
  initials = ?,
  birthday = ?,
  role = ?,
  is_active = ?,
  display_order = ?,
  updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
  nextName,
  nextColour,
  nextInitials,
  nextBirthday,
  nextRole,
  nextIsActive,
  nextDisplayOrder,
  memberId
);

  const member = db
    .prepare(`
      SELECT *
      FROM family_members
      WHERE id = ?
    `)
    .get(memberId);

  res.json({
    success: true,
    member,
  });
});

router.delete("/:id", (req, res) => {
  const memberId = Number(req.params.id);

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid family member ID",
    });
  }

  const existingMember = db
    .prepare(`
      SELECT *
      FROM family_members
      WHERE id = ?
    `)
    .get(memberId);

  if (!existingMember) {
    return res.status(404).json({
      success: false,
      error: "Family member not found",
    });
  }

  db.prepare(`
    UPDATE family_members
    SET
      is_active = 0,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(memberId);

  res.json({
    success: true,
    memberId,
  });
});

router.post(
  "/:id/photo",
  upload.single("photo"),
  (req, res) => {
    try {
      const memberId = Number(req.params.id);

      if (!Number.isInteger(memberId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid family member id",
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: "No photo uploaded",
        });
      }

      const photoUrl =
        `/uploads/members/${req.file.filename}`;

      const existing = db
        .prepare(`
          SELECT *
          FROM family_members
          WHERE id = ?
        `)
        .get(memberId);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error: "Family member not found",
        });
      }

      if (
        existing.photo_url &&
        existing.photo_url.startsWith(
          "/uploads/members/"
        )
      ) {
        const oldPhotoPath = path.join(
          __dirname,
          "../..",
          existing.photo_url
        );

        if (fs.existsSync(oldPhotoPath)) {
          fs.unlinkSync(oldPhotoPath);
        }
      }

      db.prepare(`
        UPDATE family_members
        SET
          photo_url = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        photoUrl,
        memberId
      );

      const member = db
        .prepare(`
          SELECT *
          FROM family_members
          WHERE id = ?
        `)
        .get(memberId);

      res.json({
        success: true,
        member,
      });
    } catch (err) {
      console.error(err);

      res.status(500).json({
        success: false,
        error: "Unable to upload family photo",
      });
    }
  }
);

module.exports = router;