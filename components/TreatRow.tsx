import { Ionicons } from '@expo/vector-icons';
import {
  label,
  secondaryLabel,
  secondarySystemGroupedBackground,
  separator,
  tertiaryLabel,
} from '@bacons/apple-colors';
import { Image } from 'expo-image';
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
  onPress,
  showVendor = false,
  first = false,
  last = false,
}: {
  flavour: Flavour;
  onPress: () => void;
  showVendor?: boolean;
  first?: boolean;
  last?: boolean;
}) {
  const [primaryInfo, secondaryInfo] = buildSubtitles(flavour, showVendor);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first && styles.firstRow,
        last && styles.lastRow,
        pressed && styles.rowPressed,
      ]}>
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
    </Pressable>
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
