import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { GatewayOp, DEFAULTS, DEFAULT_SUPER_PROPERTIES, SDK_INTENTS, SDK_CAPABILITIES } from './constants';

interface SessionState {
  session_id: string;
  seq: number;
  resume_gateway_url: string;
}

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private helloTimer: NodeJS.Timeout | null = null;
  private lastAck = true;
  private lastHeartbeatAt = 0;
  private ping = -1;
  private session: SessionState | null = null;
  private liveSeq = 0;
  private token = '';
  private closed = false;
  private connectOpts: { token: string; gatewayUrl?: string } | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  get latency(): number {
    return this.ping;
  }

  connect(opts: { token: string; gatewayUrl?: string }): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.close(1000, 'reconnecting');
    }
    this.token = opts.token;
    this.connectOpts = opts;
    this.session = null;
    this.liveSeq = 0;
    this.closed = false;
    this.lastAck = true;

    const base = opts.gatewayUrl || DEFAULTS.GATEWAY_SDK_URL;
    const url = `${base}/?v=${DEFAULTS.GATEWAY_VERSION}&encoding=json`;

    this.debug(`[gateway] connecting ${url}`);
    const ws = new WebSocket(url);
    this.ws = ws;

    return new Promise<void>((resolve, reject) => {
      let settled = false;
      this.helloTimer = setTimeout(() => {
        this.debug('[gateway] HELLO timeout');
        this.forceClose(4009, 'HELLO timeout');
      }, DEFAULTS.HELLO_TIMEOUT_MS).unref();

      const doSettle = (ok: boolean, err?: unknown): void => {
        if (settled) return;
        settled = true;
        this.removeListener('ready', onReady);
        this.removeListener('close', onClose);
        if (ok) resolve();
        else reject(err ?? new Error('gateway closed before ready'));
      };
      const onReady = (): void => doSettle(true);
      const onClose = (info: any): void => doSettle(false, info);
      this.once('ready', onReady);
      this.once('close', onClose);

      ws.on('open', () => {
        this.debug('[gateway] open');
        this.emit('open');
      });
      ws.on('message', (data) => this.handleMessage(data as Buffer));
      ws.on('error', (err) => {
        this.debug(`[gateway] ws error: ${err.message}`);
        this.emit('error', err);
      });
      ws.on('close', (code, reasonBuf) =>
        this.handleClose(code, Buffer.from(reasonBuf || []).toString('utf8')),
      );
    });
  }

  send(op: number, d: unknown): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const packet = { op, d };
    this.ws.send(JSON.stringify(packet), (err) => {
      if (err) this.emit('error', err);
    });
    this.emit('sent', packet);
    return true;
  }

  close(code = 1000, reason?: string): void {
    if (!this.ws) return;
    try { this.ws.close(code, reason); }
    catch { this.forceClose(code, reason ?? ''); }
  }

  private handleMessage(data: Buffer): void {
    let packet: any;
    try {
      packet = JSON.parse(data.toString('utf8'));
    } catch (err) {
      this.emit('error', err);
      return;
    }
    if (packet.s !== null && packet.s !== undefined && packet.s > this.liveSeq) {
      this.liveSeq = packet.s;
    }
    this.emit('packet', packet);

    switch (packet.op) {
      case GatewayOp.HELLO: {
        const interval = packet.d.heartbeat_interval;
        this.clearHelloTimer();
        this.startHeartbeat(interval);
        this.debug(`[gateway] HELLO heartbeat_interval=${interval}ms`);
        this.emit('hello', { heartbeat_interval: interval });
        this.sendIdentify();
        break;
      }
      case GatewayOp.HEARTBEAT_ACK:
        this.lastAck = true;
        this.ping = Date.now() - this.lastHeartbeatAt;
        break;
      case GatewayOp.HEARTBEAT:
        this.sendHeartbeat(true);
        break;
      case GatewayOp.RECONNECT:
        this.debug('[gateway] server requested RECONNECT');
        this.forceClose(4000, 'server reconnect');
        break;
      case GatewayOp.INVALID_SESSION: {
        const resumable = packet.d === true;
        this.debug(`[gateway] INVALID_SESSION resumable=${resumable}`);
        this.emit('invalidSession', resumable);
        this.forceClose(resumable ? 4000 : 1000, 'invalid session');
        break;
      }
      case GatewayOp.DISPATCH:
        this.handleDispatch(packet);
        break;
    }
  }

  private handleDispatch(packet: any): void {
    const t = packet.t ?? '';
    if (t === 'READY') {
      const d = packet.d;
      this.session = {
        session_id: d.session_id,
        resume_gateway_url: d.resume_gateway_url,
        seq: this.liveSeq,
      };
      this.debug(`[gateway] READY: user=${d.user?.username} (${d.user?.id}) session=${d.session_id}`);
      this.emit('ready', d);
    } else if (t === 'RESUMED') {
      this.debug(`[gateway] RESUMED seq=${this.liveSeq}`);
      this.emit('resumed', packet.d);
    }
    this.emit('dispatch', t, packet.d, packet.s);
  }

  private sendIdentify(): void {
    this.debug('[gateway] sending IDENTIFY');
    this.emit('identify');
    this.send(GatewayOp.IDENTIFY, {
      capabilities: SDK_CAPABILITIES,
      intents: SDK_INTENTS,
      token: this.token,
      properties: DEFAULT_SUPER_PROPERTIES,
    });
  }

  private startHeartbeat(intervalMs: number): void {
    this.stopHeartbeat();
    const firstDelay = Math.floor(intervalMs * Math.random());
    setTimeout(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.sendHeartbeat();
      this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), intervalMs).unref();
    }, firstDelay).unref();
  }

  private sendHeartbeat(force = false): void {
    if (!force && !this.lastAck) {
      this.forceClose(4009, 'heartbeat ack missed');
      return;
    }
    this.lastAck = false;
    this.lastHeartbeatAt = Date.now();
    this.send(GatewayOp.HEARTBEAT, this.liveSeq || null);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private clearHelloTimer(): void {
    if (this.helloTimer) {
      clearTimeout(this.helloTimer);
      this.helloTimer = null;
    }
  }

  private forceClose(code: number, reason: string): void {
    if (this.ws) {
      try { this.ws.close(code, reason); }
      catch { try { this.ws.terminate(); } catch {} }
    }
  }

  private handleClose(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.stopHeartbeat();
    this.clearHelloTimer();
    const session = this.session ? { ...this.session, seq: this.liveSeq } : null;
    this.ws = null;
    const fatal = [4004, 4010, 4011, 4012, 4014].includes(code);
    if (fatal) this.session = null;
    this.emit('close', { code, reason, resumable: !fatal && session !== null, session });

    if (!fatal && code !== 1000 && this.connectOpts) {
      this.reconnectTimer = setTimeout(() => {
        this.debug(`[gateway] auto-reconnecting...`);
        this.connect(this.connectOpts!).catch(() => {});
      }, 5000).unref();
    }
  }

  private debug(...msg: any): void {
    this.emit('debug', ...msg);
  }
}
