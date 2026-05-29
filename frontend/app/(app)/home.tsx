import React, { useEffect } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppIcon } from "@/src/components/AppIcon";
import { router, Redirect } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";

export default function HomeScreen() {
  const { session, signOut, storeId, storeName, stores } = useSession();
  const user = session!.user;

  // If no store selected, redirect to picker
  if (!storeId) return <Redirect href="/(app)/select-store" />;

  const onLogout = () => {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
  };

  const canSwitchStore = stores.length > 1;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.name} testID="home-username">{user.name}</Text>
          <View style={[styles.roleBadge, user.role === "admin" && styles.adminBadge]}>
            <Ionicons name={user.role === "admin" ? "shield-checkmark" : "person"} size={12} color="#fff" />
            <Text style={styles.roleText}>{user.role.toUpperCase()}</Text>
          </View>
        </View>
        <TouchableOpacity testID="logout-btn" onPress={onLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={20} color="#fff" />
          <Text style={styles.logoutText}>Sign out</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        testID="store-pill"
        style={styles.storePill}
        onPress={() => canSwitchStore && router.push("/(app)/select-store?switch=1")}
        activeOpacity={canSwitchStore ? 0.7 : 1}
      >
        <Ionicons name="storefront" size={18} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={styles.storeLabel}>Current Store</Text>
          <Text style={styles.storeName}>{storeName || "—"}</Text>
        </View>
        {canSwitchStore && <Ionicons name="swap-horizontal" size={20} color={colors.primary} />}
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>Main Functions</Text>

        <TouchableOpacity testID="card-operations" style={[styles.card, styles.cardPrimary]} onPress={() => router.push("/(app)/operations")} activeOpacity={0.85}>
          <View style={styles.cardIconWrap}>
            <Ionicons name="construct" size={32} color={colors.primary} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Store Operations</Text>
            <Text style={styles.cardDesc}>Checklists, accounting, and chat</Text>
          </View>
          <AppIcon name="forward" size={22} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity testID="card-inventory" style={[styles.card]} onPress={() => router.push("/(app)/inventory")} activeOpacity={0.85}>
          <View style={[styles.cardIconWrap, { backgroundColor: "#FEF3C7" }]}>
            <Ionicons name="cube" size={32} color={colors.warning} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Inventory & Orders</Text>
            <Text style={styles.cardDesc}>Pricing, purchasing, ordering</Text>
          </View>
          <AppIcon name="forward" size={22} color={colors.textMuted} />
        </TouchableOpacity>

        {user.role === "admin" && (
          <>
            <Text style={[styles.sectionLabel, { marginTop: spacing.lg }]}>Administration</Text>

            <TouchableOpacity testID="card-users" style={[styles.card]} onPress={() => router.push("/(app)/users")} activeOpacity={0.85}>
              <View style={[styles.cardIconWrap, { backgroundColor: "#DBEAFE" }]}>
                <Ionicons name="people" size={32} color={colors.primaryLight} />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>Manage Users</Text>
                <Text style={styles.cardDesc}>Add, remove & assign stores</Text>
              </View>
              <AppIcon name="forward" size={22} color={colors.textMuted} />
            </TouchableOpacity>

            <TouchableOpacity testID="card-stores" style={[styles.card]} onPress={() => router.push("/(app)/stores-manage")} activeOpacity={0.85}>
              <View style={[styles.cardIconWrap, { backgroundColor: "#EDE9FE" }]}>
                <Ionicons name="business" size={32} color="#7C3AED" />
              </View>
              <View style={styles.cardBody}>
                <Text style={styles.cardTitle}>Manage Stores</Text>
                <Text style={styles.cardDesc}>Add or remove store locations</Text>
              </View>
              <AppIcon name="forward" size={22} color={colors.textMuted} />
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.primary, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.lg, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  greeting: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  name: { color: "#fff", fontSize: 26, fontWeight: "700", marginTop: 2 },
  roleBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(255,255,255,0.18)", alignSelf: "flex-start", paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginTop: 8 },
  adminBadge: { backgroundColor: "rgba(255,255,255,0.25)" },
  roleText: { color: "#fff", fontSize: 11, fontWeight: "700", marginLeft: 4, letterSpacing: 0.5 },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.25)" },
  logoutText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  storePill: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.card, marginHorizontal: spacing.lg, marginTop: -spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  storeLabel: { fontSize: 11, color: colors.textMuted, letterSpacing: 0.5, textTransform: "uppercase" },
  storeName: { fontSize: 16, fontWeight: "700", color: colors.text, marginTop: 2 },
  content: { padding: spacing.lg, gap: spacing.md },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.xs },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardPrimary: { borderColor: colors.primaryLight + "33" },
  cardIconWrap: { width: 56, height: 56, borderRadius: 14, backgroundColor: "#DBEAFE", alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  cardDesc: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
