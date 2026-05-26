import { useEffect, useState } from 'react';

// Detects online/offline status using the browser Network Information API.
// On Capacitor iOS/Android, @capacitor/network fires the same events natively.
export function useOffline(): boolean {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on  = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online',  on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  return offline;
}
