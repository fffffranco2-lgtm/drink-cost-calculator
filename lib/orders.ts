export type OrderStatus = "pendente" | "em_progresso" | "concluido";
export type OrderSource = "mesa_qr" | "balcao";

export type AdminOrderItem = {
  drinkName: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  notes?: string | null;
  drinkNotes?: string | null;
  itemNotes?: string | null;
};

export type AdminOrder = {
  id: string;
  code: string;
  customerName: string | null;
  customerPhone: string | null;
  notes: string | null;
  status: OrderStatus;
  source?: OrderSource | null;
  tableCode?: string | null;
  subtotal: number;
  createdAt: string;
  updatedAt: string;
  items: AdminOrderItem[];
};
