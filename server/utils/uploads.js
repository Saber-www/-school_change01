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
const PROOF_EXTENSIONS = {
  ...IMAGE_EXTENSIONS,
  "application/pdf": "pdf",
};

function isInlineImage(value) {
  return typeof value === "string" && value.startsWith("data:image/");
}

function parseImageDataUrl(dataUrl) {
  return parseUploadDataUrl(dataUrl, IMAGE_EXTENSIONS, "图片", "仅支持 JPG、PNG、WebP 或 GIF 图片");
}

function parseUploadDataUrl(dataUrl, extensions, label, typeError) {
  const match = String(dataUrl || "").match(/^data:([a-zA-Z0-9.+/-]+);base64,([\s\S]+)$/);
  if (!match) throw new Error(`${label}数据格式不正确`);

  const [, mimeType, rawBase64] = match;
  const extension = extensions[mimeType];
  if (!extension) throw new Error(typeError);

  const base64 = rawBase64.replace(/\s/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error(`${label}数据为空`);
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error(`${label}大小不能超过 10MB`);

  return { buffer, extension, mimeType };
}

async function saveUploadDataUrl(dataUrl, uploadDir, folder, extensions, label, typeError) {
  const { buffer, extension, mimeType } = parseUploadDataUrl(dataUrl, extensions, label, typeError);
  const targetDir = path.join(uploadDir, folder);
  await fs.mkdir(targetDir, { recursive: true });

  const filename = `${Date.now()}-${crypto.randomUUID()}.${extension}`;
  await fs.writeFile(path.join(targetDir, filename), buffer);

  return {
    url: `/uploads/${folder}/${filename}`,
    mimeType,
    size: buffer.length,
  };
}

async function saveImageDataUrl(dataUrl, uploadDir) {
  return saveUploadDataUrl(dataUrl, uploadDir, "images", IMAGE_EXTENSIONS, "图片", "仅支持 JPG、PNG、WebP 或 GIF 图片");
}

async function saveProofDataUrl(dataUrl, uploadDir) {
  return saveUploadDataUrl(
    dataUrl,
    uploadDir,
    "proofs",
    PROOF_EXTENSIONS,
    "认证材料",
    "仅支持 JPG、PNG、WebP、GIF 或 PDF 认证材料",
  );
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
  saveProofDataUrl,
};
