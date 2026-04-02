import { evaluate, parse } from 'mathjs';

export const DEFAULT_QTY_FORMULA = "ceil(Takeoff * (1 + Overage / 100) / Order)";

export function evaluateMath(inputStr: string | number): string | number {
    if (!inputStr) return "";
    try { 
        let result = evaluate(inputStr.toString()); 
        return Math.round(result * 100) / 100; 
    } catch (e) { 
        return inputStr; 
    }
}

export function evaluateCustomFormula(
    formulaStr: string, 
    takeoff: string | number, 
    overage: string | number, 
    order: string | number,
    customVars: { name: string, value: number }[] = [],
    dynamicScope: Record<string, any> = {}
): string | number {
    if (!formulaStr) return "";
    
    let t = parseFloat(takeoff as string) || 0;
    let o = parseFloat(overage as string) || 0;
    let ord = parseFloat(order as string);
    if (isNaN(ord) || ord === 0) ord = 1;

    // Build scope
    const scope: Record<string, any> = {
        Takeoff: t,
        Overage: o,
        Order: ord,
        ...dynamicScope
    };

    customVars.forEach(cv => {
        // Remove spaces and special chars for mathjs compatibility if needed, 
        // but mathjs supports variables if they are valid identifiers.
        // Let's assume customVars names are valid identifiers or we sanitize them.
        const safeName = cv.name.replace(/[^a-zA-Z0-9_]/g, '_');
        scope[safeName] = cv.value;
    });

    // Replace old syntax [Var] with Var
    let parsed = formulaStr.replace(/\[(.*?)\]/g, (match, p1) => {
        if (p1 === 'Overage %') return 'Overage';
        if (p1 === 'Take-off') return 'Takeoff';
        return p1.replace(/[^a-zA-Z0-9_]/g, '_');
    });

    // Replace Excel-like functions with mathjs equivalents
    parsed = parsed.replace(/\bROUNDUP\b/ig, 'ceil')
                   .replace(/\bROUNDDOWN\b/ig, 'floor')
                   .replace(/\bROUND\b/ig, 'round')
                   .replace(/\bCEILING\b/ig, 'ceil')
                   .replace(/\bFLOOR\b/ig, 'floor')
                   .replace(/\bMAX\b/ig, 'max')
                   .replace(/\bMIN\b/ig, 'min')
                   .replace(/\bABS\b/ig, 'abs')
                   .replace(/\bSQRT\b/ig, 'sqrt')
                   .replace(/\bPOWER\b/ig, 'pow')
                   .replace(/\bIF\b/ig, 'ifElse'); // mathjs doesn't have IF by default, we can add a custom function

    // Add ifElse to scope
    scope.ifElse = function(condition: any, trueVal: any, falseVal: any) {
        return condition ? trueVal : falseVal;
    };

    try {
        let result = evaluate(parsed, scope);
        if (isNaN(result)) return "ERR: Invalid calculation (NaN)";
        if (!isFinite(result)) return "ERR: Division by zero or infinity";
        return Math.round(result * 100) / 100;
    } catch(e: any) {
        return `ERR: ${e.message || "Syntax error in formula"}`;
    }
}

export function validateCustomFormula(
    formulaStr: string,
    customVars: { name: string, value: number }[] = [],
    dynamicScope: Record<string, any> = {}
): { valid: boolean; error?: string } {
    if (!formulaStr) return { valid: true };

    let parsed = formulaStr.replace(/\[(.*?)\]/g, (match, p1) => {
        if (p1 === 'Overage %') return 'Overage';
        if (p1 === 'Take-off') return 'Takeoff';
        return p1.replace(/[^a-zA-Z0-9_]/g, '_');
    });

    parsed = parsed.replace(/\bROUNDUP\b/ig, 'ceil')
                   .replace(/\bROUNDDOWN\b/ig, 'floor')
                   .replace(/\bROUND\b/ig, 'round')
                   .replace(/\bCEILING\b/ig, 'ceil')
                   .replace(/\bFLOOR\b/ig, 'floor')
                   .replace(/\bMAX\b/ig, 'max')
                   .replace(/\bMIN\b/ig, 'min')
                   .replace(/\bABS\b/ig, 'abs')
                   .replace(/\bSQRT\b/ig, 'sqrt')
                   .replace(/\bPOWER\b/ig, 'pow')
                   .replace(/\bIF\b/ig, 'ifElse');

    try {
        parse(parsed); // Just parse to check syntax
        return { valid: true };
    } catch(e: any) {
        return { valid: false, error: e.message || "Syntax error in formula" };
    }
}

export function getUniqueVals(array: any[], key: string) { 
    return Array.from(new Set(array.map(item => item[key] || "General"))).sort(); 
}
