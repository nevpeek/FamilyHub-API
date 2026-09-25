const express = require("express");
const db = require("../database/db");

const router = express.Router();

const operations = require("../services/mealOperations");
const { getMealById } = operations;

function handleWrite(action, status = 200) {
  return (req, res) => {
    try {
      return res.status(status).json({ success: true, ...action(req) });
    } catch (error) {
      if (!error.status) console.error("Meal operation failed:", error);
      return res.status(error.status || 500).json({
        success: false,
        error: error.status ? error.message : "Unable to update the dinner plan. Please refresh and try again.",
      });
    }
  };
}

router.post("/operations/move", handleWrite(req => operations.moveMeal(req.body)));
router.post("/operations/apply-template", handleWrite(req => operations.applyTemplate(req.body)));
router.post("/operations/copy-week", handleWrite(req => operations.copyWeek(req.body)));
router.post("/operations/clear-week", handleWrite(req => operations.clearWeek(req.body)));

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

router.post("/", handleWrite(req => ({ meal: operations.createMeal(req.body) }), 201));

// Omitted fields retain their existing values; explicit null still clears a field.
router.put("/:id", handleWrite(req => ({
  meal: operations.updateMeal(Number(req.params.id), req.body),
})));

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