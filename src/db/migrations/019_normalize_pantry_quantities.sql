/*
 * FamilyHub Pantry quantity cleanup
 *
 * New model:
 *
 * quantity  = number of packages/items
 * pack_size = size of each package
 *
 * Examples:
 *
 * 180g  -> quantity 1, pack_size 180g
 * 2 Kg  -> quantity 1, pack_size 2 Kg
 * 2L    -> quantity 1, pack_size 2L
 *
 * Recipe-style / unsupported text such
 * as "6cups" becomes quantity 1 without
 * treating it as a package size.
 */


/*
 * Move recognised weight/volume values
 * into pack_size.
 *
 * Only do this when pack_size is empty,
 * so we never overwrite anything the
 * user has already entered manually.
 */

UPDATE pantry_items
SET
  pack_size = TRIM(quantity),
  quantity = '1',
  updated_at = CURRENT_TIMESTAMP
WHERE
  (pack_size IS NULL OR TRIM(pack_size) = '')
  AND quantity IS NOT NULL
  AND (
    LOWER(REPLACE(TRIM(quantity), ' ', '')) GLOB '[0-9]*g'
    OR LOWER(REPLACE(TRIM(quantity), ' ', '')) GLOB '[0-9]*kg'
    OR LOWER(REPLACE(TRIM(quantity), ' ', '')) GLOB '[0-9]*ml'
    OR LOWER(REPLACE(TRIM(quantity), ' ', '')) GLOB '[0-9]*l'
  );


/*
 * Any remaining non-numeric legacy
 * quantity is not a stock count.
 *
 * Example:
 * 6cups
 *
 * Start it at one physical item and
 * leave pack_size blank.
 */

UPDATE pantry_items
SET
  quantity = '1',
  updated_at = CURRENT_TIMESTAMP
WHERE
  quantity IS NOT NULL
  AND TRIM(quantity) <> ''
  AND CAST(
    CAST(TRIM(quantity) AS INTEGER)
    AS TEXT
  ) <> TRIM(quantity)
  AND (
    pack_size IS NULL
    OR TRIM(pack_size) = ''
  );