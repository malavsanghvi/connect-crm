"use client";

import { useEffect, useRef } from "react";

/**
 * Live camera QR scanning with @zxing/browser (loaded only in the browser).
 * Repeated reads of the same code within a few seconds are ignored.
 */
export function CameraScanner({
  active,
  onScan,
  onError,
}: {
  active: boolean;
  onScan: (text: string) => void;
  onError: (message: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const onErrorRef = useRef(onError);
  const last = useRef<{ text: string; at: number }>({ text: "", at: 0 });

  useEffect(() => {
    onScanRef.current = onScan;
    onErrorRef.current = onError;
  }, [onScan, onError]);

  useEffect(() => {
    if (!active || !videoRef.current) return;
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    (async () => {
      try {
        const { BrowserQRCodeReader } = await import("@zxing/browser");
        if (stopped || !videoRef.current) return;
        const reader = new BrowserQRCodeReader(undefined, { delayBetweenScanAttempts: 150 });
        controls = await reader.decodeFromConstraints({ video: { facingMode: "environment" } }, videoRef.current, (result) => {
          if (!result) return; // "not found" frames are normal between codes
          const text = result.getText();
          const now = Date.now();
          if (text === last.current.text && now - last.current.at < 3000) return;
          last.current = { text, at: now };
          if (navigator.vibrate) navigator.vibrate(60);
          onScanRef.current(text);
        });
        if (stopped) controls.stop();
      } catch (error) {
        console.error("[camera] could not start", error);
        const name = (error as { name?: string })?.name;
        onErrorRef.current(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings, or type the code instead."
            : name === "NotFoundError"
              ? "No camera was found on this device. Use a scanner or type the code."
              : "The camera couldn't start. Type the code, or use a USB/Bluetooth scanner.",
        );
      }
    })();
    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [active]);

  return (
    <div className="overflow-hidden rounded-xl bg-black">
      <video ref={videoRef} className="aspect-square w-full object-cover" muted playsInline aria-label="Camera preview for scanning" />
    </div>
  );
}
