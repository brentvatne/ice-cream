import {
  label,
  link,
  secondaryLabel,
  systemGray5,
  systemGroupedBackground,
} from '@bacons/apple-colors';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
// Vendored by expo-router (it bundles react-navigation rather than exposing it
// as a separate dependency); gives the real header height incl. the safe-area
// inset, so we don't hardcode a nav-bar constant.
import { useHeaderHeight } from 'expo-router/build/react-navigation/elements';

import { treatImages } from '@/assets/treatImages';
import { ImageLightbox, type Rect } from '@/components/ImageLightbox';
import { TOOLBAR_DICE_ICON } from '@/components/icons';
import { useFavourites } from '@/context/FavouritesContext';
import { useShake } from '@/lib/useShake';
import { FlavourList, LocationList } from '@/model';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const PLACEHOLDER_IMAGE = require('@/assets/treat-placeholder.png');

export default function FlavourDetails() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { width: windowWidth } = useWindowDimensions();
  const headerHeight = useHeaderHeight();
  const { isFavourite, isTasted, toggleFavourite, toggleTasted } = useFavourites();

  const flavour = FlavourList.find((item) => item.id === Number(id));
  const location = LocationList.find((item) => item.id === flavour?.location);
  const flavourId = Number(id);
  const image = treatImages[flavourId];
  const heroSource = image ?? PLACEHOLDER_IMAGE;
  const hasImage = Boolean(image);

  const heroRef = useRef<View>(null);
  const [viewer, setViewer] = useState<{ visible: boolean; origin: Rect | null }>({
    visible: false,
    origin: null,
  });

  const heroHeight = Math.min(windowWidth, 300);
  const scrollY = useSharedValue(0);

  const openViewer = () => {
    heroRef.current?.measureInWindow((x, y, width, height) => {
      // The Pressable has no transform, but the inner image is parallax-shifted
      // by `heroStyle` once scrolled. Mirror that here so the lightbox starts
      // from the image's actual on-screen position, not its layout box.
      const s = scrollY.value;
      // Mirror the hero's on-screen shift: parallax half-speed when scrolled up;
      // during overscroll the image only scales (no translate), so no offset.
      const parallaxY = s > 0 ? s * 0.5 : 0;
      setViewer({ visible: true, origin: { x, y: y + parallaxY, width, height } });
    });
  };

  const scrollHandler = useAnimatedScrollHandler((event) => {
    scrollY.value = event.contentOffset.y;
  });

  // Stretchy / parallax hero:
  // - Overscroll (scrollY < 0, user pulling down): scale up anchored at the
  //   BOTTOM edge (see `transformOrigin` on the image). The bottom stays glued
  //   to the body/text — which scrolls down with the overscroll — while the
  //   image grows upward to fill the opening gap under the nav bar. (Scaling
  //   about the center let the bottom lag the text, opening a growing gap.)
  // - Normal upward scroll (scrollY > 0): translate at half speed for parallax;
  //   the opaque body slides up over the image, so nothing shows underneath.
  const heroStyle = useAnimatedStyle(() => {
    const y = scrollY.value;
    if (y < 0) {
      return {
        transform: [{ scale: 1 + -y / heroHeight }],
      };
    }
    return {
      transform: [{ translateY: y * 0.5 }],
    };
  });

  // Jump to a different random treat — used by the dice button and shake.
  // `replace` so repeated rolls don't stack; back still returns to the list.
  const rollRandom = useCallback(() => {
    const pool = FlavourList.filter((item) => item.id !== flavourId);
    if (pool.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    router.replace(`/flavours/${pick.id}`);
  }, [flavourId, router]);

  useShake(rollRandom);

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
      <Stack.Screen
        options={{
          // `title` feeds the back-button label and accessibility; the visible
          // header title is the fading component below.
          title: flavour.name,
          // Float the header over the content so the hero bleeds to the very top
          // of the screen, under the status/nav bar — not only on devices where
          // the shared preset enables this for liquid glass.
          headerTransparent: true,
          headerTitle: () => (
            <HeaderTitle scrollY={scrollY} heroHeight={heroHeight} name={flavour.name} />
          ),
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon={TOOLBAR_DICE_ICON} tintColor="#007AFF" onPress={rollRandom} />
      </Stack.Toolbar>
      <Animated.ScrollView
        style={styles.screen}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={styles.content}>
        {hasImage ? (
          <Pressable ref={heroRef} onPress={openViewer} accessibilityLabel="View full image">
            <AnimatedImage
              source={heroSource}
              // transformOrigin bottom: the overscroll stretch grows the image
              // upward from its bottom edge, keeping that edge glued to the body.
              style={[
                { width: windowWidth, height: heroHeight, transformOrigin: '50% 100%' },
                heroStyle,
              ]}
              contentFit="cover"
              // Bias the crop downward so the subject sits a little below the box
              // center, clear of the translucent nav bar overlapping the top.
              contentPosition={{ top: '30%' }}
              transition={200}
            />
          </Pressable>
        ) : (
          <Animated.View
            style={[
              styles.placeholderHero,
              // Pad past the header so the centered emoji sits in the visible
              // area, not behind the translucent header overlapping the top.
              {
                width: windowWidth,
                height: heroHeight,
                paddingTop: headerHeight,
                transformOrigin: '50% 100%',
              },
              heroStyle,
            ]}>
            <Text style={styles.placeholderEmoji}>🍦</Text>
          </Animated.View>
        )}

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

      <ImageLightbox
        visible={viewer.visible}
        source={heroSource}
        origin={viewer.origin}
        onClose={() => setViewer({ visible: false, origin: null })}
      />
    </>
  );
}

function formatDate(isoDate: string) {
  return new Date(isoDate).toLocaleDateString();
}

// Nav-bar title that fades in as the hero scrolls out of view, so the flavour
// name lands in the (transparent/glass) header right as its large copy in the
// body slides up under it — the standard iOS detail-screen handoff.
function HeaderTitle({
  scrollY,
  heroHeight,
  name,
}: {
  scrollY: SharedValue<number>;
  heroHeight: number;
  name: string;
}) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(
      scrollY.value,
      [heroHeight - 80, heroHeight - 30],
      [0, 1],
      Extrapolation.CLAMP
    ),
  }));
  return (
    <Animated.Text numberOfLines={1} style={[styles.headerTitle, style]}>
      {name}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: systemGroupedBackground },
  content: { paddingBottom: 32 },
  notFound: { padding: 16, color: label },
  body: {
    paddingHorizontal: 20,
    paddingVertical: 20,
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
  placeholderHero: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: systemGray5,
  },
  placeholderEmoji: { fontSize: 72 },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: label,
    maxWidth: 220,
    textAlign: 'center',
  },
});
