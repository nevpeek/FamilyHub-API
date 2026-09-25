const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const db = require("../database/db");

const router = express.Router();

const FOOD_IMAGE_UPLOAD_DIRECTORY =
  path.join(
    __dirname,
    "../../uploads/food-images"
  );

if (
  !fs.existsSync(
    FOOD_IMAGE_UPLOAD_DIRECTORY
  )
) {
  fs.mkdirSync(
    FOOD_IMAGE_UPLOAD_DIRECTORY,
    {
      recursive: true,
    }
  );
}

const foodImageStorage =
  multer.diskStorage({
    destination:
      (
        req,
        file,
        callback
      ) => {
        callback(
          null,
          FOOD_IMAGE_UPLOAD_DIRECTORY
        );
      },

    filename:
      (
        req,
        file,
        callback
      ) => {
        const extension =
          path
            .extname(
              file.originalname
            )
            .toLowerCase() ||
          ".jpg";

        const filename =
          `food-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 10)}${extension}`;

        callback(
          null,
          filename
        );
      },
  });

const uploadFoodImage =
  multer({
    storage:
      foodImageStorage,

    limits: {
      fileSize:
        10 * 1024 * 1024,
    },

    fileFilter:
      (
        req,
        file,
        callback
      ) => {
        const allowedTypes =
          new Set([
            "image/jpeg",
            "image/png",
            "image/webp",
          ]);

        if (
          !allowedTypes.has(
            file.mimetype
          )
        ) {
          return callback(
            new Error(
              "Only JPG, PNG and WebP images are allowed"
            )
          );
        }

        callback(
          null,
          true
        );
      },
  });

const OPEN_FOOD_FACTS_SEARCH_URL =
  "https://world.openfoodfacts.org/cgi/search.pl";

const getCachedImage =
  db.prepare(`
    SELECT
      search_name,
      cache_key,
      image_url,
      source,
      matched_product,
      barcode,
      rotation
    FROM food_image_cache
    WHERE cache_key = ?
    LIMIT 1
  `);

const saveCachedImage =
  db.prepare(`
    INSERT INTO food_image_cache (
      search_name,
      cache_key,
      image_url,
      source,
      matched_product,
      barcode,
      rotation,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

    ON CONFLICT(cache_key)
    DO UPDATE SET
      search_name = excluded.search_name,
      image_url = excluded.image_url,
      source = excluded.source,
      matched_product = excluded.matched_product,
      barcode = excluded.barcode,
      rotation = excluded.rotation,
      updated_at = CURRENT_TIMESTAMP
  `);

const updateCachedImageRotation =
  db.prepare(`
    UPDATE food_image_cache
    SET
      rotation = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE cache_key = ?
  `);

const deleteCachedImage =
  db.prepare(`
    DELETE FROM food_image_cache
    WHERE cache_key = ?
  `);

/*
 * Master image library for fresh
 * foods such as banana, apple,
 * potato and chicken breast.
 */

const getFreshFoodLibraryImage =
  db.prepare(`
    SELECT
      canonical_name,
      image_url,
      source,
      matched_product,
      rotation
    FROM fresh_food_image_library
    WHERE canonical_name = ?
    LIMIT 1
  `);

const saveFreshFoodLibraryImage =
  db.prepare(`
    INSERT INTO fresh_food_image_library (
      canonical_name,
      image_url,
      source,
      matched_product,
      rotation,
      updated_at
    )
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)

    ON CONFLICT(canonical_name)
    DO UPDATE SET
      image_url = excluded.image_url,
      source = excluded.source,
      matched_product = excluded.matched_product,
      rotation = excluded.rotation,
      updated_at = CURRENT_TIMESTAMP
  `);

const updateFreshFoodLibraryRotation =
  db.prepare(`
    UPDATE fresh_food_image_library
    SET
      rotation = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE canonical_name = ?
  `);

const deleteFreshFoodLibraryImage =
  db.prepare(`
    DELETE FROM fresh_food_image_library
    WHERE canonical_name = ?
  `);

function normalizeSearchTerm(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

/*
 * Fresh/basic foods are handled
 * differently from branded packaged
 * products when choosing images.
 *
 * Keep this list about food concepts,
 * not individual brands or products.
 */

const FRESH_FOOD_TERMS =
  new Set([
    "apple",
    "apples",
    "avocado",
    "avocados",
    "banana",
    "bananas",
    "beef",
    "broccoli",
    "cabbage",
    "capsicum",
    "capsicums",
    "carrot",
    "carrots",
    "cauliflower",
    "celery",
    "chicken",
    "chicken breast",
    "chicken breasts",
    "cucumber",
    "cucumbers",
    "egg",
    "eggs",
    "garlic",
    "grape",
    "grapes",
    "lemon",
    "lemons",
    "lettuce",
    "lime",
    "limes",
    "milk",
    "mushroom",
    "mushrooms",
    "onion",
    "onions",
    "orange",
    "oranges",
    "pear",
    "pears",
    "pineapple",
    "pineapples",
    "pork",
    "potato",
    "potatoes",
    "pumpkin",
    "spinach",
    "strawberry",
    "strawberries",
    "tomato",
    "tomatoes",
    "watermelon",
    "watermelons",
    "zucchini",
    "zucchinis",
  ]);

function normalizeFreshFoodName(
  value
) {
  return normalizeSearchTerm(
    value
  )
    .toLowerCase()
    .replace(
      /[-–—]/g,
      " "
    )
    .replace(
      /[^a-z0-9\s]/g,
      " "
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

const FRESH_FOOD_ALIASES =
  new Map([
    /*
     * Fruit
     */

    ["apple", "apple"],
    ["apples", "apple"],

    ["avocado", "avocado"],
    ["avocados", "avocado"],

    ["banana", "banana"],
    ["bananas", "banana"],

    ["blueberry", "blueberry"],
    ["blueberries", "blueberry"],

    ["cherry", "cherry"],
    ["cherries", "cherry"],

    ["grape", "grape"],
    ["grapes", "grape"],

    ["grapefruit", "grapefruit"],
    ["grapefruits", "grapefruit"],

    ["kiwi", "kiwi"],
    ["kiwi fruit", "kiwi"],
    ["kiwifruit", "kiwi"],

    ["lemon", "lemon"],
    ["lemons", "lemon"],

    ["lime", "lime"],
    ["limes", "lime"],

    ["mango", "mango"],
    ["mangoes", "mango"],
    ["mangos", "mango"],

    ["nectarine", "nectarine"],
    ["nectarines", "nectarine"],

    ["orange", "orange"],
    ["oranges", "orange"],

    ["passionfruit", "passionfruit"],
    ["passion fruit", "passionfruit"],

    ["peach", "peach"],
    ["peaches", "peach"],

    ["pear", "pear"],
    ["pears", "pear"],

    ["pineapple", "pineapple"],
    ["pineapples", "pineapple"],

    ["plum", "plum"],
    ["plums", "plum"],

    ["raspberry", "raspberry"],
    ["raspberries", "raspberry"],

    ["rockmelon", "rockmelon"],
    ["rock melon", "rockmelon"],
    ["cantaloupe", "rockmelon"],

    ["strawberry", "strawberry"],
    ["strawberries", "strawberry"],

    ["watermelon", "watermelon"],
    ["watermelons", "watermelon"],

    /*
     * Vegetables
     */

    ["asparagus", "asparagus"],

    ["beetroot", "beetroot"],
    ["beetroots", "beetroot"],

    ["broccoli", "broccoli"],

    ["brussels sprout", "brussels sprouts"],
    ["brussels sprouts", "brussels sprouts"],

    ["cabbage", "cabbage"],
    ["cabbages", "cabbage"],

    ["capsicum", "capsicum"],
    ["capsicums", "capsicum"],
    ["bell pepper", "capsicum"],
    ["bell peppers", "capsicum"],

    ["carrot", "carrot"],
    ["carrots", "carrot"],

    ["cauliflower", "cauliflower"],
    ["cauliflowers", "cauliflower"],

    ["celery", "celery"],

    ["corn", "corn"],
    ["sweet corn", "corn"],
    ["sweetcorn", "corn"],

    ["cucumber", "cucumber"],
    ["cucumbers", "cucumber"],

    ["eggplant", "eggplant"],
    ["eggplants", "eggplant"],
    ["aubergine", "eggplant"],
    ["aubergines", "eggplant"],

    ["garlic", "garlic"],

    ["green bean", "green beans"],
    ["green beans", "green beans"],

    ["lettuce", "lettuce"],

    ["mushroom", "mushroom"],
    ["mushrooms", "mushroom"],

    ["onion", "onion"],
    ["onions", "onion"],

    ["pea", "peas"],
    ["peas", "peas"],

    ["potato", "potato"],
    ["potatoes", "potato"],

    ["pumpkin", "pumpkin"],
    ["pumpkins", "pumpkin"],

    ["silverbeet", "silverbeet"],

    ["spinach", "spinach"],

    ["spring onion", "spring onion"],
    ["spring onions", "spring onion"],
    ["green onion", "spring onion"],
    ["green onions", "spring onion"],

    ["sweet potato", "sweet potato"],
    ["sweet potatoes", "sweet potato"],

    ["tomato", "tomato"],
    ["tomatoes", "tomato"],

    ["zucchini", "zucchini"],
    ["zucchinis", "zucchini"],
    ["courgette", "zucchini"],
    ["courgettes", "zucchini"],

    /*
     * Fresh meat
     */

    ["beef", "beef"],

    ["beef mince", "beef mince"],
    ["minced beef", "beef mince"],

    ["beef steak", "beef steak"],
    ["steak", "beef steak"],

    ["chicken", "chicken"],

    ["chicken breast", "chicken breast"],
    ["chicken breasts", "chicken breast"],

    ["chicken thigh", "chicken thigh"],
    ["chicken thighs", "chicken thigh"],

    ["chicken drumstick", "chicken drumstick"],
    ["chicken drumsticks", "chicken drumstick"],

    ["lamb", "lamb"],

    ["lamb chop", "lamb chop"],
    ["lamb chops", "lamb chop"],

    ["pork", "pork"],

    ["pork chop", "pork chop"],
    ["pork chops", "pork chop"],

    ["pork mince", "pork mince"],
    ["minced pork", "pork mince"],

    ["sausage", "sausages"],
    ["sausages", "sausages"],

    /*
     * Fresh seafood
     */

    ["fish", "fish"],

    ["salmon", "salmon"],
    ["salmon fillet", "salmon"],
    ["salmon fillets", "salmon"],

    ["prawn", "prawns"],
    ["prawns", "prawns"],
    ["shrimp", "prawns"],
    ["shrimps", "prawns"],

    ["tuna", "tuna"],

    /*
     * Dairy / refrigerated staples
     */

    ["egg", "egg"],
    ["eggs", "egg"],

    ["milk", "milk"],

    /*
     * Fresh herbs
     */

    ["basil", "basil"],

    ["coriander", "coriander"],
    ["cilantro", "coriander"],

    ["mint", "mint"],

    ["parsley", "parsley"],

    ["rosemary", "rosemary"],

    ["thyme", "thyme"],
  ]);

function getCanonicalFreshFoodName(
  value
) {
  const normalized =
    normalizeFreshFoodName(
      value
    );

  if (!normalized) {
    return null;
  }

  /*
   * First try the exact name.
   *
   * Banana  -> banana
   * Bananas -> banana
   */

  const exactMatch =
    FRESH_FOOD_ALIASES.get(
      normalized
    );

  if (exactMatch) {
    return exactMatch;
  }

  /*
   * Then remove common descriptive
   * words people may naturally add
   * when creating pantry items.
   *
   * Fresh Bananas -> banana
   * Fresh Carrots -> carrot
   * Whole Apples  -> apple
   */

const simplified =
  normalized
    /*
     * Remove common quantities
     * and weights.
     *
     * Examples:
     * 1kg
     * 500g
     * 1.5kg
     * 2 litres
     * 6 pack
     */

    .replace(
      /\b\d+(?:\.\d+)?\s*(?:kg|kgs|kilogram|kilograms|g|gm|gms|gram|grams|ml|millilitre|millilitres|l|litre|litres)\b/g,
      " "
    )

    /*
     * Remove standalone numbers.
     *
     * Examples:
     * 6 pack
     * 4 bananas
     */

    .replace(
      /\b\d+(?:\.\d+)?\b/g,
      " "
    )

    .split(/\s+/)

    .filter(
      (word) =>
        word &&
        ![
          "fresh",
          "whole",
          "raw",
          "ripe",
          "large",
          "medium",
          "small",
          "loose",
          "each",
          "single",
          "pack",
          "packs",
          "packet",
          "packets",
          "bag",
          "bags",
          "bagged",
          "punnet",
          "punnets",
          "bunch",
          "bunches",
          "bunched",
          "tray",
          "trays",
          "kg",
          "kgs",
          "kilogram",
          "kilograms",
          "gram",
          "grams",
          "gm",
          "gms",
          "g",
        ].includes(
          word
        )
    )

    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (
    simplified &&
    simplified !== normalized
  ) {
    const simplifiedMatch =
      FRESH_FOOD_ALIASES.get(
        simplified
      );

    if (simplifiedMatch) {
      return simplifiedMatch;
    }
  }

  return null;
}

function isFreshFoodSearch(
  value
) {
  return Boolean(
    getCanonicalFreshFoodName(
      value
    )
  );
}

/*
 * Fresh foods share one cache key
 * across singular/plural aliases.
 *
 * Examples:
 *
 * Banana  -> banana
 * Bananas -> banana
 *
 * Potato   -> potato
 * Potatoes -> potato
 *
 * Packaged/branded products keep
 * their normal cache behaviour.
 */

const GENERAL_FOOD_IMAGE_ALIASES =
  new Map([
    [
      "weetbix",
      "weet bix",
    ],
    [
      "weet bix",
      "weet bix",
    ],

    [
      "hotdog buns",
      "hot dog buns",
    ],
    [
      "hot dog buns",
      "hot dog buns",
    ],

    [
      "hotdogs",
      "hot dogs",
    ],
    [
      "hot dogs",
      "hot dogs",
    ],

    [
      "bbq sauce",
      "bbq sauce",
    ],
    [
      "barbecue sauce",
      "bbq sauce",
    ],

    [
      "beef stock",
      "beef stock",
    ],
    [
      "beef broth",
      "beef stock",
    ],
    [
      "beef stock broth",
      "beef stock",
    ],
  ]);

function normalizeGeneralFoodImageName(
  value
) {
  const normalized =
    normalizeSearchTerm(
      value
    )
      .toLowerCase()
      .replace(
        /[-–—]/g,
        " "
      )
      .replace(
        /[^a-z0-9\s]/g,
        " "
      )
      .replace(
        /\s+/g,
        " "
      )
      .trim();

  if (!normalized) {
    return "";
  }

  return (
    GENERAL_FOOD_IMAGE_ALIASES.get(
      normalized
    ) ||
    normalized
  );
}

function getFoodImageCacheName(
  value
) {
  const canonicalFreshFood =
    getCanonicalFreshFoodName(
      value
    );

  if (canonicalFreshFood) {
    return canonicalFreshFood;
  }

  return normalizeGeneralFoodImageName(
    value
  );
}

/*
 * Words that usually indicate that
 * a result is a processed product
 * rather than the fresh/basic food
 * the user actually searched for.
 */

const FRESH_FOOD_PROCESSED_WORDS =
  new Set([
    "bar",
    "bars",
    "biscuit",
    "biscuits",
    "cake",
    "cakes",
    "candy",
    "chips",
    "chocolate",
    "cookie",
    "cookies",
    "crackers",
    "dessert",
    "drink",
    "drinks",
    "flavour",
    "flavored",
    "flavoured",
    "fries",
    "juice",
    "muffin",
    "muffins",
    "powder",
    "rings",
    "sauce",
    "seasoning",
    "soup",
    "spread",
    "syrup",
  ]);

function getFreshFoodProcessedPenalty(
  product,
  searchName
) {
  if (
    !isFreshFoodSearch(
      searchName
    )
  ) {
    return 0;
  }

  const wanted =
    normalizeFreshFoodName(
      searchName
    );

  const label =
    normalizeFreshFoodName(
      getProductLabel(
        product
      )
    );

  if (
    !wanted ||
    !label
  ) {
    return 0;
  }

  const wantedWords =
    new Set(
      wanted.split(/\s+/)
    );

  const labelWords =
    label.split(/\s+/);

  let penalty = 0;

  for (
    const word
    of labelWords
  ) {
    if (
      FRESH_FOOD_PROCESSED_WORDS.has(
        word
      ) &&
      !wantedWords.has(
        word
      )
    ) {
      penalty += 500;
    }
  }

  return penalty;
}

function deleteCustomImageFile(
  cachedImage
) {
  if (
    cachedImage?.source !==
      "custom-upload" ||
    !cachedImage?.image_url?.startsWith(
      "/uploads/food-images/"
    )
  ) {
    return;
  }

  const filename =
    path.basename(
      cachedImage.image_url
    );

  const filePath =
    path.join(
      FOOD_IMAGE_UPLOAD_DIRECTORY,
      filename
    );

  fs.unlink(
    filePath,
    (error) => {
      if (
        error &&
        error.code !== "ENOENT"
      ) {
        console.error(
          "Unable to remove old custom food image:",
          error.message
        );
      }
    }
  );
}

function cleanProductName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function getProductImage(product) {
  return (
    product?.image_front_url ||
    product?.image_front_small_url ||
    product?.image_url ||
    null
  );
}

function getProductLabel(product) {
  const productName =
    cleanProductName(
      product?.product_name
    );

  const brands =
    cleanProductName(
      product?.brands
    );

  if (
    brands &&
    productName &&
    !productName
      .toLowerCase()
      .includes(
        brands.toLowerCase()
      )
  ) {
    return `${brands} ${productName}`;
  }

  return (
    productName ||
    brands ||
    null
  );
}

function scoreProduct(
  product,
  searchName
) {
  const wanted =
    normalizeSearchTerm(
      searchName
    ).toLowerCase();

  const productName =
    normalizeSearchTerm(
      product?.product_name
    ).toLowerCase();

  const brands =
    normalizeSearchTerm(
      Array.isArray(
        product?.brands
      )
        ? product.brands.join(" ")
        : product?.brands
    ).toLowerCase();

  const countries =
    normalizeSearchTerm(
      Array.isArray(
        product?.countries_tags
      )
        ? product.countries_tags.join(
            " "
          )
        : product?.countries_tags
    ).toLowerCase();

  const combined =
    normalizeSearchTerm(
      `${brands} ${productName}`
    ).toLowerCase();

  if (!getProductImage(product)) {
    return -1000;
  }

  if (
    !productName &&
    !brands
  ) {
    return -1000;
  }

  const wantedWords =
    wanted
      .replace(
        /[-–—]/g,
        " "
      )
      .replace(
        /[^a-z0-9\s]/g,
        " "
      )
      .split(/\s+/)
      .filter(
        (word) =>
          word.length > 1
      );

  const productWords =
    productName
      .replace(
        /[-–—]/g,
        " "
      )
      .replace(
        /[^a-z0-9\s]/g,
        " "
      )
      .split(/\s+/)
      .filter(Boolean);

  let score = 0;

  /*
   * Strongly prefer Australian
   * catalogue products.
   */

  if (
    countries.includes(
      "en:australia"
    ) ||
    countries.includes(
      "australia"
    )
  ) {
    score += 120;
  }

  /*
   * Exact matches are ideal.
   */

  if (
    productName === wanted
  ) {
    score += 180;
  }

  if (
    combined === wanted
  ) {
    score += 200;
  }

  /*
   * Product names beginning with
   * the requested food are usually
   * much more useful than a random
   * mention later in the title.
   */

  if (
    productName.startsWith(
      `${wanted} `
    )
  ) {
    score += 110;
  } else if (
    productName.includes(
      wanted
    )
  ) {
    score += 70;
  }

  if (
    combined.startsWith(
      `${wanted} `
    )
  ) {
    score += 90;
  } else if (
    combined.includes(
      wanted
    )
  ) {
    score += 50;
  }

  /*
   * Reward individual requested
   * words appearing in the actual
   * product name.
   */

  let matchedWords = 0;

  for (
    const word
    of wantedWords
  ) {
    if (
      productWords.includes(
        word
      )
    ) {
      matchedWords += 1;
      score += 28;
    } else if (
      productName.includes(
        word
      )
    ) {
      score += 12;
    }

    if (
      brands.includes(
        word
      )
    ) {
      score += 8;
    }
  }

  /*
   * Multi-word searches should not
   * rank products highly when they
   * only match one small part of
   * what was requested.
   */

  if (
    wantedWords.length >= 2
  ) {
    const matchRatio =
      matchedWords /
      wantedWords.length;

    if (matchRatio === 1) {
      score += 80;
    } else if (
      matchRatio >= 0.5
    ) {
      score += 20;
    } else {
      score -= 80;
    }
  }

  /*
   * Slightly penalise very long
   * unrelated product titles.
   * This helps simple searches like
   * "chicken" favour recognisable
   * chicken products rather than
   * heavily flavoured meals.
   */

  const extraWords =
    Math.max(
      0,
      productWords.length -
        wantedWords.length
    );

  score -= Math.min(
    extraWords * 3,
    30
  );

  return score;
}

function buildSearchVariations(
  name
) {
  const original =
    normalizeSearchTerm(name);

  const noHyphens =
    normalizeSearchTerm(
      original.replace(
        /[-–—]/g,
        " "
      )
    );

  const noPunctuation =
    normalizeSearchTerm(
      original.replace(
        /[^a-zA-Z0-9\s]/g,
        " "
      )
    );

  const joinedHyphens =
    normalizeSearchTerm(
      original.replace(
        /[-–—]/g,
        ""
      )
    );

  return [
    ...new Set(
      [
        original,
        noHyphens,
        noPunctuation,
        joinedHyphens,
      ].filter(Boolean)
    ),
  ];
}

async function searchOpenFoodFactsOnce(
  searchTerm,
  originalName
) {
  const url =
    new URL(
      OPEN_FOOD_FACTS_SEARCH_URL
    );

  url.searchParams.set(
    "search_terms",
    searchTerm
  );

  url.searchParams.set(
    "search_simple",
    "1"
  );

  url.searchParams.set(
    "action",
    "process"
  );

  url.searchParams.set(
    "json",
    "1"
  );

  url.searchParams.set(
    "page_size",
    "20"
  );

  url.searchParams.set(

 "fields",
[
  "code",
  "product_name",
  "brands",
  "countries_tags",
  "image_url",
  "image_front_url",
  "image_front_small_url",
].join(",")
  );

  const response =
    await fetch(url, {
      headers: {
        "User-Agent":
          "FamilyHub/0.1 (personal family dashboard)",
        Accept:
          "application/json",
      },

      signal:
        AbortSignal.timeout(
          8000
        ),
    });

  if (!response.ok) {
    throw new Error(
      `Open Food Facts returned ${response.status}`
    );
  }

  const data =
    await response.json();

  const products =
    Array.isArray(
      data?.products
    )
      ? data.products
      : [];

  const ranked =
    products
      .map((product) => ({
        product,

        score:
          scoreProduct(
            product,
            originalName
          ),
      }))
      .filter(
        (entry) =>
          entry.score >= 0
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const best =
    ranked[0]?.product;

  if (!best) {
    return null;
  }

  const imageUrl =
    getProductImage(best);

  if (!imageUrl) {
    return null;
  }

  return {
    imageUrl,

    matchedProduct:
      getProductLabel(best),

    barcode:
      best.code || null,

    searchTerm,
  };
}

async function searchSearchALicious(
  name
) {
  const response =
    await fetch(
      "https://search.openfoodfacts.org/search",
      {
        method: "POST",

        headers: {
          "User-Agent":
            "FamilyHub/0.1 (personal family dashboard)",

          Accept:
            "application/json",

          "Content-Type":
            "application/json",
        },

body: JSON.stringify({
  q: name,

  page_size: 25,

  fields: [
    "code",
    "product_name",
    "brands",
    "countries_tags",
    "image_url",
    "image_front_url",
    "image_front_small_url",
  ],

  boost_phrase: true,

  langs: [
    "en",
  ],
}),

        signal:
          AbortSignal.timeout(
            8000
          ),
      }
    );

  if (!response.ok) {
    throw new Error(
      `Search-a-licious returned ${response.status}`
    );
  }

  const data =
    await response.json();

  const products =
    Array.isArray(
      data?.hits
    )
      ? data.hits
      : [];

  const ranked =
    products
      .map((product) => ({
        product,

        score:
          scoreProduct(
            product,
            name
          ),
      }))
      .filter(
        (entry) =>
          entry.score >= 0
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const best =
    ranked[0]?.product;

  if (!best) {
    return null;
  }

  const imageUrl =
    getProductImage(best);

  if (!imageUrl) {
    return null;
  }

  return {
    imageUrl,

    matchedProduct:
      getProductLabel(best),

    barcode:
      best.code || null,

    searchTerm:
      name,
  };
}

async function searchSearchALiciousOptions(
  name
) {
  const freshFood =
    isFreshFoodSearch(
      name
    );

  const pageSize =
    freshFood
      ? 100
      : 25;

  const response =
    await fetch(
      "https://search.openfoodfacts.org/search",
      {
        method: "POST",

        headers: {
          "User-Agent":
            "FamilyHub/0.1 (personal family dashboard)",

          Accept:
            "application/json",

          "Content-Type":
            "application/json",
        },

        body: JSON.stringify({
          q: name,

          page_size:
            pageSize,

          fields: [
            "code",
            "product_name",
            "brands",
            "countries_tags",
            "image_url",
            "image_front_url",
            "image_front_small_url",
          ],

          boost_phrase: true,

          langs: [
            "en",
          ],
        }),

        signal:
          AbortSignal.timeout(
            8000
          ),
      }
    );

  if (!response.ok) {
    throw new Error(
      `Search-a-licious returned ${response.status}`
    );
  }

  const data =
    await response.json();

  const products =
    Array.isArray(
      data?.hits
    )
      ? data.hits
      : [];

  const ranked =
    products
      .map((product) => {
        let score =
          scoreProduct(
            product,
            name
          );

        if (freshFood) {
          const countries =
            Array.isArray(
              product?.countries_tags
            )
              ? product.countries_tags
                  .join(" ")
                  .toLowerCase()
              : String(
                  product?.countries_tags ||
                    ""
                ).toLowerCase();

          const label =
            String(
              getProductLabel(
                product
              ) || ""
            ).toLowerCase();

          const australian =
            countries.includes(
              "en:australia"
            ) ||
            countries.includes(
              "australia"
            );

          /*
           * Prefer Australian
           * catalogue products.
           */

          if (australian) {
            score += 300;
          }

          /*
           * Coles fresh-food entries
           * are especially useful.
           */

          if (
            label.includes(
              "coles"
            )
          ) {
            score += 180;
          }

          /*
           * De-prioritise common
           * overseas supermarket
           * catalogue results.
           */

          const overseasRetailers =
            [
              "morrisons",
              "tesco",
              "sainsbury",
              "sainsbury's",
              "asda",
              "waitrose",
              "kroger",
              "walmart",
              "whole foods",
              "trader joe",
            ];

          if (
            overseasRetailers.some(
              (retailer) =>
                label.includes(
                  retailer
                )
            )
          ) {
            score -= 220;
          }

          /*
           * Most importantly, stop a
           * processed product from
           * beating the actual fresh
           * food just because it is
           * Australian.
           *
           * Example:
           * Bananas should beat
           * Banana Mini Muffins.
           */

          score -=
            getFreshFoodProcessedPenalty(
              product,
              name
            );
        }

        return {
          product,
          score,
        };
      })
      .filter(
        (entry) =>
          entry.score >= 0
      )
      .sort(
        (a, b) =>
          b.score -
          a.score
      );

  const options = [];

  const seenImages =
    new Set();

  for (
    const entry
    of ranked
  ) {
    const product =
      entry.product;

    const imageUrl =
      getProductImage(
        product
      );

    if (
      !imageUrl ||
      seenImages.has(
        imageUrl
      )
    ) {
      continue;
    }

    seenImages.add(
      imageUrl
    );

    options.push({
      imageUrl,

      matchedProduct:
        getProductLabel(
          product
        ),

      barcode:
        product.code ||
        null,

      score:
        entry.score,
    });

    if (
      options.length >= 6
    ) {
      break;
    }
  }

  return options;
}

/*
 * Search Wikimedia Commons for
 * clean photographs of fresh foods.
 *
 * This is used for things such as:
 *
 * potato
 * banana
 * apple
 * carrot
 * chicken breast
 *
 * Packaged/branded products continue
 * using Open Food Facts.
 */

// Explicit choices remain authoritative; old automatic product matches do not.
const FRESH_IMAGE_SOURCE = "wikimedia-fresh-v2";
const freshImageRequests = new Map();

function isPreferredFreshImage(image) {
  return Boolean(image?.image_url && [
    "custom-upload", "open-food-facts-selected",
    "familyhub-fresh-library", FRESH_IMAGE_SOURCE,
  ].includes(image.source));
}

function savedFreshImage(canonicalName, originalName) {
  const library = getFreshFoodLibraryImage.get(canonicalName);
  if (isPreferredFreshImage(library)) {
    // Older uploads were saved with a generic library source. Keep Reset visible.
    const cached = getCachedImage.get(canonicalName);
    if (cached?.source === "custom-upload" && cached.image_url === library.image_url) {
      return { ...library, source: "custom-upload" };
    }
    return library;
  }
  for (const key of new Set([canonicalName, originalName.toLowerCase()])) {
    const cached = getCachedImage.get(key);
    if (isPreferredFreshImage(cached)) {
      saveFreshFoodLibraryImage.run(canonicalName, cached.image_url,
        cached.source, cached.matched_product || canonicalName,
        Number(cached.rotation || 0));
      return getFreshFoodLibraryImage.get(canonicalName);
    }
  }
  return null;
}

async function resolveFreshFoodImage(name) {
  const canonicalName = getCanonicalFreshFoodName(name);
  let saved = savedFreshImage(canonicalName, name);
  if (!saved) {
    if (!freshImageRequests.has(canonicalName)) {
      const request = (async () => {
        const options = await searchWikimediaFreshFoodOptions(canonicalName);
        // A user may have uploaded or selected an image during the search.
        const current = savedFreshImage(canonicalName, name);
        if (current || !options.length) return current;
        const best = options[0];
        saveFreshFoodLibraryImage.run(canonicalName, best.imageUrl,
          FRESH_IMAGE_SOURCE, best.matchedProduct, 0);
        return getFreshFoodLibraryImage.get(canonicalName);
      })().finally(() => freshImageRequests.delete(canonicalName));
      freshImageRequests.set(canonicalName, request);
    }
    saved = await freshImageRequests.get(canonicalName);
  }
  if (!saved) return null; // Retry later; never substitute a packaged product.
  saveCachedImage.run(canonicalName, canonicalName, saved.image_url,
    saved.source, saved.matched_product, null, Number(saved.rotation || 0));
  return { imageUrl: saved.image_url, source: saved.source,
    matchedProduct: saved.matched_product, barcode: null,
    rotation: Number(saved.rotation || 0), canonicalName };
}

async function searchWikimediaFreshFoodOptions(
  name
) {
  const canonicalName =
    getCanonicalFreshFoodName(
      name
    ) ||
    normalizeSearchTerm(
      name
    ).toLowerCase();

  if (!canonicalName) {
    return [];
  }

  /*
   * Search for the raw ingredient
   * rather than simply "food".
   *
   * "potato food" can return dishes,
   * chips and meals.
   *
   * "raw potato" is much more likely
   * to return the ingredient itself.
   */

  // These Commons photographs have been visually verified as raw ingredients.
  const preferredFile = new Map([
    ["potato", "File:Potato and cross section.jpg"],
    ["carrot", "File:Carrots.jpg"],
    ["apple", "File:Red Apple.jpg"],
    ["banana", "File:Banana-Single.jpg"],
    ["chicken breast", "File:Raw chicken slices.jpg"],
  ]).get(canonicalName);

  const rawSearchTerms =
    new Map([
      [
        "chicken breast",
        "raw chicken breast",
      ],
      [
        "chicken thigh",
        "raw chicken thigh",
      ],
      [
        "chicken drumstick",
        "raw chicken drumstick",
      ],
      [
        "beef mince",
        "raw beef mince",
      ],
      [
        "beef steak",
        "raw beef steak",
      ],
      [
        "pork mince",
        "raw pork mince",
      ],
      [
        "pork chop",
        "raw pork chop",
      ],
      [
        "lamb chop",
        "raw lamb chop",
      ],
      [
        "salmon",
        "raw salmon fillet",
      ],
      [
        "prawns",
        "raw prawns",
      ],
      [
        "fish",
        "raw fish",
      ],
    ]);

  const searchQuery =
    rawSearchTerms.get(
      canonicalName
    ) ||
    `${canonicalName} raw`;

  const url =
    new URL(
      "https://commons.wikimedia.org/w/api.php"
    );

  url.searchParams.set(
    "action",
    "query"
  );

  url.searchParams.set(
    "generator",
    "search"
  );

  url.searchParams.set(
    "gsrsearch",
    searchQuery
  );

  url.searchParams.set(
    "gsrnamespace",
    "6"
  );

  url.searchParams.set(
    "gsrlimit",
    "40"
  );

  url.searchParams.set(
    "prop",
    "imageinfo"
  );

  url.searchParams.set(
    "iiprop",
    "url|mime|extmetadata"
  );

  url.searchParams.set(
    "iiurlwidth",
    "500"
  );

  url.searchParams.set(
    "format",
    "json"
  );

  url.searchParams.set(
    "origin",
    "*"
  );

  try {
    const urls = [url];
    if (preferredFile) {
      const preferredUrl = new URL(url);
      for (const key of ["generator", "gsrsearch", "gsrnamespace", "gsrlimit"]) {
        preferredUrl.searchParams.delete(key);
      }
      preferredUrl.searchParams.set("titles", preferredFile);
      urls.unshift(preferredUrl);
    }
    const responses = await Promise.allSettled(urls.map(async (requestUrl) => {
      const response = await fetch(requestUrl, {
        headers: { "User-Agent": "FamilyHub/0.1 (personal family dashboard)",
          Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("Wikimedia returned " + response.status);
      const data = await response.json();
      if (data.error) throw new Error(data.error.info || "Wikimedia search failed");
      return Object.values(data?.query?.pages || {});
    }));
    const pages = [];
    for (const result of responses) {
      if (result.status === "fulfilled") pages.push(...result.value);
      else console.error("Fresh-food source unavailable:", result.reason.message);
    }

    const options = [];

    const seenImages =
      new Set();

    for (
      const page
      of pages
    ) {
      const imageInfo =
        Array.isArray(
          page?.imageinfo
        )
          ? page.imageinfo[0]
          : null;

      const mime =
        String(
          imageInfo?.mime ||
            ""
        ).toLowerCase();

      const imageUrl =
        imageInfo?.thumburl ||
        imageInfo?.url ||
        null;

      if (
        !imageUrl ||
        !["image/jpeg", "image/png", "image/webp"].includes(mime) ||
        seenImages.has(
          imageUrl
        )
      ) {
        continue;
      }

      seenImages.add(
        imageUrl
      );

      const title =
        String(
          page?.title ||
            canonicalName
        )
          .replace(
            /^File:/i,
            ""
          )
          .replace(
            /\.[a-z0-9]+$/i,
            ""
          )
          .replace(
            /[_-]+/g,
            " "
          )
          .trim();

      const normalizedTitle =
        normalizeFreshFoodName(
          title
        );

      /*
       * Wikimedia contains plenty of
       * images that mention the food
       * but are not useful Pantry
       * pictures.
       *
       * Examples:
       *
       * carrot cake
       * banana chips
       * potato flowers
       * chicken sandwich
       */

      const unwantedWords =
        [
          "bread", "muffin", "muffins", "cookie", "cookies",
          "jam", "sauce", "puree", "flour", "powder", "dried",
          "boiled", "mashed", "roast", "curry", "stew", "pizza",
          "nugget", "nuggets", "breaded", "marinated", "seasoned",
          "packet", "bottle", "logo", "drawing", "illustration",
          "orchard", "garden", "gardens", "blossom", "blossoms", "seedling",
          "leaves", "foliage", "growing", "harvest", "truck",
          "fry", "tempura", "cobbler", "quesadilla", "udon", "spicy",
          "art", "poster", "painting", "handbook", "book", "diseases",
          "fungus", "wild", "plantain", "overexposed", "compressed",
          "cake",
          "cakes",
          "chip",
          "chips",
          "crisp",
          "crisps",
          "juice",
          "smoothie",
          "sandwich",
          "sandwiches",
          "soup",
          "salad",
          "dinner",
          "meal",
          "dish",
          "fried",
          "baked",
          "cooked",
          "roasted",
          "grilled",
          "recipe",
          "restaurant",
          "candy",
          "caramel",
          "dessert",
          "pie",
          "pies",
          "sprouting",
          "flower",
          "flowers",
          "plant",
          "plants",
          "tree",
          "trees",
          "farm",
          "field",
          "fields",
          "carving",
          "refrigerator",
        ];

      const titleWords =
        new Set(
          normalizedTitle
            .split(/\s+/)
            .filter(Boolean)
        );

      const description = normalizeFreshFoodName(
        String(imageInfo?.extmetadata?.ImageDescription?.value || "")
          .replace(/<[^>]*>/g, " ")
      );
      const verified = page.title === preferredFile;
      const descriptionWords = new Set(description.split(/\s+/));
      const unwanted = unwantedWords.some((word) =>
        titleWords.has(word) || descriptionWords.has(word)
      );

      if (unwanted && !verified) {
        continue;
      }

      /*
       * The actual food name should
       * appear in the image title.
       *
       * This prevents loosely related
       * Wikimedia search results from
       * entering the gallery.
       */

      // Match whole aliases, not substrings (apple must not match pineapple).
      const aliases = [...FRESH_FOOD_ALIASES]
        .filter(([, canonical]) => canonical === canonicalName)
        .map(([alias]) => alias);
      const matchesFood = aliases.some((alias) =>
        (" " + normalizedTitle + " ").includes(" " + alias + " ")
      );
      const meat = /\b(chicken|beef|pork|lamb|fish|salmon|tuna|prawns|sausages)\b/.test(canonicalName);
      if (!verified && meat && !/\b(raw|uncooked)\b/.test(normalizedTitle + " " + description)) continue;
      if (canonicalName === "potato" && /\bsweet\b/.test(normalizedTitle)) continue;
      if (!verified && normalizedTitle.split(/\s+/).length > 8) continue;
      if (!verified && !aliases.includes(normalizedTitle) &&
          !/\b(raw|uncooked|fresh|whole|isolated)\b|white background/.test(normalizedTitle)) continue;

      if (!matchesFood && !verified) {
        continue;
      }

      /*
       * Prefer simple titles because
       * they tend to be clean photos
       * of the ingredient itself.
       *
       * Examples:
       *
       * Red Apple
       * Banana on white background
       * Potatoes
       */

      const wordCount =
        normalizedTitle
          .split(/\s+/)
          .filter(Boolean)
          .length;

      let score = verified ? 10000 : 2000;
      if (/\b(raw|uncooked|isolated)\b/.test(normalizedTitle)) score += 400;

      if (
        normalizedTitle ===
        canonicalName
      ) {
        score += 500;
      }

      if (wordCount <= 3) {
        score += 250;
      } else if (
        wordCount <= 5
      ) {
        score += 100;
      }

      if (
        normalizedTitle.includes(
          "white background"
        ) ||
        normalizedTitle.includes(
          "whitebackground"
        )
      ) {
        score += 300;
      }

      options.push({
        imageUrl,

        matchedProduct:
          verified ? canonicalName : (title || canonicalName),

        barcode: null,

        score,

        source: FRESH_IMAGE_SOURCE,

        freshImage: true,
      });
    }

    /*
     * Best fresh-food photographs
     * first, then keep the gallery
     * small.
     */

    return options
      .sort(
        (a, b) =>
          b.score -
          a.score
      )
      .slice(
        0,
        6
      );
  } catch (error) {
    console.error(
      "Wikimedia Commons fresh-food lookup failed:",
      error.message
    );

    return [];
  }
}

async function searchOpenFoodFacts(
  name
) {
  if (getCanonicalFreshFoodName(name)) {
    return resolveFreshFoodImage(name);
  }
  /*
   * First try Search-a-licious.
   * This is much better at
   * full-text product-name
   * searches such as Weet-Bix.
   */

  try {
    const product =
      await searchSearchALicious(
        name
      );

    if (product) {
      return product;
    }
  } catch (error) {
    console.error(
      "Search-a-licious lookup failed:",
      error.message
    );
  }

  /*
   * Fall back to the legacy
   * Open Food Facts search.
   */

  const variations =
    buildSearchVariations(
      name
    );

  for (
    const searchTerm
    of variations
  ) {
    const product =
      await searchOpenFoodFactsOnce(
        searchTerm,
        name
      );

    if (product) {
      return product;
    }
  }

  return null;
}

router.get(
  "/options",
  async (req, res) => {
    const name =
      normalizeSearchTerm(
        req.query.name
      );

    if (!name) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Food name is required",
        });
    }

const freshFood =
  isFreshFoodSearch(
    name
  );

const canonicalFreshFood =
  getCanonicalFreshFoodName(
    name
  );

/*
 * Fresh foods should be searched
 * using their clean canonical name,
 * not the original Pantry text.
 *
 * Examples:
 *
 * "2kg Potatoes"
 *      -> "potato"
 *
 * "6 Pack Apples"
 *      -> "apple"
 *
 * "500g Beef Mince"
 *      -> "beef mince"
 *
 * Branded products continue using
 * their original name.
 */

const automaticSearchName =
  canonicalFreshFood ||
  name;

try {
  /*
   * Fresh foods get clean Wikimedia
   * Commons photographs first.
   *
   * Packaged/branded products skip
   * Wikimedia and continue using
   * Open Food Facts normally.
   */

  let freshImageOptions =
    [];

  if (canonicalFreshFood) {
    freshImageOptions =
      await searchWikimediaFreshFoodOptions(
        canonicalFreshFood
      );
  }

  const productOptions = canonicalFreshFood
    ? []
    : await searchSearchALiciousOptions(automaticSearchName);

  /*
   * Combine both sources while
   * preventing duplicate image URLs.
   *
   * Fresh-food photographs appear
   * first, followed by useful
   * Australian catalogue products.
   */

  const seenOptionImages =
    new Set();

  let options =
    [
      ...freshImageOptions,
      ...productOptions,
    ].filter(
      (option) => {
        if (
          !option?.imageUrl ||
          seenOptionImages.has(
            option.imageUrl
          )
        ) {
          return false;
        }

        seenOptionImages.add(
          option.imageUrl
        );

        return true;
      }
    );

  /*
   * Keep the picker manageable.
   *
   * Six Wikimedia images plus some
   * product results gives the user
   * useful alternatives without an
   * enormous gallery.
   */

  options =
    options.slice(
      0,
      12
    );

  /*
   * If FamilyHub already knows a
   * preferred image for this fresh
   * food, put it first.
   */

  if (canonicalFreshFood) {
    const libraryImage =
      getFreshFoodLibraryImage.get(
        canonicalFreshFood
      );

    if (
      isPreferredFreshImage(libraryImage)
    ) {
      const libraryOption = {
        imageUrl:
          libraryImage.image_url,

        matchedProduct:
          libraryImage.matched_product ||
          canonicalFreshFood,

        barcode: null,

        score: 999999,

        source:
          "familyhub-fresh-library",

        preferred: true,
      };

      /*
       * Remove any duplicate of the
       * master image from the normal
       * search results.
       */

      options =
        options.filter(
          (option) =>
            option.imageUrl !==
            libraryImage.image_url
        );

      options = [
        libraryOption,
        ...options,
      ];
    }
  }

  return res.json({
    success: true,
    name,
    canonicalName:
      canonicalFreshFood ||
      null,
    freshFood,
    options,
  });

    } catch (error) {
      console.error(
        "Food image options lookup failed:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Unable to find image options",
        });
    }
  }
);

router.get(
  "/",
  async (req, res) => {

    const name =
      normalizeSearchTerm(
        req.query.name
      );

    if (!name) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Food name is required",
        });
    }

const cacheName =
  getFoodImageCacheName(
    name
  );

const cacheKey =
  cacheName.toLowerCase();

const canonicalFreshFood =
  getCanonicalFreshFoodName(
    name
  );

// Fresh lookup bypasses stale automatic product-cache entries.
if (canonicalFreshFood) {
  try {
    const wasSaved = Boolean(savedFreshImage(canonicalFreshFood, name));
    const image = await resolveFreshFoodImage(name);
    return res.json({ success: true, name, canonicalName: canonicalFreshFood,
      imageUrl: null, source: null, matchedProduct: null, barcode: null,
      rotation: 0, ...image, cached: wasSaved });
  } catch (error) {
    console.error("Fresh food image lookup failed:", error.message);
    return res.json({ success: true, name, canonicalName: canonicalFreshFood,
      imageUrl: null, source: null, matchedProduct: null, barcode: null,
      rotation: 0, cached: false });
  }
}

let cached =
  getCachedImage.get(
    cacheKey
  );

/*
 * If this is a known fresh food,
 * check FamilyHub's master fresh
 * food image library.
 *
 * A library image takes priority
 * over an automatically discovered
 * Open Food Facts image.
 */

if (canonicalFreshFood) {
  const libraryImage =
    getFreshFoodLibraryImage.get(
      canonicalFreshFood
    );

  if (libraryImage) {
    const cachedMatchesLibrary =
      cached &&
      cached.image_url ===
        libraryImage.image_url &&
      Number(
        cached.rotation || 0
      ) ===
        Number(
          libraryImage.rotation ||
            0
        );

    /*
     * Keep the normal cache in sync
     * with the master library.
     */

    if (!cachedMatchesLibrary) {
      saveCachedImage.run(
        canonicalFreshFood,
        cacheKey,
        libraryImage.image_url,
        libraryImage.source ||
          "familyhub-fresh-library",
        libraryImage.matched_product ||
          canonicalFreshFood,
        null,
        Number(
          libraryImage.rotation ||
            0
        )
      );

      cached =
        getCachedImage.get(
          cacheKey
        );
    }
  }
}

/*
 * Backwards compatibility:
 *
 * Existing fresh-food images may
 * have been saved before canonical
 * cache names were introduced.
 *
 * Only use the legacy item-name
 * cache when neither the shared
 * cache nor fresh-food library
 * already supplied an image.
 */

if (
  !cached &&
  cacheName.toLowerCase() !==
    name.toLowerCase()
) {
  const legacyCacheKey =
    name.toLowerCase();

  const legacyCached =
    getCachedImage.get(
      legacyCacheKey
    );

  if (legacyCached) {
    saveCachedImage.run(
      cacheName,
      cacheKey,
      legacyCached.image_url,
      legacyCached.source,
      legacyCached.matched_product,
      legacyCached.barcode,
      Number(
        legacyCached.rotation ||
          0
      )
    );

    cached =
      getCachedImage.get(
        cacheKey
      );
  }
}

if (cached) {
  return res.json({
    success: true,

    name,

    canonicalName:
      cacheName,

    imageUrl:
      cached.image_url ||
      null,

    source:
      cached.source ||
      null,

    matchedProduct:
      cached.matched_product ||
      null,

    barcode:
      cached.barcode ||
      null,

    rotation:
      Number(
        cached.rotation || 0
      ),

    cached: true,
  });
}

    try {
      const product =
        await searchOpenFoodFacts(
          name
        );

      const result = {
        success: true,
        name,
        imageUrl:
          product?.imageUrl ||
          null,
        source:
          product
            ? (product.source || "open-food-facts")
            : null,
        matchedProduct:
          product?.matchedProduct ||
          null,
        barcode:
          product?.barcode ||
          null,
      };

if (result.imageUrl) {
saveCachedImage.run(
  name,
  cacheKey,
  result.imageUrl,
  result.source,
  result.matchedProduct,
  result.barcode,
  0
);
}

return res.json({
  ...result,
  cached: false,
});

    } catch (error) {
      console.error(
        "Food image lookup failed:",
        error.message
      );

      const result = {
        success: true,
        name,
        imageUrl: null,
        source: null,
        matchedProduct: null,
        barcode: null,
      };

      /*
       * Do not cache failures.
       * A temporary internet/API
       * problem should be allowed
       * to retry later.
       */

      return res.json(
        result
      );
    }
  }
);

router.post(
  "/rotation",
  (req, res) => {
    const name =
      normalizeSearchTerm(
        req.body?.name
      );

    const requestedRotation =
      Number(
        req.body?.rotation
      );

    if (!name) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Food name is required",
        });
    }

    if (
      !Number.isFinite(
        requestedRotation
      )
    ) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Rotation is required",
        });
    }

    const rotation =
      (
        (
          Math.round(
            requestedRotation / 90
          ) * 90
        ) %
          360 +
        360
      ) %
      360;

const cacheName =
  getFoodImageCacheName(
    name
  );

const cacheKey =
  cacheName.toLowerCase();

    const cached =
      getCachedImage.get(
        cacheKey
      );

    if (!cached) {
      return res
        .status(404)
        .json({
          success: false,
          error:
            "No saved image exists for this item",
        });
    }

updateCachedImageRotation.run(
  rotation,
  cacheKey
);

/*
 * Keep the master fresh-food
 * library rotation in sync too.
 */

const canonicalFreshFood =
  getCanonicalFreshFoodName(
    name
  );

if (canonicalFreshFood) {
  const libraryImage =
    getFreshFoodLibraryImage.get(
      canonicalFreshFood
    );

  if (libraryImage) {
    updateFreshFoodLibraryRotation.run(
      rotation,
      canonicalFreshFood
    );
  }
}

return res.json({
  success: true,
  name,
  canonicalName:
    cacheName,
  imageUrl:
    cached.image_url ||
    null,
  source:
    cached.source ||
    null,
  matchedProduct:
    cached.matched_product ||
    null,
  barcode:
    cached.barcode ||
    null,
  rotation,
  cached: true,
});
  }
);

router.post(
  "/select",
  (req, res) => {
    const name =
      normalizeSearchTerm(
        req.body?.name
      );

    const imageUrl =
      String(
        req.body?.imageUrl || ""
      ).trim();

    const matchedProduct =
      normalizeSearchTerm(
        req.body?.matchedProduct
      );

    const barcode =
      String(
        req.body?.barcode || ""
      ).trim() || null;

    if (!name) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Food name is required",
        });
    }

    if (!imageUrl) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Image URL is required",
        });
    }

    let parsedImageUrl;

    try {
      parsedImageUrl =
        new URL(imageUrl);
    } catch {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Invalid image URL",
        });
    }

    if (
      parsedImageUrl.protocol !==
        "https:" &&
      parsedImageUrl.protocol !==
        "http:"
    ) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Image URL must use HTTP or HTTPS",
        });
    }

    try {
const cacheName =
  getFoodImageCacheName(
    name
  );

const cacheKey =
  cacheName.toLowerCase();

      const previous =
        getCachedImage.get(
          cacheKey
        );

saveCachedImage.run(
  cacheName,
  cacheKey,
  imageUrl,
  "open-food-facts-selected",
  matchedProduct || name,
  barcode,
  0
);

/*
 * If this is a recognised fresh
 * food, remember the selected image
 * in FamilyHub's master fresh-food
 * library as well.
 *
 * This means:
 *
 * Banana
 * Bananas
 * Fresh Banana
 * Fresh Bananas
 *
 * can all reuse the same preferred
 * image in future.
 */

const canonicalFreshFood =
  getCanonicalFreshFoodName(
    name
  );

if (canonicalFreshFood) {
  saveFreshFoodLibraryImage.run(
    canonicalFreshFood,
    imageUrl,
    "familyhub-fresh-library",
    matchedProduct ||
      canonicalFreshFood,
    0
  );
}

      deleteCustomImageFile(
        previous
      );

      return res.json({
        success: true,
        name,
        imageUrl,
        source:
          "open-food-facts-selected",
        matchedProduct:
          matchedProduct || name,
        barcode,
        cached: true,
      });
    } catch (error) {
      console.error(
        "Food image selection failed:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Unable to save selected image",
        });
    }
  }
);

router.post(
  "/custom",
  uploadFoodImage.single(
    "image"
  ),
  (req, res) => {
    try {
      const name =
        normalizeSearchTerm(
          req.body.name
        );

      if (!name) {
        if (req.file?.path) {
          fs.unlink(
            req.file.path,
            () => {}
          );
        }

        return res
          .status(400)
          .json({
            success: false,
            error:
              "Food name is required",
          });
      }

      if (!req.file) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Image file is required",
          });
      }

const cacheName =
  getFoodImageCacheName(
    name
  );

const cacheKey =
  cacheName.toLowerCase();

      const imageUrl =
        `/uploads/food-images/${req.file.filename}`;

      const previous =
        getCachedImage.get(
          cacheKey
        );

saveCachedImage.run(
  cacheName,
  cacheKey,
  imageUrl,
  "custom-upload",
  name,
  null,
  0
);

/*
 * If this is a recognised fresh
 * food, also save the uploaded
 * image as FamilyHub's preferred
 * master image for that food.
 */

const canonicalFreshFood =
  getCanonicalFreshFoodName(
    name
  );

if (canonicalFreshFood) {
  saveFreshFoodLibraryImage.run(
    canonicalFreshFood,
    imageUrl,
    "familyhub-fresh-library",
    canonicalFreshFood,
    0
  );
}
      if (
        previous?.source ===
          "custom-upload" &&
        previous?.image_url?.startsWith(
          "/uploads/food-images/"
        ) &&
        previous.image_url !==
          imageUrl
      ) {
        const previousFilename =
          path.basename(
            previous.image_url
          );

        const previousPath =
          path.join(
            FOOD_IMAGE_UPLOAD_DIRECTORY,
            previousFilename
          );

        fs.unlink(
          previousPath,
          () => {}
        );
      }

      return res.json({
        success: true,
        name,
        imageUrl,
        source:
          "custom-upload",
        matchedProduct:
          name,
        barcode: null,
        cached: true,
      });
    } catch (error) {
      console.error(
        "Custom food image upload failed:",
        error
      );

      if (req.file?.path) {
        fs.unlink(
          req.file.path,
          () => {}
        );
      }

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Unable to save custom food image",
        });
    }
  }
);

router.post(
  "/custom-url",
  async (req, res) => {
    const name =
      normalizeSearchTerm(
        req.body?.name
      );

    const imageUrl =
      String(
        req.body?.imageUrl || ""
      ).trim();

    if (!name) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Food name is required",
        });
    }

    if (!imageUrl) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Image URL is required",
        });
    }

    let remoteUrl;

    try {
      remoteUrl =
        new URL(imageUrl);
    } catch {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Enter a valid image URL",
        });
    }

    if (
      remoteUrl.protocol !==
        "https:" &&
      remoteUrl.protocol !==
        "http:"
    ) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Image URL must use HTTP or HTTPS",
        });
    }

    try {
      const response =
        await fetch(
          remoteUrl,
          {
            headers: {
              "User-Agent":
                "FamilyHub/0.1 (personal family dashboard)",
              Accept:
                "image/*",
            },

            signal:
              AbortSignal.timeout(
                12000
              ),
          }
        );

      if (!response.ok) {
        throw new Error(
          `Image website returned ${response.status}`
        );
      }

      const contentType =
        String(
          response.headers.get(
            "content-type"
          ) || ""
        )
          .split(";")[0]
          .trim()
          .toLowerCase();

      const allowedTypes =
        new Map([
          [
            "image/jpeg",
            ".jpg",
          ],
          [
            "image/png",
            ".png",
          ],
          [
            "image/webp",
            ".webp",
          ],
        ]);

      const extension =
        allowedTypes.get(
          contentType
        );

      if (!extension) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "The URL must point directly to a JPG, PNG or WebP image",
          });
      }

      const arrayBuffer =
        await response.arrayBuffer();

      const imageBuffer =
        Buffer.from(
          arrayBuffer
        );

      if (
        imageBuffer.length >
        10 * 1024 * 1024
      ) {
        return res
          .status(400)
          .json({
            success: false,
            error:
              "Image must be smaller than 10 MB",
          });
      }

      const filename =
        `food-${Date.now()}-${Math.random()
          .toString(36)
          .slice(
            2,
            10
          )}${extension}`;

      const destination =
        path.join(
          FOOD_IMAGE_UPLOAD_DIRECTORY,
          filename
        );

      await fs.promises.writeFile(
        destination,
        imageBuffer
      );

const cacheName =
  getFoodImageCacheName(
    name
  );

const cacheKey =
  cacheName.toLowerCase();

const previous =
  getCachedImage.get(
    cacheKey
  );

const localImageUrl =
  `/uploads/food-images/${filename}`;

saveCachedImage.run(
  cacheName,
  cacheKey,
  localImageUrl,
  "custom-upload",
  name,
  null,
  0
);

/*
 * If this is a recognised fresh
 * food, save the downloaded image
 * into FamilyHub's master fresh-
 * food library as well.
 */

const canonicalFreshFood =
  getCanonicalFreshFoodName(
    name
  );

if (canonicalFreshFood) {
  saveFreshFoodLibraryImage.run(
    canonicalFreshFood,
    localImageUrl,
    "familyhub-fresh-library",
    canonicalFreshFood,
    0
  );
}

deleteCustomImageFile(
  previous
);

      return res.json({
        success: true,
        name,
        imageUrl:
          localImageUrl,
        source:
          "custom-upload",
        matchedProduct:
          name,
        barcode: null,
        cached: true,
      });
    } catch (error) {
      console.error(
        "Custom food image URL failed:",
        error
      );

      return res
        .status(400)
        .json({
          success: false,
          error:
            error.message ||
            "Unable to download image",
        });
    }
  }
);

router.post(
  "/reset",
  async (req, res) => {
    const name =
      normalizeSearchTerm(
        req.body?.name
      );

    if (!name) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            "Food name is required",
        });
    }

const cacheName =
  getFoodImageCacheName(
    name
  );

const cacheKey =
  cacheName.toLowerCase();

const canonicalFreshFood =
  getCanonicalFreshFoodName(
    name
  );

const previous =
  getCachedImage.get(
    cacheKey
  );

/*
 * Remove the normal cached image.
 */

deleteCachedImage.run(
  cacheKey
);

/*
 * Remove any old pre-alias cache
 * entry as well.
 *
 * Example:
 * bananas -> banana
 */

const legacyCacheKey =
  name.toLowerCase();

if (
  legacyCacheKey !==
  cacheKey
) {
  deleteCachedImage.run(
    legacyCacheKey
  );
}

/*
 * Resetting a fresh food also
 * removes FamilyHub's preferred
 * master image for that food.
 */

if (canonicalFreshFood) {
  deleteFreshFoodLibraryImage.run(
    canonicalFreshFood
  );
}

/*
 * Remove the local custom image
 * file after its database entries
 * have been cleared.
 */

deleteCustomImageFile(
  previous
);

    try {
      const product =
        await searchOpenFoodFacts(
          name
        );

      const result = {
        success: true,
        name,

        imageUrl:
          product?.imageUrl ||
          null,

        source:
          product
            ? (product.source || "open-food-facts")
            : null,

        matchedProduct:
          product?.matchedProduct ||
          null,

        barcode:
          product?.barcode ||
          null,
      };

if (result.imageUrl) {
  saveCachedImage.run(
    cacheName,
    cacheKey,
    result.imageUrl,
    result.source,
    result.matchedProduct,
    result.barcode,
    0
  );
}

      return res.json({
        ...result,
        cached:
          Boolean(
            result.imageUrl
          ),
      });
    } catch (error) {
      console.error(
        "Food image reset failed:",
        error
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "Unable to reset food image",
        });
    }
  }
);

router.use(
  (
    error,
    req,
    res,
    next
  ) => {
    if (
      error instanceof
      multer.MulterError
    ) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            error.code ===
            "LIMIT_FILE_SIZE"
              ? "Image must be smaller than 10 MB"
              : error.message,
        });
    }

    if (error) {
      return res
        .status(400)
        .json({
          success: false,
          error:
            error.message ||
            "Unable to upload image",
        });
    }

    next();
  }
);

module.exports = router;