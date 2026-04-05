import { evaluate, all, create } from 'mathjs';
import { CustomVariable, Item } from "./types";

const math = create(all);

export const DEFAULT_QTY_FORMULA = "[qty] * (1 + [overage_pct] / 100)";

export function evaluateMath(expression: string): number | string {
  if (!expression || typeof expression !== 'string') return "";
  try {
    const result = math.evaluate(expression);
    return typeof result === 'number' ? result : "";
  } catch (e) {
    return "";
  }
}

export function extractVariablesFromFormula(formula: string): string[] {
  const varRegex = /\[([^\]]+)\]/g;
  const variables: string[] = [];
  let match;
  while ((match = varRegex.exec(formula)) !== null) {
    variables.push(match[1]);
  }
  return Array.from(new Set(variables));
}

export function getUniqueVals<T>(array: T[], key: keyof T): string[] {
  if (!array) return [];
  const vals = array.map(item => String(item[key] || ""));
  return Array.from(new Set(vals)).filter(v => v !== "").sort();
}

export function recalculateCustomVariables(variables: CustomVariable[]): CustomVariable[] {
  const newVars = [...variables];
  const scope: Record<string, number> = {};
  
  // Initialize scope with 0
  newVars.forEach(v => scope[v.name] = 0);
  
  // Simple iterative approach for dependencies (could be improved with a graph)
  for (let i = 0; i < 5; i++) { // Max 5 passes for nested dependencies
    let changed = false;
    newVars.forEach(v => {
      if (v.formula) {
        try {
          // Replace [var] with scope value
          let formula = v.formula;
          const varsInFormula = extractVariablesFromFormula(formula);
          varsInFormula.forEach(vn => {
            const val = scope[vn] || 0;
            formula = formula.replace(new RegExp(`\\[${vn}\\]`, 'g'), val.toString());
          });
          
          const result = math.evaluate(formula);
          if (typeof result === 'number' && result !== scope[v.name]) {
            scope[v.name] = result;
            v.value = result;
            changed = true;
          }
        } catch (e) {
          v.value = 0;
          scope[v.name] = 0;
        }
      }
    });
    if (!changed) break;
  }
  
  return newVars;
}

export function evaluateCustomFormula(
  formula: string,
  qty: string | number,
  overagePct: string | number,
  orderQty: string | number,
  customVariables: CustomVariable[],
  dynamicScope: Record<string, any> = {},
  dataTables: any[] = []
): number | string {
  if (!formula) return 0;
  
  try {
    let processedFormula = formula;
    
    // 1. Replace built-in variables
    processedFormula = processedFormula.replace(/\[qty\]/g, (Number(qty) || 0).toString());
    processedFormula = processedFormula.replace(/\[overage_pct\]/g, (Number(overagePct) || 0).toString());
    processedFormula = processedFormula.replace(/\[order_qty\]/g, (Number(orderQty) || 0).toString());
    
    // 2. Replace custom variables
    customVariables.forEach(v => {
      processedFormula = processedFormula.replace(new RegExp(`\\[${v.name}\\]`, 'g'), (v.value || 0).toString());
    });
    
    // 3. Replace dynamic scope variables
    Object.entries(dynamicScope).forEach(([key, value]) => {
      processedFormula = processedFormula.replace(new RegExp(`\\[${key}\\]`, 'g'), (Number(value) || 0).toString());
    });
    
    // 4. Handle common math functions (mathjs handles most of these natively if they are lowercase or we map them)
    // We can just evaluate it with mathjs
    const scope = {
      lookup: (tableName: string, searchCol: string, searchVal: any, resultCol: string) => {
        const table = dataTables.find(t => t.name === tableName);
        if (!table) throw new Error(`Table not found: ${tableName}`);
        const row = table.rows.find((r: any) => String(r[searchCol]) === String(searchVal));
        if (!row) throw new Error(`Value not found in table: ${searchVal}`);
        const result = row[resultCol];
        if (result === undefined) throw new Error(`Column not found: ${resultCol}`);
        return Number(result) || result;
      },
      roundup: (val: number, decimals: number = 0) => {
        const multiplier = Math.pow(10, decimals);
        return Math.ceil(val * multiplier) / multiplier;
      },
      rounddown: (val: number, decimals: number = 0) => {
        const multiplier = Math.pow(10, decimals);
        return Math.floor(val * multiplier) / multiplier;
      },
      if: (condition: any, trueVal: any, falseVal: any) => condition ? trueVal : falseVal,
      and: (...args: any[]) => args.every(Boolean),
      or: (...args: any[]) => args.some(Boolean),
      not: (val: any) => !val,
    };
    
    const result = math.evaluate(processedFormula.toLowerCase(), scope);
    return typeof result === 'number' ? result : 0;
  } catch (e: any) {
    console.error("Formula evaluation error:", e);
    return "ERR: " + e.message;
  }
}

export function validateCustomFormula(
  formula: string,
  customVariables: CustomVariable[],
  dynamicScope: Record<string, any> = {},
  variableRegistry: any = {},
  dataTables: any[] = []
): { isValid: boolean; error?: string } {
  if (!formula) return { isValid: true };
  
  try {
    const variables = extractVariablesFromFormula(formula);
    const availableVars = [
      'qty', 'overage_pct', 'order_qty',
      ...customVariables.map(v => v.name),
      ...Object.keys(dynamicScope),
      ...Object.keys(variableRegistry)
    ];
    
    for (const v of variables) {
      if (!availableVars.includes(v)) {
        return { isValid: false, error: `Unknown variable: [${v}]` };
      }
    }
    
    // Try a test evaluation with 1s
    let testFormula = formula;
    variables.forEach(v => {
      testFormula = testFormula.replace(new RegExp(`\\[${v}\\]`, 'g'), "1");
    });
    
    const scope = {
      lookup: (tableName: string, searchCol: string, searchVal: any, resultCol: string) => 1,
      roundup: (val: number, decimals: number = 0) => 1,
      rounddown: (val: number, decimals: number = 0) => 1,
      if: (condition: any, trueVal: any, falseVal: any) => 1,
      and: (...args: any[]) => true,
      or: (...args: any[]) => true,
      not: (val: any) => false,
    };
    
    math.evaluate(testFormula.toLowerCase(), scope);
    return { isValid: true };
  } catch (e: any) {
    return { isValid: false, error: e.message };
  }
}
