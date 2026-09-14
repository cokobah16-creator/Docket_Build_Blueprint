"use client";

import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { Icon, type IconName } from "@/components/ui/icon";
import { PILL_TONES, type PillTone } from "@/components/ui/badge";

interface ToastItem {
  id: number;
  message: string;
  kind: "success" | "error" | "info";
}

// A toast said which of the three it was in colour alone — a saturated fill
// with white type — so a viewer who cannot tell green from red read every one
// of them as the same sentence. It now takes the same tone and the same icon a
// pill or an alert would take for that meaning, and the ground is a token, so
// it is a warm tint in light and a deep one in dark rather than an unlit block.
const TOAST_TONES: Record<ToastItem["kind"], { tone: PillTone; icon: IconName }> = {
  success: { tone: "settled", icon: "check" },
  error: { tone: "wrong", icon: "alert" },
  info: { tone: "informing", icon: "alert" },
};

const ToastContext = createContext<{ push: (message: string, kind?: ToastItem["kind"]) => void }>({
  push: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, kind: ToastItem["kind"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, kind }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              // A toast floats over everything, so it carries both halves of
              // elevation: a tinted surface that reads in dark mode and the
              // shadow that reads in light.
              "pointer-events-auto flex items-center gap-2 rounded-control border px-4 py-2.5 text-15 font-medium shadow-e3",
              PILL_TONES[TOAST_TONES[t.kind].tone],
            )}
          >
            <Icon name={TOAST_TONES[t.kind].icon} size={16} strokeWidth={2.2} className="shrink-0" />
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
