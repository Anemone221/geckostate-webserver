// usePopoverTrigger.ts
// Shared hover-trigger logic for portal popovers (MarketDepth, ProfitBreakdown,
// CapitalBreakdown). Handles open/close delays, viewport-aware positioning, and
// the "opensUp" flip when the trigger is near the bottom of the screen.

import { useState, useRef, useCallback } from 'react';
import {
  POPOVER_OPEN_DELAY_MS,
  POPOVER_CLOSE_DELAY_MS,
  POPOVER_MIN_SPACE_PX,
  POPOVER_GAP_PX,
} from '../lib/constants';

type Anchor = 'left' | 'right';

export interface PopoverPosition {
  top: number;
  left?: number;
  right?: number;
}

export interface PopoverTrigger {
  hovered:            boolean;
  pos:                PopoverPosition | null;
  opensUp:            boolean;
  triggerRef:         React.RefObject<HTMLDivElement>;
  handleTriggerEnter: () => void;
  handleTriggerLeave: () => void;
  cancelClose:        () => void;
  scheduleClose:      () => void;
}

/**
 * Returns all the state and handlers needed for a hover-triggered popover.
 *
 * @param anchor — `'left'` positions the popover at the trigger's left edge,
 *                 `'right'` positions it flush-right relative to the viewport.
 */
export function usePopoverTrigger(anchor: Anchor = 'left'): PopoverTrigger {
  const [hovered, setHovered] = useState(false);
  const [pos, setPos]         = useState<PopoverPosition | null>(null);
  const openTimeoutRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimeoutRef       = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef            = useRef<HTMLDivElement>(null!);  // non-null assertion for React ref compat

  const cancelClose = useCallback(() => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimeoutRef.current = setTimeout(() => {
      setHovered(false);
      setPos(null);
    }, POPOVER_CLOSE_DELAY_MS);
  }, [cancelClose]);

  const handleTriggerEnter = useCallback(() => {
    cancelClose();
    openTimeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const topVal = spaceBelow < POPOVER_MIN_SPACE_PX
          ? rect.top - POPOVER_GAP_PX
          : rect.bottom + POPOVER_GAP_PX;

        if (anchor === 'right') {
          setPos({ top: topVal, right: window.innerWidth - rect.right });
        } else {
          setPos({ top: topVal, left: rect.left });
        }
      }
      setHovered(true);
    }, POPOVER_OPEN_DELAY_MS);
  }, [cancelClose, anchor]);

  const handleTriggerLeave = useCallback(() => {
    if (openTimeoutRef.current) {
      clearTimeout(openTimeoutRef.current);
      openTimeoutRef.current = null;
    }
    scheduleClose();
  }, [scheduleClose]);

  const opensUp = pos != null && triggerRef.current != null
    && pos.top < triggerRef.current.getBoundingClientRect().top;

  return {
    hovered,
    pos,
    opensUp,
    triggerRef,
    handleTriggerEnter,
    handleTriggerLeave,
    cancelClose,
    scheduleClose,
  };
}
