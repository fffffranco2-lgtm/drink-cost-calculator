#!/usr/bin/env node

import { createHmac } from "node:crypto";

function normalizeTableCode(input) {
  const code = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!code) return null;
  if (!/^[A-Z0-9][A-Z0-9_-]{0,19}$/.test(code)) return null;
  return code;
}

function parseTablesArg(raw) {
  return String(raw ?? "")
    .split(",")
    .map((part) => normalizeTableCode(part))
    .filter(Boolean);
}

function buildTableListFromCount(count) {
  const safeCount = Math.max(1, Math.min(300, Number(count) || 0));
  const list = [];
  for (let i = 1; i <= safeCount; i += 1) {
    list.push(`M${String(i).padStart(2, "0")}`);
  }
  return list;
}

function signTableCode(tableCode, secret) {
  return createHmac("sha256", secret).update(tableCode).digest("hex");
}

function parseArgs(argv) {
  const args = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const [rawKey, inlineValue] = token.split("=", 2);
    const key = rawKey.slice(2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args.set(key, "true");
      continue;
    }
    args.set(key, next);
    i += 1;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const baseUrl = String(args.get("base-url") ?? process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const secret = String(args.get("secret") ?? process.env.TABLE_QR_SIGNING_SECRET ?? "").trim();
const format = String(args.get("format") ?? "csv").trim().toLowerCase();
const tablesArg = args.get("tables");
const countArg = args.get("count");

let tableCodes = [];
if (tablesArg) {
  tableCodes = parseTablesArg(tablesArg);
} else if (countArg) {
  tableCodes = buildTableListFromCount(countArg);
}

if (!tableCodes.length) {
  console.error("Uso: --tables M01,M02 ou --count 20");
  process.exit(1);
}

if (!secret) {
  console.error("Defina TABLE_QR_SIGNING_SECRET (ou use --secret).");
  process.exit(1);
}

const rows = tableCodes.map((tableCode) => {
  const token = signTableCode(tableCode, secret);
  const url = `${baseUrl}/cardapio?mesa=${encodeURIComponent(tableCode)}&token=${token}`;
  return { tableCode, token, url };
});

if (format === "json") {
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}

if (format === "plain") {
  for (const row of rows) {
    console.log(`${row.tableCode} ${row.url}`);
  }
  process.exit(0);
}

console.log("table_code,url");
for (const row of rows) {
  console.log(`${row.tableCode},${row.url}`);
}
