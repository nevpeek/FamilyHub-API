const express = require("express");
const db = require("../database/db");

const router = express.Router();

/* ========================================
   Helpers
======================================== */

function getListById(listId) {
  const list = db
    .prepare(`
      SELECT
        id,
        name,
        icon,
        colour,
        sort_order,
        is_archived,
        created_at,
        updated_at

      FROM family_lists

      WHERE id = ?
    `)
    .get(listId);

  if (!list) {
    return null;
  }

  const items = db
    .prepare(`
      SELECT
        fli.id,
        fli.list_id,
        fli.title,
        fli.notes,
        fli.is_completed,
        fli.sort_order,
        fli.created_at,
        fli.updated_at

      FROM family_list_items fli

      WHERE fli.list_id = ?

      ORDER BY
        fli.is_completed ASC,
        fli.sort_order ASC,
        fli.id ASC
    `)
    .all(listId);

  const memberStatement = db.prepare(`
    SELECT
      fm.id,
      fm.name,
      fm.colour,
      fm.initials,
      fm.photo_url

    FROM family_list_item_members flim

    JOIN family_members fm
      ON fm.id =
        flim.family_member_id

    WHERE flim.list_item_id = ?

    ORDER BY
      fm.display_order ASC,
      fm.name ASC
  `);

  return {
    ...list,

    items: items.map((item) => ({
      ...item,

      members:
        memberStatement.all(item.id),
    })),
  };
}

/* ========================================
   Lists
======================================== */

router.get(
  "/",
  (req, res) => {
    try {
      const lists = db
        .prepare(`
          SELECT
            fl.id,
            fl.name,
            fl.icon,
            fl.colour,
            fl.sort_order,
            fl.is_archived,
            fl.created_at,
            fl.updated_at,

            COUNT(fli.id) AS item_count,

            SUM(
              CASE
                WHEN fli.is_completed = 0
                THEN 1
                ELSE 0
              END
            ) AS open_count

          FROM family_lists fl

          LEFT JOIN family_list_items fli
            ON fli.list_id = fl.id

          WHERE fl.is_archived = 0

          GROUP BY
            fl.id

          ORDER BY
            fl.sort_order ASC,
            fl.name ASC
        `)
        .all();

      res.json({
        success: true,

        lists: lists.map((list) => ({
          ...list,

          item_count:
            Number(list.item_count) || 0,

          open_count:
            Number(list.open_count) || 0,
        })),
      });
    } catch (error) {
      console.error(
        "Load family lists error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to load family lists",
      });
    }
  }
);

router.get(
  "/:id",
  (req, res) => {
    try {
      const list =
        getListById(
          Number(req.params.id)
        );

      if (!list) {
        return res.status(404).json({
          success: false,
          error:
            "List not found",
        });
      }

      res.json({
        success: true,
        list,
      });
    } catch (error) {
      console.error(
        "Load family list error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to load family list",
      });
    }
  }
);

router.post(
  "/",
  (req, res) => {
    try {
      const {
        name,
        icon = "📋",
        colour = "#22c55e",
      } = req.body;

      const cleanName =
        String(name || "").trim();

      if (!cleanName) {
        return res.status(400).json({
          success: false,
          error:
            "List name is required",
        });
      }

      const maxSort =
        db.prepare(`
          SELECT
            COALESCE(
              MAX(sort_order),
              -1
            ) AS max_sort

          FROM family_lists
        `).get();

      const result = db
        .prepare(`
          INSERT INTO family_lists (
            name,
            icon,
            colour,
            sort_order
          )
          VALUES (?, ?, ?, ?)
        `)
        .run(
          cleanName,
          icon || "📋",
          colour || "#22c55e",
          Number(maxSort.max_sort) + 1
        );

      const list =
        getListById(
          result.lastInsertRowid
        );

      res.status(201).json({
        success: true,
        list,
      });
    } catch (error) {
      console.error(
        "Create family list error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to create family list",
      });
    }
  }
);

router.put(
  "/:id",
  (req, res) => {
    try {
      const listId =
        Number(req.params.id);

      const existing =
        getListById(listId);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error:
            "List not found",
        });
      }

      const {
        name = existing.name,
        icon = existing.icon,
        colour = existing.colour,
      } = req.body;

      const cleanName =
        String(name || "").trim();

      if (!cleanName) {
        return res.status(400).json({
          success: false,
          error:
            "List name is required",
        });
      }

      db.prepare(`
        UPDATE family_lists

        SET
          name = ?,
          icon = ?,
          colour = ?,
          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
      `).run(
        cleanName,
        icon || "📋",
        colour || "#22c55e",
        listId
      );

      res.json({
        success: true,
        list:
          getListById(listId),
      });
    } catch (error) {
      console.error(
        "Update family list error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to update family list",
      });
    }
  }
);

router.delete(
  "/:id",
  (req, res) => {
    try {
      const listId =
        Number(req.params.id);

      const existing =
        db.prepare(`
          SELECT id
          FROM family_lists
          WHERE id = ?
        `).get(listId);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error:
            "List not found",
        });
      }

      db.prepare(`
        DELETE FROM family_lists
        WHERE id = ?
      `).run(listId);

      res.json({
        success: true,
      });
    } catch (error) {
      console.error(
        "Delete family list error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to delete family list",
      });
    }
  }
);

/* ========================================
   List Items
======================================== */

router.post(
  "/:id/items",
  (req, res) => {
    const listId =
      Number(req.params.id);

    const {
      title,
      notes = null,
      memberIds = [],
    } = req.body;

    const cleanTitle =
      String(title || "").trim();

    if (!cleanTitle) {
      return res.status(400).json({
        success: false,
        error:
          "Item title is required",
      });
    }

    const listExists =
      db.prepare(`
        SELECT id
        FROM family_lists
        WHERE id = ?
          AND is_archived = 0
      `).get(listId);

    if (!listExists) {
      return res.status(404).json({
        success: false,
        error:
          "List not found",
      });
    }

    const transaction =
      db.transaction(() => {
        const maxSort =
          db.prepare(`
            SELECT
              COALESCE(
                MAX(sort_order),
                -1
              ) AS max_sort

            FROM family_list_items

            WHERE list_id = ?
          `).get(listId);

        const result = db
          .prepare(`
            INSERT INTO family_list_items (
              list_id,
              title,
              notes,
              sort_order
            )
            VALUES (?, ?, ?, ?)
          `)
          .run(
            listId,
            cleanTitle,
            notes
              ? String(notes).trim()
              : null,
            Number(maxSort.max_sort) + 1
          );

        const itemId =
          result.lastInsertRowid;

        const memberInsert =
          db.prepare(`
            INSERT OR IGNORE INTO
              family_list_item_members (
                list_item_id,
                family_member_id
              )
            VALUES (?, ?)
          `);

        for (
          const memberId of memberIds
        ) {
          memberInsert.run(
            itemId,
            Number(memberId)
          );
        }

        return itemId;
      });

    try {
      const itemId =
        transaction();

      res.status(201).json({
        success: true,

        list:
          getListById(listId),

        itemId,
      });
    } catch (error) {
      console.error(
        "Create list item error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to create list item",
      });
    }
  }
);

router.put(
  "/items/:itemId",
  (req, res) => {
    const itemId =
      Number(req.params.itemId);

    const existing =
      db.prepare(`
        SELECT *
        FROM family_list_items
        WHERE id = ?
      `).get(itemId);

    if (!existing) {
      return res.status(404).json({
        success: false,
        error:
          "List item not found",
      });
    }

    const {
      title = existing.title,
      notes = existing.notes,
      memberIds,
    } = req.body;

    const cleanTitle =
      String(title || "").trim();

    if (!cleanTitle) {
      return res.status(400).json({
        success: false,
        error:
          "Item title is required",
      });
    }

    const transaction =
      db.transaction(() => {
        db.prepare(`
          UPDATE family_list_items

          SET
            title = ?,
            notes = ?,
            updated_at =
              CURRENT_TIMESTAMP

          WHERE id = ?
        `).run(
          cleanTitle,
          notes
            ? String(notes).trim()
            : null,
          itemId
        );

        if (
          Array.isArray(memberIds)
        ) {
          db.prepare(`
            DELETE FROM family_list_item_members
            WHERE list_item_id = ?
          `).run(itemId);

          const memberInsert =
            db.prepare(`
              INSERT OR IGNORE INTO
                family_list_item_members (
                  list_item_id,
                  family_member_id
                )
              VALUES (?, ?)
            `);

          for (
            const memberId of memberIds
          ) {
            memberInsert.run(
              itemId,
              Number(memberId)
            );
          }
        }
      });

    try {
      transaction();

      res.json({
        success: true,

        list:
          getListById(
            existing.list_id
          ),
      });
    } catch (error) {
      console.error(
        "Update list item error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to update list item",
      });
    }
  }
);

router.patch(
  "/items/:itemId/completion",
  (req, res) => {
    try {
      const itemId =
        Number(req.params.itemId);

      const completed =
        Boolean(
          req.body.completed
        );

      const existing =
        db.prepare(`
          SELECT *
          FROM family_list_items
          WHERE id = ?
        `).get(itemId);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error:
            "List item not found",
        });
      }

      db.prepare(`
        UPDATE family_list_items

        SET
          is_completed = ?,
          updated_at =
            CURRENT_TIMESTAMP

        WHERE id = ?
      `).run(
        completed ? 1 : 0,
        itemId
      );

      res.json({
        success: true,

        list:
          getListById(
            existing.list_id
          ),
      });
    } catch (error) {
      console.error(
        "Complete list item error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to update list item",
      });
    }
  }
);

router.delete(
  "/items/:itemId",
  (req, res) => {
    try {
      const itemId =
        Number(req.params.itemId);

      const existing =
        db.prepare(`
          SELECT *
          FROM family_list_items
          WHERE id = ?
        `).get(itemId);

      if (!existing) {
        return res.status(404).json({
          success: false,
          error:
            "List item not found",
        });
      }

      db.prepare(`
        DELETE FROM family_list_items
        WHERE id = ?
      `).run(itemId);

      res.json({
        success: true,

        list:
          getListById(
            existing.list_id
          ),
      });
    } catch (error) {
      console.error(
        "Delete list item error:",
        error
      );

      res.status(500).json({
        success: false,
        error:
          "Unable to delete list item",
      });
    }
  }
);

module.exports = router;