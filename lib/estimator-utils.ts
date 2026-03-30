export const DEFAULT_QTY_FORMULA = "ROUNDUP([Take-off] * (1 + [Overage %]/100) / [Order])";

export function evaluateMath(inputStr: string | number): string | number {
    if (!inputStr) return "";
    let sanitized = inputStr.toString().replace(/[^0-9+\-*/().]/g, '');
    if (sanitized === "") return "";
    try { 
        let result = new Function('return ' + sanitized)(); 
        return Math.round(result * 100) / 100; 
    } catch (e) { 
        return inputStr; 
    }
}

export function evaluateCustomFormula(formulaStr: string, takeoff: string | number, overage: string | number, order: string | number): string | number {
    if (!formulaStr) return "";
    
    let t = parseFloat(takeoff as string) || 0;
    let o = parseFloat(overage as string) || 0;
    let ord = parseFloat(order as string);
    if (isNaN(ord) || ord === 0) ord = 1;

    let parsed = formulaStr
        .replace(/\[Take-off\]/ig, t.toString())
        .replace(/\[Overage %\]/ig, o.toString())
        .replace(/\[Overage\]/ig, o.toString())
        .replace(/\[Order\]/ig, ord.toString())
        .replace(/ROUNDUP\(([^,)]+)(?:,\s*0)?\)/ig, 'Math.ceil($1)')
        .replace(/ROUNDDOWN\(([^,)]+)(?:,\s*0)?\)/ig, 'Math.floor($1)')
        .replace(/ROUND\(([^,)]+)(?:,\s*0)?\)/ig, 'Math.round($1)');

    try {
        let result = new Function('return ' + parsed)();
        return (isNaN(result) || !isFinite(result)) ? "ERR" : Math.round(result * 100) / 100;
    } catch(e) {
        return "ERR";
    }
}

export function getUniqueVals(array: any[], key: string) { 
    return Array.from(new Set(array.map(item => item[key] || "General"))).sort(); 
}
