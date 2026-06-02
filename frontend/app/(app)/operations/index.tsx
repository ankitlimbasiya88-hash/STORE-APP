import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { AppIcon, AppIconName } from "@/src/components/AppIcon";
import { router } from "expo-router";
import { colors, spacing, radius } from "@/src/theme/colors";

const FUNCTIONS: Array<{
  key: string; title: string; desc: string; icon: string;
  appIcon?: AppIconName; color: string; bg: string; route: any;
}> = [
  { key: "opening", title: "Opening Checklist", desc: "Start-of-day tasks", icon: "sunny", appIcon: "sun", color: "#F59E0B", bg: "#FEF3C7", route: "/(app)/operations/opening" as const },
  { key: "accounting", title: "Cash Accounting", desc: "Daily credit & debit", icon: "calculator", appIcon: "cash", color: colors.primary, bg: "#DBEAFE", route: "/(app)/operations/accounting" as const },
  { key: "closing", title: "Closing Checklist", desc: "End-of-day tasks", icon: "moon", appIcon: "moon", color: "#7C3AED", bg: "#EDE9FE", route: "/(app)/operations/closing" as const },
  { key: "chat", title: "Chat", desc: "Team conversations", icon: "chatbubbles", color: colors.success, bg: "#DCFCE7", route: "/(app)/operations/chat" as const },
  { key: "reports", title: "Daily Report", desc: "Day-by-day accounting & checklist PDFs", icon: "document-text", appIcon: "download", color: "#0EA5E9", bg: "#E0F2FE", route: "/(app)/operations/reports" as const },
  { key: "summary", title: "Reports Dashboard", desc: "Spend & cash analytics by period", icon: "bar-chart", appIcon: "chart", color: "#10B981", bg: "#D1FAE5", route: "/(app)/operations/summary" as const },
];

export default function OperationsScreen() {
  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity testID="back-btn" onPress={() => router.back()} style={styles.backBtn}>
          <AppIcon name="back" size={26} color="#fff" />
        </TouchableOpacity>
        <Text style={styles.title}>Store Operations</Text>
        <View style={{ width: 40 }} />
      </View>
      <ScrollView contentContainerStyle={styles.content}>
        {FUNCTIONS.map((f) => (
          <TouchableOpacity key={f.key} testID={`ops-card-${f.key}`} style={styles.card} onPress={() => router.push(f.route)} activeOpacity={0.85}>
            <View style={[styles.iconWrap, { backgroundColor: f.bg }]}>
              {f.appIcon ? (
                <AppIcon name={f.appIcon} size={28} color={f.color} />
              ) : (
                <Ionicons name={f.icon as any} size={28} color={f.color} />
              )}
            </View>
            <View style={styles.cardBody}>
              <Text style={styles.cardTitle}>{f.title}</Text>
              <Text style={styles.cardDesc}>{f.desc}</Text>
            </View>
            <AppIcon name="forward" size={22} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: { backgroundColor: colors.primary, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.md },
  backBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)" },
  title: { color: "#fff", fontSize: 18, fontWeight: "700" },
  content: { padding: spacing.lg, gap: spacing.md },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: 1, borderColor: colors.border },
  iconWrap: { width: 52, height: 52, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardBody: { flex: 1 },
  cardTitle: { fontSize: 16, fontWeight: "700", color: colors.text },
  cardDesc: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
