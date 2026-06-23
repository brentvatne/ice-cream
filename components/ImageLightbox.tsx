import { Ionicons } from '@expo/vector-icons';
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Image as RNImage, Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);
const hasLiquidGlass = isLiquidGlassAvailable();

export type Rect = { x: number; y: number; width: number; height: number };

type Props = {
  /** Whether the viewer is mounted. The parent flips this false in `onClose`. */
  visible: boolean;
  /** Bundled asset (require'd number) or a remote `{ uri }`. */
  source: number | { uri: string };
  /** On-screen rect of the thumbnail, for the zoom-from-source hero transition. */
  origin: Rect | null;
  /** Called after the close animation finishes — parent should set `visible` false here. */
  onClose: () => void;
};

// Drag distance (or fling velocity) past which a swipe dismisses the viewer.
const DISMISS_DISTANCE = 120;
const DISMISS_VELOCITY = 800;
const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

export function ImageLightbox({ visible, source, origin, onClose }: Props) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const progress = useSharedValue(0); // 0 = at thumbnail, 1 = full screen
  const viewerOpacity = useSharedValue(1); // overall fade, used by the X button

  // Zoom/pan state, modelled on Software Mansion's react-native-image-zoom. The
  // pinch writes ONLY `scale` + `focal`; the pan writes ONLY `translate`. Keeping
  // them in separate shared values (summed in the transform) is what stops the
  // two gestures from fighting over one value — the root cause of the jank.
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  // Translation contributed by panning.
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  // Translation contributed by pinch-zooming about a focal point. `initialFocal`
  // is the focus at pinch-start; `focal` is the running offset that keeps that
  // point anchored as the scale changes.
  const focalX = useSharedValue(0);
  const focalY = useSharedValue(0);
  const savedFocalX = useSharedValue(0);
  const savedFocalY = useSharedValue(0);
  const initialFocalX = useSharedValue(0);
  const initialFocalY = useSharedValue(0);

  const dismiss = useSharedValue(0); // swipe-down-to-dismiss translation
  const closing = useSharedValue(false); // guards against overlapping close paths

  // Bundled assets expose their natural size synchronously, so we can fit the
  // full (uncropped) image with `contain` rather than guessing an aspect ratio.
  const resolved = typeof source === 'number' ? RNImage.resolveAssetSource(source) : null;
  const aspect = resolved?.height ? resolved.width / resolved.height : 1;

  let targetWidth = screenWidth;
  let targetHeight = screenWidth / aspect;
  if (targetHeight > screenHeight) {
    targetHeight = screenHeight;
    targetWidth = screenHeight * aspect;
  }
  const targetX = (screenWidth - targetWidth) / 2;
  const targetY = (screenHeight - targetHeight) / 2;

  // Fall back to the target rect if we somehow open without a measured origin.
  const from = origin ?? { x: targetX, y: targetY, width: targetWidth, height: targetHeight };

  useEffect(() => {
    if (!visible) return;
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    focalX.value = 0;
    focalY.value = 0;
    savedFocalX.value = 0;
    savedFocalY.value = 0;
    initialFocalX.value = 0;
    initialFocalY.value = 0;
    dismiss.value = 0;
    closing.value = false;
    viewerOpacity.value = 1;
    // Reset to 0 first: a swipe-to-dismiss leaves progress at 1, so this
    // guarantees the hero grows from the thumbnail again on every open.
    progress.value = 0;
    progress.value = withTiming(1, { duration: 280 });
  }, [visible]);

  // Plain JS function: safe to call from `onRequestClose` (JS) and, via
  // scheduleOnRN, from gesture handlers (UI thread). Animates back to the
  // thumbnail, then unmounts.
  const requestClose = () => {
    if (closing.value) return; // a dismiss is already in flight
    closing.value = true;
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    focalX.value = withTiming(0);
    focalY.value = withTiming(0);
    savedFocalX.value = 0;
    savedFocalY.value = 0;
    // Reset the swipe offset too, or the image lands off the thumbnail.
    dismiss.value = withTiming(0, { duration: 240 });
    progress.value = withTiming(0, { duration: 240 }, (finished) => {
      if (finished) scheduleOnRN(onClose);
    });
  };

  // Close used by the X button: fade everything out in place (no position or
  // hero animation), then unmount.
  const fadeClose = () => {
    if (closing.value) return;
    closing.value = true;
    viewerOpacity.value = withTiming(0, { duration: 200 }, (finished) => {
      if (finished) scheduleOnRN(onClose);
    });
  };

  const resetZoom = () => {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    translateX.value = withTiming(0);
    translateY.value = withTiming(0);
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
    focalX.value = withTiming(0);
    focalY.value = withTiming(0);
    savedFocalX.value = 0;
    savedFocalY.value = 0;
  };

  // Max pan offset that still keeps the (scaled) image covering the screen.
  // Returns 0 when the image is smaller than the screen on that axis.
  const maxOffset = (s: number) => {
    'worklet';
    return {
      x: Math.max(0, (targetWidth * s - screenWidth) / 2),
      y: Math.max(0, (targetHeight * s - screenHeight) / 2),
    };
  };

  // Settle within bounds after a pinch: fold the focal offset into the pan
  // translation and ease the total to the nearest edge. Because focal→0 and
  // translate→total animate with the same timing, the visible sum stays put
  // when already in-bounds (no snap) and only moves when it was past an edge.
  const clampToBounds = () => {
    'worklet';
    if (scale.value <= 1) {
      resetZoom();
      return;
    }
    const max = maxOffset(scale.value);
    const totalX = clamp(translateX.value + focalX.value, -max.x, max.x);
    const totalY = clamp(translateY.value + focalY.value, -max.y, max.y);
    translateX.value = withTiming(totalX);
    translateY.value = withTiming(totalY);
    focalX.value = withTiming(0);
    focalY.value = withTiming(0);
    savedScale.value = scale.value;
    savedTranslateX.value = totalX;
    savedTranslateY.value = totalY;
    savedFocalX.value = 0;
    savedFocalY.value = 0;
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      if (closing.value) return; // a close is animating; don't touch zoom state
      savedScale.value = scale.value;
      savedFocalX.value = focalX.value;
      savedFocalY.value = focalY.value;
      initialFocalX.value = e.focalX;
      initialFocalY.value = e.focalY;
    })
    .onUpdate((e) => {
      if (closing.value) return;
      const cx = screenWidth / 2;
      const cy = screenHeight / 2;
      scale.value = clamp(savedScale.value * e.scale, 1, MAX_SCALE);
      // Keep the point under the fingers at pinch-start anchored as the scale
      // changes. The exact focal formula from Software Mansion's
      // react-native-image-zoom — deliberately *unclamped* so the gesture tracks
      // the fingers freely; bounds are settled once, smoothly, in onEnd.
      focalX.value =
        savedFocalX.value + (cx - initialFocalX.value) * (scale.value - savedScale.value);
      focalY.value =
        savedFocalY.value + (cy - initialFocalY.value) * (scale.value - savedScale.value);
    })
    .onEnd(() => {
      if (closing.value) return;
      clampToBounds();
    });

  const pan = Gesture.Pan()
    // One finger only: two-finger drags belong to the pinch gesture.
    .maxPointers(1)
    .onStart(() => {
      if (closing.value) return;
      // Re-baseline from wherever the image currently sits, so the handoff from
      // a just-ended pinch is seamless.
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((e) => {
      // A close is animating (e.g. a dismiss fly-off). Writing dismiss/translate
      // here would cancel that animation's `withTiming` mid-flight — its
      // `finished` callback then never fires `onClose`, wedging the viewer open.
      if (closing.value) return;
      if (scale.value > 1) {
        // Pan the zoomed image. The bounds already include the focal offset, so
        // clamping live keeps an edge from leaving the screen with no release
        // snap. (Pure translation here never fights the focal value.)
        const max = maxOffset(scale.value);
        translateX.value = clamp(
          savedTranslateX.value + e.translationX,
          -max.x - focalX.value,
          max.x - focalX.value
        );
        translateY.value = clamp(
          savedTranslateY.value + e.translationY,
          -max.y - focalY.value,
          max.y - focalY.value
        );
      } else {
        // Swipe to dismiss.
        dismiss.value = e.translationY;
      }
    })
    .onEnd((e, success) => {
      if (closing.value) return;
      if (scale.value > 1) {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
        return;
      }
      // Commit a dismiss only on a clean release (`success`) past the threshold.
      // A cancelled/interrupted swipe (success === false) — or one that didn't
      // travel far enough — settles back instead of closing unexpectedly.
      const pastThreshold =
        Math.abs(dismiss.value) > DISMISS_DISTANCE || Math.abs(e.velocityY) > DISMISS_VELOCITY;
      if (success && pastThreshold) {
        // Ride the swipe off-screen in its own direction and fade out, rather
        // than snapping back to the thumbnail.
        closing.value = true;
        const dir = (dismiss.value !== 0 ? dismiss.value : e.velocityY) >= 0 ? 1 : -1;
        const target = dir * screenHeight;
        // Carry the release velocity: time the fly-off by how fast the finger
        // was moving (px/s) over the remaining distance, so a hard flick leaves
        // quickly and a slow drag-past-threshold eases off gently.
        const speed = Math.max(Math.abs(e.velocityY), 1);
        const duration = clamp((Math.abs(target - dismiss.value) / speed) * 1000, 120, 320);
        dismiss.value = withTiming(
          target,
          { duration, easing: Easing.out(Easing.quad) },
          (finished) => {
            if (finished) scheduleOnRN(onClose);
          }
        );
      } else {
        // Below threshold or cancelled: settle back, continuing from the velocity.
        dismiss.value = withSpring(0, { velocity: e.velocityY });
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (closing.value) return;
      if (scale.value > 1) {
        resetZoom();
        return;
      }
      // Zoom in toward the tapped point, carrying the offset in `focal` (same as
      // a pinch). Clamp so a tap near an edge can't reveal background.
      const cx = screenWidth / 2;
      const cy = screenHeight / 2;
      const max = maxOffset(DOUBLE_TAP_SCALE);
      const fx = clamp((cx - e.x) * (DOUBLE_TAP_SCALE - 1), -max.x, max.x);
      const fy = clamp((cy - e.y) * (DOUBLE_TAP_SCALE - 1), -max.y, max.y);
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      savedScale.value = DOUBLE_TAP_SCALE;
      focalX.value = withTiming(fx);
      focalY.value = withTiming(fy);
      savedFocalX.value = fx;
      savedFocalY.value = fy;
    });

  // Race, not Exclusive: all three compete and the first to *activate* wins. Two
  // fingers → pinch. One finger that stays put through two taps → doubleTap. One
  // finger that moves → pan (which dismisses at default zoom, or pans when zoomed).
  // A pan needs real movement to activate, so a stationary double-tap still wins;
  // nesting pan under Exclusive(doubleTap, …) instead made it wait out the
  // multi-tap timeout, swallowing quick swipe-to-dismiss gestures.
  const gesture = Gesture.Race(pinch, doubleTap, pan);

  // NOTE: the fade math is inlined into each useAnimatedStyle below rather than
  // shared via a helper. Reanimated derives a style's shared-value dependencies
  // from that worklet's own closure; reading `dismiss.value` inside a called
  // helper hides it from the dependency mapper, so the style would never
  // re-run when `dismiss` changes (the backdrop wouldn't fade on swipe).

  const backdropStyle = useAnimatedStyle(() => {
    const fade = 1 - Math.min(Math.abs(dismiss.value) / screenHeight, 1);
    return { opacity: progress.value * fade * viewerOpacity.value };
  });

  // The X button shares the backdrop's fade so it appears with the hero and
  // disappears on every close path.
  const chromeStyle = useAnimatedStyle(() => {
    const fade = 1 - Math.min(Math.abs(dismiss.value) / screenHeight, 1);
    return { opacity: progress.value * fade * viewerOpacity.value };
  });

  const imageStyle = useAnimatedStyle(() => {
    const p = progress.value;
    // Interpolate the layout rect from the thumbnail to the fitted full-screen
    // box. A one-shot layout animation is fine here and keeps the image
    // undistorted across the aspect-ratio change (cover thumbnail -> contain).
    //
    // The thumbnail is `cover` (cropped) and this image is `contain` (full), so
    // they can't match pixel-for-pixel at the endpoints. Fade the image in/out
    // over the first/last sliver of the transition to mask that difference and
    // to hide the reveal when the modal unmounts.
    const fade = 1 - Math.min(Math.abs(dismiss.value) / screenHeight, 1);
    return {
      position: 'absolute',
      opacity: Math.min(p / 0.15, 1) * fade * viewerOpacity.value,
      left: from.x + (targetX - from.x) * p,
      top: from.y + (targetY - from.y) * p,
      width: from.width + (targetWidth - from.width) * p,
      height: from.height + (targetHeight - from.height) * p,
      // Order matches react-native-image-zoom: pan translate, then focal
      // translate, then scale (applied right-to-left). `dismiss` rides in the
      // outer, screen-space translate.
      transform: [
        { translateX: translateX.value },
        { translateY: translateY.value + dismiss.value },
        { translateX: focalX.value },
        { translateY: focalY.value },
        { scale: scale.value },
      ],
    };
  });

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={requestClose}>
      {/* Modals render in a separate native hierarchy, so gestures need their
          own GestureHandlerRootView here. */}
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
        <GestureDetector gesture={gesture}>
          <Animated.View style={StyleSheet.absoluteFill}>
            <AnimatedImage source={source} style={imageStyle} contentFit="contain" />
          </Animated.View>
        </GestureDetector>
        {/* Rendered after the GestureDetector so it sits on top and receives the tap. */}
        <AnimatedPressable
          onPress={fadeClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Close"
          style={[styles.closeButton, { top: Math.max(insets.top, 12) + 4 }, chromeStyle]}>
          {hasLiquidGlass ? (
            <GlassView
              glassEffectStyle="regular"
              colorScheme="light"
              isInteractive
              style={StyleSheet.absoluteFill}
            />
          ) : null}
          <Ionicons name="close" size={20} color="#1c1c1e" />
        </AnimatedPressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: '#000' },
  closeButton: {
    position: 'absolute',
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden', // clip the glass bubble to a circle
    alignItems: 'center',
    justifyContent: 'center',
    // A light fill so the bubble reads on black. Over a pure-black backdrop the
    // glass has nothing to refract, so the fill is what makes the bubble (and
    // the dark icon) legible; the glass on top still adds refraction/sheen when
    // the bubble overlaps the image itself.
    backgroundColor: 'rgba(255, 255, 255, 0.55)',
  },
});
