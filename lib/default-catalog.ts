export interface CatalogItem {
  id: string;
  name: string;
  unit: string;
  unitPrice: number;
  category: string;
}

export const DEFAULT_CATALOG: CatalogItem[] = [
  {
    id: "1",
    name: "Standard Item",
    unit: "pcs",
    unitPrice: 100,
    category: "General",
  },
];

export const defaultCatalog = DEFAULT_CATALOG;
