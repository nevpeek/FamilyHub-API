const express = require("express");
const db = require("../database/db");

const router = express.Router();

function getShoppingItemById(id) {
  const item = db
    .prepare(`
      SELECT
        id,
        name,
        quantity,
        category,
        notes,
        is_completed,
        completed_at,
        created_at,
        updated_at
      FROM shopping_items
      WHERE id = ?
    `)
    .get(id);

  if (!item) {
    return null;
  }

  const members = db
    .prepare(`
      SELECT
        fm.id,
        fm.name,
        fm.colour,
        fm.initials
      FROM shopping_item_members sim
      JOIN family_members fm
        ON fm.id = sim.family_member_id
      WHERE sim.shopping_item_id = ?
      ORDER BY
        fm.display_order ASC,
        fm.name ASC
    `)
    .all(id);

  return {
    ...item,
    is_completed: Boolean(item.is_completed),
    members,
  };
}

function validateMemberIds(memberIds) {
  if (!Array.isArray(memberIds) || memberIds.length === 0) {
    return {
      valid: false,
      error: "At least one family member is required",
    };
  }

  const uniqueMemberIds = [
    ...new Set(memberIds.map((id) => Number(id))),
  ].filter((id) => Number.isInteger(id) && id > 0);

  if (uniqueMemberIds.length === 0) {
    return {
      valid: false,
      error: "At least one valid family member is required",
    };
  }

  const placeholders = uniqueMemberIds
    .map(() => "?")
    .join(",");

  const rows = db
    .prepare(`
      SELECT id
      FROM family_members
      WHERE id IN (${placeholders})
        AND is_active = 1
    `)
    .all(...uniqueMemberIds);

  if (rows.length !== uniqueMemberIds.length) {
    return {
      valid: false,
      error: "One or more family members are invalid",
    };
  }

  return {
    valid: true,
    memberIds: uniqueMemberIds,
  };
}

router.get("/", (req, res) => {
  const {
    memberId,
    completed,
    category,
  } = req.query;

  let sql = `
    SELECT DISTINCT
      si.id
    FROM shopping_items si
    LEFT JOIN shopping_item_members sim
      ON sim.shopping_item_id = si.id
    WHERE 1 = 1
  `;

  const params = [];

  if (memberId) {
    sql += `
      AND sim.family_member_id = ?
    `;
    params.push(Number(memberId));
  }

  if (completed === "true") {
    sql += `
      AND si.is_completed = 1
    `;
  } else if (completed === "false") {
    sql += `
      AND si.is_completed = 0
    `;
  }

  if (category) {
    sql += `
      AND si.category = ?
    `;
    params.push(category);
  }

  sql += `
    ORDER BY
      si.is_completed ASC,
      CASE si.category
        WHEN 'produce' THEN 1
        WHEN 'meat' THEN 2
        WHEN 'dairy' THEN 3
        WHEN 'bakery' THEN 4
        WHEN 'pantry' THEN 5
        WHEN 'frozen' THEN 6
        WHEN 'household' THEN 7
        ELSE 8
      END ASC,
      si.created_at ASC
  `;

  const rows = db
    .prepare(sql)
    .all(...params);

  const items = rows
    .map((row) =>
      getShoppingItemById(row.id)
    )
    .filter(Boolean);

  res.json({
    success: true,
    items,
  });
});

router.get("/:id", (req, res) => {
  const item = getShoppingItemById(
    Number(req.params.id)
  );

  if (!item) {
    return res.status(404).json({
      success: false,
      error: "Shopping item not found",
    });
  }

  res.json({
    success: true,
    item,
  });
});

router.post("/", (req, res) => {
  const {
    name,
    quantity = null,
    category = "other",
    notes = null,
    memberIds = [],
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      error: "Name is required",
    });
  }

  const memberValidation =
    validateMemberIds(memberIds);

  if (!memberValidation.valid) {
    return res.status(400).json({
      success: false,
      error: memberValidation.error,
    });
  }

  const createItem = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO shopping_items (
          name,
          quantity,
          category,
          notes
        )
        VALUES (?, ?, ?, ?)
      `)
      .run(
        name.trim(),
        quantity,
        category,
        notes
      );

    const shoppingItemId =
      Number(result.lastInsertRowid);

    const insertMember = db.prepare(`
      INSERT INTO shopping_item_members (
        shopping_item_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (
      const memberId of
      memberValidation.memberIds
    ) {
      insertMember.run(
        shoppingItemId,
        memberId
      );
    }

    return shoppingItemId;
  });

  const shoppingItemId = createItem();

  res.status(201).json({
    success: true,
    item:
      getShoppingItemById(
        shoppingItemId
      ),
  });
});

router.put("/:id", (req, res) => {
  const shoppingItemId =
    Number(req.params.id);

  const existingItem =
    getShoppingItemById(
      shoppingItemId
    );

  if (!existingItem) {
    return res.status(404).json({
      success: false,
      error: "Shopping item not found",
    });
  }

  const {
    name,
    quantity = null,
    category = "other",
    notes = null,
    memberIds = [],
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      error: "Name is required",
    });
  }

  const memberValidation =
    validateMemberIds(memberIds);

  if (!memberValidation.valid) {
    return res.status(400).json({
      success: false,
      error: memberValidation.error,
    });
  }

  const updateItem = db.transaction(() => {
    db.prepare(`
      UPDATE shopping_items
      SET
        name = ?,
        quantity = ?,
        category = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      name.trim(),
      quantity,
      category,
      notes,
      shoppingItemId
    );

    db.prepare(`
      DELETE FROM shopping_item_members
      WHERE shopping_item_id = ?
    `).run(shoppingItemId);

    const insertMember = db.prepare(`
      INSERT INTO shopping_item_members (
        shopping_item_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (
      const memberId of
      memberValidation.memberIds
    ) {
      insertMember.run(
        shoppingItemId,
        memberId
      );
    }
  });

  updateItem();

  res.json({
    success: true,
    item:
      getShoppingItemById(
        shoppingItemId
      ),
  });
});

router.patch("/:id/completion", (req, res) => {
  const shoppingItemId =
    Number(req.params.id);

  const completed =
    Boolean(req.body.completed);

  const existingItem =
    getShoppingItemById(
      shoppingItemId
    );

  if (!existingItem) {
    return res.status(404).json({
      success: false,
      error: "Shopping item not found",
    });
  }

  db.prepare(`
    UPDATE shopping_items
    SET
      is_completed = ?,
      completed_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    completed ? 1 : 0,
    completed
      ? new Date().toISOString()
      : null,
    shoppingItemId
  );

  res.json({
    success: true,
    item:
      getShoppingItemById(
        shoppingItemId
      ),
  });
});

router.delete("/:id", (req, res) => {
  const shoppingItemId =
    Number(req.params.id);

  const existingItem =
    getShoppingItemById(
      shoppingItemId
    );

  if (!existingItem) {
    return res.status(404).json({
      success: false,
      error: "Shopping item not found",
    });
  }

  db.prepare(`
    DELETE FROM shopping_items
    WHERE id = ?
  `).run(shoppingItemId);

  res.json({
    success: true,
  });
});

module.exports = router;