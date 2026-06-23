import { useFocusEffect } from 'expo-router';
import { Accelerometer } from 'expo-sensors';
import { useCallback, useRef } from 'react';

type Options = {
  /** Acceleration magnitude (in g) above which a spike registers. ~1 at rest. */
  threshold?: number;
  /** How many distinct spikes are needed to count as an intentional shake. */
  requiredSpikes?: number;
  /** Spikes must all land within this window (ms) to count toward a shake. */
  spikeWindowMs?: number;
  /** Minimum gap between triggers, so one shake fires `onShake` at most once. */
  cooldownMs?: number;
};

// Shared across every useShake instance. The cooldown must be GLOBAL, not
// per-component: if a shake fires on one screen and navigates to another, the
// newly-mounted screen's hook would otherwise start with a fresh (zeroed)
// cooldown and re-fire on the same continuing shake — causing the double/triple
// navigations. A module-level timestamp gates all instances against one clock.
let lastTriggerAt = 0;

/**
 * Calls `onShake` when the device is shaken, but only while the screen using
 * this hook is focused (the listener is torn down on blur to save battery and
 * to keep two screens from reacting at once).
 *
 * A real shake oscillates, so a single jolt crosses the threshold across many
 * samples. We collapse those into discrete "spikes" (a spike is one above-
 * threshold sample after a short quiet gap) and fire once `requiredSpikes` land
 * within `spikeWindowMs`. With the default `requiredSpikes` of 1 a single brisk
 * shake triggers; the debounce plus a `cooldownMs` gate (shared across all
 * instances, so it survives navigation) keep one shake from firing repeatedly.
 * Raise `requiredSpikes` to demand a more deliberate back-and-forth.
 *
 * Note: relies on real accelerometer data, so it fires on a physical device.
 * The iOS Simulator's "Shake Gesture" is a UIEvent and does not move the
 * accelerometer, so it won't trigger this.
 */
export function useShake(
  onShake: () => void,
  { threshold = 2.0, requiredSpikes = 1, spikeWindowMs = 1000, cooldownMs = 1500 }: Options = {}
) {
  const lastSpikeAt = useRef(0);
  const spikeTimes = useRef<number[]>([]);

  useFocusEffect(
    useCallback(() => {
      Accelerometer.setUpdateInterval(100);
      const subscription = Accelerometer.addListener(({ x, y, z }) => {
        // At rest the magnitude is ~1g (gravity); a shake spikes it well past that.
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude < threshold) return;

        const now = Date.now();

        // Debounce a single jolt: ignore above-threshold samples that arrive
        // back-to-back so one swing counts as one spike, not several.
        if (now - lastSpikeAt.current < 150) return;
        lastSpikeAt.current = now;

        // Keep only spikes still inside the rolling window, then record this one.
        spikeTimes.current = spikeTimes.current.filter((t) => now - t < spikeWindowMs);
        spikeTimes.current.push(now);

        if (spikeTimes.current.length < requiredSpikes) return;
        if (now - lastTriggerAt < cooldownMs) return;

        lastTriggerAt = now;
        spikeTimes.current = [];
        onShake();
      });
      return () => subscription.remove();
    }, [onShake, threshold, requiredSpikes, spikeWindowMs, cooldownMs])
  );
}
