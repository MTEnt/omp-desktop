export interface LoginProvider {
  id: string;
  name: string;
  authenticated?: boolean;
  detail?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (
  value: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
};

const readBoolean = (
  value: Record<string, unknown>,
  ...keys: string[]
): boolean | undefined => {
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "boolean") return candidate;
    if (typeof candidate === "string") {
      const normalized = candidate.trim().toLowerCase();
      if (normalized === "true" || normalized === "yes" || normalized === "1") {
        return true;
      }
      if (normalized === "false" || normalized === "no" || normalized === "0") {
        return false;
      }
    }
    if (typeof candidate === "number") {
      if (candidate === 1) return true;
      if (candidate === 0) return false;
    }
  }
  return undefined;
};

const extractProviderList = (raw: unknown): unknown[] => {
  if (Array.isArray(raw)) return raw;

  if (!isRecord(raw)) return [];

  if (Array.isArray(raw.providers)) return raw.providers;
  if (Array.isArray(raw.data)) return raw.data;

  if (isRecord(raw.data)) {
    if (Array.isArray(raw.data.providers)) return raw.data.providers;
    if (Array.isArray(raw.data.items)) return raw.data.items;
    if (Array.isArray(raw.data.loginProviders)) return raw.data.loginProviders;
  }

  if (isRecord(raw.result)) {
    if (Array.isArray(raw.result.providers)) return raw.result.providers;
    if (Array.isArray(raw.result.data)) return raw.result.data;
  }

  return [];
};

const normalizeProviderItem = (item: unknown): LoginProvider | null => {
  if (typeof item === "string") {
    const id = item.trim();
    if (!id) return null;
    return { id, name: id };
  }

  if (!isRecord(item)) return null;

  const id =
    readString(item, "id", "providerId", "provider_id", "provider", "slug", "key") ??
    undefined;
  if (!id) return null;

  const name =
    readString(item, "name", "label", "title", "displayName", "display_name") ?? id;
  const authenticated = readBoolean(
    item,
    "authenticated",
    "isAuthenticated",
    "is_authenticated",
    "loggedIn",
    "logged_in",
    "signedIn",
    "signed_in",
  );
  const detail = readString(
    item,
    "detail",
    "description",
    "status",
    "message",
    "account",
    "email",
  );

  const provider: LoginProvider = { id, name };
  if (authenticated !== undefined) provider.authenticated = authenticated;
  if (detail !== undefined) provider.detail = detail;
  return provider;
};

/** Defensively parse get_login_providers envelopes into a stable list. */
export function normalizeLoginProviders(raw: unknown): LoginProvider[] {
  const items = extractProviderList(raw);
  const seen = new Set<string>();
  const providers: LoginProvider[] = [];

  for (const item of items) {
    const provider = normalizeProviderItem(item);
    if (!provider || seen.has(provider.id)) continue;
    seen.add(provider.id);
    providers.push(provider);
  }

  return providers;
}
