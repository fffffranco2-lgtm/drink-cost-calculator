#!/usr/bin/env node

import { createClient } from "@supabase/supabase-js";

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

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatCodeDate(date) {
  const y = String(date.getFullYear());
  const m = pad2(date.getMonth() + 1);
  const d = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const mm = pad2(date.getMinutes());
  const ss = pad2(date.getSeconds());
  return `${y}${m}${d}-${hh}${mm}${ss}`;
}

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const args = parseArgs(process.argv.slice(2));
const includeAll = args.get("all") === "true";
const createIfMissingCount = Math.max(1, Number(args.get("create-sessions") ?? "3") || 3);
const dryRun = args.get("dry-run") === "true";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ordersQuery = supabase.from("orders").select("id, code, session_id");
if (!includeAll) ordersQuery.is("session_id", null);

const { data: ordersData, error: ordersError } = await ordersQuery.order("created_at", { ascending: true });
if (ordersError) {
  console.error(`Falha ao carregar pedidos: ${ordersError.message}`);
  process.exit(1);
}

const orders = ordersData ?? [];
if (!orders.length) {
  console.log("Nenhum pedido elegível para distribuição.");
  process.exit(0);
}

let { data: sessionsData, error: sessionsError } = await supabase
  .from("order_sessions")
  .select("id, code, opened_at, closed_at")
  .order("opened_at", { ascending: false });

if (sessionsError) {
  console.error(`Falha ao carregar sessões: ${sessionsError.message}`);
  process.exit(1);
}

let sessions = sessionsData ?? [];

if (!sessions.length) {
  const now = new Date();
  const toInsert = [];
  for (let i = 0; i < createIfMissingCount; i += 1) {
    const opened = new Date(now.getTime() - (createIfMissingCount - i) * 1000 * 60 * 90);
    const closed = new Date(opened.getTime() + 1000 * 60 * 60 * 4);
    toInsert.push({
      code: `BAR-MIG-${formatCodeDate(opened)}-${pad2(i + 1)}`,
      opened_at: opened.toISOString(),
      closed_at: i === createIfMissingCount - 1 ? null : closed.toISOString(),
    });
  }

  if (!dryRun) {
    const insertResult = await supabase
      .from("order_sessions")
      .insert(toInsert)
      .select("id, code, opened_at, closed_at");
    if (insertResult.error) {
      console.error(`Falha ao criar sessões de apoio: ${insertResult.error.message}`);
      process.exit(1);
    }
    sessions = insertResult.data ?? [];
  } else {
    sessions = toInsert.map((row, idx) => ({ id: `dry_${idx + 1}`, ...row }));
  }
}

if (!sessions.length) {
  console.error("Sem sessões disponíveis para distribuição.");
  process.exit(1);
}

const assignments = orders.map((order) => ({
  orderId: order.id,
  orderCode: order.code,
  session: randomFrom(sessions),
}));

if (dryRun) {
  console.log(
    JSON.stringify(
      {
        dryRun: true,
        includeAll,
        sessions: sessions.map((s) => ({ id: s.id, code: s.code })),
        assignmentPreview: assignments.slice(0, 20).map((a) => ({ orderCode: a.orderCode, sessionCode: a.session.code })),
        totalOrders: assignments.length,
      },
      null,
      2
    )
  );
  process.exit(0);
}

for (const assignment of assignments) {
  const { error } = await supabase.from("orders").update({ session_id: assignment.session.id }).eq("id", assignment.orderId);
  if (error) {
    console.error(`Falha ao atualizar pedido ${assignment.orderCode}: ${error.message}`);
    process.exit(1);
  }
}

const summary = new Map();
for (const assignment of assignments) {
  const current = summary.get(assignment.session.code) ?? 0;
  summary.set(assignment.session.code, current + 1);
}

console.log("Distribuição concluída.");
console.log(`Pedidos atualizados: ${assignments.length}`);
for (const [sessionCode, count] of summary.entries()) {
  console.log(`- ${sessionCode}: ${count} pedido(s)`);
}
