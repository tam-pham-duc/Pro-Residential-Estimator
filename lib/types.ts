export interface Item {
  item_id: string;
  category: string;
  sub_category: string;
  sub_item_1: string;
  item_name: string;
  uom: string;
  calc_factor_instruction: string;
  notes: string;
}

export interface TakeoffItem {
  in_scope: boolean;
  spec: string;
  qty: string;
  measured_qty: string;
  overage_pct: string;
  order_qty: string;
  evidence: string;
  qty_mode: 'auto' | 'manual' | 'guide';
  custom_formula: string;
}

export interface CustomVariable {
  id: string;
  name: string;
  formula: string;
  value: number;
  description: string;
}

export interface DynamicColumn {
  id: string;
  name: string;
  key: string;
  dataType: 'number' | 'text' | 'boolean';
  scope: 'category' | 'subcategory' | 'itemgroup' | 'material' | 'global';
  unit: string;
  defaultValue: string;
  category?: string;
  subCategory?: string;
  itemGroup?: string;
  materialName?: string;
}

export interface DataTable {
  id: string;
  name: string;
  columns: { name: string; key: string; type: string }[];
  rows: Record<string, any>[];
}

export interface FormulaTemplate {
  id: string;
  name: string;
  formula: string;
  description: string;
  scope: string;
  variables: string[];
}

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  type: 'global' | 'personal';
  catalog: Item[];
  takeoffData: Record<string, TakeoffItem>;
  customVariables: CustomVariable[];
  dynamicColumns: DynamicColumn[];
  entityData: Record<string, Record<string, any>>;
  formulaTemplates: FormulaTemplate[];
  dataTables: DataTable[];
  defaultOveragePct: string;
  jobNotes: string;
  createdAt: string;
}

export interface HistoryRecord {
  timestamp: string;
  action: string;
  dataState: Record<string, TakeoffItem>;
  catalogState?: Item[];
  projectName: string;
  clientName: string;
  jobNotes?: string;
  customVariables?: CustomVariable[];
  dynamicColumns?: DynamicColumn[];
  entityData?: Record<string, Record<string, any>>;
  formulaTemplates?: FormulaTemplate[];
  dataTables?: DataTable[];
}

export interface Job {
  id: string;
  projectName: string;
  clientName: string;
  lastSaved: string;
  jobNotes: string;
  takeoffData: Record<string, TakeoffItem>;
  history: HistoryRecord[];
  customVariables: CustomVariable[];
  dynamicColumns: DynamicColumn[];
  entityData: Record<string, Record<string, any>>;
  formulaTemplates: FormulaTemplate[];
  dataTables: DataTable[];
  catalog: Item[];
  defaultOveragePct: string;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}
