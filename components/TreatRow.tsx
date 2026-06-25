import { Ionicons } from '@expo/vector-icons';
import {
  label,
  secondaryLabel,
  secondarySystemGroupedBackground,
  separator,
  tertiaryLabel,
} from '@bacons/apple-colors';
import { Image } from 'expo-image';
import { type Href, Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { treatImages } from '@/assets/treatImages';
import { type Flavour, LocationList } from '@/model';

const THUMB_SIZE = 54;
const ROW_PADDING = 14;
const TEXT_INSET = ROW_PADDING + THUMB_SIZE + 12;
const PLACEHOLDER_IMAGE = require('@/assets/treat-placeholder.png');

function buildSubtitles(flavour: Flavour, showVendor: boolean): [string, string] {
  // Line 1: vendor · price. Line 2: stamps · dietary tags.
  const primary: string[] = [];
  if (showVendor) {
    const vendor = LocationList.find((l) => l.id === flavour.location)?.name;
    if (vendor) primary.push(vendor);
  }
  if (flavour.price) primary.push(flavour.price);

  const secondary: string[] = [];
  if (flavour.stamps) secondary.push(`🎟 ${flavour.stamps}`);
  if (flavour.tags.length > 0) secondary.push(flavour.tags.join(', '));

  return [primary.join('  ·  '), secondary.join('  ·  ')];
}

export function TreatRow({
  flavour,
  href,
  showVendor = false,
  first = false,
  last = false,
}: {
  flavour: Flavour;
  href: Href;
  showVendor?: boolean;
  first?: boolean;
  last?: boolean;
}) {
  const [primaryInfo, secondaryInfo] = buildSubtitles(flavour, showVendor);

  return (
    <Link href={href} asChild>
      <Pressable style={({ pressed }) => pressed && styles.rowPressed}>
        {/* Wrap the whole row as the zoom source so it grows into the
            flavour-detail hero on iOS 18+ (no-op fallback elsewhere). The
            native zoom view only accepts a single child and doesn't behave as a
            flex child itself, so it must wrap the entire row — not sit inside it
            beside the text, which collapses the horizontal layout. */}
        <Link.AppleZoom>
          {/* AppleZoom needs exactly one *native* child view. `collapsable={false}`
              stops RN from flattening this row View away (otherwise the native
              zoom view sees the wrong children and paints nothing). Slot also
              requires a single flattened style object, not a style array. */}
          <View
            collapsable={false}
            style={StyleSheet.flatten([
              styles.row,
              first && styles.firstRow,
              last && styles.lastRow,
            ])}>
            <Image
              source={treatImages[flavour.id] ?? PLACEHOLDER_IMAGE}
              style={styles.thumb}
              contentFit="cover"
              transition={150}
            />
            <View style={styles.rowText}>
              <Text style={styles.title} numberOfLines={2}>
                {flavour.name}
              </Text>
              {primaryInfo ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {primaryInfo}
                </Text>
              ) : null}
              {secondaryInfo ? (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {secondaryInfo}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color={tertiaryLabel} />
          </View>
        </Link.AppleZoom>
      </Pressable>
    </Link>
  );
}

export function TreatRowSeparator() {
  return (
    <View style={styles.separatorWrap}>
      <View style={styles.separatorLine} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: ROW_PADDING,
    backgroundColor: secondarySystemGroupedBackground,
  },
  rowPressed: { opacity: 0.6 },
  firstRow: { borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  lastRow: { borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 10 },
  rowText: { flex: 1, marginLeft: 12, marginRight: 8 },
  title: { fontSize: 17, color: label },
  subtitle: { fontSize: 13, color: secondaryLabel, marginTop: 2 },
  separatorWrap: { backgroundColor: secondarySystemGroupedBackground },
  separatorLine: {
    height: StyleSheet.hairlineWidth,
    marginLeft: TEXT_INSET,
    backgroundColor: separator,
  },
});
