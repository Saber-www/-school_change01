const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const path = require("node:path");

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE_EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

function isInlineImage(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/);
  if (!match) throw new Error("图片数据格式不正确");

  const [, mimeType, rawBase64] = match;
  const extension = IMAGE_EXTENSIONS[mimeType];
  if (!extension) throw new Error("仅支持 JPG、PNG、WebP 或 GIF 图片");

  const base64 = rawBase64.replace(/\s/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("图片数据为空");
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error("图片大小不能超过 10MB");

  return { buffer, extension, mimeType };
}

async function saveImageDataUrl(dataUrl, uploadDir) {
  const { buffer, extension, mimeType } = parseImageDataUrl(dataUrl);
  const imagesDir = path.join(uploadDir, "images");
  await fs.mkdir(imagesDir, { recursive: true });

  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(imagesDir, filename), buffer);

  return {
    url: `/uploads/images/${filename}`,
    mimeType,
    size: buffer.length,
  };
}

async function migrateListingImagesToFiles(db, uploadDir) {
  let changed = false;
  let migrated = 0;

  for (const listing of db.listings || []) {
    if (!Array.isArray(listing.images)) continue;

    const nextImages = [];
    for (const image of listing.images) {
      if (!isInlineImage(image)) {
        nextImages.push(image);
        continue;
      }

      try {
        const saved = await saveImageDataUrl(image, uploadDir);
        nextImages.push(saved.url);
        changed = true;
        migrated += 1;
      } catch {
        nextImages.push(image);
      }
    }

    listing.images = nextImages;
  }

  return { changed, migrated };
}

module.exports = {
  MAX_IMAGE_BYTES,
  isInlineImage,
  migrateListingImagesToFiles,
  saveImageDataUrl,
};
