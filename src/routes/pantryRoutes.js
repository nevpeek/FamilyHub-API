const express = require("express");
const db = require("../database/db");
const {
  upsertPantryFromShopping,
} = require("../services/pantryOperations");

const router = express.Router();

function getPantryQuantityNumber(
  quantity
) {
  if (
    quantity === null ||
    quantity === undefined ||
    quantity === ""
  ) {
    return null;
  }

  const match = String(quantity)
    .trim()
    .replace(",", ".")
    .match(/-?\d+(?:\.\d+)?/);

  if (!match) {
    return null;
  }

  const value = Number(match[0]);

  return Number.isFinite(value)
    ? value
    : null;
}

function isPantryItemRunningLow(
  item
) {
  if (
    !item ||
    !Number(item.is_available)
  ) {
    return false;
  }

  const quantity =
    getPantryQuantityNumber(
      item.quantity
    );

  /*
   * Running Low is a standard
   * Pantry feature.
   *
   * Older items without a stored
   * threshold fall back to 1.
   */
  const threshold =
    item.low_stock_threshold !== null &&
    item.low_stock_threshold !==
      undefined &&
    item.low_stock_threshold !== ""
      ? Number(
          item.low_stock_threshold
        )
      : 1;

  if (
    quantity === null ||
    !Number.isFinite(threshold)
  ) {
    return false;
  }

  return quantity <= threshold;
}

function normalizePantryShoppingName(
  value
) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function ensureLowPantryItemOnShoppingList(
  pantryItem
) {
  if (
    !pantryItem ||
    !Number(
      pantryItem.auto_add_to_shopping
    ) ||
    !isPantryItemRunningLow(
      pantryItem
    )
  ) {
    return {
      added: false,
      reason: "not-required",
    };
  }

  const normalizedName =
    normalizePantryShoppingName(
      pantryItem.name
    );

  const activeShoppingItems =
    db.prepare(`
      SELECT
        id,
        name
      FROM shopping_items
      WHERE is_completed = 0
    `).all();

  const existing =
    activeShoppingItems.find(
      (shoppingItem) =>
        normalizePantryShoppingName(
          shoppingItem.name
        ) === normalizedName
    );

  if (existing) {
    return {
      added: false,
      reason: "already-exists",
      shoppingItemId:
        existing.id,
    };
  }

  const activeMembers =
    db.prepare(`
      SELECT id
      FROM family_members
      WHERE is_active = 1
      ORDER BY
        display_order ASC,
        name ASC
    `).all();

  if (
    activeMembers.length === 0
  ) {
    console.warn(
      `Unable to automatically add "${pantryItem.name}" to Shopping: no active family members`
    );

    return {
      added: false,
      reason: "no-active-members",
    };
  }

const createShoppingItem =
  db.transaction(() => {
    const shoppingQuantity =
      pantryItem.restock_quantity &&
      String(
        pantryItem.restock_quantity
      ).trim()
        ? String(
            pantryItem.restock_quantity
          ).trim()
        : null;

    const result =
      db.prepare(`
        INSERT INTO shopping_items (
          name,
          quantity,
          category,
          notes
        )
        VALUES (?, ?, ?, ?)
      `).run(
        pantryItem.name.trim(),
        shoppingQuantity,
        pantryItem.category ||
          "other",
        "Automatically added from Pantry · Running Low"
      );

    const shoppingItemId =
      Number(
        result.lastInsertRowid
      );

    const insertMember =
      db.prepare(`
        INSERT INTO shopping_item_members (
          shopping_item_id,
          family_member_id
        )
        VALUES (?, ?)
      `);

    for (
      const member of
      activeMembers
    ) {
      insertMember.run(
        shoppingItemId,
        member.id
      );
    }

    return shoppingItemId;
  });

  const shoppingItemId =
    createShoppingItem();

  console.log(
    `Automatically added "${pantryItem.name}" to Shopping because it is Running Low`
  );

  return {
    added: true,
    reason: "running-low",
    shoppingItemId,
  };
}

router.get("/", (req, res) => {
  let items = db
    .prepare(`
      SELECT
        id,
        name,
        quantity,
        pack_size,
        category,
        notes,
        is_available,
        low_stock_enabled,
        low_stock_threshold,
        auto_add_to_shopping,
        restock_quantity,
        created_at,
        updated_at
      FROM pantry_items
      ORDER BY
        is_available DESC,
        category ASC,
        name COLLATE NOCASE ASC
    `)
    .all();

  /*
   * Universal Pantry Running Low sweep.
   *
   * Every time Pantry is loaded, check
   * every available item.
   *
   * If an item is Running Low and has
   * automatic Shopping enabled,
   * ensure it exists on the active
   * Shopping List.
   *
   * ensureLowPantryItemOnShoppingList()
   * already prevents duplicate active
   * Shopping items.
   */
  const automaticShopping = [];

  for (const item of items) {
    if (!Number(item.is_available)) {
      continue;
    }

    const result =
      ensureLowPantryItemOnShoppingList(
        item
      );

    if (result.added) {
      automaticShopping.push({
        pantryItemId: item.id,
        pantryItemName: item.name,
        shoppingItemId:
          result.shoppingItemId,
      });
    }
  }

  /*
   * Re-read Pantry after the sweep.
   * This keeps the response based on
   * the latest database state.
   */
  if (automaticShopping.length > 0) {
    items = db
      .prepare(`
        SELECT
          id,
          name,
          quantity,
          pack_size,
          category,
          notes,
          is_available,
          low_stock_enabled,
          low_stock_threshold,
          auto_add_to_shopping,
          restock_quantity,
          created_at,
          updated_at
        FROM pantry_items
        ORDER BY
          is_available DESC,
          category ASC,
          name COLLATE NOCASE ASC
      `)
      .all();
  }

  res.json({
    success: true,
    items,
    automaticShopping,
  });
});

router.post("/", (req, res) => {
const {
  name,
  quantity = "1",
  packSize = null,
  category = "other",
  notes = null,
  lowStockThreshold = 1,
  autoAddToShopping = 1,
  restockQuantity = "1",
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
        pack_size,
        category,
        notes,
        low_stock_enabled,
        low_stock_threshold,
        auto_add_to_shopping,
        restock_quantity
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
.run(
  name.trim(),

  quantity !== null &&
    quantity !== undefined &&
    String(quantity).trim() !== ""
    ? String(quantity).trim()
    : "1",

  packSize &&
    String(packSize).trim()
    ? String(packSize).trim()
    : null,

  category || "other",

  notes || null,

  /*
   * Legacy database field.
   * Every Pantry item now uses
   * Running Low.
   */
  1,

  lowStockThreshold !== null &&
    lowStockThreshold !== ""
    ? Number(lowStockThreshold)
    : 1,

  autoAddToShopping
    ? 1
    : 0,

  restockQuantity &&
    String(restockQuantity).trim()
    ? String(restockQuantity).trim()
    : "1"
);

  const item = db
    .prepare(`
      SELECT *
      FROM pantry_items
      WHERE id = ?
    `)
    .get(result.lastInsertRowid);

  const automaticShopping =
    ensureLowPantryItemOnShoppingList(
      item
    );

  res.status(201).json({
    success: true,
    item,
    automaticShopping,
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
  quantity = "1",
  packSize = null,
  category = "other",
  notes = null,
  isAvailable = 1,
  lowStockThreshold = 1,
  autoAddToShopping = 1,
  restockQuantity = "1",
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
    pack_size = ?,
    category = ?,
    notes = ?,
    is_available = ?,
    low_stock_enabled = ?,
    low_stock_threshold = ?,
    auto_add_to_shopping = ?,
    restock_quantity = ?,
    updated_at = CURRENT_TIMESTAMP
  WHERE id = ?
`).run(
  name.trim(),

  quantity !== null &&
    quantity !== undefined &&
    String(quantity).trim() !== ""
    ? String(quantity).trim()
    : "1",

  packSize &&
    String(packSize).trim()
    ? String(packSize).trim()
    : null,

  category || "other",

  notes || null,

  isAvailable ? 1 : 0,

  /*
   * Legacy database field.
   * Always enabled.
   */
  1,

  lowStockThreshold !== null &&
    lowStockThreshold !== ""
    ? Number(lowStockThreshold)
    : 1,

  autoAddToShopping
    ? 1
    : 0,

  restockQuantity &&
    String(restockQuantity).trim()
    ? String(restockQuantity).trim()
    : "1",

  itemId
);

  const item = db
    .prepare(`
      SELECT *
      FROM pantry_items
      WHERE id = ?
    `)
    .get(itemId);

  const automaticShopping =
    ensureLowPantryItemOnShoppingList(
      item
    );

  res.json({
    success: true,
    item,
    automaticShopping,
  });
});

router.post(
  "/from-shopping",
  (req, res) => {
    const {
      name,
      quantity = null,
      category = "other",
      notes = null,
    } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        error:
          "Pantry item name is required",
      });
    }

    const result =
      upsertPantryFromShopping({
        name,
        quantity,
        category,
        notes,
      });

    res
      .status(result.created ? 201 : 200)
      .json({
        success: true,
        ...result,
      });
  }
);

router.patch(
  "/:id/quantity",
  (req, res) => {
    const itemId =
      Number(req.params.id);

    const adjustment =
      Number(req.body.adjustment);

    if (
      !Number.isFinite(adjustment) ||
      ![-1, 1].includes(adjustment)
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Quantity adjustment must be -1 or 1",
      });
    }

    const existing =
      db.prepare(`
        SELECT *
        FROM pantry_items
        WHERE id = ?
      `).get(itemId);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error:
          "Pantry item not found",
      });
    }

    const currentQuantity =
      getPantryQuantityNumber(
        existing.quantity
      );

    if (currentQuantity === null) {
      return res.status(400).json({
        success: false,
        error:
          "This Pantry item does not have a numeric quantity",
      });
    }

    const nextQuantity =
      Math.max(
        0,
        currentQuantity +
          adjustment
      );

    db.prepare(`
      UPDATE pantry_items
      SET
        quantity = ?,
        updated_at =
          CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      String(nextQuantity),
      itemId
    );

    const item =
      db.prepare(`
        SELECT *
        FROM pantry_items
        WHERE id = ?
      `).get(itemId);

    const automaticShopping =
      ensureLowPantryItemOnShoppingList(
        item
      );

    res.json({
      success: true,
      item,
      adjustment,
      automaticShopping,
    });
  }
);

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
      error:
        "Pantry item not found",
    });
  }

  res.json({
    success: true,
  });
});

module.exports = router;
