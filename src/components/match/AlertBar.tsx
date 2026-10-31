import { Button } from "@/components/ui/button";
import type { AlertBanner, AlertTone } from "@/hooks/useMatchAlerts";

const TONE_CLASS: Record<AlertTone, string> = {
  info: "border-foreground/30 bg-card text-foreground",
  good: "border-emerald-600 bg-emerald-50 text-emerald-950",
  warn: "border-amber-500 bg-amber-50 text-amber-950",
  danger: "border-destructive bg-destructive/10 text-destructive",
};

/**
 * The banner stack (Stage 5, task 4). Big, high-contrast and readable in
 * daylight; each one can be dismissed by hand.
 */
export function AlertBar(props: {
  banners: AlertBanner[];
  mute: boolean;
  onToggleMute: () => void;
  onDismiss: (id: string) => void;
}) {
  const { banners, mute, onToggleMute, onDismiss } = props;

  return (
    <div className="mb-4 space-y-2">
      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 uppercase tracking-[0.18em]"
          aria-pressed={!mute}
          onClick={onToggleMute}
        >
          {mute ? "Sound off" : "Sound on"}
        </Button>
      </div>

      {banners.map((banner) => (
        <div
          key={banner.id}
          role="status"
          className={`flex items-start justify-between gap-3 rounded-xl border-2 px-4 py-3 ${TONE_CLASS[banner.tone]}`}
        >
          <p className="text-[16px] font-semibold leading-snug">{banner.text}</p>
          <button
            type="button"
            aria-label="Dismiss"
            className="shrink-0 text-[18px] leading-none opacity-60 hover:opacity-100"
            onClick={() => onDismiss(banner.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
