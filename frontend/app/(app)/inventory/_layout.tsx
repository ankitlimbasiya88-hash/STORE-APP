import React from "react";
import { Stack } from "expo-router";

export default function InventoryLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="product/new" />
      <Stack.Screen name="product/[id]/index" />
      <Stack.Screen name="product/[id]/edit" />
      <Stack.Screen name="suppliers" />
      <Stack.Screen name="taxonomy" />
      <Stack.Screen name="scan" options={{ presentation: "modal" }} />
    </Stack>
  );
}
