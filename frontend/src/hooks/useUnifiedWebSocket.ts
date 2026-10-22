import { useEffect, useRef } from 'react';

export function useUnifiedWebSocket() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    let isMounted = true;

    const connect = () => {
      if (!isMounted) return;

      const token = sessionStorage.getItem('token');
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsHost = window.location.port === '3000' || window.location.port === '5173' ? 'localhost:8080' : window.location.host;
      const url = `${wsProtocol}//${wsHost}/ws${token ? `?token=${encodeURIComponent(token)}` : ''}`;

      try {
        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          // Connected to shared gateway WebSocket
        };

        ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            const eventType = data.event_type || data.type;
            if (
              eventType === 'BED_STATUS_CHANGED' ||
              eventType === 'ADMISSION_CREATED' ||
              eventType === 'BED_DIRTY' ||
              eventType === 'BED_AVAILABLE' ||
              eventType === 'BED_OCCUPIED' ||
              eventType === 'CLEANING_STARTED' ||
              eventType === 'BED_TRANSFER'
            ) {
              window.dispatchEvent(new CustomEvent('hip:bed-updated', { detail: data }));
              window.dispatchEvent(new CustomEvent('hip:state-sync', { detail: data }));
            }
          } catch {
            // Non-JSON telemetry ping
          }
        };

        ws.onclose = () => {
          if (isMounted) {
            reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
          }
        };

        ws.onerror = () => {
          if (ws.readyState === WebSocket.OPEN) {
            try { ws.close(); } catch {}
          }
        };
      } catch {
        if (isMounted) {
          reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
        }
      }
    };

    connect();

    return () => {
      isMounted = false;
      if (reconnectTimeoutRef.current) {
        window.clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        const socket = wsRef.current;
        if (socket.readyState === WebSocket.OPEN) {
          try { socket.close(); } catch {}
        } else if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => {
            try { socket.close(); } catch {}
          };
        }
      }
    };
  }, []);
}
