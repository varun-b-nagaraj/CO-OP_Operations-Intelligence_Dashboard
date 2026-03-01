import { BLEProvider } from '@/lib/inventory/sync/ble-provider';
import { QRProvider } from '@/lib/inventory/sync/qr-provider';
import { SyncProvider } from '@/lib/inventory/sync/types';

export function resolveSyncProvider(preferred: 'ble' | 'qr'): SyncProvider {
  if (preferred === 'ble') {
    const ble = new BLEProvider();
    if (ble.isSupported()) {
      return ble;
    }
  }

  return new QRProvider();
}

export * from '@/lib/inventory/sync/qr-provider';
export * from '@/lib/inventory/sync/types';
