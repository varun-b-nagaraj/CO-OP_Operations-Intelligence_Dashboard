'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrowserMultiFormatReader } from '@zxing/browser';

interface BarcodeScannerProps {
  onDetected: (value: string) => void;
}

type Detector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

export function BarcodeScanner({ onDetected }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  const [fallbackMode, setFallbackMode] = useState<'native' | 'zxing'>('native');
  const [error, setError] = useState('');

  useEffect(() => {
    setSupported(typeof window !== 'undefined');
  }, []);

  useEffect(() => {
    if (!active || !supported) {
      return;
    }

    let stream: MediaStream | null = null;
    let timer: number | null = null;
    let zxingReader: BrowserMultiFormatReader | null = null;
    let cancelled = false;

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });

        if (!videoRef.current || !canvasRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        if ('BarcodeDetector' in window) {
          setFallbackMode('native');
          const DetectorCtor = (window as unknown as { BarcodeDetector: new () => Detector }).BarcodeDetector;
          const detector = new DetectorCtor();

          timer = window.setInterval(async () => {
            if (!videoRef.current || !canvasRef.current) return;

            const video = videoRef.current;
            const canvas = canvasRef.current;
            if (!video.videoWidth || !video.videoHeight) return;

            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            if (!context) return;
            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            const codes = await detector.detect(canvas);
            const value = codes.find((code) => code.rawValue)?.rawValue;
            if (value) {
              onDetected(value.trim());
              setActive(false);
            }
          }, 450);
          return;
        }

        setFallbackMode('zxing');
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        zxingReader = new BrowserMultiFormatReader();
        const result = await zxingReader.decodeOnceFromVideoDevice(undefined, videoRef.current);
        if (cancelled) return;
        const value = result?.getText()?.trim();
        if (value) {
          onDetected(value);
        }
        setActive(false);
      } catch (scanError) {
        setError(scanError instanceof Error ? scanError.message : 'Unable to start camera scanning');
        setActive(false);
      }
    };

    start();

    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
    };
  }, [active, onDetected, supported]);

  return (
    <div className="border border-neutral-300 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="border border-neutral-700 bg-neutral-800 px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
          disabled={!supported}
          onClick={() => {
            setError('');
            setActive((value) => !value);
          }}
          type="button"
        >
          {active ? 'Stop Camera Scan' : 'Start Camera Scan'}
        </button>
        {!supported ? <span className="text-xs text-amber-700">Camera not available on this browser.</span> : null}
        {supported ? (
          <span className="text-xs text-neutral-600">
            UPC/EAN/System ID scanning via camera ({fallbackMode === 'native' ? 'native detector' : 'ZXing fallback'}).
          </span>
        ) : null}
      </div>

      {error ? <p className="mt-2 text-xs text-red-700">{error}</p> : null}

      {active ? (
        <div className="fixed inset-0 z-50 bg-black/95 p-3 sm:static sm:mt-3 sm:bg-transparent sm:p-0">
          <div className="mx-auto flex h-full max-w-3xl flex-col sm:h-auto">
            <div className="mb-2 flex items-center justify-between text-white sm:hidden">
              <span className="text-sm font-medium">Live Barcode Scan</span>
              <button
                className="border border-white/60 px-3 py-1 text-xs"
                onClick={() => setActive(false)}
                type="button"
              >
                Close
              </button>
            </div>
            <video className="h-full w-full border border-neutral-300 bg-black sm:max-h-72" muted playsInline ref={videoRef} />
          </div>
          <canvas className="hidden" ref={canvasRef} />
        </div>
      ) : null}
    </div>
  );
}
