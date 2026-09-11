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

  function collect(item) {
    if (!item) {
      return;
    }

    if (typeof item === "string") {
      const text = stripHtml(item);

      if (text) {
        steps.push(text);
      }

      return;
    }

    if (Array.isArray(item)) {
      item.forEach(collect);
      return;
    }

    if (typeof item === "object") {
      if (item.text) {
        const text = stripHtml(item.text);

        if (text) {
          steps.push(text);
        }
      }

      if (item.itemListElement) {
        collect(item.itemListElement);
      }
    }
  }

  collect(value);

  return steps.length
    ? steps.join("\n")
    : null;
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

function parseCategory(value) {
  if (!value) {
    return null;
  }

  const rawCategory =
    Array.isArray(value)
      ? value[0]
      : String(value)
          .split(",")[0];

  const category =
    String(rawCategory)
      .trim()
      .toLowerCase()
      .replace(/[_\s]+/g, "-");

  const mappings = {
    breakfast: "breakfast",
    brunch: "breakfast",

    lunch: "lunch",

    dinner: "dinner",
    "main-course": "dinner",
    "main-dish": "dinner",
    main: "dinner",
    entree: "dinner",
    "main-meal": "dinner",

    pasta: "pasta",

    bbq: "bbq",
    barbecue: "bbq",
    grilling: "bbq",
    grill: "bbq",

    "slow-cooker": "slow-cooker",
    crockpot: "slow-cooker",
    "crock-pot": "slow-cooker",

    dessert: "dessert",
    desserts: "dessert",
    cake: "dessert",
    cakes: "dessert",
    baking: "dessert",

    snack: "snack",
    snacks: "snack",
  };

  if (mappings[category]) {
    return mappings[category];
  }

  if (
    category.includes("breakfast") ||
    category.includes("brunch")
  ) {
    return "breakfast";
  }

  if (category.includes("lunch")) {
    return "lunch";
  }

  if (
    category.includes("dinner") ||
    category.includes("main-course") ||
    category.includes("main-dish") ||
    category.includes("entree")
  ) {
    return "dinner";
  }

  if (category.includes("pasta")) {
    return "pasta";
  }

  if (
    category.includes("bbq") ||
    category.includes("barbecue") ||
    category.includes("grill")
  ) {
    return "bbq";
  }

  if (
    category.includes("slow-cooker") ||
    category.includes("crock")
  ) {
    return "slow-cooker";
  }

  if (
    category.includes("dessert") ||
    category.includes("cake") ||
    category.includes("sweet")
  ) {
    return "dessert";
  }

  if (category.includes("snack")) {
    return "snack";
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
                  stripHtml(item)
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
          stripHtml(
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
            structuredRecipe.recipeCategory
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