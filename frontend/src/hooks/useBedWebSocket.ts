// frontend/src/hooks/useBedWebSocket.ts
import { useEffect, useRef } from 'react';

export function useBedWebSocket(onMessage: (data: any) => void) {
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        // Connect to Vite's proxy route or direct backend
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/beds`;

        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
            console.log('[WS] Connected to live bed stream');
        };

        socket.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                onMessage(parsed);
            } catch {
                onMessage(event.data);
            }
        };

        socket.onerror = (err) => {
            console.error('[WS Error]', err);
        };

        return () => {
            socket.close();
        };
    }, [onMessage]);

    return wsRef.current;
}