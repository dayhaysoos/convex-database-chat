import { useState, useEffect, useCallback } from "react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import FingerprintJS from "@fingerprintjs/fingerprintjs";

const MESSAGE_LIMIT = 3;
const RESET_PERIOD_MS = 24 * 60 * 60 * 1000; // 24 hours
const LOCAL_STORAGE_KEY = "demo_rate_limit";

interface LocalRateLimitData {
  count: number;
  resetTime: number;
}

interface RateLimitState {
  remaining: number;
  resetTime: number;
  isLoading: boolean;
}

export function useRateLimit() {
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  const [state, setState] = useState<RateLimitState>({
    remaining: MESSAGE_LIMIT,
    resetTime: Date.now() + RESET_PERIOD_MS,
    isLoading: true,
  });

  const convexRateLimit = useQuery(
    api.rateLimit.checkRateLimit,
    fingerprint ? { fingerprint } : "skip",
  );

  // Initialize fingerprint
  useEffect(() => {
    const loadFingerprint = async () => {
      try {
        const fp = await FingerprintJS.load();
        const result = await fp.get();
        setFingerprint(result.visitorId);
      } catch {
        // Fallback to a random ID if fingerprinting fails
        const fallbackId =
          localStorage.getItem("demo_fallback_id") ||
          `fallback_${Math.random().toString(36).substring(7)}`;
        localStorage.setItem("demo_fallback_id", fallbackId);
        setFingerprint(fallbackId);
      }
    };
    loadFingerprint();
  }, []);

  // Check localStorage first, then sync with Convex
  useEffect(() => {
    const now = Date.now();

    // Check localStorage
    const localData = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (localData) {
      try {
        const parsed: LocalRateLimitData = JSON.parse(localData);
        if (now < parsed.resetTime) {
          setState({
            remaining: Math.max(0, MESSAGE_LIMIT - parsed.count),
            resetTime: parsed.resetTime,
            isLoading: false,
          });
          return;
        }
      } catch {
        // Invalid data, will be reset
      }
    }

    // Use Convex data if available
    if (convexRateLimit) {
      setState({
        remaining: convexRateLimit.remaining,
        resetTime: convexRateLimit.resetTime,
        isLoading: false,
      });

      // Sync to localStorage
      localStorage.setItem(
        LOCAL_STORAGE_KEY,
        JSON.stringify({
          count: MESSAGE_LIMIT - convexRateLimit.remaining,
          resetTime: convexRateLimit.resetTime,
        }),
      );
    } else if (fingerprint) {
      // Fingerprint loaded but no Convex data yet
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [convexRateLimit, fingerprint]);

  const canSendMessage = useCallback(() => {
    const now = Date.now();

    // Check if reset time has passed
    if (now >= state.resetTime) {
      return true;
    }

    return state.remaining > 0;
  }, [state.remaining, state.resetTime]);

  // Update local state only (server handles actual increment)
  const recordMessage = useCallback(async () => {
    const now = Date.now();
    let localData: LocalRateLimitData;

    // Check localStorage
    const stored = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (stored) {
      try {
        localData = JSON.parse(stored);
        // Reset if period expired
        if (now >= localData.resetTime) {
          localData = { count: 0, resetTime: now + RESET_PERIOD_MS };
        }
      } catch {
        localData = { count: 0, resetTime: now + RESET_PERIOD_MS };
      }
    } else {
      localData = { count: 0, resetTime: now + RESET_PERIOD_MS };
    }

    // Increment locally (server already incremented)
    localData.count += 1;
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(localData));

    // Update state
    setState({
      remaining: Math.max(0, MESSAGE_LIMIT - localData.count),
      resetTime: localData.resetTime,
      isLoading: false,
    });

    return true;
  }, []);

  const getResetTimeDisplay = useCallback(() => {
    const now = Date.now();
    const diff = state.resetTime - now;

    if (diff <= 0) return "now";

    const hours = Math.floor(diff / (60 * 60 * 1000));
    const minutes = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }, [state.resetTime]);

  return {
    fingerprint,
    remaining: state.remaining,
    resetTime: state.resetTime,
    isLoading: state.isLoading,
    canSendMessage,
    recordMessage,
    getResetTimeDisplay,
    messageLimit: MESSAGE_LIMIT,
  };
}
