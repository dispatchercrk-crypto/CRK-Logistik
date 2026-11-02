import { RealtimeEventPayload } from '../types';

export const REALTIME_CLIENT_ID = `cli-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;

type RealtimeListener = (event: RealtimeEventPayload) => void;

class RealtimeSocketService {
  private socket: WebSocket | null = null;
  private listeners = new Set<RealtimeListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private disposed = false;

  private buildWsUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws?clientId=${encodeURIComponent(
      REALTIME_CLIENT_ID
    )}`;
  }

  public connect(): void {
    if (typeof window === 'undefined' || this.disposed) return;
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    try {
      const ws = new WebSocket(this.buildWsUrl());
      this.socket = ws;

      ws.onopen = () => {
        this.reconnectAttempt = 0;
      };

      ws.onmessage = (msgEvent) => {
        try {
          const parsed = JSON.parse(
            String(msgEvent.data || '')
          ) as RealtimeEventPayload;
          if (parsed && parsed.type && parsed.state) {
            for (const listener of this.listeners) {
              listener(parsed);
            }
          }
        } catch {
          // Ignore malformed non-JSON frames
        }
      };

      ws.onclose = () => {
        if (this.socket === ws) {
          this.socket = null;
        }
        this.scheduleReconnect();
      };

      ws.onerror = () => {
        try {
          ws.close();
        } catch {
          // Ignore close error
        }
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.listeners.size === 0) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(8000, 800 * Math.pow(1.6, this.reconnectAttempt));
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  public subscribe(listener: RealtimeListener): () => void {
    this.disposed = false;
    this.listeners.add(listener);
    this.connect();

    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        if (this.socket) {
          try {
            this.socket.close();
          } catch {
            // Ignore close error
          }
          this.socket = null;
        }
      }
    };
  }
}

export const realtimeSocket = new RealtimeSocketService();
