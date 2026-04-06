export function normalizeKey(name: string): string {
  if (!name) return '';
  
  // If it's already a single word without spaces, just ensure it starts with lowercase
  if (!name.includes(' ')) {
    return name.replace(/[^a-zA-Z0-9]/g, '').replace(/^[A-Z]/, c => c.toLowerCase());
  }

  return name
    .replace(/[^a-zA-Z0-9 ]/g, '')
    .split(' ')
    .filter(Boolean)
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('');
}

export function buildContext(
  row: any,
  columns: { id: string; name: string; key?: string }[],
  customVariables: { name: string; value: any }[] = [],
  dynamicScope: Record<string, any> = {}
) {
  const context: Record<string, any> = {};

  // Add built-in variables
  context['qty'] = parseFloat(row.qty) || 0;
  context['overagePct'] = parseFloat(row.overage_pct) || 0;
  context['overage'] = parseFloat(row.overage_pct) || 0;
  context['orderQty'] = parseFloat(row.order_qty) || 0;
  context['takeOff'] = parseFloat(row.takeoff) || 0;

  // Add columns
  columns.forEach(col => {
    const key = col.key || normalizeKey(col.name);
    const value = parseFloat(row[col.id]) || 0;
    context[key] = value;
  });

  // Add custom variables
  customVariables.forEach(v => {
    const key = normalizeKey(v.name);
    const numVal = parseFloat(v.value);
    context[key] = !isNaN(numVal) && isFinite(numVal) ? numVal : v.value;
  });

  // Add dynamic scope variables
  Object.entries(dynamicScope).forEach(([k, v]) => {
    const key = normalizeKey(k);
    const numVal = parseFloat(v);
    context[key] = !isNaN(numVal) && isFinite(numVal) ? numVal : v;
  });

  // Add math functions
  context['ROUNDUP'] = (val: number, decimals: number = 0) => {
    const multiplier = Math.pow(10, decimals);
    return Math.ceil(val * multiplier) / multiplier;
  };
  context['ROUNDDOWN'] = (val: number, decimals: number = 0) => {
    const multiplier = Math.pow(10, decimals);
    return Math.floor(val * multiplier) / multiplier;
  };
  context['ROUND'] = (val: number, decimals: number = 0) => {
    const multiplier = Math.pow(10, decimals);
    return Math.round(val * multiplier) / multiplier;
  };
  context['IF'] = (condition: any, trueVal: any, falseVal: any) => condition ? trueVal : falseVal;
  context['AND'] = (...args: any[]) => args.every(Boolean);
  context['OR'] = (...args: any[]) => args.some(Boolean);
  context['NOT'] = (val: any) => !val;
  context['MAX'] = Math.max;
  context['MIN'] = Math.min;
  context['CEILING'] = Math.ceil;
  context['FLOOR'] = Math.floor;
  context['ABS'] = Math.abs;
  context['SQRT'] = Math.sqrt;
  context['POWER'] = Math.pow;

  return context;
}

export function parseFormula(formula: string): string {
  if (!formula) return '0';
  
  // Convert [Variable Name] to normalizedKey
  let parsedFormula = formula.replace(/\[([^\]]+)\]/g, (match, varName) => {
    // Special cases for built-in variables
    if (varName.toLowerCase() === 'qty') return 'qty';
    if (varName.toLowerCase() === 'overage_pct') return 'overagePct';
    if (varName.toLowerCase() === 'order_qty') return 'orderQty';
    if (varName.toLowerCase() === 'take-off') return 'takeOff';
    if (varName.toLowerCase() === 'overage %') return 'overagePct';
    if (varName.toLowerCase() === 'order') return 'orderQty';
    
    return normalizeKey(varName);
  });

  return parsedFormula;
}

export const FormulaLogger = {
  isDebugEnabled(localDebugFlag: boolean = false): boolean {
    if (localDebugFlag) return true;
    if (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_DEBUG_FORMULA === 'true') return true;
    if (typeof window === 'undefined') return false;
    return (window as any).DEBUG_FORMULA === true || window.localStorage?.getItem('DEBUG_FORMULA') === 'true';
  },

  debug(formula: string, parsedFormula: string, args: string[], context: Record<string, any>, result: any, localDebugFlag: boolean = false) {
    if (!this.isDebugEnabled(localDebugFlag)) return;
    console.group(`[Formula Engine Debug] Evaluating: ${formula}`);
    console.log("Original Formula:", formula);
    console.log("Parsed Formula:", parsedFormula);
    console.log("Parsed Variables (Args):", args);
    console.log("Context Object:", { ...context });
    console.log("Result:", result);
    console.groupEnd();
  },

  error(error: any, formula: string, context: Record<string, any>) {
    console.error("[Formula Engine Error]", error, "Formula:", formula, "Context:", context);
  }
};

export function evaluateFormula(formula: string, context: Record<string, any>, debug: boolean = false) {
  if (!formula) return 0;
  
  try {
    const parsedFormula = parseFormula(formula);
    
    // Basic security check to prevent access to global objects
    const forbiddenKeywords = ['window', 'document', 'process', 'require', 'eval', 'console', 'global', 'setTimeout', 'setInterval', 'fetch', 'XMLHttpRequest'];
    if (forbiddenKeywords.some(keyword => parsedFormula.includes(keyword))) {
      throw new Error("Formula contains forbidden keywords");
    }

    const args = Object.keys(context);
    const values = Object.values(context);

    // Create a safe function
    const fn = new Function(...args, `"use strict"; return (${parsedFormula});`);
    let result = fn(...values);
    
    // Handle various data types gracefully
    if (typeof result === 'number' && !isNaN(result) && isFinite(result)) {
      // result is a valid number
    } else if (typeof result === 'boolean' || typeof result === 'string') {
      // result is a valid boolean or string
    } else {
      // Fallback for undefined, null, objects, arrays, NaN, Infinity
      result = result !== undefined && result !== null ? result : 0;
    }

    FormulaLogger.debug(formula, parsedFormula, args, context, result, debug);

    return result;
  } catch (error) {
    FormulaLogger.error(error, formula, context);
    return "ERR";
  }
}

export function validateFormula(formula: string, context: Record<string, any>): { isValid: boolean; error?: string } {
  if (!formula) return { isValid: true };
  
  try {
    const parsedFormula = parseFormula(formula);
    
    // Basic security check
    const forbiddenKeywords = ['window', 'document', 'process', 'require', 'eval', 'console', 'global', 'setTimeout', 'setInterval', 'fetch', 'XMLHttpRequest'];
    if (forbiddenKeywords.some(keyword => parsedFormula.includes(keyword))) {
      return { isValid: false, error: "Formula contains forbidden keywords" };
    }

    const args = Object.keys(context);
    const values = Object.values(context).map(v => typeof v === 'function' ? v : 1); // Use 1 for all variables to test

    const fn = new Function(...args, `"use strict"; return (${parsedFormula});`);
    fn(...values);
    return { isValid: true };
  } catch (error: any) {
    return { isValid: false, error: error.message };
  }
}
