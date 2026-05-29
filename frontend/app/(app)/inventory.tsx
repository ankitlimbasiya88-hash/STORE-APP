import React from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { colors, spacing, radius } from "@/src/theme/colors";

export default function InventoryScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Inventory & Orders</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={styles.body}>
        <View style={styles.iconWrap}>
          <Ionicons name="cube" size={64} color={colors.warning} />
        </View>
        <Text style={styles.heading}>Coming Soon</Text>
        <Text style={styles.text}>
          Inventory, pricing, purchasing & ordering will be added in the next phase.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    backgroundColor: colors.primary, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  body: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  iconWrap: {
    width: 120, height: 120, borderRadius: 60, backgroundColor: "#FEF3C7",
    alignItems: "center", justifyContent: "center", marginBottom: spacing.lg,
  },
  heading: { fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: spacing.sm },
  text: { fontSize: 15, color: colors.textMuted, textAlign: "center", lineHeight: 22 },
});
