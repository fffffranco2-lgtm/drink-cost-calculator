export function formatBRL(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function makeCopyName(baseName: string, existingNames: string[]) {
  const trimmed = baseName.trim();
  const normalized = trimmed.replace(/\s*\(cópia(\s\d+)?\)$/i, "");
  const root = normalized || "Sem nome";

  const nameSet = new Set(existingNames);
  const firstCopy = `${root} (cópia)`;
  if (!nameSet.has(firstCopy)) return firstCopy;

  let index = 2;
  while (nameSet.has(`${root} (cópia ${index})`)) index += 1;
  return `${root} (cópia ${index})`;
}

export function isLikelyVirtualPrinter(name: string) {
  const n = name.trim().toLowerCase();
  return n.includes("fax") || n.includes("pdf") || n.includes("xps");
}

export function choosePreferredPrinter(candidates: string[]) {
  const cleaned = candidates.map((name) => name.trim()).filter(Boolean);
  if (!cleaned.length) return "";
  const nonVirtual = cleaned.find((name) => !isLikelyVirtualPrinter(name));
  return nonVirtual ?? cleaned[0];
}
