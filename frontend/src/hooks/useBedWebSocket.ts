// frontend/src/hooks/useBedWebSocket.ts
import { useEffect, useRef } from 'react';

export function useBedWebSocket(onMessage: (data: any) => void) {
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        // Get the current auth token for WebSocket authentication
        const token = localStorage.getItem('hip_access_token');
        if (!token) {
            console.warn('[WS] No auth token available. WebSocket connection skipped.');
            return;
        }

        // Connect with token as query parameter for authentication
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/beds?token=${encodeURIComponent(token)}`;

        const socket = new WebSocket(wsUrl);
        wsRef.current = socket;

        socket.onopen = () => {
            console.log('[WS] Connected to live bed stream (authenticated)');
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

        socket.onclose = (event) => {
            if (event.code === 4001) {
                console.warn('[WS] Authentication failed. Token may be expired.');
                // Could trigger re-authentication here
            }
        };

        return () => {
            socket.close();
        };
    }, [onMessage]);

    return wsRef.current;
}