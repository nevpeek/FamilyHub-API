const express = require("express");
const db = require("../database/db");

const router = express.Router();

router.get("/", (req, res) => {
  const items = db
    .prepare(`
      SELECT
        id,
        name,
        quantity,
        category,
        notes,
        is_available,
        created_at,
        updated_at
      FROM pantry_items
      ORDER BY
        is_available DESC,
        category ASC,
        name COLLATE NOCASE ASC
    `)
    .all();

  res.json({
    success: true,
    items,
  });
});

router.post("/", (req, res) => {
  const {
    name,
    quantity = null,
    category = "other",
    notes = null,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      error: "Pantry item name is required",
    });
  }

  const existingItem = db
    .prepare(`
      SELECT *
      FROM pantry_items
      WHERE LOWER(TRIM(name)) =
            LOWER(TRIM(?))
      LIMIT 1
    `)
    .get(name.trim());

  if (existingItem) {
    return res.status(409).json({
      success: false,
      error: `${existingItem.name} is already in Pantry`,
      item: existingItem,
    });
  }

  const result = db
    .prepare(`
      INSERT INTO pantry_items (
        name,
        quantity,
        category,
        notes
      )
      VALUES (?, ?, ?, ?)
    `)
    .run(
      name.trim(),
      quantity || null,
      category || "other",
      notes || null
    );

  const item = db
    .prepare(`
      SELECT *
      FROM pantry_items
      WHERE id = ?
    `)
    .get(result.lastInsertRowid);

  res.status(201).json({
    success: true,
    item,
  });
});

router.put("/:id", (req, res) => {
  const itemId = Number(req.params.id);

  const existing = db
    .prepare(`
      SELECT *
      FROM pantry_items
      WHERE id = ?
    `)
    .get(itemId);

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: "Pantry item not found",
    });
  }

  const {
    name,
    quantity = null,
    category = "other",
    notes = null,
    isAvailable = 1,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      error: "Pantry item name is required",
    });
  }

  db.prepare(`
    UPDATE pantry_items
    SET
      name = ?,
      quantity = ?,
      category = ?,
      notes = ?,
      is_available = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name.trim(),
    quantity || null,
    category || "other",
    notes || null,
    isAvailable ? 1 : 0,
    itemId
  );

  const item = db
    .prepare(`
      SELECT *
      FROM pantry_items
      WHERE id = ?
    `)
    .get(itemId);

  res.json({
    success: true,
    item,
  });
});

router.delete("/:id", (req, res) => {
  const itemId = Number(req.params.id);

  const result = db
    .prepare(`
      DELETE FROM pantry_items
      WHERE id = ?
    `)
    .run(itemId);

  if (result.changes === 0) {
    return res.status(404).json({
      success: false,
      error: "Pantry item not found",
    });
  }

  res.json({
    success: true,
  });
});

module.exports = router;