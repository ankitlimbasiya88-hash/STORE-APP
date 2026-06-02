// View-based icon component. Renders without any custom font so it ALWAYS
// shows up — even when @expo/vector-icons fails to load Ionicons on Expo Go.
//
// Usage:
//   <AppIcon name="back" size={20} color="#fff" />
//
// Supported names:
//   back, forward, up, down (chevrons)
//   plus, close, check
//   download, calendar
//   sun, moon, dot

import React from "react";
import { View, Text, StyleSheet } from "react-native";

export type AppIconName =
  | "back"
  | "forward"
  | "up"
  | "down"
  | "plus"
  | "close"
  | "check"
  | "download"
  | "calendar"
  | "sun"
  | "moon"
  | "dot"
  | "cash"
  | "trash";

type Props = {
  name: AppIconName;
  size?: number;
  color?: string;
  weight?: number; // stroke thickness
};

export const AppIcon: React.FC<Props> = ({ name, size = 20, color = "#0F172A", weight }) => {
  const stroke = weight ?? Math.max(2, Math.round(size / 9));

  switch (name) {
    case "back":
      return <Chevron size={size} color={color} stroke={stroke} rotate="-45deg" />;
    case "forward":
      return <Chevron size={size} color={color} stroke={stroke} rotate="135deg" />;
    case "up":
      return <Chevron size={size} color={color} stroke={stroke} rotate="45deg" />;
    case "down":
      return <Chevron size={size} color={color} stroke={stroke} rotate="-135deg" />;

    case "plus":
      return <Plus size={size} color={color} stroke={stroke} />;
    case "close":
      return <Close size={size} color={color} stroke={stroke} />;
    case "check":
      return <Check size={size} color={color} stroke={stroke} />;
    case "download":
      return <Download size={size} color={color} stroke={stroke} />;
    case "calendar":
      return <Calendar size={size} color={color} stroke={stroke} />;
    case "sun":
      return <Sun size={size} color={color} />;
    case "moon":
      return <Moon size={size} color={color} />;
    case "dot":
      return (
        <View
          style={{
            width: size * 0.5,
            height: size * 0.5,
            borderRadius: size,
            backgroundColor: color,
          }}
        />
      );
    case "cash":
      return (
        <View style={[styles.glyphBox, { width: size, height: size }]}>
          <Text style={{ color, fontWeight: "800", fontSize: size * 0.85, lineHeight: size * 0.95 }}>$</Text>
        </View>
      );
    case "trash":
      return <Trash size={size} color={color} stroke={stroke} />;
    case "clock":
      return <Clock size={size} color={color} stroke={stroke} />;
    case "filter":
      return <Filter size={size} color={color} stroke={stroke} />;
    case "cart":
      return <Cart size={size} color={color} stroke={stroke} />;
    case "chart":
      return <Chart size={size} color={color} stroke={stroke} />;

    default:
      return null;
  }
};

// ───────────────── Primitives ─────────────────

const Chevron: React.FC<{ size: number; color: string; stroke: number; rotate: string }> = ({
  size,
  color,
  stroke,
  rotate,
}) => {
  const inner = size * 0.55;
  return (
    <View style={[styles.glyphBox, { width: size, height: size }]}>
      <View
        style={{
          width: inner,
          height: inner,
          borderTopWidth: stroke,
          borderLeftWidth: stroke,
          borderColor: color,
          transform: [{ rotate }],
        }}
      />
    </View>
  );
};

const Plus: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => {
  const len = size * 0.7;
  return (
    <View style={[styles.glyphBox, { width: size, height: size }]}>
      <View style={[styles.absCenter, { width: len, height: stroke, backgroundColor: color, borderRadius: stroke / 2 }]} />
      <View style={[styles.absCenter, { width: stroke, height: len, backgroundColor: color, borderRadius: stroke / 2 }]} />
    </View>
  );
};

const Close: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => {
  const len = size * 0.7;
  return (
    <View style={[styles.glyphBox, { width: size, height: size }]}>
      <View
        style={[
          styles.absCenter,
          { width: len, height: stroke, backgroundColor: color, borderRadius: stroke / 2, transform: [{ rotate: "45deg" }] },
        ]}
      />
      <View
        style={[
          styles.absCenter,
          { width: len, height: stroke, backgroundColor: color, borderRadius: stroke / 2, transform: [{ rotate: "-45deg" }] },
        ]}
      />
    </View>
  );
};

const Check: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => {
  // Two short lines forming a checkmark
  const short = size * 0.35;
  const long = size * 0.6;
  return (
    <View style={[styles.glyphBox, { width: size, height: size }]}>
      <View
        style={{
          position: "absolute",
          left: size * 0.18,
          top: size * 0.5,
          width: short,
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke / 2,
          transform: [{ rotate: "45deg" }],
          transformOrigin: "left center",
        } as any}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.35,
          top: size * 0.7,
          width: long,
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke / 2,
          transform: [{ rotate: "-50deg" }],
          transformOrigin: "left center",
        } as any}
      />
    </View>
  );
};

const Download: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => {
  // Down arrow + tray
  const arrowH = size * 0.55;
  const headW = size * 0.45;
  return (
    <View style={[styles.glyphBox, { width: size, height: size }]}>
      {/* shaft */}
      <View
        style={{
          position: "absolute",
          left: size / 2 - stroke / 2,
          top: size * 0.05,
          width: stroke,
          height: arrowH,
          backgroundColor: color,
          borderRadius: stroke / 2,
        }}
      />
      {/* arrowhead left */}
      <View
        style={{
          position: "absolute",
          left: size / 2 - headW / 2,
          top: size * 0.35,
          width: headW / 2 + stroke / 2,
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke / 2,
          transform: [{ rotate: "45deg" }],
          transformOrigin: "right center",
        } as any}
      />
      {/* arrowhead right */}
      <View
        style={{
          position: "absolute",
          left: size / 2 - stroke / 2,
          top: size * 0.35,
          width: headW / 2 + stroke / 2,
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke / 2,
          transform: [{ rotate: "-45deg" }],
          transformOrigin: "left center",
        } as any}
      />
      {/* tray */}
      <View
        style={{
          position: "absolute",
          bottom: size * 0.05,
          left: size * 0.15,
          width: size * 0.7,
          height: stroke,
          backgroundColor: color,
          borderRadius: stroke / 2,
        }}
      />
    </View>
  );
};

const Calendar: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => {
  return (
    <View
      style={[
        styles.glyphBox,
        {
          width: size,
          height: size,
          borderWidth: stroke,
          borderColor: color,
          borderRadius: 3,
        },
      ]}
    >
      {/* hanger lines */}
      <View style={{ position: "absolute", top: -stroke, left: size * 0.2, width: stroke, height: size * 0.2, backgroundColor: color }} />
      <View style={{ position: "absolute", top: -stroke, right: size * 0.2, width: stroke, height: size * 0.2, backgroundColor: color }} />
      {/* top divider */}
      <View style={{ position: "absolute", top: size * 0.28, left: 0, right: 0, height: stroke, backgroundColor: color }} />
    </View>
  );
};

const Sun: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <View style={[styles.glyphBox, { width: size, height: size }]}>
    <View
      style={{
        width: size * 0.55,
        height: size * 0.55,
        borderRadius: size,
        backgroundColor: color,
      }}
    />
  </View>
);

const Moon: React.FC<{ size: number; color: string }> = ({ size, color }) => (
  <View style={[styles.glyphBox, { width: size, height: size, overflow: "hidden" }]}>
    <View
      style={{
        width: size * 0.8,
        height: size * 0.8,
        borderRadius: size,
        borderWidth: size * 0.18,
        borderColor: color,
        borderRightColor: "transparent",
        borderBottomColor: "transparent",
        transform: [{ rotate: "-45deg" }],
      }}
    />
  </View>
);

const Trash: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => (
  <View style={[styles.glyphBox, { width: size, height: size }]}>
    {/* lid */}
    <View
      style={{
        position: "absolute",
        top: size * 0.18,
        left: size * 0.1,
        right: size * 0.1,
        height: stroke,
        backgroundColor: color,
        borderRadius: stroke / 2,
      }}
    />
    {/* handle */}
    <View
      style={{
        position: "absolute",
        top: size * 0.08,
        left: size * 0.32,
        right: size * 0.32,
        height: size * 0.12,
        borderTopWidth: stroke,
        borderLeftWidth: stroke,
        borderRightWidth: stroke,
        borderColor: color,
        borderTopLeftRadius: 2,
        borderTopRightRadius: 2,
      }}
    />
    {/* body */}
    <View
      style={{
        position: "absolute",
        top: size * 0.32,
        left: size * 0.2,
        right: size * 0.2,
        bottom: size * 0.08,
        borderLeftWidth: stroke,
        borderRightWidth: stroke,
        borderBottomWidth: stroke,
        borderColor: color,
        borderBottomLeftRadius: 3,
        borderBottomRightRadius: 3,
      }}
    />
  </View>
);

const Clock: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => (
  <View style={[styles.glyphBox, { width: size, height: size }]}>
    <View style={{ width: size * 0.85, height: size * 0.85, borderRadius: size, borderWidth: stroke, borderColor: color }} />
    {/* minute hand pointing up */}
    <View style={{ position: "absolute", width: stroke, height: size * 0.3, backgroundColor: color, top: size * 0.2, borderRadius: stroke / 2 }} />
    {/* hour hand pointing right */}
    <View style={{ position: "absolute", width: size * 0.22, height: stroke, backgroundColor: color, left: size * 0.5, borderRadius: stroke / 2 }} />
  </View>
);

const Filter: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => (
  <View style={[styles.glyphBox, { width: size, height: size }]}>
    <View style={{ position: "absolute", top: size * 0.2, left: size * 0.1, right: size * 0.1, height: stroke, backgroundColor: color, borderRadius: stroke / 2 }} />
    <View style={{ position: "absolute", top: size * 0.46, left: size * 0.22, right: size * 0.22, height: stroke, backgroundColor: color, borderRadius: stroke / 2 }} />
    <View style={{ position: "absolute", top: size * 0.72, left: size * 0.36, right: size * 0.36, height: stroke, backgroundColor: color, borderRadius: stroke / 2 }} />
  </View>
);

const Cart: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => (
  <View style={[styles.glyphBox, { width: size, height: size }]}>
    {/* basket */}
    <View style={{
      position: "absolute", top: size * 0.3, left: size * 0.18, right: size * 0.08,
      height: size * 0.4, borderWidth: stroke, borderColor: color, borderRadius: stroke,
    }} />
    {/* handle */}
    <View style={{
      position: "absolute", top: size * 0.18, left: size * 0.04, width: size * 0.2,
      height: stroke, backgroundColor: color, borderRadius: stroke / 2, transform: [{ rotate: "-15deg" }],
    }} />
    {/* wheel 1 */}
    <View style={{ position: "absolute", bottom: size * 0.04, left: size * 0.28, width: size * 0.16, height: size * 0.16, borderRadius: size, borderWidth: stroke, borderColor: color }} />
    {/* wheel 2 */}
    <View style={{ position: "absolute", bottom: size * 0.04, right: size * 0.12, width: size * 0.16, height: size * 0.16, borderRadius: size, borderWidth: stroke, borderColor: color }} />
  </View>
);

const Chart: React.FC<{ size: number; color: string; stroke: number }> = ({ size, color, stroke }) => (
  <View style={[styles.glyphBox, { width: size, height: size }]}>
    <View style={{ position: "absolute", bottom: size * 0.1, left: size * 0.08, right: size * 0.08, height: stroke, backgroundColor: color, borderRadius: stroke / 2 }} />
    <View style={{ position: "absolute", top: size * 0.1, bottom: size * 0.1, left: size * 0.08, width: stroke, backgroundColor: color, borderRadius: stroke / 2 }} />
    <View style={{ position: "absolute", left: size * 0.22, bottom: size * 0.13, width: size * 0.13, height: size * 0.3, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ position: "absolute", left: size * 0.42, bottom: size * 0.13, width: size * 0.13, height: size * 0.55, backgroundColor: color, borderRadius: 1 }} />
    <View style={{ position: "absolute", left: size * 0.62, bottom: size * 0.13, width: size * 0.13, height: size * 0.4, backgroundColor: color, borderRadius: 1 }} />
  </View>
);


const styles = StyleSheet.create({
  glyphBox: { alignItems: "center", justifyContent: "center" },
  absCenter: { position: "absolute" },
});

export default AppIcon;
