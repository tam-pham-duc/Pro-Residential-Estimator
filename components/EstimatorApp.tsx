"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { defaultCatalog } from '@/lib/default-catalog';
import { evaluateMath, evaluateCustomFormula, validateCustomFormula, DEFAULT_QTY_FORMULA, getUniqueVals, recalculateCustomVariables, extractVariablesFromFormula } from '@/lib/estimator-utils';
import { Item, TakeoffItem, HistoryRecord, Job, CustomVariable, ProjectTemplate, DynamicColumn, Client, FormulaTemplate, DataTable } from '@/lib/types';
import { auth, db } from '@/lib/firebase';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, onSnapshot, query, where, deleteDoc, serverTimestamp, getDocs } from 'firebase/firestore';
import { 
  Home, Plus, Download, Save, Search, History, FileJson, Upload, Table, Columns, Settings,
  ChevronDown, ChevronUp, ChevronRight, Edit2, Calculator, Hand, Trash2, X,
  Undo2, Redo2, Copy, Users, Folder, BookOpen
} from 'lucide-react';
import { motion } from 'motion/react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { linter, Diagnostic, lintGutter } from '@codemirror/lint';
import { MatchDecorator, ViewPlugin, Decoration, DecorationSet, EditorView } from '@codemirror/view';

const formulaHighlightPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.getDeco(view);
  }
  update(update: any) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.getDeco(update.view);
    }
  }
  getDeco(view: EditorView) {
    const widgets: any[] = [];
    for (let {from, to} of view.visibleRanges) {
      const text = view.state.doc.sliceString(from, to);
      
      let match;
      const varRegex = /\[[a-zA-Z0-9_ %-]+\]/g;
      while ((match = varRegex.exec(text))) {
        widgets.push(Decoration.mark({ class: "text-amber-600 font-bold bg-amber-50 px-1 rounded" }).range(from + match.index, from + match.index + match[0].length));
      }

      const fnRegex = /\b(ROUNDUP|ROUNDDOWN|ROUND|CEILING|FLOOR|MAX|MIN|ABS|SQRT|POWER|IF|AND|OR|NOT)\b/g;
      while ((match = fnRegex.exec(text))) {
        widgets.push(Decoration.mark({ class: "text-blue-600 font-bold" }).range(from + match.index, from + match.index + match[0].length));
      }
    }
    return Decoration.set(widgets.sort((a, b) => a.from - b.from));
  }
}, {
  decorations: v => v.decorations
});

const getFormulaCompletions = (customVars: CustomVariable[], dynamicCols: DynamicColumn[], dataTables: DataTable[], item: Item | undefined) => (context: CompletionContext): CompletionResult | null => {
  // Check if we are inside LOOKUP(
  const before = context.state.doc.sliceString(Math.max(0, context.pos - 100), context.pos);
  const lookupMatch = before.match(/LOOKUP\s*\(\s*([^)]*)$/);
  
  if (lookupMatch) {
    const argsStr = lookupMatch[1];
    const args = [];
    let currentArg = "";
    let inQuotes = false;
    let quoteChar = "";
    for (let i = 0; i < argsStr.length; i++) {
      const char = argsStr[i];
      if ((char === '"' || char === "'") && (i === 0 || argsStr[i - 1] !== '\\')) {
        if (!inQuotes) {
          inQuotes = true;
          quoteChar = char;
        } else if (char === quoteChar) {
          inQuotes = false;
          quoteChar = "";
        }
      }
      if (char === ',' && !inQuotes) {
        args.push(currentArg);
        currentArg = "";
      } else {
        currentArg += char;
      }
    }
    args.push(currentArg);
    const argCount = args.length;
    
    // We want to match the current partial argument
    let word = context.matchBefore(/["']?[a-zA-Z0-9_ %-]*$/);
    
    if (argCount === 1) {
      // Suggest table names
      return {
        from: word ? word.from : context.pos,
        options: dataTables.map(dt => ({
          label: `"${dt.name}"`,
          type: 'constant',
          info: `Data Table: ${dt.name} (${dt.rows.length} rows)`,
          apply: `"${dt.name}"`
        }))
      };
    } else if (argCount === 2 || argCount === 4) {
      const tableName = args[0].trim().replace(/["']/g, '');
      const table = dataTables.find(dt => dt.name === tableName);
      if (table) {
        return {
          from: word ? word.from : context.pos,
          options: table.columns.map(col => ({
            label: `"${col.key}"`,
            type: 'property',
            info: `Column: ${col.name} (${col.type})`,
            apply: `"${col.key}"`
          }))
        };
      }
    }
  }

  let word = context.matchBefore(/\[?[a-zA-Z0-9_ %-]*$/);
  if (!word || (word.from === word.to && !context.explicit))
    return null;
    
  const customVarOptions = customVars.map(cv => ({
    label: `[${cv.name}]`,
    type: 'variable',
    info: `Custom Variable: ${cv.description || 'No description'}. Value: ${cv.value}`,
    apply: `[${cv.name}]`
  }));

  const dynamicColOptions = dynamicCols
    .filter(dc => {
      if (dc.dataType !== 'number' && dc.dataType !== 'boolean') return false;
      if (!item) return true;
      
      // Branch-scoped filtering
      if (dc.scope === 'category' && dc.category && dc.category !== item.category) return false;
      if (dc.scope === 'subcategory' && (dc.category !== item.category || (dc.subCategory && dc.subCategory !== item.sub_category))) return false;
      if (dc.scope === 'itemgroup' && (dc.category !== item.category || (dc.subCategory && dc.subCategory !== item.sub_category) || (dc.itemGroup && dc.itemGroup !== (item.sub_item_1 || '')))) return false;
      if (dc.scope === 'material' && (dc.category !== item.category || (dc.subCategory && dc.subCategory !== item.sub_category) || (dc.itemGroup && dc.itemGroup !== (item.sub_item_1 || '')) || (dc.materialName && dc.materialName !== item.item_name))) return false;
      
      return true;
    })
    .map(dc => ({
      label: `[${dc.key}]`,
      type: 'variable',
      info: `Dynamic Column (${dc.scope}): ${dc.name}`,
      apply: `[${dc.key}]`
    }));

  const itemPropOptions = item ? [
    { label: '[Category]', type: 'variable', info: `Item Category: ${item.category}`, apply: '[Category]' },
    { label: '[SubCategory]', type: 'variable', info: `Item Sub-Category: ${item.sub_category}`, apply: '[SubCategory]' },
    { label: '[ItemGroup]', type: 'variable', info: `Item Group: ${item.sub_item_1 || 'None'}`, apply: '[ItemGroup]' },
    { label: '[ItemName]', type: 'variable', info: `Item Name: ${item.item_name}`, apply: '[ItemName]' },
    { label: '[UOM]', type: 'variable', info: `Unit of Measure: ${item.uom}`, apply: '[UOM]' }
  ] : [];

  return {
    from: word.from,
    options: [
      ...customVarOptions,
      ...dynamicColOptions,
      ...itemPropOptions,
      { label: 'ROUNDUP', type: 'function', info: 'Round up to decimals. Ex: ROUNDUP([Take-off], 0)', apply: 'ROUNDUP(' },
      { label: 'ROUNDDOWN', type: 'function', info: 'Round down to decimals. Ex: ROUNDDOWN([Take-off], 1)', apply: 'ROUNDDOWN(' },
      { label: 'ROUND', type: 'function', info: 'Standard round. Ex: ROUND([Take-off] * 1.1, 2)', apply: 'ROUND(' },
      { label: 'IF', type: 'function', info: 'If condition is true, return first value, else second. Ex: IF([Take-off] > 10, 10, [Take-off])', apply: 'IF(' },
      { label: 'AND', type: 'function', info: 'Logical AND. Ex: AND([Take-off] > 0, [Order] > 0)', apply: 'AND(' },
      { label: 'OR', type: 'function', info: 'Logical OR. Ex: OR([Take-off] > 100, [Overage %] > 10)', apply: 'OR(' },
      { label: 'NOT', type: 'function', info: 'Logical NOT. Ex: NOT([Take-off] == 0)', apply: 'NOT(' },
      { label: 'MAX', type: 'function', info: 'Maximum of values. Ex: MAX([Take-off], 5)', apply: 'MAX(' },
      { label: 'MIN', type: 'function', info: 'Minimum of values. Ex: MIN([Take-off], 100)', apply: 'MIN(' },
      { label: 'CEILING', type: 'function', info: 'Round up to nearest integer. Ex: CEILING([Take-off] / [Order])', apply: 'CEILING(' },
      { label: 'FLOOR', type: 'function', info: 'Round down to nearest integer. Ex: FLOOR([Take-off] / [Order])', apply: 'FLOOR(' },
      { label: 'LOOKUP', type: 'function', info: 'Lookup value in a data table. Ex: LOOKUP("Table", "SearchCol", Value, "ResultCol")', apply: 'LOOKUP(' },
      { label: '[Take-off]', type: 'variable', info: 'Measured Quantity. Ex: [Take-off] * 1.05' },
      { label: '[Overage %]', type: 'variable', info: 'Waste Factor Percentage. Ex: 1 + ([Overage %] / 100)' },
      { label: '[Order]', type: 'variable', info: 'Package/Divisor. Ex: [Take-off] / [Order]' }
    ]
  };
};

function Clock() {
  const [time, setTime] = useState<Date | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTime(new Date());
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!time) return <p className="text-sm text-slate-300 mt-1">Loading time...</p>;
  return (
    <p className="text-sm text-slate-300 mt-1">
      {time.toLocaleString('en-US', { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZoneName: 'short' })}
    </p>
  );
}

const FORMULA_VARIABLES = [
  { name: '[Take-off]', description: 'Measured Quantity', insert: '[Take-off]', example: '[Take-off] * 1.05' },
  { name: '[Overage %]', description: 'Waste Factor Percentage', insert: '[Overage %]', example: '1 + ([Overage %] / 100)' },
  { name: '[Order]', description: 'Package/Divisor', insert: '[Order]', example: '[Take-off] / [Order]' },
];

const FORMULA_FUNCTIONS = [
  { name: 'ROUNDUP', description: 'Round up to decimals', insert: 'ROUNDUP( , 0)', example: 'ROUNDUP([Take-off], 0)' },
  { name: 'ROUNDDOWN', description: 'Round down to decimals', insert: 'ROUNDDOWN( , 0)', example: 'ROUNDDOWN([Take-off], 1)' },
  { name: 'ROUND', description: 'Standard round', insert: 'ROUND( , 0)', example: 'ROUND([Take-off] * 1.1, 2)' },
  { name: 'IF', description: 'If condition is true, return first value, else second', insert: 'IF( , , )', example: 'IF([Take-off] > 10, 10, [Take-off])' },
  { name: 'AND', description: 'Logical AND', insert: 'AND( , )', example: 'AND([Take-off] > 0, [Order] > 0)' },
  { name: 'OR', description: 'Logical OR', insert: 'OR( , )', example: 'OR([Take-off] > 100, [Overage %] > 10)' },
  { name: 'NOT', description: 'Logical NOT', insert: 'NOT( )', example: 'NOT([Take-off] == 0)' },
  { name: 'MAX', description: 'Maximum of values', insert: 'MAX( , )', example: 'MAX([Take-off], 5)' },
  { name: 'MIN', description: 'Minimum of values', insert: 'MIN( , )', example: 'MIN([Take-off], 100)' },
  { name: 'CEILING', description: 'Round up to nearest integer', insert: 'CEILING( )', example: 'CEILING([Take-off] / [Order])' },
  { name: 'FLOOR', description: 'Round down to nearest integer', insert: 'FLOOR( )', example: 'FLOOR([Take-off] / [Order])' },
  { name: 'LOOKUP', description: 'Lookup value in a data table', insert: 'LOOKUP("TableName", "SearchCol", SearchVal, "ResultCol")', example: 'LOOKUP("LaborRates", "Trade", "Carpenter", "Rate")' },
];

function DebouncedInput({ 
  value: initialValue, 
  onChange, 
  debounce = 300, 
  ...props 
}: { 
  value: string | number; 
  onChange: (value: string | number) => void; 
  debounce?: number;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (value !== initialValue) {
        onChange(value);
      }
    }, debounce);

    return () => clearTimeout(timeout);
  }, [value, initialValue, debounce, onChange]);

  return (
    <input 
      {...props} 
      value={value} 
      onChange={e => setValue(e.target.value)} 
    />
  );
}

export default function EstimatorApp() {
  const [isMounted, setIsMounted] = useState(false);
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [takeoffData, setTakeoffData] = useState<Record<string, TakeoffItem>>({});
  const [actionHistory, setActionHistory] = useState<HistoryRecord[]>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [collapsedState, setCollapsedState] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clients, setClients] = useState<Client[]>([]);
  const [clientModalOpen, setClientModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<string | null>(null);
  const [jobNotes, setJobNotes] = useState("");
  const [currentJobId, setCurrentJobId] = useState("");
  const [savedJobs, setSavedJobs] = useState<Record<string, Job>>({});
  const [defaultOveragePct, setDefaultOveragePct] = useState<string>("0");

  // Modals state
  const [qtyPanelOpen, setQtyPanelOpen] = useState(false);
  const [qtyPanelItemId, setQtyPanelItemId] = useState("");
  const [qtyMode, setQtyMode] = useState<'auto' | 'manual' | 'guide'>('auto');
  const [customFormula, setCustomFormula] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>([]);
  const [dynamicColumns, setDynamicColumns] = useState<DynamicColumn[]>([]);
  const [entityData, setEntityData] = useState<Record<string, Record<string, any>>>({});
  const [formulaTemplates, setFormulaTemplates] = useState<FormulaTemplate[]>([]);
  const [formulaTemplateModalOpen, setFormulaTemplateModalOpen] = useState(false);
  const [editingFormulaTemplate, setEditingFormulaTemplate] = useState<FormulaTemplate | null>(null);
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateScopeFilter, setTemplateScopeFilter] = useState<string>("all");
  
  const [mappingModalOpen, setMappingModalOpen] = useState(false);
  const [templateToApply, setTemplateToApply] = useState<FormulaTemplate | null>(null);
  const [variableMappings, setVariableMappings] = useState<Record<string, string>>({});
  const [customVarModalOpen, setCustomVarModalOpen] = useState(false);
  const [editingCustomVar, setEditingCustomVar] = useState<CustomVariable | null>(null);
  const [formulaHelpSearch, setFormulaHelpSearch] = useState("");

  const [dynamicColumnsModalOpen, setDynamicColumnsModalOpen] = useState(false);
  const [editingColumn, setEditingColumn] = useState<DynamicColumn | null>(null);
  const [colScopeL1, setColScopeL1] = useState("");
  const [colScopeL2, setColScopeL2] = useState("");
  const [colScopeL3, setColScopeL3] = useState("");
  const [colScopeL4, setColScopeL4] = useState("");
  const [colScope, setColScope] = useState<'category' | 'subcategory' | 'itemgroup' | 'material' | 'global'>('material');

  const [autoSaveModalOpen, setAutoSaveModalOpen] = useState(false);
  const [autoSaveData, setAutoSaveData] = useState<any>(null);
  const [lastAutoSaveTime, setLastAutoSaveTime] = useState<string | null>(null);

  const [autoSaveTemplatesModalOpen, setAutoSaveTemplatesModalOpen] = useState(false);
  const [autoSaveTemplatesData, setAutoSaveTemplatesData] = useState<any>(null);
  const [lastTemplatesAutoSaveTime, setLastTemplatesAutoSaveTime] = useState<string | null>(null);

  useEffect(() => {
    if (editingColumn) {
      setColScopeL1(editingColumn.category || "");
      setColScopeL2(editingColumn.subCategory || "");
      setColScopeL3(editingColumn.itemGroup || "");
      setColScopeL4(editingColumn.materialName || "");
      setColScope(editingColumn.scope);
    } else {
      setColScopeL1("");
      setColScopeL2("");
      setColScopeL3("");
      setColScopeL4("");
      setColScope("material");
    }
  }, [editingColumn]);

  const migrateLocalStorageToFirestore = useCallback(async (uid: string) => {
    const userDocRef = doc(db, 'users', uid);
    
    const catalogData = localStorage.getItem('userItemCatalog');
    const clientsData = localStorage.getItem('userClients');
    const formulaTemplatesData = localStorage.getItem('formulaTemplates');
    const dataTablesData = localStorage.getItem('userDataTables');
    const dynamicColumnsData = localStorage.getItem('userDynamicColumns');
    const projectTemplatesData = localStorage.getItem('projectTemplates');
    const defaultOverage = localStorage.getItem('defaultOveragePct');
    const showPricing = localStorage.getItem('showPricingColumns');

    const userData: any = {
      uid,
      email: auth.currentUser?.email,
      lastUpdated: serverTimestamp(),
    };

    if (catalogData) userData.catalog = JSON.parse(catalogData);
    if (clientsData) userData.clients = JSON.parse(clientsData);
    if (formulaTemplatesData) userData.formulaTemplates = JSON.parse(formulaTemplatesData);
    if (dataTablesData) userData.dataTables = JSON.parse(dataTablesData);
    if (dynamicColumnsData) userData.dynamicColumns = JSON.parse(dynamicColumnsData);
    if (projectTemplatesData) userData.projectTemplates = JSON.parse(projectTemplatesData);
    if (defaultOverage) userData.defaultOveragePct = defaultOverage;
    if (showPricing) userData.showPricingColumns = showPricing === 'true';

    await setDoc(userDocRef, userData, { merge: true });

    // Migrate jobs
    const savedJobsLocal = JSON.parse(localStorage.getItem('savedEstimatingJobs') || '{}');
    for (const jobId in savedJobsLocal) {
      const jobDocRef = doc(db, 'users', uid, 'jobs', jobId);
      await setDoc(jobDocRef, { ...savedJobsLocal[jobId], id: jobId }, { merge: true });
    }
  }, []);

  const syncUserData = useCallback(async (uid: string) => {
    const userDocRef = doc(db, 'users', uid);
    
    // Listen for real-time updates to global settings
    const unsubUser = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        if (data.catalog) setCatalog(data.catalog);
        if (data.clients) setClients(data.clients);
        if (data.formulaTemplates) setFormulaTemplates(data.formulaTemplates);
        if (data.dataTables) setDataTables(data.dataTables);
        if (data.dynamicColumns) setDynamicColumns(data.dynamicColumns);
        if (data.projectTemplates) setTemplates(data.projectTemplates);
        if (data.defaultOveragePct) setDefaultOveragePct(data.defaultOveragePct);
        if (data.showPricingColumns !== undefined) setShowPricingColumns(data.showPricingColumns);
      } else {
        // First time login: migrate from localStorage if available
        migrateLocalStorageToFirestore(uid);
      }
    }, (error) => {
      console.error("Firestore Error (User Settings):", error);
    });

    // Listen for real-time updates to jobs
    const jobsQuery = collection(db, 'users', uid, 'jobs');
    const unsubJobs = onSnapshot(jobsQuery, (snapshot) => {
      const jobs: Record<string, Job> = {};
      snapshot.forEach((doc) => {
        jobs[doc.id] = doc.data() as Job;
      });
      setSavedJobs(jobs);
    }, (error) => {
      console.error("Firestore Error (Jobs):", error);
    });

    return () => {
      unsubUser();
      unsubJobs();
    };
  }, [migrateLocalStorageToFirestore]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      if (user) {
        // Load user data from Firestore
        syncUserData(user.uid);
      } else {
        // Reset state when logged out
        setCatalog(defaultCatalog);
        setClients([]);
        setFormulaTemplates([]);
        setDataTables([]);
        setDynamicColumns([]);
        setTemplates([]);
        setSavedJobs({});
      }
    });

    return () => unsubscribe();
  }, [syncUserData]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError(null);

    try {
      if (authMode === 'signup') {
        await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        setAuthModalOpen(false);
      } else {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
        setAuthModalOpen(false);
      }
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setUser(null);
  };

  const [allCategories, setAllCategories] = useState<string[]>([]);
  useEffect(() => {
    setAllCategories(getUniqueVals(catalog, 'category'));
  }, [catalog]);
  const allSubCategories = useMemo(() => {
    if (!colScopeL1) return [];
    return getUniqueVals(catalog.filter(i => i.category === colScopeL1), 'sub_category');
  }, [catalog, colScopeL1]);
  const allItemGroups = useMemo(() => {
    if (!colScopeL1 || !colScopeL2) return [];
    return getUniqueVals(catalog.filter(i => i.category === colScopeL1 && i.sub_category === colScopeL2), 'sub_item_1');
  }, [catalog, colScopeL1, colScopeL2]);

  const allMaterials = useMemo(() => {
    if (!colScopeL1 || !colScopeL2 || !colScopeL3) return [];
    return getUniqueVals(catalog.filter(i => i.category === colScopeL1 && i.sub_category === colScopeL2 && i.sub_item_1 === colScopeL3), 'item_name');
  }, [catalog, colScopeL1, colScopeL2, colScopeL3]);

  const [dataTables, setDataTables] = useState<DataTable[]>([]);
  const [dataTableModalOpen, setDataTableModalOpen] = useState(false);
  const [editingDataTable, setEditingDataTable] = useState<DataTable | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [showPricingColumns, setShowPricingColumns] = useState(false);

  const [bomExportModalOpen, setBomExportModalOpen] = useState(false);
  const [bomExportOptions, setBomExportOptions] = useState({
    includeSpec: true,
    includeOveragePct: true,
    includeOrderQty: true,
    includeReference: true,
    onlyInScope: true
  });

  const moveColumn = (index: number, direction: 'up' | 'down') => {
    const newCols = [...dynamicColumns];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newCols.length) return;
    
    const temp = newCols[index];
    newCols[index] = newCols[targetIndex];
    newCols[targetIndex] = temp;
    
    setDynamicColumns(newCols);
    recordHistory(`Reordered columns`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, newCols, entityData);
  };

  const variableRegistry = useMemo(() => {
    const registry: Record<string, { key: string, scope: string, type: string, col?: DynamicColumn }> = {};
    
    customVariables.forEach(cv => {
      registry[cv.name] = { key: cv.name, scope: 'global', type: 'number' };
    });
    
    dynamicColumns.forEach(dc => {
      registry[dc.key] = { key: dc.key, scope: dc.scope, type: dc.dataType, col: dc };
    });
    
    return registry;
  }, [customVariables, dynamicColumns]);

  const isVariableUsedInFormulas = useCallback((key: string) => {
    const keyPattern = `[${key}]`;
    for (const cv of customVariables) {
      if (cv.formula && cv.formula.includes(keyPattern)) return true;
    }
    for (const ft of formulaTemplates) {
      if (ft.formula.includes(keyPattern)) return true;
    }
    for (const itemId in takeoffData) {
      const item = takeoffData[itemId];
      if (item.custom_formula && item.custom_formula.includes(keyPattern)) return true;
    }
    for (const item of catalog) {
      if (item.calc_factor_instruction && item.calc_factor_instruction.includes(keyPattern)) return true;
    }
    return false;
  }, [customVariables, formulaTemplates, takeoffData, catalog]);

  const formulaCompletions = useMemo(() => {
    const item = catalog.find(i => i.item_id === qtyPanelItemId);
    return getFormulaCompletions(customVariables, dynamicColumns, dataTables, item);
  }, [customVariables, dynamicColumns, dataTables, catalog, qtyPanelItemId]);

  const resolveDynamicScope = useCallback((item: Item | undefined, cols: DynamicColumn[] = dynamicColumns) => {
    const scope: Record<string, any> = {};
    if (!item) return scope;
    
    // Add built-in item properties
    scope['Category'] = item.category;
    scope['SubCategory'] = item.sub_category;
    scope['ItemGroup'] = item.sub_item_1 || '';
    scope['ItemName'] = item.item_name;
    scope['UOM'] = item.uom;
    
    // Inject default values from relevant dynamic columns first
    cols.forEach(col => {
      // Branch-scoped filtering
      let isRelevant = true;
      if (col.scope === 'category' && col.category && col.category !== item.category) isRelevant = false;
      if (col.scope === 'subcategory' && (col.category !== item.category || (col.subCategory && col.subCategory !== item.sub_category))) isRelevant = false;
      if (col.scope === 'itemgroup' && (col.category !== item.category || (col.subCategory && col.subCategory !== item.sub_category) || (col.itemGroup && col.itemGroup !== (item.sub_item_1 || '')))) isRelevant = false;
      if (col.scope === 'material' && (col.category !== item.category || (col.subCategory && col.subCategory !== item.sub_category) || (col.itemGroup && col.itemGroup !== (item.sub_item_1 || '')) || (col.materialName && col.materialName !== item.item_name))) isRelevant = false;
      
      if (isRelevant && col.defaultValue !== undefined && col.defaultValue !== '') {
        // Convert to number if it's a number type
        const val = col.dataType === 'number' ? Number(col.defaultValue) : 
                    col.dataType === 'boolean' ? (col.defaultValue.toLowerCase() === 'true') : 
                    col.defaultValue;
        scope[col.key] = val;
      }
    });
    
    // 4. Category level
    const catKey = `CAT:${item.category}`;
    if (entityData[catKey]) Object.assign(scope, entityData[catKey]);
    
    // 3. SubCategory level
    const subCatKey = `SUBCAT:${item.category}|${item.sub_category}`;
    if (entityData[subCatKey]) Object.assign(scope, entityData[subCatKey]);
    
    // 2. ItemGroup level
    if (item.sub_item_1) {
      const itemGroupKey = `ITEMGROUP:${item.category}|${item.sub_category}|${item.sub_item_1}`;
      if (entityData[itemGroupKey]) Object.assign(scope, entityData[itemGroupKey]);
    }
    
    // 1. Material level
    const matKey = `MATERIAL:${item.item_id}`;
    if (entityData[matKey]) Object.assign(scope, entityData[matKey]);

    return scope;
  }, [entityData, dynamicColumns]);

  const formulaLinter = useMemo(() => linter((view) => {
    const diagnostics: Diagnostic[] = [];
    const doc = view.state.doc.toString();
    if (!doc) return diagnostics;

    // Check balanced parentheses
    let openParens = 0;
    for (let i = 0; i < doc.length; i++) {
      if (doc[i] === '(') openParens++;
      if (doc[i] === ')') openParens--;
      if (openParens < 0) {
        diagnostics.push({
          from: i,
          to: i + 1,
          severity: 'error',
          message: 'Extra closing parenthesis'
        });
        openParens = 0;
      }
    }
    if (openParens > 0) {
      diagnostics.push({
        from: doc.length,
        to: doc.length,
        severity: 'error',
        message: 'Missing closing parenthesis'
      });
    }

    // Check balanced brackets
    let openBrackets = 0;
    for (let i = 0; i < doc.length; i++) {
      if (doc[i] === '[') openBrackets++;
      if (doc[i] === ']') openBrackets--;
      if (openBrackets < 0) {
        diagnostics.push({
          from: i,
          to: i + 1,
          severity: 'error',
          message: 'Extra closing bracket'
        });
        openBrackets = 0;
      }
    }
    if (openBrackets > 0) {
      diagnostics.push({
        from: doc.length,
        to: doc.length,
        severity: 'error',
        message: 'Missing closing bracket'
      });
    }

    // If basic structure is okay, check evaluate
    if (diagnostics.length === 0) {
      const item = catalog.find(i => i.item_id === qtyPanelItemId);
      const validation = validateCustomFormula(doc, customVariables, resolveDynamicScope(item), variableRegistry);
      if (!validation.isValid) {
        diagnostics.push({
          from: 0,
          to: doc.length,
          severity: 'error',
          message: validation.error || "Invalid formula"
        });
      }
    }

    return diagnostics;
  }), [customVariables, catalog, qtyPanelItemId, resolveDynamicScope, variableRegistry]);

  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemModalMode, setItemModalMode] = useState<'add' | 'edit'>('add');
  const [editingItemId, setEditingItemId] = useState("");
  
  const [modCategory, setModCategory] = useState("");
  const [modSubCategory, setModSubCategory] = useState("");
  const [modSubItem1, setModSubItem1] = useState("");
  const [modItemName, setModItemName] = useState("");
  const [modUOM, setModUOM] = useState("");
  const [modRule, setModRule] = useState("");
  const [modNotes, setModNotes] = useState("");

  const [isNewCategory, setIsNewCategory] = useState(false);
  const [isNewSubCategory, setIsNewSubCategory] = useState(false);
  const [isNewSubItem1, setIsNewSubItem1] = useState(false);

  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' | null }>({ key: '', direction: null });

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' | null = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    } else if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = null;
    }
    setSortConfig({ key, direction });
  };

  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [newProjectModalOpen, setNewProjectModalOpen] = useState(false);
  const [newProjectData, setNewProjectData] = useState({ name: '', client: '', description: '', templateId: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const formulaInputRef = useRef<ReactCodeMirrorRef>(null);
  
  const actionHistoryRef = useRef<HistoryRecord[]>([]);
  const historyIndexRef = useRef<number>(0);

  useEffect(() => {
    actionHistoryRef.current = actionHistory;
  }, [actionHistory]);

  useEffect(() => {
    historyIndexRef.current = historyIndex;
  }, [historyIndex]);

  useEffect(() => {
    if (!user) {
      const savedCatalog = localStorage.getItem('userItemCatalog');
      if (savedCatalog) {
        setCatalog(JSON.parse(savedCatalog));
      } else {
        setCatalog(defaultCatalog);
      }

      const savedClients = localStorage.getItem('userClients');
      if (savedClients) {
        try {
          setClients(JSON.parse(savedClients));
        } catch (e) {}
      }

      const savedFormulaTemplates = localStorage.getItem('formulaTemplates');
      if (savedFormulaTemplates) {
        try {
          setFormulaTemplates(JSON.parse(savedFormulaTemplates));
        } catch (e) {}
      }

      const savedDataTables = localStorage.getItem('userDataTables');
      if (savedDataTables) {
        try {
          setDataTables(JSON.parse(savedDataTables));
        } catch (e) {}
      }

      const savedDynamicColumns = localStorage.getItem('userDynamicColumns');
      if (savedDynamicColumns) {
        try {
          setDynamicColumns(JSON.parse(savedDynamicColumns));
        } catch (e) {}
      }

      const jobs = JSON.parse(localStorage.getItem('savedEstimatingJobs') || '{}');
      setSavedJobs(jobs);
      
      const savedProjectTemplates = localStorage.getItem('projectTemplates');
      if (savedProjectTemplates) {
        setTemplates(JSON.parse(savedProjectTemplates));
      }

      const savedDefaultOverage = localStorage.getItem('defaultOveragePct');
      if (savedDefaultOverage) {
        setDefaultOveragePct(savedDefaultOverage);
      }

      const savedShowPricing = localStorage.getItem('showPricingColumns');
      if (savedShowPricing) {
        setShowPricingColumns(savedShowPricing === 'true');
      }
    }

    setCurrentJobId("JOB-" + Date.now());
    setIsMounted(true);
  }, [user]);

  // Debounced sync to Firestore for global settings
  useEffect(() => {
    if (!isMounted || !user) return;

    const timeout = setTimeout(async () => {
      const userDocRef = doc(db, 'users', user.uid);
      try {
        await setDoc(userDocRef, {
          catalog,
          clients,
          formulaTemplates,
          dataTables,
          dynamicColumns,
          projectTemplates: templates,
          defaultOveragePct,
          showPricingColumns,
          lastUpdated: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        console.error("Error syncing to Firestore:", error);
      }
    }, 2000); // 2 second debounce

    return () => clearTimeout(timeout);
  }, [catalog, clients, formulaTemplates, dataTables, dynamicColumns, templates, defaultOveragePct, showPricingColumns, user, isMounted]);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('userDynamicColumns', JSON.stringify(dynamicColumns));
    }
  }, [dynamicColumns, isMounted]);

  useEffect(() => {
    if (isMounted) {
      localStorage.setItem('showPricingColumns', String(showPricingColumns));
    }
  }, [showPricingColumns, isMounted]);

  const autoMapVariables = useCallback((template: FormulaTemplate, item: Item | undefined) => {
    const mappings: Record<string, string> = {};
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    
    template.variables.forEach(v => {
      // 1. Check for built-in variables first
      const vLower = v.toLowerCase();
      const vNorm = normalize(v);

      if (vLower === 'take-off' || vLower === 'takeoff' || vNorm === 'takeoff') {
        mappings[v] = '[Take-off]';
        return;
      }
      if (vLower === 'overage %' || vLower === 'overage' || vNorm === 'overage') {
        mappings[v] = '[Overage %]';
        return;
      }
      if (vLower === 'order' || vNorm === 'order') {
        mappings[v] = '[Order]';
        return;
      }

      // 2. Find potential matches in registry
      const allVars = Object.entries(variableRegistry);
      
      // Priority 1: Exact name match + Relevant scope
      // Priority 2: Exact name match + Global scope
      // Priority 3: Normalized name match + Relevant scope
      // Priority 4: Normalized name match + Global scope
      // Priority 5: Any exact name match
      // Priority 6: Any normalized name match

      const isRelevant = (info: any) => {
        if (!item) return info.scope === 'global';
        if (info.scope === 'global') return true;
        if (!info.col) return false;
        const c = info.col;
        if (c.scope === 'category' && c.category === item.category) return true;
        if (c.scope === 'subcategory' && c.category === item.category && c.subCategory === item.sub_category) return true;
        if (c.scope === 'itemgroup' && c.category === item.category && c.subCategory === item.sub_category && c.itemGroup === (item.sub_item_1 || '')) return true;
        if (c.scope === 'material' && c.category === item.category && c.subCategory === item.sub_category && c.itemGroup === (item.sub_item_1 || '') && c.materialName === item.item_name) return true;
        return false;
      };

      const exactMatches = allVars.filter(([regKey]) => regKey.toLowerCase() === vLower);
      const normMatches = allVars.filter(([regKey]) => normalize(regKey) === vNorm);

      const bestExactRelevant = exactMatches.find(([_, info]) => isRelevant(info));
      if (bestExactRelevant) { mappings[v] = `[${bestExactRelevant[0]}]`; return; }

      const bestExactGlobal = exactMatches.find(([_, info]) => info.scope === 'global');
      if (bestExactGlobal) { mappings[v] = `[${bestExactGlobal[0]}]`; return; }

      const bestNormRelevant = normMatches.find(([_, info]) => isRelevant(info));
      if (bestNormRelevant) { mappings[v] = `[${bestNormRelevant[0]}]`; return; }

      const bestNormGlobal = normMatches.find(([_, info]) => info.scope === 'global');
      if (bestNormGlobal) { mappings[v] = `[${bestNormGlobal[0]}]`; return; }

      if (exactMatches.length > 0) { mappings[v] = `[${exactMatches[0][0]}]`; return; }
      if (normMatches.length > 0) { mappings[v] = `[${normMatches[0][0]}]`; return; }
    });
    
    return mappings;
  }, [variableRegistry]);

  const autoSaveCurrentProject = useCallback(() => {
    if (!isMounted) return;
    
    const projectData = {
      projectName,
      clientName,
      jobNotes,
      takeoffData,
      customVariables,
      dynamicColumns,
      entityData,
      formulaTemplates,
      dataTables,
      projectTemplates: templates,
      lastAutoSave: new Date().toISOString()
    };
    
    localStorage.setItem('autoSavedProject', JSON.stringify(projectData));
    setLastAutoSaveTime(new Date().toLocaleString());
  }, [isMounted, projectName, clientName, jobNotes, takeoffData, customVariables, dynamicColumns, entityData, formulaTemplates, dataTables, templates]);

  const autoSaveTemplates = useCallback(() => {
    if (!isMounted) return;
    
    const templatesData = {
      formulaTemplates,
      projectTemplates: templates,
      lastAutoSave: new Date().toISOString()
    };
    
    localStorage.setItem('autoSavedTemplates', JSON.stringify(templatesData));
    setLastTemplatesAutoSaveTime(new Date().toLocaleString());
  }, [isMounted, formulaTemplates, templates]);

  useEffect(() => {
    if (!isMounted) return;
    const interval = setInterval(() => {
      autoSaveCurrentProject();
      autoSaveTemplates();
    }, 120000); // Auto-save every 2 minutes
    
    return () => clearInterval(interval);
  }, [autoSaveCurrentProject, autoSaveTemplates, isMounted]);

  useEffect(() => {
    if (isMounted) {
      autoSaveTemplates();
    }
  }, [formulaTemplates, templates, isMounted, autoSaveTemplates]);

  const recordHistory = (actionDescription: string, newData = takeoffData, newCatalog = catalog, newProj = projectName, newClient = clientName, newCustomVars = customVariables, newNotes = jobNotes, newDynamicColumns = dynamicColumns, newEntityData = entityData, newFormulaTemplates = formulaTemplates, newDataTables = dataTables) => {
    const snapshot: HistoryRecord = {
      timestamp: new Date().toISOString(),
      action: actionDescription,
      dataState: JSON.parse(JSON.stringify(newData)),
      catalogState: JSON.parse(JSON.stringify(newCatalog)),
      projectName: newProj,
      clientName: newClient,
      jobNotes: newNotes,
      customVariables: JSON.parse(JSON.stringify(newCustomVars)),
      dynamicColumns: JSON.parse(JSON.stringify(newDynamicColumns)),
      entityData: JSON.parse(JSON.stringify(newEntityData)),
      formulaTemplates: JSON.parse(JSON.stringify(newFormulaTemplates)),
      dataTables: JSON.parse(JSON.stringify(newDataTables))
    };
    
    // Prevent duplicate history records using refs to ensure we have the latest state
    const currentHistory = actionHistoryRef.current;
    const currentIndex = historyIndexRef.current;
    
    if (currentHistory.length > 0 && currentIndex < currentHistory.length) {
      const currentRecord = currentHistory[currentIndex];
      if (
        JSON.stringify(currentRecord.dataState) === JSON.stringify(snapshot.dataState) &&
        JSON.stringify(currentRecord.catalogState) === JSON.stringify(snapshot.catalogState) &&
        currentRecord.projectName === snapshot.projectName &&
        currentRecord.clientName === snapshot.clientName &&
        currentRecord.jobNotes === snapshot.jobNotes &&
        JSON.stringify(currentRecord.customVariables) === JSON.stringify(snapshot.customVariables) &&
        JSON.stringify(currentRecord.dynamicColumns) === JSON.stringify(snapshot.dynamicColumns) &&
        JSON.stringify(currentRecord.entityData) === JSON.stringify(snapshot.entityData) &&
        JSON.stringify(currentRecord.dataTables) === JSON.stringify(snapshot.dataTables)
      ) {
        return; // No changes detected
      }
    }

    setActionHistory(prev => {
      const pastHistory = prev.slice(currentIndex);
      const newHistory = [snapshot, ...pastHistory];
      if (newHistory.length > 50) newHistory.pop();
      return newHistory;
    });
    
    setHistoryIndex(0);

    // Immediate auto-save on significant action
    const projectData = {
      projectName: newProj,
      clientName: newClient,
      jobNotes: newNotes,
      takeoffData: newData,
      customVariables: newCustomVars,
      dynamicColumns: newDynamicColumns,
      entityData: newEntityData,
      formulaTemplates: newFormulaTemplates,
      dataTables: newDataTables,
      projectTemplates: templates,
      lastAutoSave: new Date().toISOString()
    };
    localStorage.setItem('autoSavedProject', JSON.stringify(projectData));
    setLastAutoSaveTime(new Date().toLocaleString());
  };

  const canUndo = historyIndex < actionHistory.length - 1;
  const canRedo = historyIndex > 0;

  const undo = useCallback(() => {
    if (canUndo) {
      const newIndex = historyIndex + 1;
      const record = actionHistory[newIndex];
      setTakeoffData(record.dataState);
      if (record.catalogState) {
        setCatalog(record.catalogState);
        localStorage.setItem('userItemCatalog', JSON.stringify(record.catalogState));
      }
      setProjectName(record.projectName);
      setClientName(record.clientName);
      setJobNotes(record.jobNotes || "");
      if (record.customVariables) setCustomVariables(record.customVariables);
      if (record.dynamicColumns) setDynamicColumns(record.dynamicColumns);
      if (record.entityData) setEntityData(record.entityData);
      if (record.formulaTemplates) setFormulaTemplates(record.formulaTemplates);
      if (record.dataTables) setDataTables(record.dataTables);
      setHistoryIndex(newIndex);
    }
  }, [canUndo, historyIndex, actionHistory]);

  const redo = useCallback(() => {
    if (canRedo) {
      const newIndex = historyIndex - 1;
      const record = actionHistory[newIndex];
      setTakeoffData(record.dataState);
      if (record.catalogState) {
        setCatalog(record.catalogState);
        localStorage.setItem('userItemCatalog', JSON.stringify(record.catalogState));
      }
      setProjectName(record.projectName);
      setClientName(record.clientName);
      setJobNotes(record.jobNotes || "");
      if (record.customVariables) setCustomVariables(record.customVariables);
      if (record.dynamicColumns) setDynamicColumns(record.dynamicColumns);
      if (record.entityData) setEntityData(record.entityData);
      if (record.formulaTemplates) setFormulaTemplates(record.formulaTemplates);
      if (record.dataTables) setDataTables(record.dataTables);
      setHistoryIndex(newIndex);
    }
  }, [canRedo, historyIndex, actionHistory]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in an input, textarea, or contenteditable
      const activeElement = document.activeElement;
      if (activeElement) {
        const tagName = activeElement.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'textarea' || (activeElement as HTMLElement).isContentEditable) {
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  const handleSelectItem = (itemId: string, checked: boolean) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (checked) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  };

  const handleSelectAll = (itemIds: string[], checked: boolean) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      itemIds.forEach(id => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  const setScopeForSelected = (inScope: boolean) => {
    if (selectedItems.size === 0) return;
    
    setTakeoffData(prev => {
      const newData = { ...prev };
      let changedCount = 0;
      
      selectedItems.forEach(itemId => {
        const item = catalog.find(i => i.item_id === itemId);
        if (!item) return;
        
        if (!newData[itemId]) {
          let defaultOverage = "";
          const match = item.calc_factor_instruction.match(/(\d+)%\s*overage/i);
          if (match) defaultOverage = match[1];
          newData[itemId] = {
            in_scope: false, spec: "", qty: "", measured_qty: "",
            overage_pct: defaultOverage, order_qty: "", evidence: "",
            qty_mode: 'auto', custom_formula: DEFAULT_QTY_FORMULA
          };
        }
        
        if (newData[itemId].in_scope !== inScope) {
          newData[itemId] = { ...newData[itemId], in_scope: inScope };
          
          if (!newData[itemId].in_scope) {
            newData[itemId].qty = "";
            newData[itemId].measured_qty = "";
            newData[itemId].order_qty = "";
          } else {
            if (newData[itemId].qty_mode !== 'manual') {
              const formula = newData[itemId].custom_formula || DEFAULT_QTY_FORMULA;
              newData[itemId].measured_qty = evaluateCustomFormula(
                formula,
                newData[itemId].qty,
                newData[itemId].overage_pct !== "" ? newData[itemId].overage_pct : defaultOveragePct,
                newData[itemId].order_qty,
                customVariables,
                resolveDynamicScope(item)
              ).toString();
            }
          }
          changedCount++;
        }
      });
      
      if (changedCount > 0) {
        setTimeout(() => recordHistory(`Marked ${changedCount} items as ${inScope ? 'In Scope' : 'Out of Scope'}`, newData, catalog, projectName, clientName), 0);
      }
      return newData;
    });
  };

  const formulasHash = useMemo(() => {
    return Object.keys(takeoffData).map(id => `${id}:${takeoffData[id].custom_formula || DEFAULT_QTY_FORMULA}`).join('|');
  }, [takeoffData]);

  const dependencyMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const itemId in takeoffData) {
      const formula = takeoffData[itemId].custom_formula || DEFAULT_QTY_FORMULA;
      const variables = extractVariablesFromFormula(formula);
      variables.forEach(v => {
        if (!map[v]) map[v] = [];
        if (!map[v].includes(itemId)) map[v].push(itemId);
      });
    }
    return map;
  }, [formulasHash]); // eslint-disable-line react-hooks/exhaustive-deps

  const recalculateAffectedItems = useCallback((changedSources: string[], currentVars: CustomVariable[] = customVariables, currentEntityData: Record<string, Record<string, any>> = entityData, currentTakeoffData: Record<string, TakeoffItem> = takeoffData, currentDataTables: DataTable[] = dataTables) => {
    const affectedItems = new Set<string>();
    const affectedVars = new Set<string>();
    
    const queue = [...changedSources];
    const visited = new Set<string>(queue);
    
    while (queue.length > 0) {
      const source = queue.shift()!;
      
      if (source.startsWith('Variable:')) {
        const varName = source.split(':')[1];
        affectedVars.add(varName);
        
        currentVars.forEach(v => {
          if (v.formula && extractVariablesFromFormula(v.formula).includes(varName)) {
            const nextSource = `Variable:${v.name}`;
            if (!visited.has(nextSource)) {
              visited.add(nextSource);
              queue.push(nextSource);
            }
          }
        });
        
        if (dependencyMap[varName]) {
          dependencyMap[varName].forEach(itemId => affectedItems.add(itemId));
        }
      }
      
      if (source.startsWith('Field:') || source.startsWith('BuiltIn:')) {
        const fieldName = source.split(':')[1];
        if (dependencyMap[fieldName]) {
          dependencyMap[fieldName].forEach(itemId => affectedItems.add(itemId));
        }
      }
      
      if (source.startsWith('Item:')) {
        const itemId = source.split(':')[1];
        affectedItems.add(itemId);
      }
    }
    
    if (affectedItems.size === 0 && affectedVars.size === 0) return { newData: currentTakeoffData, hasChanges: false, newVars: currentVars };
    
    let newVars = currentVars;
    if (affectedVars.size > 0) {
      newVars = recalculateCustomVariables(currentVars);
      setCustomVariables(newVars);
    }
    
    const newData = { ...currentTakeoffData };
    let hasChanges = false;
    
    affectedItems.forEach(itemId => {
      if (newData[itemId] && newData[itemId].qty_mode !== 'manual') {
        const item = catalog.find(i => i.item_id === itemId);
        if (!item) return;
        
        const formula = newData[itemId].custom_formula || DEFAULT_QTY_FORMULA;
        const scope = resolveDynamicScope(item, dynamicColumns);
        
        const newQty = evaluateCustomFormula(
          formula,
          newData[itemId].qty,
          newData[itemId].overage_pct !== "" ? newData[itemId].overage_pct : defaultOveragePct,
          newData[itemId].order_qty,
          newVars,
          scope
        ).toString();
        
        if (newQty !== newData[itemId].measured_qty) {
          newData[itemId] = { ...newData[itemId], measured_qty: newQty };
          hasChanges = true;
        }
      }
    });
    
    if (hasChanges) {
      setTakeoffData(newData);
    }
    
    return { newData, hasChanges, newVars };
  }, [dependencyMap, customVariables, takeoffData, catalog, defaultOveragePct, entityData, dynamicColumns, resolveDynamicScope, dataTables]);

  const handleDefaultOverageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setDefaultOveragePct(val);
    localStorage.setItem('defaultOveragePct', val);
    
    recalculateAffectedItems(['BuiltIn:Overage %'], customVariables, entityData, takeoffData);
  };

  const recalculateAllFormulas = useCallback((vars: CustomVariable[], eData: Record<string, Record<string, any>>, forceAll: boolean = false, currentCollapsedState: Record<string, boolean> = collapsedState, currentDynamicColumns: DynamicColumn[] = dynamicColumns) => {
    const newData = { ...takeoffData };
    let hasChanges = false;
    
    // Helper to resolve dynamic scope with specific dynamic columns
    const resolveScope = (item: Item) => {
      const scope: Record<string, any> = {};
      scope['Category'] = item.category;
      scope['SubCategory'] = item.sub_category;
      scope['ItemGroup'] = item.sub_item_1 || '';
      scope['ItemName'] = item.item_name;
      scope['UOM'] = item.uom;
      
      const catKey = `CAT:${item.category}`;
      if (eData[catKey]) Object.assign(scope, eData[catKey]);
      const subCatKey = `SUBCAT:${item.category}|${item.sub_category}`;
      if (eData[subCatKey]) Object.assign(scope, eData[subCatKey]);
      if (item.sub_item_1) {
        const itemGroupKey = `ITEMGROUP:${item.category}|${item.sub_category}|${item.sub_item_1}`;
        if (eData[itemGroupKey]) Object.assign(scope, eData[itemGroupKey]);
      }
      const matKey = `MATERIAL:${item.item_id}`;
      if (eData[matKey]) Object.assign(scope, eData[matKey]);
      
      // Add default values from columns
      currentDynamicColumns.forEach(col => {
        let isRelevant = true;
        if (col.scope === 'category' && col.category && col.category !== item.category) isRelevant = false;
        if (col.scope === 'subcategory' && (col.category !== item.category || (col.subCategory && col.subCategory !== item.sub_category))) isRelevant = false;
        if (col.scope === 'itemgroup' && (col.category !== item.category || (col.subCategory && col.subCategory !== item.sub_category) || (col.itemGroup && col.itemGroup !== (item.sub_item_1 || '')))) isRelevant = false;
        if (col.scope === 'material' && (col.category !== item.category || (col.subCategory && col.subCategory !== item.sub_category) || (col.itemGroup && col.itemGroup !== (item.sub_item_1 || '')) || (col.materialName && col.materialName !== item.item_name))) isRelevant = false;

        if (isRelevant && scope[col.key] === undefined && col.defaultValue !== undefined && col.defaultValue !== '') {
          const val = col.dataType === 'number' ? Number(col.defaultValue) : 
                      col.dataType === 'boolean' ? (col.defaultValue.toLowerCase() === 'true') : 
                      col.defaultValue;
          scope[col.key] = val;
        }
      });
      
      return scope;
    };

    for (const itemId in newData) {
      if (newData[itemId].qty_mode !== 'manual') {
        const item = catalog.find(i => i.item_id === itemId);
        if (!item) continue;

        if (!forceAll) {
          const isCatCollapsed = currentCollapsedState[item.category];
          const isSubCollapsed = currentCollapsedState[`${item.category}||${item.sub_category}`];
          const isSub1Collapsed = currentCollapsedState[`${item.category}||${item.sub_category}||${item.sub_item_1}`];
          if (isCatCollapsed || isSubCollapsed || isSub1Collapsed) {
            continue; // Skip recalculation for collapsed sections
          }
        }

        const formula = newData[itemId].custom_formula || DEFAULT_QTY_FORMULA;
        const scope = resolveScope(item);

        const newQty = evaluateCustomFormula(
          formula,
          newData[itemId].qty,
          newData[itemId].overage_pct !== "" ? newData[itemId].overage_pct : defaultOveragePct,
          newData[itemId].order_qty,
          vars,
          scope
        ).toString();
        if (newQty !== newData[itemId].measured_qty) {
          newData[itemId] = { ...newData[itemId], measured_qty: newQty };
          hasChanges = true;
        }
      }
    }
    if (hasChanges) {
      setTakeoffData(newData);
    }
    return { newData, hasChanges };
  }, [takeoffData, catalog, defaultOveragePct, collapsedState, dynamicColumns]);

  const handleEntityDataBlur = (actionName: string, changedFields: string[] = []) => {
    if (changedFields.length > 0) {
      const sources = changedFields.map(f => `Field:${f}`);
      const { newData, hasChanges } = recalculateAffectedItems(sources, customVariables, entityData, takeoffData);
      recordHistory(actionName, hasChanges ? newData : takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData);
    } else {
      const { newData, hasChanges } = recalculateAllFormulas(customVariables, entityData);
      recordHistory(actionName, hasChanges ? newData : takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData);
    }
  };

  const updateTakeoffData = (itemId: string, field: keyof TakeoffItem, value: any, instruction: string, itemName: string) => {
    setTakeoffData(prev => {
      const newData = { ...prev };
      if (!newData[itemId]) {
        let defaultOverage = "";
        const match = instruction.match(/(\d+)%\s*overage/i);
        if (match) defaultOverage = match[1];
        newData[itemId] = {
          in_scope: false, spec: "", qty: "", measured_qty: "",
          overage_pct: defaultOverage, order_qty: "", evidence: "",
          qty_mode: 'auto', custom_formula: DEFAULT_QTY_FORMULA,
          unit_price: ""
        };
      }

      let finalValue = value;
      if (['qty', 'order_qty', 'overage_pct', 'unit_price'].includes(field) && typeof value === 'string') {
        const evaluated = evaluateMath(value);
        if (evaluated !== "") finalValue = evaluated;
      }

      newData[itemId] = { ...newData[itemId], [field]: finalValue };

      if (field === 'in_scope' && !finalValue) {
        newData[itemId].qty = "";
        newData[itemId].measured_qty = "";
        newData[itemId].order_qty = "";
      }

      if (['qty', 'overage_pct', 'order_qty'].includes(field) || (field === 'in_scope' && finalValue)) {
        const source = field === 'qty' ? 'BuiltIn:Take-off' : (field === 'overage_pct' ? 'BuiltIn:Overage %' : (field === 'order_qty' ? 'BuiltIn:Order' : ''));
        setTimeout(() => {
          const sources = [`Item:${itemId}`];
          if (source) sources.push(source);
          recalculateAffectedItems(sources);
        }, 0);
      }

      const actionDesc = field === 'in_scope' 
        ? (finalValue ? `Added Scope: ${itemName}` : `Removed Scope: ${itemName}`) 
        : `Updated ${field} for ${itemName}`;
      
      if (field === 'in_scope') {
        setTimeout(() => recordHistory(actionDesc, newData, catalog, projectName, clientName), 0);
      }
      return newData;
    });
  };

  const toggleCollapse = (key: string) => {
    setCollapsedState(prev => {
      const next = { ...prev, [key]: !prev[key] };
      // If expanding, recalculate formulas with the new collapsed state
      if (!next[key]) {
        setTimeout(() => {
          recalculateAllFormulas(customVariables, entityData, false, next);
        }, 0);
      }
      return next;
    });
  };

  const renameCategory = (oldCat: string) => {
    const newCat = window.prompt(`Rename Category (L1):`, oldCat);
    if (newCat && newCat.trim() !== "" && newCat !== oldCat) {
      const upperNew = newCat.toUpperCase();
      const newCatalog = catalog.map(i => i.category === oldCat ? { ...i, category: upperNew } : i);
      setCatalog(newCatalog);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      
      setCollapsedState(prev => {
        const next = { ...prev };
        if (next[oldCat] !== undefined) {
          next[upperNew] = next[oldCat];
          delete next[oldCat];
        }
        return next;
      });
      recordHistory(`Renamed Category '${oldCat}' to '${upperNew}'`, takeoffData, newCatalog, projectName, clientName);
    }
  };

  const duplicateCategory = (oldCat: string) => {
    const newCat = window.prompt(`Duplicate Category (L1) as:`, `${oldCat} COPY`);
    if (newCat && newCat.trim() !== "") {
      const upperNew = newCat.toUpperCase();
      const itemsToDuplicate = catalog.filter(i => i.category === oldCat);
      const newItems: Item[] = [];
      const newTakeoffData = { ...takeoffData };
      const newEntityData = { ...entityData };
      
      if (newEntityData[`CAT:${oldCat}`]) {
        newEntityData[`CAT:${upperNew}`] = { ...newEntityData[`CAT:${oldCat}`] };
      }
      
      itemsToDuplicate.forEach(item => {
        const newItemId = "ITM-" + Date.now() + Math.random().toString(36).substring(2, 9);
        newItems.push({ ...item, item_id: newItemId, category: upperNew });
        if (takeoffData[item.item_id]) {
          newTakeoffData[newItemId] = { ...takeoffData[item.item_id] };
        }
        
        // Copy subcategory entity data
        const oldSubCatKey = `SUBCAT:${oldCat}|${item.sub_category}`;
        const newSubCatKey = `SUBCAT:${upperNew}|${item.sub_category}`;
        if (newEntityData[oldSubCatKey] && !newEntityData[newSubCatKey]) {
            newEntityData[newSubCatKey] = { ...newEntityData[oldSubCatKey] };
        }
        
        // Copy item group entity data
        if (item.sub_item_1) {
            const oldItemGroupKey = `ITEMGROUP:${oldCat}|${item.sub_category}|${item.sub_item_1}`;
            const newItemGroupKey = `ITEMGROUP:${upperNew}|${item.sub_category}|${item.sub_item_1}`;
            if (newEntityData[oldItemGroupKey] && !newEntityData[newItemGroupKey]) {
                newEntityData[newItemGroupKey] = { ...newEntityData[oldItemGroupKey] };
            }
        }
        
        // Copy material entity data
        const oldMatKey = `MATERIAL:${item.item_id}`;
        const newMatKey = `MATERIAL:${newItemId}`;
        if (newEntityData[oldMatKey]) {
            newEntityData[newMatKey] = { ...newEntityData[oldMatKey] };
        }
      });
      
      const newCatalog = [...catalog, ...newItems];
      setCatalog(newCatalog);
      setTakeoffData(newTakeoffData);
      setEntityData(newEntityData);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      recordHistory(`Duplicated Category '${oldCat}' to '${upperNew}'`, newTakeoffData, newCatalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, newEntityData);
    }
  };

  const renameSubCategory = (cat: string, oldSub: string) => {
    const newSub = window.prompt(`Rename Sub-Category (L2) inside '${cat}':`, oldSub);
    if (newSub && newSub.trim() !== "" && newSub !== oldSub) {
      const newCatalog = catalog.map(i => (i.category === cat && i.sub_category === oldSub) ? { ...i, sub_category: newSub } : i);
      setCatalog(newCatalog);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      
      const oldKey = cat + '||' + oldSub;
      const newKey = cat + '||' + newSub;
      setCollapsedState(prev => {
        const next = { ...prev };
        if (next[oldKey] !== undefined) {
          next[newKey] = next[oldKey];
          delete next[oldKey];
        }
        return next;
      });
      recordHistory(`Renamed Sub-Category '${oldSub}' to '${newSub}'`, takeoffData, newCatalog, projectName, clientName);
    }
  };

  const duplicateSubCategory = (cat: string, oldSub: string) => {
    const newSub = window.prompt(`Duplicate Sub-Category (L2) inside '${cat}' as:`, `${oldSub} Copy`);
    if (newSub && newSub.trim() !== "") {
      const itemsToDuplicate = catalog.filter(i => i.category === cat && i.sub_category === oldSub);
      const newItems: Item[] = [];
      const newTakeoffData = { ...takeoffData };
      const newEntityData = { ...entityData };
      
      const oldSubCatKey = `SUBCAT:${cat}|${oldSub}`;
      const newSubCatKey = `SUBCAT:${cat}|${newSub}`;
      if (newEntityData[oldSubCatKey]) {
          newEntityData[newSubCatKey] = { ...newEntityData[oldSubCatKey] };
      }
      
      itemsToDuplicate.forEach(item => {
        const newItemId = "ITM-" + Date.now() + Math.random().toString(36).substring(2, 9);
        newItems.push({ ...item, item_id: newItemId, sub_category: newSub });
        if (takeoffData[item.item_id]) {
          newTakeoffData[newItemId] = { ...takeoffData[item.item_id] };
        }
        
        // Copy item group entity data
        if (item.sub_item_1) {
            const oldItemGroupKey = `ITEMGROUP:${cat}|${oldSub}|${item.sub_item_1}`;
            const newItemGroupKey = `ITEMGROUP:${cat}|${newSub}|${item.sub_item_1}`;
            if (newEntityData[oldItemGroupKey] && !newEntityData[newItemGroupKey]) {
                newEntityData[newItemGroupKey] = { ...newEntityData[oldItemGroupKey] };
            }
        }
        
        // Copy material entity data
        const oldMatKey = `MATERIAL:${item.item_id}`;
        const newMatKey = `MATERIAL:${newItemId}`;
        if (newEntityData[oldMatKey]) {
            newEntityData[newMatKey] = { ...newEntityData[oldMatKey] };
        }
      });
      
      const newCatalog = [...catalog, ...newItems];
      setCatalog(newCatalog);
      setTakeoffData(newTakeoffData);
      setEntityData(newEntityData);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      recordHistory(`Duplicated Sub-Category '${oldSub}' to '${newSub}'`, newTakeoffData, newCatalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, newEntityData);
    }
  };

  const renameSubItem1 = (cat: string, subCat: string, oldSubItem: string) => {
    const newSubItem = window.prompt(`Rename Sub-Item Group (L3):`, oldSubItem);
    if (newSubItem && newSubItem.trim() !== "" && newSubItem !== oldSubItem) {
      const newCatalog = catalog.map(i => (i.category === cat && i.sub_category === subCat && (i.sub_item_1 || "General") === oldSubItem) ? { ...i, sub_item_1: newSubItem } : i);
      setCatalog(newCatalog);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      
      const oldKey = cat + '||' + subCat + '||' + oldSubItem;
      const newKey = cat + '||' + subCat + '||' + newSubItem;
      setCollapsedState(prev => {
        const next = { ...prev };
        if (next[oldKey] !== undefined) {
          next[newKey] = next[oldKey];
          delete next[oldKey];
        }
        return next;
      });
      recordHistory(`Renamed L3 Group '${oldSubItem}' to '${newSubItem}'`, takeoffData, newCatalog, projectName, clientName);
    }
  };

  const duplicateSubItem1 = (cat: string, subCat: string, oldSubItem: string) => {
    const newSubItem = window.prompt(`Duplicate Sub-Item Group (L3) as:`, `${oldSubItem} Copy`);
    if (newSubItem && newSubItem.trim() !== "") {
      const itemsToDuplicate = catalog.filter(i => i.category === cat && i.sub_category === subCat && (i.sub_item_1 || "General") === oldSubItem);
      const newItems: Item[] = [];
      const newTakeoffData = { ...takeoffData };
      const newEntityData = { ...entityData };
      
      const oldItemGroupKey = `ITEMGROUP:${cat}|${subCat}|${oldSubItem}`;
      const newItemGroupKey = `ITEMGROUP:${cat}|${subCat}|${newSubItem}`;
      if (newEntityData[oldItemGroupKey]) {
          newEntityData[newItemGroupKey] = { ...newEntityData[oldItemGroupKey] };
      }
      
      itemsToDuplicate.forEach(item => {
        const newItemId = "ITM-" + Date.now() + Math.random().toString(36).substring(2, 9);
        newItems.push({ ...item, item_id: newItemId, sub_item_1: newSubItem });
        if (takeoffData[item.item_id]) {
          newTakeoffData[newItemId] = { ...takeoffData[item.item_id] };
        }
        
        // Copy material entity data
        const oldMatKey = `MATERIAL:${item.item_id}`;
        const newMatKey = `MATERIAL:${newItemId}`;
        if (newEntityData[oldMatKey]) {
            newEntityData[newMatKey] = { ...newEntityData[oldMatKey] };
        }
      });
      
      const newCatalog = [...catalog, ...newItems];
      setCatalog(newCatalog);
      setTakeoffData(newTakeoffData);
      setEntityData(newEntityData);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      recordHistory(`Duplicated L3 Group '${oldSubItem}' to '${newSubItem}'`, newTakeoffData, newCatalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, newEntityData);
    }
  };

  const duplicateMaterial = (itemId: string) => {
    const item = catalog.find(i => i.item_id === itemId);
    if (!item) return;
    
    const newName = window.prompt(`Duplicate Material as:`, `${item.item_name} Copy`);
    if (newName && newName.trim() !== "") {
      const newItemId = "ITM-" + Date.now() + Math.random().toString(36).substring(2, 9);
      const newItem = { ...item, item_id: newItemId, item_name: newName };
      const newCatalog = [...catalog, newItem];
      const newTakeoffData = { ...takeoffData };
      const newEntityData = { ...entityData };
      
      if (takeoffData[itemId]) {
        newTakeoffData[newItemId] = { ...takeoffData[itemId] };
      }
      
      const oldMatKey = `MATERIAL:${itemId}`;
      const newMatKey = `MATERIAL:${newItemId}`;
      if (newEntityData[oldMatKey]) {
          newEntityData[newMatKey] = { ...newEntityData[oldMatKey] };
      }
      
      setCatalog(newCatalog);
      setTakeoffData(newTakeoffData);
      setEntityData(newEntityData);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      recordHistory(`Duplicated Material '${item.item_name}' to '${newName}'`, newTakeoffData, newCatalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, newEntityData);
    }
  };

  const updateItemName = (itemId: string, newName: string) => {
    if (!newName || newName.trim() === "") return;
    const item = catalog.find(i => i.item_id === itemId);
    if (item && item.item_name !== newName) {
      const oldName = item.item_name;
      const newCatalog = catalog.map(i => i.item_id === itemId ? { ...i, item_name: newName } : i);
      setCatalog(newCatalog);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      recordHistory(`Renamed Item from '${oldName}' to '${newName}'`, takeoffData, newCatalog, projectName, clientName);
    }
  };

  const changeUOM = (itemId: string, val: string) => {
    if (val === '__NEW__') {
      const newUOM = window.prompt("Enter new Unit of Measure (UOM):");
      if (newUOM && newUOM.trim() !== "") {
        const upperUOM = newUOM.toUpperCase().trim();
        const newCatalog = catalog.map(i => i.item_id === itemId ? { ...i, uom: upperUOM } : i);
        setCatalog(newCatalog);
        localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
        recordHistory(`Created new UOM '${upperUOM}'`, takeoffData, newCatalog, projectName, clientName);
      }
    } else {
      const newCatalog = catalog.map(i => i.item_id === itemId ? { ...i, uom: val } : i);
      setCatalog(newCatalog);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      recordHistory(`Updated UOM to '${val}'`, takeoffData, newCatalog, projectName, clientName);
    }
  };

  const saveCurrentJob = async () => {
    if (!projectName) {
      alert("Please enter a Project Name before saving!");
      return;
    }
    // Force recalculate all formulas to ensure saved data is fresh
    const { newData: freshTakeoffData } = recalculateAllFormulas(customVariables, entityData, true);

    const newJob: Job = {
      id: currentJobId || Date.now().toString(),
      projectName,
      clientName,
      jobNotes,
      takeoffData: freshTakeoffData,
      history: actionHistory,
      lastSaved: new Date().toISOString(),
      customVariables,
      dynamicColumns,
      entityData,
      formulaTemplates,
      dataTables,
      catalog,
      defaultOveragePct
    };

    if (user) {
      try {
        const jobDocRef = doc(db, 'users', user.uid, 'jobs', currentJobId);
        await setDoc(jobDocRef, newJob, { merge: true });
        alert("Job saved successfully to cloud!");
      } catch (err: any) {
        console.error('Error saving to Firestore:', err.message);
        alert("Error saving job to cloud: " + err.message);
      }
    } else {
      const newSavedJobs = { ...savedJobs, [currentJobId]: newJob };
      setSavedJobs(newSavedJobs);
      localStorage.setItem('savedEstimatingJobs', JSON.stringify(newSavedJobs));
      alert("Job saved locally! Log in to sync with cloud.");
    }
    setLastAutoSaveTime(new Date().toLocaleString());
  };

  const saveAsTemplate = async () => {
    const templateName = window.prompt("Enter template name:");
    if (!templateName) return;
    
    const templateDesc = window.prompt("Enter template description (optional):") || "";
    const isGlobal = window.confirm("Save as Global Template? (Cancel for Personal)");

    // Force recalculate all formulas to ensure saved data is fresh
    const { newData: freshTakeoffData } = recalculateAllFormulas(customVariables, entityData, true);

    const newTemplate: ProjectTemplate = {
      id: "TPL-" + Date.now(),
      name: templateName,
      description: templateDesc,
      type: isGlobal ? 'global' : 'personal',
      catalog: catalog,
      takeoffData: freshTakeoffData,
      customVariables: customVariables,
      dynamicColumns: dynamicColumns,
      entityData: entityData,
      formulaTemplates: formulaTemplates,
      dataTables: dataTables,
      defaultOveragePct: defaultOveragePct,
      jobNotes: jobNotes,
      createdAt: new Date().toISOString()
    };

    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        const currentTemplates = userDoc.exists() ? (userDoc.data().projectTemplates || []) : [];
        await setDoc(userDocRef, {
          projectTemplates: [...currentTemplates, newTemplate],
          lastUpdated: serverTimestamp()
        }, { merge: true });
        alert("Template saved successfully to cloud!");
      } catch (err: any) {
        console.error('Error saving template to Firestore:', err.message);
        alert("Error saving template to cloud: " + err.message);
      }
    } else {
      const newTemplates = [...templates, newTemplate];
      setTemplates(newTemplates);
      localStorage.setItem('projectTemplates', JSON.stringify(newTemplates));
      alert("Template saved locally!");
    }
  };

  const createNewProject = () => {
    const newJobId = "JOB-" + Date.now();
    setCurrentJobId(newJobId);
    setProjectName(newProjectData.name);
    setClientName(newProjectData.client);
    
    if (newProjectData.templateId) {
      const tpl = templates.find(t => t.id === newProjectData.templateId);
      if (tpl) {
        setCatalog(tpl.catalog);
        setTakeoffData(tpl.takeoffData);
        setCustomVariables(tpl.customVariables);
        setDynamicColumns(tpl.dynamicColumns || []);
        setEntityData(tpl.entityData || {});
        setFormulaTemplates(tpl.formulaTemplates || []);
        if (tpl.defaultOveragePct !== undefined) {
          setDefaultOveragePct(tpl.defaultOveragePct);
          localStorage.setItem('defaultOveragePct', tpl.defaultOveragePct);
        }
        setJobNotes(tpl.jobNotes || "");
        setActionHistory([]);
        setHistoryIndex(0);
        setNewProjectModalOpen(false);
        return;
      }
    }
    
    // Blank project
    setTakeoffData({});
    setActionHistory([]);
    setHistoryIndex(0);
    setCustomVariables([]);
    setDynamicColumns([]);
    setEntityData({});
    setJobNotes("");
    setDefaultOveragePct("");
    localStorage.removeItem('defaultOveragePct');
    setNewProjectModalOpen(false);
  };

  const deleteTemplate = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this template?")) return;
    const newTemplates = templates.filter(t => t.id !== id);
    setTemplates(newTemplates);
    
    if (user) {
      try {
        const userDocRef = doc(db, 'users', user.uid);
        await setDoc(userDocRef, {
          projectTemplates: newTemplates,
          lastUpdated: serverTimestamp()
        }, { merge: true });
      } catch (error) {
        console.error("Error deleting template from Firestore:", error);
      }
    } else {
      localStorage.setItem('projectTemplates', JSON.stringify(newTemplates));
    }
  };

  const loadTemplate = (id: string) => {
    setNewProjectData({ name: '', client: '', description: '', templateId: id });
    setTemplateModalOpen(false);
    setNewProjectModalOpen(true);
  };

  const loadJobFromSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    if (!selectedId) {
      setNewProjectData({ name: '', client: '', description: '', templateId: '' });
      setNewProjectModalOpen(true);
      return;
    }
    const jobData = savedJobs[selectedId];
    if (jobData) {
      setCurrentJobId(selectedId);
      setTakeoffData(jobData.takeoffData || {});
      setActionHistory(jobData.history || []);
      setHistoryIndex(0);
      setProjectName(jobData.projectName || "");
      setClientName(jobData.clientName || "");
      setJobNotes(jobData.jobNotes || "");
      setCustomVariables(jobData.customVariables || []);
      setDynamicColumns(jobData.dynamicColumns || []);
      setEntityData(jobData.entityData || {});
      setFormulaTemplates(jobData.formulaTemplates || []);
      setTimeout(() => recordHistory("Loaded Job from Storage", jobData.takeoffData, catalog, jobData.projectName, jobData.clientName, jobData.customVariables || [], jobData.jobNotes || "", jobData.dynamicColumns || [], jobData.entityData || {}, jobData.formulaTemplates || []), 0);
    }
  };

  const performBOMExport = () => {
    // Force recalculate all formulas to ensure exported data is fresh
    const { newData: freshTakeoffData } = recalculateAllFormulas(customVariables, entityData, true);

    const projName = projectName || "Unnamed_Job";
    
    // Build headers based on options
    const headers = ["Category", "Sub-Category", "Sub-Item Group", "MATERIAL"];
    if (bomExportOptions.includeSpec) headers.push("Spec");
    headers.push("Take-off");
    if (bomExportOptions.includeOveragePct) headers.push("OVERAGE %");
    if (bomExportOptions.includeOrderQty) headers.push("Order");
    headers.push("Qty", "UOM");
    if (bomExportOptions.includeReference) headers.push("REFERENCE");
    headers.push("Rule / Note");

    let csvContent = headers.join(",") + "\n";
    let hasItems = false;

    for (const [itemId, data] of Object.entries(freshTakeoffData)) {
      // Respect 'In Scope' filter
      if (!bomExportOptions.onlyInScope || data.in_scope) {
        hasItems = true;
        const itemInfo = catalog.find(i => i.item_id === itemId);
        if (!itemInfo) continue;

        const escapeCSV = (text: string) => `"${(text || '').toString().replace(/"/g, '""')}"`;
        const fullNotes = itemInfo.calc_factor_instruction + (itemInfo.notes ? " | Note: " + itemInfo.notes : "");
        
        const row = [
          escapeCSV(itemInfo.category),
          escapeCSV(itemInfo.sub_category),
          escapeCSV(itemInfo.sub_item_1 || "General"),
          escapeCSV(itemInfo.item_name)
        ];
        
        if (bomExportOptions.includeSpec) row.push(escapeCSV(data.spec));
        row.push(escapeCSV(data.qty));
        if (bomExportOptions.includeOveragePct) row.push(escapeCSV(data.overage_pct));
        if (bomExportOptions.includeOrderQty) row.push(escapeCSV(data.order_qty));
        row.push(escapeCSV(data.measured_qty));
        row.push(escapeCSV(itemInfo.uom));
        if (bomExportOptions.includeReference) row.push(escapeCSV(data.evidence));
        row.push(escapeCSV(fullNotes));

        csvContent += row.join(",") + "\n";
      }
    }

    if (!hasItems) {
      alert("BOM is empty! Please check your filters and item scope.");
      return;
    }

    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `BOM_${projName.replace(/\s+/g, '_')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setBomExportModalOpen(false);
  };

  const exportBOM = () => {
    setBomExportModalOpen(true);
  };

  const exportJobJson = () => {
    // Force recalculate all formulas to ensure exported data is fresh
    const { newData: freshTakeoffData } = recalculateAllFormulas(customVariables, entityData, true);

    const projName = projectName || "Unnamed_Job";
    const fullJobData = {
      jobId: currentJobId,
      projectName: projName,
      clientName: clientName,
      jobNotes: jobNotes,
      defaultOveragePct: defaultOveragePct,
      exportDate: new Date().toISOString(),
      takeoffData: freshTakeoffData,
      historyLog: actionHistory,
      catalog: catalog,
      customVariables: customVariables,
      dynamicColumns: dynamicColumns,
      entityData: entityData
    };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(fullJobData, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `Estimating_Job_${projName.replace(/\s+/g, '_')}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const importJobJson = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const importedData = JSON.parse(e.target?.result as string);
        if (importedData.takeoffData) {
          setCurrentJobId(importedData.jobId || "JOB-" + Date.now());
          setTakeoffData(importedData.takeoffData);
          setActionHistory(importedData.historyLog || []);
          setHistoryIndex(0);
          if (importedData.catalog) {
            setCatalog(importedData.catalog);
            localStorage.setItem('userItemCatalog', JSON.stringify(importedData.catalog));
          }
          setProjectName(importedData.projectName || "");
          setClientName(importedData.clientName || "");
          setJobNotes(importedData.jobNotes || "");
          if (importedData.defaultOveragePct !== undefined) {
            setDefaultOveragePct(importedData.defaultOveragePct);
            localStorage.setItem('defaultOveragePct', importedData.defaultOveragePct);
          }
          setCustomVariables(importedData.customVariables || []);
          setDynamicColumns(importedData.dynamicColumns || []);
          setEntityData(importedData.entityData || {});
          
          setTimeout(() => recordHistory("Imported Job from JSON File", importedData.takeoffData, importedData.catalog || catalog, importedData.projectName, importedData.clientName, importedData.customVariables || [], importedData.jobNotes || "", importedData.dynamicColumns || [], importedData.entityData || {}), 0);
          alert("Job Imported Successfully!");
        }
      } catch (err) {
        alert("Error reading JSON file.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const exportCustomVariables = () => {
    const data = {
      type: 'customVariables',
      exportDate: new Date().toISOString(),
      customVariables: customVariables
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `custom_variables_${projectName.replace(/\s+/g, '_') || 'export'}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importCustomVariables = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target?.result as string);
        if (importedData.type === 'customVariables' && Array.isArray(importedData.customVariables)) {
          const newVars = importedData.customVariables;
          
          // Validate structure
          const isValid = newVars.every((v: any) => v.name && (v.formula !== undefined || v.value !== undefined));
          if (!isValid) {
            alert("Invalid custom variables format.");
            return;
          }

          if (window.confirm(`Import ${newVars.length} custom variables? This will merge them with existing variables.`)) {
            let updatedVars = [...customVariables];
            newVars.forEach((nv: any) => {
              const index = updatedVars.findIndex(v => v.name.toLowerCase() === nv.name.toLowerCase());
              if (index !== -1) {
                updatedVars[index] = { ...updatedVars[index], ...nv };
              } else {
                updatedVars.push({
                  id: nv.id || "CV-" + Date.now() + Math.random(),
                  ...nv
                });
              }
            });

            // Recalculate affected variables and items
            const { newData, hasChanges, newVars: finalVars } = recalculateAffectedItems([], updatedVars, entityData, takeoffData);
            
            setCustomVariables(finalVars);
            recordHistory(`Imported custom variables from JSON`, hasChanges ? newData : takeoffData, catalog, projectName, clientName, finalVars, jobNotes, dynamicColumns, entityData);
            alert("Custom variables imported successfully!");
          }
        } else {
          alert("Invalid JSON file. Please select a custom variables export file.");
        }
      } catch (err) {
        console.error("Import error:", err);
        alert("Error parsing JSON file.");
      }
    };
    reader.readAsText(file);
    // Reset input
    event.target.value = '';
  };

  const exportDataTables = () => {
    const data = {
      type: 'dataTables',
      exportDate: new Date().toISOString(),
      dataTables: dataTables
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `data_tables_${projectName.replace(/\s+/g, '_') || 'export'}_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const importDataTables = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedData = JSON.parse(e.target?.result as string);
        if (importedData.type === 'dataTables' && Array.isArray(importedData.dataTables)) {
          const newTables = importedData.dataTables;
          
          // Validate structure
          const isValid = newTables.every((dt: any) => dt.name && Array.isArray(dt.columns) && Array.isArray(dt.rows));
          if (!isValid) {
            alert("Invalid data tables format.");
            return;
          }

          if (window.confirm(`Import ${newTables.length} data tables? This will merge them with existing tables.`)) {
            let updatedTables = [...dataTables];
            newTables.forEach((nt: any) => {
              const index = updatedTables.findIndex(t => t.name.toLowerCase() === nt.name.toLowerCase());
              if (index !== -1) {
                updatedTables[index] = { ...updatedTables[index], ...nt };
              } else {
                updatedTables.push({
                  id: nt.id || "DT-" + Date.now() + Math.random(),
                  ...nt
                });
              }
            });

            setDataTables(updatedTables);
            localStorage.setItem('userDataTables', JSON.stringify(updatedTables));
            recordHistory(`Imported data tables from JSON`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, formulaTemplates, updatedTables);
            alert("Data tables imported successfully!");
          }
        } else {
          alert("Invalid file type or format.");
        }
      } catch (e) {
        alert("Error parsing JSON file.");
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const openQtyPanel = (itemId: string) => {
    const data = takeoffData[itemId] || {};
    const formula = data.custom_formula || DEFAULT_QTY_FORMULA;
    const mode = data.qty_mode || 'auto';
    const manQty = data.measured_qty || "";

    setQtyPanelItemId(itemId);
    setCustomFormula(formula);
    setQtyMode(mode);
    setManualQty(mode === 'manual' ? manQty : "");
    setQtyPanelOpen(true);
  };

  const closeQtyPanel = () => {
    const itemInfo = catalog.find(i => i.item_id === qtyPanelItemId);
    if (!itemInfo) return;

    setTakeoffData(prev => {
      const currentData = prev[qtyPanelItemId] || {};
      const currentFormula = currentData.custom_formula || DEFAULT_QTY_FORMULA;
      const currentMode = currentData.qty_mode || 'auto';

      if (currentFormula === customFormula && currentMode === qtyMode) {
        return prev;
      }

      const newData = { ...prev };
      const currentItem = newData[qtyPanelItemId] || {
        in_scope: false, spec: "", qty: "", measured_qty: "",
        overage_pct: "", order_qty: "", evidence: "",
        qty_mode: 'auto', custom_formula: DEFAULT_QTY_FORMULA
      };
      
      const updatedMode = qtyMode === 'guide' ? currentMode : qtyMode;
      const updatedItem = { ...currentItem, custom_formula: customFormula, qty_mode: updatedMode };
      newData[qtyPanelItemId] = updatedItem;
      
      setTimeout(() => recordHistory(`Autosaved Formula for ${itemInfo.item_name}`, newData, catalog, projectName, clientName), 0);
      return newData;
    });
    setQtyPanelOpen(false);
  };

  const saveQtyPanel = () => {
    const itemInfo = catalog.find(i => i.item_id === qtyPanelItemId);
    if (!itemInfo) return;

    setTakeoffData(prev => {
      const newData = { ...prev };
      const currentData = prev[qtyPanelItemId] || {};
      const currentMode = currentData.qty_mode || 'auto';
      const updatedMode = qtyMode === 'guide' ? currentMode : qtyMode;

      const currentItem = newData[qtyPanelItemId] || {
        in_scope: false, spec: "", qty: "", measured_qty: "",
        overage_pct: "", order_qty: "", evidence: "",
        qty_mode: 'auto', custom_formula: DEFAULT_QTY_FORMULA
      };

      const updatedItem = { ...currentItem, qty_mode: updatedMode };

      if (updatedMode === 'auto') {
        updatedItem.custom_formula = customFormula;
        const item = catalog.find(i => i.item_id === qtyPanelItemId);
        updatedItem.measured_qty = evaluateCustomFormula(
          customFormula,
          updatedItem.qty,
          updatedItem.overage_pct !== "" ? updatedItem.overage_pct : defaultOveragePct,
          updatedItem.order_qty,
          customVariables,
          resolveDynamicScope(item)
        ).toString();
        newData[qtyPanelItemId] = updatedItem;
        setTimeout(() => recordHistory(`Updated Auto Formula for ${itemInfo.item_name}`, newData, catalog, projectName, clientName), 0);
      } else {
        updatedItem.measured_qty = manualQty;
        newData[qtyPanelItemId] = updatedItem;
        setTimeout(() => recordHistory(`Set Manual QTY Override for ${itemInfo.item_name}`, newData, catalog, projectName, clientName), 0);
      }

      return newData;
    });
    setQtyPanelOpen(false);
  };

  const insertText = (text: string) => {
    if (formulaInputRef.current?.view) {
      const view = formulaInputRef.current.view;
      const selection = view.state.selection.main;
      view.dispatch({
        changes: {
          from: selection.from,
          to: selection.to,
          insert: text
        },
        selection: { anchor: selection.from + text.length }
      });
      view.focus();
    } else {
      setCustomFormula(prev => prev + text);
    }
  };

  const openItemModal = (
    mode: 'add' | 'edit', 
    itemId: string | null = null,
    prefillCategory?: string,
    prefillSubCategory?: string,
    prefillSubItem1?: string
  ) => {
    setItemModalMode(mode);
    setIsNewCategory(false);
    setIsNewSubCategory(false);
    setIsNewSubItem1(false);

    if (mode === 'edit' && itemId) {
      const item = catalog.find(i => i.item_id === itemId);
      if (item) {
        setEditingItemId(item.item_id);
        setModCategory(item.category);
        setModSubCategory(item.sub_category);
        setModSubItem1(item.sub_item_1 || "General");
        setModItemName(item.item_name);
        setModUOM(item.uom);
        setModRule(item.calc_factor_instruction);
        setModNotes(item.notes || "");
      }
    } else {
      setEditingItemId("");
      setModCategory(prefillCategory || getUniqueVals(catalog, 'category')[0] || "");
      setModSubCategory(prefillSubCategory || "");
      setModSubItem1(prefillSubItem1 || "");
      setModItemName("");
      setModUOM("");
      setModRule("");
      setModNotes("");
    }
    setItemModalOpen(true);
  };

  const saveItem = () => {
    const cat = modCategory.toUpperCase();
    const subCat = modSubCategory;
    const subItem1 = modSubItem1;
    const name = modItemName;
    const uom = modUOM;
    const rule = modRule;
    const notes = modNotes;

    if (!cat || !subCat || !subItem1 || !name) {
      alert("Hierarchy and Item Name are required!");
      return;
    }

    let newCatalog = [...catalog];
    if (editingItemId) {
      const itemIndex = newCatalog.findIndex(i => i.item_id === editingItemId);
      if (itemIndex > -1) {
        const oldName = newCatalog[itemIndex].item_name;
        newCatalog[itemIndex] = { item_id: editingItemId, category: cat, sub_category: subCat, sub_item_1: subItem1, item_name: name, uom: uom, calc_factor_instruction: rule, notes: notes };
        setTimeout(() => recordHistory(`Advanced Edit: ${oldName} -> ${name}`, takeoffData, newCatalog, projectName, clientName), 0);
      }
    } else {
      const newItem: Item = { item_id: "ITM-" + Date.now(), category: cat, sub_category: subCat, sub_item_1: subItem1, item_name: name, uom: uom, calc_factor_instruction: rule, notes: notes };
      newCatalog.push(newItem);
      setTimeout(() => recordHistory(`Added New Item: ${name}`, takeoffData, newCatalog, projectName, clientName), 0);
    }
    setCatalog(newCatalog);
    localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
    setItemModalOpen(false);
  };

  const deleteItem = () => {
    if (window.confirm("Permanently delete this item?")) {
      const itemName = catalog.find(i => i.item_id === editingItemId)?.item_name;
      const newCatalog = catalog.filter(item => item.item_id !== editingItemId);
      setCatalog(newCatalog);
      localStorage.setItem('userItemCatalog', JSON.stringify(newCatalog));
      
      setTakeoffData(prev => {
        const newData = { ...prev };
        delete newData[editingItemId];
        setTimeout(() => recordHistory(`Deleted Item: ${itemName}`, newData, newCatalog, projectName, clientName), 0);
        return newData;
      });
      setItemModalOpen(false);
    }
  };

  const restoreHistory = (index: number) => {
    if (window.confirm("Restore to this point? Current unsaved changes will be lost.")) {
      const record = actionHistory[index];
      setTakeoffData(record.dataState);
      if (record.catalogState) {
        setCatalog(record.catalogState);
        localStorage.setItem('userItemCatalog', JSON.stringify(record.catalogState));
      }
      setProjectName(record.projectName);
      setClientName(record.clientName);
      if (record.customVariables) setCustomVariables(record.customVariables);
      setHistoryIndex(index);
      setHistoryModalOpen(false);
    }
  };

  const treeData = useMemo(() => {
    const tree: Record<string, Record<string, Record<string, Item[]>>> = {};
    const filtered = catalog.filter(item => {
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return item.item_name.toLowerCase().includes(q) ||
             item.category.toLowerCase().includes(q) ||
             item.sub_category.toLowerCase().includes(q) ||
             (item.sub_item_1 || "general").toLowerCase().includes(q);
    });

    filtered.forEach(item => {
      const cat = item.category || "UNASSIGNED";
      const subCat = item.sub_category || "General";
      const subItem1 = item.sub_item_1 || "General";

      if (!tree[cat]) tree[cat] = {};
      if (!tree[cat][subCat]) tree[cat][subCat] = {};
      if (!tree[cat][subCat][subItem1]) tree[cat][subCat][subItem1] = [];

      tree[cat][subCat][subItem1].push(item);
    });
    return tree;
  }, [catalog, searchQuery]);

  const allUOMs = useMemo(() => getUniqueVals(catalog, 'uom'), [catalog]);

  if (!isMounted) return null;

  return (
    <div className="bg-slate-50 font-sans min-h-screen pb-10 text-slate-800">
      {/* Header */}
      <div className="bg-slate-800 text-white shadow-md border-b-4 border-emerald-500">
        <div className="max-w-[98%] mx-auto px-4 py-4 flex flex-col md:flex-row justify-between items-center gap-4 md:gap-0">
          <div className="text-center md:text-left">
            <h1 className="text-xl md:text-2xl font-bold flex items-center justify-center md:justify-start gap-2">
              <Home className="text-emerald-400" /> Pro Residential Estimator
            </h1>
            <Clock />
          </div>
          <div className="flex flex-wrap justify-center md:justify-end gap-3">
            {user ? (
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-emerald-400 hidden sm:inline">{user.email}</span>
                <button onClick={handleLogout} className="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded text-sm font-bold shadow-sm flex items-center gap-1">
                  Logout
                </button>
              </div>
            ) : (
              <button onClick={() => { setAuthMode('login'); setAuthModalOpen(true); }} className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded text-sm font-bold shadow-sm flex items-center gap-1">
                Login / Register
              </button>
            )}
            <button onClick={() => openItemModal('add')} className="bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded text-sm font-bold shadow-sm flex items-center gap-1">
              <Plus size={16} /> Add Item
            </button>
            <button onClick={exportBOM} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded text-sm font-bold shadow-sm flex items-center gap-1">
              <Download size={16} /> Export BOM (CSV)
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-white border-b border-slate-200 shadow-sm mb-6 sticky top-0 z-40">
        <div className="max-w-[98%] mx-auto px-4 py-3 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col items-stretch md:items-start gap-2 w-full md:w-1/4">
            <select 
              value={currentJobId} 
              onChange={loadJobFromSelect} 
              className="border border-slate-300 rounded p-2 text-sm font-bold text-slate-700 w-full focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none"
            >
              <option value="">-- Create New Job --</option>
              {Object.entries(savedJobs).map(([id, job]) => (
                <option key={id} value={id}>
                  {job.projectName || 'Untitled'} - {job.clientName || 'No Client'} ({new Date(job.lastSaved).toLocaleDateString()})
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <button onClick={saveCurrentJob} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded text-sm font-bold flex items-center gap-1">
                <Save size={16} /> Save
              </button>
              <button onClick={saveAsTemplate} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded text-sm font-bold flex items-center gap-1 whitespace-nowrap">
                <Save size={16} /> Save Template
              </button>
              <button onClick={() => setTemplateModalOpen(true)} className="bg-indigo-100 hover:bg-indigo-200 text-indigo-700 px-3 py-2 rounded text-sm font-bold flex items-center gap-1 whitespace-nowrap">
                <Copy size={16} /> Templates
              </button>
            </div>
          </div>
          <div className="w-full md:flex-1 flex flex-col md:flex-row items-center justify-center gap-2">
            <div className="relative w-full md:max-w-md">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search anything..." 
                className="w-full border border-slate-300 rounded-full pl-9 pr-4 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none"
              />
            </div>
            {selectedItems.size > 0 && (
              <div className="flex items-center justify-center gap-1 w-full md:w-auto mt-2 md:mt-0">
                <button 
                  onClick={() => setScopeForSelected(true)}
                  className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-3 py-2 rounded-l-full text-sm font-bold flex items-center gap-1 whitespace-nowrap transition-colors border border-emerald-200"
                  title="Mark selected items as In Scope"
                >
                  Include ({selectedItems.size})
                </button>
                <button 
                  onClick={() => setScopeForSelected(false)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-r-full text-sm font-bold flex items-center gap-1 whitespace-nowrap transition-colors border border-slate-200 border-l-0"
                  title="Mark selected items as Out of Scope"
                >
                  Exclude
                </button>
                <button 
                  onClick={() => setSelectedItems(new Set())}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-600 p-2 rounded-full text-sm font-bold transition-colors border border-slate-200 ml-1"
                  title="Clear selection"
                >
                  <X size={16} />
                </button>
              </div>
            )}
          </div>
          <div className="flex flex-col items-center md:items-end gap-2 w-full md:w-1/4 text-sm">
            <div className="flex flex-wrap justify-center md:justify-end gap-2 w-full">
              <button 
                onClick={undo} 
                disabled={!canUndo}
                className={`px-3 py-2 rounded font-bold flex items-center gap-1 transition ${canUndo ? 'text-slate-700 bg-slate-200 hover:bg-slate-300' : 'text-slate-400 bg-slate-100 cursor-not-allowed'}`}
                title="Undo"
              >
                <Undo2 size={16} />
              </button>
              <button 
                onClick={redo} 
                disabled={!canRedo}
                className={`px-3 py-2 rounded font-bold flex items-center gap-1 transition ${canRedo ? 'text-slate-700 bg-slate-200 hover:bg-slate-300' : 'text-slate-400 bg-slate-100 cursor-not-allowed'}`}
                title="Redo"
              >
                <Redo2 size={16} />
              </button>
              <button onClick={() => setHistoryModalOpen(true)} className="text-slate-700 bg-slate-200 hover:bg-slate-300 px-3 py-2 rounded font-bold flex items-center gap-1 transition">
                <History size={16} /> History
              </button>
              <button onClick={exportJobJson} className="bg-white border border-slate-300 hover:bg-slate-50 px-3 py-2 rounded font-bold flex items-center gap-1 transition">
                <Download size={16} /> Export
              </button>
              <input 
                type="file" 
                accept=".json" 
                className="hidden" 
                ref={fileInputRef} 
                onChange={importJobJson} 
              />
              <button onClick={() => fileInputRef.current?.click()} className="bg-white border border-slate-300 hover:bg-slate-50 px-3 py-2 rounded font-bold flex items-center gap-1 transition">
                <Upload size={16} /> Import
              </button>
            </div>
            <div className="flex flex-wrap justify-center md:justify-end gap-2 w-full">
              <button onClick={() => setClientModalOpen(true)} className="text-slate-700 bg-slate-200 hover:bg-slate-300 px-3 py-2 rounded font-bold flex items-center gap-1 transition">
                <Users size={16} /> Clients
              </button>
              <button onClick={() => setProjectModalOpen(true)} className="text-slate-700 bg-slate-200 hover:bg-slate-300 px-3 py-2 rounded font-bold flex items-center gap-1 transition">
                <Folder size={16} /> Projects
              </button>
              <button onClick={() => setDynamicColumnsModalOpen(true)} className="text-slate-700 bg-slate-200 hover:bg-slate-300 px-3 py-2 rounded font-bold flex items-center gap-1 transition">
                <Columns size={16} /> Dynamic Columns
              </button>
              <button onClick={() => setDataTableModalOpen(true)} className="text-slate-700 bg-slate-200 hover:bg-slate-300 px-3 py-2 rounded font-bold flex items-center gap-1 transition">
                <Table size={16} /> Data Tables
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Project Info */}
      <div className="max-w-[98%] mx-auto px-4 mb-6">
        <div className="bg-white p-5 rounded-lg shadow-sm border border-blue-100 flex flex-col gap-4">
          <div className="flex flex-col md:flex-row gap-4 md:gap-6">
            <div className="flex-1">
              <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Project Name</label>
              <input 
                type="text" 
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                onBlur={() => recordHistory('Updated Project')}
                className="w-full border border-slate-300 rounded p-2 text-lg font-bold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none"
              />
            </div>
            <div className="flex-1 relative">
              <div className="flex justify-between items-end mb-1">
                <label className="block text-xs font-bold text-blue-800 uppercase">Client</label>
                <button onClick={() => setClientModalOpen(true)} className="text-[10px] font-bold text-blue-600 hover:text-blue-800 uppercase">
                  Manage Clients
                </button>
              </div>
              <select
                value={clientName}
                onChange={(e) => {
                  setClientName(e.target.value);
                  setTimeout(() => recordHistory('Updated Client'), 0);
                }}
                className="w-full border border-slate-300 rounded p-2 text-lg font-bold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none appearance-none bg-white"
              >
                <option value="">-- Select Client --</option>
                {clients.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 pt-5 text-slate-500">
                <ChevronDown size={16} />
              </div>
            </div>
            <div className="w-full md:w-48">
              <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Default Overage %</label>
              <div className="relative">
                <input 
                  type="text" 
                  value={defaultOveragePct}
                  onChange={handleDefaultOverageChange}
                  onBlur={() => recordHistory('Updated Default Overage %')}
                  className="w-full border border-slate-300 rounded p-2 text-lg font-bold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none pr-8"
                />
                <span className="absolute right-3 top-2.5 text-slate-400 font-bold">%</span>
              </div>
            </div>
            <div className="w-full md:w-48 flex flex-col justify-end">
              <label className="flex items-center gap-2 cursor-pointer p-2 bg-slate-50 rounded border border-slate-200 hover:bg-slate-100 transition-colors">
                <input 
                  type="checkbox" 
                  checked={showPricingColumns}
                  onChange={(e) => setShowPricingColumns(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                />
                <span className="text-xs font-bold text-slate-700 uppercase">Show Pricing</span>
              </label>
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Overall Job Notes / Specifications</label>
            <textarea
              value={jobNotes}
              onChange={(e) => setJobNotes(e.target.value)}
              onBlur={() => recordHistory('Updated Job Notes')}
              placeholder="Enter any general notes, specifications, or details that apply to the entire project..."
              className="w-full border border-slate-300 rounded p-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none min-h-[80px]"
            />
          </div>
        </div>
      </div>

      {/* Main Table */}
      <div className="max-w-[98%] mx-auto px-4 mt-6 overflow-x-auto">
        {Object.keys(treeData).length === 0 ? (
          <div className="text-center py-10 text-slate-500 font-bold bg-white rounded shadow-sm border border-slate-200">
            No items match your search.
          </div>
        ) : (
          Object.entries(treeData).map(([category, subCategories]) => {
            const isCatCollapsed = searchQuery ? false : (collapsedState[category] || false);
            
            return (
              <div key={category} className="bg-white rounded-lg shadow-sm border border-slate-300 mb-8 overflow-hidden">
                <div 
                  className="bg-slate-800 px-4 py-3 flex justify-between items-center group cursor-pointer hover:bg-slate-700 transition" 
                  onClick={() => toggleCollapse(category)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-slate-400 text-xs font-bold w-4">
                      {isCatCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                    </span>
                    <h2 className="font-bold text-white text-lg tracking-wide uppercase">{category}</h2>
                  </div>
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={(e) => { e.stopPropagation(); openItemModal('add', null, category); }} 
                      className="text-slate-400 hover:text-white font-bold text-sm transition flex items-center gap-1"
                    >
                      <Plus size={14} /> Add new Sub-Category
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); duplicateCategory(category); }} 
                      className="text-slate-400 hover:text-white font-bold text-sm transition flex items-center gap-1"
                    >
                      <Copy size={14} /> Duplicate
                    </button>
                    <button 
                      onClick={(e) => { e.stopPropagation(); renameCategory(category); }} 
                      className="text-slate-400 hover:text-white font-bold text-sm transition flex items-center gap-1"
                    >
                      <Edit2 size={14} /> Edit
                    </button>
                  </div>
                </div>
                
                {!isCatCollapsed && (
                  <div className="overflow-x-auto pb-4 bg-white">
                    {/* Category Dynamic Fields */}
                    {dynamicColumns.filter(c => c.scope === 'category' && (!c.category || c.category === category)).length > 0 && (
                      <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap gap-4">
                        {dynamicColumns.filter(c => c.scope === 'category' && (!c.category || c.category === category)).map(col => {
                          const catKey = `CAT:${category}`;
                          const val = entityData[catKey]?.[col.key] ?? col.defaultValue ?? '';
                          return (
                            <div key={col.id} className="flex flex-col">
                              <label className="text-xs font-bold text-slate-500 uppercase mb-1">{col.name}</label>
                              <DebouncedInput 
                                type={col.dataType === 'number' ? 'number' : 'text'}
                                value={val}
                                onChange={(val) => {
                                  const newVal = col.dataType === 'number' ? parseFloat(String(val)) : String(val);
                                  setEntityData(prev => ({
                                    ...prev,
                                    [catKey]: { ...(prev[catKey] || {}), [col.key]: newVal }
                                  }));
                                }}
                              onBlur={() => handleEntityDataBlur(`Updated ${col.name} for ${category}`, [col.key])}
                              className="border border-slate-300 rounded px-2 py-1 text-sm focus:border-blue-500 outline-none"
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {Object.entries(subCategories).map(([subCategory, subItemsGroup]) => {
                    const subKey = category + '||' + subCategory;
                    const isSubCollapsed = searchQuery ? false : (collapsedState[subKey] || false);

                    return (
                      <div key={subKey}>
                        <div 
                          className="bg-blue-100 px-4 py-2 border-y border-blue-200 mt-4 mb-1 flex justify-between items-center group cursor-pointer hover:bg-blue-200 transition" 
                          onClick={() => toggleCollapse(subKey)}
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-blue-600 text-xs font-bold w-4">
                              {isSubCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                            </span>
                            <h3 className="font-bold text-blue-900 text-base uppercase">{subCategory}</h3>
                          </div>
                          <div className="flex items-center gap-4">
                            <button 
                              onClick={(e) => { e.stopPropagation(); openItemModal('add', null, category, subCategory); }} 
                              className="text-blue-500 hover:text-blue-800 font-bold text-sm transition flex items-center gap-1"
                            >
                              <Plus size={14} /> Add new Sub-Item Group (L3)
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); duplicateSubCategory(category, subCategory); }} 
                              className="text-blue-500 hover:text-blue-800 font-bold text-sm transition flex items-center gap-1"
                            >
                              <Copy size={14} /> Duplicate
                            </button>
                            <button 
                              onClick={(e) => { e.stopPropagation(); renameSubCategory(category, subCategory); }} 
                              className="text-blue-500 hover:text-blue-800 font-bold text-sm transition flex items-center gap-1"
                            >
                              <Edit2 size={14} /> Edit
                            </button>
                          </div>
                        </div>
                        
                        {!isSubCollapsed && (
                          <div>
                            {/* SubCategory Dynamic Fields */}
                            {dynamicColumns.filter(c => {
                              if (c.scope !== 'subcategory') return false;
                              if (c.category && c.category !== category) return false;
                              if (c.subCategory && (c.category !== category || c.subCategory !== subCategory)) return false;
                              return true;
                            }).length > 0 && (
                              <div className="px-4 py-2 bg-blue-50/30 border-b border-blue-100 flex flex-wrap gap-4">
                                {dynamicColumns.filter(c => {
                                  if (c.scope !== 'subcategory') return false;
                                  if (c.category && c.category !== category) return false;
                                  if (c.subCategory && (c.category !== category || c.subCategory !== subCategory)) return false;
                                  return true;
                                }).map(col => {
                                  const subCatKey = `SUBCAT:${category}|${subCategory}`;
                                  const val = entityData[subCatKey]?.[col.key] ?? col.defaultValue ?? '';
                                  return (
                                    <div key={col.id} className="flex flex-col">
                                      <label className="text-xs font-bold text-blue-600 uppercase mb-1">{col.name}</label>
                                      <DebouncedInput 
                                        type={col.dataType === 'number' ? 'number' : 'text'}
                                        value={val}
                                      onChange={(val) => {
                                        const newVal = col.dataType === 'number' ? parseFloat(String(val)) : String(val);
                                        setEntityData(prev => ({
                                          ...prev,
                                          [subCatKey]: { ...(prev[subCatKey] || {}), [col.key]: newVal }
                                        }));
                                      }}
                                      onBlur={() => handleEntityDataBlur(`Updated ${col.name} for ${subCategory}`, [col.key])}
                                      className="border border-blue-200 rounded px-2 py-1 text-sm focus:border-blue-500 outline-none"
                                    />
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {Object.entries(subItemsGroup).map(([subItem1, items]) => {
                            const sub1Key = subKey + '||' + subItem1;
                            const isSub1Collapsed = searchQuery ? false : (collapsedState[sub1Key] || false);

                            return (
                              <div key={sub1Key}>
                                <div 
                                  className="bg-emerald-50 px-6 py-1.5 border-b border-emerald-100 flex justify-between items-center group cursor-pointer hover:bg-emerald-100 transition" 
                                  onClick={() => toggleCollapse(sub1Key)}
                                >
                                  <div className="flex items-center gap-3">
                                    <span className="text-emerald-500 text-xs font-bold w-4">
                                      {isSub1Collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                                    </span>
                                    <h4 className="font-bold text-emerald-800 text-sm">Group: {subItem1}</h4>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); openItemModal('add', null, category, subCategory, subItem1); }} 
                                      className="text-emerald-500 hover:text-emerald-700 font-bold text-xs transition flex items-center gap-1"
                                    >
                                      <Plus size={12} /> Add new Material
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); duplicateSubItem1(category, subCategory, subItem1); }} 
                                      className="text-emerald-400 hover:text-emerald-700 font-bold text-xs transition flex items-center gap-1"
                                    >
                                      <Copy size={12} /> Duplicate
                                    </button>
                                    <button 
                                      onClick={(e) => { e.stopPropagation(); renameSubItem1(category, subCategory, subItem1); }} 
                                      className="text-emerald-400 hover:text-emerald-700 font-bold text-xs transition flex items-center gap-1"
                                    >
                                      <Edit2 size={12} /> Edit
                                    </button>
                                  </div>
                                </div>
                                
                                {!isSub1Collapsed && (
                                  <div>
                                    {/* ItemGroup Dynamic Fields */}
                                    {dynamicColumns.filter(c => {
                                      if (c.scope !== 'itemgroup') return false;
                                      if (c.category && c.category !== category) return false;
                                      if (c.subCategory && (c.category !== category || c.subCategory !== subCategory)) return false;
                                      if (c.itemGroup && (c.category !== category || c.subCategory !== subCategory || c.itemGroup !== subItem1)) return false;
                                      return true;
                                    }).length > 0 && (
                                      <div className="px-4 py-2 bg-emerald-50/30 border-b border-emerald-100 flex flex-wrap gap-4">
                                        {dynamicColumns.filter(c => {
                                          if (c.scope !== 'itemgroup') return false;
                                          if (c.category && c.category !== category) return false;
                                          if (c.subCategory && (c.category !== category || c.subCategory !== subCategory)) return false;
                                          if (c.itemGroup && (c.category !== category || c.subCategory !== subCategory || c.itemGroup !== subItem1)) return false;
                                          return true;
                                        }).map(col => {
                                          const itemGroupKey = `ITEMGROUP:${category}|${subCategory}|${subItem1}`;
                                          const val = entityData[itemGroupKey]?.[col.key] ?? col.defaultValue ?? '';
                                          return (
                                            <div key={col.id} className="flex flex-col">
                                              <label className="text-xs font-bold text-emerald-600 uppercase mb-1">{col.name}</label>
                                              <DebouncedInput 
                                                type={col.dataType === 'number' ? 'number' : 'text'}
                                                value={val}
                                                onChange={(val) => {
                                                  const newVal = col.dataType === 'number' ? parseFloat(String(val)) : String(val);
                                                  setEntityData(prev => ({
                                                    ...prev,
                                                    [itemGroupKey]: { ...(prev[itemGroupKey] || {}), [col.key]: newVal }
                                                  }));
                                                }}
                                                onBlur={() => handleEntityDataBlur(`Updated ${col.name} for ${subItem1}`, [col.key])}
                                                className="border border-emerald-200 rounded px-2 py-1 text-sm focus:border-emerald-500 outline-none"
                                              />
                                            </div>
                                          );
                                        })}
                                      </div>
                                    )}
                                  <table className="w-full text-left mb-4 max-w-full block md:table">
                                    <thead className="text-xs uppercase text-slate-700 bg-slate-100 border-b-2 border-slate-200 hidden md:table-header-group leading-tight">
                                      <tr>
                                        <th className="px-3 py-2 text-center min-w-[40px] whitespace-nowrap">
                                          <input 
                                            type="checkbox" 
                                            className="w-4 h-4 cursor-pointer accent-indigo-600"
                                            checked={items.length > 0 && items.every(item => selectedItems.has(item.item_id))}
                                            onChange={(e) => handleSelectAll(items.map(i => i.item_id), e.target.checked)}
                                            title="Select all in group"
                                          />
                                        </th>
                                        <th className="px-3 py-2 text-center min-w-[60px] whitespace-nowrap">SCOPE<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(in/out)</span></th>
                                        <th 
                                          className="px-3 py-2 min-w-[200px] font-bold whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors"
                                          onClick={() => handleSort('item_name')}
                                        >
                                          <div className="flex items-center gap-1">
                                            <span>MATERIAL</span>
                                            {sortConfig.key === 'item_name' && (
                                              sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                            )}
                                          </div>
                                          <span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(name)</span>
                                        </th>
                                        {dynamicColumns.filter(c => {
                                          if (c.scope !== 'material') return false;
                                          if (c.category && c.category !== category) return false;
                                          if (c.subCategory && (c.category !== category || c.subCategory !== subCategory)) return false;
                                          if (c.itemGroup && (c.category !== category || c.subCategory !== subCategory || c.itemGroup !== subItem1)) return false;
                                          return true;
                                        }).map(col => (
                                          <th 
                                            key={col.id} 
                                            className="px-3 py-2 min-w-[100px] font-bold whitespace-nowrap uppercase cursor-pointer hover:bg-slate-200 transition-colors"
                                            onClick={() => handleSort(col.key)}
                                          >
                                            <div className="flex items-center gap-1">
                                              <span>{col.name}</span>
                                              {sortConfig.key === col.key && (
                                                sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                              )}
                                            </div>
                                            <span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">({col.unit || 'custom'})</span>
                                          </th>
                                        ))}
                                        <th 
                                          className="px-3 py-2 min-w-[120px] font-bold whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors"
                                          onClick={() => handleSort('spec')}
                                        >
                                          <div className="flex items-center gap-1">
                                            <span>SPEC</span>
                                            {sortConfig.key === 'spec' && (
                                              sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                            )}
                                          </div>
                                          <span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(details)</span>
                                        </th>
                                        <th 
                                          className="px-3 py-2 min-w-[100px] font-bold text-emerald-700 whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors"
                                          onClick={() => handleSort('measured_qty')}
                                        >
                                          <div className="flex items-center gap-1">
                                            <span>TAKE-OFF</span>
                                            {sortConfig.key === 'measured_qty' && (
                                              sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                            )}
                                          </div>
                                          <span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(measured)</span>
                                        </th>
                                        <th 
                                          className="px-3 py-2 min-w-[100px] text-center font-bold whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors"
                                          onClick={() => handleSort('overage_pct')}
                                        >
                                          <div className="flex items-center justify-center gap-1">
                                            <span>OVERAGE %</span>
                                            {sortConfig.key === 'overage_pct' && (
                                              sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                            )}
                                          </div>
                                          <span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(waste factor)</span>
                                        </th>
                                        <th 
                                          className="px-3 py-2 min-w-[100px] text-center font-bold text-emerald-700 whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors"
                                          onClick={() => handleSort('order_qty')}
                                        >
                                          <div className="flex items-center justify-center gap-1">
                                            <span>ORDER</span>
                                            {sortConfig.key === 'order_qty' && (
                                              sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                            )}
                                          </div>
                                          <span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(pkg/divisor)</span>
                                        </th>
                                        <th 
                                          className="px-3 py-2 min-w-[100px] text-center font-bold text-blue-700 whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors"
                                          onClick={() => handleSort('qty')}
                                        >
                                          <div className="flex items-center justify-center gap-1">
                                            <span>QTY</span>
                                            {sortConfig.key === 'qty' && (
                                              sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                            )}
                                          </div>
                                          <span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(final to buy)</span>
                                        </th>
                                        {showPricingColumns && (
                                          <>
                                            <th 
                                              className="px-3 py-2 min-w-[100px] text-center font-bold whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors"
                                              onClick={() => handleSort('unit_price')}
                                            >
                                              <div className="flex items-center justify-center gap-1">
                                                <span>UNIT PRICE</span>
                                                {sortConfig.key === 'unit_price' && (
                                                  sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                                )}
                                              </div>
                                              <span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(cost per unit)</span>
                                            </th>
                                            <th className="px-3 py-2 min-w-[120px] font-bold whitespace-nowrap text-right">TOTAL PRICE<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(qty * price)</span></th>
                                          </>
                                        )}
                                        <th 
                                          className="px-3 py-2 text-center min-w-[90px] whitespace-nowrap cursor-pointer hover:bg-slate-200 transition-colors"
                                          onClick={() => handleSort('uom')}
                                        >
                                          <div className="flex items-center justify-center gap-1">
                                            <span>UOM</span>
                                            {sortConfig.key === 'uom' && (
                                              sortConfig.direction === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                                            )}
                                          </div>
                                          <span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(unit)</span>
                                        </th>
                                        <th className="px-3 py-2 min-w-[150px] font-bold whitespace-nowrap">REFERENCE<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(page/detail)</span></th>
                                        <th className="px-3 py-2 min-w-[150px] font-bold whitespace-nowrap">RULE / NOTE<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(logic)</span></th>
                                      </tr>
                                    </thead>
                                    <tbody className="block md:table-row-group">
                                      {(() => {
                                        let sortedItems = [...items];
                                        if (sortConfig.key && sortConfig.direction) {
                                          sortedItems.sort((a, b) => {
                                            let valA: any = '';
                                            let valB: any = '';

                                            if (['item_name', 'uom'].includes(sortConfig.key)) {
                                              valA = a[sortConfig.key as keyof Item] || '';
                                              valB = b[sortConfig.key as keyof Item] || '';
                                            } else if (['spec', 'measured_qty', 'overage_pct', 'order_qty', 'qty', 'unit_price'].includes(sortConfig.key)) {
                                              valA = takeoffData[a.item_id]?.[sortConfig.key as keyof TakeoffItem] || '';
                                              valB = takeoffData[b.item_id]?.[sortConfig.key as keyof TakeoffItem] || '';
                                            } else {
                                              // Dynamic column
                                              const matKeyA = `MATERIAL:${a.item_id}`;
                                              const matKeyB = `MATERIAL:${b.item_id}`;
                                              const col = dynamicColumns.find(c => c.key === sortConfig.key);
                                              valA = entityData[matKeyA]?.[sortConfig.key] ?? col?.defaultValue ?? '';
                                              valB = entityData[matKeyB]?.[sortConfig.key] ?? col?.defaultValue ?? '';
                                            }

                                            if (typeof valA === 'string') valA = valA.toLowerCase();
                                            if (typeof valB === 'string') valB = valB.toLowerCase();

                                            if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
                                            if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
                                            return 0;
                                          });
                                        }
                                        return sortedItems.map(item => {
                                          const rowData = takeoffData[item.item_id] || { in_scope: false, spec: "", qty: "", measured_qty: "", overage_pct: "", order_qty: "", evidence: "", qty_mode: "auto" };
                                        const isChecked = rowData.in_scope;
                                        const isDisabled = !isChecked;
                                        const rowBg = isChecked ? "bg-emerald-50/40" : "hover:bg-slate-50";

                                        const isError = typeof rowData.measured_qty === 'string' && rowData.measured_qty.startsWith('ERR');
                                        const displayQty = isError ? 'ERR' : (rowData.measured_qty || '');
                                        const qtyTooltip = isError ? rowData.measured_qty : "Click to config formula or override";

                                        const qtyBgClass = isError
                                          ? "border-red-400 bg-red-50 text-red-900 focus:border-red-600"
                                          : rowData.qty_mode === 'manual' 
                                            ? "border-amber-400 bg-amber-50 text-amber-900 focus:border-amber-600" 
                                            : "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100 focus:border-blue-500";

                                        return (
                                          <tr key={item.item_id} className={`${rowBg} border-b border-slate-200 group flex flex-col md:table-row p-3 md:p-0 gap-2 md:gap-0 relative`}>
                                            <td className="px-2 py-1 md:py-2 flex items-center justify-between md:table-cell md:text-center border-b md:border-b-0 border-slate-200/50 md:border-r">
                                              <span className="md:hidden text-xs font-bold text-slate-500 uppercase">Select</span>
                                              <input 
                                                type="checkbox" 
                                                className="w-4 h-4 cursor-pointer accent-indigo-600" 
                                                checked={selectedItems.has(item.item_id)} 
                                                onChange={(e) => handleSelectItem(item.item_id, e.target.checked)}
                                              />
                                            </td>
                                            <td className="px-2 py-1 md:py-2 flex items-center justify-between md:table-cell md:text-center border-b md:border-b-0 border-slate-200/50">
                                              <span className="md:hidden text-xs font-bold text-slate-500 uppercase">In Scope</span>
                                              <input 
                                                type="checkbox" 
                                                className="w-5 h-5 cursor-pointer accent-emerald-600" 
                                                checked={isChecked} 
                                                onChange={(e) => {
                                                  const newValue = e.target.checked;
                                                  if (selectedItems.has(item.item_id) && selectedItems.size > 1) {
                                                    setScopeForSelected(newValue);
                                                  } else {
                                                    updateTakeoffData(item.item_id, 'in_scope', newValue, item.calc_factor_instruction, item.item_name);
                                                  }
                                                }}
                                              />
                                            </td>
                                            <td className="px-2 py-1 md:py-2 md:pl-4 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                              <span className="md:hidden text-xs font-bold text-slate-500 uppercase mb-1">Material Name</span>
                                              <div className="flex items-center justify-between w-full">
                                                <input 
                                                  type="text" 
                                                  className="font-bold text-slate-800 text-[13px] bg-transparent border border-slate-200 md:border-transparent hover:border-slate-300 focus:border-emerald-500 focus:bg-white rounded px-2 md:px-1 py-1 md:py-0 w-full outline-none transition-colors" 
                                                  defaultValue={item.item_name} 
                                                  onBlur={(e) => updateItemName(item.item_id, e.target.value)} 
                                                  onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                                />
                                                <div className="flex items-center">
                                                  <button onClick={() => duplicateMaterial(item.item_id)} className="text-slate-400 hover:text-emerald-600 px-1" title="Duplicate Material">
                                                    <Copy size={14} />
                                                  </button>
                                                  <button onClick={() => openItemModal('edit', item.item_id)} className="text-slate-400 hover:text-blue-600 px-1" title="Advanced Edit">
                                                    <Edit2 size={14} />
                                                  </button>
                                                </div>
                                              </div>
                                            </td>
                                            {dynamicColumns.filter(c => {
                                              if (c.scope !== 'material') return false;
                                              if (c.category && c.category !== category) return false;
                                              if (c.subCategory && (c.category !== category || c.subCategory !== subCategory)) return false;
                                              if (c.itemGroup && (c.category !== category || c.subCategory !== subCategory || c.itemGroup !== subItem1)) return false;
                                              return true;
                                            }).map(col => {
                                              const matKey = `MATERIAL:${item.item_id}`;
                                              const val = entityData[matKey]?.[col.key] ?? col.defaultValue ?? '';
                                              return (
                                                <td key={col.id} className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                                  <span className="md:hidden text-xs font-bold text-slate-500 uppercase mb-1">{col.name}</span>
                                                  <DebouncedInput 
                                                    type={col.dataType === 'number' ? 'number' : 'text'}
                                                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-medium text-slate-700 transition-colors focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400" 
                                                    value={val}
                                                    disabled={isDisabled}
                                                    onChange={(val) => {
                                                      const newVal = col.dataType === 'number' ? parseFloat(String(val)) : String(val);
                                                      setEntityData(prev => ({
                                                        ...prev,
                                                        [matKey]: { ...(prev[matKey] || {}), [col.key]: newVal }
                                                      }));
                                                    }}
                                                    onBlur={() => handleEntityDataBlur(`Updated ${col.name} for ${item.item_name}`, [col.key])}
                                                  />
                                                </td>
                                              );
                                            })}
                                            <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                              <span className="md:hidden text-xs font-bold text-slate-500 uppercase mb-1">Spec (Details)</span>
                                              <DebouncedInput 
                                                type="text" 
                                                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-medium text-slate-700 transition-colors focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400" 
                                                placeholder="..." 
                                                value={rowData.spec || ""} 
                                                disabled={isDisabled} 
                                                onChange={(val) => updateTakeoffData(item.item_id, 'spec', String(val), item.calc_factor_instruction, item.item_name)} 
                                                onBlur={() => recordHistory(`Updated spec for ${item.item_name}`)}
                                                onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                              />
                                            </td>
                                            <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                              <span className="md:hidden text-xs font-bold text-emerald-700 uppercase mb-1">Take-off (Measured)</span>
                                              <DebouncedInput 
                                                type="text" 
                                                className="w-full border border-emerald-300 bg-emerald-50 rounded px-2 py-1.5 text-sm font-bold text-emerald-800 transition-colors focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400" 
                                                placeholder="0" 
                                                value={rowData.qty || ""} 
                                                disabled={isDisabled} 
                                                onChange={(val) => updateTakeoffData(item.item_id, 'qty', String(val), item.calc_factor_instruction, item.item_name)} 
                                                onBlur={() => recordHistory(`Updated qty for ${item.item_name}`)}
                                                onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                              />
                                            </td>
                                            <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                              <span className="md:hidden text-xs font-bold text-slate-500 uppercase mb-1">Overage %</span>
                                              <div className="relative w-full">
                                                <DebouncedInput 
                                                  type="text" 
                                                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-medium text-slate-700 transition-colors focus:border-emerald-500 pr-5 md:text-center disabled:bg-slate-100 disabled:text-slate-400" 
                                                  placeholder={defaultOveragePct || "0"} 
                                                  value={rowData.overage_pct || ""} 
                                                  disabled={isDisabled} 
                                                  onChange={(val) => updateTakeoffData(item.item_id, 'overage_pct', String(val), item.calc_factor_instruction, item.item_name)} 
                                                  onBlur={() => recordHistory(`Updated overage for ${item.item_name}`)}
                                                  onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                                />
                                                <span className="absolute right-2 top-1.5 text-xs text-slate-400 font-bold">%</span>
                                              </div>
                                            </td>
                                            <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                              <span className="md:hidden text-xs font-bold text-emerald-700 uppercase mb-1">Order (Pkg/Divisor)</span>
                                              <DebouncedInput 
                                                type="text" 
                                                className="w-full border-2 border-emerald-500 bg-emerald-100 font-bold text-emerald-900 rounded px-2 py-1 text-sm md:text-center focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-300" 
                                                placeholder="0" 
                                                value={rowData.order_qty || ""} 
                                                disabled={isDisabled} 
                                                onChange={(val) => updateTakeoffData(item.item_id, 'order_qty', String(val), item.calc_factor_instruction, item.item_name)} 
                                                onBlur={() => recordHistory(`Updated order qty for ${item.item_name}`)}
                                                onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                              />
                                            </td>
                                            <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                              <span className="md:hidden text-xs font-bold text-blue-700 uppercase mb-1">QTY (Final to buy)</span>
                                              <div 
                                                className="relative cursor-pointer w-full" 
                                                onClick={() => { if(isChecked) openQtyPanel(item.item_id); }} 
                                                title={qtyTooltip}
                                              >
                                                {rowData.qty_mode === 'manual' ? (
                                                  <Hand size={12} className="absolute left-2 top-2 text-amber-600" />
                                                ) : (
                                                  <Calculator size={12} className={`absolute left-1 top-2 ${isError ? 'text-red-600' : 'text-emerald-600'}`} />
                                                )}
                                                <input 
                                                  type="text" 
                                                  readOnly 
                                                  className={`w-full border font-bold rounded px-2 py-1.5 text-sm md:text-center transition-colors outline-none cursor-pointer ${qtyBgClass} disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-300 disabled:cursor-not-allowed`} 
                                                  placeholder="0" 
                                                  value={displayQty} 
                                                  disabled={isDisabled}
                                                />
                                                {isError && (
                                                  <div className="md:hidden text-[10px] text-red-600 mt-1 leading-tight">
                                                    {rowData.measured_qty}
                                                  </div>
                                                )}
                                              </div>
                                            </td>
                                            {showPricingColumns && (
                                              <>
                                                <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                                  <span className="md:hidden text-xs font-bold text-slate-500 uppercase mb-1">Unit Price</span>
                                                  <DebouncedInput 
                                                    type="text" 
                                                    className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-medium text-slate-700 transition-colors focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400" 
                                                    placeholder="0.00" 
                                                    value={rowData.unit_price || ""} 
                                                    disabled={isDisabled} 
                                                    onChange={(val) => updateTakeoffData(item.item_id, 'unit_price', String(val), item.calc_factor_instruction, item.item_name)} 
                                                    onBlur={() => recordHistory(`Updated unit price for ${item.item_name}`)}
                                                    onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                                  />
                                                </td>
                                                <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                                  <span className="md:hidden text-xs font-bold text-slate-500 uppercase mb-1">Total Price</span>
                                                  <div className="w-full border border-slate-200 bg-slate-50 rounded px-2 py-1.5 text-sm font-bold text-slate-700 text-right">
                                                    {(() => {
                                                      const up = parseFloat(rowData.unit_price || "0") || 0;
                                                      const q = parseFloat(String(displayQty)) || 0;
                                                      return (up * q).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
                                                    })()}
                                                  </div>
                                                </td>
                                              </>
                                            )}
                                            <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                              <span className="md:hidden text-xs font-bold text-slate-500 uppercase mb-1">UOM</span>
                                              <select 
                                                className="w-full bg-slate-50 md:bg-transparent hover:bg-slate-100 border border-slate-200 md:border-transparent hover:border-slate-300 focus:border-emerald-500 rounded outline-none cursor-pointer p-1.5 md:p-1 md:text-center transition-colors disabled:cursor-not-allowed text-sm font-bold text-slate-600 uppercase" 
                                                value={item.uom}
                                                onChange={(e) => changeUOM(item.item_id, e.target.value)} 
                                                disabled={isDisabled}
                                              >
                                                {allUOMs.map(u => (
                                                  <option key={u} value={u}>{u}</option>
                                                ))}
                                                <option value="__NEW__" className="font-bold text-blue-600 bg-blue-50">+ New...</option>
                                              </select>
                                            </td>
                                            <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell border-b md:border-b-0 border-slate-200/50">
                                              <span className="md:hidden text-xs font-bold text-slate-500 uppercase mb-1">Reference</span>
                                              <DebouncedInput 
                                                type="text" 
                                                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-medium text-slate-700 transition-colors focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400" 
                                                placeholder="Ref..." 
                                                value={rowData.evidence || ""} 
                                                disabled={isDisabled} 
                                                onChange={(val) => updateTakeoffData(item.item_id, 'evidence', String(val), item.calc_factor_instruction, item.item_name)} 
                                                onBlur={() => recordHistory(`Updated evidence for ${item.item_name}`)}
                                                onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                              />
                                            </td>
                                            <td className="px-2 py-1 md:py-2 flex flex-col md:table-cell text-xs text-slate-700 leading-tight md:border-l md:border-slate-100 md:pl-3">
                                              <span className="md:hidden text-xs font-bold text-slate-500 uppercase mb-1">Rule / Note</span>
                                              <div>
                                                <span className="font-bold text-blue-700">{item.calc_factor_instruction}</span>
                                                {item.notes && <><br/><span className="text-slate-500 italic">{item.notes}</span></>}
                                              </div>
                                            </td>
                                          </tr>
                                        );
                                      })
                                    })()}
                                  </tbody>
                                  </table>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Client Management Modal */}
      {clientModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-[60]">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl p-6 border-t-4 border-blue-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Manage Clients</h2>
              <button onClick={() => { setClientModalOpen(false); setEditingClient(null); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            
            <div className="mb-6">
              <h3 className="text-sm font-bold text-slate-700 mb-2">{editingClient ? 'Edit Client' : 'Add New Client'}</h3>
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const name = (form.elements.namedItem('clientName') as HTMLInputElement).value.trim();
                  const email = (form.elements.namedItem('clientEmail') as HTMLInputElement).value.trim();
                  const phone = (form.elements.namedItem('clientPhone') as HTMLInputElement).value.trim();
                  const address = (form.elements.namedItem('clientAddress') as HTMLInputElement).value.trim();
                  const notes = (form.elements.namedItem('clientNotes') as HTMLTextAreaElement).value.trim();
                  
                  if (!name) {
                    alert("Client Name is required.");
                    return;
                  }
                  
                  let newClients = [...clients];
                  if (editingClient) {
                    newClients = newClients.map(c => c.id === editingClient.id ? { ...c, name, email, phone, address, notes } : c);
                    // Update clientName if it was the one being edited
                    if (clientName === editingClient.name) {
                      setClientName(name);
                    }
                  } else {
                    if (newClients.some(c => c.name.toLowerCase() === name.toLowerCase())) {
                      alert("A client with this name already exists.");
                      return;
                    }
                    newClients.push({
                      id: "CLI-" + Date.now(),
                      name,
                      email,
                      phone,
                      address,
                      notes
                    });
                  }
                  
                  setClients(newClients);
                  localStorage.setItem('userClients', JSON.stringify(newClients));
                  
                  form.reset();
                  setEditingClient(null);
                }}
                className="bg-slate-50 p-4 rounded border border-slate-200 flex flex-col gap-3"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Client Name *</label>
                    <input name="clientName" type="text" required defaultValue={editingClient?.name || ""} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:border-blue-500 outline-none" placeholder="e.g. Acme Corp" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Email</label>
                    <input name="clientEmail" type="email" defaultValue={editingClient?.email || ""} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:border-blue-500 outline-none" placeholder="e.g. contact@acme.com" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Phone</label>
                    <input name="clientPhone" type="text" defaultValue={editingClient?.phone || ""} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:border-blue-500 outline-none" placeholder="e.g. (555) 123-4567" />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Address</label>
                    <input name="clientAddress" type="text" defaultValue={editingClient?.address || ""} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:border-blue-500 outline-none" placeholder="e.g. 123 Main St, City, ST" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Notes</label>
                  <textarea name="clientNotes" defaultValue={editingClient?.notes || ""} className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm focus:border-blue-500 outline-none min-h-[60px]" placeholder="Any additional notes about this client..."></textarea>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  {editingClient && (
                    <button type="button" onClick={() => setEditingClient(null)} className="px-3 py-1.5 text-sm font-bold text-slate-600 hover:bg-slate-200 rounded transition">Cancel</button>
                  )}
                  <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-1.5 rounded text-sm font-bold transition">
                    {editingClient ? 'Save Changes' : 'Add Client'}
                  </button>
                </div>
              </form>
            </div>
            
            <div>
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold text-slate-700">Existing Clients</h3>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(clients, null, 2));
                      const downloadAnchorNode = document.createElement('a');
                      downloadAnchorNode.setAttribute("href", dataStr);
                      downloadAnchorNode.setAttribute("download", "clients_export.json");
                      document.body.appendChild(downloadAnchorNode);
                      downloadAnchorNode.click();
                      downloadAnchorNode.remove();
                    }}
                    className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded font-bold transition flex items-center gap-1"
                  >
                    <Download size={14} /> Export JSON
                  </button>
                  <label className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 py-1 rounded font-bold transition flex items-center gap-1 cursor-pointer">
                    <Upload size={14} /> Import JSON
                    <input 
                      type="file" 
                      accept=".json" 
                      className="hidden" 
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          try {
                            const importedClients = JSON.parse(event.target?.result as string);
                            if (Array.isArray(importedClients)) {
                              const isValid = importedClients.every(c => c.id && c.name);
                              if (isValid) {
                                setClients(importedClients);
                                localStorage.setItem('userClients', JSON.stringify(importedClients));
                                alert(`Successfully imported ${importedClients.length} clients.`);
                              } else {
                                alert("Invalid client data format. Missing required fields.");
                              }
                            } else {
                              alert("Invalid JSON format. Expected an array of clients.");
                            }
                          } catch (err) {
                            alert("Error parsing JSON file.");
                          }
                        };
                        reader.readAsText(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto border rounded bg-white">
                {clients.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-400 italic">No clients defined.</div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="p-2 border-b font-bold text-slate-600">Name</th>
                        <th className="p-2 border-b font-bold text-slate-600">Contact</th>
                        <th className="p-2 border-b font-bold text-slate-600 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clients.map(c => (
                        <tr key={c.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="p-2 font-bold">{c.name}</td>
                          <td className="p-2 text-xs text-slate-500">
                            {c.email && <div>{c.email}</div>}
                            {c.phone && <div>{c.phone}</div>}
                          </td>
                          <td className="p-2 text-right">
                            <button 
                              onClick={() => setEditingClient(c)}
                              className="text-blue-600 hover:text-blue-800 text-xs font-bold mr-3"
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => {
                                if (window.confirm(`Delete client ${c.name}?`)) {
                                  const newClients = clients.filter(col => col.id !== c.id);
                                  setClients(newClients);
                                  localStorage.setItem('userClients', JSON.stringify(newClients));
                                  if (editingClient?.id === c.id) setEditingClient(null);
                                  if (clientName === c.name) setClientName("");
                                }
                              }}
                              className="text-red-600 hover:text-red-800 text-xs font-bold"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Project Management Modal */}
      {projectModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-[60]">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-4xl p-6 border-t-4 border-emerald-500 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Manage Projects</h2>
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => {
                    setProjectModalOpen(false);
                    setNewProjectData({ name: '', client: '', description: '', templateId: '' });
                    setNewProjectModalOpen(true);
                  }} 
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-sm font-bold flex items-center gap-1"
                >
                  <Plus size={16} /> New Project
                </button>
                <button onClick={() => { setProjectModalOpen(false); setEditingProject(null); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
              </div>
            </div>
            
            <div className="overflow-y-auto flex-1 border rounded bg-white">
              {Object.keys(savedJobs).length === 0 ? (
                <div className="p-8 text-center text-slate-500 italic">No saved projects found.</div>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 sticky top-0 shadow-sm">
                    <tr>
                      <th className="p-3 border-b font-bold text-slate-600">Project Name</th>
                      <th className="p-3 border-b font-bold text-slate-600">Client</th>
                      <th className="p-3 border-b font-bold text-slate-600">Last Saved</th>
                      <th className="p-3 border-b font-bold text-slate-600">Notes</th>
                      <th className="p-3 border-b font-bold text-slate-600 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(savedJobs).sort((a, b) => new Date(b[1].lastSaved).getTime() - new Date(a[1].lastSaved).getTime()).map(([id, job]) => (
                      <tr key={id} className="border-b last:border-0 hover:bg-slate-50">
                        {editingProject === id ? (
                          <td colSpan={5} className="p-4 bg-emerald-50/50">
                            <form 
                              onSubmit={(e) => {
                                e.preventDefault();
                                const formData = new FormData(e.currentTarget);
                                const newName = formData.get('projectName') as string;
                                const newClient = formData.get('clientName') as string;
                                const newNotes = formData.get('jobNotes') as string;
                                
                                const updatedJobs = { ...savedJobs };
                                updatedJobs[id] = {
                                  ...updatedJobs[id],
                                  projectName: newName,
                                  clientName: newClient,
                                  jobNotes: newNotes
                                };
                                
                                setSavedJobs(updatedJobs);
                                localStorage.setItem('savedEstimatingJobs', JSON.stringify(updatedJobs));
                                
                                if (currentJobId === id) {
                                  setProjectName(newName);
                                  setClientName(newClient);
                                  setJobNotes(newNotes);
                                }
                                
                                setEditingProject(null);
                              }}
                              className="flex flex-col gap-3"
                            >
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div>
                                  <label className="block text-xs font-bold text-slate-600 mb-1">Project Name</label>
                                  <input name="projectName" defaultValue={job.projectName} className="w-full border p-2 rounded text-sm" required />
                                </div>
                                <div>
                                  <label className="block text-xs font-bold text-slate-600 mb-1">Client</label>
                                  <select name="clientName" defaultValue={job.clientName} className="w-full border p-2 rounded text-sm">
                                    <option value="">-- Select Client --</option>
                                    {clients.map(c => (
                                      <option key={c.id} value={c.name}>{c.name}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div>
                                <label className="block text-xs font-bold text-slate-600 mb-1">Notes</label>
                                <textarea name="jobNotes" defaultValue={job.jobNotes} className="w-full border p-2 rounded text-sm h-20"></textarea>
                              </div>
                              <div className="flex justify-end gap-2">
                                <button type="button" onClick={() => setEditingProject(null)} className="px-3 py-1 text-slate-600 hover:bg-slate-200 rounded text-sm font-bold">Cancel</button>
                                <button type="submit" className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-bold">Save Changes</button>
                              </div>
                            </form>
                          </td>
                        ) : (
                          <>
                            <td className="p-3 font-bold text-slate-800">{job.projectName || 'Untitled'}</td>
                            <td className="p-3 text-slate-600">{job.clientName || '-'}</td>
                            <td className="p-3 text-slate-500 text-xs">{new Date(job.lastSaved).toLocaleString()}</td>
                            <td className="p-3 text-slate-500 text-xs max-w-[200px] truncate" title={job.jobNotes}>{job.jobNotes || '-'}</td>
                            <td className="p-3 text-right space-x-2 whitespace-nowrap">
                              <button 
                                onClick={() => {
                                  setCurrentJobId(id);
                                  setProjectName(job.projectName || "");
                                  setClientName(job.clientName || "");
                                  setJobNotes(job.jobNotes || "");
                                  setTakeoffData(job.takeoffData || {});
                                  setActionHistory(job.history || []);
                                  setHistoryIndex(0);
                                  if (job.customVariables) setCustomVariables(job.customVariables);
                                  if (job.dynamicColumns) setDynamicColumns(job.dynamicColumns);
                                  if (job.entityData) setEntityData(job.entityData);
                                  if (job.formulaTemplates) setFormulaTemplates(job.formulaTemplates);
                                  setProjectModalOpen(false);
                                }}
                                className="text-emerald-600 hover:text-emerald-800 text-xs font-bold px-2 py-1 bg-emerald-50 rounded"
                              >
                                Load
                              </button>
                              <button 
                                onClick={() => setEditingProject(id)}
                                className="text-blue-600 hover:text-blue-800 text-xs font-bold px-2 py-1 bg-blue-50 rounded"
                              >
                                Edit
                              </button>
                                <button 
                                  onClick={async () => {
                                    if (window.confirm(`Delete project "${job.projectName}"? This cannot be undone.`)) {
                                      if (user) {
                                        try {
                                          const jobDocRef = doc(db, 'users', user.uid, 'jobs', id);
                                          await deleteDoc(jobDocRef);
                                        } catch (error) {
                                          console.error("Error deleting job from Firestore:", error);
                                        }
                                      } else {
                                        const newJobs = { ...savedJobs };
                                        delete newJobs[id];
                                        setSavedJobs(newJobs);
                                        localStorage.setItem('savedEstimatingJobs', JSON.stringify(newJobs));
                                      }
                                      if (currentJobId === id) {
                                        setCurrentJobId("");
                                      }
                                    }
                                  }}
                                  className="text-red-600 hover:text-red-800 text-xs font-bold px-2 py-1 bg-red-50 rounded"
                                >
                                  Delete
                                </button>
                            </td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Columns Modal */}
      {dynamicColumnsModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-[60]">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl p-6 border-t-4 border-indigo-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Manage Dynamic Columns</h2>
              <button onClick={() => { setDynamicColumnsModalOpen(false); setEditingColumn(null); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            
            <div className="mb-6">
              <h3 className="text-sm font-bold text-slate-700 mb-2">{editingColumn ? 'Edit Column' : 'Add New Column'}</h3>
              <form 
                onSubmit={(e) => {
                  e.preventDefault();
                  const form = e.target as HTMLFormElement;
                  const name = (form.elements.namedItem('colName') as HTMLInputElement).value.trim();
                  const key = editingColumn ? editingColumn.key : (form.elements.namedItem('colKey') as HTMLInputElement).value.trim();
                  const dataType = (form.elements.namedItem('colType') as HTMLSelectElement).value as 'number' | 'text' | 'boolean';
                  const scope = (form.elements.namedItem('colScope') as HTMLSelectElement).value as 'category' | 'subcategory' | 'itemgroup' | 'material' | 'global';
                  const category = (form.elements.namedItem('colCat') as HTMLSelectElement)?.value || undefined;
                  const subCategory = (form.elements.namedItem('colSubCat') as HTMLSelectElement)?.value || undefined;
                  const itemGroup = (form.elements.namedItem('colItemGroup') as HTMLSelectElement)?.value || undefined;
                  const materialName = (form.elements.namedItem('colMaterial') as HTMLSelectElement)?.value || undefined;
                  const unit = (form.elements.namedItem('colUnit') as HTMLInputElement).value.trim();
                  const defaultValue = (form.elements.namedItem('colDefault') as HTMLInputElement).value.trim();
                  
                  if (!name || !key) {
                    alert("Name and Key are required.");
                    return;
                  }
                  
                  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
                    alert("Key must be a valid variable name (letters, numbers, underscores, starting with a letter).");
                    return;
                  }
                  
                  let newCols = [...dynamicColumns];
                  if (editingColumn) {
                    newCols = newCols.map(c => c.id === editingColumn.id ? { ...c, name, key, dataType, scope, unit, defaultValue, category, subCategory, itemGroup, materialName } : c);
                  } else {
                    if (newCols.some(c => c.key.toLowerCase() === key.toLowerCase())) {
                      alert("A column with this key already exists.");
                      return;
                    }
                    newCols.push({
                      id: 'COL-' + Date.now(),
                      name,
                      key,
                      dataType,
                      scope,
                      unit,
                      defaultValue,
                      category,
                      subCategory,
                      itemGroup,
                      materialName
                    });
                  }
                  
                  setDynamicColumns(newCols);
                  const { newData, hasChanges } = recalculateAllFormulas(customVariables, entityData, true, collapsedState, newCols);
                  recordHistory(editingColumn ? `Updated column ${name}` : `Added column ${name}`, hasChanges ? newData : takeoffData, catalog, projectName, clientName, customVariables, jobNotes, newCols, entityData);
                  
                  form.reset();
                  setEditingColumn(null);
                }}
                className="bg-slate-50 p-4 rounded border border-slate-200 flex flex-col gap-3"
              >
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Name</label>
                    <input name="colName" type="text" required defaultValue={editingColumn?.name || ""} className="w-full border rounded p-2 text-sm focus:border-indigo-500 outline-none" placeholder="e.g., Labor Rate" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Key (Variable)</label>
                    <input name="colKey" type="text" required defaultValue={editingColumn?.key || ""} disabled={!!editingColumn} className="w-full border rounded p-2 text-sm font-mono focus:border-indigo-500 outline-none disabled:bg-slate-100 disabled:text-slate-500" placeholder="e.g., LaborRate" />
                  </div>
                </div>
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Type</label>
                    <select name="colType" defaultValue={editingColumn?.dataType || "number"} className="w-full border rounded p-2 text-sm focus:border-indigo-500 outline-none">
                      <option value="number">Number</option>
                      <option value="text">Text</option>
                      <option value="boolean">Boolean</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Scope</label>
                    <select 
                      name="colScope" 
                      value={colScope} 
                      onChange={(e) => setColScope(e.target.value as any)}
                      className="w-full border rounded p-2 text-sm focus:border-indigo-500 outline-none"
                    >
                      <option value="global">Global (All Items)</option>
                      <option value="category">Category (L1)</option>
                      <option value="subcategory">Sub-Category (L2)</option>
                      <option value="itemgroup">Item Group (L3)</option>
                      <option value="material">Material (Specific Item)</option>
                    </select>
                  </div>
                </div>

                {['category', 'subcategory', 'itemgroup', 'material'].includes(colScope) && (
                  <div className="flex flex-col gap-3 p-3 bg-indigo-50/50 rounded border border-indigo-100">
                    <div className="flex gap-3">
                      <div className="flex-1">
                        <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1">Category (L1)</label>
                        <select 
                          name="colCat" 
                          value={colScopeL1} 
                          onChange={(e) => setColScopeL1(e.target.value)}
                          required 
                          className="w-full border rounded p-2 text-sm focus:border-indigo-500 outline-none"
                        >
                          <option value="">-- Select Category --</option>
                          {allCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      {['subcategory', 'itemgroup', 'material'].includes(colScope) && (
                        <div className="flex-1">
                          <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1">Sub-Category (L2)</label>
                          <select 
                            name="colSubCat" 
                            value={colScopeL2} 
                            onChange={(e) => setColScopeL2(e.target.value)}
                            required 
                            className="w-full border rounded p-2 text-sm focus:border-indigo-500 outline-none"
                          >
                            <option value="">-- Select Sub-Category --</option>
                            {allSubCategories.map(c => <option key={c} value={c}>{c}</option>)}
                          </select>
                        </div>
                      )}
                    </div>
                    {['itemgroup', 'material'].includes(colScope) && (
                      <div className="w-full">
                        <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1">Item Group (L3)</label>
                        <select 
                          name="colItemGroup" 
                          value={colScopeL3} 
                          onChange={(e) => setColScopeL3(e.target.value)}
                          required 
                          className="w-full border rounded p-2 text-sm focus:border-indigo-500 outline-none"
                        >
                          <option value="">-- Select Item Group --</option>
                          {allItemGroups.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    )}
                    {colScope === 'material' && (
                      <div className="w-full">
                        <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-1">Specific Material (L4)</label>
                        <select 
                          name="colMaterial" 
                          value={colScopeL4} 
                          onChange={(e) => setColScopeL4(e.target.value)}
                          required 
                          className="w-full border rounded p-2 text-sm focus:border-indigo-500 outline-none"
                        >
                          <option value="">-- Select Material --</option>
                          {allMaterials.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-3">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Unit (Optional)</label>
                    <input name="colUnit" type="text" defaultValue={editingColumn?.unit || ""} className="w-full border rounded p-2 text-sm focus:border-indigo-500 outline-none" placeholder="e.g., $/hr" />
                  </div>
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Default Value</label>
                    <input name="colDefault" type="text" defaultValue={editingColumn?.defaultValue || ""} className="w-full border rounded p-2 text-sm focus:border-indigo-500 outline-none" placeholder="e.g., 0" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  {editingColumn && (
                    <button type="button" onClick={() => setEditingColumn(null)} className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200 rounded">Cancel</button>
                  )}
                  <button type="submit" className="bg-indigo-600 text-white px-4 py-1.5 rounded text-sm font-bold hover:bg-indigo-700 transition">
                    {editingColumn ? 'Save Changes' : 'Add Column'}
                  </button>
                </div>
              </form>
            </div>
            
            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-2">Existing Columns</h3>
              <div className="max-h-48 overflow-y-auto border rounded bg-white">
                {dynamicColumns.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-400 italic">No dynamic columns defined.</div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="p-2 border-b font-bold text-slate-600">Name</th>
                        <th className="p-2 border-b font-bold text-slate-600">Key</th>
                        <th className="p-2 border-b font-bold text-slate-600">Scope</th>
                        <th className="p-2 border-b font-bold text-slate-600 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dynamicColumns.map((c, index) => (
                        <tr key={c.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="p-2 font-bold">{c.name}</td>
                          <td className="p-2 font-mono text-xs text-indigo-700">{c.key}</td>
                          <td className="p-2 text-xs uppercase text-slate-500">
                            {c.scope}
                            {c.category && (
                              <div className="text-[9px] text-indigo-400 normal-case mt-0.5">
                                {c.category} 
                                {c.subCategory && ` > ${c.subCategory}`} 
                                {c.itemGroup && ` > ${c.itemGroup}`}
                                {c.materialName && ` > ${c.materialName}`}
                              </div>
                            )}
                          </td>
                          <td className="p-2 text-right flex justify-end items-center gap-1">
                            <div className="flex flex-col mr-2">
                              <button 
                                onClick={() => moveColumn(index, 'up')}
                                disabled={index === 0}
                                className="text-slate-400 hover:text-indigo-600 disabled:opacity-30"
                                title="Move Up"
                              >
                                <ChevronUp size={14} />
                              </button>
                              <button 
                                onClick={() => moveColumn(index, 'down')}
                                disabled={index === dynamicColumns.length - 1}
                                className="text-slate-400 hover:text-indigo-600 disabled:opacity-30"
                                title="Move Down"
                              >
                                <ChevronDown size={14} />
                              </button>
                            </div>
                            <button 
                              onClick={() => setEditingColumn(c)}
                              className="text-blue-600 hover:text-blue-800 text-xs font-bold mr-3"
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => {
                                if (isVariableUsedInFormulas(c.key)) {
                                  if (!window.confirm(`Warning: Column "${c.name}" (Key: [${c.key}]) is currently used in one or more formulas. Deleting it will cause those formulas to become invalid. Are you sure you want to force delete it?`)) {
                                    return;
                                  }
                                } else {
                                  if (!window.confirm(`Delete column ${c.name}?`)) {
                                    return;
                                  }
                                }
                                const newCols = dynamicColumns.filter(col => col.id !== c.id);
                                setDynamicColumns(newCols);
                                const { newData, hasChanges } = recalculateAllFormulas(customVariables, entityData, true, collapsedState, newCols);
                                recordHistory(`Deleted column ${c.name}`, hasChanges ? newData : takeoffData, catalog, projectName, clientName, customVariables, jobNotes, newCols, entityData);
                                if (editingColumn?.id === c.id) setEditingColumn(null);
                              }}
                              className="text-red-600 hover:text-red-800 text-xs font-bold"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mapping Modal */}
      {mappingModalOpen && templateToApply && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-[70]" onClick={() => setMappingModalOpen(false)}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 border-t-4 border-indigo-500" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Map Template Variables</h2>
              <button onClick={() => setMappingModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
            </div>
            
            <div className="bg-indigo-50 p-3 rounded border border-indigo-100 mb-4 flex justify-between items-center">
              <p className="text-xs text-indigo-800">
                The template <span className="font-bold">&quot;{templateToApply.name}&quot;</span> requires mapping.
              </p>
              <button 
                onClick={() => {
                  const item = catalog.find(i => i.item_id === qtyPanelItemId);
                  const newMappings = autoMapVariables(templateToApply, item);
                  setVariableMappings(newMappings);
                }}
                className="text-[10px] bg-indigo-600 text-white px-2 py-1 rounded font-bold hover:bg-indigo-700 transition"
              >
                Auto-map All
              </button>
            </div>

            {templateToApply.variables.filter(v => !variableMappings[v]).length > 0 && (
              <div className="mb-4 p-2 bg-amber-50 border border-amber-200 rounded flex items-center gap-2 text-amber-700">
                <div className="bg-amber-500 text-white rounded-full p-0.5"><X size={10} /></div>
                <span className="text-[10px] font-bold">Some required variables are not yet mapped.</span>
              </div>
            )}

            <div className="space-y-4 max-h-80 overflow-y-auto pr-2">
              {templateToApply.variables.map(v => {
                const isMapped = !!variableMappings[v];
                const item = catalog.find(i => i.item_id === qtyPanelItemId);
                
                // Categorize variables for suggestions
                const builtInVars = [
                  { key: 'Take-off', label: 'Take-off (Primary measurement)' },
                  { key: 'Overage %', label: 'Overage % (Waste factor)' },
                  { key: 'Order', label: 'Order (Packaging/Unit size)' }
                ];

                const relevantVars: string[] = [];
                const otherVars: string[] = [];

                Object.entries(variableRegistry).forEach(([regKey, info]) => {
                  let isRelevant = false;
                  if (info.scope === 'global') {
                    isRelevant = true;
                  } else if (item && info.col) {
                    const c = info.col;
                    if (c.scope === 'category' && c.category === item.category) isRelevant = true;
                    if (c.scope === 'subcategory' && c.category === item.category && c.subCategory === item.sub_category) isRelevant = true;
                    if (c.scope === 'itemgroup' && c.category === item.category && c.subCategory === item.sub_category && c.itemGroup === (item.sub_item_1 || '')) isRelevant = true;
                    if (c.scope === 'material' && c.category === item.category && c.subCategory === item.sub_category && c.itemGroup === (item.sub_item_1 || '') && c.materialName === item.item_name) isRelevant = true;
                  }

                  if (isRelevant) {
                    relevantVars.push(regKey);
                  } else {
                    otherVars.push(regKey);
                  }
                });

                // Check for "Best Match" (normalized name match)
                const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
                const vNorm = normalize(v);
                
                const findBest = (list: string[]) => list.find(k => normalize(k) === vNorm);
                const bestMatch = findBest(relevantVars) || findBest(otherVars);

                return (
                  <div key={v} className={`p-3 rounded border transition ${isMapped ? 'border-slate-200 bg-white' : 'border-amber-300 bg-amber-50'}`}>
                    <div className="flex justify-between items-center mb-1">
                      <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                        Template Variable: <span className="text-indigo-600">[{v}]</span>
                      </label>
                      {!isMapped && <span className="text-[10px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded">Required</span>}
                    </div>
                    
                    {bestMatch && !isMapped && (
                      <button 
                        onClick={() => setVariableMappings(prev => ({ ...prev, [v]: `[${bestMatch}]` }))}
                        className="text-[10px] text-emerald-600 font-bold mb-1 flex items-center gap-1 hover:bg-emerald-50 px-1 rounded transition w-full text-left"
                      >
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                        Suggested Match: [{bestMatch}] (Click to apply)
                      </button>
                    )}

                    <select 
                      value={variableMappings[v] || ""}
                      onChange={(e) => setVariableMappings(prev => ({ ...prev, [v]: e.target.value }))}
                      className={`w-full border p-2 rounded text-sm outline-none focus:ring-2 transition ${isMapped ? 'border-slate-300 focus:ring-indigo-200' : 'border-amber-400 focus:ring-amber-200'}`}
                    >
                      <option value="">-- Select Project Variable --</option>
                      
                      <optgroup label="Built-in Variables">
                        {builtInVars.map(bv => (
                          <option key={bv.key} value={`[${bv.key}]`}>{bv.label}</option>
                        ))}
                      </optgroup>
                      
                      {relevantVars.length > 0 && (
                        <optgroup label="Relevant to this Item">
                          {relevantVars.map(regKey => {
                            const info = variableRegistry[regKey];
                            return (
                              <option key={regKey} value={`[${regKey}]`}>
                                {regKey} ({info.scope === 'global' ? 'Global' : 'Scoped'})
                              </option>
                            );
                          })}
                        </optgroup>
                      )}

                      {otherVars.length > 0 && (
                        <optgroup label="Other Project Variables">
                          {otherVars.map(regKey => {
                            const info = variableRegistry[regKey];
                            return (
                              <option key={regKey} value={`[${regKey}]`}>
                                {regKey} ({info.scope})
                              </option>
                            );
                          })}
                        </optgroup>
                      )}
                    </select>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end gap-2 mt-6 pt-4 border-t">
              <button 
                onClick={() => setMappingModalOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded transition"
              >
                Cancel
              </button>
              <button 
                onClick={() => {
                  const unmapped = templateToApply.variables.filter(v => !variableMappings[v]);
                  if (unmapped.length > 0) {
                    alert(`Please map all variables before applying. Unmapped: ${unmapped.join(', ')}`);
                    return;
                  }

                  // Confirmation for shared variables
                  const mappedKeys = Object.values(variableMappings)
                    .map(v => v.replace(/^\[|\]$/g, ''))
                    .filter(k => k !== 'Take-off' && k !== 'Overage %' && k !== 'Order');
                  
                  const sharedVars = mappedKeys.filter(k => isVariableUsedInFormulas(k));
                  if (sharedVars.length > 0) {
                    if (!window.confirm(`CRITICAL: The following variables are already used in other formulas: ${sharedVars.join(', ')}.\n\nApplying this template will link this item to these shared variables. Any future changes to these variables will affect ALL linked items.\n\nDo you want to proceed with this shared mapping?`)) {
                      return;
                    }
                  }

                  let finalFormula = templateToApply.formula;
                  Object.entries(variableMappings).forEach(([tplVar, mappedVar]) => {
                    if (mappedVar) {
                      // Use regex with global flag to replace all occurrences
                      const escapedVar = `[${tplVar}]`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                      finalFormula = finalFormula.replace(new RegExp(escapedVar, 'g'), mappedVar);
                    }
                  });
                  setCustomFormula(finalFormula);
                  setMappingModalOpen(false);
                }}
                className={`px-6 py-2 text-sm font-bold rounded shadow-sm transition ${templateToApply.variables.filter(v => !variableMappings[v]).length > 0 ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700 text-white'}`}
              >
                Apply to Formula
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Formula Template Modal */}
      {formulaTemplateModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-[60]">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl p-6 border-t-4 border-indigo-500 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Formula Library</h2>
              <button onClick={() => { setFormulaTemplateModalOpen(false); setEditingFormulaTemplate(null); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            
            <div className="mb-6 shrink-0">
              <h3 className="text-sm font-bold text-slate-700 mb-2">{editingFormulaTemplate ? 'Edit Template' : 'Add New Template'}</h3>
              <div className="space-y-3 bg-slate-50 p-3 rounded border border-slate-200">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Template Name</label>
                    <input 
                      type="text" 
                      id="ft-name"
                      defaultValue={editingFormulaTemplate?.name || ''}
                      placeholder="e.g. Standard Drywall Calc"
                      className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Scope</label>
                    <select 
                      id="ft-scope"
                      defaultValue={editingFormulaTemplate?.scope || 'global'}
                      className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                    >
                      <option value="global">Global (All Items)</option>
                      <option value="category">Category</option>
                      <option value="subcategory">Sub-Category</option>
                      <option value="itemgroup">Item Group</option>
                      <option value="material">Material</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Formula</label>
                  <input 
                    type="text" 
                    id="ft-formula"
                    defaultValue={editingFormulaTemplate?.formula || ''}
                    placeholder="e.g. [Take-off] * 1.15 / [Order]"
                    className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-indigo-200 outline-none font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Description (optional)</label>
                  <input 
                    type="text" 
                    id="ft-desc"
                    defaultValue={editingFormulaTemplate?.description || ''}
                    placeholder="e.g. Calculates drywall sheets with 15% waste"
                    className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-indigo-200 outline-none"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  {editingFormulaTemplate && (
                    <button 
                      onClick={() => setEditingFormulaTemplate(null)}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded transition"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      const nameInput = document.getElementById('ft-name') as HTMLInputElement;
                      const formulaInput = document.getElementById('ft-formula') as HTMLInputElement;
                      const descInput = document.getElementById('ft-desc') as HTMLInputElement;
                      const scopeInput = document.getElementById('ft-scope') as HTMLSelectElement;
                      
                      const name = nameInput.value.trim();
                      const formula = formulaInput.value.trim();
                      const desc = descInput.value.trim();
                      const scope = scopeInput.value as any;
                      
                      if (!name) {
                        alert("Please enter a template name.");
                        return;
                      }
                      if (!formula) {
                        alert("Please enter a formula.");
                        return;
                      }
                      
                      const variables = extractVariablesFromFormula(formula);
                      
                      let newTemplates = [...formulaTemplates];
                      if (editingFormulaTemplate) {
                        newTemplates = newTemplates.map(t => t.id === editingFormulaTemplate.id ? { ...t, name, formula, description: desc, scope, variables } : t);
                      } else {
                        newTemplates.push({
                          id: "FT-" + Date.now(),
                          name,
                          formula,
                          description: desc,
                          scope,
                          variables,
                          createdAt: new Date().toISOString()
                        });
                      }
                      
                      setFormulaTemplates(newTemplates);
                      localStorage.setItem('formulaTemplates', JSON.stringify(newTemplates));
                      recordHistory(editingFormulaTemplate ? `Updated formula template ${name}` : `Added formula template ${name}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, newTemplates);
                      
                      // Reset form
                      nameInput.value = '';
                      formulaInput.value = '';
                      descInput.value = '';
                      scopeInput.value = 'global';
                      setEditingFormulaTemplate(null);
                    }}
                    className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded transition"
                  >
                    {editingFormulaTemplate ? 'Update Template' : 'Add Template'}
                  </button>
                </div>
              </div>
            </div>
            
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="flex justify-between items-center mb-2">
                <h3 className="text-sm font-bold text-slate-700">Existing Templates</h3>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1.5 h-3.5 w-3.5 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search..." 
                      value={templateSearch}
                      onChange={(e) => setTemplateSearch(e.target.value)}
                      className="pl-7 pr-2 py-1 text-xs border rounded outline-none focus:border-indigo-500 w-32"
                    />
                  </div>
                  <select 
                    value={templateScopeFilter}
                    onChange={(e) => setTemplateScopeFilter(e.target.value)}
                    className="text-xs border rounded p-1 outline-none focus:border-indigo-500"
                  >
                    <option value="all">All Scopes</option>
                    <option value="global">Global</option>
                    <option value="category">Category</option>
                    <option value="subcategory">Sub-Category</option>
                    <option value="itemgroup">Item Group</option>
                    <option value="material">Material</option>
                  </select>
                </div>
              </div>
              
              <div className="flex-1 overflow-y-auto border rounded bg-white">
                {formulaTemplates.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-400 italic">No formula templates defined.</div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="p-2 border-b font-bold text-slate-600">Name</th>
                        <th className="p-2 border-b font-bold text-slate-600">Scope</th>
                        <th className="p-2 border-b font-bold text-slate-600">Variables</th>
                        <th className="p-2 border-b font-bold text-slate-600 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {formulaTemplates
                        .filter(t => {
                          const matchesSearch = t.name.toLowerCase().includes(templateSearch.toLowerCase()) || 
                                              (t.description && t.description.toLowerCase().includes(templateSearch.toLowerCase()));
                          const matchesScope = templateScopeFilter === 'all' || t.scope === templateScopeFilter;
                          return matchesSearch && matchesScope;
                        })
                        .map(t => (
                        <tr key={t.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="p-2 font-medium text-slate-800">
                            <div>{t.name}</div>
                            {t.description && <div className="text-[10px] text-slate-400 font-normal">{t.description}</div>}
                          </td>
                          <td className="p-2 text-xs text-slate-500 capitalize">{t.scope}</td>
                          <td className="p-2">
                            <div className="flex flex-wrap gap-1">
                              {t.variables.map(v => (
                                <span key={v} className="text-[10px] bg-indigo-50 text-indigo-600 px-1 rounded border border-indigo-100">{v}</span>
                              ))}
                            </div>
                          </td>
                          <td className="p-2 text-right whitespace-nowrap">
                            <button 
                              onClick={() => {
                                setEditingFormulaTemplate(t);
                                setTimeout(() => {
                                  const nameInput = document.getElementById('ft-name') as HTMLInputElement;
                                  const formulaInput = document.getElementById('ft-formula') as HTMLInputElement;
                                  const descInput = document.getElementById('ft-desc') as HTMLInputElement;
                                  const scopeInput = document.getElementById('ft-scope') as HTMLSelectElement;
                                  if (nameInput) nameInput.value = t.name;
                                  if (formulaInput) formulaInput.value = t.formula;
                                  if (descInput) descInput.value = t.description || '';
                                  if (scopeInput) scopeInput.value = t.scope;
                                }, 10);
                              }}
                              className="text-blue-500 hover:text-blue-700 mr-3 text-xs"
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => {
                                if (window.confirm(`Delete template "${t.name}"?`)) {
                                  const newTemplates = formulaTemplates.filter(ft => ft.id !== t.id);
                                  setFormulaTemplates(newTemplates);
                                  localStorage.setItem('formulaTemplates', JSON.stringify(newTemplates));
                                  recordHistory(`Deleted formula template ${t.name}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, newTemplates);
                                  if (editingFormulaTemplate?.id === t.id) setEditingFormulaTemplate(null);
                                }
                              }}
                              className="text-red-500 hover:text-red-700 text-xs"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom Variable Modal */}
      {customVarModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-[60]">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 border-t-4 border-amber-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Manage Custom Variables</h2>
              <div className="flex items-center gap-2">
                <button 
                  onClick={exportCustomVariables}
                  title="Export Variables to JSON"
                  className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded transition"
                >
                  <FileJson size={18} />
                </button>
                <label className="p-1.5 text-slate-500 hover:text-amber-600 hover:bg-amber-50 rounded transition cursor-pointer" title="Import Variables from JSON">
                  <Upload size={18} />
                  <input type="file" className="hidden" accept=".json" onChange={importCustomVariables} />
                </label>
                <button onClick={() => { setCustomVarModalOpen(false); setEditingCustomVar(null); }} className="text-slate-400 hover:text-slate-600 ml-2"><X size={24} /></button>
              </div>
            </div>
            
            <div className="mb-6">
              <h3 className="text-sm font-bold text-slate-700 mb-2">{editingCustomVar ? 'Edit Variable' : 'Add New Variable'}</h3>
              <div className="space-y-3 bg-slate-50 p-3 rounded border border-slate-200">
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Variable Name (no spaces)</label>
                  <input 
                    type="text" 
                    id="cv-name"
                    defaultValue={editingCustomVar?.name || ''}
                    placeholder="e.g. WasteFactor"
                    className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Value or Formula</label>
                  <input 
                    type="text" 
                    id="cv-value"
                    defaultValue={editingCustomVar?.formula || editingCustomVar?.value || ''}
                    placeholder="e.g. 1.15 or [OtherVar] * 2"
                    className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Description (optional)</label>
                  <input 
                    type="text" 
                    id="cv-desc"
                    defaultValue={editingCustomVar?.description || ''}
                    placeholder="e.g. Standard waste factor for drywall"
                    className="w-full border p-2 rounded text-sm focus:ring-2 focus:ring-amber-200 outline-none"
                  />
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  {editingCustomVar && (
                    <button 
                      onClick={() => setEditingCustomVar(null)}
                      className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-200 rounded transition"
                    >
                      Cancel Edit
                    </button>
                  )}
                  <button 
                    onClick={() => {
                      const nameInput = document.getElementById('cv-name') as HTMLInputElement;
                      const valueInput = document.getElementById('cv-value') as HTMLInputElement;
                      const descInput = document.getElementById('cv-desc') as HTMLInputElement;
                      
                      const name = nameInput.value.trim().replace(/\s+/g, '_');
                      const formula = valueInput.value.trim();
                      const desc = descInput.value.trim();
                      
                      if (!name) {
                        alert("Please enter a variable name.");
                        return;
                      }
                      if (!formula) {
                        alert("Please enter a value or formula.");
                        return;
                      }
                      
                      let newVars = [...customVariables];
                      if (editingCustomVar) {
                        newVars = newVars.map(v => v.id === editingCustomVar.id ? { ...v, name, formula, description: desc } : v);
                      } else {
                        // Check for duplicates
                        if (newVars.some(v => v.name.toLowerCase() === name.toLowerCase()) || 
                            FORMULA_VARIABLES.some(v => v.name.toLowerCase() === name.toLowerCase())) {
                          alert("A variable with this name already exists.");
                          return;
                        }
                        newVars.push({
                          id: "CV-" + Date.now(),
                          name,
                          formula,
                          value: 0,
                          description: desc
                        });
                      }
                      
                      // Recalculate affected variables and items
                      const { newData, hasChanges, newVars: updatedVars } = recalculateAffectedItems([`Variable:${name}`], newVars, entityData, takeoffData);
                      
                      setCustomVariables(updatedVars);
                      recordHistory(editingCustomVar ? `Updated variable ${name}` : `Added variable ${name}`, hasChanges ? newData : takeoffData, catalog, projectName, clientName, updatedVars, jobNotes, dynamicColumns, entityData);
                      
                      // Reset form
                      nameInput.value = '';
                      valueInput.value = '';
                      descInput.value = '';
                      setEditingCustomVar(null);
                    }}
                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs font-bold rounded transition"
                  >
                    {editingCustomVar ? 'Update Variable' : 'Add Variable'}
                  </button>
                </div>
              </div>
            </div>
            
            <div>
              <h3 className="text-sm font-bold text-slate-700 mb-2">Existing Variables</h3>
              <div className="max-h-48 overflow-y-auto border rounded bg-white">
                {customVariables.length === 0 ? (
                  <div className="p-4 text-center text-sm text-slate-400 italic">No custom variables defined.</div>
                ) : (
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 sticky top-0">
                      <tr>
                        <th className="p-2 border-b font-bold text-slate-600">Name</th>
                        <th className="p-2 border-b font-bold text-slate-600">Value</th>
                        <th className="p-2 border-b font-bold text-slate-600 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customVariables.map(v => (
                        <tr key={v.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className="p-2 font-mono text-xs text-amber-700">[{v.name}]</td>
                          <td className="p-2 font-mono text-xs">
                            {v.formula && v.formula !== v.value.toString() ? (
                              <span title={`Formula: ${v.formula}`}>{v.value} <span className="text-slate-400 text-[10px]">(fx)</span></span>
                            ) : (
                              v.value
                            )}
                          </td>
                          <td className="p-2 text-right">
                            <button 
                              onClick={() => {
                                setEditingCustomVar(v);
                                // Small delay to let React render the form inputs with new default values
                                setTimeout(() => {
                                  const nameInput = document.getElementById('cv-name') as HTMLInputElement;
                                  const valueInput = document.getElementById('cv-value') as HTMLInputElement;
                                  const descInput = document.getElementById('cv-desc') as HTMLInputElement;
                                  if (nameInput) nameInput.value = v.name;
                                  if (valueInput) valueInput.value = v.formula || v.value.toString();
                                  if (descInput) descInput.value = v.description || '';
                                }, 10);
                              }}
                              className="text-blue-500 hover:text-blue-700 mr-3 text-xs"
                            >
                              Edit
                            </button>
                            <button 
                              onClick={() => {
                                if (window.confirm(`Delete variable [${v.name}]?`)) {
                                  const newVars = customVariables.filter(cv => cv.id !== v.id);
                                  const { newData, hasChanges, newVars: updatedVars } = recalculateAffectedItems([`Variable:${v.name}`], newVars, entityData, takeoffData);
                                  
                                  setCustomVariables(updatedVars);
                                  recordHistory(`Deleted variable ${v.name}`, hasChanges ? newData : takeoffData, catalog, projectName, clientName, updatedVars, jobNotes, dynamicColumns, entityData);
                                  if (editingCustomVar?.id === v.id) setEditingCustomVar(null);
                                }
                              }}
                              className="text-red-500 hover:text-red-700 text-xs"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
            
            <div className="mt-6 flex justify-end pt-4 border-t">
              <button onClick={() => { setCustomVarModalOpen(false); setEditingCustomVar(null); }} className="px-6 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded font-bold transition">Done</button>
            </div>
          </div>
        </div>
      )}

      {/* QTY Panel Modal */}
      {qtyPanelOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-50" onClick={closeQtyPanel}>
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl p-6 border-t-4 border-emerald-500" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">QTY Calculation Engine</h2>
              <span className="text-sm font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded">
                {catalog.find(i => i.item_id === qtyPanelItemId)?.item_name}
              </span>
            </div>
            
            <div className="flex border-b mb-4">
              <button 
                onClick={() => setQtyMode('auto')} 
                className={`px-4 py-2 font-bold text-sm border-b-2 transition ${qtyMode === 'auto' ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                ƒx Auto Formula
              </button>
              <button 
                onClick={() => setQtyMode('manual')} 
                className={`px-4 py-2 font-bold text-sm border-b-2 transition ${qtyMode === 'manual' ? 'border-amber-600 text-amber-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                ✋ Manual Override
              </button>
              <button 
                onClick={() => setQtyMode('guide')} 
                className={`px-4 py-2 font-bold text-sm border-b-2 transition ${qtyMode === 'guide' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
              >
                📖 Formula Guide
              </button>
            </div>
            
            {qtyMode === 'auto' ? (
              <div className="space-y-4">
                {/* Existing auto formula content */}
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-slate-500 uppercase">Formula Editor</label>
                  {formulaTemplates.length > 0 && (
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-500">Apply Template:</span>
                      <select 
                        className="text-xs border rounded p-1 outline-none focus:border-indigo-500"
                        onChange={(e) => {
                          if (e.target.value) {
                            const template = formulaTemplates.find(t => t.id === e.target.value);
                            if (template) {
                              if (template.variables.length > 0) {
                                setTemplateToApply(template);
                                const item = catalog.find(i => i.item_id === qtyPanelItemId);
                                const initialMappings = autoMapVariables(template, item);
                                setVariableMappings(initialMappings);
                                setMappingModalOpen(true);
                              } else {
                                setCustomFormula(template.formula);
                              }
                            }
                            e.target.value = ""; // Reset select
                          }
                        }}
                      >
                        <option value="">-- Select Template --</option>
                        {['global', 'category', 'subcategory', 'itemgroup', 'material'].map(scope => {
                          const scopedTemplates = formulaTemplates.filter(t => t.scope === scope);
                          if (scopedTemplates.length === 0) return null;
                          return (
                            <optgroup key={scope} label={scope.charAt(0).toUpperCase() + scope.slice(1)}>
                              {scopedTemplates.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                              ))}
                            </optgroup>
                          );
                        })}
                      </select>
                    </div>
                  )}
                </div>
                <div className="border border-emerald-400 rounded overflow-hidden focus-within:ring-2 focus-within:ring-emerald-200">
                  <CodeMirror
                    ref={formulaInputRef}
                    value={customFormula}
                    onChange={(val) => setCustomFormula(val)}
                    extensions={[
                      javascript(),
                      autocompletion({ override: [formulaCompletions] }),
                      lintGutter(),
                      formulaLinter,
                      formulaHighlightPlugin
                    ]}
                    className="font-mono text-sm"
                    basicSetup={{
                      lineNumbers: false,
                      foldGutter: false,
                      highlightActiveLine: false,
                    }}
                  />
                </div>
                
                <div className="mt-4 border-t pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-bold text-slate-700">Formula Helper</h4>
                    <div className="relative w-64">
                      <Search className="absolute left-2 top-1.5 h-4 w-4 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search functions & variables..."
                        value={formulaHelpSearch}
                        onChange={(e) => setFormulaHelpSearch(e.target.value)}
                        className="w-full pl-8 pr-2 py-1 text-sm border border-slate-300 rounded focus:ring-1 focus:ring-emerald-500 outline-none"
                      />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-60 overflow-y-auto pr-2">
                    <div>
                      <div className="flex items-center justify-between mb-2 sticky top-0 bg-white py-1 z-10">
                        <h5 className="text-xs font-bold text-slate-500 uppercase">Variables</h5>
                        <div className="flex gap-1">
                          <button 
                            onClick={() => {
                              if (!customFormula) return;
                              setEditingFormulaTemplate({
                                id: "FT-" + Date.now(),
                                name: "",
                                formula: customFormula,
                                description: "",
                                variables: extractVariablesFromFormula(customFormula),
                                scope: 'global',
                                createdAt: new Date().toISOString()
                              });
                              setFormulaTemplateModalOpen(true);
                            }}
                            className="text-[10px] bg-emerald-50 hover:bg-emerald-100 text-emerald-600 px-2 py-1 rounded border border-emerald-200 transition flex items-center gap-1"
                            title="Save current formula as template"
                          >
                            <Save size={10} />
                            Save Current
                          </button>
                          <button 
                            onClick={() => setFormulaTemplateModalOpen(true)}
                            className="text-[10px] bg-indigo-50 hover:bg-indigo-100 text-indigo-600 px-2 py-1 rounded border border-indigo-200 transition"
                          >
                            Library
                          </button>
                          <button 
                            onClick={() => setCustomVarModalOpen(true)}
                            className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded border border-slate-200 transition"
                          >
                            Custom
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2">
                        {dynamicColumns.filter(c => {
                          const item = catalog.find(i => i.item_id === qtyPanelItemId);
                          if (!item) return false;
                          
                          const matchesSearch = c.name.toLowerCase().includes(formulaHelpSearch.toLowerCase()) || 
                                               c.key.toLowerCase().includes(formulaHelpSearch.toLowerCase());
                          if (!matchesSearch) return false;

                          if (c.scope === 'global') return true;
                          if (c.scope === 'category' && c.category && c.category !== item.category) return false;
                          if (c.scope === 'subcategory' && (c.category !== item.category || c.subCategory !== item.sub_category)) return false;
                          if (c.scope === 'itemgroup' && (c.category !== item.category || c.subCategory !== item.sub_category || c.itemGroup !== (item.sub_item_1 || ''))) return false;
                          if (c.scope === 'material' && (c.category !== item.category || c.subCategory !== item.sub_category || c.itemGroup !== (item.sub_item_1 || ''))) return false;
                          
                          return true;
                        }).map(c => (
                          <div key={c.id} className="flex items-start justify-between group bg-blue-50 hover:bg-blue-100 p-2 rounded border border-blue-200 transition">
                            <div className="flex-1 pr-2">
                              <div className="font-mono text-xs font-bold text-blue-700">[{c.key}]</div>
                              <div className="text-[10px] text-slate-500 mb-1">{c.name} ({c.scope})</div>
                              <div className="text-[9px] text-slate-400 font-mono bg-white px-1 py-0.5 rounded border border-slate-100 inline-block">Type: {c.dataType}</div>
                            </div>
                            <button 
                              onClick={() => insertText(`[${c.key}]`)} 
                              className="text-xs bg-white hover:bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-200 opacity-0 group-hover:opacity-100 transition shrink-0"
                            >
                              Insert
                            </button>
                          </div>
                        ))}

                        {/* Custom Variables */}
                        {customVariables.filter(v => 
                          v.name.toLowerCase().includes(formulaHelpSearch.toLowerCase()) || 
                          (v.description && v.description.toLowerCase().includes(formulaHelpSearch.toLowerCase()))
                        ).map(v => (
                          <div key={v.id} className="flex items-start justify-between group bg-amber-50 hover:bg-amber-100 p-2 rounded border border-amber-200 transition">
                            <div className="flex-1 pr-2">
                              <div className="font-mono text-xs font-bold text-amber-700">[{v.name}]</div>
                              <div className="text-[10px] text-slate-500 mb-1">{v.description || 'Custom variable'}</div>
                              <div className="text-[9px] text-slate-400 font-mono bg-white px-1 py-0.5 rounded border border-slate-100 inline-block">Value: {v.value}</div>
                            </div>
                            <button 
                              onClick={() => insertText(`[${v.name}]`)} 
                              className="text-xs bg-white hover:bg-amber-50 text-amber-600 px-2 py-1 rounded border border-amber-200 opacity-0 group-hover:opacity-100 transition shrink-0"
                            >
                              Insert
                            </button>
                          </div>
                        ))}
                        
                        {/* Formula Templates Section */}
                        <div className="mt-4 border-t pt-4">
                          <h5 className="text-xs font-bold text-slate-500 uppercase mb-2">Formula Templates</h5>
                          <div className="flex flex-col gap-2">
                            {formulaTemplates.length === 0 ? (
                              <div className="text-[10px] text-slate-400 italic p-2 bg-slate-50 rounded border border-dashed border-slate-200">No templates available.</div>
                            ) : (() => {
                              const item = catalog.find(i => i.item_id === qtyPanelItemId);
                              return formulaTemplates
                                .filter(t => {
                                  if (t.scope === 'global') return true;
                                  if (!item) return false;
                                  if (t.scope === 'category' && t.name.includes(item.category)) return true; // Simple check for now
                                  return true; // Show all for now, filter logic can be improved
                                })
                                .map(t => (
                                <div key={t.id} className="flex items-start justify-between group bg-indigo-50 hover:bg-indigo-100 p-2 rounded border border-indigo-200 transition">
                                  <div className="flex-1 pr-2">
                                    <div className="font-bold text-xs text-indigo-800">{t.name}</div>
                                    <div className="text-[10px] text-slate-500 mb-1 truncate max-w-[150px]">{t.formula}</div>
                                    <div className="flex flex-wrap gap-1">
                                      {t.variables.map(v => (
                                        <span key={v} className="text-[8px] bg-white text-indigo-500 px-1 rounded border border-indigo-100">{v}</span>
                                      ))}
                                    </div>
                                  </div>
                                  <button 
                                    onClick={() => {
                                      if (t.variables.length > 0) {
                                        setTemplateToApply(t);
                                        const initialMappings = autoMapVariables(t, item);
                                        setVariableMappings(initialMappings);
                                        setMappingModalOpen(true);
                                      } else {
                                        setCustomFormula(t.formula);
                                      }
                                    }}
                                    className="text-xs bg-white hover:bg-indigo-50 text-indigo-600 px-2 py-1 rounded border border-indigo-200 opacity-0 group-hover:opacity-100 transition shrink-0"
                                  >
                                    Apply
                                  </button>
                                </div>
                              ));
                            })()}
                          </div>
                        </div>

                        {/* Predefined Variables */}
                        {FORMULA_VARIABLES.filter(v => 
                          v.name.toLowerCase().includes(formulaHelpSearch.toLowerCase()) || 
                          v.description.toLowerCase().includes(formulaHelpSearch.toLowerCase())
                        ).map(v => (
                          <div key={v.name} className="flex items-start justify-between group bg-slate-50 hover:bg-slate-100 p-2 rounded border border-slate-200 transition">
                            <div className="flex-1 pr-2">
                              <div className="font-mono text-xs font-bold text-slate-700">{v.name}</div>
                              <div className="text-[10px] text-slate-500 mb-1">{v.description}</div>
                              <div className="text-[9px] text-slate-400 font-mono bg-white px-1 py-0.5 rounded border border-slate-100 inline-block">Ex: {v.example}</div>
                            </div>
                            <button 
                              onClick={() => insertText(v.insert)} 
                              className="text-xs bg-white hover:bg-emerald-50 text-emerald-600 px-2 py-1 rounded border border-emerald-200 opacity-0 group-hover:opacity-100 transition shrink-0"
                            >
                              Insert
                            </button>
                          </div>
                        ))}
                        {FORMULA_VARIABLES.filter(v => 
                          v.name.toLowerCase().includes(formulaHelpSearch.toLowerCase()) || 
                          v.description.toLowerCase().includes(formulaHelpSearch.toLowerCase())
                        ).length === 0 && (
                          <div className="text-xs text-slate-400 italic p-2">No variables found</div>
                        )}
                      </div>
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-slate-500 uppercase mb-2 sticky top-0 bg-white py-1">Functions</h5>
                      <div className="flex flex-col gap-2">
                        {FORMULA_FUNCTIONS.filter(f => 
                          f.name.toLowerCase().includes(formulaHelpSearch.toLowerCase()) || 
                          f.description.toLowerCase().includes(formulaHelpSearch.toLowerCase())
                        ).map(f => (
                          <div key={f.name} className="flex items-start justify-between group bg-blue-50/50 hover:bg-blue-50 p-2 rounded border border-blue-100 transition">
                            <div className="flex-1 pr-2">
                              <div className="font-mono text-xs font-bold text-blue-700">{f.name}</div>
                              <div className="text-[10px] text-slate-500 mb-1">{f.description}</div>
                              <div className="text-[9px] text-slate-400 font-mono bg-white px-1 py-0.5 rounded border border-slate-100 inline-block">Ex: {f.example}</div>
                            </div>
                            <button 
                              onClick={() => insertText(f.insert)} 
                              className="text-xs bg-white hover:bg-blue-100 text-blue-600 px-2 py-1 rounded border border-blue-200 opacity-0 group-hover:opacity-100 transition shrink-0"
                            >
                              Insert
                            </button>
                          </div>
                        ))}
                        {FORMULA_FUNCTIONS.filter(f => 
                          f.name.toLowerCase().includes(formulaHelpSearch.toLowerCase()) || 
                          f.description.toLowerCase().includes(formulaHelpSearch.toLowerCase())
                        ).length === 0 && (
                          <div className="text-xs text-slate-400 italic p-2">No functions found</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
                
                <div className="mt-2 bg-slate-50 p-3 rounded text-xs text-slate-600 border border-slate-200">
                  <p className="font-bold mb-1">💡 Formula Guide:</p>
                  <ul className="list-disc pl-4 space-y-1">
                    <li>Use standard math operators: <code className="bg-white px-1 rounded border">+</code> <code className="bg-white px-1 rounded border">-</code> <code className="bg-white px-1 rounded border">*</code> <code className="bg-white px-1 rounded border">/</code> <code className="bg-white px-1 rounded border">( )</code></li>
                    <li>Example: <code className="bg-white px-1 rounded border">ROUNDUP([Take-off] * (1 + [Overage %]/100) / [Order], 0)</code></li>
                    <li>Condition Example: <code className="bg-white px-1 rounded border">IF([Take-off] &gt; 0, MAX([Take-off], 10), 0)</code></li>
                  </ul>
                </div>

                {(() => {
                  const item = catalog.find(i => i.item_id === qtyPanelItemId);
                  const previewResult = evaluateCustomFormula(
                    customFormula, 
                    takeoffData[qtyPanelItemId]?.qty || 0, 
                    takeoffData[qtyPanelItemId]?.overage_pct !== "" && takeoffData[qtyPanelItemId]?.overage_pct !== undefined ? takeoffData[qtyPanelItemId]?.overage_pct : defaultOveragePct, 
                    takeoffData[qtyPanelItemId]?.order_qty || 1,
                    customVariables,
                    resolveDynamicScope(item)
                  );
                  const isError = typeof previewResult === 'string' && previewResult.startsWith('ERR');
                  return (
                    <div className={`p-3 rounded text-sm font-bold ${isError ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800'}`}>
                      Preview: <span>{previewResult.toString()}</span>
                    </div>
                  );
                })()}
              </div>
            ) : qtyMode === 'manual' ? (
              <div className="space-y-4">
                <div className="bg-amber-50 border border-amber-200 p-4 rounded text-sm text-amber-800">
                  <p className="font-bold mb-1">Manual Override Active</p>
                  <p>The calculation engine is disabled for this item. Enter the final quantity directly below.</p>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Final Quantity</label>
                  <input 
                    type="text" 
                    value={manualQty} 
                    onChange={(e) => setManualQty(e.target.value)}
                    className="w-full border-2 border-amber-400 rounded p-3 text-lg font-bold outline-none focus:border-amber-600"
                    placeholder="Enter final quantity..."
                    autoFocus
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                <div className="bg-indigo-50 border border-indigo-200 p-4 rounded text-sm text-indigo-800">
                  <p className="font-bold mb-2 flex items-center gap-2">
                    <BookOpen size={16} /> Formula Calculation Guide
                  </p>
                  <p>Learn how to use the calculation engine to automate your take-offs.</p>
                </div>

                <div className="space-y-6">
                  <section>
                    <h4 className="text-sm font-bold text-slate-700 border-b pb-1 mb-2">1. Basic Syntax</h4>
                    <p className="text-xs text-slate-600 mb-2">Use standard mathematical operators and parentheses to group operations.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-50 p-2 rounded border text-[11px]">
                        <span className="font-mono font-bold text-indigo-600">+ - * / ^</span>
                        <span className="ml-2 text-slate-500">Basic Operators</span>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px]">
                        <span className="font-mono font-bold text-indigo-600">( )</span>
                        <span className="ml-2 text-slate-500">Parentheses</span>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-sm font-bold text-slate-700 border-b pb-1 mb-2">2. Built-in Variables</h4>
                    <p className="text-xs text-slate-600 mb-2">These variables are automatically available for every material.</p>
                    <div className="space-y-2">
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between">
                        <code className="font-bold text-blue-700">[Take-off]</code>
                        <span className="text-slate-500">The measured quantity from the main table.</span>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between">
                        <code className="font-bold text-blue-700">[Overage %]</code>
                        <span className="text-slate-500">The waste factor percentage (e.g., 10 for 10%).</span>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between">
                        <code className="font-bold text-blue-700">[Order]</code>
                        <span className="text-slate-500">The packaging or divisor value.</span>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-sm font-bold text-slate-700 border-b pb-1 mb-2">3. Dynamic & Custom Variables</h4>
                    <p className="text-xs text-slate-600 mb-2">Use variables from your custom columns or global variables.</p>
                    <div className="bg-slate-50 p-3 rounded border text-[11px] space-y-2">
                      <p>Variables must be enclosed in square brackets: <code className="bg-white px-1 border rounded text-indigo-600 font-bold">[MyVariable]</code></p>
                      <p className="text-slate-500 italic">Note: Variable keys are case-sensitive and must match exactly.</p>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-sm font-bold text-slate-700 border-b pb-1 mb-2">4. Common Functions</h4>
                    <p className="text-xs text-slate-600 mb-2">Use these functions for advanced rounding and logic.</p>
                    <div className="grid grid-cols-1 gap-2">
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between items-center">
                        <div><code className="font-bold text-emerald-700">ceil(x)</code> <span className="text-slate-400 ml-1">Round up</span></div>
                        <code className="text-slate-500">ceil(10.2) = 11</code>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between items-center">
                        <div><code className="font-bold text-emerald-700">floor(x)</code> <span className="text-slate-400 ml-1">Round down</span></div>
                        <code className="text-slate-500">floor(10.8) = 10</code>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between items-center">
                        <div><code className="font-bold text-emerald-700">round(x, n)</code> <span className="text-slate-400 ml-1">Round to n decimals</span></div>
                        <code className="text-slate-500">round(10.556, 2) = 10.56</code>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between items-center">
                        <div><code className="font-bold text-emerald-700">abs(x)</code> <span className="text-slate-400 ml-1">Absolute value</span></div>
                        <code className="text-slate-500">abs(-5) = 5</code>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between items-center">
                        <div><code className="font-bold text-emerald-700">min(a, b, ...)</code> <span className="text-slate-400 ml-1">Minimum value</span></div>
                        <code className="text-slate-500">min(5, 2, 8) = 2</code>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between items-center">
                        <div><code className="font-bold text-emerald-700">max(a, b, ...)</code> <span className="text-slate-400 ml-1">Maximum value</span></div>
                        <code className="text-slate-500">max(5, 2, 8) = 8</code>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px] flex justify-between items-center">
                        <div><code className="font-bold text-emerald-700">IF(cond, t, f)</code> <span className="text-slate-400 ml-1">Conditional logic</span></div>
                        <code className="text-slate-500">IF(1 &gt; 0, 10, 5) = 10</code>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-sm font-bold text-slate-700 border-b pb-1 mb-2">5. Logical Operators</h4>
                    <p className="text-xs text-slate-600 mb-2">Use these inside IF functions to compare values.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="bg-slate-50 p-2 rounded border text-[11px]">
                        <span className="font-mono font-bold text-indigo-600">== !=</span>
                        <span className="ml-2 text-slate-500">Equal / Not Equal</span>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px]">
                        <span className="font-mono font-bold text-indigo-600">&gt; &lt; &gt;= &lt;=</span>
                        <span className="ml-2 text-slate-500">Comparisons</span>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px]">
                        <span className="font-mono font-bold text-indigo-600">and or not</span>
                        <span className="ml-2 text-slate-500">Logical AND / OR / NOT</span>
                      </div>
                      <div className="bg-slate-50 p-2 rounded border text-[11px]">
                        <span className="font-mono font-bold text-indigo-600">&amp;&amp; || !</span>
                        <span className="ml-2 text-slate-500">Alternative Logic</span>
                      </div>
                    </div>
                  </section>

                  <section>
                    <h4 className="text-sm font-bold text-slate-700 border-b pb-1 mb-2">6. Examples</h4>
                    <div className="space-y-3">
                      <div className="bg-slate-50 p-3 rounded border">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Standard with Overage</p>
                        <code className="text-xs font-bold text-indigo-600 block mb-1">[Take-off] * (1 + [Overage %] / 100)</code>
                        <p className="text-[10px] text-slate-500">Calculates take-off plus waste percentage.</p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded border">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Rounding Up to Full Packages</p>
                        <code className="text-xs font-bold text-indigo-600 block mb-1">ceil([Take-off] / [Order])</code>
                        <p className="text-[10px] text-slate-500">Divides take-off by package size and rounds up to the next whole number.</p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded border">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Complex Logic</p>
                        <code className="text-xs font-bold text-indigo-600 block mb-1">max(10, [Take-off] * 1.1)</code>
                        <p className="text-[10px] text-slate-500">Ensures a minimum of 10 units, or 110% of take-off, whichever is greater.</p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded border">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Conditional Logic (IF)</p>
                        <code className="text-xs font-bold text-indigo-600 block mb-1">IF([Take-off] &gt; 100, [Take-off] * 1.05, [Take-off] * 1.15)</code>
                        <p className="text-[10px] text-slate-500">If take-off is over 100, add 5% waste, otherwise add 15% waste.</p>
                      </div>
                      <div className="bg-slate-50 p-3 rounded border">
                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Nested IF & Comparisons</p>
                        <code className="text-xs font-bold text-indigo-600 block mb-1">IF([Category] == &quot;Lumber&quot;, [Take-off] * 1.1, [Take-off])</code>
                        <p className="text-[10px] text-slate-500">Only add 10% waste if the item category is &quot;Lumber&quot;.</p>
                      </div>
                    </div>
                  </section>
                </div>
              </div>
            )}
            
            <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
              <button onClick={closeQtyPanel} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded transition">Close</button>
              <button onClick={saveQtyPanel} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition shadow-sm">Apply & Calculate</button>
            </div>
          </div>
        </div>
      )}

      {/* Item Config Modal */}
      {itemModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-60 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-xl p-6 border-t-4 border-blue-600">
            <h2 className="text-xl font-bold mb-4">{itemModalMode === 'edit' ? 'Advanced Edit Material' : 'Add New Material'}</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-blue-800 mb-1">Category (L1)</label>
                <div className="flex gap-2">
                  {!isNewCategory ? (
                    <select 
                      value={modCategory} 
                      onChange={(e) => {
                        if (e.target.value === '__NEW__') {
                          setIsNewCategory(true);
                          setModCategory("");
                        } else {
                          setModCategory(e.target.value);
                          setModSubCategory("");
                        }
                      }} 
                      className="w-full border p-2 rounded focus:border-blue-500 outline-none"
                    >
                      {getUniqueVals(catalog, 'category').map(c => <option key={c} value={c}>{c}</option>)}
                      <option value="__NEW__" className="font-bold text-blue-600 bg-blue-50">+ Create New...</option>
                    </select>
                  ) : (
                    <>
                      <input 
                        type="text" 
                        value={modCategory} 
                        onChange={(e) => setModCategory(e.target.value)} 
                        className="w-full border border-blue-400 p-2 rounded focus:ring-2 focus:ring-blue-200 outline-none" 
                        autoFocus
                      />
                      <button onClick={() => { setIsNewCategory(false); setModCategory(getUniqueVals(catalog, 'category')[0] || ""); }} className="px-3 bg-slate-200 rounded hover:bg-slate-300"><X size={16}/></button>
                    </>
                  )}
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-blue-800 mb-1">Sub-Category (L2)</label>
                <div className="flex gap-2">
                  {!isNewSubCategory ? (
                    <select 
                      value={modSubCategory} 
                      onChange={(e) => {
                        if (e.target.value === '__NEW__') {
                          setIsNewSubCategory(true);
                          setModSubCategory("");
                        } else {
                          setModSubCategory(e.target.value);
                          setModSubItem1("");
                        }
                      }} 
                      className="w-full border p-2 rounded focus:border-blue-500 outline-none"
                    >
                      {getUniqueVals(catalog.filter(i => i.category === modCategory), 'sub_category').map(c => <option key={c} value={c}>{c}</option>)}
                      <option value="__NEW__" className="font-bold text-blue-600 bg-blue-50">+ Create New...</option>
                    </select>
                  ) : (
                    <>
                      <input 
                        type="text" 
                        value={modSubCategory} 
                        onChange={(e) => setModSubCategory(e.target.value)} 
                        className="w-full border border-blue-400 p-2 rounded focus:ring-2 focus:ring-blue-200 outline-none" 
                        autoFocus
                      />
                      <button onClick={() => { setIsNewSubCategory(false); setModSubCategory(""); }} className="px-3 bg-slate-200 rounded hover:bg-slate-300"><X size={16}/></button>
                    </>
                  )}
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-emerald-800 mb-1">Sub-Item Group (L3)</label>
                <div className="flex gap-2">
                  {!isNewSubItem1 ? (
                    <select 
                      value={modSubItem1} 
                      onChange={(e) => {
                        if (e.target.value === '__NEW__') {
                          setIsNewSubItem1(true);
                          setModSubItem1("");
                        } else {
                          setModSubItem1(e.target.value);
                        }
                      }} 
                      className="w-full border p-2 rounded focus:border-emerald-500 outline-none"
                    >
                      {getUniqueVals(catalog.filter(i => i.category === modCategory && i.sub_category === modSubCategory), 'sub_item_1').map(c => <option key={c} value={c}>{c}</option>)}
                      <option value="__NEW__" className="font-bold text-blue-600 bg-blue-50">+ Create New...</option>
                    </select>
                  ) : (
                    <>
                      <input 
                        type="text" 
                        value={modSubItem1} 
                        onChange={(e) => setModSubItem1(e.target.value)} 
                        className="w-full border border-emerald-400 p-2 rounded focus:ring-2 focus:ring-emerald-200 outline-none" 
                        autoFocus
                      />
                      <button onClick={() => { setIsNewSubItem1(false); setModSubItem1(""); }} className="px-3 bg-slate-200 rounded hover:bg-slate-300"><X size={16}/></button>
                    </>
                  )}
                </div>
              </div>
              
              <div className="pt-4 border-t">
                <label className="block text-xs font-bold text-slate-800">MATERIAL NAME (L4)</label>
                <input 
                  type="text" 
                  value={modItemName}
                  onChange={(e) => setModItemName(e.target.value)}
                  className="w-full border p-2 rounded font-bold focus:border-blue-500 outline-none" 
                />
              </div>
              
              <div className="flex gap-3">
                <div className="w-1/4">
                  <label className="block text-xs font-bold text-slate-700">UOM</label>
                  <input 
                    type="text" 
                    value={modUOM}
                    onChange={(e) => setModUOM(e.target.value)}
                    className="w-full border p-2 rounded focus:border-blue-500 outline-none" 
                  />
                </div>
                <div className="w-3/4">
                  <label className="block text-xs font-bold text-slate-700">Rule & OVERAGE %</label>
                  <input 
                    type="text" 
                    value={modRule}
                    onChange={(e) => setModRule(e.target.value)}
                    className="w-full border p-2 rounded focus:border-blue-500 outline-none" 
                  />
                </div>
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-700">Notes</label>
                <textarea 
                  value={modNotes}
                  onChange={(e) => setModNotes(e.target.value)}
                  className="w-full border p-2 rounded h-20 focus:border-blue-500 outline-none"
                ></textarea>
              </div>
            </div>
            
            <div className="mt-6 flex justify-between pt-4 border-t">
              {itemModalMode === 'edit' ? (
                <button onClick={deleteItem} className="text-red-600 hover:text-red-800 font-bold flex items-center gap-1 transition">
                  <Trash2 size={16} /> Delete
                </button>
              ) : <div></div>}
              <div className="flex gap-3">
                <button onClick={() => setItemModalOpen(false)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded transition">Cancel</button>
                <button onClick={saveItem} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition shadow-sm">Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* New Project Modal */}
      {newProjectModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 border-t-4 border-emerald-500">
            <h2 className="text-xl font-bold mb-4">Create New Project</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Project Name</label>
                <input 
                  type="text" 
                  value={newProjectData.name}
                  onChange={(e) => setNewProjectData({...newProjectData, name: e.target.value})}
                  className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-emerald-200 outline-none"
                  placeholder="e.g. Acme Corp HQ"
                />
              </div>
              
              <div>
                <div className="flex justify-between items-end mb-1">
                  <label className="block text-sm font-bold text-slate-700">Client Name</label>
                  <button onClick={() => setClientModalOpen(true)} className="text-[10px] font-bold text-emerald-600 hover:text-emerald-800 uppercase">
                    Manage Clients
                  </button>
                </div>
                <div className="relative">
                  <select
                    value={newProjectData.client}
                    onChange={(e) => setNewProjectData({...newProjectData, client: e.target.value})}
                    className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-emerald-200 outline-none appearance-none bg-white"
                  >
                    <option value="">-- Select Client --</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                  <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-slate-500">
                    <ChevronDown size={16} />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Description</label>
                <textarea 
                  value={newProjectData.description}
                  onChange={(e) => setNewProjectData({...newProjectData, description: e.target.value})}
                  className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-emerald-200 outline-none"
                  placeholder="Project details..."
                  rows={2}
                />
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1">Start from Template</label>
                <select 
                  value={newProjectData.templateId}
                  onChange={(e) => setNewProjectData({...newProjectData, templateId: e.target.value})}
                  className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-emerald-200 outline-none"
                >
                  <option value="">-- Blank Project --</option>
                  {templates.length > 0 && <optgroup label="Global Templates">
                    {templates.filter(t => t.type === 'global').map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>}
                  {templates.length > 0 && <optgroup label="Personal Templates">
                    {templates.filter(t => t.type === 'personal').map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </optgroup>}
                </select>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3 pt-4 border-t">
              <button onClick={() => setNewProjectModalOpen(false)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded transition">Cancel</button>
              <button onClick={createNewProject} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition shadow-sm">Create Project</button>
            </div>
          </div>
        </div>
      )}

      {/* Template Modal */}
      {templateModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-60 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-3xl p-6 max-h-[80vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Project Templates</h2>
              <button onClick={() => setTemplateModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={24} />
              </button>
            </div>
            
            <div className="overflow-y-auto flex-1 border rounded p-4 bg-slate-50">
              {templates.length === 0 ? (
                <div className="text-center py-8 text-slate-500">
                  <FileJson size={48} className="mx-auto mb-3 opacity-20" />
                  <p>No templates saved yet.</p>
                  <p className="text-sm mt-1">Save your current project as a template to see it here.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {templates.map(t => (
                    <div key={t.id} className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-bold text-lg text-slate-800">{t.name}</h3>
                        <span className={`text-xs px-2 py-1 rounded-full font-bold ${t.type === 'global' ? 'bg-indigo-100 text-indigo-700' : 'bg-emerald-100 text-emerald-700'}`}>
                          {t.type === 'global' ? 'Global' : 'Personal'}
                        </span>
                      </div>
                      <p className="text-sm text-slate-600 mb-4 flex-1">{t.description || "No description provided."}</p>
                      
                      <div className="flex justify-between items-center mt-auto pt-3 border-t border-slate-100">
                        <span className="text-xs text-slate-400">
                          {new Date(t.createdAt).toLocaleDateString()}
                        </span>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => deleteTemplate(t.id)}
                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded transition"
                            title="Delete Template"
                          >
                            <Trash2 size={16} />
                          </button>
                          <button 
                            onClick={() => loadTemplate(t.id)}
                            className="bg-emerald-100 hover:bg-emerald-200 text-emerald-700 px-3 py-1.5 rounded text-sm font-bold transition"
                          >
                            Use Template
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* History Modal */}
      {historyModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-60 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl p-6 max-h-[80vh] flex flex-col">
            <h2 className="text-xl font-bold mb-4">Restore Point</h2>
            <div className="overflow-y-auto flex-1 border rounded">
              <table className="w-full text-left">
                <tbody className="divide-y">
                  {actionHistory.length === 0 ? (
                    <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500 font-medium">No history recorded yet.</td></tr>
                  ) : (
                    actionHistory.map((record, index) => (
                      <tr key={index} className={`${index === historyIndex ? 'bg-emerald-100 hover:bg-emerald-200' : 'hover:bg-blue-50'} transition-colors`}>
                        <td className="px-4 py-3 text-xs text-slate-500">{new Date(record.timestamp).toLocaleTimeString()}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">
                          {record.action} {index === historyIndex && <span className="ml-2 text-[10px] bg-emerald-500 text-white px-2 py-0.5 rounded-full">CURRENT</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button 
                            onClick={() => restoreHistory(index)} 
                            disabled={index === historyIndex}
                            className={`font-bold text-xs px-3 py-1.5 rounded transition shadow-sm ${index === historyIndex ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'text-blue-700 bg-blue-100 hover:bg-blue-200'}`}
                          >
                            Restore
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <button onClick={() => setHistoryModalOpen(false)} className="mt-4 bg-slate-200 hover:bg-slate-300 py-2 rounded font-bold transition">Close</button>
          </div>
        </div>
      )}

      {/* BOM Export Modal */}
      {bomExportModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-[70]">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 border-t-4 border-blue-600">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                <Download className="text-blue-600" size={24} /> Export BOM Options
              </h2>
              <button onClick={() => setBomExportModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            
            <div className="space-y-4 mb-6">
              <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                <h3 className="text-sm font-bold text-slate-700 mb-3 uppercase tracking-wider">Column Customization</h3>
                <div className="grid grid-cols-1 gap-3">
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={bomExportOptions.includeSpec}
                      onChange={(e) => setBomExportOptions({...bomExportOptions, includeSpec: e.target.checked})}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 transition-colors">Include &apos;Spec&apos; Column</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={bomExportOptions.includeOveragePct}
                      onChange={(e) => setBomExportOptions({...bomExportOptions, includeOveragePct: e.target.checked})}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 transition-colors">Include &apos;OVERAGE %&apos; Column</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={bomExportOptions.includeOrderQty}
                      onChange={(e) => setBomExportOptions({...bomExportOptions, includeOrderQty: e.target.checked})}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 transition-colors">Include &apos;Order&apos; Column</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer group">
                    <input 
                      type="checkbox" 
                      checked={bomExportOptions.includeReference}
                      onChange={(e) => setBomExportOptions({...bomExportOptions, includeReference: e.target.checked})}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span className="text-sm font-medium text-slate-700 group-hover:text-blue-600 transition-colors">Include &apos;REFERENCE&apos; Column</span>
                  </label>
                </div>
              </div>

              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                <h3 className="text-sm font-bold text-blue-800 mb-3 uppercase tracking-wider">Filter Options</h3>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={bomExportOptions.onlyInScope}
                    onChange={(e) => setBomExportOptions({...bomExportOptions, onlyInScope: e.target.checked})}
                    className="w-4 h-4 rounded border-blue-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm font-bold text-blue-900 group-hover:text-blue-700 transition-colors">Export Only &apos;In Scope&apos; Items</span>
                </label>
                <p className="text-[10px] text-blue-600 mt-2 ml-7 italic">
                  When enabled, items marked as &quot;Out of Scope&quot; will be excluded from the CSV.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button 
                onClick={() => setBomExportModalOpen(false)} 
                className="flex-1 px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded transition border border-slate-200"
              >
                Cancel
              </button>
              <button 
                onClick={performBOMExport} 
                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-bold transition shadow-md flex items-center justify-center gap-2"
              >
                <Download size={18} /> Generate CSV
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Data Table Modal */}
      {dataTableModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-60 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-5xl p-6 max-h-[90vh] flex flex-col">
            <div className="flex justify-between items-center mb-4">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-bold">Manage Data Tables</h2>
                <div className="flex items-center gap-2 border-l pl-4">
                  <button 
                    onClick={exportDataTables}
                    title="Export Tables to JSON"
                    className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded transition"
                  >
                    <FileJson size={18} />
                  </button>
                  <label className="p-1.5 text-slate-500 hover:text-emerald-600 hover:bg-emerald-50 rounded transition cursor-pointer" title="Import Tables from JSON">
                    <Upload size={18} />
                    <input type="file" className="hidden" accept=".json" onChange={importDataTables} />
                  </label>
                </div>
              </div>
              <button onClick={() => { setDataTableModalOpen(false); setEditingDataTable(null); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
            </div>
            
            <div className="flex flex-1 gap-6 overflow-hidden">
              {/* Table List */}
              <div className="w-1/4 border-r pr-4 overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-bold text-slate-700">Tables</h3>
                  <button 
                    onClick={() => {
                      const name = window.prompt("Enter Table Name:");
                      if (name) {
                        const newTable: DataTable = {
                          id: "DT-" + Date.now(),
                          name,
                          columns: [{ name: "ID", key: "id", type: "string" }],
                          rows: []
                        };
                        const nextTables: DataTable[] = [...dataTables, newTable];
                        setDataTables(nextTables);
                        setEditingDataTable(newTable);
                        localStorage.setItem('userDataTables', JSON.stringify(nextTables));
                        recordHistory(`Added data table ${name}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, formulaTemplates, nextTables);
                      }
                    }}
                    className="text-emerald-600 hover:text-emerald-700"
                  >
                    <Plus size={20} />
                  </button>
                </div>
                <div className="space-y-2">
                  {dataTables.map(dt => (
                    <div 
                      key={dt.id}
                      onClick={() => setEditingDataTable(dt)}
                      className={`p-3 rounded border cursor-pointer transition-colors flex justify-between items-center ${editingDataTable?.id === dt.id ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'hover:bg-slate-50 border-slate-200'}`}
                    >
                      <span className="font-medium truncate">{dt.name}</span>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          if (window.confirm(`Delete table ${dt.name}?`)) {
                            const nextTables: DataTable[] = dataTables.filter(t => t.id !== dt.id);
                            setDataTables(nextTables);
                            if (editingDataTable?.id === dt.id) setEditingDataTable(null);
                            localStorage.setItem('userDataTables', JSON.stringify(nextTables));
                            recordHistory(`Deleted data table ${dt.name}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, formulaTemplates, nextTables);
                          }
                        }}
                        className="text-slate-400 hover:text-red-500"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              
              {/* Table Editor */}
              <div className="flex-1 overflow-hidden flex flex-col">
                {editingDataTable ? (
                  <>
                    <div className="flex justify-between items-center mb-4">
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-lg">{editingDataTable.name}</h3>
                        <button 
                          onClick={() => {
                            const newName = window.prompt("Rename Table:", editingDataTable.name);
                            if (newName && newName !== editingDataTable.name) {
                              const nextTables: DataTable[] = dataTables.map(t => t.id === editingDataTable.id ? { ...t, name: newName } : t);
                              setDataTables(nextTables);
                              setEditingDataTable({ ...editingDataTable, name: newName });
                              localStorage.setItem('userDataTables', JSON.stringify(nextTables));
                              recordHistory(`Renamed table ${editingDataTable.name} to ${newName}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, formulaTemplates, nextTables);
                            }
                          }}
                          className="text-slate-400 hover:text-slate-600"
                        >
                          <Edit2 size={14} />
                        </button>
                      </div>
                      <div className="flex gap-2">
                        <button 
                          onClick={() => {
                            const colName = window.prompt("Column Name:");
                            if (colName) {
                              const colKey = colName.trim().replace(/\s+/g, '_');
                              const colType = window.confirm("Is this a number column? (OK for Number, Cancel for Text)") ? 'number' : 'string';
                              const nextTables: DataTable[] = dataTables.map(t => {
                                if (t.id === editingDataTable.id) {
                                  return { ...t, columns: [...t.columns, { name: colName, key: colKey, type: colType as 'string' | 'number' }] };
                                }
                                return t;
                              });
                              setDataTables(nextTables);
                              setEditingDataTable(nextTables.find(t => t.id === editingDataTable.id)!);
                              localStorage.setItem('userDataTables', JSON.stringify(nextTables));
                              recordHistory(`Added column ${colName} to ${editingDataTable.name}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, formulaTemplates, nextTables);
                            }
                          }}
                          className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1 rounded text-xs font-bold flex items-center gap-1"
                        >
                          <Plus size={14} /> Add Column
                        </button>
                        <button 
                          onClick={() => {
                            const nextTables: DataTable[] = dataTables.map(t => {
                              if (t.id === editingDataTable.id) {
                                const newRow: Record<string, any> = {};
                                t.columns.forEach(c => newRow[c.key] = c.type === 'number' ? 0 : '');
                                return { ...t, rows: [...t.rows, newRow] };
                              }
                              return t;
                            });
                            setDataTables(nextTables);
                            setEditingDataTable(nextTables.find(t => t.id === editingDataTable.id)!);
                            localStorage.setItem('userDataTables', JSON.stringify(nextTables));
                            recordHistory(`Added row to ${editingDataTable.name}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, formulaTemplates, nextTables);
                          }}
                          className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded text-xs font-bold flex items-center gap-1"
                        >
                          <Plus size={14} /> Add Row
                        </button>
                      </div>
                    </div>
                    
                    <div className="flex-1 overflow-auto border rounded bg-white">
                      <table className="w-full text-sm border-collapse">
                        <thead className="bg-slate-50 sticky top-0 z-10">
                          <tr>
                            {editingDataTable.columns.map((col, idx) => (
                              <th key={idx} className="border p-2 text-left font-bold text-slate-600 group">
                                <div className="flex justify-between items-center">
                                  <span>{col.name} <span className="text-[10px] font-normal text-slate-400">({col.type})</span></span>
                                  {col.key !== 'id' && (
                                    <button 
                                      onClick={() => {
                                        if (window.confirm(`Delete column ${col.name}?`)) {
                                          const nextTables: DataTable[] = dataTables.map(t => {
                                            if (t.id === editingDataTable.id) {
                                              return { 
                                                ...t, 
                                                columns: t.columns.filter(c => c.key !== col.key),
                                                rows: t.rows.map(r => {
                                                  const newRow = { ...r };
                                                  delete newRow[col.key];
                                                  return newRow;
                                                })
                                              };
                                            }
                                            return t;
                                          });
                                          setDataTables(nextTables);
                                          setEditingDataTable(nextTables.find(t => t.id === editingDataTable.id)!);
                                          localStorage.setItem('userDataTables', JSON.stringify(nextTables));
                                          recordHistory(`Deleted column ${col.name} from ${editingDataTable.name}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, formulaTemplates, nextTables);
                                        }
                                      }}
                                      className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  )}
                                </div>
                              </th>
                            ))}
                            <th className="border p-2 w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {editingDataTable.rows.map((row, rowIdx) => (
                            <tr key={rowIdx} className="hover:bg-slate-50">
                              {editingDataTable.columns.map((col, colIdx) => (
                                <td key={colIdx} className="border p-1">
                                  <input 
                                    type={col.type === 'number' ? 'number' : 'text'}
                                    value={row[col.key]}
                                    onChange={(e) => {
                                      const val = col.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
                                      const nextTables: DataTable[] = dataTables.map(t => {
                                        if (t.id === editingDataTable.id) {
                                          const nextRows = [...t.rows];
                                          nextRows[rowIdx] = { ...nextRows[rowIdx], [col.key]: val };
                                          return { ...t, rows: nextRows };
                                        }
                                        return t;
                                      });
                                      setDataTables(nextTables);
                                      setEditingDataTable(nextTables.find(t => t.id === editingDataTable.id)!);
                                      // Debounce saving to localStorage and history if needed, but for now direct
                                      localStorage.setItem('userDataTables', JSON.stringify(nextTables));
                                    }}
                                    onBlur={() => {
                                      // Trigger recalculation when data changes
                                      recalculateAffectedItems([], customVariables, entityData, takeoffData, dataTables);
                                      recordHistory(`Updated data in ${editingDataTable.name}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, formulaTemplates, dataTables);
                                    }}
                                    className="w-full p-1 outline-none bg-transparent focus:bg-amber-50"
                                  />
                                </td>
                              ))}
                              <td className="border p-1 text-center">
                                <button 
                                  onClick={() => {
                                    const nextTables: DataTable[] = dataTables.map(t => {
                                      if (t.id === editingDataTable.id) {
                                        return { ...t, rows: t.rows.filter((_, i) => i !== rowIdx) };
                                      }
                                      return t;
                                    });
                                    setDataTables(nextTables);
                                    setEditingDataTable(nextTables.find(t => t.id === editingDataTable.id)!);
                                    localStorage.setItem('userDataTables', JSON.stringify(nextTables));
                                    recordHistory(`Deleted row from ${editingDataTable.name}`, takeoffData, catalog, projectName, clientName, customVariables, jobNotes, dynamicColumns, entityData, formulaTemplates, nextTables);
                                  }}
                                  className="text-slate-300 hover:text-red-500"
                                >
                                  <Trash2 size={14} />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {editingDataTable.rows.length === 0 && (
                        <div className="p-8 text-center text-slate-400 italic">No rows added yet.</div>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col justify-center items-center text-slate-400 bg-slate-50 rounded border border-dashed">
                    <Table size={48} className="mb-4 opacity-20" />
                    <p>Select a table to edit or create a new one.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Auto-save Recovery Modal */}
      {autoSaveModalOpen && autoSaveData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b bg-amber-50">
              <div className="flex items-center gap-3 text-amber-700 mb-2">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Save size={24} />
                </div>
                <h2 className="text-xl font-bold">Auto-save Found</h2>
              </div>
              <p className="text-amber-600 text-sm">
                We found an un-saved session from <strong>{lastAutoSaveTime}</strong>. 
                Would you like to restore it?
              </p>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-lg border text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Project:</span>
                  <span className="font-medium">{autoSaveData.projectName || "Untitled Project"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Items:</span>
                  <span className="font-medium">{Object.keys(autoSaveData.takeoffData || {}).length}</span>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    localStorage.removeItem('autoSavedProject');
                    setAutoSaveModalOpen(false);
                  }}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 font-medium transition"
                >
                  Discard
                </button>
                <button 
                  onClick={() => {
                    setProjectName(autoSaveData.projectName || "");
                    setClientName(autoSaveData.clientName || "");
                    setJobNotes(autoSaveData.jobNotes || "");
                    setTakeoffData(autoSaveData.takeoffData || {});
                    setCustomVariables(autoSaveData.customVariables || []);
                    setDynamicColumns(autoSaveData.dynamicColumns || []);
                    setEntityData(autoSaveData.entityData || {});
                    setFormulaTemplates(autoSaveData.formulaTemplates || []);
                    setDataTables(autoSaveData.dataTables || []);
                    if (autoSaveData.projectTemplates) setTemplates(autoSaveData.projectTemplates);
                    
                    setAutoSaveModalOpen(false);
                    // Clear it after restore to prevent repeated prompts
                    localStorage.removeItem('autoSavedProject');
                  }}
                  className="flex-1 px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-500 font-medium shadow-sm transition"
                >
                  Restore Session
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Template Auto-save Recovery Modal */}
      {autoSaveTemplatesModalOpen && autoSaveTemplatesData && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b bg-indigo-50">
              <div className="flex items-center gap-3 text-indigo-700 mb-2">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <BookOpen size={24} />
                </div>
                <h2 className="text-xl font-bold">Templates Auto-save Found</h2>
              </div>
              <p className="text-indigo-600 text-sm">
                We found an un-saved templates session from <strong>{lastTemplatesAutoSaveTime}</strong>. 
                Would you like to restore your formula and project templates?
              </p>
            </div>
            
            <div className="p-6 space-y-4">
              <div className="bg-slate-50 p-4 rounded-lg border text-sm space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Formula Templates:</span>
                  <span className="font-medium">{autoSaveTemplatesData.formulaTemplates?.length || 0}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Project Templates:</span>
                  <span className="font-medium">{autoSaveTemplatesData.projectTemplates?.length || 0}</span>
                </div>
              </div>
              
              <div className="flex gap-3">
                <button 
                  onClick={() => {
                    localStorage.removeItem('autoSavedTemplates');
                    setAutoSaveTemplatesModalOpen(false);
                  }}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg hover:bg-slate-50 font-medium transition"
                >
                  Discard
                </button>
                <button 
                  onClick={() => {
                    if (autoSaveTemplatesData.formulaTemplates) {
                      setFormulaTemplates(autoSaveTemplatesData.formulaTemplates);
                      localStorage.setItem('formulaTemplates', JSON.stringify(autoSaveTemplatesData.formulaTemplates));
                    }
                    if (autoSaveTemplatesData.projectTemplates) {
                      setTemplates(autoSaveTemplatesData.projectTemplates);
                      localStorage.setItem('projectTemplates', JSON.stringify(autoSaveTemplatesData.projectTemplates));
                    }
                    
                    setAutoSaveTemplatesModalOpen(false);
                    localStorage.removeItem('autoSavedTemplates');
                  }}
                  className="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 font-medium shadow-sm transition"
                >
                  Restore Templates
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Auth Modal */}
      {authModalOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="bg-slate-800 p-6 text-white flex justify-between items-center">
              <h2 className="text-xl font-bold">{authMode === 'login' ? 'Welcome Back' : 'Create Account'}</h2>
              <button onClick={() => setAuthModalOpen(false)} className="text-slate-400 hover:text-white transition-colors">
                <X size={24} />
              </button>
            </div>
            
            <form onSubmit={handleAuth} className="p-8 space-y-6">
              {authError && (
                <div className="bg-red-50 border-l-4 border-red-500 p-4 text-red-700 text-sm font-medium">
                  {authError}
                </div>
              )}
              
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Email Address</label>
                <input 
                  type="email" 
                  required
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-3 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                  placeholder="you@example.com"
                />
              </div>
              
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Password</label>
                <input 
                  type="password" 
                  required
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg p-3 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                  placeholder="••••••••"
                />
              </div>
              
              <button 
                type="submit" 
                disabled={authLoading}
                className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-400 text-white font-bold py-4 rounded-lg shadow-lg transition-all transform hover:-translate-y-0.5 active:translate-y-0"
              >
                {authLoading ? 'Processing...' : (authMode === 'login' ? 'Sign In' : 'Sign Up')}
              </button>
              
              <div className="text-center">
                <button 
                  type="button"
                  onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                  className="text-sm font-bold text-emerald-600 hover:text-emerald-500 transition-colors"
                >
                  {authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
