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

export function evaluateCustomVariableFormula(
    formulaStr: string,
    customVars: { name: string, value: number }[] = []
): number {
    if (!formulaStr) return 0;
    
    const scope: Record<string, any> = {};
    customVars.forEach(cv => {
        const safeName = cv.name.replace(/[^a-zA-Z0-9_]/g, '_');
        scope[safeName] = cv.value;
    });

    let parsed = formulaStr.replace(/\[(.*?)\]/g, (match, p1) => {
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

    scope.ifElse = function(condition: any, trueVal: any, falseVal: any) {
        return condition ? trueVal : falseVal;
    };

    try {
        let result = evaluate(parsed, scope);
        if (isNaN(result) || !isFinite(result)) return 0;
        return Math.round(result * 10000) / 10000; // Keep some precision
    } catch(e: any) {
        return 0; // Or throw error? Let's return 0 for now
    }
}

export function recalculateCustomVariables(vars: { id: string, name: string, value: number, formula?: string, description: string }[]) {
    // Build dependency graph
    const graph: Record<string, string[]> = {};
    const inDegree: Record<string, number> = {};
    const varMap: Record<string, any> = {};
    
    vars.forEach(v => {
        const safeName = v.name.replace(/[^a-zA-Z0-9_]/g, '_');
        varMap[safeName] = { ...v, safeName };
        graph[safeName] = [];
        inDegree[safeName] = 0;
    });

    vars.forEach(v => {
        if (!v.formula) return;
        const safeName = v.name.replace(/[^a-zA-Z0-9_]/g, '_');
        
        // Extract variables from formula
        let parsed = v.formula.replace(/\[(.*?)\]/g, (match, p1) => {
            return p1.replace(/[^a-zA-Z0-9_]/g, '_');
        });
        
        try {
            const node = parse(parsed);
            node.filter(n => (n as any).isSymbolNode).forEach(n => {
                const depName = (n as any).name;
                if (varMap[depName] && depName !== safeName) {
                    if (!graph[depName].includes(safeName)) {
                        graph[depName].push(safeName);
                        inDegree[safeName]++;
                    }
                }
            });
        } catch (e) {
            // Ignore parse errors here, they will be caught during evaluation
        }
    });

    // Topological sort
    const queue: string[] = [];
    Object.keys(inDegree).forEach(name => {
        if (inDegree[name] === 0) queue.push(name);
    });

    const sortedNames: string[] = [];
    while (queue.length > 0) {
        const current = queue.shift()!;
        sortedNames.push(current);
        
        graph[current].forEach(neighbor => {
            inDegree[neighbor]--;
            if (inDegree[neighbor] === 0) {
                queue.push(neighbor);
            }
        });
    }

    // Check for circular dependencies
    if (sortedNames.length !== vars.length) {
        console.warn("Circular dependency detected in custom variables!");
        // Fallback to old behavior if circular dependency exists
        let currentVars = [...vars];
        for (let i = 0; i < 3; i++) {
            currentVars = currentVars.map(v => {
                if (v.formula) {
                    return { ...v, value: evaluateCustomVariableFormula(v.formula, currentVars) };
                }
                return v;
            });
        }
        return currentVars;
    }

    // Evaluate in sorted order
    const evaluatedVars = [...vars];
    const evaluatedMap: Record<string, number> = {};
    
    sortedNames.forEach(name => {
        const v = varMap[name];
        if (v.formula) {
            const currentVarsList = Object.keys(evaluatedMap).map(k => ({ name: k, value: evaluatedMap[k] }));
            const val = evaluateCustomVariableFormula(v.formula, currentVarsList);
            evaluatedMap[name] = val;
            
            const index = evaluatedVars.findIndex(ev => ev.id === v.id);
            if (index !== -1) {
                evaluatedVars[index] = { ...evaluatedVars[index], value: val };
            }
        } else {
            evaluatedMap[name] = v.value;
        }
    });

    return evaluatedVars;
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
