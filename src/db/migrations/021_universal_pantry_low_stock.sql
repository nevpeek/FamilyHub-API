/*
 * FamilyHub Pantry
 * Universal Running Low
 *
 * Every Pantry item now participates
 * in low-stock monitoring.
 *
 * Existing custom settings are kept.
 * Missing settings receive defaults:
 *
 * Low At:        1
 * Buy Quantity:  1
 * Auto Shopping: ON
 */

UPDATE pantry_items
SET
  low_stock_enabled = 1,

  low_stock_threshold =
    CASE
      WHEN low_stock_threshold IS NULL
        THEN 1
      ELSE low_stock_threshold
    END,

  auto_add_to_shopping =
    CASE
      WHEN low_stock_enabled = 1
        THEN auto_add_to_shopping
      ELSE 1
    END,

  restock_quantity =
    CASE
      WHEN restock_quantity IS NULL
        OR TRIM(
          CAST(
            restock_quantity AS TEXT
          )
        ) = ''
        THEN '1'
      ELSE restock_quantity
    END,

  updated_at =
    CURRENT_TIMESTAMP;