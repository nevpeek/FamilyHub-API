const crypto = require("node:crypto");
const db = require("../database/db");

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const types = ["breakfast", "lunch", "dinner", "snack"];

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function dayOffset(date, offset) {
  const result = new Date(`${date}T00:00:00Z`);
  result.setUTCDate(result.getUTCDate() + offset);
  return result.toISOString().slice(0, 10);
}
function weekBounds(start) {
  if (!validDate(start) || new Date(`${start}T00:00:00Z`).getUTCDay() !== 1) {
    throw fail("A valid Monday week start is required");
  }
  return { start, end: dayOffset(start, 6) };
}
function validId(value) {
  return Number.isSafeInteger(value) && value > 0;
}
function getMealById(id) {
  const meal = db.prepare("SELECT * FROM meals WHERE id = ?").get(id);
  if (!meal) return null;
  const members = db.prepare(`
    SELECT fm.id, fm.name, fm.colour, fm.initials, fm.photo_url
    FROM meal_members mm JOIN family_members fm ON fm.id = mm.family_member_id
    WHERE mm.meal_id = ? ORDER BY fm.display_order ASC, fm.name ASC
  `).all(id);
  // Content-based revision detects same-second edits without a schema migration.
  const revision = crypto.createHash("sha256").update(JSON.stringify({
    ...meal, memberIds: members.map(member => member.id).sort((a, b) => a - b),
  })).digest("hex");
  return { ...meal, members, revision };
}
function payloadFromMeal(meal) {
  return {
    title: meal.title, mealDate: meal.meal_date, mealType: meal.meal_type,
    mealTime: meal.meal_time, description: meal.description, recipeUrl: meal.recipe_url,
    ingredients: meal.ingredients, recipeId: meal.recipe_id,
    reminderEnabled: Boolean(meal.reminder_enabled), reminderMinutes: meal.reminder_minutes,
    memberIds: meal.members.map(member => member.id),
  };
}
function normalize(body, existing) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw fail("Invalid meal data");
  const meal = {
    mealType: "dinner", mealTime: null, description: null, recipeUrl: null,
    ingredients: null, recipeId: null, reminderEnabled: false, reminderMinutes: null,
    memberIds: [], ...(existing ? payloadFromMeal(existing) : {}), ...body,
  };
  if (typeof meal.title !== "string" || !meal.title.trim()) throw fail("Title is required");
  if (!validDate(meal.mealDate)) throw fail("A valid meal date is required");
  if (!types.includes(meal.mealType)) throw fail("Invalid meal type");
  for (const field of ["mealTime", "description", "recipeUrl", "ingredients"]) {
    if (meal[field] != null && typeof meal[field] !== "string") throw fail(`Invalid ${field}`);
  }
  if (meal.mealTime && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(meal.mealTime)) {
    throw fail("Invalid meal time");
  }
  if (typeof meal.reminderEnabled !== "boolean") throw fail("Invalid reminder setting");
  if (meal.reminderMinutes != null && (!Number.isSafeInteger(meal.reminderMinutes) || meal.reminderMinutes < 0)) {
    throw fail("Invalid reminder time");
  }
  if (meal.reminderEnabled && (!meal.mealTime || meal.reminderMinutes == null)) {
    throw fail("Meal time and reminder minutes are required for reminders");
  }
  if (meal.recipeId != null && (!validId(meal.recipeId) ||
      !db.prepare("SELECT id FROM recipes WHERE id = ?").get(meal.recipeId))) {
    throw fail("A selected recipe no longer exists");
  }
  if (!Array.isArray(meal.memberIds) || !meal.memberIds.length || !meal.memberIds.every(validId)) {
    throw fail("At least one valid family member is required");
  }
  meal.memberIds = [...new Set(meal.memberIds)];
  for (const id of meal.memberIds) {
    if (!db.prepare("SELECT id FROM family_members WHERE id = ? AND is_active = 1").get(id)) {
      throw fail("One or more family members are invalid");
    }
  }
  meal.title = meal.title.trim();
  meal.mealTime = meal.mealTime || null;
  return meal;
}
function slot(date, type) {
  return db.prepare("SELECT id, title FROM meals WHERE meal_date = ? AND meal_type = ? ORDER BY id").all(date, type);
}
function assertFree(meal, exceptId) {
  if (slot(meal.mealDate, meal.mealType).some(row => row.id !== exceptId)) {
    throw fail("That meal slot is occupied. Refresh the planner or use move/swap.", 409);
  }
}
function insertMeal(meal) {
  const result = db.prepare(`INSERT INTO meals
    (title, meal_date, meal_type, meal_time, description, recipe_url, ingredients,
     recipe_id, reminder_enabled, reminder_minutes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(meal.title, meal.mealDate, meal.mealType, meal.mealTime, meal.description,
    meal.recipeUrl, meal.ingredients, meal.recipeId, meal.reminderEnabled ? 1 : 0, meal.reminderMinutes);
  const id = Number(result.lastInsertRowid);
  for (const memberId of meal.memberIds) {
    db.prepare("INSERT INTO meal_members (meal_id, family_member_id) VALUES (?, ?)").run(id, memberId);
  }
  return getMealById(id);
}
function requireRevision(meal, revision) {
  if (!meal) throw fail("A selected dinner no longer exists. Refresh the planner.", 409);
  if (typeof revision !== "string" || meal.revision !== revision) {
    throw fail("A selected dinner changed. Refresh the planner and try again.", 409);
  }
}
function selection(items) {
  if (!Array.isArray(items) || !items.length || items.length > 100 ||
      !items.every(item => item && validId(item.id) && typeof item.revision === "string") ||
      new Set(items.map(item => item.id)).size !== items.length) {
    throw fail("A valid selection of dinners is required");
  }
  return items;
}

const createMeal = db.transaction(body => {
  const meal = normalize(body);
  assertFree(meal);
  return insertMeal(meal);
});
const updateMeal = db.transaction((id, body) => {
  const existing = getMealById(id);
  if (!existing) throw fail("Meal not found", 404);
  const meal = normalize(body, existing);
  assertFree(meal, id);
  db.prepare(`UPDATE meals SET title=?, meal_date=?, meal_type=?, meal_time=?,
    description=?, recipe_url=?, ingredients=?, recipe_id=?, reminder_enabled=?,
    reminder_minutes=?, updated_at=CURRENT_TIMESTAMP WHERE id=?
  `).run(meal.title, meal.mealDate, meal.mealType, meal.mealTime, meal.description,
    meal.recipeUrl, meal.ingredients, meal.recipeId, meal.reminderEnabled ? 1 : 0, meal.reminderMinutes, id);
  db.prepare("DELETE FROM meal_members WHERE meal_id = ?").run(id);
  for (const memberId of meal.memberIds) {
    db.prepare("INSERT INTO meal_members (meal_id, family_member_id) VALUES (?, ?)").run(id, memberId);
  }
  return getMealById(id);
});

const moveMeal = db.transaction(body => {
  if (!body || !validId(body.mealId) || !validDate(body.targetDate) || !types.includes(body.targetType) ||
      !(body.expectedTargetId === null || validId(body.expectedTargetId))) throw fail("Invalid meal move");
  const source = getMealById(body.mealId);
  requireRevision(source, body.sourceRevision);
  if (source.meal_date === body.targetDate && source.meal_type === body.targetType) return { meals: [source] };
  if (slot(source.meal_date, source.meal_type).length !== 1) {
    throw fail("The source slot contains multiple meals and needs review before moving.", 409);
  }
  const occupants = slot(body.targetDate, body.targetType);
  if (occupants.length > 1 || (occupants[0]?.id ?? null) !== body.expectedTargetId) {
    throw fail("The destination changed or contains a dinner hidden by your filter. Refresh before moving.", 409);
  }
  const target = occupants.length ? getMealById(occupants[0].id) : null;
  if (target) requireRevision(target, body.targetRevision);
  const move = db.prepare("UPDATE meals SET meal_date=?, meal_type=?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
  // Only scheduling fields change; reminders, recipes and member links stay put.
  if (target) move.run(source.meal_date, source.meal_type, target.id);
  move.run(body.targetDate, body.targetType, source.id);
  return { meals: [getMealById(source.id), ...(target ? [getMealById(target.id)] : [])] };
});

function insertAvailable(candidates) {
  const prepared = [], skippedMeals = [], seen = new Set();
  for (const candidate of candidates) {
    const key = `${candidate.mealDate}/${candidate.mealType}`;
    if (seen.has(key)) throw fail("The selected plan contains more than one dinner on the same day");
    seen.add(key);
    const existing = slot(candidate.mealDate, candidate.mealType);
    if (existing.length) {
      skippedMeals.push({ mealDate: candidate.mealDate, existingMealIds: existing.map(meal => meal.id) });
    } else {
      prepared.push(normalize(candidate));
    }
  }
  return { createdMeals: prepared.map(insertMeal), skippedMeals };
}
const applyTemplate = db.transaction(body => {
  const { start, end } =
    weekBounds(body?.weekStart);

  if (!validId(body?.templateId)) {
    throw fail("Invalid template ID");
  }

  const template = db
    .prepare(`
      SELECT id, name
      FROM meal_week_templates
      WHERE id = ?
    `)
    .get(body.templateId);

  if (!template) {
    throw fail(
      "Week template not found",
      404
    );
  }

  const items = db
    .prepare(`
      SELECT *
      FROM meal_week_template_items
      WHERE template_id = ?
      ORDER BY day_offset, id
    `)
    .all(template.id);

  if (!items.length) {
    throw fail(
      "This template does not contain any dinners"
    );
  }

  const choices =
    body?.choices &&
    typeof body.choices === "object" &&
    !Array.isArray(body.choices)
      ? body.choices
      : {};

  const createdMeals = [];
  const replacedMeals = [];
  const keptMeals = [];
  const matchedMeals = [];

  /*
   * Validate every template item and every
   * requested replacement before changing
   * anything in the database.
   *
   * Because this entire function is wrapped
   * in db.transaction(), any later failure
   * also rolls the whole operation back.
   */
  const prepared = items.map((item) => {
    const offset =
      Number(item.day_offset);

    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      offset > 6
    ) {
      throw fail(
        "This template contains an invalid dinner day"
      );
    }

    const mealDate =
      dayOffset(start, offset);

    if (
      mealDate < start ||
      mealDate > end
    ) {
      throw fail(
        "This template contains a dinner outside the selected week"
      );
    }

    const memberIds = db
      .prepare(`
        SELECT family_member_id AS id
        FROM meal_week_template_item_members
        WHERE template_item_id = ?
      `)
      .all(item.id)
      .map((member) => member.id);

    const candidate =
      normalize(
        payloadFromMeal({
          ...item,
          meal_date: mealDate,
          meal_type: "dinner",
          members: memberIds.map(
            (id) => ({ id })
          ),
        })
      );

    const occupants =
      slot(mealDate, "dinner");

    if (occupants.length > 1) {
      throw fail(
        "A dinner slot contains multiple meals and needs review before applying this template.",
        409
      );
    }

    const existingMeal =
      occupants.length
        ? getMealById(
            occupants[0].id
          )
        : null;

    const choice =
      String(
        choices[offset] || ""
      ).toLowerCase();

    const alreadyMatches =
      existingMeal &&
      String(
        existingMeal.title || ""
      )
        .trim()
        .toLowerCase() ===
        String(
          candidate.title || ""
        )
          .trim()
          .toLowerCase();

    if (alreadyMatches) {
      return {
        action: "match",
        offset,
        candidate,
        existingMeal,
      };
    }

    if (!existingMeal) {
      return {
        action: "add",
        offset,
        candidate,
        existingMeal: null,
      };
    }

    if (choice === "replace") {
      const expectedId =
        Number(
          body?.existingMeals?.[
            offset
          ]?.id
        );

      const expectedRevision =
        body?.existingMeals?.[
          offset
        ]?.revision;

      if (
        !validId(expectedId) ||
        expectedId !==
          existingMeal.id
      ) {
        throw fail(
          "A dinner changed after the template preview was opened. Refresh the planner and try again.",
          409
        );
      }

      requireRevision(
        existingMeal,
        expectedRevision
      );

      return {
        action: "replace",
        offset,
        candidate,
        existingMeal,
      };
    }

    return {
      action: "keep",
      offset,
      candidate,
      existingMeal,
    };
  });

  /*
   * All validation has passed.
   * Now perform the complete template
   * application inside this transaction.
   */
  for (const item of prepared) {
    if (item.action === "match") {
      matchedMeals.push(
        item.existingMeal
      );

      continue;
    }

    if (item.action === "keep") {
      keptMeals.push(
        item.existingMeal
      );

      continue;
    }

    if (item.action === "replace") {
      db.prepare(`
        DELETE FROM meals
        WHERE id = ?
      `).run(
        item.existingMeal.id
      );

      const created =
        insertMeal(
          item.candidate
        );

      replacedMeals.push({
        replacedMealId:
          item.existingMeal.id,
        meal: created,
      });

      continue;
    }

    const created =
      insertMeal(
        item.candidate
      );

    createdMeals.push(created);
  }

  return {
    templateName:
      template.name,

    createdMeals,
    replacedMeals,
    keptMeals,
    matchedMeals,
  };
});
const copyWeek = db.transaction(body => {
  const { start } = weekBounds(body?.weekStart);
  const previousStart = dayOffset(start, -7), previousEnd = dayOffset(start, -1);
  const candidates = selection(body.sourceMeals).map(item => {
    const source = getMealById(item.id);
    requireRevision(source, item.revision);
    if (source.meal_type !== "dinner" || source.meal_date < previousStart || source.meal_date > previousEnd) {
      throw fail("A selected dinner is no longer in the previous week", 409);
    }
    return { ...payloadFromMeal(source), mealDate: dayOffset(source.meal_date, 7) };
  });
  return insertAvailable(candidates);
});
const clearWeek = db.transaction(body => {
  const { start, end } = weekBounds(body?.weekStart);
  const ids = [];
  for (const item of selection(body.meals)) {
    const meal = getMealById(item.id);
    if (!meal) continue; // A response-loss retry cannot delete newly added dinners.
    requireRevision(meal, item.revision);
    if (meal.meal_type !== "dinner" || meal.meal_date < start || meal.meal_date > end) {
      throw fail("A selected dinner is no longer in this week", 409);
    }
    ids.push(meal.id);
  }
  for (const id of ids) db.prepare("DELETE FROM meals WHERE id=?").run(id);
  return { deletedMealIds: ids };
});

// IMMEDIATE serializes read/check/write operations across SQLite connections.
module.exports = { getMealById,
  createMeal: body => createMeal.immediate(body),
  updateMeal: (id, body) => updateMeal.immediate(id, body),
  moveMeal: body => moveMeal.immediate(body),
  applyTemplate: body => applyTemplate.immediate(body),
  copyWeek: body => copyWeek.immediate(body),
  clearWeek: body => clearWeek.immediate(body),
};
