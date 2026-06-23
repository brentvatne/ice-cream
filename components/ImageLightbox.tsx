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
  const scale = useSharedValue(1); // pinch zoom
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0); // pan while zoomed
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  // Screen-space focal point captured at the start of a pinch. The pinch math
  // keeps the image point that was under the fingers anchored beneath them as
  // the image scales, and (because the live focal is read every frame) lets a
  // two-finger drag reposition the image — the iOS Photos feel.
  const pinchOriginX = useSharedValue(0);
  const pinchOriginY = useSharedValue(0);
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
    tx.value = 0;
    ty.value = 0;
    savedTx.value = 0;
    savedTy.value = 0;
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
    tx.value = withTiming(0);
    ty.value = withTiming(0);
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
    tx.value = withTiming(0);
    ty.value = withTiming(0);
    savedTx.value = 0;
    savedTy.value = 0;
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

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      // Anchor to the gesture state at the instant the pinch begins, so the
      // update math is a pure function of how far the fingers have spread and
      // moved since — no frame-to-frame accumulation that can drift.
      savedScale.value = scale.value;
      savedTx.value = tx.value;
      savedTy.value = ty.value;
      pinchOriginX.value = e.focalX;
      pinchOriginY.value = e.focalY;
    })
    .onUpdate((e) => {
      const next = clamp(savedScale.value * e.scale, 1, MAX_SCALE);
      const ratio = next / savedScale.value;
      const cx = screenWidth / 2;
      const cy = screenHeight / 2;
      // The image scales about its center C, so a point at local offset d maps
      // to screen position C + T + s·d. Solving for the translation T that keeps
      // the point under the fingers at pinch-start fixed beneath them at the new
      // scale gives the expression below. Reading the *live* focal (e.focalX/Y)
      // each frame — rather than the start focal — also makes a two-finger drag
      // pan the image, matching iOS Photos.
      scale.value = next;
      tx.value = e.focalX - cx - ratio * (pinchOriginX.value - cx - savedTx.value);
      ty.value = e.focalY - cy - ratio * (pinchOriginY.value - cy - savedTy.value);
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        resetZoom();
        return;
      }
      savedScale.value = scale.value;
      // Snap any out-of-bounds pan (from the focal math / rubber-banding) back to
      // the edges so the image can't rest off-center.
      const max = maxOffset(scale.value);
      const nx = clamp(tx.value, -max.x, max.x);
      const ny = clamp(ty.value, -max.y, max.y);
      tx.value = withTiming(nx);
      ty.value = withTiming(ny);
      savedTx.value = nx;
      savedTy.value = ny;
    });

  const pan = Gesture.Pan()
    // One finger only: two-finger drags belong to the pinch gesture.
    .maxPointers(1)
    .onUpdate((e) => {
      if (scale.value > 1) {
        // Pan the zoomed image, clamped so its edges can't leave the screen.
        const max = maxOffset(scale.value);
        tx.value = clamp(savedTx.value + e.translationX, -max.x, max.x);
        ty.value = clamp(savedTy.value + e.translationY, -max.y, max.y);
      } else {
        // Swipe to dismiss.
        dismiss.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (scale.value > 1) {
        savedTx.value = tx.value;
        savedTy.value = ty.value;
      } else if (Math.abs(dismiss.value) > DISMISS_DISTANCE || Math.abs(e.velocityY) > DISMISS_VELOCITY) {
        // Ride the swipe off-screen in its own direction and fade out, rather
        // than snapping back to the thumbnail.
        if (closing.value) return;
        closing.value = true;
        const dir = (dismiss.value !== 0 ? dismiss.value : e.velocityY) >= 0 ? 1 : -1;
        const target = dir * screenHeight;
        // Carry the release velocity: time the fly-off by how fast the finger
        // was moving (px/s) over the remaining distance, so a hard flick leaves
        // quickly and a slow drag-past-threshold eases off gently.
        const speed = Math.max(Math.abs(e.velocityY), 1);
        const duration = clamp((Math.abs(target - dismiss.value) / speed) * 1000, 120, 320);
        dismiss.value = withTiming(target, { duration, easing: Easing.out(Easing.quad) }, (finished) => {
          if (finished) scheduleOnRN(onClose);
        });
      } else {
        // Below threshold: settle back, continuing from the gesture's velocity.
        dismiss.value = withSpring(0, { velocity: e.velocityY });
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1) {
        resetZoom();
        return;
      }
      // Zoom in toward the tapped point.
      const cx = screenWidth / 2;
      const cy = screenHeight / 2;
      const max = maxOffset(DOUBLE_TAP_SCALE);
      const nx = clamp((e.x - cx) * (1 - DOUBLE_TAP_SCALE), -max.x, max.x);
      const ny = clamp((e.y - cy) * (1 - DOUBLE_TAP_SCALE), -max.y, max.y);
      scale.value = withTiming(DOUBLE_TAP_SCALE);
      savedScale.value = DOUBLE_TAP_SCALE;
      tx.value = withTiming(nx);
      ty.value = withTiming(ny);
      savedTx.value = nx;
      savedTy.value = ny;
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);

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
      transform: [
        { translateX: tx.value },
        { translateY: ty.value + dismiss.value },
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
