import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, FlatList,
  ActivityIndicator, RefreshControl, Alert, Image, Platform, Modal,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { AppIcon } from "@/src/components/AppIcon";
import { ProductListItem } from "@/src/utils/inventory";

type TabKey = "products" | "inventory" | "shopping-list" | "shopping";

const TABS: { key: TabKey; label: string; adminOnly?: boolean }[] = [
  { key: "products", label: "Products" },
  { key: "inventory", label: "Inventory" },
  { key: "shopping-list", label: "Shopping List" },
  { key: "shopping", label: "Shopping", adminOnly: true },
];

export default function InventoryScreen() {
  const { session, apiStore, storeName } = useSession();
  const isAdmin = session?.user.role === "admin";
  const params = useLocalSearchParams<{ tab?: string; scanned?: string }>();
  const [tab, setTab] = useState<TabKey>((params.tab as TabKey) || "products");

  useEffect(() => {
    if (params.tab && params.tab !== tab) setTab(params.tab as TabKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.tab]);

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.replace("/(app)/home" as any)} style={styles.iconBtn}>
          <AppIcon name="back" size={20} color="#fff" />
          <Text style={styles.btnLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Inventory</Text>
        <View style={{ width: 80 }} />
      </View>

      {/* Tab Bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBarWrap} contentContainerStyle={styles.tabBar}>
        {TABS.filter((t) => isAdmin || !t.adminOnly).map((t) => (
          <TouchableOpacity
            key={t.key}
            testID={`tab-${t.key}`}
            style={[styles.tabBtn, tab === t.key && styles.tabBtnActive]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {tab === "products" && <ProductsTab apiStore={apiStore} isAdmin={!!isAdmin} scanned={params.scanned} />}
      {tab === "inventory" && <InventoryTab apiStore={apiStore} isAdmin={!!isAdmin} scanned={params.scanned} />}
      {tab === "shopping-list" && <ShoppingListTab apiStore={apiStore} isAdmin={!!isAdmin} storeName={storeName || "Store"} />}
      {tab === "shopping" && <Placeholder title="Shopping" desc="Admin purchase flow coming next (Milestone D)." />}
    </SafeAreaView>
  );
}

// ------------- Shopping List tab -------------
type ShoppingList = { id: string; store_id: string; kind: "continuous" | "custom"; name: string; created_at: string };
type ShoppingItem = {
  id: string; store_id: string; list_id: string;
  product_id?: string | null; product_name?: string | null;
  text: string; quantity: number; note: string; status: string;
  supplier_id?: string | null;
  purchase_price_type?: "regular" | "deal" | null;
  purchase_price?: number | null;
  source: string; added_by: string;
};
type SupplierLite = { id: string; name: string };

const ShoppingListTab: React.FC<{ apiStore: any; isAdmin: boolean; storeName: string }> = ({ apiStore, isAdmin, storeName }) => {
  const insets = useSafeAreaInsets();
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [supplierMenuOpen, setSupplierMenuOpen] = useState(false);
  const [newListModalOpen, setNewListModalOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ls, sup] = await Promise.all([
        apiStore<ShoppingList[]>("/api/inventory/shopping-lists"),
        apiStore<SupplierLite[]>("/api/inventory/suppliers"),
      ]);
      setLists(ls); setSuppliers(sup);
      if (!activeListId && ls.length > 0) setActiveListId(ls[0].id);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [apiStore, activeListId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const loadItems = useCallback(async () => {
    if (!activeListId) return;
    try {
      const its = await apiStore<ShoppingItem[]>(`/api/inventory/shopping-list?list_id=${activeListId}`);
      setItems(its);
    } catch (e: any) { Alert.alert("Error", e.message); }
  }, [apiStore, activeListId]);

  useEffect(() => { loadItems(); }, [loadItems]);

  const createList = async () => {
    if (!newListName.trim()) return;
    setBusy(true);
    try {
      const l = await apiStore<ShoppingList>("/api/inventory/shopping-lists", { method: "POST", body: JSON.stringify({ name: newListName.trim() }) });
      setNewListName("");
      setNewListModalOpen(false);
      await load();
      setActiveListId(l.id);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setBusy(false); }
  };

  const deleteList = (l: ShoppingList) => {
    if (l.kind === "continuous") return;
    Alert.alert("Delete list", `Permanently delete "${l.name}" and all its items?`, [
      { text: "Cancel" },
      { text: "Delete", style: "destructive", onPress: async () => {
        try {
          await apiStore(`/api/inventory/shopping-lists/${l.id}`, { method: "DELETE" });
          await load();
          if (activeListId === l.id) setActiveListId(lists.find((x) => x.kind === "continuous")?.id || null);
        } catch (e: any) { Alert.alert("Error", e.message); }
      }},
    ]);
  };

  const updateItem = async (iid: string, patch: Partial<ShoppingItem>) => {
    try {
      await apiStore(`/api/inventory/shopping-list/${iid}`, { method: "PATCH", body: JSON.stringify(patch) });
      await loadItems();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const deleteItem = async (iid: string) => {
    try {
      await apiStore(`/api/inventory/shopping-list/${iid}`, { method: "DELETE" });
      await loadItems();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const filtered = React.useMemo(() => {
    if (!supplierFilter) return items;
    if (supplierFilter === "__none__") return items.filter((i) => !i.supplier_id);
    return items.filter((i) => i.supplier_id === supplierFilter);
  }, [items, supplierFilter]);

  const downloadPdf = async () => {
    try {
      const { buildShoppingHtml, generateAndShare } = await import("@/src/utils/pdf");
      const supName = supplierFilter
        ? (supplierFilter === "__none__" ? "No supplier" : (suppliers.find((s) => s.id === supplierFilter)?.name || "Supplier"))
        : "All suppliers";
      const list = lists.find((l) => l.id === activeListId);
      const html = buildShoppingHtml({
        storeName,
        listName: list?.name || "Shopping List",
        supplierLabel: supName,
        items: filtered.map((it) => ({
          name: it.product_name || it.text,
          quantity: it.quantity,
          note: it.note,
          supplier: it.supplier_id ? (suppliers.find((s) => s.id === it.supplier_id)?.name || "—") : "—",
          purchase_price_type: it.purchase_price_type || "regular",
          purchase_price: it.purchase_price,
        })),
      });
      await generateAndShare(html, `Shopping - ${list?.name || "list"} - ${supName}.pdf`);
    } catch (e: any) { Alert.alert("PDF error", e.message); }
  };

  if (loading) return <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>;

  const activeList = lists.find((l) => l.id === activeListId);
  const supName = supplierFilter
    ? (supplierFilter === "__none__" ? "No supplier" : (suppliers.find((s) => s.id === supplierFilter)?.name || "Supplier"))
    : "All suppliers";

  return (
    <View style={{ flex: 1 }}>
      {/* List switcher */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabBarWrap} contentContainerStyle={styles.tabBar}>
        {lists.map((l) => (
          <TouchableOpacity
            key={l.id}
            style={[styles.tabBtn, activeListId === l.id && styles.tabBtnActive]}
            onPress={() => setActiveListId(l.id)}
            onLongPress={() => l.kind === "custom" && isAdmin && deleteList(l)}
          >
            <Text style={[styles.tabText, activeListId === l.id && styles.tabTextActive]}>
              {l.kind === "continuous" ? "📋 " : ""}{l.name}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={[styles.tabBtn, { backgroundColor: "#EFF6FF", borderColor: colors.primary }]} onPress={() => setNewListModalOpen(true)}>
          <Text style={[styles.tabText, { color: colors.primary }]}>+ New list</Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Filter + PDF row */}
      <View style={[styles.searchRow, { paddingTop: 6 }]}>
        <TouchableOpacity onPress={() => setSupplierMenuOpen(true)} style={[styles.searchBox, { paddingLeft: 12, paddingVertical: 10, alignItems: "center" }]}>
          <Text style={{ flex: 1, color: colors.text, fontWeight: "600", fontSize: 13 }}>Supplier: {supName}</Text>
          <AppIcon name="down" size={14} color={colors.textMuted} />
          <View style={{ width: 12 }} />
        </TouchableOpacity>
        <TouchableOpacity onPress={downloadPdf} style={[styles.searchSubmit]}>
          <Text style={styles.searchSubmitText}>PDF</Text>
        </TouchableOpacity>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(i) => i.id}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 100 + (insets.bottom || 0) }}
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No items{supplierFilter ? " for this supplier" : ""}</Text>
            <Text style={styles.emptyDesc}>{activeList?.kind === "continuous" ? "Items appear here when you Submit Inventory or tap Add to Shopping List on a product." : "Add items from product pages or here."}</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <ShoppingItemRow
            item={item}
            suppliers={suppliers}
            onUpdate={updateItem}
            onDelete={() => deleteItem(item.id)}
          />
        )}
      />

      {/* Save / refresh bar */}
      <View style={[styles.submitBar, { paddingBottom: spacing.md + (insets.bottom || 0) }]}>
        <TouchableOpacity onPress={loadItems} style={styles.submitBtn}>
          <Text style={styles.submitBtnText}>Save & refresh</Text>
        </TouchableOpacity>
      </View>

      {/* Supplier menu */}
      <Modal visible={supplierMenuOpen} transparent animationType="fade" onRequestClose={() => setSupplierMenuOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setSupplierMenuOpen(false)}>
          <View style={[styles.modalBox, { maxHeight: "60%" }]}>
            <Text style={styles.modalTitle}>Filter by supplier</Text>
            <ScrollView>
              <TouchableOpacity style={styles.optRow} onPress={() => { setSupplierFilter(null); setSupplierMenuOpen(false); }}>
                <Text style={{ color: colors.text, fontWeight: !supplierFilter ? "700" : "500" }}>All suppliers</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.optRow} onPress={() => { setSupplierFilter("__none__"); setSupplierMenuOpen(false); }}>
                <Text style={{ color: colors.textMuted }}>— No supplier set —</Text>
              </TouchableOpacity>
              {suppliers.map((s) => (
                <TouchableOpacity key={s.id} style={[styles.optRow, supplierFilter === s.id && { backgroundColor: "#DBEAFE" }]} onPress={() => { setSupplierFilter(s.id); setSupplierMenuOpen(false); }}>
                  <Text style={{ color: colors.text, fontWeight: supplierFilter === s.id ? "700" : "500" }}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* New list modal */}
      <Modal visible={newListModalOpen} transparent animationType="slide" onRequestClose={() => setNewListModalOpen(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>New custom shopping list</Text>
            <TextInput style={styles.searchInput} placeholder="List name (e.g. Friday Costco run)" placeholderTextColor={colors.textLight} value={newListName} onChangeText={setNewListName} autoFocus />
            <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
              <TouchableOpacity onPress={() => setNewListModalOpen(false)} style={[styles.searchSubmit, { flex: 1 }]}>
                <Text style={styles.searchSubmitText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={createList} disabled={busy} style={[styles.addBtn, { flex: 1, paddingVertical: 12 }]}>
                <Text style={styles.addBtnText}>{busy ? "..." : "Create"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const ShoppingItemRow: React.FC<{ item: ShoppingItem; suppliers: SupplierLite[]; onUpdate: (iid: string, patch: Partial<ShoppingItem>) => void; onDelete: () => void }> = ({ item, suppliers, onUpdate, onDelete }) => {
  const [qty, setQty] = useState(String(item.quantity || ""));
  const [note, setNote] = useState(item.note || "");
  const [price, setPrice] = useState(item.purchase_price != null ? String(item.purchase_price) : "");
  const [supOpen, setSupOpen] = useState(false);
  const [ptOpen, setPtOpen] = useState(false);
  const sup = suppliers.find((s) => s.id === item.supplier_id);
  const pt = item.purchase_price_type || "regular";

  useEffect(() => {
    setQty(String(item.quantity || ""));
    setNote(item.note || "");
    setPrice(item.purchase_price != null ? String(item.purchase_price) : "");
  }, [item.quantity, item.note, item.purchase_price]);

  return (
    <View style={styles.stockCard}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.productName} numberOfLines={1}>{item.product_name || item.text}</Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
          <TextInput
            style={[styles.qtyInput, { width: 60 }]}
            keyboardType="number-pad"
            value={qty}
            onChangeText={(v) => setQty(v.replace(/[^0-9]/g, ""))}
            onBlur={() => { const n = parseInt(qty || "0", 10) || 0; if (n !== item.quantity) onUpdate(item.id, { quantity: n }); }}
          />
          <TouchableOpacity style={[styles.chip, { backgroundColor: colors.surface }]} onPress={() => setSupOpen(true)}>
            <Text style={styles.chipText}>{sup?.name || "Supplier"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.chip, { backgroundColor: pt === "deal" ? "#FEF3C7" : colors.surface }]} onPress={() => setPtOpen(true)}>
            <Text style={styles.chipText}>{pt === "deal" ? "Deal" : "Regular"}</Text>
          </TouchableOpacity>
          <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 6, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ color: colors.textMuted, fontSize: 12 }}>$</Text>
            <TextInput
              style={{ width: 60, paddingVertical: 6, fontSize: 13, color: colors.text, fontWeight: "600", textAlign: "right" }}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textLight}
              value={price}
              onChangeText={setPrice}
              onBlur={() => { const n = price === "" ? null : (parseFloat(price) || 0); if (n !== item.purchase_price) onUpdate(item.id, { purchase_price: n as any }); }}
            />
          </View>
        </View>
        <TextInput
          style={[styles.qtyInput, { width: "100%", textAlign: "left", marginTop: 6, fontWeight: "400" }]}
          placeholder="Note"
          placeholderTextColor={colors.textLight}
          value={note}
          onChangeText={setNote}
          onBlur={() => { if (note !== item.note) onUpdate(item.id, { note }); }}
        />
      </View>
      <TouchableOpacity onPress={onDelete} style={{ padding: 8 }}>
        <AppIcon name="trash" size={16} color={colors.danger} />
      </TouchableOpacity>

      {/* Supplier picker */}
      <Modal visible={supOpen} transparent animationType="fade" onRequestClose={() => setSupOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setSupOpen(false)}>
          <View style={[styles.modalBox, { maxHeight: "60%" }]}>
            <Text style={styles.modalTitle}>Supplier</Text>
            <ScrollView>
              <TouchableOpacity style={styles.optRow} onPress={() => { onUpdate(item.id, { supplier_id: null as any }); setSupOpen(false); }}>
                <Text style={{ color: colors.textMuted }}>— None —</Text>
              </TouchableOpacity>
              {suppliers.map((s) => (
                <TouchableOpacity key={s.id} style={[styles.optRow, item.supplier_id === s.id && { backgroundColor: "#DBEAFE" }]} onPress={() => { onUpdate(item.id, { supplier_id: s.id }); setSupOpen(false); }}>
                  <Text style={{ color: colors.text, fontWeight: item.supplier_id === s.id ? "700" : "500" }}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Price type picker */}
      <Modal visible={ptOpen} transparent animationType="fade" onRequestClose={() => setPtOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setPtOpen(false)}>
          <View style={[styles.modalBox, { maxHeight: "40%" }]}>
            <Text style={styles.modalTitle}>Purchase price type</Text>
            {(["regular", "deal"] as const).map((opt) => (
              <TouchableOpacity key={opt} style={[styles.optRow, pt === opt && { backgroundColor: "#DBEAFE" }]} onPress={() => { onUpdate(item.id, { purchase_price_type: opt }); setPtOpen(false); }}>
                <Text style={{ color: colors.text, fontWeight: pt === opt ? "700" : "500" }}>{opt === "deal" ? "Deal" : "Regular"}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

// ------------- Inventory (stock count) tab -------------
type StockRow = {
  id: string;
  store_id: string;
  product_id: string;
  quantity: number;
  updated_at: string;
  updated_by: string;
  product?: { id: string; name: string; company?: string; size?: string; barcode?: string; selling_price?: number };
};

const InventoryTab: React.FC<{ apiStore: any; isAdmin: boolean; scanned?: string }> = ({ apiStore, isAdmin, scanned }) => {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  // Per-product input draft so typing isn't interrupted by network round-trips
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const handledScanRef = React.useRef<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [stock, plist] = await Promise.all([
        apiStore<StockRow[]>("/api/inventory/stock"),
        apiStore<ProductListItem[]>("/api/inventory/products?limit=500"),
      ]);
      setRows(stock);
      setProducts(plist);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [apiStore]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // When returning from scanner with a barcode, find product and +1
  useEffect(() => {
    if (!scanned || handledScanRef.current === scanned) return;
    handledScanRef.current = scanned;
    (async () => {
      try {
        const list = await apiStore<ProductListItem[]>(`/api/inventory/products?barcode=${encodeURIComponent(scanned)}`);
        if (list.length !== 1) {
          Alert.alert("Not found", `No product with barcode "${scanned}".`);
          return;
        }
        await apiStore("/api/inventory/stock/increment", {
          method: "POST",
          body: JSON.stringify({ product_id: list[0].id, delta: 1 }),
        });
        await load();
      } catch (e: any) { Alert.alert("Error", e.message); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

  const setQuantity = async (productId: string, qty: number) => {
    try {
      await apiStore("/api/inventory/stock/set", {
        method: "POST",
        body: JSON.stringify({ product_id: productId, quantity: qty }),
      });
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const increment = async (productId: string, delta: number) => {
    try {
      await apiStore("/api/inventory/stock/increment", {
        method: "POST",
        body: JSON.stringify({ product_id: productId, delta }),
      });
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
  };

  const resetAll = () => {
    Alert.alert("Reset all counts?", "Sets every product's on-hand count to 0. Shopping list items remain untouched.", [
      { text: "Cancel" },
      {
        text: "Reset", style: "destructive",
        onPress: async () => {
          setResetting(true);
          try {
            await apiStore("/api/inventory/stock/reset", { method: "POST" });
            await load();
          } catch (e: any) { Alert.alert("Error", e.message); }
          finally { setResetting(false); }
        },
      },
    ]);
  };

  const submit = async () => {
    setSubmitting(true);
    try {
      const r = await apiStore<{ orders_added: number }>("/api/inventory/stock/submit", { method: "POST" });
      Alert.alert("Submitted", `${r.orders_added} item(s) added/updated in the continuous shopping list.`);
      await load();
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setSubmitting(false); }
  };

  // Merged display list: every product with its current count (or 0)
  const countByPid = React.useMemo(() => {
    const m: Record<string, number> = {};
    rows.forEach((r) => { m[r.product_id] = r.quantity; });
    return m;
  }, [rows]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) =>
      p.name.toLowerCase().includes(q) ||
      (p.company || "").toLowerCase().includes(q) ||
      (p.barcode || "").toLowerCase().includes(q),
    );
  }, [products, query]);

  if (loading) return <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={{ flex: 1 }}>
      {/* Top action bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search to count"
            placeholderTextColor={colors.textLight}
            style={styles.searchInput}
            returnKeyType="search"
          />
          <TouchableOpacity onPress={() => router.push({ pathname: "/(app)/inventory/scan" as any, params: { returnTo: "/(app)/inventory", tab: "inventory" } })} style={styles.scanBtn}>
            <ScannerIcon size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        {isAdmin && (
          <TouchableOpacity onPress={resetAll} disabled={resetting} style={[styles.searchSubmit, { borderColor: colors.danger }]}>
            <Text style={[styles.searchSubmitText, { color: colors.danger }]}>{resetting ? "..." : "Reset"}</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 100 + (insets.bottom || 0) }}
        ItemSeparatorComponent={() => <View style={{ height: 6 }} />}
        ListEmptyComponent={() => (
          <View style={styles.emptyState}>
            <Text style={styles.emptyTitle}>No products</Text>
            <Text style={styles.emptyDesc}>Add products in the Products tab first.</Text>
          </View>
        )}
        renderItem={({ item }) => {
          const qty = countByPid[item.id] || 0;
          const draftVal = drafts[item.id] !== undefined ? drafts[item.id] : String(qty);
          return (
            <View style={styles.stockCard}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
                {(item.company || item.size) ? (
                  <Text style={styles.productMeta} numberOfLines={1}>
                    {item.company}{item.size ? ` · ${item.size}` : ""}
                  </Text>
                ) : null}
              </View>
              <View style={styles.qtyRow}>
                <TouchableOpacity
                  onPress={() => {
                    setDrafts((d) => { const c = { ...d }; delete c[item.id]; return c; });
                    increment(item.id, -1);
                  }}
                  style={styles.qtyBtn}
                >
                  <Text style={styles.qtyBtnText}>−</Text>
                </TouchableOpacity>
                <TextInput
                  style={styles.qtyInput}
                  value={draftVal}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  onChangeText={(v) => {
                    // keep typed value locally; don't call API on every keystroke
                    setDrafts((d) => ({ ...d, [item.id]: v.replace(/[^0-9.]/g, "") }));
                  }}
                  onBlur={() => {
                    const txt = drafts[item.id];
                    if (txt === undefined) return; // nothing changed
                    const n = parseFloat(txt) || 0;
                    setDrafts((d) => { const c = { ...d }; delete c[item.id]; return c; });
                    if (n !== qty) setQuantity(item.id, n);
                  }}
                />
                <TouchableOpacity
                  onPress={() => {
                    setDrafts((d) => { const c = { ...d }; delete c[item.id]; return c; });
                    increment(item.id, 1);
                  }}
                  style={styles.qtyBtn}
                >
                  <Text style={styles.qtyBtnText}>+</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        }}
      />

      {isAdmin && (
        <View style={[styles.submitBar, { paddingBottom: spacing.md + (insets.bottom || 0) }]}>
          <TouchableOpacity onPress={submit} disabled={submitting} style={styles.submitBtn}>
            {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitBtnText}>Submit Inventory → generate orders</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// ------------- Products tab -------------
const ProductsTab: React.FC<{ apiStore: any; isAdmin: boolean; scanned?: string }> = ({ apiStore, isAdmin, scanned }) => {
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (q?: string) => {
    try {
      const search = (q ?? activeQuery).trim();
      const qs = search ? `&q=${encodeURIComponent(search)}` : "";
      const list = await apiStore<ProductListItem[]>(`/api/inventory/products?limit=200${qs}`);
      setProducts(list);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [apiStore, activeQuery]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // If we returned from scanner with a barcode, look it up
  useEffect(() => {
    if (!scanned) return;
    (async () => {
      try {
        const list = await apiStore<ProductListItem[]>(`/api/inventory/products?barcode=${encodeURIComponent(scanned)}`);
        if (list.length === 1) {
          router.replace(`/(app)/inventory/product/${list[0].id}` as any);
        } else if (list.length === 0) {
          Alert.alert(
            "Product not in system",
            `No product found with barcode \"${scanned}\".`,
            isAdmin ? [
              { text: "Cancel" },
              { text: "Add product", onPress: () => router.push({ pathname: "/(app)/inventory/product/new" as any, params: { barcode: scanned } }) },
            ] : [{ text: "OK" }],
          );
        }
      } catch (e: any) { Alert.alert("Lookup error", e.message); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

  const submitSearch = () => { setActiveQuery(query); load(query); };

  return (
    <View style={{ flex: 1 }}>
      {/* Search + scan + add row */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextInput
            testID="product-search"
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submitSearch}
            placeholder="Search by name, company, keyword, price"
            placeholderTextColor={colors.textLight}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(""); setActiveQuery(""); load(""); }} style={styles.clearBtn}>
              <AppIcon name="close" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            testID="scan-btn"
            onPress={() => router.push("/(app)/inventory/scan" as any)}
            style={styles.scanBtn}
          >
            <ScannerIcon size={20} color="#fff" />
          </TouchableOpacity>
        </View>
        <TouchableOpacity testID="search-btn" style={styles.searchSubmit} onPress={submitSearch}>
          <Text style={styles.searchSubmitText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* Add product (admin) */}
      {isAdmin && (
        <View style={{ flexDirection: "row", paddingHorizontal: spacing.md, gap: spacing.sm, marginBottom: spacing.sm, flexWrap: "wrap" }}>
          <TouchableOpacity
            testID="add-product-btn"
            style={styles.addBtn}
            onPress={() => router.push("/(app)/inventory/product/new" as any)}
          >
            <AppIcon name="plus" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Add Product</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="suppliers-btn"
            style={[styles.secondaryBtn]}
            onPress={() => router.push("/(app)/inventory/suppliers" as any)}
          >
            <Text style={styles.secondaryBtnText}>Suppliers</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="taxonomy-btn"
            style={[styles.secondaryBtn]}
            onPress={() => router.push("/(app)/inventory/taxonomy" as any)}
          >
            <Text style={styles.secondaryBtnText}>Categories</Text>
          </TouchableOpacity>
        </View>
      )}

      {loading ? (
        <View style={{ paddingVertical: 40, alignItems: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={products}
          keyExtractor={(p) => p.id}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingBottom: 60 }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.primary} />}
          ListEmptyComponent={() => (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No products</Text>
              <Text style={styles.emptyDesc}>
                {activeQuery ? `No matches for \"${activeQuery}\". ` : ""}
                {isAdmin ? "Tap “Add Product” to create one or scan a barcode." : "Ask your admin to add products."}
              </Text>
            </View>
          )}
          renderItem={({ item }) => <ProductRow item={item} />}
        />
      )}
    </View>
  );
};

const ProductRow: React.FC<{ item: ProductListItem }> = ({ item }) => {
  return (
    <TouchableOpacity
      testID={`product-row-${item.id}`}
      style={styles.productCard}
      onPress={() => router.push(`/(app)/inventory/product/${item.id}` as any)}
      activeOpacity={0.85}
    >
      <View style={styles.thumbBox}>
        {item.thumbnail ? (
          <Image source={{ uri: item.thumbnail.startsWith("data:") ? item.thumbnail : `data:image/jpeg;base64,${item.thumbnail}` }} style={styles.thumbImg} />
        ) : (
          <Text style={styles.thumbInitial}>{(item.name || "?")[0].toUpperCase()}</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.productName} numberOfLines={1}>{item.name}</Text>
        {!!item.company && <Text style={styles.productMeta} numberOfLines={1}>{item.company}</Text>}
        <View style={styles.productMetaRow}>
          {!!item.size && <Text style={styles.metaPill}>{item.size}</Text>}
          {!!item.pack_size && <Text style={styles.metaPill}>{item.pack_size}</Text>}
          {!!item.barcode && <Text style={[styles.metaPill, { color: colors.primary }]}>★ barcode</Text>}
        </View>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={styles.priceTag}>${(item.selling_price || 0).toFixed(2)}</Text>
        <AppIcon name="forward" size={14} color={colors.textMuted} />
      </View>
    </TouchableOpacity>
  );
};

// View-based scanner icon (square + corner brackets)
const ScannerIcon: React.FC<{ size: number; color: string }> = ({ size, color }) => {
  const s = 2; // stroke
  const k = size * 0.22;
  const corner = (top?: number, bottom?: number, left?: number, right?: number) => ({
    position: "absolute" as const,
    width: k,
    height: k,
    ...(top !== undefined ? { top } : {}),
    ...(bottom !== undefined ? { bottom } : {}),
    ...(left !== undefined ? { left } : {}),
    ...(right !== undefined ? { right } : {}),
    borderColor: color,
  });
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <View style={{ ...corner(2, undefined, 2, undefined), borderTopWidth: s, borderLeftWidth: s }} />
      <View style={{ ...corner(2, undefined, undefined, 2), borderTopWidth: s, borderRightWidth: s }} />
      <View style={{ ...corner(undefined, 2, 2, undefined), borderBottomWidth: s, borderLeftWidth: s }} />
      <View style={{ ...corner(undefined, 2, undefined, 2), borderBottomWidth: s, borderRightWidth: s }} />
      <View style={{ position: "absolute", left: 4, right: 4, height: s, backgroundColor: color }} />
    </View>
  );
};

const Placeholder: React.FC<{ title: string; desc: string }> = ({ title, desc }) => (
  <View style={styles.placeholder}>
    <Text style={styles.placeholderTitle}>{title}</Text>
    <Text style={styles.placeholderDesc}>{desc}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  iconBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },

  tabBarWrap: { flexGrow: 0, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border },
  tabBar: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingVertical: spacing.sm },
  tabBtn: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  tabBtnActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  tabText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: "#fff" },

  searchRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  searchBox: {
    flex: 1, flexDirection: "row", alignItems: "center",
    backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
    paddingLeft: 12,
  },
  searchInput: { flex: 1, paddingVertical: Platform.OS === "ios" ? 12 : 8, fontSize: 14, color: colors.text },
  clearBtn: { paddingHorizontal: 8 },
  scanBtn: {
    width: 44, height: 44, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.primary, borderTopRightRadius: radius.md, borderBottomRightRadius: radius.md,
  },
  searchSubmit: {
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  searchSubmitText: { color: colors.text, fontWeight: "700", fontSize: 13 },

  addBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, paddingHorizontal: 16, borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  secondaryBtn: {
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  secondaryBtnText: { color: colors.text, fontWeight: "700", fontSize: 13 },

  productCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  thumbBox: {
    width: 52, height: 52, borderRadius: radius.md, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
    borderWidth: 1, borderColor: colors.border,
  },
  thumbImg: { width: "100%", height: "100%" },
  thumbInitial: { fontSize: 22, fontWeight: "700", color: colors.textMuted },
  productName: { fontSize: 15, fontWeight: "700", color: colors.text },
  productMeta: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  productMetaRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  metaPill: {
    fontSize: 10, color: colors.textMuted, paddingHorizontal: 6, paddingVertical: 2,
    backgroundColor: colors.surface, borderRadius: 4, fontWeight: "600",
  },
  priceTag: { fontSize: 16, fontWeight: "700", color: colors.primary },

  emptyState: { paddingVertical: 50, alignItems: "center" },
  emptyTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  emptyDesc: { fontSize: 13, color: colors.textMuted, textAlign: "center", marginTop: 6, paddingHorizontal: 30 },

  placeholder: {
    margin: spacing.lg, padding: spacing.lg, backgroundColor: colors.card,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
  },
  placeholderTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  placeholderDesc: { fontSize: 13, color: colors.textMuted, marginTop: 6 },

  // Inventory tab specific
  stockCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  qtyRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  qtyBtn: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center",
  },
  qtyBtnText: { fontSize: 18, fontWeight: "700", color: colors.primary },
  qtyInput: {
    width: 56, paddingVertical: 6, textAlign: "center", fontWeight: "700", fontSize: 15,
    color: colors.text, backgroundColor: colors.surface, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  submitBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    padding: spacing.md, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border,
  },
  submitBtn: { backgroundColor: colors.primary, padding: 14, borderRadius: radius.md, alignItems: "center" },
  submitBtnText: { color: "#fff", fontWeight: "700", fontSize: 14 },

  // Shared modal styles
  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", alignItems: "center", padding: spacing.lg },
  modalBox: { width: "100%", maxWidth: 420, backgroundColor: colors.card, padding: spacing.lg, borderRadius: radius.lg, gap: spacing.sm, maxHeight: "75%" },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.text, marginBottom: 8 },
  optRow: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border },
  chipText: { color: colors.text, fontWeight: "600", fontSize: 12 },
});
