function normalizeMultiline(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function stripWrappingQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function decodeBase64(value: string): string {
  try {
    return Buffer.from(value, "base64").toString("utf8").trim();
  } catch {
    return "";
  }
}

export function readPemFromEnv(key: string): string {
  const raw = process.env[key];
  if (typeof raw === "string" && raw.trim()) {
    return normalizeMultiline(stripWrappingQuotes(raw));
  }

  const base64Raw = process.env[`${key}_BASE64`];
  if (typeof base64Raw === "string" && base64Raw.trim()) {
    return normalizeMultiline(stripWrappingQuotes(decodeBase64(base64Raw)));
  }

  return "";
}

export function pemEnvDebug(key: string) {
  const raw = process.env[key];
  const b64 = process.env[`${key}_BASE64`];
  return {
    keyPresent: Boolean(raw && raw.trim()),
    keyLength: raw?.length ?? 0,
    base64Present: Boolean(b64 && b64.trim()),
    base64Length: b64?.length ?? 0,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };
}
