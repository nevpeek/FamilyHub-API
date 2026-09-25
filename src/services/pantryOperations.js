const db = require("../database/db");

function parseQuantity(value) {
  const text = String(value || "")
    .trim()
    .toLowerCase();

  if (!text) {
    return null;
  }

  const match = text.match(
    /^(\d+(?:[.,]\d+)?)\s*([a-z]+)?$/
  );

  if (!match) {
    return null;
  }

  const amount = Number(
    match[1].replace(",", ".")
  );

  if (!Number.isFinite(amount)) {
    return null;
  }

  return {
    amount,
    unit: match[2] || "",
  };
}

function formatQuantity(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return String(
    Math.round(value * 100) / 100
  );
}

function mergeQuantities(
  existingQuantity,
  purchasedQuantity
) {
  const existing = parseQuantity(
    existingQuantity
  );
  const purchased = parseQuantity(
    purchasedQuantity
  );
  const bought = purchased || {
    amount: 1,
    unit: "",
  };

  if (!existing) {
    return purchasedQuantity
      ? String(purchasedQuantity).trim()
      : "1";
  }

  if (!existing.unit && !bought.unit) {
    return formatQuantity(
      existing.amount + bought.amount
    );
  }

  if (
    existing.unit &&
    bought.unit &&
    existing.unit === bought.unit
  ) {
    return `${formatQuantity(
      existing.amount + bought.amount
    )}${existing.unit}`;
  }

  if (existing.unit && !purchased) {
    return String(existingQuantity).trim();
  }

  return purchasedQuantity
    ? String(purchasedQuantity).trim()
    : String(existingQuantity).trim();
}

function upsertPantryFromShopping({
  name,
  quantity = null,
  category = "other",
  notes = null,
}) {
  const cleanName = name.trim();
  const existingItem = db
    .prepare(`
      SELECT *
      FROM pantry_items
      WHERE LOWER(TRIM(name)) =
            LOWER(TRIM(?))
      LIMIT 1
    `)
    .get(cleanName);

  if (existingItem) {
    const nextQuantity = mergeQuantities(
      existingItem.quantity,
      quantity
    );

    db.prepare(`
      UPDATE pantry_items
      SET
        quantity = ?,
        category = ?,
        is_available = 1,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      nextQuantity,
      existingItem.category ||
        category ||
        "other",
      existingItem.id
    );

    return {
      created: false,
      updated: true,
      item: db
        .prepare(`
          SELECT *
          FROM pantry_items
          WHERE id = ?
        `)
        .get(existingItem.id),
    };
  }

  const result = db
    .prepare(`
      INSERT INTO pantry_items (
        name,
        quantity,
        category,
        notes,
        is_available,
        low_stock_enabled,
        low_stock_threshold,
        auto_add_to_shopping,
        restock_quantity
      )
      VALUES (
        ?, ?, ?, ?, 1, 1, 1, 1, '1'
      )
    `)
    .run(
      cleanName,
      quantity || "1",
      category || "other",
      notes || null
    );

  return {
    created: true,
    updated: false,
    item: db
      .prepare(`
        SELECT *
        FROM pantry_items
        WHERE id = ?
      `)
      .get(result.lastInsertRowid),
  };
}

module.exports = {
  upsertPantryFromShopping,
};
