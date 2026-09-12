const crypto = require("crypto");

const publicApiRoutes = new Set([
  "/api/health",
  "/api/calendar-sources/google/callback",
]);

function safeCompare(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function requireApiKey(req, res, next) {
  if (req.method === "OPTIONS") {
    return next();
  }

  const requestPath = req.originalUrl.split("?")[0];

  if (
    req.method === "GET" &&
    publicApiRoutes.has(requestPath)
  ) {
    return next();
  }

  const configuredKey = process.env.FAMILYHUB_API_KEY;

  if (!configuredKey) {
    console.error(
      "FAMILYHUB_API_KEY is not configured. Protected API request rejected."
    );

    return res.status(503).json({
      success: false,
      error: "FamilyHub API authentication is not configured",
    });
  }

  const suppliedKey = req.get("X-FamilyHub-Key");

  if (!suppliedKey || !safeCompare(suppliedKey, configuredKey)) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }

  next();
}

module.exports = {
  requireApiKey,
};