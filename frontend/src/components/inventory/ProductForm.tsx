// Shared Product form. Used by /inventory/product/new and /inventory/product/[id].
// Designed to be functional but pragmatic — captures every field requested by the user
// (pictures, barcode picture, name, size, company, pack_size, category, ideal_profit_margin,
//  selling_price, tax_pct, preferred_suppliers, avg_sales, expiry_sensitivity_days,
//  min/max_inventory_days, purchase_types, purchase_price history, keywords).

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator,
  Alert, Image, KeyboardAvoidingView, Platform, Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";
import { AppIcon } from "@/src/components/AppIcon";
import {
  Product, PurchasePriceEntry, Supplier, Taxonomy, sortPricesAsc, priceStats,
} from "@/src/utils/inventory";

type Props = {
  mode: "new" | "edit";
  initial?: Product | null;
  initialBarcode?: string;
  onSaved: (p: Product) => void;
};

const MAX_IMAGES = 3;
const IMG_QUALITY = 0.6;
const IMG_MAX_DIM = 1024;

const numField = (v: string): number => {
  const n = parseFloat((v || "").replace(/[^0-9.\-]/g, ""));
  return isNaN(n) ? 0 : n;
};

export default function ProductForm({ mode, initial, initialBarcode, onSaved }: Props) {
  const { apiStore, session } = useSession();
  const isAdmin = session?.user.role === "admin";

  // Core fields
  const [name, setName] = useState(initial?.name || "");
  const [barcode, setBarcode] = useState(initial?.barcode || initialBarcode || "");
  const [size, setSize] = useState(initial?.size || "");
  const [company, setCompany] = useState(initial?.company || "");
  const [packSize, setPackSize] = useState(initial?.pack_size || "");
  const [categoryId, setCategoryId] = useState<string | null>(initial?.category_id || null);
  const [idealMargin, setIdealMargin] = useState(String(initial?.ideal_profit_margin || ""));
  const [sellingPrice, setSellingPrice] = useState(String(initial?.selling_price || ""));
  const [taxPct, setTaxPct] = useState(String(initial?.tax_pct || ""));
  const [supplierIds, setSupplierIds] = useState<string[]>(initial?.preferred_supplier_ids || []);
  const [images, setImages] = useState<string[]>(initial?.images || []);
  const [barcodeImage, setBarcodeImage] = useState<string | null>(initial?.barcode_image || null);
  const [avgQty, setAvgQty] = useState(String(initial?.avg_sales?.quantity || ""));
  const [avgDays, setAvgDays] = useState(String(initial?.avg_sales?.period_days || ""));
  const [expSensitivity, setExpSensitivity] = useState(String(initial?.expiry_sensitivity_days || ""));
  const [minDays, setMinDays] = useState(String(initial?.min_inventory_days || ""));
  const [maxDays, setMaxDays] = useState(String(initial?.max_inventory_days || ""));
  const [purchaseTypeIds, setPurchaseTypeIds] = useState<string[]>(initial?.purchase_type_ids || []);
  const [keywords, setKeywords] = useState((initial?.keywords || []).join(", "));

  // Lookup data
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [categories, setCategories] = useState<Taxonomy[]>([]);
  const [purchaseTypes, setPurchaseTypes] = useState<Taxonomy[]>([]);
  const [loadingLookups, setLoadingLookups] = useState(true);
  const [busy, setBusy] = useState(false);

  // Price history
  const [prices, setPrices] = useState<PurchasePriceEntry[]>(initial?.purchase_prices || []);
  const [priceModalOpen, setPriceModalOpen] = useState(false);
  const [newPrice, setNewPrice] = useState("");
  const [newPriceSupplier, setNewPriceSupplier] = useState<string | null>(null);
  const [newPriceNote, setNewPriceNote] = useState("");

  const productId = initial?.id;

  // Load lookups
  useEffect(() => {
    (async () => {
      try {
        const [s, c, p] = await Promise.all([
          apiStore<Supplier[]>("/api/inventory/suppliers"),
          apiStore<Taxonomy[]>("/api/inventory/categories"),
          apiStore<Taxonomy[]>("/api/inventory/purchase-types"),
        ]);
        setSuppliers(s);
        setCategories(c);
        setPurchaseTypes(p);
      } catch (e: any) { Alert.alert("Lookup error", e.message); }
      finally { setLoadingLookups(false); }
    })();
  }, [apiStore]);

  // Computed
  const perDaySales = useMemo(() => {
    const q = numField(avgQty);
    const d = numField(avgDays);
    return d > 0 ? q / d : 0;
  }, [avgQty, avgDays]);

  const stats = useMemo(() => priceStats(prices), [prices]);
  const sortedPrices = useMemo(() => sortPricesAsc(prices), [prices]);

  // Image picker — main pictures (up to 3)
  const pickImage = async () => {
    if (images.length >= MAX_IMAGES) {
      Alert.alert("Max images", `You can attach up to ${MAX_IMAGES} pictures.`);
      return;
    }
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow photo library access to add product pictures.");
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: IMG_QUALITY,
      base64: true,
      allowsEditing: false,
    });
    if (res.canceled || !res.assets?.[0]) return;
    const b64 = res.assets[0].base64 ? `data:image/jpeg;base64,${res.assets[0].base64}` : res.assets[0].uri;
    setImages((p) => [...p, b64]);
  };

  const takePhoto = async () => {
    if (images.length >= MAX_IMAGES) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera access to take product pictures.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: IMG_QUALITY, base64: true });
    if (res.canceled || !res.assets?.[0]) return;
    const b64 = res.assets[0].base64 ? `data:image/jpeg;base64,${res.assets[0].base64}` : res.assets[0].uri;
    setImages((p) => [...p, b64]);
  };

  const removeImage = (idx: number) => setImages((p) => p.filter((_, i) => i !== idx));

  const pickBarcodePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission needed", "Allow camera access to capture the barcode.");
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: IMG_QUALITY, base64: true });
    if (res.canceled || !res.assets?.[0]) return;
    const b64 = res.assets[0].base64 ? `data:image/jpeg;base64,${res.assets[0].base64}` : res.assets[0].uri;
    setBarcodeImage(b64);
  };

  const scanBarcodeNow = () => {
    router.push({ pathname: "/(app)/inventory/scan" as any, params: { returnTo: "/(app)/inventory/product/new" } });
  };

  const toggleSupplier = (id: string) => {
    setSupplierIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };
  const togglePurchaseType = (id: string) => {
    setPurchaseTypeIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  };

  const addPriceEntry = async () => {
    const price = parseFloat(newPrice);
    if (isNaN(price) || price < 0) { Alert.alert("Invalid price"); return; }
    if (productId) {
      // existing product — persist directly
      try {
        const p = await apiStore<Product>(`/api/inventory/products/${productId}/purchase-price`, {
          method: "POST",
          body: JSON.stringify({ price, supplier_id: newPriceSupplier, note: newPriceNote }),
        });
        setPrices(p.purchase_prices);
      } catch (e: any) { Alert.alert("Error", e.message); }
    } else {
      // new product — keep locally until product is created, then push entries
      setPrices((cur) => [
        ...cur,
        {
          id: `tmp-${Date.now()}`,
          date: new Date().toISOString().slice(0, 10),
          price,
          supplier_id: newPriceSupplier,
          source: "manual",
          note: newPriceNote,
        },
      ]);
    }
    setNewPrice(""); setNewPriceSupplier(null); setNewPriceNote("");
    setPriceModalOpen(false);
  };

  const removePriceEntry = async (eid: string) => {
    if (productId && !eid.startsWith("tmp-")) {
      try {
        const p = await apiStore<Product>(`/api/inventory/products/${productId}/purchase-price/${eid}`, { method: "DELETE" });
        setPrices(p.purchase_prices);
      } catch (e: any) { Alert.alert("Error", e.message); }
    } else {
      setPrices((cur) => cur.filter((x) => x.id !== eid));
    }
  };

  const save = async () => {
    if (!name.trim()) { Alert.alert("Name required"); return; }
    setBusy(true);
    try {
      const body: any = {
        name: name.trim(),
        barcode: barcode.trim() || null,
        size, company, pack_size: packSize,
        category_id: categoryId,
        ideal_profit_margin: numField(idealMargin),
        selling_price: numField(sellingPrice),
        tax_pct: numField(taxPct),
        preferred_supplier_ids: supplierIds,
        images,
        barcode_image: barcodeImage,
        avg_sales: {
          quantity: numField(avgQty),
          period_days: Math.round(numField(avgDays)),
        },
        expiry_sensitivity_days: Math.round(numField(expSensitivity)),
        min_inventory_days: Math.round(numField(minDays)),
        max_inventory_days: Math.round(numField(maxDays)),
        purchase_type_ids: purchaseTypeIds,
        keywords: keywords.split(",").map((k) => k.trim()).filter(Boolean),
      };

      let saved: Product;
      if (mode === "edit" && productId) {
        saved = await apiStore<Product>(`/api/inventory/products/${productId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        saved = await apiStore<Product>("/api/inventory/products", {
          method: "POST",
          body: JSON.stringify(body),
        });
        // Push any locally added prices
        for (const pe of prices) {
          if (pe.id.startsWith("tmp-")) {
            saved = await apiStore<Product>(`/api/inventory/products/${saved.id}/purchase-price`, {
              method: "POST",
              body: JSON.stringify({ price: pe.price, supplier_id: pe.supplier_id, note: pe.note, date: pe.date }),
            });
          }
        }
      }
      onSaved(saved);
    } catch (e: any) {
      Alert.alert("Save failed", e.message);
    } finally { setBusy(false); }
  };

  const removeProduct = () => {
    if (!productId) return;
    Alert.alert("Delete product", `Permanently delete \"${name}\"?`, [
      { text: "Cancel" },
      {
        text: "Delete", style: "destructive",
        onPress: async () => {
          try {
            await apiStore(`/api/inventory/products/${productId}`, { method: "DELETE" });
            router.back();
          } catch (e: any) { Alert.alert("Error", e.message); }
        },
      },
    ]);
  };

  if (loadingLookups) {
    return (
      <SafeAreaView style={styles.container} edges={["top"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  const readOnly = !isAdmin && mode === "edit";

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <AppIcon name="back" size={20} color="#fff" />
          <Text style={styles.btnLabel}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {mode === "edit" ? (name || "Edit product") : "New Product"}
        </Text>
        {isAdmin && mode === "edit" ? (
          <TouchableOpacity onPress={removeProduct} style={[styles.iconBtn, { backgroundColor: "#7f1d1d" }]}>
            <AppIcon name="trash" size={16} color="#fff" />
          </TouchableOpacity>
        ) : <View style={{ width: 60 }} />}
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 120 }}>
          {/* Pictures */}
          <Section title="Pictures" subtitle={`Up to ${MAX_IMAGES} photos of the product`}>
            <View style={styles.imageRow}>
              {images.map((src, i) => (
                <View key={i} style={styles.imageThumb}>
                  <Image source={{ uri: src.startsWith("data:") ? src : `data:image/jpeg;base64,${src}` }} style={{ width: "100%", height: "100%" }} />
                  {!readOnly && (
                    <TouchableOpacity onPress={() => removeImage(i)} style={styles.imageRemove}>
                      <AppIcon name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              ))}
              {!readOnly && images.length < MAX_IMAGES && (
                <>
                  <TouchableOpacity testID="pick-image" onPress={pickImage} style={[styles.imageAdd, { borderColor: colors.primary }]}>
                    <Text style={styles.imageAddText}>+ Gallery</Text>
                  </TouchableOpacity>
                  <TouchableOpacity testID="take-photo" onPress={takePhoto} style={styles.imageAdd}>
                    <Text style={styles.imageAddText}>+ Camera</Text>
                  </TouchableOpacity>
                </>
              )}
            </View>
          </Section>

          {/* Barcode */}
          <Section title="Barcode" subtitle="Used to identify the product and look it up later">
            <View style={{ flexDirection: "row", gap: 8 }}>
              <TextInput
                testID="barcode-input"
                value={barcode}
                onChangeText={setBarcode}
                placeholder="Type or scan a barcode"
                placeholderTextColor={colors.textLight}
                style={[styles.input, { flex: 1 }]}
                editable={!readOnly}
                autoCapitalize="none"
              />
              {!readOnly && (
                <TouchableOpacity testID="scan-now" onPress={scanBarcodeNow} style={styles.scanBtn}>
                  <Text style={styles.scanBtnText}>Scan</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.barcodeImageRow, { marginTop: 10 }]}>
              {barcodeImage ? (
                <View style={styles.barcodeImageBox}>
                  <Image source={{ uri: barcodeImage.startsWith("data:") ? barcodeImage : `data:image/jpeg;base64,${barcodeImage}` }} style={{ width: "100%", height: "100%" }} />
                  {!readOnly && (
                    <TouchableOpacity onPress={() => setBarcodeImage(null)} style={styles.imageRemove}>
                      <AppIcon name="close" size={12} color="#fff" />
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <Text style={styles.subtle}>No barcode photo yet</Text>
              )}
              {!readOnly && !barcodeImage && (
                <TouchableOpacity onPress={pickBarcodePhoto} style={styles.smallBtn}>
                  <Text style={styles.smallBtnText}>Capture barcode photo</Text>
                </TouchableOpacity>
              )}
            </View>
          </Section>

          {/* Basics */}
          <Section title="Basics">
            <Field label="Product name *">
              <TextInput style={styles.input} placeholder="e.g. Whole Milk 1L" placeholderTextColor={colors.textLight} value={name} onChangeText={setName} editable={!readOnly} />
            </Field>
            <Row>
              <Field label="Size" half>
                <TextInput style={styles.input} placeholder="e.g. 1L" placeholderTextColor={colors.textLight} value={size} onChangeText={setSize} editable={!readOnly} />
              </Field>
              <Field label="Pack size" half>
                <TextInput style={styles.input} placeholder="e.g. 12 pack" placeholderTextColor={colors.textLight} value={packSize} onChangeText={setPackSize} editable={!readOnly} />
              </Field>
            </Row>
            <Field label="Company / Brand">
              <TextInput style={styles.input} placeholder="e.g. Dairy Inc" placeholderTextColor={colors.textLight} value={company} onChangeText={setCompany} editable={!readOnly} />
            </Field>
            <Field label="Category / Department">
              <Picker
                options={categories.map((c) => ({ id: c.id, label: c.name }))}
                value={categoryId}
                onChange={setCategoryId}
                placeholder="Select category"
                empty="No categories yet — add via Categories button"
                editable={!readOnly}
              />
            </Field>
            <Field label="Keywords (comma-separated, helps search)">
              <TextInput style={styles.input} placeholder="e.g. milk, dairy, breakfast" placeholderTextColor={colors.textLight} value={keywords} onChangeText={setKeywords} editable={!readOnly} />
            </Field>
          </Section>

          {/* Pricing */}
          <Section title="Pricing">
            <Row>
              <Field label="Selling price ($)" half>
                <TextInput style={styles.input} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={colors.textLight} value={sellingPrice} onChangeText={setSellingPrice} editable={!readOnly} />
              </Field>
              <Field label="Ideal margin (%)" half>
                <TextInput style={styles.input} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textLight} value={idealMargin} onChangeText={setIdealMargin} editable={!readOnly} />
              </Field>
            </Row>
            <Field label="Tax (%)">
              <TextInput style={styles.input} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textLight} value={taxPct} onChangeText={setTaxPct} editable={!readOnly} />
            </Field>
          </Section>

          {/* Suppliers */}
          <Section title="Preferred Suppliers" subtitle="Choose one or more. Manage list via Suppliers screen.">
            {suppliers.length === 0 ? (
              <Text style={styles.subtle}>No suppliers yet. {isAdmin ? "Add via the Suppliers screen." : ""}</Text>
            ) : (
              <View style={styles.chipsWrap}>
                {suppliers.map((s) => {
                  const selected = supplierIds.includes(s.id);
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.chip, selected && styles.chipActive]}
                      onPress={() => !readOnly && toggleSupplier(s.id)}
                      disabled={readOnly}
                    >
                      <Text style={[styles.chipText, selected && { color: "#fff" }]}>{s.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </Section>

          {/* Purchase Price History */}
          <Section title="Purchase Price History" subtitle="Sorted lowest → highest">
            {sortedPrices.length === 0 ? (
              <Text style={styles.subtle}>No purchase prices recorded yet.</Text>
            ) : (
              <View>
                {!!stats.lowest && (
                  <View style={styles.statsRow}>
                    <Stat label="Lowest" value={`$${(stats.lowest || 0).toFixed(2)}`} />
                    <Stat label="Highest" value={`$${(stats.highest || 0).toFixed(2)}`} />
                    <Stat label="Latest" value={`$${(stats.latest || 0).toFixed(2)}`} />
                  </View>
                )}
                {sortedPrices.map((p) => {
                  const sup = suppliers.find((s) => s.id === p.supplier_id);
                  return (
                    <View key={p.id} style={styles.priceRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.priceVal}>${p.price.toFixed(2)}</Text>
                        <Text style={styles.priceMeta}>
                          {p.date}
                          {sup ? ` · ${sup.name}` : ""}
                          {p.note ? ` · ${p.note}` : ""}
                        </Text>
                      </View>
                      {!readOnly && (
                        <TouchableOpacity onPress={() => removePriceEntry(p.id)} style={styles.iconAction}>
                          <AppIcon name="close" size={14} color={colors.danger} />
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
              </View>
            )}
            {!readOnly && (
              <TouchableOpacity testID="add-price" style={styles.smallBtn} onPress={() => setPriceModalOpen(true)}>
                <Text style={styles.smallBtnText}>+ Add purchase price</Text>
              </TouchableOpacity>
            )}
          </Section>

          {/* Sales velocity */}
          <Section title="Average Sales">
            <Row>
              <Field label="Quantity sold" half>
                <TextInput style={styles.input} keyboardType="decimal-pad" placeholder="0" placeholderTextColor={colors.textLight} value={avgQty} onChangeText={setAvgQty} editable={!readOnly} />
              </Field>
              <Field label="Over (days)" half>
                <TextInput style={styles.input} keyboardType="number-pad" placeholder="0" placeholderTextColor={colors.textLight} value={avgDays} onChangeText={setAvgDays} editable={!readOnly} />
              </Field>
            </Row>
            <View style={styles.computedRow}>
              <Text style={styles.computedLabel}>Per-day sales</Text>
              <Text style={styles.computedVal}>{perDaySales ? perDaySales.toFixed(3) : "—"}</Text>
            </View>
          </Section>

          {/* Expiry & Inventory targets */}
          <Section title="Expiry & Inventory">
            <Field label="Expiry sensitivity (days)">
              <TextInput style={styles.input} keyboardType="number-pad" placeholder="e.g. 14" placeholderTextColor={colors.textLight} value={expSensitivity} onChangeText={setExpSensitivity} editable={!readOnly} />
            </Field>
            <Row>
              <Field label="Min inventory (days)" half>
                <TextInput style={styles.input} keyboardType="number-pad" placeholder="e.g. 3" placeholderTextColor={colors.textLight} value={minDays} onChangeText={setMinDays} editable={!readOnly} />
              </Field>
              <Field label="Max inventory (days)" half>
                <TextInput style={styles.input} keyboardType="number-pad" placeholder="e.g. 14" placeholderTextColor={colors.textLight} value={maxDays} onChangeText={setMaxDays} editable={!readOnly} />
              </Field>
            </Row>
          </Section>

          {/* Purchase types */}
          <Section title="Purchase Types" subtitle="How this product is sourced">
            {purchaseTypes.length === 0 ? (
              <Text style={styles.subtle}>No purchase types yet. {isAdmin ? "Add via Categories → Purchase Types." : ""}</Text>
            ) : (
              <View style={styles.chipsWrap}>
                {purchaseTypes.map((t) => {
                  const sel = purchaseTypeIds.includes(t.id);
                  return (
                    <TouchableOpacity
                      key={t.id}
                      style={[styles.chip, sel && styles.chipActive]}
                      onPress={() => !readOnly && togglePurchaseType(t.id)}
                      disabled={readOnly}
                    >
                      <Text style={[styles.chipText, sel && { color: "#fff" }]}>{t.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </Section>

          {!readOnly && (
            <TouchableOpacity testID="save-product" style={[styles.saveBtn]} onPress={save} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>{mode === "edit" ? "Save changes" : "Create product"}</Text>}
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Add purchase-price modal */}
      <Modal visible={priceModalOpen} transparent animationType="slide" onRequestClose={() => setPriceModalOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.modalBack}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>Add purchase price</Text>
            <TextInput style={styles.input} keyboardType="decimal-pad" placeholder="Price" placeholderTextColor={colors.textLight} value={newPrice} onChangeText={setNewPrice} autoFocus />
            <Picker
              options={suppliers.map((s) => ({ id: s.id, label: s.name }))}
              value={newPriceSupplier}
              onChange={setNewPriceSupplier}
              placeholder="Supplier (optional)"
              empty="No suppliers"
              editable
            />
            <TextInput style={[styles.input, { minHeight: 60 }]} placeholder="Note (optional)" placeholderTextColor={colors.textLight} value={newPriceNote} onChangeText={setNewPriceNote} multiline />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.surface }]} onPress={() => setPriceModalOpen(false)}>
                <Text style={{ color: colors.text, fontWeight: "600" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: colors.primary }]} onPress={addPriceEntry}>
                <Text style={{ color: "#fff", fontWeight: "700" }}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

// ----- small helpers -----
const Section: React.FC<{ title: string; subtitle?: string; children: React.ReactNode }> = ({ title, subtitle, children }) => (
  <View style={styles.section}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {subtitle && <Text style={styles.sectionSub}>{subtitle}</Text>}
    <View style={{ marginTop: 8, gap: 10 }}>{children}</View>
  </View>
);
const Field: React.FC<{ label: string; half?: boolean; children: React.ReactNode }> = ({ label, half, children }) => (
  <View style={{ flex: half ? 1 : undefined }}>
    <Text style={styles.label}>{label}</Text>
    {children}
  </View>
);
const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={{ flexDirection: "row", gap: 10 }}>{children}</View>
);
const Stat: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <View style={styles.stat}>
    <Text style={styles.statLabel}>{label}</Text>
    <Text style={styles.statVal}>{value}</Text>
  </View>
);

// Dropdown / single-select. Light implementation using a Modal.
const Picker: React.FC<{
  options: { id: string; label: string }[];
  value: string | null;
  onChange: (v: string | null) => void;
  placeholder: string;
  empty: string;
  editable: boolean;
}> = ({ options, value, onChange, placeholder, empty, editable }) => {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.id === value);
  return (
    <View>
      <TouchableOpacity
        style={[styles.input, { flexDirection: "row", alignItems: "center", justifyContent: "space-between" }]}
        onPress={() => editable && setOpen(true)}
        disabled={!editable}
      >
        <Text style={{ color: selected ? colors.text : colors.textLight, fontSize: 14 }}>
          {selected ? selected.label : placeholder}
        </Text>
        <AppIcon name="down" size={14} color={colors.textMuted} />
      </TouchableOpacity>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <TouchableOpacity activeOpacity={1} style={styles.modalBack} onPress={() => setOpen(false)}>
          <View style={[styles.modalBox, { maxHeight: "60%" }]}>
            <Text style={styles.modalTitle}>{placeholder}</Text>
            <ScrollView style={{ marginVertical: 8 }}>
              <TouchableOpacity style={styles.optRow} onPress={() => { onChange(null); setOpen(false); }}>
                <Text style={{ color: colors.textMuted }}>— None —</Text>
              </TouchableOpacity>
              {options.length === 0 ? (
                <Text style={styles.subtle}>{empty}</Text>
              ) : (
                options.map((o) => (
                  <TouchableOpacity key={o.id} style={[styles.optRow, value === o.id && { backgroundColor: "#DBEAFE" }]} onPress={() => { onChange(o.id); setOpen(false); }}>
                    <Text style={{ color: colors.text, fontWeight: value === o.id ? "700" : "500" }}>{o.label}</Text>
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.18)" },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 16, fontWeight: "700", flex: 1, textAlign: "center", marginHorizontal: 8 },

  section: { backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  sectionTitle: { fontSize: 14, fontWeight: "700", color: colors.text },
  sectionSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  label: { fontSize: 12, color: colors.textMuted, marginBottom: 4, fontWeight: "600" },

  input: { backgroundColor: colors.surface, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: colors.text, borderWidth: 1, borderColor: colors.border },
  subtle: { fontSize: 12, color: colors.textMuted, fontStyle: "italic" },

  imageRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  imageThumb: { width: 80, height: 80, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.surface, position: "relative" },
  imageRemove: { position: "absolute", top: 4, right: 4, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 10, padding: 4 },
  imageAdd: { width: 80, height: 80, borderRadius: radius.sm, borderWidth: 1, borderStyle: "dashed", borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  imageAddText: { color: colors.primary, fontWeight: "600", fontSize: 12 },

  barcodeImageRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  barcodeImageBox: { width: 120, height: 70, borderRadius: radius.sm, overflow: "hidden", backgroundColor: colors.surface, position: "relative" },

  scanBtn: { paddingHorizontal: 16, justifyContent: "center", backgroundColor: colors.primary, borderRadius: radius.sm },
  scanBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },

  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { color: colors.text, fontWeight: "600", fontSize: 13 },

  statsRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  stat: { flex: 1, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: colors.surface, borderRadius: radius.sm },
  statLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "600" },
  statVal: { fontSize: 14, color: colors.text, fontWeight: "700", marginTop: 2 },

  priceRow: { flexDirection: "row", alignItems: "center", paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
  priceVal: { fontSize: 15, color: colors.text, fontWeight: "700" },
  priceMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  smallBtn: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: "#EFF6FF", borderRadius: radius.sm, alignSelf: "flex-start", marginTop: 6 },
  smallBtnText: { color: colors.primary, fontWeight: "700", fontSize: 12 },

  computedRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 12, paddingVertical: 8, backgroundColor: colors.surface, borderRadius: radius.sm, alignItems: "center" },
  computedLabel: { fontSize: 12, color: colors.textMuted, fontWeight: "600" },
  computedVal: { fontSize: 15, color: colors.primary, fontWeight: "700" },

  iconAction: { padding: 6 },

  saveBtn: { marginTop: 12, backgroundColor: colors.primary, padding: 14, borderRadius: radius.md, alignItems: "center" },
  saveBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },

  modalBack: { flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" },
  modalBox: { backgroundColor: colors.card, padding: spacing.lg, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, gap: spacing.sm },
  modalTitle: { fontSize: 17, fontWeight: "700", color: colors.text, marginBottom: 4 },
  modalBtn: { flex: 1, padding: 12, borderRadius: radius.md, alignItems: "center" },
  optRow: { paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: colors.border },
});
