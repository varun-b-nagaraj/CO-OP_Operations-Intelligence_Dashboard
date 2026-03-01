'use client';

import jsQR from 'jsqr';
import Image from 'next/image';
import QRCode from 'qrcode';
import { useEffect, useRef, useState } from 'react';

interface QRSyncPanelProps {
  outgoingPacket: string;
  onImportPacket: (packet: string) => Promise<void>;
}

export function QRSyncPanel({ outgoingPacket, onImportPacket }: QRSyncPanelProps) {
  const [qrImage, setQrImage] = useState<string>('');
  const [importText, setImportText] = useState('');
  const [scanActive, setScanActive] = useState(false);
  const [status, setStatus] = useState('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!outgoingPacket) {
      setQrImage('');
      return;
    }

    QRCode.toDataURL(outgoingPacket, {
      margin: 1,
      width: 280,
      errorCorrectionLevel: 'L'
    })
      .then(setQrImage)
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : 'QR generation failed'));
  }, [outgoingPacket]);

  useEffect(() => {
    if (!scanActive) return;

    let stream: MediaStream | null = null;
    let timer: number | null = null;

    const startScan = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false
        });

        if (!videoRef.current || !canvasRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

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
          const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = jsQR(imageData.data, imageData.width, imageData.height);

          if (decoded?.data) {
            setImportText(decoded.data);
            setScanActive(false);
          }
        }, 350);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Camera QR scan failed');
        setScanActive(false);
      }
    };

    startScan();

    return () => {
      if (timer) window.clearInterval(timer);
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop();
        }
      }
    };
  }, [scanActive]);

  return (
    <section className="border border-neutral-300 p-3">
      <h4 className="text-sm font-semibold text-neutral-900">QR Sync Fallback</h4>
      <p className="mt-1 text-xs text-neutral-700">
        Use for fully offline transfer when BLE is unavailable. Show packet QR to peer, then import peer QR.
      </p>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <div className="border border-neutral-200 p-2">
          <p className="text-xs font-medium text-neutral-800">Outgoing Packet</p>
          {qrImage ? (
            <Image
              alt="QR Sync Packet"
              className="mt-2 border border-neutral-300"
              height={280}
              src={qrImage}
              unoptimized
              width={280}
            />
          ) : (
            <p className="mt-2 text-xs text-neutral-500">No packet generated yet.</p>
          )}
          {outgoingPacket ? (
            <button
              className="mt-2 border border-neutral-300 px-2 py-1 text-xs"
              onClick={async () => {
                await navigator.clipboard.writeText(outgoingPacket);
                setStatus('Packet copied to clipboard.');
              }}
              type="button"
            >
              Copy Packet Text
            </button>
          ) : null}
        </div>

        <div className="border border-neutral-200 p-2">
          <p className="text-xs font-medium text-neutral-800">Import Packet</p>
          <textarea
            className="mt-2 min-h-24 w-full border border-neutral-300 p-2 text-xs"
            onChange={(event) => setImportText(event.target.value.trim())}
            placeholder="Paste or scan encoded packet"
            value={importText}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className="border border-neutral-700 bg-neutral-800 px-2 py-1 text-xs text-white"
              onClick={() => setScanActive((value) => !value)}
              type="button"
            >
              {scanActive ? 'Stop QR Camera' : 'Scan QR With Camera'}
            </button>
            <button
              className="border border-brand-maroon bg-brand-maroon px-2 py-1 text-xs text-white disabled:opacity-60"
              disabled={!importText}
              onClick={async () => {
                try {
                  await onImportPacket(importText);
                  setImportText('');
                  setStatus('Packet imported successfully.');
                } catch (error) {
                  setStatus(error instanceof Error ? error.message : 'Failed to import packet');
                }
              }}
              type="button"
            >
              Import Packet
            </button>
          </div>

          {scanActive ? (
            <div className="mt-2">
              <video className="max-h-52 w-full border border-neutral-300 bg-black" muted playsInline ref={videoRef} />
              <canvas className="hidden" ref={canvasRef} />
            </div>
          ) : null}
        </div>
      </div>

      {status ? <p className="mt-2 text-xs text-neutral-700">{status}</p> : null}
    </section>
  );
}
