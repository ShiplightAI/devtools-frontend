// Copyright (c) 2015 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import * as i18n from '../../core/i18n/i18n.js';
import * as Common from '../common/common.js';
import * as Host from '../host/host.js';
import type * as Platform from '../platform/platform.js';
import * as ProtocolClient from '../protocol_client/protocol_client.js';
import * as Root from '../root/root.js';

import {RehydratingConnection} from './RehydratingConnection.js';

const UIStrings = {
  /**
   *@description Text on the remote debugging window to indicate the connection is lost
   */
  websocketDisconnected: 'WebSocket disconnected',
} as const;
const str_ = i18n.i18n.registerUIStrings('core/sdk/Connections.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);
export class MainConnection implements ProtocolClient.InspectorBackend.Connection {
  onMessage: ((arg0: (Object|string)) => void)|null;
  #onDisconnect: ((arg0: string) => void)|null;
  #messageBuffer: string;
  #messageSize: number;
  readonly #eventListeners: Common.EventTarget.EventDescriptor[];
  constructor() {
    this.onMessage = null;
    this.#onDisconnect = null;
    this.#messageBuffer = '';
    this.#messageSize = 0;
    this.#eventListeners = [
      Host.InspectorFrontendHost.InspectorFrontendHostInstance.events.addEventListener(
          Host.InspectorFrontendHostAPI.Events.DispatchMessage, this.dispatchMessage, this),
      Host.InspectorFrontendHost.InspectorFrontendHostInstance.events.addEventListener(
          Host.InspectorFrontendHostAPI.Events.DispatchMessageChunk, this.dispatchMessageChunk, this),
    ];
  }

  setOnMessage(onMessage: (arg0: (Object|string)) => void): void {
    this.onMessage = onMessage;
  }

  setOnDisconnect(onDisconnect: (arg0: string) => void): void {
    this.#onDisconnect = onDisconnect;
  }

  sendRawMessage(message: string): void {
    if (this.onMessage) {
      Host.InspectorFrontendHost.InspectorFrontendHostInstance.sendMessageToBackend(message);
    }
  }

  private dispatchMessage(event: Common.EventTarget.EventTargetEvent<string>): void {
    if (this.onMessage) {
      this.onMessage.call(null, event.data);
    }
  }

  private dispatchMessageChunk(
      event: Common.EventTarget.EventTargetEvent<Host.InspectorFrontendHostAPI.DispatchMessageChunkEvent>): void {
    const {messageChunk, messageSize} = event.data;
    if (messageSize) {
      this.#messageBuffer = '';
      this.#messageSize = messageSize;
    }
    this.#messageBuffer += messageChunk;
    if (this.#messageBuffer.length === this.#messageSize && this.onMessage) {
      this.onMessage.call(null, this.#messageBuffer);
      this.#messageBuffer = '';
      this.#messageSize = 0;
    }
  }

  async disconnect(): Promise<void> {
    const onDisconnect = this.#onDisconnect;
    Common.EventTarget.removeEventListeners(this.#eventListeners);
    this.#onDisconnect = null;
    this.onMessage = null;

    if (onDisconnect) {
      onDisconnect.call(null, 'force disconnect');
    }
  }
}

export class WebSocketConnection implements ProtocolClient.InspectorBackend.Connection {
  #socket: WebSocket|null = null;
  onMessage: ((arg0: (Object|string)) => void)|null;
  #onDisconnect: ((arg0: string) => void)|null;
  #onWebSocketDisconnect: ((message: Platform.UIString.LocalizedString) => void)|null;
  #connected: boolean;
  #messages: string[];
  #url: Platform.DevToolsPath.UrlString;
  #reconnectAttempts: number;
  #maxReconnectAttempts: number;
  #baseReconnectDelay: number;
  #reconnectTimer: number|null;
  #shouldReconnect: boolean;
  #isManualDisconnect: boolean;
  constructor(
      url: Platform.DevToolsPath.UrlString,
      onWebSocketDisconnect: (message: Platform.UIString.LocalizedString) => void) {
    this.#url = url;
    this.#reconnectAttempts = 0;
    this.#maxReconnectAttempts = 5;
    this.#baseReconnectDelay = 1000;
    this.#reconnectTimer = null;
    this.#shouldReconnect = true;
    this.#isManualDisconnect = false;

    this.onMessage = null;
    this.#onDisconnect = null;
    this.#onWebSocketDisconnect = onWebSocketDisconnect;
    this.#connected = false;
    this.#messages = [];

    this.#createSocket();
  }

  setOnMessage(onMessage: (arg0: (Object|string)) => void): void {
    this.onMessage = onMessage;
  }

  setOnDisconnect(onDisconnect: (arg0: string) => void): void {
    this.#onDisconnect = onDisconnect;
  }

  #createSocket(): void {
    this.#socket = new WebSocket(this.#url);
    this.#socket.onerror = this.onError.bind(this);
    this.#socket.onopen = this.onOpen.bind(this);
    this.#socket.onmessage = (messageEvent: MessageEvent<string>): void => {
      if (this.onMessage) {
        this.onMessage.call(null, messageEvent.data);
      }
    };
    this.#socket.onclose = this.onClose.bind(this);
  }

  #scheduleReconnect(): void {
    if (!this.#shouldReconnect || this.#isManualDisconnect || this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      return;
    }

    const delay = Math.min(this.#baseReconnectDelay * Math.pow(2, this.#reconnectAttempts), 30000);
    console.log(`WebSocket reconnection scheduled in ${delay}ms (attempt ${this.#reconnectAttempts + 1}/${this.#maxReconnectAttempts})`);

    this.#reconnectTimer = window.setTimeout(() => {
      this.#attemptReconnect();
    }, delay);
  }

  #attemptReconnect(): void {
    if (!this.#shouldReconnect || this.#isManualDisconnect) {
      return;
    }

    this.#reconnectAttempts++;
    console.log(`Attempting WebSocket reconnection (${this.#reconnectAttempts}/${this.#maxReconnectAttempts})`);

    this.#clearReconnectTimer();
    this.#createSocket();
  }

  #clearReconnectTimer(): void {
    if (this.#reconnectTimer !== null) {
      window.clearTimeout(this.#reconnectTimer);
      this.#reconnectTimer = null;
    }
  }

  private onError(): void {
    // Only show the disconnect UI if we won't be attempting reconnection
    if (this.#onWebSocketDisconnect && this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      this.#onWebSocketDisconnect.call(null, i18nString(UIStrings.websocketDisconnected));
    }
    if (this.#onDisconnect && this.#reconnectAttempts >= this.#maxReconnectAttempts) {
      // Only call onDisconnect if we've exhausted all reconnection attempts
      this.#onDisconnect.call(null, 'connection failed');
    }
    this.close();
    this.#scheduleReconnect();
  }

  private onOpen(): void {
    this.#connected = true;
    const wasReconnecting = this.#reconnectAttempts > 0;
    this.#reconnectAttempts = 0;
    this.#clearReconnectTimer();

    if (this.#socket) {
      this.#socket.onerror = console.error;
      for (const message of this.#messages) {
        this.#socket.send(message);
      }
    }
    this.#messages = [];

    if (wasReconnecting) {
      console.log('WebSocket reconnection successful');
    }
  }

  private onClose(): void {
    // Only show the disconnect UI if this was manual or we won't be attempting reconnection
    if (this.#onWebSocketDisconnect && (this.#isManualDisconnect || this.#reconnectAttempts >= this.#maxReconnectAttempts)) {
      this.#onWebSocketDisconnect.call(null, i18nString(UIStrings.websocketDisconnected));
    }
    if (this.#onDisconnect && (this.#isManualDisconnect || this.#reconnectAttempts >= this.#maxReconnectAttempts)) {
      // Only call onDisconnect if this was manual or we've exhausted all reconnection attempts
      this.#onDisconnect.call(null, 'websocket closed');
    }
    this.close();
    if (!this.#isManualDisconnect) {
      this.#scheduleReconnect();
    }
  }

  private close(callback?: (() => void)): void {
    if (this.#socket) {
      this.#socket.onerror = null;
      this.#socket.onopen = null;
      this.#socket.onclose = callback || null;
      this.#socket.onmessage = null;
      this.#socket.close();
      this.#socket = null;
    }
    this.#onWebSocketDisconnect = null;
  }

  sendRawMessage(message: string): void {
    if (this.#connected && this.#socket) {
      this.#socket.send(message);
    } else {
      this.#messages.push(message);
    }
  }

  disconnect(): Promise<void> {
    this.#isManualDisconnect = true;
    this.#shouldReconnect = false;
    this.#clearReconnectTimer();

    return new Promise(fulfill => {
      this.close(() => {
        if (this.#onDisconnect) {
          this.#onDisconnect.call(null, 'force disconnect');
        }
        fulfill();
      });
    });
  }
}

export class StubConnection implements ProtocolClient.InspectorBackend.Connection {
  onMessage: ((arg0: (Object|string)) => void)|null;
  #onDisconnect: ((arg0: string) => void)|null;
  constructor() {
    this.onMessage = null;
    this.#onDisconnect = null;
  }

  setOnMessage(onMessage: (arg0: (Object|string)) => void): void {
    this.onMessage = onMessage;
  }

  setOnDisconnect(onDisconnect: (arg0: string) => void): void {
    this.#onDisconnect = onDisconnect;
  }

  sendRawMessage(message: string): void {
    window.setTimeout(this.respondWithError.bind(this, message), 0);
  }

  private respondWithError(message: string): void {
    const messageObject = JSON.parse(message);
    const error = {
      message: 'This is a stub connection, can\'t dispatch message.',
      code: ProtocolClient.InspectorBackend.DevToolsStubErrorCode,
      data: messageObject,
    };
    if (this.onMessage) {
      this.onMessage.call(null, {id: messageObject.id, error});
    }
  }

  async disconnect(): Promise<void> {
    if (this.#onDisconnect) {
      this.#onDisconnect.call(null, 'force disconnect');
    }
    this.#onDisconnect = null;
    this.onMessage = null;
  }
}

export interface ParallelConnectionInterface extends ProtocolClient.InspectorBackend.Connection {
  getSessionId: () => string;
  getOnDisconnect: () => ((arg0: string) => void) | null;
}

export class ParallelConnection implements ParallelConnectionInterface {
  readonly #connection: ProtocolClient.InspectorBackend.Connection;
  #sessionId: string;
  onMessage: ((arg0: Object) => void)|null;
  #onDisconnect: ((arg0: string) => void)|null;
  constructor(connection: ProtocolClient.InspectorBackend.Connection, sessionId: string) {
    this.#connection = connection;
    this.#sessionId = sessionId;
    this.onMessage = null;
    this.#onDisconnect = null;
  }

  setOnMessage(onMessage: (arg0: Object) => void): void {
    this.onMessage = onMessage;
  }

  setOnDisconnect(onDisconnect: (arg0: string) => void): void {
    this.#onDisconnect = onDisconnect;
  }

  getOnDisconnect(): ((arg0: string) => void)|null {
    return this.#onDisconnect;
  }

  sendRawMessage(message: string): void {
    const messageObject = JSON.parse(message);
    // If the message isn't for a specific session, it must be for the root session.
    if (!messageObject.sessionId) {
      messageObject.sessionId = this.#sessionId;
    }
    this.#connection.sendRawMessage(JSON.stringify(messageObject));
  }

  getSessionId(): string {
    return this.#sessionId;
  }

  async disconnect(): Promise<void> {
    if (this.#onDisconnect) {
      this.#onDisconnect.call(null, 'force disconnect');
    }
    this.#onDisconnect = null;
    this.onMessage = null;
  }
}

export async function initMainConnection(
    createRootTarget: () => Promise<void>,
    onConnectionLost: (message: Platform.UIString.LocalizedString) => void): Promise<void> {
  ProtocolClient.InspectorBackend.Connection.setFactory(createMainConnection.bind(null, onConnectionLost));
  await createRootTarget();
  Host.InspectorFrontendHost.InspectorFrontendHostInstance.connectionReady();
}

function createMainConnection(onConnectionLost: (message: Platform.UIString.LocalizedString) => void):
    ProtocolClient.InspectorBackend.Connection {
  if (Root.Runtime.getPathName().includes('rehydrated_devtools_app')) {
    return new RehydratingConnection(onConnectionLost);
  }
  const wsParam = Root.Runtime.Runtime.queryParam('ws');
  const wssParam = Root.Runtime.Runtime.queryParam('wss');
  if (wsParam || wssParam) {
    const ws = (wsParam ? `ws://${wsParam}` : `wss://${wssParam}`) as Platform.DevToolsPath.UrlString;
    return new WebSocketConnection(ws, onConnectionLost);
  }
  if (Host.InspectorFrontendHost.InspectorFrontendHostInstance.isHostedMode()) {
    // Hosted mode (e.g. `http://localhost:9222/devtools/inspector.html`) but no WebSocket URL.
    return new StubConnection();
  }

  return new MainConnection();
}
