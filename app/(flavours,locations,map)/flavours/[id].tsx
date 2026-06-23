import { label, link, secondaryLabel, systemGroupedBackground } from '@bacons/apple-colors';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';

import { treatImages } from '@/assets/treatImages';
import { useFavourites } from '@/context/FavouritesContext';
import { FlavourList, LocationList } from '@/model';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const PLACEHOLDER_IMAGE = require('@/assets/treat-placeholder.png');

export default function FlavourDetails() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const { isFavourite, isTasted, toggleFavourite, toggleTasted } = useFavourites();

  const flavour = FlavourList.find((item) => item.id === Number(id));
  const location = LocationList.find((item) => item.id === flavour?.location);
  const flavourId = Number(id);
  const image = treatImages[flavourId];

  const heroHeight = Math.min(windowWidth, 300);
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  // Stretchy / parallax hero:
  // - Overscroll (scrollY < 0, user pulling down): grow the image from the top
  //   edge. scale = 1 + (-scrollY / heroHeight) widens it; translateY = scrollY
  //   (a negative value) shifts it back up so its top stays pinned to the screen
  //   top instead of drifting down as it scales about its center.
  // - Normal upward scroll (scrollY > 0): translate at half speed for parallax.
  const heroStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    if (y < 0) {
      return {
        transform: [{ translateY: y }, { scale: 1 + -y / heroHeight }],
      };
    }
    return {
      transform: [{ translateY: y * 0.5 }],
    };
  });

  if (!flavour) {
    return (
      <View style={styles.screen}>
        <Text style={styles.notFound}>Flavour not found</Text>
      </View>
    );
  }

  const dateRange = `${formatDate(flavour.startDate)} to ${formatDate(flavour.endDate)}`;

  return (
    <>
      <Stack.Screen options={{ title: '' }} />
      <Animated.ScrollView
        style={styles.screen}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={styles.content}>
        <AnimatedImage
          source={image ?? PLACEHOLDER_IMAGE}
          style={[{ width: windowWidth, height: heroHeight }, heroStyle]}
          contentFit="cover"
          transition={200}
        />

        <View style={styles.body}>
          {location ? (
            <Pressable
              accessibilityRole="link"
              hitSlop={8}
              onPress={() =>
                router.push(`/locations/${location.id}?title=${encodeURIComponent(location.name)}`)
              }>
              <Text style={styles.locationLink}>{location.name}</Text>
            </Pressable>
          ) : null}

          <View style={styles.titleRow}>
            <Text style={styles.title}>{flavour.name}</Text>
            <View style={styles.toggles}>
              <Pressable hitSlop={8} onPress={() => toggleFavourite(flavourId)}>
                <Ionicons
                  name={isFavourite(flavourId) ? 'star' : 'star-outline'}
                  size={24}
                  color={isFavourite(flavourId) ? '#FFD700' : secondaryLabel}
                />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => toggleTasted(flavourId)}>
                <Ionicons
                  name={isTasted(flavourId) ? 'checkmark-circle' : 'checkmark-circle-outline'}
                  size={24}
                  color={isTasted(flavourId) ? '#007AFF' : secondaryLabel}
                />
              </Pressable>
            </View>
          </View>

          <Text style={styles.meta}>{dateRange}</Text>

          <View style={styles.priceRow}>
            {flavour.price ? <Text style={styles.meta}>{flavour.price}</Text> : null}
            {flavour.stamps ? (
              <Text style={styles.meta}>
                {`🎟 ${flavour.stamps} stamp${flavour.stamps === 1 ? '' : 's'}`}
              </Text>
            ) : null}
          </View>

          <Text style={styles.description}>{flavour.description}</Text>
        </View>
      </Animated.ScrollView>
    </>
  );
}

function formatDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: systemGroupedBackground },
  content: { paddingBottom: 32 },
  notFound: { padding: 16, color: label },
  body: {
    paddingHorizontal: 20,
    paddingBottom: 20,
    top: -30,
    gap: 8,
    backgroundColor: systemGroupedBackground,
  },
  locationLink: { fontSize: 17, color: link },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: { flex: 1, fontSize: 26, fontWeight: 'bold', color: label },
  toggles: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  meta: { fontSize: 14, color: secondaryLabel },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  description: { fontSize: 16, color: label, paddingTop: 8 },
});
