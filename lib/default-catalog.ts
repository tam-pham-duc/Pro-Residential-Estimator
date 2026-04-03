import { Item } from './types';

export const defaultCatalog: Item[] = [
    // --- CẤP 1: BASEMENT/FOUNDATION FRAMING ---
    { item_id: "FND-001", category: "BASEMENT/FOUNDATION", sub_category: "Egress Well", item_name: "Egress Well w/Accessories", uom: "EA", calc_factor_instruction: "Piece count (modular units)", notes: "Includes Well, Cover, Ladder" },
    { item_id: "FND-002", category: "BASEMENT/FOUNDATION", sub_category: "Sill System", item_name: "Sill Seal", uom: "Roll", calc_factor_instruction: "Total LF perimeter: 10% overage", notes: "Perimeter only" },
    { item_id: "FND-003", category: "BASEMENT/FOUNDATION", sub_category: "Sill System", item_name: "Treated Sill Plate", uom: "LF", calc_factor_instruction: "Total LF under joists: 10% overage", notes: "Does not include wall plates" },
    { item_id: "FND-004", category: "BASEMENT/FOUNDATION", sub_category: "Ext Wall Framing", item_name: "Treated Bottom Plate", uom: "LF", calc_factor_instruction: "Total LF of wall: 10% overage", notes: "Single treated bottom" },
    { item_id: "FND-005", category: "BASEMENT/FOUNDATION", sub_category: "Ext Wall Framing", item_name: "Top Plates", uom: "LF", calc_factor_instruction: "Total LF of wall: 10% overage", notes: "Double non-treated top plates" },
    { item_id: "FND-006", category: "BASEMENT/FOUNDATION", sub_category: "Ext Wall Framing", item_name: "Wall Studs", uom: "EA", calc_factor_instruction: "Total LF = number of studs: 25% overage", notes: "1 stud per LF (includes corners)" },
    { item_id: "FND-007", category: "BASEMENT/FOUNDATION", sub_category: "Ext Wall Framing", item_name: "Headers", uom: "LF", calc_factor_instruction: "Total LF * plys needed", notes: "Add 8 inch for bearing" },

    // --- CẤP 1: FLOOR JOIST & SUBFLOOR FRAMING ---
    { item_id: "FLR-001", category: "FLOOR JOIST & SUBFLOOR", sub_category: "Support Columns", item_name: "FHA Columns/U-Boots", uom: "EA", calc_factor_instruction: "Piece count", notes: "Spacing 8' to 10'" },
    { item_id: "FLR-002", category: "FLOOR JOIST & SUBFLOOR", sub_category: "Floor Joist", item_name: "Beams", uom: "LF", calc_factor_instruction: "Total LF * number of plys", notes: "Consult Span Tables" },
    { item_id: "FLR-003", category: "FLOOR JOIST & SUBFLOOR", sub_category: "Floor Joist", item_name: "Floor Joists", uom: "EA", calc_factor_instruction: "Bldg length / OC spacing + 1", notes: "Consult Span Tables" },
    { item_id: "FLR-004", category: "FLOOR JOIST & SUBFLOOR", sub_category: "Floor Joist", item_name: "Rim Sheathing", uom: "LF", calc_factor_instruction: "Total LF at ends of floor joist", notes: "" },
    { item_id: "FLR-005", category: "FLOOR JOIST & SUBFLOOR", sub_category: "Sub-Floor (Decking)", item_name: "Sub-Floor Sheets", uom: "Sheet", calc_factor_instruction: "Total SqFt / sheet size: 15% overage", notes: "" },

    // --- CẤP 1: MAIN LEVEL FRAMING ---
    { item_id: "MNL-001", category: "MAIN LEVEL FRAMING", sub_category: "Ext Wall Framing", item_name: "Plates", uom: "LF", calc_factor_instruction: "Total LF: 10% overage", notes: "Triple non-treated top plates" },
    { item_id: "MNL-002", category: "MAIN LEVEL FRAMING", sub_category: "Ext Wall Framing", item_name: "Wall Studs", uom: "EA", calc_factor_instruction: "Total LF = number of studs: 25% overage", notes: "1 stud per LF includes corners" },
    { item_id: "MNL-003", category: "MAIN LEVEL FRAMING", sub_category: "Ext Wall Framing", item_name: "Wall Sheathing", uom: "Sheet", calc_factor_instruction: "Total SqFt / sheet size: 15% overage", notes: "Includes Gable Ends, Tall Truss Heels" },
    { item_id: "MNL-004", category: "MAIN LEVEL FRAMING", sub_category: "Porch/Deck Framing", item_name: "Porch Posts/Columns", uom: "EA", calc_factor_instruction: "Piece count", notes: "" },

    // --- CẤP 1: ROOF FRAMING ---
    { item_id: "ROF-001", category: "ROOF FRAMING", sub_category: "Dimensional Lumber Roof", item_name: "Ridge Board", uom: "LF", calc_factor_instruction: "Total LF * number of plys", notes: "" },
    { item_id: "ROF-002", category: "ROOF FRAMING", sub_category: "Dimensional Lumber Roof", item_name: "Common Rafters", uom: "EA", calc_factor_instruction: "Bldg length / OC spacing + 1", notes: "Rise/Run = Pitch; use Pitch Calc multipliers" },
    { item_id: "ROF-003", category: "ROOF FRAMING", sub_category: "Roof Sheathing", item_name: "Roof Sheathing", uom: "Sheet", calc_factor_instruction: "Total roof SqFt / sheet size: 15% overage", notes: "" },

    // --- CẤP 1: ROOF COVERING ---
    { item_id: "RCV-001", category: "ROOF COVERING", sub_category: "Shingle Roof", item_name: "Ice & Water", uom: "Roll", calc_factor_instruction: "Total LF at req'd areas / roll length: 15% overage", notes: "Valleys, Eaves, Rakes" },
    { item_id: "RCV-002", category: "ROOF COVERING", sub_category: "Shingle Roof", item_name: "Shingle", uom: "SQ", calc_factor_instruction: "Total SqFt / 100: 15% overage", notes: "Break out by bundles if needed" }
];
