/*
 * Every Pantry item represents physical
 * stock, so every item must have a count.
 *
 * Existing items with no quantity start
 * with a stock quantity of 1.
 */

UPDATE pantry_items
SET
  quantity = '1',
  updated_at = CURRENT_TIMESTAMP
WHERE
  quantity IS NULL
  OR TRIM(quantity) = '';