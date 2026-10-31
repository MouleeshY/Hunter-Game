import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";

/**
 * The Shadow's one plain QR code for this match.
 *
 * Opening it sends a fresh position upload (the parent bumps `onOpened`), so a
 * Hunter's scan has a recent reading to check against. Nothing but the opaque
 * token is in the code — no name, no photo, no position.
 */
export function QrCard({
  token,
  callSign,
  proximityMetres,
  onOpened,
  onClose,
  devMode,
}: {
  token: string;
  callSign: string | null;
  proximityMetres: number;
  onOpened: () => void;
  onClose: () => void;
  devMode: boolean;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(onOpened);
  useEffect(() => {
    opened.current = onOpened;
  });

  useEffect(() => {
    let alive = true;
    // A fresh reading the moment the code appears: the 30 s freshness rule
    // depends on it.
    opened.current();
    QRCode.toDataURL(token, {
      margin: 1,
      width: 512,
      color: { dark: "#111111", light: "#ffffff" },
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (alive) setDataUrl(url);
      })
      .catch((cause: unknown) => {
        if (alive) {
          setError(
            cause instanceof Error ? cause.message : "Could not draw the code.",
          );
        }
      });
    return () => {
      alive = false;
    };
  }, [token]);

  return (
    <div className="rounded-xl border border-hairline bg-white p-6 text-neutral-900">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.22em] text-neutral-500">
          Show this to a Hunter
        </p>
        <button
          type="button"
          className="text-[11px] uppercase tracking-[0.18em] text-neutral-500 underline underline-offset-4"
          onClick={onClose}
        >
          Close
        </button>
      </div>

      <p className="mt-3 font-display text-2xl tracking-tight">
        {callSign ?? "You are caught"}
      </p>

      <div className="mt-5 flex justify-center">
        {dataUrl ? (
          <img
            src={dataUrl}
            alt="Your tag code for this match"
            className="h-64 w-64 rounded-lg border border-neutral-200"
          />
        ) : (
          <div className="flex h-64 w-64 items-center justify-center rounded-lg border border-dashed border-neutral-300 text-[12px] text-neutral-500">
            {error ?? "Drawing your code…"}
          </div>
        )}
      </div>

      <p className="mt-5 text-center text-[13px] text-neutral-600">
        The Hunter has to be within <strong>{proximityMetres} m</strong> and
        both positions must be under 30 seconds old.
      </p>

      {devMode && (
        <div className="mt-4 rounded-lg bg-neutral-100 p-3">
          <p className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">
            Development only — simulated scan
          </p>
          <code className="mt-1 block break-all font-mono text-[13px]">
            {token}
          </code>
          <p className="mt-1 text-[12px] text-neutral-500">
            Type this into the scanner on another tab instead of using a camera.
          </p>
        </div>
      )}

      <div className="mt-5 flex justify-center">
        <Button
          type="button"
          variant="outline"
          className="h-10 uppercase tracking-[0.18em]"
          onClick={onOpened}
        >
          Refresh my position
        </Button>
      </div>
    </div>
  );
}
