// Inventory API helpers — Phase 3
// All endpoints require store_id appended as query param. The SessionProvider's
// `apiStore` helper does that automatically.

export type Supplier = {
  id: string;
  store_id: string;
  name: string;
  contact: string;
  notes: string;
  created_at: string;
};

export type Taxonomy = {
  id: string;
  store_id: string;
  kind: "category" | "purchase_type";
  name: string;
  created_at: string;
};

export type PurchasePriceEntry = {
  id: string;
  date: string;
  price: number;
  supplier_id?: string | null;
  source: "manual" | "shopping" | "adjustment";
  note?: string;
};

export type AvgSales = {
  quantity: number;
  period_days: number;
  per_day: number;
};

export type Product = {
  id: string;
  store_id: string;
  name: string;
  barcode?: string | null;
  size: string;
  company: string;
  pack_size: string;
  category_id?: string | null;
  ideal_profit_margin: number;
  selling_price: number;
  tax_pct: number;
  preferred_supplier_ids: string[];
  images: string[];                  // base64
  barcode_image?: string | null;     // base64
  purchase_prices: PurchasePriceEntry[];
  avg_sales: AvgSales;
  expiry_sensitivity_days: number;
  min_inventory_days: number;
  max_inventory_days: number;
  purchase_type_ids: string[];
  keywords: string[];
  created_at: string;
  updated_at: string;
};

export type ProductListItem = Omit<Product, "images" | "barcode_image"> & {
  images_count: number;
  thumbnail?: string | null;
  images: string[];
  barcode_image?: string | null;
};

/** Sort purchase prices low → high. */
export const sortPricesAsc = (entries: PurchasePriceEntry[]): PurchasePriceEntry[] => {
  return [...entries].sort((a, b) => (a.price || 0) - (b.price || 0));
};

/** Min / max / latest of historic prices. */
export const priceStats = (entries: PurchasePriceEntry[]) => {
  if (!entries || entries.length === 0) return { lowest: null, highest: null, latest: null };
  const sortedByDate = [...entries].sort((a, b) => (a.date < b.date ? 1 : -1));
  const sortedByPrice = sortPricesAsc(entries);
  return {
    lowest: sortedByPrice[0].price,
    highest: sortedByPrice[sortedByPrice.length - 1].price,
    latest: sortedByDate[0].price,
  };
};
