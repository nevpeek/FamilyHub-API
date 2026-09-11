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

function parseIngredientLine(line) {
  const cleaned = String(line || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!cleaned) {
    return null;
  }

    /*
   * Butter recipes often use:
   * 2 tbsp (30g) Unsalted Butter
   *
   * For shopping, prefer grams.
   */
  if (/butter/i.test(cleaned)) {
    const butterMetricMatch =
      cleaned.match(
        /\(?\b(\d+(?:[.,]\d+)?\s*(?:kg|g|mg))\b\)?/i
      );

    if (butterMetricMatch) {
      let butterName = cleaned
        .replace(
          /^\s*(?:\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)\s*(?:tbsp|tablespoons?|tsp|teaspoons?)\s*/i,
          ""
        )
        .replace(
          /\(\s*\d+(?:[.,]\d+)?\s*(?:kg|g|mg)\s*\)/gi,
          ""
        )
        .replace(
          /^\s*\d+(?:[.,]\d+)?\s*(?:kg|g|mg)\s*/i,
          ""
        )
        .replace(/\s+/g, " ")
        .trim();

      return {
        quantity: butterMetricMatch[1]
          .replace(/\s+/g, ""),
        name: butterName,
      };
    }
  }

  /*
   * Prefer the first metric measurement.
   *
   * Examples:
   * 30g (2 tbsp) Unsalted Butter
   * 500g (1 lb) Beef Mince
   * 250ml (1 cup) Milk
   *
   * We want:
   * quantity = 30g
   * name = Unsalted Butter
   */
  const metricMatch = cleaned.match(
    /^(\d+(?:[.,]\d+)?\s*(?:kg|g|mg|ml|l))\s*(?:\([^)]*\))?\s+(.+)$/i
  );

  if (metricMatch) {
    return {
      quantity: metricMatch[1]
        .replace(/\s+/g, "")
        .trim(),
      name: metricMatch[2]
        .trim()
        .replace(/^[x×]\s*/i, "")
        .trim(),
    };
  }

  /*
   * Normal recipe quantities:
   * 1 onion
   * 2 carrots
   * 2 tbsp flour
   * 1 cup stock
   */
  const match = cleaned.match(
    /^((?:\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s+(?:\d+\s*\/\s*\d+|[¼½¾⅓⅔⅛⅜⅝⅞]))?\s*(?:kg|g|mg|ml|l|cup|cups|tbsp|tsp|oz|lb|lbs|clove|cloves|can|cans|packet|packets|bunch|bunches|sprig|sprigs|slice|slices|piece|pieces)?)(?:\s+)(.+)$/i
  );

  if (!match) {
    return {
      name: cleaned,
      quantity: null,
    };
  }

  return {
    quantity: match[1].trim(),
    name: match[2]
      .trim()
      .replace(/^[x×]\s*/i, "")
      .replace(/^\([^)]*\)\s*/g, "")
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .trim(),
  };
}

function normalizeIngredientName(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[,;]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\bcloves\b/g, "clove")
    .replace(/\bonions\b/g, "onion")
    .replace(/\bcarrots\b/g, "carrot")
    .replace(/\bpotatoes\b/g, "potato")
    .replace(/\btomatoes\b/g, "tomato")
    .replace(/\beggs\b/g, "egg");
}

function simplifyRecipeIngredientName(value) {
  let text = String(value || "").trim();

  if (!text) {
    return "";
  }

  // Remove bracketed measurements anywhere.
  text = text.replace(
    /\([^)]*\b(?:g|kg|mg|ml|l|oz|lb|lbs|tsp|tbsp|cup|cups)\b[^)]*\)/gi,
    " "
  );

  // Remove leading quantities + units.
  // Examples:
  // 500g mince
  // 30g butter
  // 2.2 lb potatoes
  // 1.5 lb ground lamb
  // 2 tbsp parmesan
  // 1 1/2 cups milk
  text = text.replace(
    /^\s*(?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*(?:kg|g|mg|ml|l|oz|ounces?|lb|lbs|pounds?|tsp|teaspoons?|tbsp|tablespoons?|cups?|cloves?|sprigs?|cans?|packets?|pieces?|slices?)?\b\.?\s*/i,
    ""
  );

  // Remove leading dash left behind by recipe formatting.
  text = text.replace(/^[–—-]\s*/, "");

  // Remove preparation wording.
  text = text
    .replace(
      /\b(?:finely|roughly|thinly|thickly|freshly)\s+(?:chopped|sliced|diced|grated|crushed|minced|ground)\b/gi,
      ""
    )
    .replace(
      /\b(?:chopped|sliced|diced|grated|crushed)\b/gi,
      ""
    );

  // Simplify common shopping descriptions.
  text = text
    .replace(
      /\bmilk\s+(?:whole|full\s*cream|low\s*fat|skim|skimmed)(?:\s+or\s+(?:whole|full\s*cream|low\s*fat|skim|skimmed))*\b/gi,
      "Milk"
    )
    .replace(
      /\bcooking\s+salt\s*\/\s*kosher\s+salt\b/gi,
      "Salt"
    )
    .replace(
      /\bkosher\s+salt\b/gi,
      "Salt"
    );

  // Recipe alternatives such as:
  // "dried thyme and rosemary or 2 sprigs fresh thyme + 1 sprig rosemary"
  if (
    /thyme/i.test(text) &&
    /rosemary/i.test(text)
  ) {
    text = "Thyme & Rosemary";
  }

  // Remove recipe notes after commas.
  text = text.replace(/\s*,.*$/, "");

  // Remove remaining brackets.
  text = text.replace(/[()]/g, " ");

  // Remove words that only describe recipe quantity.
  text = text.replace(/^\s*each\s+/i, "");

  // Clean whitespace.
  text = text
    .replace(/\s+/g, " ")
    .trim();

  // Title Case.
  text = text
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (!word) {
        return word;
      }

      if (word === "&") {
        return word;
      }

      return (
        word.charAt(0).toUpperCase() +
        word.slice(1)
      );
    })
    .join(" ");

  return text;
}

function inferShoppingCategory(name) {
  const value =
    normalizeIngredientName(name);

  const pantryOverrides = [
    "stock",
    "broth",
    "bouillon",
    "stock cube",
    "stock powder",
  ];

  if (
    pantryOverrides.some((item) =>
      value.includes(item)
    )
  ) {
    return "pantry";
  }

  const produce = [
    "onion",
    "carrot",
    "potato",
    "tomato",
    "garlic",
    "celery",
    "lettuce",
    "spinach",
    "broccoli",
    "cauliflower",
    "capsicum",
    "mushroom",
    "zucchini",
    "cucumber",
    "avocado",
    "lemon",
    "lime",
    "apple",
    "banana",
    "orange",
    "herb",
    "parsley",
    "coriander",
    "basil",
    "thyme",
    "rosemary",
    "bay leave",
  ];

  const meat = [
    "beef",
    "mince",
    "lamb",
    "chicken",
    "pork",
    "bacon",
    "sausage",
    "steak",
    "turkey",
    "ham",
    "fish",
    "salmon",
  ];

  const dairy = [
    "milk",
    "butter",
    "cheese",
    "cream",
    "yoghurt",
    "yogurt",
    "parmesan",
    "egg",
  ];

  const bakery = [
    "bread",
    "roll",
    "bun",
    "wrap",
    "tortilla",
  ];

  const frozen = [
    "frozen",
    "ice cream",
  ];

  const household = [
    "toilet paper",
    "paper towel",
    "dishwasher",
    "detergent",
    "cleaner",
    "garbage bag",
    "bin bag",
    "foil",
    "cling wrap",
  ];

  if (
    produce.some((item) =>
      value.includes(item)
    )
  ) {
    return "produce";
  }

  if (
    meat.some((item) =>
      value.includes(item)
    )
  ) {
    return "meat";
  }

  if (
    dairy.some((item) =>
      value.includes(item)
    )
  ) {
    return "dairy";
  }

  if (
    bakery.some((item) =>
      value.includes(item)
    )
  ) {
    return "bakery";
  }

  if (
    frozen.some((item) =>
      value.includes(item)
    )
  ) {
    return "frozen";
  }

  if (
    household.some((item) =>
      value.includes(item)
    )
  ) {
    return "household";
  }

  return "pantry";
}

function parseQuantity(value) {
  const text =
    String(value || "")
      .trim()
      .toLowerCase();

  if (!text) {
    return null;
  }

  const match = text.match(
    /^(\d+(?:\.\d+)?|\d+\s*\/\s*\d+)\s*([a-z]+)?$/
  );

  if (!match) {
    return null;
  }

  let amount;

  if (match[1].includes("/")) {
    const [top, bottom] =
      match[1]
        .split("/")
        .map(Number);

    if (!bottom) {
      return null;
    }

    amount = top / bottom;
  } else {
    amount = Number(match[1]);
  }

  if (!Number.isFinite(amount)) {
    return null;
  }

  return {
    amount,
    unit: match[2] || "",
  };
}

function formatQuantityNumber(value) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return String(
    Math.round(value * 100) / 100
  );
}

function mergeQuantities(existing, incoming) {
  const first =
    String(existing || "").trim();

  const second =
    String(incoming || "").trim();

  if (!first) {
    return second || null;
  }

  if (!second) {
    return first;
  }

  const parsedFirst =
    parseQuantity(first);

  const parsedSecond =
    parseQuantity(second);

  if (
    parsedFirst &&
    parsedSecond &&
    parsedFirst.unit === parsedSecond.unit
  ) {
    const total =
      parsedFirst.amount +
      parsedSecond.amount;

    return `${formatQuantityNumber(
      total
    )}${parsedFirst.unit}`;
  }

  return `${first} + ${second}`;
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

router.post("/from-meal-plan/preview", (req, res) => {
  const {
    start,
    end,
  } = req.body;

  if (!start || !end) {
    return res.status(400).json({
      success: false,
      error: "Start and end dates are required",
    });
  }

  const meals = db
    .prepare(`
      SELECT
        m.id,
        m.title,
        m.recipe_id,
        m.meal_date,
        r.ingredients
      FROM meals m
      LEFT JOIN recipes r
        ON r.id = m.recipe_id
      WHERE m.meal_date >= ?
        AND m.meal_date <= ?
        AND m.recipe_id IS NOT NULL
        AND r.ingredients IS NOT NULL
        AND TRIM(r.ingredients) <> ''
      ORDER BY
        m.meal_date ASC,
        m.id ASC
    `)
    .all(start, end);

  if (meals.length === 0) {
    return res.status(400).json({
      success: false,
      error:
        "No recipe ingredients were found for this week",
    });
  }

  const combined = new Map();

  for (const meal of meals) {
    const lines =
      String(meal.ingredients)
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);

    for (const line of lines) {
const parsed =
  parseIngredientLine(line);

const simplifiedName =
  simplifyRecipeIngredientName(
    parsed?.name || line
  );

      if (!simplifiedName) {
        continue;
      }

      const normalizedName =
        normalizeIngredientName(
          simplifiedName
        );

      if (!normalizedName) {
        continue;
      }

      const existing =
        combined.get(
          normalizedName
        );

      if (existing) {
        if (
          !existing.recipeTitles.includes(
            meal.title
          )
        ) {
          existing.recipeTitles.push(
            meal.title
          );
        }

        existing.quantity =
          mergeQuantities(
            existing.quantity,
            parsed?.quantity
          );

        existing.occurrences += 1;

        continue;
      }

      combined.set(
        normalizedName,
        {
          name: simplifiedName,
          quantity:
            parsed?.quantity || null,
          normalizedName,
          recipeTitles: [
            meal.title,
          ],
          occurrences: 1,
        }
      );
    }
  }

  const ingredients =
    Array.from(
      combined.values()
    );

  res.json({
    success: true,
    meals: meals.length,
    ingredients,
  });
});

router.post("/from-meal-plan", (req, res) => {
  const {
    start,
    end,
    memberIds = [],
  } = req.body;

  if (!start || !end) {
    return res.status(400).json({
      success: false,
      error: "Start and end dates are required",
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

  const meals = db
    .prepare(`
      SELECT
        m.id,
        m.title,
        m.recipe_id,
        m.meal_date,
        r.ingredients
      FROM meals m
      LEFT JOIN recipes r
        ON r.id = m.recipe_id
      WHERE m.meal_date >= ?
        AND m.meal_date <= ?
        AND m.recipe_id IS NOT NULL
        AND r.ingredients IS NOT NULL
        AND TRIM(r.ingredients) <> ''
      ORDER BY
        m.meal_date ASC,
        m.id ASC
    `)
    .all(start, end);

  if (meals.length === 0) {
    return res.status(400).json({
      success: false,
      error:
        "No recipe ingredients were found for this week",
    });
  }

  const ingredients = [];

  for (const meal of meals) {
    const lines =
      String(meal.ingredients)
        .split(/\r?\n/)
        .map((item) => item.trim())
        .filter(Boolean);

       for (const line of lines) {
      const parsed =
        parseIngredientLine(line);

      if (!parsed) {
        continue;
      }

      ingredients.push({
        name: parsed.name,
        quantity: parsed.quantity,
        normalizedName:
          normalizeIngredientName(
            parsed.name
          ),
        recipeTitle: meal.title,
        mealDate: meal.meal_date,
      });
    }
  }

  const addItems = db.transaction(() => {
    const insertItem = db.prepare(`
      INSERT INTO shopping_items (
        name,
        quantity,
        category,
        notes
      )
      VALUES (?, ?, ?, ?)
    `);

    const insertMember = db.prepare(`
      INSERT INTO shopping_item_members (
        shopping_item_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    let added = 0;
    let merged = 0;

    const activeItems =
      db.prepare(`
        SELECT
          id,
          name,
          quantity,
          notes
        FROM shopping_items
        WHERE is_completed = 0
      `);

    const updateExisting =
      db.prepare(`
        UPDATE shopping_items
        SET
          quantity = ?,
          notes = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `);

    for (const ingredient of ingredients) {
         const existing =
        activeItems
          .all()
          .find((item) => {
            const parsedExisting =
              parseIngredientLine(
                item.name
              );

            const existingName =
              normalizeIngredientName(
                parsedExisting?.name ||
                  item.name
              );

            return (
              existingName ===
              ingredient.normalizedName
            );
          });

      if (existing) {
               const parsedExisting =
          parseIngredientLine(
            existing.name
          );

        const existingQuantity =
          existing.quantity ||
          parsedExisting?.quantity ||
          null;

        const quantity =
          mergeQuantities(
            existingQuantity,
            ingredient.quantity
          );

        const mealNote =
          `Meal plan: ${ingredient.recipeTitle}`;

        const notes =
          existing.notes
            ? existing.notes.includes(
                mealNote
              )
              ? existing.notes
              : `${existing.notes}; ${mealNote}`
            : mealNote;

        updateExisting.run(
          quantity,
          notes,
          existing.id
        );

        merged += 1;
        continue;
      }

      const result =
          insertItem.run(
          ingredient.name,
          ingredient.quantity,
          inferShoppingCategory(
            ingredient.name
          ),
          `Meal plan: ${ingredient.recipeTitle}`
        );

      const shoppingItemId =
        Number(result.lastInsertRowid);

      for (
        const memberId of
        memberValidation.memberIds
      ) {
        insertMember.run(
          shoppingItemId,
          memberId
        );
      }

      added += 1;
    }

    return {
      added,
      merged,
    };
  });

  const result = addItems();

  res.status(201).json({
    success: true,
    added: result.added,
    merged: result.merged,
    meals: meals.length,
  });
});

router.post("/", (req, res) => {
  let {
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

  /*
   * Recipe ingredients usually arrive like:
   *
   * 500g mince
   * 1 onion
   * 2 carrots
   *
   * Split those into clean name + quantity.
   */
  if (!quantity) {
    const parsed =
      parseIngredientLine(name);

    if (parsed) {
      name = parsed.name;

      if (parsed.quantity) {
        quantity =
          parsed.quantity;
      }
    }
  }

    if (
    !category ||
    category === "other"
  ) {
    category =
      inferShoppingCategory(name);
  }

  const normalizedName =
    normalizeIngredientName(name);

  const activeItems =
    db.prepare(`
      SELECT
        id,
        name,
        quantity,
        category,
        notes
      FROM shopping_items
      WHERE is_completed = 0
    `).all();

  const existing =
    activeItems.find((item) => {
      const existingName =
        normalizeIngredientName(
          item.name
        );

      return (
        existingName ===
        normalizedName
      );
    });

  /*
   * Match found:
   * update existing item instead of
   * creating another shopping row.
   */
  if (existing) {
       const existingQuantity =
      existing.quantity || null;

    const mergedQuantity =
      mergeQuantities(
        existingQuantity,
        quantity
      );

    let mergedNotes =
      existing.notes || null;

    if (
      notes &&
      !String(
        mergedNotes || ""
      ).includes(notes)
    ) {
      mergedNotes =
        mergedNotes
          ? `${mergedNotes}; ${notes}`
          : notes;
    }

    const mergeItem =
      db.transaction(() => {
        db.prepare(`
          UPDATE shopping_items
          SET
            name = ?,
            quantity = ?,
            notes = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(
          name.trim(),
          mergedQuantity,
          mergedNotes,
          existing.id
        );

        const existingMember =
          db.prepare(`
            SELECT 1
            FROM shopping_item_members
            WHERE shopping_item_id = ?
              AND family_member_id = ?
          `);

        const insertMember =
          db.prepare(`
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
          if (
            !existingMember.get(
              existing.id,
              memberId
            )
          ) {
            insertMember.run(
              existing.id,
              memberId
            );
          }
        }
      });

    mergeItem();

    return res.json({
      success: true,
      merged: true,
      item:
        getShoppingItemById(
          existing.id
        ),
    });
  }

  /*
   * No matching active item:
   * create a new one.
   */
  const createItem =
    db.transaction(() => {
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

  const shoppingItemId =
    createItem();

  res.status(201).json({
    success: true,
    merged: false,
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

router.delete("/completed/all", (req, res) => {
  try {
    const completedItems = db
      .prepare(`
        SELECT id
        FROM shopping_items
        WHERE is_completed = 1
      `)
      .all();

    if (completedItems.length === 0) {
      return res.json({
        success: true,
        deleted: 0,
      });
    }

    const deleteMembers = db.prepare(`
      DELETE FROM shopping_item_members
      WHERE shopping_item_id = ?
    `);

    const deleteItem = db.prepare(`
      DELETE FROM shopping_items
      WHERE id = ?
    `);

    const clearCompleted =
      db.transaction(() => {
        for (const item of completedItems) {
          deleteMembers.run(item.id);
          deleteItem.run(item.id);
        }
      });

    clearCompleted();

    res.json({
      success: true,
      deleted: completedItems.length,
    });
  } catch (error) {
    console.error(
      "Unable to clear completed shopping items:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Unable to clear completed shopping items",
    });
  }
});

router.delete("/all", (req, res) => {
  try {
    const deleteAll = db.transaction(() => {
      db.prepare(`
        DELETE FROM shopping_item_members
      `).run();

      const result = db.prepare(`
        DELETE FROM shopping_items
      `).run();

      return result.changes;
    });

    const deleted = deleteAll();

    res.json({
      success: true,
      deleted,
    });
  } catch (error) {
    console.error(
      "Failed to delete all shopping items:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Failed to delete all shopping items",
    });
  }
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