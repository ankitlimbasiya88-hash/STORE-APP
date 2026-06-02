import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
  Image, Dimensions, Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { AppIcon } from "@/src/components/AppIcon";
import BarcodeView from "@/src/components/BarcodeView";
import { Product, Supplier, Taxonomy, sortPricesAsc, priceStats } from "@/src/utils/inventory";

const { width: screenW } = Dimensions.get("window");
const HERO_W = Math.min(360, screenW - 32);
const CURRENCY = "$";

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { apiStore, session } = useSession();
  const isAdmin = session?.user.role === "admin";

  const [product, setProduct] = useState<Product | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Taxonomy[]>([]);
  const [purchaseTypes, setPurchaseTypes] = useState<Taxonomy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activePic, setActivePic] = useState(0);
  const [addingToList, setAddingToList] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [p, s, c, pt] = await Promise.all([
        apiStore<Product>(`/api/inventory/products/${id}`),
        apiStore<Supplier[]>(`/api/inventory/suppliers`),
        apiStore<Taxonomy[]>(`/api/inventory/categories`),
        apiStore<Taxonomy[]>(`/api/inventory/purchase-types`),
      ]);
      setProduct(p);
      setSuppliers(s);
      setCategories(c);
      setPurchaseTypes(pt);
    } catch (e: any) {
      setError(e?.message || "Could not load product");
    }
    finally { setLoading(false); }
  }, [apiStore, id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <AppIcon name="back" size={20} color="#fff" />
            <Text style={styles.btnLabel}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Product</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !product) {
    const is404 = (error || "").toLowerCase().includes("not found") || (error || "").includes("404");
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <AppIcon name="back" size={20} color="#fff" />
            <Text style={styles.btnLabel}>Back</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Product</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 30 }}>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text, marginBottom: 8 }}>
            {is404 ? "Product not found" : "Couldn't load this product"}
          </Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, textAlign: "center", marginBottom: 20 }}>
            {is404
              ? "This product no longer exists. It may have been deleted or you may have switched stores."
              : (error || "Something went wrong.")}
          </Text>
          <TouchableOpacity onPress={() => router.replace("/(app)/inventory" as any)} style={{ paddingHorizontal: 18, paddingVertical: 10, backgroundColor: colors.primary, borderRadius: radius.md }}>
            <Text style={{ color: "#fff", fontWeight: "700" }}>Back to Inventory</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const category = categories.find((c) => c.id === product.category_id);
  const supplierItems = suppliers.filter((s) => product.preferred_supplier_ids.includes(s.id));
  const ptItems = purchaseTypes.filter((p) => product.purchase_type_ids.includes(p.id));
  const stats = priceStats(product.purchase_prices);
  const sortedPrices = sortPricesAsc(product.purchase_prices);
  const perDay = product.avg_sales?.per_day || 0;

  // Gallery items = product photos + auto-generated barcode (rendered as SVG, not stored)
  const galleryImages = product.images || [];
  const galleryLen = galleryImages.length + (product.barcode ? 1 : 0);

  const addToShoppingList = async () => {
    setAddingToList(true);
    try {
      await apiStore("/api/inventory/shopping-list", {
        method: "POST",
        body: JSON.stringify({ product_id: product.id, quantity: 1 }),
      });
      Alert.alert("Added", `\"${product.name}\" added to shopping list.`);
    } catch (e: any) {
      Alert.alert("Error", e.message);
    } finally { setAddingToList(false); }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <AppIcon name="back" size={20} color="#fff" />
          <Text style={styles.btnLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{product.name}</Text>
        {isAdmin ? (
          <TouchableOpacity
            testID="modify-btn"
            onPress={() => router.push(`/(app)/inventory/product/${product.id}/edit` as any)}
            style={styles.modifyBtn}
          >
            <Text style={styles.modifyBtnText}>Modify</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 60 }} />}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}>
        {/* Hero gallery */}
        <View style={styles.hero}>
          {galleryLen === 0 ? (
            <View style={[styles.heroPlaceholder, { width: HERO_W }]}>
              <Text style={styles.heroPlaceholderText}>{(product.name || "?")[0]}</Text>
            </View>
          ) : activePic < galleryImages.length ? (
            <Image source={{ uri: galleryImages[activePic].startsWith("data:") ? galleryImages[activePic] : `data:image/jpeg;base64,${galleryImages[activePic]}` }} style={{ width: HERO_W, height: HERO_W * 0.75, borderRadius: radius.md, resizeMode: "cover" }} />
          ) : (
            <View style={[styles.barcodeHero, { width: HERO_W }]}>
              <BarcodeView value={product.barcode || ""} width={HERO_W - 40} height={120} showText />
              <Text style={styles.barcodeSub}>Auto-generated scannable barcode</Text>
            </View>
          )}
        </View>

        {/* Thumbnail strip */}
        {galleryLen > 1 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbStrip} contentContainerStyle={{ gap: 8, paddingHorizontal: 4 }}>
            {galleryImages.map((src, i) => (
              <TouchableOpacity key={`img-${i}`} onPress={() => setActivePic(i)} style={[styles.thumb, activePic === i && styles.thumbActive]}>
                <Image source={{ uri: src.startsWith("data:") ? src : `data:image/jpeg;base64,${src}` }} style={{ width: "100%", height: "100%" }} />
              </TouchableOpacity>
            ))}
            {product.barcode && (
              <TouchableOpacity onPress={() => setActivePic(galleryImages.length)} style={[styles.thumb, activePic === galleryImages.length && styles.thumbActive, { backgroundColor: "#fff", alignItems: "center", justifyContent: "center" }]}>
                <BarcodeView value={product.barcode} width={56} height={40} showText={false} />
              </TouchableOpacity>
            )}
          </ScrollView>
        )}

        {/* Title + price */}
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{product.name}</Text>
          {!!product.company && <Text style={styles.subtitle}>{product.company}{product.size ? ` · ${product.size}` : ""}{product.pack_size ? ` · ${product.pack_size}` : ""}</Text>}
          <View style={styles.priceRow}>
            <Text style={styles.price}>{CURRENCY}{product.selling_price.toFixed(2)}</Text>
            {!!product.tax_pct && <Text style={styles.priceMeta}>+{product.tax_pct}% tax</Text>}
            {!!product.ideal_profit_margin && <Text style={styles.priceMeta}>· Target margin {product.ideal_profit_margin}%</Text>}
          </View>
        </View>

        {/* Primary actions */}
        <View style={{ flexDirection: "row", gap: 10 }}>
          <TouchableOpacity testID="add-to-shopping" style={styles.primaryBtn} onPress={addToShoppingList} disabled={addingToList}>
            {addingToList ? <ActivityIndicator color="#fff" /> : (
              <>
                <AppIcon name="plus" size={16} color="#fff" />
                <Text style={styles.primaryBtnText}>Add to Shopping List</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Quick facts */}
        <Section title="Details">
          <Fact label="Category" value={category?.name || "—"} />
          <Fact label="Brand / Company" value={product.company || "—"} />
          <Fact label="Size" value={product.size || "—"} />
          <Fact label="Pack size" value={product.pack_size || "—"} />
          <Fact label="Barcode" value={product.barcode || "—"} mono />
        </Section>

        {/* Suppliers */}
        {supplierItems.length > 0 && (
          <Section title="Preferred Suppliers">
            <View style={styles.chipsWrap}>
              {supplierItems.map((s) => (
                <View key={s.id} style={styles.chip}><Text style={styles.chipText}>{s.name}</Text></View>
              ))}
            </View>
          </Section>
        )}

        {/* Purchase types — always shown so admin sees if it's missing */}
        <Section title="Purchase Types">
          {ptItems.length > 0 ? (
            <View style={styles.chipsWrap}>
              {ptItems.map((t) => (
                <View key={t.id} style={styles.chip}><Text style={styles.chipText}>{t.name}</Text></View>
              ))}
            </View>
          ) : (
            <Text style={styles.subtle}>None selected{isAdmin ? " — tap Modify to add" : ""}</Text>
          )}
          <View style={{ height: 6 }} />
          <Fact
            label="Purchase Price Type"
            value={
              ((product as any).purchase_price_type === "deal") ? "Deal" :
              ((product as any).purchase_price_type === "both") ? "Both (Regular + Deal)" :
              "Regular"
            }
            highlight
          />
        </Section>

        {/* Sales */}
        {(product.avg_sales?.period_days || product.avg_sales?.quantity) ? (
          <Section title="Sales velocity">
            <Fact label="Recorded" value={`${product.avg_sales.quantity} units over ${product.avg_sales.period_days} days`} />
            <Fact label="Per day" value={perDay ? perDay.toFixed(3) : "—"} highlight />
          </Section>
        ) : null}

        {/* Expiry / inventory */}
        {(product.expiry_sensitivity_days || product.min_inventory_days || product.max_inventory_days) ? (
          <Section title="Expiry & Inventory targets">
            <Fact label="Expiry sensitivity" value={product.expiry_sensitivity_days ? `${product.expiry_sensitivity_days} days` : "—"} />
            <Fact label="Min inventory" value={product.min_inventory_days ? `${product.min_inventory_days} days` : "—"} />
            <Fact label="Max inventory" value={product.max_inventory_days ? `${product.max_inventory_days} days` : "—"} />
          </Section>
        ) : null}

        {/* Price history */}
        <Section title="Purchase Price History" subtitle={`${sortedPrices.length} entr${sortedPrices.length === 1 ? "y" : "ies"}, sorted low → high`}>
          {sortedPrices.length === 0 ? (
            <Text style={styles.subtle}>No purchase prices recorded yet.</Text>
          ) : (
            <>
              <View style={styles.statsRow}>
                <Stat label="Lowest" value={`${CURRENCY}${(stats.lowest || 0).toFixed(2)}`} />
                <Stat label="Highest" value={`${CURRENCY}${(stats.highest || 0).toFixed(2)}`} />
                <Stat label="Latest" value={`${CURRENCY}${(stats.latest || 0).toFixed(2)}`} />
              </View>
              {sortedPrices.map((p) => {
                const sup = suppliers.find((s) => s.id === p.supplier_id);
                return (
                  <View key={p.id} style={styles.priceEntry}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.priceEntryVal}>{CURRENCY}{p.price.toFixed(2)}</Text>
                      <Text style={styles.priceEntryMeta}>
                        {p.date}{sup ? ` · ${sup.name}` : ""}{p.note ? ` · ${p.note}` : ""}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {subtitle && <Text style={styles.sectionSub}>{subtitle}</Text>}
    <View style={{ marginTop: 8, gap: 6 }}>{children}</View>
  </View>
);
const Fact: React.FC<{ label: string; value: string; mono?: boolean; highlight?: boolean }> = ({ label, value, mono, highlight }) => (
  <View style={styles.fact}>
    <Text style={styles.factLabel}>{label}</Text>
    <Text style={[styles.factVal, mono && { fontFamily: "monospace" }, highlight && { color: colors.primary, fontWeight: "700" }]}>{value}</Text>
  </View>
);
const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statVal}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)" },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "700", flex: 1, textAlign: "center", marginHorizontal: 8 },
  modifyBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#fff", borderRadius: 18 },
  modifyBtnText: { color: colors.primary, fontWeight: "700", fontSize: 13 },

  hero: { alignItems: "center", marginBottom: spacing.sm },
  heroPlaceholder: { aspectRatio: 4/3, backgroundColor: colors.card, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  heroPlaceholderText: { fontSize: 72, fontWeight: "800", color: colors.textMuted },
  barcodeHero: { backgroundColor: "#fff", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, alignItems: "center" },
  barcodeSub: { fontSize: 11, color: colors.textMuted, marginTop: 8 },

  thumbStrip: { flexGrow: 0, marginBottom: spacing.sm },
  thumb: { width: 56, height: 56, borderRadius: radius.sm, overflow: "hidden", borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  thumbActive: { borderColor: colors.primary, borderWidth: 2 },

  titleBlock: { marginVertical: spacing.sm },
  title: { fontSize: 22, fontWeight: "800", color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  priceRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 8, flexWrap: "wrap" },
  price: { fontSize: 26, fontWeight: "800", color: colors.primary },
  priceMeta: { fontSize: 12, color: colors.textMuted },

  primaryBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 14, backgroundColor: colors.primary, borderRadius: radius.md, marginVertical: spacing.sm },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  section: { backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  sectionSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  fact: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  factLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  factVal: { fontSize: 13, color: colors.text, fontWeight: "500", textAlign: "right", flex: 1, marginLeft: 8 },

  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: "#DBEAFE" },
  chipText: { color: colors.primary, fontWeight: "600", fontSize: 12 },

  statsRow: { flexDirection: "row", gap: 8, marginBottom: 8 },
  stat: { flex: 1, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface, borderRadius: radius.sm },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  statVal: { fontSize: 14, color: colors.text, fontWeight: "700", marginTop: 2 },

  priceEntry: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  priceEntryVal: { fontSize: 15, color: colors.text, fontWeight: "700" },
  priceEntryMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  subtle: { fontSize: 12, color: colors.textMuted, fontStyle: "italic" },
});
