import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type OrderStatus = "pendente" | "em_progresso" | "concluido";

type UpdateOrderStatusBody = {
  status?: string;
};

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Ambiente incompleto: configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  const { id } = await context.params;
  const orderId = typeof id === "string" ? id.trim() : "";
  if (!orderId) {
    return NextResponse.json({ error: "ID do pedido inválido." }, { status: 400 });
  }

  let body: UpdateOrderStatusBody;
  try {
    body = (await request.json()) as UpdateOrderStatusBody;
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const status = body.status;
  const nextStatus: OrderStatus | null =
    status === "pendente" || status === "em_progresso" || status === "concluido" ? status : null;

  if (!nextStatus) {
    return NextResponse.json({ error: "Status inválido." }, { status: 400 });
  }

  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await supabase
    .from("orders")
    .update({ status: nextStatus })
    .eq("id", orderId)
    .select("id, status, updated_at")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Falha ao atualizar status do pedido." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 });
  }

  return NextResponse.json({
    order: {
      id: data.id,
      status: data.status,
      updatedAt: data.updated_at,
    },
  });
}
