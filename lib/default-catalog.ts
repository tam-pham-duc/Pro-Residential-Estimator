import { Item } from './types';

export const DEFAULT_CATALOG: Item[] = [
  {
    item_id: "1",
    building_type: "Residential",
    category: "Concrete",
    sub_category: "Foundation",
    sub_item_1: "Footings",
    item_name: "Standard Footing Concrete",
    uom: "CY",
    calc_factor_instruction: "([Take-off] * 1.05) / 27",
    notes: "Includes 5% waste",
    material_order: "1"
  },
  {
    item_id: "2",
    building_type: "Residential",
    category: "Wood",
    sub_category: "Framing",
    sub_item_1: "Studs",
    item_name: "2x4x8 Stud",
    uom: "EA",
    calc_factor_instruction: "[Take-off] / 1.33",
    notes: "Standard 16\" spacing",
    material_order: "1"
  },
  {
    item_id: "3",
    building_type: "Commercial",
    category: "Concrete",
    sub_category: "Slab",
    sub_item_1: "Reinforced",
    item_name: "4000 PSI Concrete",
    uom: "CY",
    calc_factor_instruction: "([Take-off] * 1.05) / 27",
    notes: "Standard commercial slab concrete",
    material_order: "1"
  }
];

export const defaultCatalog = DEFAULT_CATALOG;
