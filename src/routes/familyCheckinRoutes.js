const express = require("express");

const db = require("../database/db");

const router = express.Router();
const allowedMoods = new Set([
  "great",
  "good",
  "okay",
  "hard",
]);

function isDateKey(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

router.get("/", (req, res) => {
  const date = String(req.query.date || "");

  if (!isDateKey(date)) {
    return res.status(400).json({
      success: false,
      error: "A valid check-in date is required",
    });
  }

  const checkins = db.prepare(`
    SELECT
      fm.id AS family_member_id,
      fm.name,
      fm.colour,
      fm.initials,
      fm.photo_url,
      fc.id,
      fc.checkin_date,
      fc.mood,
      fc.needs_help,
      fc.note,
      fc.updated_at
    FROM family_members fm
    LEFT JOIN family_checkins fc
      ON fc.family_member_id = fm.id
      AND fc.checkin_date = ?
    WHERE fm.is_active = 1
    ORDER BY fm.display_order ASC, fm.name ASC
  `).all(date);

  res.json({
    success: true,
    date,
    checkins,
  });
});

router.put("/:memberId", (req, res) => {
  const memberId = Number(req.params.memberId);
  const date = String(req.body.date || "");
  const mood = String(req.body.mood || "").toLowerCase();
  const needsHelp = req.body.needsHelp ? 1 : 0;
  const note = String(req.body.note || "").trim();

  if (!Number.isInteger(memberId) || memberId <= 0) {
    return res.status(400).json({
      success: false,
      error: "Invalid family member",
    });
  }

  if (!isDateKey(date)) {
    return res.status(400).json({
      success: false,
      error: "A valid check-in date is required",
    });
  }

  if (!allowedMoods.has(mood)) {
    return res.status(400).json({
      success: false,
      error: "Choose how you are feeling",
    });
  }

  if (note.length > 160) {
    return res.status(400).json({
      success: false,
      error: "Check-in notes can be up to 160 characters",
    });
  }

  const member = db.prepare(`
    SELECT id
    FROM family_members
    WHERE id = ? AND is_active = 1
  `).get(memberId);

  if (!member) {
    return res.status(404).json({
      success: false,
      error: "Family member not found",
    });
  }

  db.prepare(`
    INSERT INTO family_checkins (
      family_member_id,
      checkin_date,
      mood,
      needs_help,
      note
    )
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(family_member_id, checkin_date)
    DO UPDATE SET
      mood = excluded.mood,
      needs_help = excluded.needs_help,
      note = excluded.note,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    memberId,
    date,
    mood,
    needsHelp,
    note || null
  );

  const checkin = db.prepare(`
    SELECT
      id,
      family_member_id,
      checkin_date,
      mood,
      needs_help,
      note,
      updated_at
    FROM family_checkins
    WHERE family_member_id = ? AND checkin_date = ?
  `).get(memberId, date);

  res.json({
    success: true,
    checkin,
  });
});

module.exports = router;
