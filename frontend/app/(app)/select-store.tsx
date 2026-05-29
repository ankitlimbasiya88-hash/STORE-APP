import React, { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator,
  Alert, RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppIcon } from "@/src/components/AppIcon";
import { router, useLocalSearchParams } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";

export default function SelectStoreScreen() {
  const { session, stores, refreshStores, setStoreId, signOut } = useSession();
  const params = useLocalSearchParams<{ switch?: string }>();
  const isSwitching = params.switch === "1";
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    await refreshStores();
    setLoading(false);
  }, [refreshStores]);

  useEffect(() => { load(); }, [load]);

  const pick = async (id: string) => {
    await setStoreId(id);
    router.replace("/(app)/home");
  };

  if (loading) {
    return <View style={styles.loader}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        {isSwitching ? (
          <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.iconBtn}>
            <AppIcon name="back" size={26} color="#fff" />
            <Text style={styles.btnLabel}>Back</Text>
          </TouchableOpacity>
        ) : <View style={{ width: 40 }} />}
        <Text style={styles.headerTitle}>{isSwitching ? "Switch Store" : "Select Store"}</Text>
        {isSwitching ? <View style={{ width: 40 }} /> : (
          <TouchableOpacity testID="logout-btn" onPress={signOut} style={styles.iconBtn}>
            <Ionicons name="log-out-outline" size={18} color="#fff" />
            <Text style={styles.btnLabel}>Sign out</Text>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      >
        <Text style={styles.greeting}>Welcome, {session?.user.name}</Text>
        <Text style={styles.subtitle}>
          {stores.length > 0 ? "Choose a location to continue:" : "No stores available."}
        </Text>

        {stores.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="business-outline" size={56} color={colors.textLight} />
            <Text style={styles.emptyText}>
              {session?.user.role === "admin"
                ? "Tap 'Manage Stores' below to add your first location."
                : "Ask your admin to grant you access to a store."}
            </Text>
          </View>
        ) : (
          stores.map((s) => (
            <TouchableOpacity
              key={s.id}
              testID={`store-${s.id}`}
              style={styles.storeCard}
              onPress={() => pick(s.id)}
              activeOpacity={0.85}
            >
              <View style={styles.storeIcon}>
                <Ionicons name="storefront" size={26} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.storeName}>{s.name}</Text>
                <Text style={styles.storeSub}>Tap to enter</Text>
              </View>
              <AppIcon name="forward" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          ))
        )}

        {session?.user.role === "admin" && (
          <TouchableOpacity
            testID="manage-stores-btn"
            style={styles.manageBtn}
            onPress={() => router.push("/(app)/stores-manage")}
          >
            <Ionicons name="settings-outline" size={18} color={colors.primary} />
            <Text style={styles.manageText}>Manage Stores</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  loader: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  iconBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)" },
  btnLabel: { color: "#fff", fontSize: 13, fontWeight: "700" },
  headerTitle: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: spacing.lg, gap: spacing.sm },
  greeting: { fontSize: 22, fontWeight: "700", color: colors.text, marginTop: spacing.sm },
  subtitle: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg },
  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.textMuted, textAlign: "center", lineHeight: 22, fontSize: 14 },
  storeCard: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.card, padding: spacing.md, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm,
  },
  storeIcon: { width: 50, height: 50, borderRadius: 14, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  storeName: { fontSize: 17, fontWeight: "700", color: colors.text },
  storeSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  manageBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    marginTop: spacing.lg, padding: spacing.md, borderRadius: radius.md,
    borderWidth: 1.5, borderColor: colors.primary, backgroundColor: "#EFF6FF",
  },
  manageText: { color: colors.primary, fontWeight: "700", fontSize: 15 },
});
