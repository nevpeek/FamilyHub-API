const express = require("express");
const db = require("../database/db");

const router = express.Router();


// GET all wheel groups
router.get("/", (req, res) => {
  try {
    const groups = db
      .prepare(`
        SELECT
          g.id,
          g.name,
          g.created_at,
          COUNT(gr.recipe_id) AS recipe_count
        FROM meal_wheel_groups g
        LEFT JOIN meal_wheel_group_recipes gr
          ON gr.group_id = g.id
        GROUP BY g.id
        ORDER BY g.name COLLATE NOCASE
      `)
      .all();

    res.json({
      success: true,
      groups,
    });
  } catch (error) {
    console.error(
      "Unable to load meal wheel groups:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Unable to load meal wheel groups",
    });
  }
});


// GET one group with its recipes
router.get("/:id", (req, res) => {
  try {
    const group = db
      .prepare(`
        SELECT *
        FROM meal_wheel_groups
        WHERE id = ?
      `)
      .get(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: "Wheel group not found",
      });
    }

    const recipes = db
      .prepare(`
        SELECT r.*
        FROM recipes r
        INNER JOIN meal_wheel_group_recipes gr
          ON gr.recipe_id = r.id
        WHERE gr.group_id = ?
        ORDER BY r.title COLLATE NOCASE
      `)
      .all(req.params.id);

    res.json({
      success: true,
      group: {
        ...group,
        recipes,
      },
    });
  } catch (error) {
    console.error(
      "Unable to load meal wheel group:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Unable to load meal wheel group",
    });
  }
});


// CREATE group
router.post("/", (req, res) => {
  try {
    const name =
      String(req.body.name || "").trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Group name is required",
      });
    }

    const existing = db
      .prepare(`
        SELECT *
        FROM meal_wheel_groups
        WHERE LOWER(TRIM(name)) =
              LOWER(TRIM(?))
        LIMIT 1
      `)
      .get(name);

    if (existing) {
      return res.status(409).json({
        success: false,
        error:
          "A wheel group with that name already exists",
        group: existing,
      });
    }

    const result = db
      .prepare(`
        INSERT INTO meal_wheel_groups (
          name
        )
        VALUES (?)
      `)
      .run(name);

    const group = db
      .prepare(`
        SELECT *
        FROM meal_wheel_groups
        WHERE id = ?
      `)
      .get(result.lastInsertRowid);

    res.status(201).json({
      success: true,
      group,
    });
  } catch (error) {
    console.error(
      "Unable to create meal wheel group:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Unable to create meal wheel group",
    });
  }
});


// RENAME group
router.put("/:id", (req, res) => {
  try {
    const name =
      String(req.body.name || "").trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        error: "Group name is required",
      });
    }

    const group = db
      .prepare(`
        SELECT *
        FROM meal_wheel_groups
        WHERE id = ?
      `)
      .get(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: "Wheel group not found",
      });
    }

    db.prepare(`
      UPDATE meal_wheel_groups
      SET name = ?
      WHERE id = ?
    `).run(
      name,
      req.params.id
    );

    const updatedGroup = db
      .prepare(`
        SELECT *
        FROM meal_wheel_groups
        WHERE id = ?
      `)
      .get(req.params.id);

    res.json({
      success: true,
      group: updatedGroup,
    });
  } catch (error) {
    console.error(
      "Unable to rename meal wheel group:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Unable to rename meal wheel group",
    });
  }
});


// REPLACE recipes in a group
router.put("/:id/recipes", (req, res) => {
  try {
    const recipeIds =
      Array.isArray(req.body.recipeIds)
        ? req.body.recipeIds
        : [];

    const group = db
      .prepare(`
        SELECT *
        FROM meal_wheel_groups
        WHERE id = ?
      `)
      .get(req.params.id);

    if (!group) {
      return res.status(404).json({
        success: false,
        error: "Wheel group not found",
      });
    }

    const replaceRecipes =
      db.transaction(() => {
        db.prepare(`
          DELETE FROM meal_wheel_group_recipes
          WHERE group_id = ?
        `).run(req.params.id);

        const insert = db.prepare(`
          INSERT OR IGNORE INTO
            meal_wheel_group_recipes (
              group_id,
              recipe_id
            )
          VALUES (?, ?)
        `);

        recipeIds.forEach((recipeId) => {
          insert.run(
            req.params.id,
            recipeId
          );
        });
      });

    replaceRecipes();

    const recipes = db
      .prepare(`
        SELECT r.*
        FROM recipes r
        INNER JOIN meal_wheel_group_recipes gr
          ON gr.recipe_id = r.id
        WHERE gr.group_id = ?
        ORDER BY r.title COLLATE NOCASE
      `)
      .all(req.params.id);

    res.json({
      success: true,
      group: {
        ...group,
        recipes,
      },
    });
  } catch (error) {
    console.error(
      "Unable to update wheel recipes:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Unable to update wheel recipes",
    });
  }
});


// DELETE group
router.delete("/:id", (req, res) => {
  try {
    const result = db
      .prepare(`
        DELETE FROM meal_wheel_groups
        WHERE id = ?
      `)
      .run(req.params.id);

    if (result.changes === 0) {
      return res.status(404).json({
        success: false,
        error: "Wheel group not found",
      });
    }

    res.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "Unable to delete meal wheel group:",
      error
    );

    res.status(500).json({
      success: false,
      error:
        "Unable to delete meal wheel group",
    });
  }
});

module.exports = router;