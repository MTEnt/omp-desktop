import { useEffect, useRef, useState } from "react";

/**
 * Reveal `target` smoothly while `active`. Catches up faster when behind,
 * snaps when inactive or when the user prefers reduced motion.
 */
export const useSmoothText = (target: string, active: boolean): string => {
  const [shown, setShown] = useState(target);
  const shownRef = useRef(target);
  const targetRef = useRef(target);

  useEffect(() => {
    targetRef.current = target;
    if (!active) {
      shownRef.current = target;
      setShown(target);
    }
  }, [target, active]);

  useEffect(() => {
    if (!active) return;

    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      shownRef.current = targetRef.current;
      setShown(targetRef.current);
      return;
    }

    let raf = 0;
    let last = performance.now();

    const tick = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      const goal = targetRef.current;
      let current = shownRef.current;

      if (current.length > goal.length || !goal.startsWith(current)) {
        // Target rewound or replaced — snap forward.
        current = goal;
      } else if (current.length < goal.length) {
        const backlog = goal.length - current.length;
        // chars/sec: slow when nearly caught up, faster when lagging
        const cps = backlog > 120 ? 140 : backlog > 48 ? 72 : backlog > 16 ? 42 : 28;
        const take = Math.max(1, Math.ceil((cps * dt) / 1000));
        current = goal.slice(0, current.length + take);
      }

      if (current !== shownRef.current) {
        shownRef.current = current;
        setShown(current);
        window.dispatchEvent(new Event("omp-desktop:stream-tick"));
      }

      raf = requestAnimationFrame(tick);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);

  return active ? shown : target;
};
