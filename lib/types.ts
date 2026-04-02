export type Item = {
  item_id: string;
  category: string;
  sub_category: string;
  sub_item_1?: string;
  item_name: string;
  uom: string;
  calc_factor_instruction: string;
  notes?: string;
  dynamicFields?: Record<string, any>;
  formulas?: Record<string, string>;
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

export type CustomVariable = {
  id: string;
  name: string;
  value: number;
  description: string;
};

export type DynamicColumn = {
  id: string;
  name: string;
  key: string;
  dataType: 'number' | 'text' | 'boolean';
  defaultValue?: any;
  unit?: string;
  scope: 'category' | 'subcategory' | 'itemgroup' | 'material';
};

export type Client = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
};

export type HistoryRecord = {
  timestamp: string;
  action: string;
  dataState: Record<string, TakeoffItem>;
  catalogState: Item[];
  projectName: string;
  clientName: string;
  jobNotes?: string;
  customVariables?: CustomVariable[];
  dynamicColumns?: DynamicColumn[];
  entityData?: Record<string, Record<string, any>>;
};

export type Job = {
  projectName: string;
  clientName: string;
  jobNotes?: string;
  takeoffData: Record<string, TakeoffItem>;
  history: HistoryRecord[];
  lastSaved: string;
  customVariables?: CustomVariable[];
  dynamicColumns?: DynamicColumn[];
  entityData?: Record<string, Record<string, any>>;
};

export type ProjectTemplate = {
  id: string;
  name: string;
  description: string;
  type: 'global' | 'personal';
  catalog: Item[];
  takeoffData: Record<string, TakeoffItem>;
  customVariables: CustomVariable[];
  dynamicColumns?: DynamicColumn[];
  entityData?: Record<string, Record<string, any>>;
  defaultOveragePct?: string;
  jobNotes?: string;
  createdAt: string;
};
