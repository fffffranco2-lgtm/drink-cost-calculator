import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type OrderStatus = "pendente" | "em_progresso" | "concluido";

type OrderRow = {
  id: string;
  code: string;
  customer_name: string | null;
  customer_phone: string | null;
  notes: string | null;
  status: OrderStatus;
  subtotal: number;
  created_at: string;
  updated_at: string;
};

type OrderItemRow = {
  order_id: string;
  drink_name: string;
  qty: number;
  unit_price: number;
  line_total: number;
};

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const since = parseIsoDate(new URL(request.url).searchParams.get("since"));

  const { data: latestData, error: latestError } = await supabase
    .from("orders")
    .select("updated_at")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) {
    return NextResponse.json({ error: "Falha ao consultar atualização de pedidos." }, { status: 500 });
  }

  const updatedAt = latestData?.updated_at ?? null;
  const remoteUpdatedAt = parseIsoDate(updatedAt);
  if (since && remoteUpdatedAt && since >= remoteUpdatedAt) {
    return new NextResponse(null, { status: 304 });
  }

  const statusParam = new URL(request.url).searchParams.get("status");
  const statusFilter: OrderStatus | null =
    statusParam === "pendente" || statusParam === "em_progresso" || statusParam === "concluido" ? statusParam : null;

  let ordersQuery = supabase
    .from("orders")
    .select("id, code, customer_name, customer_phone, notes, status, subtotal, created_at, updated_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (statusFilter) {
    ordersQuery = ordersQuery.eq("status", statusFilter);
  }

  const { data: ordersData, error: ordersError } = await ordersQuery;

  if (ordersError) {
    return NextResponse.json({ error: "Falha ao listar pedidos." }, { status: 500 });
  }

  const orders = (ordersData ?? []) as OrderRow[];
  if (!orders.length) {
    return NextResponse.json({ orders: [], updatedAt });
  }

  const orderIds = orders.map((order) => order.id);
  const { data: itemsData, error: itemsError } = await supabase
    .from("order_items")
    .select("order_id, drink_name, qty, unit_price, line_total")
    .in("order_id", orderIds)
    .order("created_at", { ascending: true });

  if (itemsError) {
    return NextResponse.json({ error: "Falha ao listar itens de pedidos." }, { status: 500 });
  }

  const itemsByOrderId = new Map<string, OrderItemRow[]>();
  for (const item of (itemsData ?? []) as OrderItemRow[]) {
    const list = itemsByOrderId.get(item.order_id) ?? [];
    list.push(item);
    itemsByOrderId.set(item.order_id, list);
  }

  return NextResponse.json({
    orders: orders.map((order) => ({
      id: order.id,
      code: order.code,
      customerName: order.customer_name,
      customerPhone: order.customer_phone,
      notes: order.notes,
      status: order.status,
      subtotal: order.subtotal,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      items: (itemsByOrderId.get(order.id) ?? []).map((item) => ({
        drinkName: item.drink_name,
        qty: item.qty,
        unitPrice: item.unit_price,
        lineTotal: item.line_total,
      })),
    })),
    updatedAt,
  });
}
