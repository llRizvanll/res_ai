// Menu: categories, items and their variants.
export interface Variant {
  name: string;
  price: number;
}

export interface Category {
  id: number;
  name: string;
  sort: number;
  active: number;
}

export interface MenuItem {
  id: number;
  category_id: number | null;
  name: string;
  code: string | null;
  description: string | null;
  price: number;
  tax_rate: number;
  veg: number;
  available: number;
  variants: Variant[];
  sort: number;
}

export interface Menu {
  categories: Category[];
  items: MenuItem[];
}
