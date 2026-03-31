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

export function evaluateCustomFormula(
    formulaStr: string, 
    takeoff: string | number, 
    overage: string | number, 
    order: string | number,
    customVars: { name: string, value: number }[] = []
): string | number {
    if (!formulaStr) return "";
    
    let t = parseFloat(takeoff as string) || 0;
    let o = parseFloat(overage as string) || 0;
    let ord = parseFloat(order as string);
    if (isNaN(ord) || ord === 0) ord = 1;

    let parsed = formulaStr
        .replace(/\[Take-off\]/ig, t.toString())
        .replace(/\[Overage %\]/ig, o.toString())
        .replace(/\[Overage\]/ig, o.toString())
        .replace(/\[Order\]/ig, ord.toString());

    customVars.forEach(cv => {
        const escapedName = cv.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\[${escapedName}\\]`, 'ig');
        parsed = parsed.replace(regex, cv.value.toString());
    });

    const ctx = {
        ROUNDUP: (val: number, decimals: number = 0) => {
            const multiplier = Math.pow(10, decimals);
            return Math.ceil(val * multiplier) / multiplier;
        },
        ROUNDDOWN: (val: number, decimals: number = 0) => {
            const multiplier = Math.pow(10, decimals);
            return Math.floor(val * multiplier) / multiplier;
        },
        ROUND: (val: number, decimals: number = 0) => {
            const multiplier = Math.pow(10, decimals);
            return Math.round(val * multiplier) / multiplier;
        },
        CEILING: (val: number) => Math.ceil(val),
        FLOOR: (val: number) => Math.floor(val),
        MAX: Math.max,
        MIN: Math.min,
        ABS: Math.abs,
        SQRT: Math.sqrt,
        POWER: Math.pow,
        IF: (cond: any, trueVal: any, falseVal: any) => cond ? trueVal : falseVal
    };

    try {
        const functionNames = ['ROUNDUP', 'ROUNDDOWN', 'ROUND', 'CEILING', 'FLOOR', 'MAX', 'MIN', 'ABS', 'SQRT', 'POWER', 'IF'];
        let safeParsed = parsed;
        functionNames.forEach(fn => {
            const regex = new RegExp(`\\b${fn}\\s*\\(`, 'ig');
            safeParsed = safeParsed.replace(regex, `ctx.${fn}(`);
        });

        let result = new Function('ctx', 'return ' + safeParsed)(ctx);
        return (isNaN(result) || !isFinite(result)) ? "ERR" : Math.round(result * 100) / 100;
    } catch(e) {
        return "ERR";
    }
}

export function getUniqueVals(array: any[], key: string) { 
    return Array.from(new Set(array.map(item => item[key] || "General"))).sort(); 
}
