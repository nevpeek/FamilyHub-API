const express = require("express");
const db = require("../database/db");

const router = express.Router();

router.get("/", (req, res) => {
  const members = db
    .prepare(`
      SELECT
        id,
        name,
        colour,
        initials,
        role,
        is_active,
        display_order,
        created_at,
        updated_at
      FROM family_members
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
        role,
        display_order
      )
      VALUES (?, ?, ?, ?, ?)
    `)
    .run(
      name.trim(),
      colour,
      initials,
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

module.exports = router;