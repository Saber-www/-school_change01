const crypto = require("node:crypto");

const HASH_PREFIX = "scrypt";
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

function isPasswordHash(value) {
  return typeof value === "string" && value.startsWith(`${HASH_PREFIX}$`);
}

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH).toString("hex");
  const key = crypto.scryptSync(String(password), salt, KEY_LENGTH).toString("hex");
  return `${HASH_PREFIX}$${salt}$${key}`;
}

function timingSafeEqualHex(left, right) {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function verifyPassword(password, storedPassword) {
  if (!isPasswordHash(storedPassword)) {
    return String(storedPassword || "") === String(password || "");
  }

  const [, salt, key] = storedPassword.split("$");
  if (!salt || !key) return false;
  const candidate = crypto.scryptSync(String(password), salt, KEY_LENGTH).toString("hex");
  return timingSafeEqualHex(candidate, key);
}

module.exports = {
  hashPassword,
  isPasswordHash,
  verifyPassword,
};
