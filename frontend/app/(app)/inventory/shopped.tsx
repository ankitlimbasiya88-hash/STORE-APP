import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator, Alert, Modal, ScrollView, Platform,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { AppIcon } from "@/src/components/AppIcon";
import { Supplier } from "@/src/utils/inventory";
import { buildShoppedHtml, generateAndShare } from "@/src/utils/pdf";

type ShoppedRecord = {
  id: string;
  store_id: string;
  batch_id: string;
  list_id?: string | null;
  list_name?: string | null;
  supplier_id?: string | null;
  supplier_name?: string | null;
  product_id?: string | null;
  product_name?: string | null;
  text: string;
  quantity: number;
  purchase_price_type: "regular" | "deal" | "both";
  purchase_price: number;
  tax_pct: number;
  line_total: number;
  tax_amount: number;
  total_with_tax: number;
  note: string;
  shopped_at: string;
  shopped_by: string;
  source_item_id?: string | null;
};

type BatchGroup = {
  key: string;                  // batch_id + supplier_id (split per supplier within a batch)
  batch_id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  shopped_at: string;
  shopped_by: string;
  list_name: string | null;
  items: ShoppedRecord[];
  subtotal: number;
  tax: number;
  total: number;
};

const fmtDate = (iso: string): string => {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" } as any);
  } catch { return iso; }
};

export default function ShoppedHistoryScreen() {
  const { apiStore, session, storeName } = useSession();
  const isAdmin = session?.user.role === "admin";
  const insets = useSafeAreaInsets();
  const [records, setRecords] = useState<ShoppedRecord[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [supplierFilter, setSupplierFilter] = useState<string | null>(null);
  const [supplierMenuOpen, setSupplierMenuOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      const [recs, sup] = await Promise.all([
        apiStore<ShoppedRecord[]>("/api/inventory/shopped?days=180"),
        apiStore<Supplier[]>("/api/inventory/suppliers"),
      ]);
      setRecords(recs);
      setSuppliers(sup);
    } catch (e: any) { Alert.alert("Error", e.message); }
    finally { setLoading(false); }
  }, [apiStore]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!supplierFilter) return records;
    return records.filter((r) => (r.supplier_id || null) === supplierFilter);
  }, [records, supplierFilter]);

  // group by batch_id + supplier_id (so a single batch with multiple suppliers shows as separate entries per supplier)
  const groups: BatchGroup[] = useMemo(() => {
    const map = new Map<string, BatchGroup>();
    for (const r of filtered) {
      const key = `${r.batch_id}|${r.supplier_id || "none"}`;
      let g = map.get(key);
      if (!g) {
        g = {
          key, batch_id: r.batch_id,
          supplier_id: r.supplier_id || null,
          supplier_name: r.supplier_name || null,
          shopped_at: r.shopped_at, shopped_by: r.shopped_by,
          list_name: r.list_name || null,
          items: [], subtotal: 0, tax: 0, total: 0,
        };
        map.set(key, g);
      }
      g.items.push(r);
      g.subtotal += r.line_total;
      g.tax += r.tax_amount;
      g.total += r.total_with_tax;
    }
    const list = Array.from(map.values());
    list.sort((a, b) => (a.shopped_at < b.shopped_at ? 1 : -1));
    return list;
  }, [filtered]);

  const supplierFilterLabel = !supplierFilter ? "All suppliers" : (suppliers.find((s) => s.id === supplierFilter)?.name || "Supplier");

  const sharePdf = async (g: BatchGroup) => {
    try {
      const html = buildShoppedHtml({
        storeName: storeName || "Store",
        supplierLabel: g.supplier_name || "No supplier",
        shoppedAt: g.shopped_at,
        shoppedBy: g.shopped_by,
        listName: g.list_name || "",
        items: g.items.map((r) => ({
          name: r.product_name || r.text,
          quantity: r.quantity,
          purchase_price: r.purchase_price,
          purchase_price_type: r.purchase_price_type,
          tax_pct: r.tax_pct,
          tax_amount: r.tax_amount,
          line_total: r.line_total,
          total_with_tax: r.total_with_tax,
          note: r.note,
        })),
        subtotal: g.subtotal,
        tax: g.tax,
        total: g.total,
      });
      await generateAndShare(html, `Shopped_${(g.supplier_name || "batch").replace(/\W+/g, "_")}_${g.shopped_at.slice(0, 10)}.pdf`);
    } catch (e: any) {
      Alert.alert("PDF error", e.message || "Failed to export");
    }
  };

  const deleteBatch = async (g: BatchGroup) => {
    Alert.alert("Delete batch", `Permanently remove ${g.items.length} shopped record(s)?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await apiStore(`/api/inventory/shopped/batch/${g.batch_id}`, { method: "DELETE" });
            await load();
          } catch (e: any) { Alert.alert("Error", e.message); }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="back" size={18} color="#fff" />
          <Text style={styles.backTxt}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Shopped History</Text>
        <View style={{ width: 60 }} />
      </View>

      {/* Filter */}
      <View style={styles.filterBar}>
        <TouchableOpacity style={styles.filterBtn} onPress={() => setSupplierMenuOpen(true)}>
          <AppIcon name="filter" size={12} color={colors.text} />
          <Text style={styles.filterText}>{supplierFilterLabel}</Text>
          <AppIcon name="down" size={10} color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={styles.countText}>{groups.length} batch{groups.length === 1 ? "" : "es"}</Text>
      </View>

      <FlatList
        data={groups}
        keyExtractor={(g) => g.key}
        contentContainerStyle={{ padding: spacing.md, gap: spacing.sm, paddingBottom: Math.max(spacing.lg, insets.bottom + 16) }}
        ListEmptyComponent={
          <View style={{ alignItems: "center", paddingVertical: 60 }}>
            <AppIcon name="clock" size={36} color={colors.textLight} />
            <Text style={{ color: colors.textMuted, marginTop: 8 }}>No shopped batches yet</Text>
            <Text style={{ color: colors.textLight, fontSize: 12, marginTop: 4, textAlign: "center" }}>
              Items you submit from the Shopping tab will appear here.
            </Text>
          </View>
        }
        renderItem={({ item: g }) => {
          const isOpen = !!expanded[g.key];
          return (
            <View style={styles.batchCard}>
              <TouchableOpacity activeOpacity={0.8} onPress={() => setExpanded((e) => ({ ...e, [g.key]: !isOpen }))}>
                <View style={styles.batchHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.batchSupplier} numberOfLines={1}>{g.supplier_name || "No supplier"}</Text>
                    <Text style={styles.batchSub} numberOfLines={1}>
                      {fmtDate(g.shopped_at)} · {g.items.length} item{g.items.length > 1 ? "s" : ""}
                      {g.list_name ? ` · ${g.list_name}` : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={styles.batchTotal}>${g.total.toFixed(2)}</Text>
                    {g.tax > 0 && <Text style={styles.batchTax}>incl ${g.tax.toFixed(2)} tax</Text>}
                  </View>
                  <AppIcon name={isOpen ? "up" : "down"} size={12} color={colors.textMuted} />
                </View>
              </TouchableOpacity>

              {isOpen && (
                <View style={styles.batchBody}>
                  {g.items.map((r) => (
                    <View key={r.id} style={styles.itemRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.itemName} numberOfLines={2}>{r.product_name || r.text}</Text>
                        <Text style={styles.itemMeta}>
                          {r.quantity} × ${r.purchase_price.toFixed(2)}
                          {r.purchase_price_type !== "regular" ? ` · ${r.purchase_price_type}` : ""}
                          {r.tax_pct > 0 ? ` · tax ${r.tax_pct}%` : ""}
                        </Text>
                        {!!r.note && <Text style={styles.itemNote} numberOfLines={2}>📝 {r.note}</Text>}
                      </View>
                      <Text style={styles.itemTotal}>${r.total_with_tax.toFixed(2)}</Text>
                    </View>
                  ))}
                  <View style={styles.batchActions}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => sharePdf(g)}>
                      <AppIcon name="download" size={14} color={colors.primary} />
                      <Text style={styles.actionText}>PDF</Text>
                    </TouchableOpacity>
                    {isAdmin && (
                      <TouchableOpacity style={[styles.actionBtn, { backgroundColor: "#FEE2E2" }]} onPress={() => deleteBatch(g)}>
                        <AppIcon name="trash" size={14} color={colors.danger} />
                        <Text style={[styles.actionText, { color: colors.danger }]}>Delete batch</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              )}
            </View>
          );
        }}
      />

      {/* Supplier filter modal */}
      <Modal visible={supplierMenuOpen} transparent animationType="fade" onRequestClose={() => setSupplierMenuOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setSupplierMenuOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.modalBox} onPress={() => { /* swallow */ }}>
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
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, padding: 6 },
  backTxt: { color: "#fff", fontWeight: "700", fontSize: 14 },
  title: { color: "#fff", fontWeight: "800", fontSize: 17 },

  filterBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    backgroundColor: colors.card, borderBottomWidth: 1, borderColor: colors.border,
  },
  filterBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  filterText: { color: colors.text, fontWeight: "600", fontSize: 12 },
  countText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },

  batchCard: { backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  batchHeader: { flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.md },
  batchSupplier: { color: colors.text, fontWeight: "700", fontSize: 15 },
  batchSub: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  batchTotal: { color: colors.text, fontWeight: "800", fontSize: 16 },
  batchTax: { color: colors.textMuted, fontSize: 11 },

  batchBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md, gap: spacing.sm, borderTopWidth: 1, borderColor: colors.border },
  itemRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingTop: spacing.sm },
  itemName: { color: colors.text, fontWeight: "600", fontSize: 14 },
  itemMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  itemNote: { color: colors.textMuted, fontSize: 12, fontStyle: "italic", marginTop: 2 },
  itemTotal: { color: colors.text, fontWeight: "700", fontSize: 14, minWidth: 70, textAlign: "right" },

  batchActions: { flexDirection: "row", gap: 8, marginTop: spacing.sm },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.sm, backgroundColor: "#EFF6FF" },
  actionText: { color: colors.primary, fontWeight: "700", fontSize: 12 },

  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center", padding: spacing.md },
  modalBox: { backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, width: "100%", maxWidth: 420, maxHeight: "60%" },
  modalTitle: { color: colors.text, fontWeight: "700", fontSize: 15, marginBottom: spacing.sm },
  optRow: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: radius.sm },
});
