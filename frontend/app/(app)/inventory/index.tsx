import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, FlatList,
  ActivityIndicator, RefreshControl, Alert, Image, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
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
        {isAdmin ? (
          <TouchableOpacity testID="manage-btn" onPress={() => router.push("/(app)/inventory/suppliers" as any)} style={styles.iconBtn}>
            <Text style={styles.btnLabel}>Suppliers</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 80 }} />}
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
      {tab === "inventory" && <Placeholder title="Inventory" desc="Stock levels per product. Coming next." />}
      {tab === "shopping-list" && <Placeholder title="Shopping List" desc="Auto-suggested low-stock items + manual additions. Coming next." />}
      {tab === "shopping" && <Placeholder title="Shopping" desc="Admin records purchases that update stock + price history. Coming next." />}
    </SafeAreaView>
  );
}

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
        <View style={{ flexDirection: "row", paddingHorizontal: spacing.md, gap: spacing.sm, marginBottom: spacing.sm }}>
          <TouchableOpacity
            testID="add-product-btn"
            style={styles.addBtn}
            onPress={() => router.push("/(app)/inventory/product/new" as any)}
          >
            <AppIcon name="plus" size={18} color="#fff" />
            <Text style={styles.addBtnText}>Add Product</Text>
          </TouchableOpacity>
          <TouchableOpacity
            testID="taxonomy-btn"
            style={[styles.addBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }]}
            onPress={() => router.push("/(app)/inventory/taxonomy" as any)}
          >
            <Text style={[styles.addBtnText, { color: colors.text }]}>Categories</Text>
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
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, paddingHorizontal: 14, borderRadius: radius.md,
    backgroundColor: colors.primary,
  },
  addBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

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
});
