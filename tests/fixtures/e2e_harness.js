import { vi } from 'vitest';
import { GalaxyS25Ultra } from './devices.js';

export function createMockElement(id = '', tag = 'div', onIdChange = null) {
  const classListSet = new Set();
  const attributes = {};
  const listeners = {};
  const children = [];
  let _id = id;

  const el = {
    tagName: tag.toUpperCase(),
    textContent: '',
    innerHTML: '',
    style: {},
    onclick: null,
    parentNode: null,
    classList: {
      add: vi.fn((...classes) => classes.forEach(c => classListSet.add(c))),
      remove: vi.fn((...classes) => classes.forEach(c => classListSet.delete(c))),
      contains: vi.fn((c) => classListSet.has(c)),
      toggle: vi.fn((c) => {
        if (classListSet.has(c)) {
          classListSet.delete(c);
          return false;
        }
        classListSet.add(c);
        return true;
      })
    },
    setAttribute: vi.fn((k, v) => { attributes[k] = String(v); }),
    getAttribute: vi.fn((k) => attributes[k] !== undefined ? attributes[k] : null),
    removeAttribute: vi.fn((k) => { delete attributes[k]; }),
    addEventListener: vi.fn((evt, fn) => {
      listeners[evt] = listeners[evt] || [];
      listeners[evt].push(fn);
    }),
    removeEventListener: vi.fn((evt, fn) => {
      if (listeners[evt]) {
        listeners[evt] = listeners[evt].filter(f => f !== fn);
      }
    }),
    dispatchEvent: vi.fn((evt) => {
      const type = evt.type || 'click';
      if (listeners[type]) {
        listeners[type].forEach(fn => fn(evt));
      }
      return !evt.defaultPrevented;
    }),
    click: vi.fn(() => {
      const evt = {
        type: 'click',
        defaultPrevented: false,
        stopPropagation: vi.fn(),
        preventDefault: vi.fn(() => { evt.defaultPrevented = true; })
      };
      if (typeof el.onclick === 'function') {
        el.onclick(evt);
      }
      if (listeners['click']) {
        listeners['click'].forEach(fn => fn(evt));
      }
    }),
    appendChild: vi.fn((child) => {
      children.push(child);
      child.parentNode = el;
      return child;
    }),
    removeChild: vi.fn((child) => {
      const idx = children.indexOf(child);
      if (idx !== -1) children.splice(idx, 1);
      child.parentNode = null;
      return child;
    }),
    remove: vi.fn(() => {
      if (el.parentNode && typeof el.parentNode.removeChild === 'function') {
        el.parentNode.removeChild(el);
      }
    }),
    select: vi.fn(),
    focus: vi.fn(),
    get children() { return children; }
  };

  Object.defineProperty(el, 'id', {
    configurable: true,
    get: () => _id,
    set: (v) => {
      const old = _id;
      _id = v;
      if (onIdChange) onIdChange(v, old, el);
    }
  });

  return el;
}

export function createMockCanvas(width = 412, height = 915) {
  const listeners = {};
  const contextMock = {
    setTransform: vi.fn(),
    scale: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    strokeRect: vi.fn(),
    createLinearGradient: vi.fn().mockReturnValue({
      addColorStop: vi.fn()
    }),
    createRadialGradient: vi.fn().mockReturnValue({
      addColorStop: vi.fn()
    })
  };

  const canvas = {
    tagName: 'CANVAS',
    width: width,
    height: height,
    clientWidth: width,
    clientHeight: height,
    style: {
      width: `${width}px`,
      height: `${height}px`
    },
    getContext: vi.fn().mockReturnValue(contextMock),
    getBoundingClientRect: vi.fn().mockReturnValue({
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width: width,
      height: height
    }),
    addEventListener: vi.fn((type, fn, opts) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push({ fn, opts });
    }),
    removeEventListener: vi.fn((type, fn) => {
      if (listeners[type]) {
        listeners[type] = listeners[type].filter(item => item.fn !== fn);
      }
    }),
    dispatchCanvasEvent: (type, eventData) => {
      const event = {
        type,
        cancelable: true,
        defaultPrevented: false,
        preventDefault: vi.fn(() => {
          event.defaultPrevented = true;
        }),
        stopPropagation: vi.fn(),
        ...eventData
      };
      if (listeners[type]) {
        listeners[type].forEach(item => item.fn(event));
      }
      return event;
    },
    getListeners: (type) => listeners[type] || []
  };

  return canvas;
}

export function createMockStorage() {
  const store = new Map();
  let quotaExceeded = false;

  return {
    getItem: vi.fn((k) => store.has(k) ? store.get(k) : null),
    setItem: vi.fn((k, v) => {
      if (quotaExceeded) {
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.set(k, String(v));
    }),
    removeItem: vi.fn((k) => store.delete(k)),
    clear: vi.fn(() => store.clear()),
    get length() { return store.size; },
    key: vi.fn((i) => Array.from(store.keys())[i] || null),
    _setQuotaExceeded: (val) => { quotaExceeded = val; },
    _getRawStore: () => store
  };
}

export function createMockAudioContext() {
  let state = 'suspended';

  class MockAudioParam {
    constructor(defaultVal = 0) {
      this.value = defaultVal;
      this.setValueAtTime = vi.fn().mockReturnThis();
      this.linearRampToValueAtTime = vi.fn().mockReturnThis();
      this.exponentialRampToValueAtTime = vi.fn().mockReturnThis();
      this.setTargetAtTime = vi.fn().mockReturnThis();
      this.cancelScheduledValues = vi.fn().mockReturnThis();
    }
  }

  class MockGainNode {
    constructor() {
      this.gain = new MockAudioParam(1);
      this.connect = vi.fn().mockReturnThis();
      this.disconnect = vi.fn().mockReturnThis();
    }
  }

  class MockOscillatorNode {
    constructor() {
      this.type = 'sine';
      this.frequency = new MockAudioParam(440);
      this.connect = vi.fn().mockReturnThis();
      this.disconnect = vi.fn().mockReturnThis();
      this.start = vi.fn();
      this.stop = vi.fn();
    }
  }

  class MockBiquadFilterNode {
    constructor() {
      this.type = 'lowpass';
      this.frequency = new MockAudioParam(1000);
      this.Q = new MockAudioParam(1);
      this.connect = vi.fn().mockReturnThis();
      this.disconnect = vi.fn().mockReturnThis();
    }
  }

  class MockAudioBufferSourceNode {
    constructor() {
      this.buffer = null;
      this.connect = vi.fn().mockReturnThis();
      this.disconnect = vi.fn().mockReturnThis();
      this.start = vi.fn();
      this.stop = vi.fn();
    }
  }

  class MockAudioBuffer {
    constructor(options = {}) {
      this.numberOfChannels = options.numberOfChannels || 1;
      this.length = options.length || 44100;
      this.sampleRate = options.sampleRate || 44100;
      this._data = new Float32Array(this.length);
    }
    getChannelData() {
      return this._data;
    }
  }

  return class MockAudioContext {
    constructor() {
      this.currentTime = 0;
      this.destination = {};
      this.sampleRate = 44100;
    }
    get state() { return state; }
    resume() {
      state = 'running';
      return Promise.resolve();
    }
    suspend() {
      state = 'suspended';
      return Promise.resolve();
    }
    close() {
      state = 'closed';
      return Promise.resolve();
    }
    createGain() { return new MockGainNode(); }
    createOscillator() { return new MockOscillatorNode(); }
    createBiquadFilter() { return new MockBiquadFilterNode(); }
    createBufferSource() { return new MockAudioBufferSourceNode(); }
    createBuffer(channels, length, rate) {
      return new MockAudioBuffer({ numberOfChannels: channels, length, sampleRate: rate });
    }
  };
}

export function setupFullE2EEnvironment(options = {}) {
  const width = options.width || GalaxyS25Ultra.viewport.width; // 412
  const height = options.height || GalaxyS25Ultra.viewport.height; // 915
  const dpr = options.devicePixelRatio !== undefined ? options.devicePixelRatio : GalaxyS25Ultra.deviceScaleFactor; // 3.5
  const search = options.search || '';

  const elements = {};
  const getOrCreate = (id, tag = 'div') => {
    if (!elements[id]) {
      const el = createMockElement(id, tag, (newId, oldId, element) => {
        if (oldId && elements[oldId] === element) delete elements[oldId];
        if (newId) elements[newId] = element;
      });
      elements[id] = el;
    }
    return elements[id];
  };

  const body = createMockElement('body', 'body');
  const expectedIds = [
    'game-container', 'challenge-banner', 'challenge-text', 'hud-top',
    'hud-score', 'hud-multiplier', 'hud-best', 'start-screen',
    'game-over-screen', 'new-record-badge', 'game-over-score',
    'game-over-best', 'summary-score', 'summary-best',
    'challenge-result-row', 'summary-challenge', 'btn-replay',
    'btn-retry', 'btn-share-score', 'btn-share', 'toast-container',
    'btn-install'
  ];

  for (const id of expectedIds) {
    const el = getOrCreate(id);
    body.appendChild(el);
  }

  // Initial UI state matching index.html
  elements['challenge-banner'].classList.add('hidden');
  elements['game-over-screen'].classList.add('hidden');
  elements['new-record-badge'].classList.add('hidden');
  elements['challenge-result-row'].classList.add('hidden');
  elements['hud-score'].textContent = '0';
  elements['hud-multiplier'].textContent = '1x';
  elements['hud-best'].textContent = '0';
  elements['game-over-score'].textContent = '0';
  elements['game-over-best'].textContent = '0';

  const mockCanvas = createMockCanvas(width, height);
  elements['game-canvas'] = mockCanvas;
  body.appendChild(mockCanvas);

  const mockDoc = {
    body,
    documentElement: {
      clientWidth: width,
      clientHeight: height,
      scrollWidth: width,
      scrollHeight: height
    },
    getElementById: vi.fn((id) => elements[id] || null),
    querySelector: vi.fn((sel) => {
      if (sel === 'canvas' || sel === '#game-canvas') return mockCanvas;
      if (sel.startsWith('#')) return elements[sel.slice(1)] || null;
      return null;
    }),
    querySelectorAll: vi.fn(() => []),
    createElement: vi.fn((tag) => {
      const el = createMockElement('', tag, (newId, oldId, element) => {
        if (oldId && elements[oldId] === element) delete elements[oldId];
        if (newId) elements[newId] = element;
      });
      return el;
    }),
    execCommand: vi.fn(() => true)
  };

  const mockStorage = createMockStorage();

  const shareLog = [];
  const clipboardLog = [];
  let shareError = null;

  const mockNavigator = {
    userAgent: GalaxyS25Ultra.userAgent,
    share: vi.fn(async (data) => {
      if (shareError) throw shareError;
      shareLog.push(data);
      return true;
    }),
    clipboard: {
      writeText: vi.fn(async (text) => {
        clipboardLog.push(text);
        return true;
      })
    },
    canShare: vi.fn(() => true)
  };

  const mockLocation = {
    href: `http://localhost:8080/${search ? '?' + search.replace(/^\?/, '') : ''}`,
    search: search ? (search.startsWith('?') ? search : '?' + search) : '',
    pathname: '/index.html',
    origin: 'http://localhost:8080',
    hostname: 'localhost',
    port: '8080',
    protocol: 'http:'
  };

  const mockWindowListeners = {};
  const mockWindow = {
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: dpr,
    location: mockLocation,
    document: mockDoc,
    localStorage: mockStorage,
    navigator: mockNavigator,
    isSecureContext: true,
    addEventListener: vi.fn((evt, fn) => {
      mockWindowListeners[evt] = mockWindowListeners[evt] || [];
      mockWindowListeners[evt].push(fn);
    }),
    removeEventListener: vi.fn((evt, fn) => {
      if (mockWindowListeners[evt]) {
        mockWindowListeners[evt] = mockWindowListeners[evt].filter(f => f !== fn);
      }
    }),
    dispatchEvent: vi.fn((evt) => {
      if (mockWindowListeners[evt.type]) {
        mockWindowListeners[evt.type].forEach(fn => fn(evt));
      }
    }),
    scrollTo: vi.fn(),
    scrollBy: vi.fn()
  };

  // Wire globals using Object.defineProperty to safely override existing getters in Node
  const originalNavigator = Object.getOwnPropertyDescriptor(global, 'navigator');
  const originalWindow = Object.getOwnPropertyDescriptor(global, 'window');
  const originalDoc = Object.getOwnPropertyDescriptor(global, 'document');
  const originalStorage = Object.getOwnPropertyDescriptor(global, 'localStorage');
  const originalLocation = Object.getOwnPropertyDescriptor(global, 'location');
  const originalAudio = Object.getOwnPropertyDescriptor(global, 'AudioContext');

  Object.defineProperty(global, 'window', { value: mockWindow, writable: true, configurable: true });
  Object.defineProperty(global, 'document', { value: mockDoc, writable: true, configurable: true });
  Object.defineProperty(global, 'navigator', { value: mockNavigator, writable: true, configurable: true });
  Object.defineProperty(global, 'localStorage', { value: mockStorage, writable: true, configurable: true });
  Object.defineProperty(global, 'location', { value: mockLocation, writable: true, configurable: true });
  const mockAudio = createMockAudioContext();
  mockWindow.AudioContext = mockAudio;
  mockWindow.webkitAudioContext = mockAudio;
  Object.defineProperty(global, 'AudioContext', { value: mockAudio, writable: true, configurable: true });
  Object.defineProperty(global, 'webkitAudioContext', { value: mockAudio, writable: true, configurable: true });

  return {
    window: mockWindow,
    document: mockDoc,
    canvas: mockCanvas,
    elements,
    storage: mockStorage,
    navigator: mockNavigator,
    shareLog,
    clipboardLog,
    setShareError: (err) => { shareError = err; },
    cleanup: () => {
      if (originalNavigator) Object.defineProperty(global, 'navigator', originalNavigator);
      else delete global.navigator;
      if (originalWindow) Object.defineProperty(global, 'window', originalWindow);
      else delete global.window;
      if (originalDoc) Object.defineProperty(global, 'document', originalDoc);
      else delete global.document;
      if (originalStorage) Object.defineProperty(global, 'localStorage', originalStorage);
      else delete global.localStorage;
      if (originalLocation) Object.defineProperty(global, 'location', originalLocation);
      else delete global.location;
      if (originalAudio) Object.defineProperty(global, 'AudioContext', originalAudio);
      else delete global.AudioContext;
      delete global.webkitAudioContext;
    }
  };
}
