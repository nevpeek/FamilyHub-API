const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cheerio = require("cheerio");
const db = require("../database/db");

const router = express.Router();

const recipeUploadDirectory =
  path.join(
    __dirname,
    "../../uploads/recipes"
  );

if (
  !fs.existsSync(
    recipeUploadDirectory
  )
) {
  fs.mkdirSync(
    recipeUploadDirectory,
    {
      recursive: true,
    }
  );
}

const storage =
  multer.diskStorage({
    destination:
      (
        req,
        file,
        callback
      ) => {
        callback(
          null,
          recipeUploadDirectory
        );
      },

    filename:
      (
        req,
        file,
        callback
      ) => {
        const extension =
          path.extname(
            file.originalname
          ) || ".jpg";

        const filename =
          `recipe-${Date.now()}-${Math.round(
            Math.random() *
              1e9
          )}${extension}`;

        callback(
          null,
          filename
        );
      },
  });

const upload =
  multer({
    storage,

    fileFilter:
      (
        req,
        file,
        callback
      ) => {
        if (
          !file.mimetype.startsWith(
            "image/"
          )
        ) {
          return callback(
            new Error(
              "Only image files are allowed"
            )
          );
        }

        callback(
          null,
          true
        );
      },

    limits: {
      fileSize:
        10 * 1024 * 1024,
    },
  });

function parseIsoDuration(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );

  if (!match) {
    return null;
  }

  const days =
    Number(match[1] || 0);

  const hours =
    Number(match[2] || 0);

  const minutes =
    Number(match[3] || 0);

  const seconds =
    Number(match[4] || 0);

  return (
    days * 1440 +
    hours * 60 +
    minutes +
    Math.round(seconds / 60)
  );
}

function stripHtml(value) {
  if (!value) {
    return null;
  }

  const $ =
    cheerio.load(
      `<div>${String(value)}</div>`
    );

  const text =
    $("div")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim();

  return text || null;
}

function findRecipeJsonLd(value) {
  if (!value) {
    return null;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const found =
        findRecipeJsonLd(item);

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (typeof value !== "object") {
    return null;
  }

  const type =
    value["@type"];

  const types =
    Array.isArray(type)
      ? type
      : [type];

  if (
    types.some(
      (item) =>
        String(item).toLowerCase() ===
        "recipe"
    )
  ) {
    return value;
  }

  if (value["@graph"]) {
    const found =
      findRecipeJsonLd(
        value["@graph"]
      );

    if (found) {
      return found;
    }
  }

  return null;
}

function getRecipeImageUrl(recipe) {
  const image =
    recipe?.image;

  if (!image) {
    return null;
  }

  if (typeof image === "string") {
    return image;
  }

  if (Array.isArray(image)) {
    const first =
      image[0];

    if (typeof first === "string") {
      return first;
    }

    return (
      first?.url ||
      first?.contentUrl ||
      null
    );
  }

  return (
    image.url ||
    image.contentUrl ||
    null
  );
}

function parseInstructions(value) {
  if (!value) {
    return null;
  }

  const steps = [];

  function cleanInstruction(value) {
    const text = stripHtml(value);

    if (!text) {
      return null;
    }

    return String(text)
      .replace(/\u00a0/g, " ")
      .replace(/\s+([,.;:!?])/g, "$1")
      .replace(/([,;:!?])(?=\S)/g, "$1 ")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function splitInstructionBlock(value) {
    const text =
      cleanInstruction(value);

    if (!text) {
      return [];
    }

    /*
     * Some recipe sites bundle several named
     * method steps into one HowToStep:
     *
     * Sauté - Heat oil...
     * Cook lamb - Turn heat...
     * Make sauce - Add flour...
     *
     * Detect those headings and split them
     * into individual FamilyHub steps.
     */
    const headingPattern =
      /(?:^|\s)(Sauté|Saute|Cook lamb|Cook beef|Cook chicken|Cook pork|Cook mince|Make sauce|Make filling|Make topping|Make mash|Mash|Assemble|Bake|Grill|Roast|Simmer|Boil|Fry|Cook|Serve|Rest|Prepare|Mix|Combine|Add vegetables|Add liquid)\s*[-–—:]\s*/gi;

    const matches = [
      ...text.matchAll(
        headingPattern
      ),
    ];

    /*
     * If there aren't multiple named sections,
     * keep the website's original step intact.
     */
    if (matches.length < 2) {
      return [text];
    }

    const result = [];

    /*
     * Preserve any useful text appearing before
     * the first detected heading.
     */
    const beforeFirst =
      text
        .slice(
          0,
          matches[0].index
        )
        .trim();

    if (beforeFirst) {
      result.push(beforeFirst);
    }

    matches.forEach(
      (match, index) => {
        const heading =
          match[1].trim();

        const contentStart =
          match.index +
          match[0].length;

        const contentEnd =
          index + 1 <
          matches.length
            ? matches[index + 1]
                .index
            : text.length;

        const content =
          text
            .slice(
              contentStart,
              contentEnd
            )
            .trim();

        if (!content) {
          return;
        }

        result.push(
          `${heading}: ${content}`
        );
      }
    );

    return result;
  }

  function addInstruction(value) {
    const parsedSteps =
      splitInstructionBlock(value);

    parsedSteps.forEach(
      (step) => {
        if (step) {
          steps.push(step);
        }
      }
    );
  }

  function collect(item) {
    if (!item) {
      return;
    }

    if (typeof item === "string") {
      addInstruction(item);
      return;
    }

    if (Array.isArray(item)) {
      item.forEach(collect);
      return;
    }

    if (typeof item === "object") {
      /*
       * Normal HowToStep.
       */
      if (item.text) {
        addInstruction(
          item.text
        );
      }

      /*
       * Some websites use HowToSection
       * containing nested HowToSteps.
       */
      if (item.itemListElement) {
        collect(
          item.itemListElement
        );
      }
    }
  }

  collect(value);

  /*
   * Remove consecutive duplicates.
   */
  const uniqueSteps =
    steps.filter(
      (step, index) =>
        index === 0 ||
        step !==
          steps[index - 1]
    );

  return uniqueSteps.length
    ? uniqueSteps.join("\n")
    : null;
}

function cleanImportedDescription(value) {
  const text = stripHtml(value);

  if (!text) {
    return null;
  }

  return String(text)
    .replace(/\u00a0/g, " ")

    /* Common website/video intro rubbish */
    .replace(
      /^\s*recipe\s+video\s+(?:above|below)\.?\s*/i,
      ""
    )
    .replace(
      /^\s*video\s+(?:above|below)\.?\s*/i,
      ""
    )
    .replace(
      /^\s*watch\s+(?:the\s+)?recipe\s+video\s+(?:above|below)\.?\s*/i,
      ""
    )

    /* Clean spaces around punctuation */
    .replace(/\s+([,.;:!?])/g, "$1")

    /* Collapse repeated whitespace */
    .replace(/[ \t]{2,}/g, " ")

    .trim();
}

function cleanImportedIngredient(value) {
  const text = stripHtml(value);

  if (!text) {
    return null;
  }

  let cleaned = String(text)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  /*
   * Recipe sites sometimes produce malformed notes:
   *
   *   garlic cloves (, minced)
   *   onion (, finely chopped)
   *   bouillon cube (, crumbled (OXO brand crumbles easily))
   *
   * Convert the malformed "(," wrapper into a normal comma.
   */
  cleaned = cleaned.replace(
    /\s*\(\s*,\s*/g,
    ", "
  );

  /*
   * After removing "(," above, the matching outer closing
   * bracket can be left behind:
   *
   *   garlic cloves, minced)
   *   onion, finely chopped)
   *   bouillon cube, crumbled (OXO brand crumbles easily))
   *
   * Remove ONLY unmatched closing brackets from the end.
   * Useful balanced brackets such as (30g) and (2.2 lb)
   * are preserved.
   */
  while (cleaned.endsWith(")")) {
    const openingCount =
      (cleaned.match(/\(/g) || []).length;

    const closingCount =
      (cleaned.match(/\)/g) || []).length;

    if (closingCount <= openingCount) {
      break;
    }

    cleaned =
      cleaned.slice(0, -1).trim();
  }

  /*
   * Flatten accidental double brackets:
   *
   *   ((or water))
   *   ((whole or low fat))
   *
   * becomes:
   *
   *   (or water)
   *   (whole or low fat)
   */
  let previous;

  do {
    previous = cleaned;

    cleaned = cleaned.replace(
      /\(\s*\(([^()]*)\)\s*\)/g,
      "($1)"
    );
  } while (cleaned !== previous);

  /*
   * Convert ordinary preparation notes to comma text.
   *
   *   garlic cloves (minced)
   *   onion (finely chopped)
   *   butter (melted)
   *
   * becomes:
   *
   *   garlic cloves, minced
   *   onion, finely chopped
   *   butter, melted
   *
   * Do NOT touch measurements such as:
   *
   *   1.2kg (2.2 lb)
   *   2 tbsp (30g)
   *   2.5cm (1")
   */
  cleaned = cleaned.replace(
    /\s*\(\s*(minced|finely minced|chopped|finely chopped|diced|finely diced|sliced|thinly sliced|grated|shredded|melted|softened|crushed|peeled|optional)\s*\)/gi,
    ", $1"
  );

  /*
   * "or" notes are useful, but don't need brackets:
   *
   *   red wine (or water)
   *   milk (whole or low fat)
   *
   * becomes:
   *
   *   red wine, or water
   *   milk, whole or low fat
   */
  cleaned = cleaned.replace(
    /\s*\(\s*(or\s+[^()]+|whole\s+or\s+low\s+fat)\s*\)/gi,
    ", $1"
  );

  /*
   * Normalise spacing inside any useful brackets that remain.
   */
  cleaned = cleaned
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")");

  /*
   * Clean punctuation and whitespace.
   */
  cleaned = cleaned
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/,\s*/g, ", ")
    .replace(/,\s*,+/g, ", ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  /*
   * Final safety pass:
   * remove only genuinely unmatched closing brackets.
   */
  while (cleaned.endsWith(")")) {
    const openingCount =
      (cleaned.match(/\(/g) || []).length;

    const closingCount =
      (cleaned.match(/\)/g) || []).length;

    if (closingCount <= openingCount) {
      break;
    }

    cleaned =
      cleaned.slice(0, -1).trim();
  }

  return cleaned;
}

function parseServings(value) {
  if (
    value == null ||
    value === ""
  ) {
    return null;
  }

  if (
    typeof value === "number"
  ) {
    return Math.round(value);
  }

  const match =
    String(value).match(/\d+/);

  return match
    ? Number(match[0])
    : null;
}

function parseCategory(value, recipe = {}) {
  const categoryText = Array.isArray(value)
    ? value.join(" ")
    : String(value || "");

  const cuisineText = Array.isArray(
    recipe.recipeCuisine
  )
    ? recipe.recipeCuisine.join(" ")
    : String(
        recipe.recipeCuisine || ""
      );

  const keywordsText = Array.isArray(
    recipe.keywords
  )
    ? recipe.keywords.join(" ")
    : String(
        recipe.keywords || ""
      );

  const nameText =
    String(recipe.name || "");

  const descriptionText =
    String(recipe.description || "");

  const haystack = [
    categoryText,
    cuisineText,
    keywordsText,
    nameText,
    descriptionText,
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[_-]+/g, " ");

  /*
   * Specific meal styles first.
   * This avoids generic words such as
   * "dinner" or "main course" winning.
   */

  if (
    /\bpasta\b/.test(haystack) ||
    /\bspaghetti\b/.test(haystack) ||
    /\bfettuccine\b/.test(haystack) ||
    /\blinguine\b/.test(haystack) ||
    /\bpenne\b/.test(haystack) ||
    /\bravioli\b/.test(haystack) ||
    /\blasagne\b/.test(haystack) ||
    /\blasagna\b/.test(haystack)
  ) {
    return "pasta";
  }

  if (
    /\bmexican\b/.test(haystack) ||
    /\btaco\b/.test(haystack) ||
    /\btacos\b/.test(haystack) ||
    /\bburrito\b/.test(haystack) ||
    /\bquesadilla\b/.test(haystack) ||
    /\benchilada\b/.test(haystack) ||
    /\bfajita\b/.test(haystack)
  ) {
    return "mexican";
  }

  if (
    /\bindian\b/.test(haystack) ||
    /\bcurry\b/.test(haystack) ||
    /\btikka\b/.test(haystack) ||
    /\bmasala\b/.test(haystack) ||
    /\bkorma\b/.test(haystack) ||
    /\bbiryani\b/.test(haystack)
  ) {
    return "indian";
  }

  if (
    /\bchinese\b/.test(haystack) ||
    /\bjapanese\b/.test(haystack) ||
    /\bkorean\b/.test(haystack) ||
    /\bthai\b/.test(haystack) ||
    /\bvietnamese\b/.test(haystack) ||
    /\basian\b/.test(haystack) ||
    /\bstir fry\b/.test(haystack) ||
    /\bstir-fry\b/.test(haystack)
  ) {
    return "asian";
  }

  if (
    /\bpizza\b/.test(haystack)
  ) {
    return "pizza";
  }

  if (
    /\bslow cooker\b/.test(haystack) ||
    /\bslow cooked\b/.test(haystack) ||
    /\bcrockpot\b/.test(haystack) ||
    /\bcrock pot\b/.test(haystack)
  ) {
    return "slow-cooker";
  }

  if (
    /\bbbq\b/.test(haystack) ||
    /\bbarbecue\b/.test(haystack) ||
    /\bgrilled\b/.test(haystack) ||
    /\bgrilling\b/.test(haystack)
  ) {
    return "bbq";
  }

  if (
    /\bseafood\b/.test(haystack) ||
    /\bfish\b/.test(haystack) ||
    /\bsalmon\b/.test(haystack) ||
    /\btuna\b/.test(haystack) ||
    /\bprawn\b/.test(haystack) ||
    /\bprawns\b/.test(haystack) ||
    /\bshrimp\b/.test(haystack)
  ) {
    return "seafood";
  }

  if (
    /\bvegetarian\b/.test(haystack) ||
    /\bvegan\b/.test(haystack) ||
    /\bmeatless\b/.test(haystack)
  ) {
    return "vegetarian";
  }

  /*
   * Meat categories come after cuisine/style,
   * so "Indian chicken curry" becomes Indian
   * rather than Chicken.
   */

  if (
    /\bchicken\b/.test(haystack)
  ) {
    return "chicken";
  }

  if (
    /\bbeef\b/.test(haystack) ||
    /\bsteak\b/.test(haystack) ||
    /\bmince\b/.test(haystack) ||
    /\bground beef\b/.test(haystack) ||
    /\blamb\b/.test(haystack) ||
    /\bshepherd'?s pie\b/.test(haystack)
  ) {
    return "beef";
  }

  if (
    /\bpork\b/.test(haystack) ||
    /\bbacon\b/.test(haystack) ||
    /\bham\b/.test(haystack)
  ) {
    return "pork";
  }

  return "other";
}

async function downloadImportedRecipeImage(
  imageUrl
) {
  if (!imageUrl) {
    return null;
  }

  let parsedUrl;

  try {
    parsedUrl =
      new URL(imageUrl);
  } catch {
    return null;
  }

  if (
    !["http:", "https:"].includes(
      parsedUrl.protocol
    )
  ) {
    return null;
  }

  const response =
    await fetch(
      parsedUrl.toString(),
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 FamilyHub Recipe Importer",
        },
        signal:
          AbortSignal.timeout(
            15000
          ),
      }
    );

  if (!response.ok) {
    return null;
  }

  const contentType =
    response.headers
      .get("content-type")
      ?.toLowerCase() || "";

  let extension = ".jpg";

  if (
    contentType.includes(
      "image/png"
    )
  ) {
    extension = ".png";
  } else if (
    contentType.includes(
      "image/webp"
    )
  ) {
    extension = ".webp";
  } else if (
    contentType.includes(
      "image/gif"
    )
  ) {
    extension = ".gif";
  }

  const filename =
    `recipe-import-${Date.now()}-${Math.round(
      Math.random() * 1e9
    )}${extension}`;

  const filePath =
    path.join(
      recipeUploadDirectory,
      filename
    );

  const arrayBuffer =
    await response.arrayBuffer();

  await fs.promises.writeFile(
    filePath,
    Buffer.from(
      arrayBuffer
    )
  );

  return `/uploads/recipes/${filename}`;
}

function getRecipeById(id) {
  return db
    .prepare(`
      SELECT
        id,
        title,
        description,
        ingredients,
        recipe_url,
        photo_url,
        prep_time,
        cook_time,
        servings,
        category,
        instructions,
        created_at,
        updated_at
      FROM recipes
      WHERE id = ?
    `)
    .get(id);
}

router.post(
  "/import-url",
  async (req, res) => {
    const {
      url,
    } = req.body;

    if (
      !url ||
      !String(url).trim()
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Recipe URL is required",
      });
    }

    let recipeUrl;

    try {
      recipeUrl =
        new URL(
          String(url).trim()
        );
    } catch {
      return res.status(400).json({
        success: false,
        error:
          "Enter a valid recipe URL",
      });
    }

    if (
      !["http:", "https:"].includes(
        recipeUrl.protocol
      )
    ) {
      return res.status(400).json({
        success: false,
        error:
          "Recipe URL must use http or https",
      });
    }

    try {
      const response =
        await fetch(
          recipeUrl.toString(),
          {
            headers: {
              "User-Agent":
                "Mozilla/5.0 FamilyHub Recipe Importer",
              Accept:
                "text/html,application/xhtml+xml",
            },
            redirect: "follow",
            signal:
              AbortSignal.timeout(
                15000
              ),
          }
        );

      if (!response.ok) {
        throw new Error(
          `Recipe website returned ${response.status}`
        );
      }

      const html =
        await response.text();

      const $ =
        cheerio.load(html);

      let structuredRecipe =
        null;

      $(
        'script[type="application/ld+json"]'
      ).each(
        (index, element) => {
          if (
            structuredRecipe
          ) {
            return;
          }

          const raw =
            $(element)
              .html()
              ?.trim();

          if (!raw) {
            return;
          }

          try {
            const parsed =
              JSON.parse(raw);

            const found =
              findRecipeJsonLd(
                parsed
              );

            if (found) {
              structuredRecipe =
                found;
            }
          } catch {
            // Ignore invalid JSON-LD blocks.
          }
        }
      );

      if (!structuredRecipe) {
        return res.status(422).json({
          success: false,
          error:
            "FamilyHub could not find structured recipe data on that page",
        });
      }

const ingredientList =
  Array.isArray(
    structuredRecipe.recipeIngredient
  )
    ? structuredRecipe.recipeIngredient
        .map(
          (item) =>
            cleanImportedIngredient(
              item
            )
        )
        .filter(Boolean)
    : [];

      const imageUrl =
        getRecipeImageUrl(
          structuredRecipe
        );

      let photoUrl =
        null;

      if (imageUrl) {
        try {
          photoUrl =
            await downloadImportedRecipeImage(
              imageUrl
            );
        } catch (err) {
          console.error(
            "Recipe image import failed:",
            err
          );
        }
      }

      const prepTime =
        parseIsoDuration(
          structuredRecipe.prepTime
        );

      const cookTime =
        parseIsoDuration(
          structuredRecipe.cookTime
        );

      const recipe = {
        title:
          stripHtml(
            structuredRecipe.name
          ) || "",

description:
  cleanImportedDescription(
    structuredRecipe.description
  ),

        ingredients:
          ingredientList.length
            ? ingredientList.join(
                "\n"
              )
            : null,

        instructions:
          parseInstructions(
            structuredRecipe.recipeInstructions
          ),

        recipeUrl:
          recipeUrl.toString(),

        photoUrl,

        prepTime,

        cookTime,

        servings:
          parseServings(
            structuredRecipe.recipeYield
          ),

category:
  parseCategory(
    structuredRecipe.recipeCategory,
    structuredRecipe
  ),
      };

      res.json({
        success: true,
        recipe,
      });
    } catch (err) {
      console.error(
        "Recipe URL import failed:",
        err
      );

      res.status(500).json({
        success: false,
        error:
          err.message ||
          "Unable to import recipe",
      });
    }
  }
);

router.post(
  "/upload-photo",
  upload.single("photo"),
  (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error:
          "No photo uploaded",
      });
    }

    const photoUrl =
      `/uploads/recipes/${req.file.filename}`;

    res.status(201).json({
      success: true,
      photoUrl,
    });
  }
);

router.get("/", (req, res) => {
  const recipes = db
    .prepare(`
      SELECT
        id,
        title,
        description,
        ingredients,
        recipe_url,
        photo_url,
        prep_time,
        cook_time,
        servings,
        category,
        instructions,
        created_at,
        updated_at
      FROM recipes
      ORDER BY title ASC
    `)
    .all();

  res.json({
    success: true,
    recipes,
  });
});

router.get("/:id", (req, res) => {
  const recipe = getRecipeById(
    Number(req.params.id)
  );

  if (!recipe) {
    return res.status(404).json({
      success: false,
      error: "Recipe not found",
    });
  }

  res.json({
    success: true,
    recipe,
  });
});

router.post("/", (req, res) => {
  
  const {
    title,
    description = null,
    ingredients = null,
    recipeUrl = null,
    photoUrl = null,
    prepTime = null,
    cookTime = null,
    servings = null,
    category = null,
    instructions = null,
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  const result = db
    .prepare(`
              INSERT INTO recipes (
        title,
        description,
        ingredients,
        recipe_url,
        photo_url,
        prep_time,
        cook_time,
        servings,
        category,
        instructions
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
           .run(
      title.trim(),
      description,
      ingredients,
      recipeUrl,
      photoUrl,
      prepTime,
      cookTime,
      servings,
      category,
      instructions
    );

  const recipeId =
    Number(result.lastInsertRowid);

  res.status(201).json({
    success: true,
    recipe:
      getRecipeById(recipeId),
  });
});

router.put("/:id", (req, res) => {
  const recipeId =
    Number(req.params.id);

  const existingRecipe =
    getRecipeById(recipeId);

  if (!existingRecipe) {
    return res.status(404).json({
      success: false,
      error: "Recipe not found",
    });
  }

    const {
    title,
    description = null,
    ingredients = null,
    recipeUrl = null,
    photoUrl = null,
    prepTime = null,
    cookTime = null,
    servings = null,
    category = null,
    instructions = null,
  } = req.body;

  if (!title || !title.trim()) {
    return res.status(400).json({
      success: false,
      error: "Title is required",
    });
  }

  db.prepare(`
       UPDATE recipes
    SET
      title = ?,
      description = ?,
      ingredients = ?,
      recipe_url = ?,
      photo_url = ?,
      prep_time = ?,
      cook_time = ?,
      servings = ?,
      category = ?,
      instructions = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
     `).run(
    title.trim(),
    description,
    ingredients,
    recipeUrl,
    photoUrl,
    prepTime,
    cookTime,
    servings,
    category,
    instructions,
    recipeId
  );

  res.json({
    success: true,
    recipe:
      getRecipeById(recipeId),
  });
});

router.delete("/:id", (req, res) => {
  const recipeId =
    Number(req.params.id);

  const existingRecipe =
    getRecipeById(recipeId);

  if (!existingRecipe) {
    return res.status(404).json({
      success: false,
      error: "Recipe not found",
    });
  }

  db.prepare(`
    DELETE FROM recipes
    WHERE id = ?
  `).run(recipeId);

  res.json({
    success: true,
  });
});

module.exports = router;