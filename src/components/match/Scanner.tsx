import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Stage = "permission" | "requesting" | "scanning" | "denied" | "unsupported" | "error";

/**
 * The Hunter's scanner.
 *
 * A permission screen comes first — the camera is only asked for when the
 * Hunter taps the button. A read code is handed straight to the server, which
 * owns every rule (roles, 40 m, 30 s freshness, flagged positions).
 */
export function Scanner({
  onScan,
  onClose,
  devMode,
}: {
  onScan: (token: string) => void;
  onClose: () => void;
  devMode: boolean;
}) {
  const [stage, setStage] = useState<Stage>("permission");
  const [message, setMessage] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  const stop = useCallback(() => {
    if (frameRef.current !== null) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  // The frame loop schedules itself through a ref, so it can re-arm without
  // referencing itself inside its own initializer.
  const loopRef = useRef<() => void>(() => undefined);

  const readFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    if (video.readyState < 2 || video.videoWidth === 0) {
      frameRef.current = requestAnimationFrame(() => loopRef.current());
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(video, 0, 0);

    try {
      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(image.data, image.width, image.height, {
        inversionAttempts: "dontInvert",
      });
      if (found?.data && !doneRef.current) {
        doneRef.current = true;
        stop();
        onScan(found.data);
        return;
      }
    } catch {
      // A frame we cannot read is not fatal; the next one may work.
    }
    frameRef.current = requestAnimationFrame(() => loopRef.current());
  }, [onScan, stop]);

  useEffect(() => {
    loopRef.current = readFrame;
  });

  const start = useCallback(async () => {
    setStage("requesting");
    setMessage(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setStage("unsupported");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        setStage("error");
        setMessage("Could not start the camera preview.");
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      doneRef.current = false;
      setStage("scanning");
      frameRef.current = requestAnimationFrame(readFrame);
    } catch (cause) {
      const name = (cause as { name?: string } | null)?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStage("denied");
      } else {
        setStage("error");
        setMessage(
          cause instanceof Error ? cause.message : "Could not open the camera.",
        );
      }
    }
  }, [readFrame]);

  return (
    <div className="rounded-xl border border-hairline p-6">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
          Scan a Shadow's code
        </p>
        <button
          type="button"
          className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground underline underline-offset-4"
          onClick={() => {
            stop();
            onClose();
          }}
        >
          Close
        </button>
      </div>

      {stage === "permission" && (
        <div className="mt-4">
          <p className="text-[14px]">
            The scanner uses your camera to read the Shadow's QR code. The
            picture never leaves your phone — only the code text is sent, and
            the server decides whether the tag counts.
          </p>
          <ul className="mt-3 grid gap-1 text-[12px] text-muted-foreground">
            <li>· No photos are stored, by you or by the app.</li>
            <li>· Your current GPS reading travels with the scan.</li>
            <li>· A refused scan costs you nothing.</li>
          </ul>
          <Button
            className="mt-5 h-11 uppercase tracking-[0.18em]"
            onClick={() => void start()}
          >
            Allow camera
          </Button>
        </div>
      )}

      {stage === "requesting" && (
        <p className="mt-4 text-[13px] text-muted-foreground">
          Asking for the camera…
        </p>
      )}

      {stage === "denied" && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-[13px] text-destructive">
            Camera access is blocked. Allow it for this site in your browser
            settings, then try again.
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void start()}
          >
            Try again
          </Button>
        </div>
      )}

      {stage === "unsupported" && (
        <p className="mt-4 text-[13px] text-destructive">
          This browser does not expose a camera. Use the manual code below.
        </p>
      )}

      {stage === "error" && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <p className="text-[13px] text-destructive">
            {message ?? "Could not open the camera."}
          </p>
          <Button
            variant="outline"
            className="mt-3"
            onClick={() => void start()}
          >
            Try again
          </Button>
        </div>
      )}

      {stage === "scanning" && (
        <div className="mt-4">
          <div className="overflow-hidden rounded-lg border border-hairline bg-black">
            <video
              ref={videoRef}
              muted
              playsInline
              autoPlay
              className="h-64 w-full object-cover"
            />
          </div>
          <canvas ref={canvasRef} className="hidden" />
          <p className="mt-3 text-center text-[13px] text-muted-foreground">
            Point the camera at the Shadow's code.
          </p>
        </div>
      )}

      {devMode && (
        <div className="mt-5 rounded-lg border border-dashed border-hairline p-4">
          <Label className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            Simulated scan (development only)
          </Label>
          <div className="mt-2 flex gap-2">
            <Input
              value={manual}
              onChange={(event) => setManual(event.target.value)}
              placeholder="Paste a QR token"
              className="font-mono"
            />
            <Button
              type="button"
              variant="outline"
              className="h-10 shrink-0 uppercase tracking-[0.18em]"
              disabled={manual.trim().length === 0}
              onClick={() => {
                stop();
                onScan(manual.trim());
              }}
            >
              Scan
            </Button>
          </div>
          <p className="mt-2 text-[12px] text-muted-foreground">
            Lets you try a tag without a second phone. Compiled out of
            production builds.
          </p>
        </div>
      )}
    </div>
  );
}
