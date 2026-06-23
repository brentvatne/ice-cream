import { Ionicons } from '@expo/vector-icons';
import {
  label,
  secondaryLabel,
  secondarySystemGroupedBackground,
  separator,
  tertiaryLabel,
  tertiarySystemFill,
} from '@bacons/apple-colors';
import { Image } from 'expo-image';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { treatImages } from '@/assets/treatImages';
import { formatDistance } from '@/lib/distance';
import { FlavourList, type Location } from '@/model';

const THUMB_SIZE = 44;
const ROW_PADDING = 14;
// Thumbnails sit under the name, which starts at the row's left padding.
const TEXT_INSET = ROW_PADDING;
// Cap the strip so a vendor with many treats doesn't overflow the row width
// (thumbs + "+N" chip must fit beside the trailing distance/chevron); the rest
// are summarised in a "+N" chip.
const MAX_THUMBS = 4;
const PLACEHOLDER_IMAGE = require('@/assets/treat-placeholder.png');

export function LocationRow({
  location,
  distanceKm,
  onPress,
  first = false,
  last = false,
}: {
  location: Location;
  distanceKm: number;
  onPress: () => void;
  first?: boolean;
  last?: boolean;
}) {
  const treats = FlavourList.filter((f) => f.location === location.id);
  const shown = treats.slice(0, MAX_THUMBS);
  const overflow = treats.length - shown.length;
  const treatNames = treats.map((t) => t.name).join(', ');
  const distance = formatDistance(distanceKm);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        first && styles.firstRow,
        last && styles.lastRow,
        pressed && styles.rowPressed,
      ]}>
      <View style={styles.rowText}>
        <Text style={styles.title} numberOfLines={1}>
          {location.name}
        </Text>
        {treatNames ? (
          <Text style={styles.subtitle} numberOfLines={2}>
            {treatNames}
          </Text>
        ) : null}
        {shown.length > 0 ? (
          <View style={styles.thumbRow}>
            {shown.map((treat) => (
              <Image
                key={treat.id}
                source={treatImages[treat.id] ?? PLACEHOLDER_IMAGE}
                style={styles.thumb}
                contentFit="cover"
                transition={150}
              />
            ))}
            {overflow > 0 ? (
              <View style={[styles.thumb, styles.moreThumb]}>
                <Text style={styles.moreText}>+{overflow}</Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </View>
      <View style={styles.trailing}>
        {distance ? <Text style={styles.distance}>{distance}</Text> : null}
        <Ionicons name="chevron-forward" size={16} color={tertiaryLabel} />
      </View>
    </Pressable>
  );
}

export function LocationRowSeparator() {
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
    paddingVertical: 10,
    paddingHorizontal: ROW_PADDING,
    backgroundColor: secondarySystemGroupedBackground,
  },
  rowPressed: { opacity: 0.6 },
  firstRow: { borderTopLeftRadius: 10, borderTopRightRadius: 10 },
  lastRow: { borderBottomLeftRadius: 10, borderBottomRightRadius: 10 },
  rowText: { flex: 1, marginRight: 8, gap: 8 },
  title: { fontSize: 17, color: label },
  subtitle: { fontSize: 13, color: secondaryLabel },
  thumbRow: { flexDirection: 'row', gap: 6 },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, borderRadius: 8 },
  moreThumb: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: tertiarySystemFill,
  },
  moreText: { fontSize: 13, fontWeight: '600', color: secondaryLabel },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  distance: { fontSize: 14, color: secondaryLabel },
  separatorWrap: { backgroundColor: secondarySystemGroupedBackground },
  separatorLine: {
    height: StyleSheet.hairlineWidth,
    marginLeft: TEXT_INSET,
    backgroundColor: separator,
  },
});
