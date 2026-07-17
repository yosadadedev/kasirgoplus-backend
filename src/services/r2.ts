import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../env";

const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const getRequiredR2Config = () => {
  if (
    !env.R2_BUCKET ||
    !env.R2_ACCOUNT_ID ||
    !env.R2_ACCESS_KEY_ID ||
    !env.R2_SECRET_ACCESS_KEY ||
    !env.R2_PUBLIC_BASE_URL
  ) {
    throw new Error("R2_NOT_CONFIGURED");
  }

  return {
    bucket: env.R2_BUCKET,
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL.replace(/\/$/, ""),
  };
};

const resolveExtension = (file: File) => {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  if (type === "image/jpg" || type === "image/jpeg") return "jpg";

  const name = file.name || "";
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : "";
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") {
    return ext === "jpeg" ? "jpg" : ext;
  }

  return "jpg";
};

const resolveContentType = (file: File, extension: string) => {
  const type = (file.type || "").toLowerCase();
  if (type === "image/png" || type === "image/webp" || type === "image/jpeg" || type === "image/jpg") {
    return type === "image/jpg" ? "image/jpeg" : type;
  }

  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return "image/jpeg";
};

const createR2Client = () => {
  const config = getRequiredR2Config();
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
};

export const getR2ImageKeyFromUrl = (imageUrl: string) => {
  try {
    const parsed = new URL(imageUrl);
    const proxyMarker = "/v1/products/image/";
    const proxyIndex = parsed.pathname.indexOf(proxyMarker);
    if (proxyIndex >= 0) {
      const proxyKey = decodeURIComponent(parsed.pathname.slice(proxyIndex + proxyMarker.length)).trim();
      if (proxyKey) return proxyKey;
    }
  } catch {
    // Fall through to direct-public-url parsing.
  }

  const config = getRequiredR2Config();
  const normalizedBase = `${config.publicBaseUrl}/`;
  if (!imageUrl.startsWith(normalizedBase)) {
    return null;
  }
  const key = imageUrl.slice(normalizedBase.length).trim();
  return key || null;
};

export const uploadProductImageToR2 = async (input: {
  tenantId: string;
  file: File;
}) => {
  const config = getRequiredR2Config();
  const { tenantId, file } = input;

  if (!(file instanceof File)) {
    throw new Error("INVALID_FILE");
  }

  if (file.size <= 0) {
    throw new Error("EMPTY_FILE");
  }

  if (file.size > MAX_IMAGE_SIZE_BYTES) {
    throw new Error("FILE_TOO_LARGE");
  }

  const extension = resolveExtension(file);
  const contentType = resolveContentType(file, extension);

  if (!contentType.startsWith("image/")) {
    throw new Error("INVALID_IMAGE_TYPE");
  }

  const key = `tenants/${tenantId}/products/${crypto.randomUUID()}.${extension}`;
  const client = createR2Client();

  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: Buffer.from(await file.arrayBuffer()),
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  return {
    imageKey: key,
    imageUrl: `${config.publicBaseUrl}/${key}`,
  };
};

export const getProductImageFromR2 = async (imageKey: string) => {
  const config = getRequiredR2Config();
  const normalizedKey = imageKey.trim();
  if (!normalizedKey) {
    throw new Error("INVALID_IMAGE_REFERENCE");
  }

  const client = createR2Client();
  const result = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: normalizedKey,
    }),
  );

  if (!result.Body) {
    throw new Error("IMAGE_NOT_FOUND");
  }

  return {
    body: await result.Body.transformToByteArray(),
    contentType: result.ContentType || "image/jpeg",
    cacheControl: result.CacheControl || "public, max-age=31536000, immutable",
  };
};

export const deleteProductImageFromR2 = async (input: {
  imageKey?: string | null;
  imageUrl?: string | null;
}) => {
  const config = getRequiredR2Config();
  const imageKey = input.imageKey?.trim() || (input.imageUrl ? getR2ImageKeyFromUrl(input.imageUrl) : null);
  if (!imageKey) {
    throw new Error("INVALID_IMAGE_REFERENCE");
  }

  const client = createR2Client();
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: imageKey,
    }),
  );

  return { ok: true, imageKey };
};
