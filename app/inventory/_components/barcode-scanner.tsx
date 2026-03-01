'use client';

import { useEffect, useRef, useState } from 'react';
import type { BrowserMultiFormatReader } from '@zxing/browser';

interface BarcodeScannerProps {
  onDetected: (value: string, mode: ScanMode) => void;
  recentScan?: {
    itemName: string;
    currentCount: number;
    mode: ScanMode;
    action: 'incremented' | 'identified';
  } | null;
}

type Detector = {
  detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>>;
};

type ScanMode = 'single' | 'multi';

export function BarcodeScanner({ onDetected, recentScan }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const zxingReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>('multi');
  const [fallbackMode, setFallbackMode] = useState<'native' | 'zxing'>('native');
  const [isCapturing, setIsCapturing] = useState(false);
  const [resultStatus, setResultStatus] = useState('');
  const [showRecentPanel, setShowRecentPanel] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setSupported(typeof window !== 'undefined');
  }, []);

  useEffect(() => {
    if (!active || !supported) {
      return;
    }

    let cancelled = false;

    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });
        streamRef.current = stream;

        if (!videoRef.current || !canvasRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        if ('BarcodeDetector' in window) {
          setFallbackMode('native');
          return;
        }

        setFallbackMode('zxing');
        const { BrowserMultiFormatReader } = await import('@zxing/browser');
        zxingReaderRef.current = new BrowserMultiFormatReader();
      } catch (scanError) {
        if (cancelled) return;
        setError(scanError instanceof Error ? scanError.message : 'Unable to start camera scanning');
        setActive(false);
      }
    };

    void start();

    return () => {
      cancelled = true;
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
      zxingReaderRef.current = null;
    };
  }, [active, supported]);

  const captureFrame = async () => {
    if (!videoRef.current || !canvasRef.current) return;
    if (isCapturing) return;
    setIsCapturing(true);
    setError('');
    setResultStatus('');
    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video.videoWidth || !video.videoHeight) {
        throw new Error('Camera feed is not ready. Try again.');
      }

      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Unable to read camera frame.');

      context.drawImage(video, 0, 0, canvas.width, canvas.height);

      let value = '';
      if ('BarcodeDetector' in window) {
        const DetectorCtor = (window as unknown as { BarcodeDetector: new () => Detector }).BarcodeDetector;
        const detector = new DetectorCtor();
        const codes = await detector.detect(canvas);
        value = codes.find((code) => code.rawValue)?.rawValue?.trim() ?? '';
      } else {
        if (!zxingReaderRef.current) {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          zxingReaderRef.current = new BrowserMultiFormatReader();
        }
        try {
          const result = zxingReaderRef.current.decodeFromCanvas(canvas);
          value = result?.getText()?.trim() ?? '';
        } catch {
          value = '';
        }
      }

      if (!value) {
        setResultStatus('No barcode detected in this frame. Try again.');
        return;
      }

      onDetected(value, scanMode);
      setResultStatus(scanMode === 'multi' ? `Scanned ${value}. +1 queued.` : `Scanned ${value}. Identified only.`);
      if (scanMode === 'single') {
        setActive(false);
      }
    } catch (captureError) {
      setError(captureError instanceof Error ? captureError.message : 'Capture failed');
    } finally {
      setIsCapturing(false);
    }
  };

  return (
    <div className="border border-neutral-300 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-neutral-700">
          Scan Mode
          <select
            className="ml-2 border border-neutral-300 px-2 py-1 text-xs"
            onChange={(event) => setScanMode(event.target.value as ScanMode)}
            value={scanMode}
          >
            <option value="multi">Multi Scan (+1 each shutter)</option>
            <option value="single">Single Scan (identify only)</option>
          </select>
        </label>
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
      {resultStatus ? <p className="mt-2 text-xs text-neutral-700">{resultStatus}</p> : null}

      {active ? (
        <div className="fixed inset-0 z-50 bg-black/95 p-3 sm:static sm:mt-3 sm:bg-transparent sm:p-0">
          <div className="mx-auto flex h-full max-w-3xl flex-col sm:h-auto">
            {recentScan ? (
              <div className="mb-2 border border-emerald-400 bg-emerald-950/80 p-2 text-white sm:rounded">
                <button
                  className="flex w-full items-center justify-between text-left text-xs font-medium"
                  onClick={() => setShowRecentPanel((value) => !value)}
                  type="button"
                >
                  <span>
                    {recentScan.action === 'incremented'
                      ? `${recentScan.itemName} +1`
                      : `Identified: ${recentScan.itemName}`}
                  </span>
                  <span>{showRecentPanel ? 'Hide' : 'Show'}</span>
                </button>
                {showRecentPanel ? (
                  <div className="mt-1 text-xs text-emerald-100">
                    <p>Current counted qty for most recent item: {recentScan.currentCount}</p>
                    <p>Mode: {recentScan.mode === 'multi' ? 'Multi Scan' : 'Single Scan'}</p>
                  </div>
                ) : null}
              </div>
            ) : null}
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
            <div className="mt-2 flex items-center justify-center gap-2">
              <button
                className="min-h-[44px] rounded-full border border-white bg-white/10 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:border-neutral-600 sm:bg-neutral-800"
                disabled={isCapturing}
                onClick={() => {
                  void captureFrame();
                }}
                type="button"
              >
                {isCapturing ? 'Capturing...' : 'Shutter'}
              </button>
              {scanMode === 'multi' ? (
                <span className="text-xs text-neutral-200 sm:text-neutral-600">Keep pressing shutter to add each item.</span>
              ) : (
                <span className="text-xs text-neutral-200 sm:text-neutral-600">Single scan identifies item without incrementing.</span>
              )}
            </div>
          </div>
          <canvas className="hidden" ref={canvasRef} />
        </div>
      ) : null}
    </div>
  );
}
