export interface Job {
  id: string;
  name: string;
  client: string;
  date: string;
  items: JobItem[];
  totalPrice: number;
}

export interface JobItem {
  id: string;
  name: string;
  qty: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  items: JobItem[];
}
