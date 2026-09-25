const express = require("express");
const db = require("../database/db");

const router = express.Router();

function getTemplateById(templateId) {
  const template = db
    .prepare(`
      SELECT
        id,
        name,
        created_at,
        updated_at
      FROM meal_week_templates
      WHERE id = ?
    `)
    .get(templateId);

  if (!template) {
    return null;
  }

  const items = db
    .prepare(`
      SELECT
        id,
        template_id,
        day_offset,
        title,
        meal_type,
        meal_time,
        description,
        recipe_url,
        ingredients,
        recipe_id,
        reminder_enabled,
        reminder_minutes,
        created_at
      FROM meal_week_template_items
      WHERE template_id = ?
      ORDER BY day_offset ASC, id ASC
    `)
    .all(templateId);

  const memberQuery = db.prepare(`
    SELECT
      fm.id,
      fm.name,
      fm.colour,
      fm.initials,
      fm.photo_url
    FROM meal_week_template_item_members mtm
    JOIN family_members fm
      ON fm.id = mtm.family_member_id
    WHERE mtm.template_item_id = ?
    ORDER BY
      fm.display_order ASC,
      fm.name ASC
  `);

  return {
    ...template,

    meals: items.map((item) => ({
      ...item,
      members: memberQuery.all(item.id),
    })),
  };
}

/* =========================================================
   GET ALL WEEK TEMPLATES
   ========================================================= */

router.get("/", (req, res) => {
  const rows = db
    .prepare(`
      SELECT id
      FROM meal_week_templates
      ORDER BY
        updated_at DESC,
        name ASC
    `)
    .all();

  const templates = rows
    .map((row) =>
      getTemplateById(row.id)
    )
    .filter(Boolean);

  res.json({
    success: true,
    templates,
  });
});

/* =========================================================
   GET ONE WEEK TEMPLATE
   ========================================================= */

router.get("/:id", (req, res) => {
  const templateId =
    Number(req.params.id);

  const template =
    getTemplateById(templateId);

  if (!template) {
    return res.status(404).json({
      success: false,
      error: "Week template not found",
    });
  }

  res.json({
    success: true,
    template,
  });
});

/* =========================================================
   CREATE WEEK TEMPLATE
   ========================================================= */

function templateError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

// Validate the entire plan before changing any saved rows. Foreign keys remain
// the final safeguard, and the transaction also rolls back unexpected failures.
function validateTemplate(body) {
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    throw templateError("Template name is required");
  }
  if (!Array.isArray(body.meals) || body.meals.length === 0) {
    throw templateError("At least one dinner is required");
  }
  for (const meal of body.meals) {
    if (!meal || typeof meal !== "object") {
      throw templateError("Invalid template dinner");
    }
    if (!Number.isInteger(meal.dayOffset) || meal.dayOffset < 0 || meal.dayOffset > 6) {
      throw templateError("Invalid template day");
    }
    if (typeof meal.title !== "string" || !meal.title.trim()) {
      throw templateError("Every template dinner needs a title");
    }
    for (const field of ["mealTime", "description", "recipeUrl", "ingredients"]) {
      if (meal[field] != null && typeof meal[field] !== "string") {
        throw templateError(`Invalid dinner ${field}`);
      }
    }
    if (meal.mealTime && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(meal.mealTime)) {
      throw templateError("Invalid dinner time");
    }
    if (meal.reminderEnabled != null && typeof meal.reminderEnabled !== "boolean") {
      throw templateError("Invalid reminder setting");
    }
    if (meal.reminderMinutes != null &&
        (!Number.isSafeInteger(meal.reminderMinutes) || meal.reminderMinutes < 0)) {
      throw templateError("Invalid reminder minutes");
    }
    if (meal.recipeId != null &&
        (!Number.isSafeInteger(meal.recipeId) || meal.recipeId <= 0 ||
         !db.prepare("SELECT id FROM recipes WHERE id = ?").get(meal.recipeId))) {
      throw templateError("A selected recipe no longer exists");
    }
    if (meal.memberIds != null && !Array.isArray(meal.memberIds)) {
      throw templateError("Invalid dinner members");
    }
    for (const memberId of meal.memberIds || []) {
      if (!Number.isSafeInteger(memberId) || memberId <= 0 ||
          !db.prepare("SELECT id FROM family_members WHERE id = ?").get(memberId)) {
        throw templateError("A selected family member no longer exists");
      }
    }
  }
}

function saveTemplate(req, res) {
  const replacing = req.method === "PUT";
  const requestedId = Number(req.params.id);
  if (replacing && (!Number.isSafeInteger(requestedId) || requestedId <= 0)) {
    return res.status(400).json({ success: false, error: "Invalid week template ID" });
  }

  const save = db.transaction(() => {
    if (replacing && !db.prepare("SELECT id FROM meal_week_templates WHERE id = ?").get(requestedId)) {
      throw templateError("Week template not found", 404);
    }
    validateTemplate(req.body);
    const { name, meals } = req.body;
    let templateId = requestedId;
    if (replacing) {
      db.prepare(`
        UPDATE meal_week_templates
        SET name = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(name.trim(), templateId);
      // Member links cascade with the old items; the parent ID is retained.
      db.prepare("DELETE FROM meal_week_template_items WHERE template_id = ?").run(templateId);
    } else {
      templateId = Number(db.prepare("INSERT INTO meal_week_templates (name) VALUES (?)")
        .run(name.trim()).lastInsertRowid);
    }

    const insertItem = db.prepare(`
      INSERT INTO meal_week_template_items (
        template_id, day_offset, title, meal_type, meal_time, description,
        recipe_url, ingredients, recipe_id, reminder_enabled, reminder_minutes
      ) VALUES (?, ?, ?, 'dinner', ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertMember = db.prepare(`
      INSERT OR IGNORE INTO meal_week_template_item_members
        (template_item_id, family_member_id) VALUES (?, ?)
    `);
    for (const meal of meals) {
      const itemId = Number(insertItem.run(
        templateId, meal.dayOffset, meal.title.trim(), meal.mealTime || null,
        meal.description || null, meal.recipeUrl || null, meal.ingredients || null,
        meal.recipeId ?? null, meal.reminderEnabled ? 1 : 0, meal.reminderMinutes ?? null
      ).lastInsertRowid);
      for (const memberId of meal.memberIds || []) insertMember.run(itemId, memberId);
    }
    return getTemplateById(templateId);
  });

  try {
    const template = save();
    return res.status(replacing ? 200 : 201).json({ success: true, template });
  } catch (error) {
    if (!error.status) console.error("Save week template error:", error);
    return res.status(error.status || 500).json({
      success: false,
      error: error.status ? error.message : "Unable to save week template",
    });
  }
}

router.post("/", saveTemplate);
router.put("/:id", saveTemplate);

/* =========================================================
   UPDATE / REPLACE WEEK TEMPLATE
   ========================================================= */

router.put("/:id", (req, res) => {
  const templateId =
    Number(req.params.id);

  const {
    name,
    meals = [],
  } = req.body;

  const cleanName =
    String(name || "").trim();

  const existing =
    getTemplateById(templateId);

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: "Week template not found",
    });
  }

  if (!cleanName) {
    return res.status(400).json({
      success: false,
      error: "Template name is required",
    });
  }

  if (
    !Array.isArray(meals) ||
    meals.length === 0
  ) {
    return res.status(400).json({
      success: false,
      error:
        "At least one dinner is required",
    });
  }

  const replaceTemplate =
    db.transaction(() => {
      /*
       * Validate all dinners before
       * removing the existing items.
       */
      const validatedMeals =
        meals.map((meal) => {
          const dayOffset =
            Number(meal.dayOffset);

          if (
            !Number.isInteger(dayOffset) ||
            dayOffset < 0 ||
            dayOffset > 6
          ) {
            throw new Error(
              "Invalid template day"
            );
          }

          const title =
            String(
              meal.title || ""
            ).trim();

          if (!title) {
            throw new Error(
              "Every template dinner needs a title"
            );
          }

          return {
            ...meal,
            dayOffset,
            title,
          };
        });

      /*
       * Update the existing template
       * instead of deleting it.
       */
      db.prepare(`
        UPDATE meal_week_templates
        SET
          name = ?,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(
        cleanName,
        templateId
      );

      /*
       * Remove old member links.
       */
      db.prepare(`
        DELETE FROM
          meal_week_template_item_members
        WHERE template_item_id IN (
          SELECT id
          FROM meal_week_template_items
          WHERE template_id = ?
        )
      `).run(templateId);

      /*
       * Remove old template dinners.
       */
      db.prepare(`
        DELETE FROM
          meal_week_template_items
        WHERE template_id = ?
      `).run(templateId);

      /*
       * Rebuild the dinners from the
       * current planner week.
       */
      const insertItem = db.prepare(`
        INSERT INTO meal_week_template_items (
          template_id,
          day_offset,
          title,
          meal_type,
          meal_time,
          description,
          recipe_url,
          ingredients,
          recipe_id,
          reminder_enabled,
          reminder_minutes
        )
        VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);

      const insertMember = db.prepare(`
        INSERT OR IGNORE INTO
          meal_week_template_item_members (
            template_item_id,
            family_member_id
          )
        VALUES (?, ?)
      `);

      for (
        const meal of validatedMeals
      ) {
        const itemResult =
          insertItem.run(
            templateId,
            meal.dayOffset,
            meal.title,
            "dinner",
            meal.mealTime || null,
            meal.description || null,
            meal.recipeUrl || null,
            meal.ingredients || null,
            meal.recipeId || null,
            meal.reminderEnabled ? 1 : 0,
            meal.reminderMinutes ?? null
          );

        const templateItemId =
          Number(
            itemResult.lastInsertRowid
          );

        const memberIds =
          Array.isArray(meal.memberIds)
            ? meal.memberIds
            : [];

        for (
          const memberId of memberIds
        ) {
          const numericMemberId =
            Number(memberId);

          if (
            Number.isInteger(
              numericMemberId
            ) &&
            numericMemberId > 0
          ) {
            insertMember.run(
              templateItemId,
              numericMemberId
            );
          }
        }
      }
    });

  try {
    replaceTemplate();

    res.json({
      success: true,
      template:
        getTemplateById(templateId),
    });
  } catch (error) {
    console.error(
      "Replace week template error:",
      error
    );

    res.status(400).json({
      success: false,
      error:
        error.message ||
        "Unable to replace week template",
    });
  }
});

/* =========================================================
   DELETE WEEK TEMPLATE
   ========================================================= */

router.delete("/:id", (req, res) => {
  const templateId =
    Number(req.params.id);

  const existing =
    getTemplateById(templateId);

  if (!existing) {
    return res.status(404).json({
      success: false,
      error: "Week template not found",
    });
  }

  const deleteTemplate =
    db.transaction(() => {
      db.prepare(`
        DELETE FROM
          meal_week_template_item_members
        WHERE template_item_id IN (
          SELECT id
          FROM meal_week_template_items
          WHERE template_id = ?
        )
      `).run(templateId);

      db.prepare(`
        DELETE FROM
          meal_week_template_items
        WHERE template_id = ?
      `).run(templateId);

      db.prepare(`
        DELETE FROM
          meal_week_templates
        WHERE id = ?
      `).run(templateId);
    });

  deleteTemplate();

  res.json({
    success: true,
  });
});

module.exports = router;