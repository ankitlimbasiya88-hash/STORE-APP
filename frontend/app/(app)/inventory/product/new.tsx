import React from "react";
import { router, useLocalSearchParams } from "expo-router";
import ProductForm from "@/src/components/inventory/ProductForm";

export default function NewProductScreen() {
  const params = useLocalSearchParams<{ barcode?: string }>();
  return (
    <ProductForm
      mode="new"
      initialBarcode={params.barcode as string | undefined}
      onSaved={(p) => {
        router.replace(`/(app)/inventory/product/${p.id}` as any);
      }}
    />
  );
}
