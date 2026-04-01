"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { defaultCatalog } from '@/lib/default-catalog';
import { evaluateMath, evaluateCustomFormula, validateCustomFormula, DEFAULT_QTY_FORMULA, getUniqueVals } from '@/lib/estimator-utils';
import { Item, TakeoffItem, HistoryRecord, Job, CustomVariable, ProjectTemplate } from '@/lib/types';
import { 
  Home, Plus, Download, Save, Search, History, FileJson, Upload, 
  ChevronDown, ChevronRight, Edit2, Calculator, Hand, Trash2, X,
  Undo2, Redo2
} from 'lucide-react';
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

      const fnRegex = /\b(ROUNDUP|ROUNDDOWN|ROUND|CEILING|FLOOR|MAX|MIN|ABS|SQRT|POWER|IF)\b/g;
      while ((match = fnRegex.exec(text))) {
        widgets.push(Decoration.mark({ class: "text-blue-600 font-bold" }).range(from + match.index, from + match.index + match[0].length));
      }
    }
    return Decoration.set(widgets.sort((a, b) => a.from - b.from));
  }
}, {
  decorations: v => v.decorations
});

const getFormulaCompletions = (customVars: CustomVariable[]) => (context: CompletionContext): CompletionResult | null => {
  let word = context.matchBefore(/\[?[a-zA-Z0-9_ %-]*$/);
  if (!word || (word.from === word.to && !context.explicit))
    return null;
    
  const customVarOptions = customVars.map(cv => ({
    label: `[${cv.name}]`,
    type: 'variable',
    info: `Custom Variable: ${cv.description || 'No description'}. Value: ${cv.value}`,
    apply: `[${cv.name}]`
  }));

  return {
    from: word.from,
    options: [
      ...customVarOptions,
      { label: 'ROUNDUP', type: 'function', info: 'Round up to decimals. Ex: ROUNDUP([Take-off], 0)', apply: 'ROUNDUP(' },
      { label: 'ROUNDDOWN', type: 'function', info: 'Round down to decimals. Ex: ROUNDDOWN([Take-off], 1)', apply: 'ROUNDDOWN(' },
      { label: 'ROUND', type: 'function', info: 'Standard round. Ex: ROUND([Take-off] * 1.1, 2)', apply: 'ROUND(' },
      { label: 'IF', type: 'function', info: 'If condition is true, return first value, else second. Ex: IF([Take-off] > 10, 10, [Take-off])', apply: 'IF(' },
      { label: 'MAX', type: 'function', info: 'Maximum of values. Ex: MAX([Take-off], 5)', apply: 'MAX(' },
      { label: 'MIN', type: 'function', info: 'Minimum of values. Ex: MIN([Take-off], 100)', apply: 'MIN(' },
      { label: 'CEILING', type: 'function', info: 'Round up to nearest integer. Ex: CEILING([Take-off] / [Order])', apply: 'CEILING(' },
      { label: 'FLOOR', type: 'function', info: 'Round down to nearest integer. Ex: FLOOR([Take-off] / [Order])', apply: 'FLOOR(' },
      { label: '[Take-off]', type: 'variable', info: 'Measured Quantity. Ex: [Take-off] * 1.05' },
      { label: '[Overage %]', type: 'variable', info: 'Waste Factor Percentage. Ex: 1 + ([Overage %] / 100)' },
      { label: '[Order]', type: 'variable', info: 'Package/Divisor. Ex: [Take-off] / [Order]' },
      ...customVarOptions
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
  { name: 'MAX', description: 'Maximum of values', insert: 'MAX( , )', example: 'MAX([Take-off], 5)' },
  { name: 'MIN', description: 'Minimum of values', insert: 'MIN( , )', example: 'MIN([Take-off], 100)' },
  { name: 'CEILING', description: 'Round up to nearest integer', insert: 'CEILING( )', example: 'CEILING([Take-off] / [Order])' },
  { name: 'FLOOR', description: 'Round down to nearest integer', insert: 'FLOOR( )', example: 'FLOOR([Take-off] / [Order])' },
];

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
  const [currentJobId, setCurrentJobId] = useState("");
  const [savedJobs, setSavedJobs] = useState<Record<string, Job>>({});

  // Modals state
  const [qtyPanelOpen, setQtyPanelOpen] = useState(false);
  const [qtyPanelItemId, setQtyPanelItemId] = useState("");
  const [qtyMode, setQtyMode] = useState<'auto' | 'manual'>('auto');
  const [customFormula, setCustomFormula] = useState("");
  const [manualQty, setManualQty] = useState("");
  const [customVariables, setCustomVariables] = useState<CustomVariable[]>([]);
  const [customVarModalOpen, setCustomVarModalOpen] = useState(false);
  const [editingCustomVar, setEditingCustomVar] = useState<CustomVariable | null>(null);
  const [formulaHelpSearch, setFormulaHelpSearch] = useState("");

  const formulaCompletions = useMemo(() => getFormulaCompletions(customVariables), [customVariables]);

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
      const validation = validateCustomFormula(doc, customVariables);
      if (!validation.valid) {
        diagnostics.push({
          from: 0,
          to: doc.length,
          severity: 'error',
          message: validation.error || "Invalid formula"
        });
      }
    }

    return diagnostics;
  }), [customVariables]);

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
    const savedCatalog = localStorage.getItem('userItemCatalog');
    if (savedCatalog) {
      setCatalog(JSON.parse(savedCatalog));
    } else {
       
      setCatalog(defaultCatalog);
    }

    const jobs = JSON.parse(localStorage.getItem('savedEstimatingJobs') || '{}');
    setSavedJobs(jobs);
    
    const savedTemplates = localStorage.getItem('projectTemplates');
    if (savedTemplates) {
      setTemplates(JSON.parse(savedTemplates));
    }

    setCurrentJobId("JOB-" + Date.now());
     
    setIsMounted(true);
  }, []);

  const recordHistory = (actionDescription: string, newData = takeoffData, newCatalog = catalog, newProj = projectName, newClient = clientName, newCustomVars = customVariables) => {
    const snapshot: HistoryRecord = {
      timestamp: new Date().toISOString(),
      action: actionDescription,
      dataState: JSON.parse(JSON.stringify(newData)),
      catalogState: JSON.parse(JSON.stringify(newCatalog)),
      projectName: newProj,
      clientName: newClient,
      customVariables: JSON.parse(JSON.stringify(newCustomVars))
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
        JSON.stringify(currentRecord.customVariables) === JSON.stringify(snapshot.customVariables)
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
      if (record.customVariables) setCustomVariables(record.customVariables);
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
      if (record.customVariables) setCustomVariables(record.customVariables);
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
          qty_mode: 'auto', custom_formula: DEFAULT_QTY_FORMULA
        };
      }

      let finalValue = value;
      if (['qty', 'order_qty', 'overage_pct'].includes(field) && typeof value === 'string') {
        const evaluated = evaluateMath(value);
        if (evaluated !== "") finalValue = evaluated;
      }

      newData[itemId] = { ...newData[itemId], [field]: finalValue };

      if (field === 'in_scope' && !finalValue) {
        newData[itemId].qty = "";
        newData[itemId].measured_qty = "";
        newData[itemId].order_qty = "";
      }

      if (['qty', 'overage_pct', 'order_qty'].includes(field)) {
        if (newData[itemId].qty_mode !== 'manual') {
          const formula = newData[itemId].custom_formula || DEFAULT_QTY_FORMULA;
          newData[itemId].measured_qty = evaluateCustomFormula(
            formula,
            newData[itemId].qty,
            newData[itemId].overage_pct,
            newData[itemId].order_qty,
            customVariables
          ).toString();
        }
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
    setCollapsedState(prev => ({ ...prev, [key]: !prev[key] }));
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

  const saveCurrentJob = () => {
    if (!projectName) {
      alert("Please enter a Project Name before saving!");
      return;
    }
    const newJob: Job = {
      projectName,
      clientName,
      takeoffData,
      history: actionHistory,
      lastSaved: new Date().toISOString(),
      customVariables
    };
    const newSavedJobs = { ...savedJobs, [currentJobId]: newJob };
    setSavedJobs(newSavedJobs);
    localStorage.setItem('savedEstimatingJobs', JSON.stringify(newSavedJobs));
    alert("Job Saved Successfully!");
  };

  const saveAsTemplate = () => {
    const templateName = window.prompt("Enter template name:");
    if (!templateName) return;
    
    const templateDesc = window.prompt("Enter template description (optional):") || "";
    const isGlobal = window.confirm("Save as Global Template? (Cancel for Personal)");

    const newTemplate: ProjectTemplate = {
      id: "TPL-" + Date.now(),
      name: templateName,
      description: templateDesc,
      type: isGlobal ? 'global' : 'personal',
      catalog: catalog,
      takeoffData: takeoffData,
      customVariables: customVariables,
      createdAt: new Date().toISOString()
    };

    const newTemplates = [...templates, newTemplate];
    setTemplates(newTemplates);
    localStorage.setItem('projectTemplates', JSON.stringify(newTemplates));
    alert("Template saved successfully!");
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
    setNewProjectModalOpen(false);
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
      setCustomVariables(jobData.customVariables || []);
      setTimeout(() => recordHistory("Loaded Job from Storage", jobData.takeoffData, catalog, jobData.projectName, jobData.clientName, jobData.customVariables || []), 0);
    }
  };

  const exportBOM = () => {
    const projName = projectName || "Unnamed_Job";
    let csvContent = "Category,Sub-Category,Sub-Item Group,MATERIAL,Spec,Take-off,OVERAGE %,Order,Qty,UOM,REFERENCE,Rule / Note\n";
    let hasItems = false;

    for (const [itemId, data] of Object.entries(takeoffData)) {
      if (data.in_scope) {
        hasItems = true;
        const itemInfo = catalog.find(i => i.item_id === itemId);
        if (!itemInfo) continue;

        const escapeCSV = (text: string) => `"${(text || '').toString().replace(/"/g, '""')}"`;
        const fullNotes = itemInfo.calc_factor_instruction + (itemInfo.notes ? " | Note: " + itemInfo.notes : "");
        const row = [
          escapeCSV(itemInfo.category),
          escapeCSV(itemInfo.sub_category),
          escapeCSV(itemInfo.sub_item_1 || "General"),
          escapeCSV(itemInfo.item_name),
          escapeCSV(data.spec),
          escapeCSV(data.qty),
          escapeCSV(data.overage_pct),
          escapeCSV(data.order_qty),
          escapeCSV(data.measured_qty),
          escapeCSV(itemInfo.uom),
          escapeCSV(data.evidence),
          escapeCSV(fullNotes)
        ];
        csvContent += row.join(",") + "\n";
      }
    }

    if (!hasItems) {
      alert("BOM is empty! Please check 'In Scope' for at least one item.");
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
  };

  const exportJobJson = () => {
    const projName = projectName || "Unnamed_Job";
    const fullJobData = {
      jobId: currentJobId,
      projectName: projName,
      clientName: clientName,
      exportDate: new Date().toISOString(),
      takeoffData: takeoffData,
      historyLog: actionHistory,
      catalog: catalog,
      customVariables: customVariables
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
          setCustomVariables(importedData.customVariables || []);
          
          setTimeout(() => recordHistory("Imported Job from JSON File", importedData.takeoffData, importedData.catalog || catalog, importedData.projectName, importedData.clientName, importedData.customVariables || []), 0);
          alert("Job Imported Successfully!");
        }
      } catch (err) {
        alert("Error reading JSON file.");
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
      if (!newData[qtyPanelItemId]) {
        newData[qtyPanelItemId] = {
          in_scope: false, spec: "", qty: "", measured_qty: "",
          overage_pct: "", order_qty: "", evidence: "",
          qty_mode: 'auto', custom_formula: DEFAULT_QTY_FORMULA
        };
      }
      newData[qtyPanelItemId].custom_formula = customFormula;
      newData[qtyPanelItemId].qty_mode = qtyMode;
      
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
      if (!newData[qtyPanelItemId]) {
        newData[qtyPanelItemId] = {
          in_scope: false, spec: "", qty: "", measured_qty: "",
          overage_pct: "", order_qty: "", evidence: "",
          qty_mode: 'auto', custom_formula: DEFAULT_QTY_FORMULA
        };
      }

      newData[qtyPanelItemId].qty_mode = qtyMode;

      if (qtyMode === 'auto') {
        newData[qtyPanelItemId].custom_formula = customFormula;
        newData[qtyPanelItemId].measured_qty = evaluateCustomFormula(
          customFormula,
          newData[qtyPanelItemId].qty,
          newData[qtyPanelItemId].overage_pct,
          newData[qtyPanelItemId].order_qty,
          customVariables
        ).toString();
        setTimeout(() => recordHistory(`Updated Auto Formula for ${itemInfo.item_name}`, newData, catalog, projectName, clientName), 0);
      } else {
        newData[qtyPanelItemId].measured_qty = manualQty;
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

  const openItemModal = (mode: 'add' | 'edit', itemId: string | null = null) => {
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
      setModCategory(getUniqueVals(catalog, 'category')[0] || "");
      setModSubCategory("");
      setModSubItem1("");
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
        <div className="max-w-[98%] mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Home className="text-emerald-400" /> Pro Residential Estimator
            </h1>
            <Clock />
          </div>
          <div className="flex gap-3">
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
        <div className="max-w-[98%] mx-auto px-4 py-3 flex justify-between items-center gap-4">
          <div className="flex items-center gap-2 w-1/4">
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
            <button onClick={saveCurrentJob} className="bg-slate-700 hover:bg-slate-600 text-white px-3 py-2 rounded text-sm font-bold flex items-center gap-1">
              <Save size={16} /> Save
            </button>
            <button onClick={saveAsTemplate} className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-2 rounded text-sm font-bold flex items-center gap-1 whitespace-nowrap">
              <Save size={16} /> Save Template
            </button>
          </div>
          <div className="flex-1 flex items-center justify-center gap-2">
            <div className="relative w-full max-w-md">
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
              <div className="flex items-center gap-1">
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
          <div className="flex items-center gap-2 w-1/4 justify-end text-sm">
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
              <Download size={16} /> JSON
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
        </div>
      </div>

      {/* Project Info */}
      <div className="max-w-[98%] mx-auto px-4 mb-6">
        <div className="bg-white p-5 rounded-lg shadow-sm border border-blue-100 flex gap-6">
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
          <div className="flex-1">
            <label className="block text-xs font-bold text-blue-800 uppercase mb-1">Client</label>
            <input 
              type="text" 
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              onBlur={() => recordHistory('Updated Client')}
              className="w-full border border-slate-300 rounded p-2 text-lg font-bold focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none"
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
                  <button 
                    onClick={(e) => { e.stopPropagation(); renameCategory(category); }} 
                    className="text-slate-400 hover:text-white font-bold text-sm transition flex items-center gap-1"
                  >
                    <Edit2 size={14} /> Edit
                  </button>
                </div>
                
                <div className={`${isCatCollapsed ? 'hidden' : 'block'} overflow-x-auto pb-4 bg-white`}>
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
                          <button 
                            onClick={(e) => { e.stopPropagation(); renameSubCategory(category, subCategory); }} 
                            className="text-blue-500 hover:text-blue-800 font-bold text-sm transition flex items-center gap-1"
                          >
                            <Edit2 size={14} /> Edit
                          </button>
                        </div>
                        
                        <div className={`${isSubCollapsed ? 'hidden' : 'block'}`}>
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
                                  <button 
                                    onClick={(e) => { e.stopPropagation(); renameSubItem1(category, subCategory, subItem1); }} 
                                    className="text-emerald-400 hover:text-emerald-700 font-bold text-xs transition flex items-center gap-1"
                                  >
                                    <Edit2 size={12} /> Edit
                                  </button>
                                </div>
                                
                                <div className={`${isSub1Collapsed ? 'hidden' : 'block'}`}>
                                  <table className="w-full text-left mb-4 max-w-full">
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
                                        <th className="px-3 py-2 min-w-[200px] font-bold whitespace-nowrap">MATERIAL<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(name)</span></th>
                                        <th className="px-3 py-2 min-w-[120px] font-bold whitespace-nowrap">SPEC<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(details)</span></th>
                                        <th className="px-3 py-2 min-w-[100px] font-bold text-emerald-700 whitespace-nowrap">TAKE-OFF<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(measured)</span></th>
                                        <th className="px-3 py-2 min-w-[100px] text-center font-bold whitespace-nowrap">OVERAGE %<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(waste factor)</span></th>
                                        <th className="px-3 py-2 min-w-[100px] text-center font-bold text-emerald-700 whitespace-nowrap">ORDER<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(pkg/divisor)</span></th>
                                        <th className="px-3 py-2 min-w-[100px] text-center font-bold text-blue-700 whitespace-nowrap">QTY<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(final to buy)</span></th>
                                        <th className="px-3 py-2 text-center min-w-[90px] whitespace-nowrap">UOM<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(unit)</span></th>
                                        <th className="px-3 py-2 min-w-[150px] font-bold whitespace-nowrap">REFERENCE<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(page/detail)</span></th>
                                        <th className="px-3 py-2 min-w-[150px] font-bold whitespace-nowrap">RULE / NOTE<br/><span className="text-[10px] font-normal lowercase tracking-normal text-slate-500">(logic)</span></th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {items.map(item => {
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
                                          <tr key={item.item_id} className={`${rowBg} border-b border-slate-200 group`}>
                                            <td className="px-2 py-2 text-center border-r border-slate-200/50">
                                              <input 
                                                type="checkbox" 
                                                className="w-4 h-4 cursor-pointer accent-indigo-600" 
                                                checked={selectedItems.has(item.item_id)} 
                                                onChange={(e) => handleSelectItem(item.item_id, e.target.checked)}
                                              />
                                            </td>
                                            <td className="px-2 py-2 text-center">
                                              <input 
                                                type="checkbox" 
                                                className="w-5 h-5 cursor-pointer accent-emerald-600" 
                                                checked={isChecked} 
                                                onChange={(e) => updateTakeoffData(item.item_id, 'in_scope', e.target.checked, item.calc_factor_instruction, item.item_name)}
                                              />
                                            </td>
                                            <td className="px-2 py-2 pl-4">
                                              <div className="flex items-center justify-between">
                                                <input 
                                                  type="text" 
                                                  className="font-bold text-slate-800 text-[13px] bg-transparent border border-transparent hover:border-slate-300 focus:border-emerald-500 focus:bg-white rounded px-1 w-full outline-none transition-colors" 
                                                  defaultValue={item.item_name} 
                                                  onBlur={(e) => updateItemName(item.item_id, e.target.value)} 
                                                  onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                                />
                                                <button onClick={() => openItemModal('edit', item.item_id)} className="text-slate-400 hover:text-blue-600 px-1 ml-1" title="Advanced Edit">
                                                  <Edit2 size={14} />
                                                </button>
                                              </div>
                                            </td>
                                            <td className="px-2 py-2">
                                              <input 
                                                type="text" 
                                                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-medium text-slate-700 transition-colors focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400" 
                                                placeholder="..." 
                                                value={rowData.spec || ""} 
                                                disabled={isDisabled} 
                                                onChange={(e) => updateTakeoffData(item.item_id, 'spec', e.target.value, item.calc_factor_instruction, item.item_name)} 
                                                onBlur={() => recordHistory(`Updated spec for ${item.item_name}`)}
                                                onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                              />
                                            </td>
                                            <td className="px-2 py-2">
                                              <input 
                                                type="text" 
                                                className="w-full border border-emerald-300 bg-emerald-50 rounded px-2 py-1.5 text-sm font-bold text-emerald-800 transition-colors focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400" 
                                                placeholder="0" 
                                                value={rowData.qty || ""} 
                                                disabled={isDisabled} 
                                                onChange={(e) => updateTakeoffData(item.item_id, 'qty', e.target.value, item.calc_factor_instruction, item.item_name)} 
                                                onBlur={() => recordHistory(`Updated qty for ${item.item_name}`)}
                                                onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                              />
                                            </td>
                                            <td className="px-2 py-2">
                                              <div className="relative">
                                                <input 
                                                  type="text" 
                                                  className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-medium text-slate-700 transition-colors focus:border-emerald-500 pr-5 text-center disabled:bg-slate-100 disabled:text-slate-400" 
                                                  placeholder="0" 
                                                  value={rowData.overage_pct || ""} 
                                                  disabled={isDisabled} 
                                                  onChange={(e) => updateTakeoffData(item.item_id, 'overage_pct', e.target.value, item.calc_factor_instruction, item.item_name)} 
                                                  onBlur={() => recordHistory(`Updated overage for ${item.item_name}`)}
                                                  onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                                />
                                                <span className="absolute right-2 top-1.5 text-xs text-slate-400 font-bold">%</span>
                                              </div>
                                            </td>
                                            <td className="px-2 py-2">
                                              <input 
                                                type="text" 
                                                className="w-full border-2 border-emerald-500 bg-emerald-100 font-bold text-emerald-900 rounded px-2 py-1 text-sm text-center focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-300" 
                                                placeholder="0" 
                                                value={rowData.order_qty || ""} 
                                                disabled={isDisabled} 
                                                onChange={(e) => updateTakeoffData(item.item_id, 'order_qty', e.target.value, item.calc_factor_instruction, item.item_name)} 
                                                onBlur={() => recordHistory(`Updated order qty for ${item.item_name}`)}
                                                onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                              />
                                            </td>
                                            <td className="px-2 py-2">
                                              <div 
                                                className="relative cursor-pointer" 
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
                                                  className={`w-full border font-bold rounded px-2 py-1.5 text-sm text-center transition-colors outline-none cursor-pointer ${qtyBgClass} disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-300 disabled:cursor-not-allowed`} 
                                                  placeholder="0" 
                                                  value={displayQty} 
                                                  disabled={isDisabled}
                                                />
                                              </div>
                                            </td>
                                            <td className="px-2 py-2 text-center text-xs font-bold text-slate-600 uppercase">
                                              <select 
                                                className="w-full bg-transparent hover:bg-slate-100 border border-transparent hover:border-slate-300 focus:border-emerald-500 rounded outline-none cursor-pointer p-1 text-center transition-colors disabled:cursor-not-allowed" 
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
                                            <td className="px-2 py-2">
                                              <input 
                                                type="text" 
                                                className="w-full border border-slate-300 rounded px-2 py-1.5 text-sm font-medium text-slate-700 transition-colors focus:border-emerald-500 disabled:bg-slate-100 disabled:text-slate-400" 
                                                placeholder="Ref..." 
                                                value={rowData.evidence || ""} 
                                                disabled={isDisabled} 
                                                onChange={(e) => updateTakeoffData(item.item_id, 'evidence', e.target.value, item.calc_factor_instruction, item.item_name)} 
                                                onBlur={() => recordHistory(`Updated evidence for ${item.item_name}`)}
                                                onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                              />
                                            </td>
                                            <td className="px-2 py-2 text-xs text-slate-700 leading-tight border-l border-slate-100 pl-3">
                                              <span className="font-bold text-blue-700">{item.calc_factor_instruction}</span>
                                              {item.notes && <><br/><span className="text-slate-500 italic">{item.notes}</span></>}
                                            </td>
                                          </tr>
                                        );
                                      })}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Custom Variable Modal */}
      {customVarModalOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-[60]">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-md p-6 border-t-4 border-amber-500">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Manage Custom Variables</h2>
              <button onClick={() => { setCustomVarModalOpen(false); setEditingCustomVar(null); }} className="text-slate-400 hover:text-slate-600"><X size={24} /></button>
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
                  <label className="block text-xs font-bold text-slate-600 mb-1">Value (number)</label>
                  <input 
                    type="number" 
                    id="cv-value"
                    defaultValue={editingCustomVar?.value || ''}
                    placeholder="e.g. 1.15"
                    step="any"
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
                      const value = parseFloat(valueInput.value);
                      const desc = descInput.value.trim();
                      
                      if (!name) {
                        alert("Please enter a variable name.");
                        return;
                      }
                      if (isNaN(value)) {
                        alert("Please enter a valid numeric value.");
                        return;
                      }
                      
                      let newVars = [...customVariables];
                      if (editingCustomVar) {
                        newVars = newVars.map(v => v.id === editingCustomVar.id ? { ...v, name, value, description: desc } : v);
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
                          value,
                          description: desc
                        });
                      }
                      
                      // Recalculate all auto formulas with new variables
                      const newData = { ...takeoffData };
                      let hasChanges = false;
                      for (const itemId in newData) {
                        if (newData[itemId].qty_mode !== 'manual') {
                          const formula = newData[itemId].custom_formula || DEFAULT_QTY_FORMULA;
                          const newQty = evaluateCustomFormula(
                            formula,
                            newData[itemId].qty,
                            newData[itemId].overage_pct,
                            newData[itemId].order_qty,
                            newVars
                          ).toString();
                          if (newData[itemId].measured_qty !== newQty) {
                            newData[itemId].measured_qty = newQty;
                            hasChanges = true;
                          }
                        }
                      }
                      
                      setCustomVariables(newVars);
                      if (hasChanges) setTakeoffData(newData);
                      
                      recordHistory(editingCustomVar ? `Updated variable ${name}` : `Added variable ${name}`, hasChanges ? newData : takeoffData, catalog, projectName, clientName, newVars);
                      
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
                          <td className="p-2 font-mono text-xs">{v.value}</td>
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
                                  if (valueInput) valueInput.value = v.value.toString();
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
                                  
                                  // Recalculate all auto formulas with new variables
                                  const newData = { ...takeoffData };
                                  let hasChanges = false;
                                  for (const itemId in newData) {
                                    if (newData[itemId].qty_mode !== 'manual') {
                                      const formula = newData[itemId].custom_formula || DEFAULT_QTY_FORMULA;
                                      const newQty = evaluateCustomFormula(
                                        formula,
                                        newData[itemId].qty,
                                        newData[itemId].overage_pct,
                                        newData[itemId].order_qty,
                                        newVars
                                      ).toString();
                                      if (newData[itemId].measured_qty !== newQty) {
                                        newData[itemId].measured_qty = newQty;
                                        hasChanges = true;
                                      }
                                    }
                                  }
                                  
                                  setCustomVariables(newVars);
                                  if (hasChanges) setTakeoffData(newData);
                                  
                                  recordHistory(`Deleted variable ${v.name}`, hasChanges ? newData : takeoffData, catalog, projectName, clientName, newVars);
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
            </div>
            
            {qtyMode === 'auto' ? (
              <div className="space-y-4">
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
                      <div className="flex items-center justify-between mb-2 sticky top-0 bg-white py-1">
                        <h5 className="text-xs font-bold text-slate-500 uppercase">Variables</h5>
                        <button 
                          onClick={() => setCustomVarModalOpen(true)}
                          className="text-[10px] bg-slate-100 hover:bg-slate-200 text-slate-600 px-2 py-1 rounded border border-slate-200 transition"
                        >
                          Manage Custom
                        </button>
                      </div>
                      <div className="flex flex-col gap-2">
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
                  const previewResult = evaluateCustomFormula(
                    customFormula, 
                    takeoffData[qtyPanelItemId]?.qty || 0, 
                    takeoffData[qtyPanelItemId]?.overage_pct || 0, 
                    takeoffData[qtyPanelItemId]?.order_qty || 1,
                    customVariables
                  );
                  const isError = typeof previewResult === 'string' && previewResult.startsWith('ERR');
                  return (
                    <div className={`p-3 rounded text-sm font-bold ${isError ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800'}`}>
                      Preview: <span>{previewResult.toString()}</span>
                    </div>
                  );
                })()}
              </div>
            ) : (
              <div>
                <input 
                  type="number" 
                  value={manualQty}
                  onChange={(e) => setManualQty(e.target.value)}
                  className="w-full border border-amber-400 p-3 rounded text-xl font-bold focus:ring-2 focus:ring-amber-200 outline-none" 
                />
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
                <label className="block text-sm font-bold text-slate-700 mb-1">Client Name</label>
                <input 
                  type="text" 
                  value={newProjectData.client}
                  onChange={(e) => setNewProjectData({...newProjectData, client: e.target.value})}
                  className="w-full border border-slate-300 p-2 rounded focus:ring-2 focus:ring-emerald-200 outline-none"
                  placeholder="e.g. Acme Corp"
                />
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

    </div>
  );
}
