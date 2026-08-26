const express = require("express");
const db = require("../database/db");

const router = express.Router();

function getMealById(id) {
  const meal = db
    .prepare(`
      SELECT
        id,
        title,
        meal_date,
        meal_type,
        description,
        recipe_url,
        created_at,
        updated_at
      FROM meals
      WHERE id = ?
    `)
    .get(id);

  if (!meal) {
    return null;
  }

  const members = db
    .prepare(`
      SELECT
        fm.id,
        fm.name,
        fm.colour,
        fm.initials
      FROM meal_members mm
      JOIN family_members fm
        ON fm.id = mm.family_member_id
      WHERE mm.meal_id = ?
      ORDER BY fm.display_order ASC, fm.name ASC
    `)
    .all(id);

  return {
    ...meal,
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
    start,
    end,
    memberId,
    mealType,
  } = req.query;

  let sql = `
    SELECT DISTINCT
      m.id
    FROM meals m
    LEFT JOIN meal_members mm
      ON mm.meal_id = m.id
    WHERE 1 = 1
  `;

  const params = [];

  if (start) {
    sql += `
      AND m.meal_date >= ?
    `;
    params.push(start);
  }

  if (end) {
    sql += `
      AND m.meal_date <= ?
    `;
    params.push(end);
  }

  if (memberId) {
    sql += `
      AND mm.family_member_id = ?
    `;
    params.push(Number(memberId));
  }

  if (mealType) {
    sql += `
      AND m.meal_type = ?
    `;
    params.push(mealType);
  }

  sql += `
    ORDER BY
      m.meal_date ASC,
      CASE m.meal_type
        WHEN 'breakfast' THEN 1
        WHEN 'lunch' THEN 2
        WHEN 'dinner' THEN 3
        ELSE 4
      END ASC,
      m.created_at ASC
  `;

  const rows = db
    .prepare(sql)
    .all(...params);

  const meals = rows
    .map((row) => getMealById(row.id))
    .filter(Boolean);

  res.json({
    success: true,
    meals,
  });
});

router.get("/:id", (req, res) => {
  const meal = getMealById(Number(req.params.id));

  if (!meal) {
    return res.status(404).json({
      success: false,
      error: "Meal not found",
    });
  }

  res.json({
    success: true,
    meal,
  });
});

router.post("/", (req, res) => {
  const {
    title,
    mealDate,
    mealType = "dinner",
    description = null,
    recipeUrl = null,
    memberIds = [],
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  if (!mealDate) {
    return res.status(400).json({
      success: false,
      error: "Meal date is required",
    });
  }

  const validMealTypes = [
    "breakfast",
    "lunch",
    "dinner",
    "snack",
  ];

  if (!validMealTypes.includes(mealType)) {
    return res.status(400).json({
      success: false,
      error: "Invalid meal type",
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

  const createMeal = db.transaction(() => {
    const result = db
      .prepare(`
        INSERT INTO meals (
          title,
          meal_date,
          meal_type,
          description,
          recipe_url
        )
        VALUES (?, ?, ?, ?, ?)
      `)
      .run(
        title.trim(),
        mealDate,
        mealType,
        description,
        recipeUrl
      );

    const mealId = Number(result.lastInsertRowid);

    const insertMember = db.prepare(`
      INSERT INTO meal_members (
        meal_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (const memberId of memberValidation.memberIds) {
      insertMember.run(mealId, memberId);
    }

    return mealId;
  });

  const mealId = createMeal();

  res.status(201).json({
    success: true,
    meal: getMealById(mealId),
  });
});

router.put("/:id", (req, res) => {
  const mealId = Number(req.params.id);

  const existingMeal = getMealById(mealId);

  if (!existingMeal) {
    return res.status(404).json({
      success: false,
      error: "Meal not found",
    });
  }

  const {
    title,
    mealDate,
    mealType = "dinner",
    description = null,
    recipeUrl = null,
    memberIds = [],
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  if (!mealDate) {
    return res.status(400).json({
      success: false,
      error: "Meal date is required",
    });
  }

  const validMealTypes = [
    "breakfast",
    "lunch",
    "dinner",
    "snack",
  ];

  if (!validMealTypes.includes(mealType)) {
    return res.status(400).json({
      success: false,
      error: "Invalid meal type",
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

  const updateMeal = db.transaction(() => {
    db.prepare(`
      UPDATE meals
      SET
        title = ?,
        meal_date = ?,
        meal_type = ?,
        description = ?,
        recipe_url = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title.trim(),
      mealDate,
      mealType,
      description,
      recipeUrl,
      mealId
    );

    db.prepare(`
      DELETE FROM meal_members
      WHERE meal_id = ?
    `).run(mealId);

    const insertMember = db.prepare(`
      INSERT INTO meal_members (
        meal_id,
        family_member_id
      )
      VALUES (?, ?)
    `);

    for (const memberId of memberValidation.memberIds) {
      insertMember.run(mealId, memberId);
    }
  });

  updateMeal();

  res.json({
    success: true,
    meal: getMealById(mealId),
  });
});

router.delete("/:id", (req, res) => {
  const mealId = Number(req.params.id);

  const existingMeal = getMealById(mealId);

  if (!existingMeal) {
    return res.status(404).json({
      success: false,
      error: "Meal not found",
    });
  }

  db.prepare(`
    DELETE FROM meals
    WHERE id = ?
  `).run(mealId);

  res.json({
    success: true,
  });
});

module.exports = router;