import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { Image as RNImage, Modal, Pressable, StyleSheet, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

const AnimatedImage = Animated.createAnimatedComponent(Image);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

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

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(0.5, savedScale.value * e.scale);
    })
    .onEnd(() => {
      if (scale.value < 1) {
        resetZoom();
      } else {
        savedScale.value = scale.value;
      }
    });

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      if (scale.value > 1) {
        // Panning around the zoomed image.
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
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
        dismiss.value = withTiming(dir * screenHeight, { duration: 220 }, (finished) => {
          if (finished) scheduleOnRN(onClose);
        });
      } else {
        dismiss.value = withSpring(0);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        resetZoom();
      } else {
        scale.value = withTiming(2);
        savedScale.value = 2;
      }
    });

  const gesture = Gesture.Simultaneous(pan, pinch, doubleTap);

  // Fades from 1 (centered) to 0 as the image is swiped a full screen height away.
  const dismissFade = () => {
    'worklet';
    return 1 - Math.min(Math.abs(dismiss.value) / screenHeight, 1);
  };

  const backdropStyle = useAnimatedStyle(() => {
    return { opacity: progress.value * dismissFade() * viewerOpacity.value };
  });

  // The X button shares the backdrop's fade so it appears with the hero and
  // disappears on every close path.
  const chromeStyle = useAnimatedStyle(() => {
    return { opacity: progress.value * dismissFade() * viewerOpacity.value };
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
    return {
      position: 'absolute',
      opacity: Math.min(p / 0.15, 1) * dismissFade() * viewerOpacity.value,
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
          <Ionicons name="close" size={22} color="#fff" />
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
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
  },
});
