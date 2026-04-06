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
  unit_price?: string;
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
  scope: 'category' | 'subcategory' | 'itemgroup' | 'material' | 'global';
  category?: string;
  subCategory?: string;
  itemGroup?: string;
  materialName?: string;
  variables: string[];
  createdAt: string;
}

export interface ConditionalFormatRule {
  id: string;
  field: string;
  operator: '>' | '<' | '==' | '!=' | '>=' | '<=';
  value: string;
  color: string;
  applyTo: 'row' | 'cell';
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
  conditionalFormatRules: ConditionalFormatRule[];
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
  conditionalFormatRules?: ConditionalFormatRule[];
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
  conditionalFormatRules: ConditionalFormatRule[];
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

export interface FullBackup {
  version: string;
  timestamp: string;
  catalog: Item[];
  takeoffData: Record<string, TakeoffItem>;
  customVariables: CustomVariable[];
  dynamicColumns: DynamicColumn[];
  dataTables: DataTable[];
  clients: Client[];
  templates: ProjectTemplate[];
  formulaTemplates: FormulaTemplate[];
  conditionalFormatRules: ConditionalFormatRule[];
  projectName: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  clientAddress: string;
  jobNotes: string;
  defaultOveragePct: string;
  savedJobs: Record<string, Job>;
}
