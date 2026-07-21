export const MAX_COMPOSER_IMAGES = 4;

export interface ComposerAttachment {
  id: string;
  mimeType: string;
  previewUrl: string;
  /** Base64 string length (wire payload size), not decoded bytes. */
  byteLen: number;
  /** Raw base64 payload (no data-URL prefix) for the RPC path. */
  dataBase64: string;
  name?: string;
}

export interface PreparedImageDto {
  mimeType: string;
  dataBase64: string;
  byteLen: number;
  width: number;
  height: number;
}

export const isImageMime = (mime: string | undefined | null): boolean =>
  Boolean(mime && mime.toLowerCase().startsWith("image/"));

export const isImageFile = (file: Pick<File, "type" | "name">): boolean => {
  if (isImageMime(file.type)) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name);
};

export const formatByteLen = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
};

/** Strip a data URL prefix; return raw base64 (or the input if already raw). */
export const stripDataUrlBase64 = (value: string): string => {
  const raw = value.trim();
  const marker = "base64,";
  const idx = raw.indexOf(marker);
  if (idx >= 0) return raw.slice(idx + marker.length);
  if (raw.startsWith("data:") && raw.includes(",")) {
    return raw.slice(raw.indexOf(",") + 1);
  }
  return raw;
};

export const mimeFromDataUrl = (value: string): string | null => {
  const match = /^data:([^;,]+)/i.exec(value.trim());
  return match?.[1] ?? null;
};

export const takeImageFiles = (
  files: ArrayLike<File> | File[],
  remainingSlots: number,
): File[] => {
  if (remainingSlots <= 0) return [];
  const list = Array.from(files as File[]);
  return list.filter(isImageFile).slice(0, remainingSlots);
};

export const readFileAsBase64 = async (
  file: File,
): Promise<{
  dataBase64: string;
  mimeType: string;
  byteLen: number;
  previewUrl: string;
}> => {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
  reader.onload = () => {
    resolve(typeof reader.result === "string" ? reader.result : "");
  };
  reader.readAsDataURL(file);
  const result = await promise;
  const dataBase64 = stripDataUrlBase64(result);
  const mimeType =
    file.type || mimeFromDataUrl(result) || "application/octet-stream";
  const previewUrl =
    result.startsWith("data:") && result.includes(",")
      ? result
      : `data:${mimeType};base64,${dataBase64}`;
  return {
    dataBase64,
    mimeType,
    byteLen: dataBase64.length,
    previewUrl,
  };
};

let attachmentSeq = 0;
export const nextAttachmentId = (): string => {
  attachmentSeq += 1;
  return `att-${Date.now().toString(36)}-${attachmentSeq}`;
};
