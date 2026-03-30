export type Item = {
  item_id: string;
  category: string;
  sub_category: string;
  sub_item_1?: string;
  item_name: string;
  uom: string;
  calc_factor_instruction: string;
  notes?: string;
};

export type TakeoffItem = {
  in_scope: boolean;
  spec: string;
  qty: string;
  measured_qty: string;
  overage_pct: string;
  order_qty: string;
  evidence: string;
  qty_mode: 'auto' | 'manual';
  custom_formula: string;
};

export type HistoryRecord = {
  timestamp: string;
  action: string;
  dataState: Record<string, TakeoffItem>;
  catalogState: Item[];
  projectName: string;
  clientName: string;
};

export type Job = {
  projectName: string;
  clientName: string;
  takeoffData: Record<string, TakeoffItem>;
  history: HistoryRecord[];
  lastSaved: string;
};
