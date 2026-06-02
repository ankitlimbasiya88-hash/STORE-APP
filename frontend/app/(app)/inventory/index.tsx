import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, FlatList,
  ActivityIndicator, RefreshControl, Alert, Image, Platform, Modal,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { AppIcon } from "@/src/components/AppIcon";
import { PriceInput } from "@/src/components/PriceInput";
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
      {tab === "shopping" && <ShoppingTab apiStore={apiStore} isAdmin={!!isAdmin} storeName={storeName || "Store"} />}
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
  purchase_price_type?: "regular" | "deal" | "both" | null;
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
  const [productThumbs, setProductThumbs] = useState<Record<string, string | null>>({});
  const [productCategoryId, setProductCategoryId] = useState<Record<string, string | null>>({});
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [supplierMenuOpen, setSupplierMenuOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [newListModalOpen, setNewListModalOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ls, sup, plist, cats] = await Promise.all([
        apiStore<ShoppingList[]>("/api/inventory/shopping-lists"),
        apiStore<SupplierLite[]>("/api/inventory/suppliers"),
        apiStore<ProductListItem[]>("/api/inventory/products?limit=500"),
        apiStore<{ id: string; name: string }[]>("/api/inventory/categories"),
      ]);
      setLists(ls); setSuppliers(sup); setCategories(cats);
      const thumbs: Record<string, string | null> = {};
      const catMap: Record<string, string | null> = {};
      plist.forEach((p: any) => {
        thumbs[p.id] = p.thumbnail || null;
        catMap[p.id] = p.category_id || null;
      });
      setProductThumbs(thumbs); setProductCategoryId(catMap);
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
    let arr = items;
    if (supplierFilter) {
      if (supplierFilter === "__none__") arr = arr.filter((i) => !i.supplier_id);
      else arr = arr.filter((i) => i.supplier_id === supplierFilter);
    }
    if (categoryFilter) {
      if (categoryFilter === "__none__") {
        arr = arr.filter((i) => !i.product_id || !productCategoryId[i.product_id]);
      } else {
        arr = arr.filter((i) => i.product_id && productCategoryId[i.product_id] === categoryFilter);
      }
    }
    const q = query.trim().toLowerCase();
    if (q) {
      arr = arr.filter((i) => {
        const name = (i.product_name || i.text || "").toLowerCase();
        const note = (i.note || "").toLowerCase();
        return name.includes(q) || note.includes(q);
      });
    }
    return arr;
  }, [items, supplierFilter, categoryFilter, query, productCategoryId]);

  const supName = supplierFilter
    ? (supplierFilter === "__none__" ? "No supplier" : (suppliers.find((s) => s.id === supplierFilter)?.name || "Supplier"))
    : "All";
  const catName = categoryFilter
    ? (categoryFilter === "__none__" ? "Uncategorized" : (categories.find((c) => c.id === categoryFilter)?.name || "Category"))
    : "All";

  const downloadPdf = async () => {
    try {
      const { buildShoppingHtml, generateAndShare } = await import("@/src/utils/pdf");
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

  const downloadCsv = async () => {
    try {
      const { buildCsv, shareCsv } = await import("@/src/utils/csv");
      const list = lists.find((l) => l.id === activeListId);
      const headers = ["Product", "Quantity", "Supplier", "Category", "Price type", "Price", "Note"];
      const rows = filtered.map((it) => [
        it.product_name || it.text,
        Math.max(0, Math.round(it.quantity || 0)),
        it.supplier_id ? (suppliers.find((s) => s.id === it.supplier_id)?.name || "") : "",
        it.product_id ? (categories.find((c) => c.id === productCategoryId[it.product_id!])?.name || "") : "",
        it.purchase_price_type || "regular",
        it.purchase_price != null ? it.purchase_price : "",
        it.note || "",
      ]);
      const csv = buildCsv(headers, rows);
      await shareCsv(csv, `Shopping_${(list?.name || "list").replace(/\W+/g, "_")}_${supName.replace(/\W+/g, "_")}.csv`);
    } catch (e: any) { Alert.alert("CSV error", e.message); }
  };

  if (loading) return <View style={{ padding: 40, alignItems: "center" }}><ActivityIndicator color={colors.primary} /></View>;

  const activeList = lists.find((l) => l.id === activeListId);

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

      {/* Search bar */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search items by name or note"
            placeholderTextColor={colors.textLight}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")} style={styles.clearBtn}>
              <AppIcon name="close" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Filters + export row */}
      <View style={[styles.searchRow, { paddingTop: 0, gap: 6, flexWrap: "wrap" }]}>
        <TouchableOpacity onPress={() => setSupplierMenuOpen(true)} style={styles.compactFilter}>
          <Text style={styles.compactFilterLabel}>Supplier</Text>
          <Text style={styles.compactFilterVal} numberOfLines={1}>{supName}</Text>
          <AppIcon name="down" size={12} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setCategoryMenuOpen(true)} style={styles.compactFilter}>
          <Text style={styles.compactFilterLabel}>Category</Text>
          <Text style={styles.compactFilterVal} numberOfLines={1}>{catName}</Text>
          <AppIcon name="down" size={12} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={downloadPdf} style={styles.exportBtn}>
          <Text style={styles.exportBtnText}>PDF</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={downloadCsv} style={[styles.exportBtn, { backgroundColor: "#10B981", borderColor: "#10B981" }]}>
          <Text style={[styles.exportBtnText, { color: "#fff" }]}>CSV</Text>
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
            thumbnail={item.product_id ? productThumbs[item.product_id] || null : null}
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

      {/* Category picker */}
      <Modal visible={categoryMenuOpen} transparent animationType="fade" onRequestClose={() => setCategoryMenuOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setCategoryMenuOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { maxHeight: "60%" }]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Filter by category</Text>
            <ScrollView keyboardShouldPersistTaps="always">
              <TouchableOpacity style={[styles.optRow, !categoryFilter && { backgroundColor: "#DBEAFE" }]} onPress={() => { setCategoryFilter(null); setCategoryMenuOpen(false); }}>
                <Text style={{ color: colors.text, fontWeight: !categoryFilter ? "700" : "500" }}>All categories</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optRow, categoryFilter === "__none__" && { backgroundColor: "#DBEAFE" }]} onPress={() => { setCategoryFilter("__none__"); setCategoryMenuOpen(false); }}>
                <Text style={{ color: colors.textMuted, fontWeight: categoryFilter === "__none__" ? "700" : "500" }}>— Uncategorized —</Text>
              </TouchableOpacity>
              {categories.map((c) => (
                <TouchableOpacity key={c.id} style={[styles.optRow, categoryFilter === c.id && { backgroundColor: "#DBEAFE" }]} onPress={() => { setCategoryFilter(c.id); setCategoryMenuOpen(false); }}>
                  <Text style={{ color: colors.text, fontWeight: categoryFilter === c.id ? "700" : "500" }}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
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

const ShoppingItemRow: React.FC<{
  item: ShoppingItem;
  suppliers: SupplierLite[];
  thumbnail?: string | null;
  onUpdate: (iid: string, patch: Partial<ShoppingItem>) => void;
  onDelete: () => void;
}> = ({ item, suppliers, thumbnail, onUpdate, onDelete }) => {
  // quantities are whole units in this app (forces int even when DB has decimals)
  const initialQty = Math.max(0, Math.round(item.quantity || 0));
  const [qty, setQty] = useState(initialQty ? String(initialQty) : "");
  const [note, setNote] = useState(item.note || "");
  const [supOpen, setSupOpen] = useState(false);
  const [ptOpen, setPtOpen] = useState(false);
  const sup = suppliers.find((s) => s.id === item.supplier_id);
  const pt = (item.purchase_price_type || "regular") as "regular" | "deal" | "both";
  const ptLabel = pt === "deal" ? "Deal" : pt === "both" ? "Both" : "Regular";
  const ptColor = pt === "deal" ? "#FEF3C7" : pt === "both" ? "#DBEAFE" : colors.surface;

  useEffect(() => {
    const n = Math.max(0, Math.round(item.quantity || 0));
    setQty(n ? String(n) : "");
    setNote(item.note || "");
  }, [item.quantity, item.note]);

  const thumbUri = thumbnail ? (thumbnail.startsWith("data:") ? thumbnail : `data:image/jpeg;base64,${thumbnail}`) : null;

  return (
    <View style={styles.shopRowCard}>
      <View style={styles.shopRowHeader}>
        <View style={styles.shopThumbBox}>
          {thumbUri ? (
            <Image source={{ uri: thumbUri }} style={styles.shopThumbImg} />
          ) : (
            <Text style={styles.shopThumbInit}>{((item.product_name || item.text || "?")[0] || "?").toUpperCase()}</Text>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.productName} numberOfLines={2}>{item.product_name || item.text}</Text>
        </View>
        <TouchableOpacity onPress={onDelete} style={styles.trashBtn}>
          <AppIcon name="trash" size={16} color={colors.danger} />
        </TouchableOpacity>
      </View>

      {/* Row 1: Qty + Supplier */}
      <View style={styles.shopFieldRow}>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Qty</Text>
          <TextInput
            style={styles.smallInput}
            keyboardType="number-pad"
            value={qty}
            onChangeText={(v) => setQty(v.replace(/[^0-9]/g, ""))}
            onBlur={() => { const n = parseInt(qty || "0", 10) || 0; if (n !== item.quantity) onUpdate(item.id, { quantity: n }); }}
          />
        </View>
        <View style={[styles.fieldGroup, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>Supplier</Text>
          <TouchableOpacity activeOpacity={0.7} style={styles.dropdownBtn} onPress={() => setSupOpen(true)}>
            <Text style={styles.dropdownText} numberOfLines={1}>{sup?.name || "— Select —"}</Text>
            <AppIcon name="down" size={12} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Row 2: Price type + Price */}
      <View style={styles.shopFieldRow}>
        <View style={[styles.fieldGroup, { flex: 1 }]}>
          <Text style={styles.fieldLabel}>Purchase Price Type</Text>
          <TouchableOpacity activeOpacity={0.7} style={[styles.dropdownBtn, { backgroundColor: ptColor }]} onPress={() => setPtOpen(true)}>
            <Text style={styles.dropdownText}>{ptLabel}</Text>
            <AppIcon name="down" size={12} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>Price</Text>
          <PriceInput
            value={item.purchase_price ?? null}
            onChangeNumber={() => { /* defer commit to onBlur */ }}
            onCommit={(n) => { if (n !== (item.purchase_price ?? 0)) onUpdate(item.id, { purchase_price: (n || null) as any }); }}
            style={{ minWidth: 90 }}
            inputStyle={{ width: 70 }}
          />
        </View>
      </View>

      {/* Row 3: Notes */}
      <View style={styles.fieldGroup}>
        <Text style={styles.fieldLabel}>Notes</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Add a note (deal terms, brand pref, etc.)"
          placeholderTextColor={colors.textLight}
          value={note}
          onChangeText={setNote}
          onBlur={() => { if (note !== item.note) onUpdate(item.id, { note }); }}
          multiline
        />
      </View>

      {/* Supplier picker modal */}
      <Modal visible={supOpen} transparent animationType="fade" onRequestClose={() => setSupOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setSupOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { maxHeight: "60%" }]} onPress={() => { /* swallow */ }}>
            <Text style={styles.modalTitle}>Choose supplier</Text>
            <ScrollView keyboardShouldPersistTaps="always">
              <TouchableOpacity style={styles.optRow} onPress={() => { onUpdate(item.id, { supplier_id: null as any }); setSupOpen(false); }}>
                <Text style={{ color: colors.textMuted }}>— None —</Text>
              </TouchableOpacity>
              {suppliers.map((s) => (
                <TouchableOpacity key={s.id} style={[styles.optRow, item.supplier_id === s.id && { backgroundColor: "#DBEAFE" }]} onPress={() => { onUpdate(item.id, { supplier_id: s.id }); setSupOpen(false); }}>
                  <Text style={{ color: colors.text, fontWeight: item.supplier_id === s.id ? "700" : "500" }}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Purchase price type picker */}
      <Modal visible={ptOpen} transparent animationType="fade" onRequestClose={() => setPtOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setPtOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { maxHeight: "50%" }]} onPress={() => { /* swallow */ }}>
            <Text style={styles.modalTitle}>Purchase price type</Text>
            {(["regular", "deal", "both"] as const).map((opt) => (
              <TouchableOpacity
                key={opt}
                style={[styles.optRow, pt === opt && { backgroundColor: "#DBEAFE" }]}
                onPress={() => { onUpdate(item.id, { purchase_price_type: opt }); setPtOpen(false); }}
              >
                <Text style={{ color: colors.text, fontWeight: pt === opt ? "700" : "500" }}>
                  {opt === "deal" ? "Deal price" : opt === "both" ? "Both (regular + deal)" : "Regular price"}
                </Text>
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
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
// Inline supplier picker used in shopping rows (tappable button + modal)
const SupplierPickerInline: React.FC<{
  suppliers: SupplierLite[];
  value: string | null;
  onChange: (sid: string | null) => void;
}> = ({ suppliers, value, onChange }) => {
  const [open, setOpen] = useState(false);
  const sup = suppliers.find((s) => s.id === value);
  return (
    <>
      <TouchableOpacity activeOpacity={0.7} style={styles.dropdownBtn} onPress={() => setOpen(true)}>
        <Text style={styles.dropdownText} numberOfLines={1}>{sup?.name || "— Select —"}</Text>
        <AppIcon name="down" size={12} color={colors.textMuted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { maxHeight: "60%" }]} onPress={() => {}}>
            <Text style={styles.modalTitle}>Choose supplier</Text>
            <ScrollView keyboardShouldPersistTaps="always">
              <TouchableOpacity style={styles.optRow} onPress={() => { onChange(null); setOpen(false); }}>
                <Text style={{ color: colors.textMuted }}>— None —</Text>
              </TouchableOpacity>
              {suppliers.map((s) => (
                <TouchableOpacity key={s.id} style={[styles.optRow, value === s.id && { backgroundColor: "#DBEAFE" }]} onPress={() => { onChange(s.id); setOpen(false); }}>
                  <Text style={{ color: colors.text, fontWeight: value === s.id ? "700" : "500" }}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
};

// ------------- Shopping (purchase execution) tab -------------
type DraftShoppedItem = {
  selected: boolean;
  qty: number;
  price: number;
  ppt: "regular" | "deal" | "both";
  supplier_id: string | null;
  note: string;
};

const ShoppingTab: React.FC<{ apiStore: any; isAdmin: boolean; storeName: string }> = ({ apiStore, isAdmin, storeName }) => {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [lists, setLists] = useState<ShoppingList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([]);
  const [productThumbs, setProductThumbs] = useState<Record<string, string | null>>({});
  const [productTaxPct, setProductTaxPct] = useState<Record<string, number>>({});
  const [productCategoryId, setProductCategoryId] = useState<Record<string, string | null>>({});
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [supplierMenuOpen, setSupplierMenuOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, DraftShoppedItem>>({});
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ls, sup, plist, cats] = await Promise.all([
        apiStore<ShoppingList[]>("/api/inventory/shopping-lists"),
        apiStore<SupplierLite[]>("/api/inventory/suppliers"),
        apiStore<ProductListItem[]>("/api/inventory/products?limit=500"),
        apiStore<{ id: string; name: string }[]>("/api/inventory/categories"),
      ]);
      setLists(ls); setSuppliers(sup); setCategories(cats);
      const thumbs: Record<string, string | null> = {};
      const taxes: Record<string, number> = {};
      const catMap: Record<string, string | null> = {};
      plist.forEach((p: any) => {
        thumbs[p.id] = p.thumbnail || null;
        taxes[p.id] = Number(p.tax_pct || 0);
        catMap[p.id] = p.category_id || null;
      });
      setProductThumbs(thumbs); setProductTaxPct(taxes); setProductCategoryId(catMap);
      if (!activeListId && ls.length > 0) setActiveListId(ls[0].id);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [apiStore, activeListId]);

  const loadItems = useCallback(async () => {
    if (!activeListId) return;
    try {
      const its = await apiStore<ShoppingItem[]>(`/api/inventory/shopping-list?list_id=${activeListId}`);
      setItems(its);
      setDrafts((prev) => {
        const next: Record<string, DraftShoppedItem> = {};
        for (const it of its) {
          next[it.id] = prev[it.id] || {
            selected: false,
            qty: Math.max(0, Math.round(it.quantity || 0)),
            price: Number(it.purchase_price || 0),
            ppt: (it.purchase_price_type || "regular") as any,
            supplier_id: it.supplier_id || null,
            note: it.note || "",
          };
        }
        return next;
      });
    } catch (e: any) { Alert.alert("Error", e.message); }
  }, [apiStore, activeListId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { loadItems(); }, [loadItems]);

  const filtered = useMemo(() => {
    let arr = items;
    if (supplierFilter) arr = arr.filter((i) => (i.supplier_id || null) === supplierFilter);
    if (categoryFilter) {
      if (categoryFilter === "__none__") arr = arr.filter((i) => !i.product_id || !productCategoryId[i.product_id]);
      else arr = arr.filter((i) => i.product_id && productCategoryId[i.product_id] === categoryFilter);
    }
    const q = query.trim().toLowerCase();
    if (q) {
      arr = arr.filter((i) => {
        const name = (i.product_name || i.text || "").toLowerCase();
        const note = (i.note || "").toLowerCase();
        return name.includes(q) || note.includes(q);
      });
    }
    return arr;
  }, [items, supplierFilter, categoryFilter, query, productCategoryId]);

  const supplierFilterLabel = !supplierFilter ? "All" : (suppliers.find((s) => s.id === supplierFilter)?.name || "Supplier");
  const categoryFilterLabel = !categoryFilter ? "All" : (categoryFilter === "__none__" ? "Uncategorized" : (categories.find((c) => c.id === categoryFilter)?.name || "Category"));
  const selectedIds = Object.entries(drafts).filter(([_, d]) => d.selected).map(([id]) => id);
  const visibleSelected = filtered.filter((it) => drafts[it.id]?.selected);

  const summary = useMemo(() => {
    let count = 0; let subtotal = 0; let tax = 0;
    for (const it of visibleSelected) {
      const d = drafts[it.id]; if (!d) continue;
      const line = d.qty * d.price;
      const taxPct = it.product_id ? (productTaxPct[it.product_id] || 0) : 0;
      count += 1;
      subtotal += line;
      tax += line * taxPct / 100;
    }
    return { count, subtotal, tax, total: subtotal + tax };
  }, [visibleSelected, drafts, productTaxPct]);

  const toggleAllVisible = (on: boolean) => {
    setDrafts((d) => {
      const c = { ...d };
      for (const it of filtered) { if (c[it.id]) c[it.id] = { ...c[it.id], selected: on }; }
      return c;
    });
  };
  const updateDraft = (iid: string, patch: Partial<DraftShoppedItem>) => {
    setDrafts((d) => ({ ...d, [iid]: { ...d[iid], ...patch } }));
  };

  const submitShopping = () => {
    if (selectedIds.length === 0) {
      Alert.alert("Nothing selected", "Select at least one item to mark as Shopped.");
      return;
    }
    const payload = {
      list_id: activeListId,
      items: selectedIds.map((iid) => {
        const d = drafts[iid];
        return {
          item_id: iid,
          quantity: Math.max(0, Math.round(d.qty)),
          purchase_price: d.price || 0,
          purchase_price_type: d.ppt,
          supplier_id: d.supplier_id,
          note: d.note || "",
        };
      }),
    };
    Alert.alert(
      "Confirm Shopping",
      `Move ${selectedIds.length} item(s) to Shopped history?`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Submit", style: "default",
          onPress: async () => {
            try {
              setBusy(true);
              const res: any = await apiStore("/api/inventory/shopping/execute", { method: "POST", body: JSON.stringify(payload) });
              Alert.alert("Shopped", `${res.count} item(s) saved. Total: $${(res.total_amount || 0).toFixed(2)}`);
              setDrafts({});
              await loadItems();
            } catch (e: any) {
              Alert.alert("Error", e.message || "Failed to submit");
            } finally { setBusy(false); }
          },
        },
      ]
    );
  };

  if (loading) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator color={colors.primary} /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.shopHeaderBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }}>
          {lists.map((l) => (
            <TouchableOpacity key={l.id} style={[styles.listChip, activeListId === l.id && styles.listChipActive]} onPress={() => setActiveListId(l.id)}>
              <Text style={[styles.listChipText, activeListId === l.id && styles.listChipTextActive]}>{l.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.historyBtn} onPress={() => router.push("/inventory/shopped" as any)}>
          <AppIcon name="clock" size={14} color={colors.primary} />
          <Text style={styles.historyBtnText}>History</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.filterBar, { paddingBottom: 8, flexDirection: "column", alignItems: "stretch", gap: 8 }]}>
        <View style={styles.searchBox}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search items by name or note"
            placeholderTextColor={colors.textLight}
            style={styles.searchInput}
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")} style={styles.clearBtn}>
              <AppIcon name="close" size={14} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
          <TouchableOpacity onPress={() => setSupplierMenuOpen(true)} style={styles.compactFilter}>
            <Text style={styles.compactFilterLabel}>Supplier</Text>
            <Text style={styles.compactFilterVal} numberOfLines={1}>{supplierFilterLabel}</Text>
            <AppIcon name="down" size={12} color={colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setCategoryMenuOpen(true)} style={styles.compactFilter}>
            <Text style={styles.compactFilterLabel}>Category</Text>
            <Text style={styles.compactFilterVal} numberOfLines={1}>{categoryFilterLabel}</Text>
            <AppIcon name="down" size={12} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
        <View style={{ flexDirection: "row", gap: 6, justifyContent: "flex-end" }}>
          <TouchableOpacity style={styles.linkBtn} onPress={() => toggleAllVisible(true)}>
            <Text style={styles.linkBtnText}>Select all</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.linkBtn} onPress={() => toggleAllVisible(false)}>
            <Text style={styles.linkBtnText}>Clear</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 200, gap: spacing.sm }}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <View style={{ alignItems: "center", paddingVertical: 40 }}>
            <AppIcon name="cart" size={32} color={colors.textLight} />
            <Text style={{ color: colors.textMuted, marginTop: 8 }}>No items in this list</Text>
          </View>
        }
        renderItem={({ item }) => {
          const d = drafts[item.id];
          if (!d) return null;
          const taxPct = item.product_id ? (productTaxPct[item.product_id] || 0) : 0;
          const lineTotal = d.qty * d.price;
          const lineTax = lineTotal * taxPct / 100;
          const lineTotalWithTax = lineTotal + lineTax;
          const sup = suppliers.find((s) => s.id === d.supplier_id);
          const thumbUri = item.product_id && productThumbs[item.product_id]
            ? (productThumbs[item.product_id]!.startsWith("data:")
              ? productThumbs[item.product_id]!
              : `data:image/jpeg;base64,${productThumbs[item.product_id]}`)
            : null;
          return (
            <View style={[styles.shopRowCard, d.selected && styles.shopRowCardSelected]}>
              <View style={styles.shopRowHeader}>
                <TouchableOpacity onPress={() => updateDraft(item.id, { selected: !d.selected })} style={styles.checkBox}>
                  <View style={[styles.checkBoxInner, d.selected && styles.checkBoxOn]}>
                    {d.selected && <AppIcon name="check" size={14} color="#fff" />}
                  </View>
                </TouchableOpacity>
                <View style={styles.shopThumbBox}>
                  {thumbUri ? <Image source={{ uri: thumbUri }} style={styles.shopThumbImg} /> : (
                    <Text style={styles.shopThumbInit}>{((item.product_name || item.text || "?")[0] || "?").toUpperCase()}</Text>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.productName} numberOfLines={2}>{item.product_name || item.text}</Text>
                  {taxPct > 0 && <Text style={styles.taxLabel}>Tax: {taxPct}%</Text>}
                </View>
              </View>

              <View style={styles.shopFieldRow}>
                <View style={styles.fieldGroup}>
                  <Text style={styles.fieldLabel}>Qty</Text>
                  <TextInput
                    style={styles.smallInput}
                    keyboardType="number-pad"
                    value={d.qty ? String(d.qty) : ""}
                    onChangeText={(v) => updateDraft(item.id, { qty: parseInt(v.replace(/[^0-9]/g, "") || "0", 10) || 0 })}
                  />
                </View>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Price</Text>
                  <PriceInput
                    value={d.price}
                    onChangeNumber={(n) => updateDraft(item.id, { price: n })}
                    inputStyle={{ width: undefined, flex: 1 }}
                  />
                </View>
              </View>

              <View style={styles.shopFieldRow}>
                <View style={[styles.fieldGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Supplier</Text>
                  <SupplierPickerInline
                    suppliers={suppliers}
                    value={d.supplier_id}
                    onChange={(sid) => updateDraft(item.id, { supplier_id: sid })}
                  />
                </View>
                <View style={styles.totalsBox}>
                  <Text style={styles.lineTotalLabel}>Line total</Text>
                  <Text style={styles.lineTotalVal}>${lineTotalWithTax.toFixed(2)}</Text>
                  {taxPct > 0 && <Text style={styles.lineTaxNote}>incl ${lineTax.toFixed(2)} tax</Text>}
                </View>
              </View>
            </View>
          );
        }}
      />

      <Modal visible={supplierMenuOpen} transparent animationType="fade" onRequestClose={() => setSupplierMenuOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setSupplierMenuOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { maxHeight: "60%" }]} onPress={() => { /* swallow */ }}>
            <Text style={styles.modalTitle}>Filter by supplier</Text>
            <ScrollView keyboardShouldPersistTaps="always">
              <TouchableOpacity style={[styles.optRow, !supplierFilter && { backgroundColor: "#DBEAFE" }]} onPress={() => { setSupplierFilter(null); setSupplierMenuOpen(false); }}>
                <Text style={{ color: colors.text, fontWeight: !supplierFilter ? "700" : "500" }}>All suppliers</Text>
              </TouchableOpacity>
              {suppliers.map((s) => (
                <TouchableOpacity key={s.id} style={[styles.optRow, supplierFilter === s.id && { backgroundColor: "#DBEAFE" }]} onPress={() => { setSupplierFilter(s.id); setSupplierMenuOpen(false); }}>
                  <Text style={{ color: colors.text, fontWeight: supplierFilter === s.id ? "700" : "500" }}>{s.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <Modal visible={categoryMenuOpen} transparent animationType="fade" onRequestClose={() => setCategoryMenuOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setCategoryMenuOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { maxHeight: "60%" }]} onPress={() => { /* swallow */ }}>
            <Text style={styles.modalTitle}>Filter by category</Text>
            <ScrollView keyboardShouldPersistTaps="always">
              <TouchableOpacity style={[styles.optRow, !categoryFilter && { backgroundColor: "#DBEAFE" }]} onPress={() => { setCategoryFilter(null); setCategoryMenuOpen(false); }}>
                <Text style={{ color: colors.text, fontWeight: !categoryFilter ? "700" : "500" }}>All categories</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.optRow, categoryFilter === "__none__" && { backgroundColor: "#DBEAFE" }]} onPress={() => { setCategoryFilter("__none__"); setCategoryMenuOpen(false); }}>
                <Text style={{ color: colors.textMuted, fontWeight: categoryFilter === "__none__" ? "700" : "500" }}>— Uncategorized —</Text>
              </TouchableOpacity>
              {categories.map((c) => (
                <TouchableOpacity key={c.id} style={[styles.optRow, categoryFilter === c.id && { backgroundColor: "#DBEAFE" }]} onPress={() => { setCategoryFilter(c.id); setCategoryMenuOpen(false); }}>
                  <Text style={{ color: colors.text, fontWeight: categoryFilter === c.id ? "700" : "500" }}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {summary.count > 0 && (
        <View style={[styles.submitBar, { paddingBottom: Math.max(spacing.md, insets.bottom) }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.submitBarSummary}>{summary.count} item{summary.count > 1 ? "s" : ""} · Subtotal ${summary.subtotal.toFixed(2)}</Text>
            <Text style={styles.submitBarTotal}>Total ${summary.total.toFixed(2)}{summary.tax > 0 ? `  (incl $${summary.tax.toFixed(2)} tax)` : ""}</Text>
          </View>
          <TouchableOpacity disabled={busy} onPress={submitShopping} style={[styles.submitGo, busy && { opacity: 0.5 }]}>
            <AppIcon name="check" size={16} color="#fff" />
            <Text style={styles.submitGoText}>Submit</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};



const InventoryTab: React.FC<{ apiStore: any; isAdmin: boolean; scanned?: string }> = ({ apiStore, isAdmin, scanned }) => {
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<StockRow[]>([]);
  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [purchaseTypes, setPurchaseTypes] = useState<{ id: string; name: string }[]>([]);
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [ptFilter, setPtFilter] = useState<string | null>(null);
  const [catMenuOpen, setCatMenuOpen] = useState(false);
  const [ptMenuOpen, setPtMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const handledScanRef = React.useRef<string | null>(null);
  // Scan result modal state
  const [scanModal, setScanModal] = useState<null | { product: ProductListItem; qty: string; notFoundCode?: string }>(null);
  const [scanLookupBusy, setScanLookupBusy] = useState(false);
  const [scanSaving, setScanSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [stock, plist, cats, pts] = await Promise.all([
        apiStore<StockRow[]>("/api/inventory/stock"),
        apiStore<ProductListItem[]>("/api/inventory/products?limit=500"),
        apiStore<{ id: string; name: string }[]>("/api/inventory/categories"),
        apiStore<{ id: string; name: string }[]>("/api/inventory/purchase-types"),
      ]);
      setRows(stock);
      setProducts(plist);
      setCategories(cats);
      setPurchaseTypes(pts);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [apiStore]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // When returning from scanner with a barcode, fetch product details and open a
  // confirmation modal. Tolerant lookup: try exact, then strip leading zero, then
  // text-search as fallback. Never silently increments.
  useEffect(() => {
    if (!scanned || handledScanRef.current === scanned) return;
    handledScanRef.current = scanned;
    (async () => {
      try {
        setScanLookupBusy(true);
        const raw = String(scanned).trim();
        const variants = [raw];
        if (/^0\d+$/.test(raw)) variants.push(raw.replace(/^0+/, ""));
        if (raw.length >= 6 && /^\d+$/.test(raw)) variants.push("0" + raw);

        let found: ProductListItem | null = null;
        for (const v of variants) {
          const list = await apiStore<ProductListItem[]>(`/api/inventory/products?barcode=${encodeURIComponent(v)}`);
          if (list.length === 1) { found = list[0]; break; }
        }
        if (!found && /^\d{4,}$/.test(raw)) {
          // try fuzzy text search by barcode digits as last resort
          const list = await apiStore<ProductListItem[]>(`/api/inventory/products?q=${encodeURIComponent(raw)}&limit=2`);
          if (list.length === 1) found = list[0];
        }
        if (!found) {
          setScanModal({ product: null as any, qty: "1", notFoundCode: raw });
          return;
        }
        const existing = rows.find((r) => r.product_id === found!.id);
        setScanModal({ product: found, qty: String(Math.max(0, Math.round((existing?.quantity || 0) + 1))) });
      } catch (e: any) { Alert.alert("Error", e.message); }
      finally { setScanLookupBusy(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanned]);

  const saveScannedQty = async () => {
    if (!scanModal?.product) return;
    const q = Math.max(0, parseInt(scanModal.qty || "0", 10) || 0);
    try {
      setScanSaving(true);
      await apiStore("/api/inventory/stock/set", {
        method: "POST",
        body: JSON.stringify({ product_id: scanModal.product.id, quantity: q }),
      });
      setScanModal(null);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e.message || "Failed to save");
    } finally { setScanSaving(false); }
  };

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
    return products.filter((p: any) => {
      if (catFilter && p.category_id !== catFilter) return false;
      if (ptFilter) {
        const ids: string[] = p.purchase_type_ids || [];
        if (!ids.includes(ptFilter)) return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.company || "").toLowerCase().includes(q) ||
        (p.barcode || "").toLowerCase().includes(q)
      );
    });
  }, [products, query, catFilter, ptFilter]);

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
          const qty = Math.max(0, Math.round(countByPid[item.id] || 0));
          const draftVal = drafts[item.id] !== undefined ? drafts[item.id] : (qty ? String(qty) : "0");
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
                  keyboardType="number-pad"
                  selectTextOnFocus
                  onChangeText={(v) => {
                    // integer qty only — strip everything that isn't a digit
                    setDrafts((d) => ({ ...d, [item.id]: v.replace(/[^0-9]/g, "") }));
                  }}
                  onBlur={() => {
                    const txt = drafts[item.id];
                    if (txt === undefined) return; // nothing changed
                    const n = parseInt(txt || "0", 10) || 0;
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

      {/* Scan-result modal (Inventory Count flow) */}
      <Modal visible={scanLookupBusy || !!scanModal} transparent animationType="fade" onRequestClose={() => setScanModal(null)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => !scanSaving && setScanModal(null)}>
          <TouchableOpacity activeOpacity={1} style={[styles.modalBox, { maxWidth: 460 }]} onPress={() => { /* swallow */ }}>
            {scanLookupBusy ? (
              <View style={{ alignItems: "center", paddingVertical: 30 }}>
                <ActivityIndicator color={colors.primary} />
                <Text style={{ color: colors.textMuted, marginTop: 8 }}>Looking up product…</Text>
              </View>
            ) : scanModal?.notFoundCode ? (
              <>
                <Text style={styles.modalTitle}>Product not found</Text>
                <Text style={{ color: colors.textMuted, marginBottom: 16 }}>
                  No product matches barcode <Text style={{ fontWeight: "700", color: colors.text }}>{scanModal.notFoundCode}</Text>.
                </Text>
                <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end" }}>
                  <TouchableOpacity onPress={() => setScanModal(null)} style={styles.modalCancelBtn}>
                    <Text style={{ color: colors.textMuted, fontWeight: "700" }}>Close</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => {
                      const code = scanModal.notFoundCode;
                      setScanModal(null);
                      router.push({ pathname: "/(app)/inventory/product/new" as any, params: { barcode: code } });
                    }}
                    style={styles.modalPrimaryBtn}
                  >
                    <Text style={{ color: "#fff", fontWeight: "700" }}>Create product</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : scanModal?.product ? (
              <>
                <Text style={styles.modalTitle}>Inventory count</Text>
                <View style={styles.scanCard}>
                  <View style={styles.scanThumb}>
                    {scanModal.product.thumbnail ? (
                      <Image
                        source={{ uri: scanModal.product.thumbnail.startsWith("data:") ? scanModal.product.thumbnail : `data:image/jpeg;base64,${scanModal.product.thumbnail}` }}
                        style={{ width: "100%", height: "100%" }}
                      />
                    ) : (
                      <Text style={styles.scanThumbInit}>{(scanModal.product.name?.[0] || "?").toUpperCase()}</Text>
                    )}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.scanName} numberOfLines={2}>{scanModal.product.name}</Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                      {!!scanModal.product.size && <Text style={styles.scanMeta}>📦 {scanModal.product.size}</Text>}
                      {!!scanModal.product.company && <Text style={styles.scanMeta}>🏭 {scanModal.product.company}</Text>}
                      {!!scanModal.product.category_id && <Text style={styles.scanMeta}>🏷 {categories.find((c) => c.id === scanModal.product.category_id)?.name || ""}</Text>}
                      {scanModal.product.selling_price != null && <Text style={styles.scanMeta}>💰 ${Number(scanModal.product.selling_price).toFixed(2)}</Text>}
                    </View>
                    <Text style={styles.scanBarcode} numberOfLines={1}>Barcode: {scanModal.product.barcode || "—"}</Text>
                  </View>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 16 }}>
                  <Text style={[styles.fieldLabel, { fontSize: 13 }]}>NEW COUNT</Text>
                  <TouchableOpacity
                    onPress={() => setScanModal(m => m ? { ...m, qty: String(Math.max(0, (parseInt(m.qty || "0", 10) || 0) - 1)) } : m)}
                    style={styles.qtyStep}
                  >
                    <Text style={styles.qtyStepText}>−</Text>
                  </TouchableOpacity>
                  <TextInput
                    style={[styles.smallInput, { width: 90, fontSize: 18 }]}
                    keyboardType="number-pad"
                    value={scanModal.qty}
                    onChangeText={(v) => setScanModal(m => m ? { ...m, qty: v.replace(/[^0-9]/g, "") } : m)}
                  />
                  <TouchableOpacity
                    onPress={() => setScanModal(m => m ? { ...m, qty: String((parseInt(m.qty || "0", 10) || 0) + 1) } : m)}
                    style={styles.qtyStep}
                  >
                    <Text style={styles.qtyStepText}>+</Text>
                  </TouchableOpacity>
                </View>
                <View style={{ flexDirection: "row", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
                  <TouchableOpacity onPress={() => setScanModal(null)} disabled={scanSaving} style={styles.modalCancelBtn}>
                    <Text style={{ color: colors.textMuted, fontWeight: "700" }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={saveScannedQty} disabled={scanSaving} style={[styles.modalPrimaryBtn, scanSaving && { opacity: 0.5 }]}>
                    {scanSaving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Save count</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
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

  tabBarWrap: { flexGrow: 0, backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 56 },
  tabBar: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingVertical: spacing.sm, alignItems: "center" },
  tabBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    minHeight: 40, justifyContent: "center",
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

  // Shopping List row
  shopRowCard: {
    padding: spacing.sm, backgroundColor: colors.card, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, gap: 8,
  },
  shopRowHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  shopThumbBox: {
    width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.surface,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
    borderWidth: 1, borderColor: colors.border,
  },
  shopThumbImg: { width: "100%", height: "100%" },
  shopThumbInit: { fontSize: 18, fontWeight: "700", color: colors.textMuted },
  trashBtn: { padding: 8 },
  shopFieldRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  fieldGroup: { gap: 4 },
  fieldLabel: { fontSize: 11, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5 },
  smallInput: {
    width: 64, paddingVertical: 8, paddingHorizontal: 8, textAlign: "center",
    fontWeight: "700", fontSize: 15, color: colors.text,
    backgroundColor: colors.surface, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  dropdownBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: 9, paddingHorizontal: 10, gap: 6,
    backgroundColor: colors.surface, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, minHeight: 38,
  },
  dropdownText: { color: colors.text, fontWeight: "600", fontSize: 13, flex: 1 },
  priceWrap: {
    flexDirection: "row", alignItems: "center", paddingHorizontal: 8,
    backgroundColor: colors.surface, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  priceDollar: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  priceInput: {
    width: 70, paddingVertical: 8, paddingLeft: 4, fontSize: 14,
    color: colors.text, fontWeight: "700", textAlign: "right",
  },
  notesInput: {
    minHeight: 40, paddingVertical: 8, paddingHorizontal: 10, fontSize: 13,
    color: colors.text, backgroundColor: colors.surface, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.border, textAlignVertical: "top",
  },

  // Shopping tab (execute)
  shopHeaderBar: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.border },
  historyBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  historyBtnText: { color: colors.primary, fontWeight: "700", fontSize: 13 },
  shopRowCardSelected: { borderColor: colors.primary, backgroundColor: "#EFF6FF" },
  checkBox: { padding: 4 },
  checkBoxInner: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.surface,
  },
  checkBoxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  taxLabel: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  dimmedRow: { paddingVertical: 9, paddingHorizontal: 10, color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  totalsBox: { alignItems: "flex-end" },
  lineTotalLabel: { fontSize: 11, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase" },
  lineTotalVal: { fontSize: 17, fontWeight: "800", color: colors.text },
  lineTaxNote: { fontSize: 10, color: colors.textMuted },
  submitBar: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.md,
    backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.border,
  },
  submitBarSummary: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  submitBarTotal: { color: colors.text, fontSize: 17, fontWeight: "800" },
  submitGo: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: colors.primary, paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.md,
  },
  submitGoText: { color: "#fff", fontWeight: "800", fontSize: 14 },
  compactFilter: {
    flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 8,
    backgroundColor: colors.card, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border,
    flex: 1, minWidth: 130,
  },
  compactFilterLabel: { fontSize: 10, color: colors.textMuted, fontWeight: "700", textTransform: "uppercase" },
  compactFilterVal: { flex: 1, color: colors.text, fontWeight: "700", fontSize: 13 },
  exportBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primary,
  },
  exportBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  // Scan-result modal
  modalCancelBtn: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border },
  modalPrimaryBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm, backgroundColor: colors.primary },
  scanCard: {
    flexDirection: "row", gap: 12, padding: 12, marginTop: 8,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  scanThumb: {
    width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.card,
    alignItems: "center", justifyContent: "center", overflow: "hidden",
    borderWidth: 1, borderColor: colors.border,
  },
  scanThumbInit: { fontSize: 28, fontWeight: "800", color: colors.textMuted },
  scanName: { color: colors.text, fontWeight: "700", fontSize: 15 },
  scanMeta: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  scanBarcode: { color: colors.textLight, fontSize: 11, marginTop: 4, fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) },
  qtyStep: {
    width: 40, height: 40, borderRadius: 8, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  qtyStepText: { fontSize: 22, fontWeight: "800", color: colors.text, lineHeight: 24 },
});
