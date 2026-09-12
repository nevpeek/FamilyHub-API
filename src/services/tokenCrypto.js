const crypto = require("crypto");

const ENCRYPTION_PREFIX = "fhenc1";
const IV_LENGTH = 12;

function getEncryptionKey() {
  const configuredKey =
    process.env.FAMILYHUB_TOKEN_ENCRYPTION_KEY?.trim();

  if (!configuredKey) {
    throw new Error(
      "FAMILYHUB_TOKEN_ENCRYPTION_KEY is not configured"
    );
  }

  if (!/^[a-fA-F0-9]{64}$/.test(configuredKey)) {
    throw new Error(
      "FAMILYHUB_TOKEN_ENCRYPTION_KEY must be a 32-byte hexadecimal key"
    );
  }

  return Buffer.from(configuredKey, "hex");
}

function isEncryptedToken(value) {
  return (
    typeof value === "string" &&
    value.startsWith(`${ENCRYPTION_PREFIX}:`)
  );
}

function encryptToken(value) {
  if (!value) {
    return null;
  }

  if (isEncryptedToken(value)) {
    return value;
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  const encrypted = Buffer.concat([
    cipher.update(String(value), "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    ENCRYPTION_PREFIX,
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("base64"),
  ].join(":");
}

function decryptToken(value) {
  if (!value) {
    return value;
  }

  // Backward compatibility for existing plaintext tokens.
  if (!isEncryptedToken(value)) {
    return value;
  }

  const parts = value.split(":");

  if (parts.length !== 4) {
    throw new Error(
      "Encrypted token has an invalid format"
    );
  }

  const [, ivHex, authTagHex, encryptedBase64] =
    parts;

  const key = getEncryptionKey();
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const encrypted = Buffer.from(
    encryptedBase64,
    "base64"
  );

  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    iv
  );

  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

module.exports = {
  encryptToken,
  decryptToken,
  isEncryptedToken,
};