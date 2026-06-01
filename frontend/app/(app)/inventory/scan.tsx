import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { CameraView, useCameraPermissions } from "expo-camera";

import { colors, spacing, radius } from "@/src/theme/colors";
import { AppIcon } from "@/src/components/AppIcon";

export default function BarcodeScanScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const params = useLocalSearchParams<{ returnTo?: string }>();
  const handledRef = useRef(false);

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  const onScanned = ({ data, type }: { data: string; type: string }) => {
    if (handledRef.current) return;
    handledRef.current = true;
    setScanned(true);
    const target = (params.returnTo as string) || "/(app)/inventory";
    router.replace({ pathname: target as any, params: { scanned: data, scannedType: type } });
  };

  if (!permission) {
    return (
      <SafeAreaView style={styles.bg}>
        <ActivityIndicator color="#fff" />
      </SafeAreaView>
    );
  }

  if (!permission.granted) {
    return (
      <SafeAreaView style={styles.bg}>
        <View style={styles.permBox}>
          <Text style={styles.permTitle}>Camera permission needed</Text>
          <Text style={styles.permDesc}>
            We use the camera to scan product barcodes. Your camera is never
            shared and no photos are stored unless you save them with a product.
          </Text>
          <TouchableOpacity testID="perm-ask" style={styles.permBtn} onPress={() => requestPermission()}>
            <Text style={styles.permBtnText}>Grant camera access</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => router.back()} style={{ marginTop: 12 }}>
            <Text style={{ color: "#cbd5e1" }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={styles.bg}>
      <CameraView
        style={StyleSheet.absoluteFillObject}
        facing="back"
        onBarcodeScanned={scanned ? undefined : onScanned}
        barcodeScannerSettings={{
          barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"],
        }}
      />
      {/* overlay */}
      <SafeAreaView style={styles.overlay} edges={["top", "bottom"]}>
        <View style={styles.topBar}>
          <TouchableOpacity testID="close-scan" onPress={() => router.back()} style={styles.closeBtn}>
            <AppIcon name="close" size={20} color="#fff" />
            <Text style={styles.closeBtnText}>Close</Text>
          </TouchableOpacity>
          <Text style={styles.scanTitle}>Scan barcode</Text>
          <View style={{ width: 60 }} />
        </View>
        <View style={styles.frameWrap}>
          <View style={styles.frame}>
            <View style={[styles.corner, { top: -2, left: -2, borderTopWidth: 4, borderLeftWidth: 4 }]} />
            <View style={[styles.corner, { top: -2, right: -2, borderTopWidth: 4, borderRightWidth: 4 }]} />
            <View style={[styles.corner, { bottom: -2, left: -2, borderBottomWidth: 4, borderLeftWidth: 4 }]} />
            <View style={[styles.corner, { bottom: -2, right: -2, borderBottomWidth: 4, borderRightWidth: 4 }]} />
          </View>
          <Text style={styles.hint}>Align the barcode within the frame</Text>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  bg: { flex: 1, backgroundColor: "#000" },
  overlay: { flex: 1 },
  topBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.md,
  },
  closeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  closeBtnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  scanTitle: { color: "#fff", fontSize: 16, fontWeight: "700" },
  frameWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
  frame: {
    width: 260, height: 180, borderWidth: 1, borderColor: "rgba(255,255,255,0.4)",
    borderRadius: 12,
  },
  corner: { position: "absolute", width: 28, height: 28, borderColor: "#22D3EE" },
  hint: { color: "#fff", marginTop: spacing.lg, fontSize: 13 },
  permBox: { padding: spacing.lg, marginTop: 80 },
  permTitle: { color: "#fff", fontSize: 18, fontWeight: "700", marginBottom: 8 },
  permDesc: { color: "#cbd5e1", fontSize: 13, lineHeight: 19, marginBottom: 20 },
  permBtn: { backgroundColor: colors.primary, padding: 14, borderRadius: radius.md, alignItems: "center" },
  permBtnText: { color: "#fff", fontWeight: "700" },
});
