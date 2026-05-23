import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { useSession } from "@/src/ctx/SessionProvider";
import { colors, spacing, radius } from "@/src/theme/colors";

export default function HomeScreen() {
  const { session, signOut } = useSession();
  const user = session!.user;

  const onLogout = () => {
    Alert.alert("Sign out", "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: signOut },
    ]);
  };

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.name} testID="home-username">{user.name}</Text>
          <View style={[styles.roleBadge, user.role === "admin" && styles.adminBadge]}>
            <Ionicons
              name={user.role === "admin" ? "shield-checkmark" : "person"}
              size={12}
              color="#fff"
            />
            <Text style={styles.roleText}>{user.role.toUpperCase()}</Text>
          </View>
        </View>
        <TouchableOpacity testID="logout-btn" onPress={onLogout} style={styles.logoutBtn}>
          <Ionicons name="log-out-outline" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>Main Functions</Text>

        <TouchableOpacity
          testID="card-operations"
          style={[styles.card, styles.cardPrimary]}
          onPress={() => router.push("/(app)/operations")}
          activeOpacity={0.85}
        >
          <View style={styles.cardIconWrap}>
            <Ionicons name="construct" size={32} color={colors.primary} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Store Operations</Text>
            <Text style={styles.cardDesc}>Checklists, accounting, and chat</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </TouchableOpacity>

        <TouchableOpacity
          testID="card-inventory"
          style={[styles.card]}
          onPress={() => router.push("/(app)/inventory")}
          activeOpacity={0.85}
        >
          <View style={[styles.cardIconWrap, { backgroundColor: "#FEF3C7" }]}>
            <Ionicons name="cube" size={32} color={colors.warning} />
          </View>
          <View style={styles.cardBody}>
            <Text style={styles.cardTitle}>Inventory & Orders</Text>
            <Text style={styles.cardDesc}>Pricing, purchasing, ordering</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
        </TouchableOpacity>

        {user.role === "admin" && (
          <TouchableOpacity
            testID="card-users"
            style={[styles.card]}
            onPress={() => router.push("/(app)/users")}
            activeOpacity={0.85}
          >
            <View style={[styles.cardIconWrap, { backgroundColor: "#DBEAFE" }]}>
              <Ionicons name="people" size={32} color={colors.primaryLight} />
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>Manage Users</Text>
              <Text style={styles.cardDesc}>Add or remove team members</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.primary, paddingHorizontal: spacing.lg,
    paddingTop: spacing.md, paddingBottom: spacing.xl,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
    flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start",
  },
  greeting: { color: "rgba(255,255,255,0.8)", fontSize: 14 },
  name: { color: "#fff", fontSize: 26, fontWeight: "700", marginTop: 2 },
  roleBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.18)", alignSelf: "flex-start",
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginTop: 8,
  },
  adminBadge: { backgroundColor: "rgba(255,255,255,0.25)" },
  roleText: { color: "#fff", fontSize: 11, fontWeight: "700", marginLeft: 4, letterSpacing: 0.5 },
  logoutBtn: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  content: { padding: spacing.lg, gap: spacing.md },
  sectionLabel: { fontSize: 12, fontWeight: "700", color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.xs },
  card: {
    backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md,
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: "#0F172A", shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 2,
  },
  cardPrimary: { borderColor: colors.primaryLight + "33" },
  cardIconWrap: {
    width: 56, height: 56, borderRadius: 14, backgroundColor: "#DBEAFE",
    alignItems: "center", justifyContent: "center",
  },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 17, fontWeight: "700", color: colors.text },
  cardDesc: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
