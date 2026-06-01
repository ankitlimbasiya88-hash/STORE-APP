import React, { useCallback, useEffect, useState } from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors } from "@/src/theme/colors";
import ProductForm from "@/src/components/inventory/ProductForm";
import { Product } from "@/src/utils/inventory";

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { apiStore } = useSession();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const p = await apiStore<Product>(`/api/inventory/products/${id}`);
      setProduct(p);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [apiStore, id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      </SafeAreaView>
    );
  }
  if (error || !product) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.err}>{error || "Product not found"}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <ProductForm
      mode="edit"
      initial={product}
      onSaved={(p) => {
        setProduct(p);
        router.back();
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  err: { color: colors.danger, fontSize: 14 },
});
