import React, { useState, useEffect, useRef } from "react";
import { TextInput, View, Text, StyleSheet, StyleProp, ViewStyle, TextStyle } from "react-native";
import { colors, radius } from "@/src/theme/colors";

/**
 * Cents-style money input.
 *
 * • Every digit the user types is treated as 1 cent.
 *   Typing "299" displays "2.99"; typing "1" displays "0.01"; "10000" → "100.00".
 * • Backspace removes one digit at a time (so "2.99" → "0.29" → "0.02" → "").
 * • Empty string → 0.
 * • Decimal/period keys are silently stripped (the formatter inserts the dot).
 */

const sanitizeDigits = (s: string): string => s.replace(/\D/g, "").slice(0, 12);

export const formatCentsDisplay = (digits: string): string => {
  const clean = sanitizeDigits(digits);
  if (!clean) return "";
  const padded = clean.padStart(3, "0");                 // ensure 1+ digit for dollars
  const dollars = padded.slice(0, -2);
  const cents = padded.slice(-2);
  const dollarsNum = String(parseInt(dollars, 10));      // strip leading zeros
  return `${dollarsNum}.${cents}`;
};

export const digitsToFloat = (digits: string): number => {
  const clean = sanitizeDigits(digits);
  if (!clean) return 0;
  return parseInt(clean, 10) / 100;
};

export const floatToDigits = (v: number | null | undefined): string => {
  if (v == null || isNaN(v as number) || v === 0) return "";
  const cents = Math.round((v as number) * 100);
  if (cents <= 0) return "";
  return String(cents);
};

type Props = {
  value: number | null | undefined;
  onChangeNumber: (v: number) => void;
  onCommit?: (v: number) => void;
  placeholder?: string;
  editable?: boolean;
  showCurrency?: boolean;
  currency?: string;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  testID?: string;
  autoFocus?: boolean;
};

export const PriceInput: React.FC<Props> = ({
  value,
  onChangeNumber,
  onCommit,
  placeholder = "0.00",
  editable = true,
  showCurrency = true,
  currency = "$",
  style,
  inputStyle,
  testID,
  autoFocus,
}) => {
  const [digits, setDigits] = useState<string>(() => floatToDigits(value));
  const focused = useRef(false);

  // Sync from parent only when the input is not focused (so we don't fight the user)
  useEffect(() => {
    if (!focused.current) {
      const incoming = floatToDigits(value);
      setDigits(incoming);
    }
  }, [value]);

  const handleChange = (txt: string) => {
    const clean = sanitizeDigits(txt);
    setDigits(clean);
    onChangeNumber(digitsToFloat(clean));
  };

  return (
    <View style={[styles.wrap, style]}>
      {showCurrency && <Text style={styles.currency}>{currency}</Text>}
      <TextInput
        testID={testID}
        keyboardType="number-pad"
        editable={editable}
        placeholder={placeholder}
        placeholderTextColor={colors.textLight}
        value={formatCentsDisplay(digits)}
        onFocus={() => { focused.current = true; }}
        onBlur={() => {
          focused.current = false;
          onCommit?.(digitsToFloat(digits));
        }}
        onChangeText={handleChange}
        style={[styles.input, inputStyle]}
        autoFocus={autoFocus}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  currency: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  input: {
    flex: 1,
    minWidth: 50,
    paddingVertical: 8,
    paddingLeft: 4,
    fontSize: 14,
    color: colors.text,
    fontWeight: "700",
    textAlign: "right",
  },
});
