"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { defaultCatalog } from '@/lib/default-catalog';
import { evaluateMath, evaluateCustomFormula, DEFAULT_QTY_FORMULA, getUniqueVals } from '@/lib/estimator-utils';
import { Item, TakeoffItem, HistoryRecord, Job } from '@/lib/types';
import { 
  Home, Plus, Download, Save, Search, History, FileJson, Upload, 
  ChevronDown, ChevronRight, Edit2, Calculator, Hand, Trash2, X
} from 'lucide-react';

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

export default function EstimatorApp() {
  const [isMounted, setIsMounted] = useState(false);
  const [catalog, setCatalog] = useState<Item[]>([]);
  const [takeoffData, setTakeoffData] = useState<Record<string, TakeoffItem>>({});
  const [actionHistory, setActionHistory] = useState<HistoryRecord[]>([]);
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

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const savedCatalog = localStorage.getItem('userItemCatalog');
    if (savedCatalog) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCatalog(JSON.parse(savedCatalog));
    } else {
       
      setCatalog(defaultCatalog);
    }

    const jobs = JSON.parse(localStorage.getItem('savedEstimatingJobs') || '{}');
     
    setSavedJobs(jobs);
     
    setCurrentJobId("JOB-" + Date.now());
     
    setIsMounted(true);
  }, []);

  const recordHistory = (actionDescription: string, newData = takeoffData, newCatalog = catalog, newProj = projectName, newClient = clientName) => {
    const snapshot: HistoryRecord = {
      timestamp: new Date().toISOString(),
      action: actionDescription,
      dataState: JSON.parse(JSON.stringify(newData)),
      catalogState: JSON.parse(JSON.stringify(newCatalog)),
      projectName: newProj,
      clientName: newClient
    };
    setActionHistory(prev => {
      const newHistory = [snapshot, ...prev];
      if (newHistory.length > 50) newHistory.pop();
      return newHistory;
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
            newData[itemId].order_qty
          ).toString();
        }
      }

      const actionDesc = field === 'in_scope' 
        ? (finalValue ? `Added Scope: ${itemName}` : `Removed Scope: ${itemName}`) 
        : `Updated ${field} for ${itemName}`;
      
      setTimeout(() => recordHistory(actionDesc, newData, catalog, projectName, clientName), 0);
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
      lastSaved: new Date().toISOString()
    };
    const newSavedJobs = { ...savedJobs, [currentJobId]: newJob };
    setSavedJobs(newSavedJobs);
    localStorage.setItem('savedEstimatingJobs', JSON.stringify(newSavedJobs));
    alert("Job Saved Successfully!");
  };

  const loadJobFromSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selectedId = e.target.value;
    if (!selectedId) {
      setCurrentJobId("JOB-" + Date.now());
      setTakeoffData({});
      setActionHistory([]);
      setProjectName("");
      setClientName("");
      return;
    }
    const jobData = savedJobs[selectedId];
    if (jobData) {
      setCurrentJobId(selectedId);
      setTakeoffData(jobData.takeoffData || {});
      setActionHistory(jobData.history || []);
      setProjectName(jobData.projectName || "");
      setClientName(jobData.clientName || "");
      setTimeout(() => recordHistory("Loaded Job from Storage", jobData.takeoffData, catalog, jobData.projectName, jobData.clientName), 0);
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
      catalog: catalog
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
          if (importedData.catalog) {
            setCatalog(importedData.catalog);
            localStorage.setItem('userItemCatalog', JSON.stringify(importedData.catalog));
          }
          setProjectName(importedData.projectName || "");
          setClientName(importedData.clientName || "");
          
          setTimeout(() => recordHistory("Imported Job from JSON File", importedData.takeoffData, importedData.catalog || catalog, importedData.projectName, importedData.clientName), 0);
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
          newData[qtyPanelItemId].order_qty
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
      setTimeout(() => recordHistory(`Restored back to: ${record.action}`, record.dataState, record.catalogState, record.projectName, record.clientName), 0);
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
          </div>
          <div className="flex-1">
            <div className="relative max-w-md mx-auto">
              <Search className="absolute left-3 top-2.5 text-slate-400" size={18} />
              <input 
                type="text" 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search anything..." 
                className="w-full border border-slate-300 rounded-full pl-9 pr-4 py-2 text-sm focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 w-1/4 justify-end text-sm">
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

                                        const qtyBgClass = rowData.qty_mode === 'manual' 
                                          ? "border-amber-400 bg-amber-50 text-amber-900 focus:border-amber-600" 
                                          : "border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100 focus:border-blue-500";

                                        return (
                                          <tr key={item.item_id} className={`${rowBg} border-b border-slate-200 group`}>
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
                                                onKeyDown={(e) => { if(e.key === 'Enter') e.currentTarget.blur(); }}
                                              />
                                            </td>
                                            <td className="px-2 py-2">
                                              <div 
                                                className="relative cursor-pointer" 
                                                onClick={() => { if(isChecked) openQtyPanel(item.item_id); }} 
                                                title="Click to config formula or override"
                                              >
                                                {rowData.qty_mode === 'manual' ? (
                                                  <Hand size={12} className="absolute left-2 top-2 text-amber-600" />
                                                ) : (
                                                  <Calculator size={12} className="absolute left-1 top-2 text-emerald-600" />
                                                )}
                                                <input 
                                                  type="text" 
                                                  readOnly 
                                                  className={`w-full border font-bold rounded px-2 py-1.5 text-sm text-center transition-colors outline-none cursor-pointer ${qtyBgClass} disabled:bg-slate-100 disabled:text-slate-400 disabled:border-slate-300 disabled:cursor-not-allowed`} 
                                                  placeholder="0" 
                                                  value={rowData.measured_qty || ''} 
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

      {/* QTY Panel Modal */}
      {qtyPanelOpen && (
        <div className="fixed inset-0 bg-slate-900 bg-opacity-70 flex justify-center items-center z-50">
          <div className="bg-white rounded-lg shadow-2xl w-full max-w-2xl p-6 border-t-4 border-emerald-500">
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
                <input 
                  type="text" 
                  value={customFormula}
                  onChange={(e) => setCustomFormula(e.target.value)}
                  className="w-full border border-emerald-400 font-mono p-3 rounded focus:ring-2 focus:ring-emerald-200 outline-none" 
                />
                <div className="bg-blue-50 p-3 rounded text-sm font-bold text-blue-800">
                  Preview: <span>
                    {evaluateCustomFormula(
                      customFormula, 
                      takeoffData[qtyPanelItemId]?.qty || 0, 
                      takeoffData[qtyPanelItemId]?.overage_pct || 0, 
                      takeoffData[qtyPanelItemId]?.order_qty || 1
                    ).toString()}
                  </span>
                </div>
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
              <button onClick={() => setQtyPanelOpen(false)} className="px-4 py-2 text-slate-600 font-bold hover:bg-slate-100 rounded transition">Cancel</button>
              <button onClick={saveQtyPanel} className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded font-bold transition shadow-sm">Save</button>
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
                      <tr key={index} className="hover:bg-blue-50 transition-colors">
                        <td className="px-4 py-3 text-xs text-slate-500">{new Date(record.timestamp).toLocaleTimeString()}</td>
                        <td className="px-4 py-3 font-semibold text-slate-800">{record.action}</td>
                        <td className="px-4 py-3 text-right">
                          <button 
                            onClick={() => restoreHistory(index)} 
                            className="text-blue-700 font-bold text-xs bg-blue-100 hover:bg-blue-200 px-3 py-1.5 rounded transition shadow-sm"
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
