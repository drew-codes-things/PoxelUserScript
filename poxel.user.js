// ==UserScript==
// @name         Poxel.io
// @namespace    https://poxel.io/
// @version      1.1.0
// @description  Wall ESP, aim assist, damage multiplier, headshot/weapon spoof (+ discovered gunID list), spacebar spam, FPS boost, anti-AFK, reward bypass, ad blocker, crosshair. INSERT to toggle menu.
// @match        https://poxel.io/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(() => {
'use strict';

const cfg = {
    esp:            true,
    depthThreshold: 4.5,
    minVertices:    192,
    maxVertices:    192,

    aimAssist:   false,
    aimStrength: 3.0,
    aimFOV:      250,

    dmgEnabled:    false,
    dmgMultiplier: 20,

    headshotSpoof:   false,
    headshotHitName: 4,
    weaponSpoof:     false,
    weaponSpoofId:   36,

    spacebarSpam: false,
    fpsBoost:     false,

    antiAFK: false,

    adBypass: false,

    adBlock: false,

    crosshair:      false,
    crosshairStyle: 'dot',
};

let gl             = null;
let frameCount     = 0;
let menuOpen       = false;

const discoveredGunIds = new Map();

const KNOWN_CLASSES = [
    'Patriot (PK-47)', 'Bullseye (Double-Barrel Shotgun)', 'Cowboy (Sniper Rifle)',
    'Terrorist (Rocket Launcher)', 'Captian (M4-A1)', 'Blitzer (Minigun)',
    'Jason (MP5)', 'Flashman (MAC-10)', 'Hunter (Bow)', 'Splatter (Paintball Gun)',
];

let crosshairEl = null;

function fixstrKey(name) {
    const b = new TextEncoder().encode(name);
    return new Uint8Array([0xa0 | b.length, ...b]);
}

const _OrigWS = window.WebSocket;

window.WebSocket = function (...args) {
    const ws = new _OrigWS(...args);

    const _origSend = ws.send.bind(ws);
    ws.send = function (data) {
        if (cfg.dmgEnabled)    data = patchDamage(data) ?? data;
        if (cfg.headshotSpoof) data = patchHitName(data) ?? data;
        if (cfg.weaponSpoof)   data = patchWeapon(data) ?? data;
        _origSend(data);
    };

    return ws;
};
window.WebSocket.prototype = _OrigWS.prototype;
Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });

function readMsgpackInt(view, pos) {
    const tag = view.getUint8(pos);
    if (tag <= 0x7f)        return { value: tag,                            size: 1 };
    if (tag >= 0xe0)        return { value: tag - 256,                      size: 1 };
    if (tag === 0xcc)       return { value: view.getUint8(pos + 1),         size: 2 };
    if (tag === 0xcd)       return { value: view.getUint16(pos + 1, false), size: 3 };
    if (tag === 0xce)       return { value: view.getUint32(pos + 1, false), size: 5 };
    if (tag === 0xd0)       return { value: view.getInt8(pos + 1),          size: 2 };
    if (tag === 0xd1)       return { value: view.getInt16(pos + 1, false),  size: 3 };
    if (tag === 0xd2)       return { value: view.getInt32(pos + 1, false),  size: 5 };
    if (tag === 0xca)       return { value: view.getFloat32(pos + 1, false), size: 5 };
    if (tag === 0xcb)       return { value: view.getFloat64(pos + 1, false), size: 9 };
    return null;
}

function encodeMsgpackValue(newValue) {
    if (!Number.isInteger(newValue)) {
        const tmp = new DataView(new ArrayBuffer(5));
        tmp.setUint8(0, 0xca);
        tmp.setFloat32(1, newValue, false);
        return new Uint8Array(tmp.buffer);
    }
    if (newValue >= 0) {
        if (newValue <= 0x7f)   return new Uint8Array([newValue]);
        if (newValue <= 0xff)   return new Uint8Array([0xcc, newValue]);
        if (newValue <= 0xffff) return new Uint8Array([0xcd, newValue >> 8, newValue & 0xff]);
        return new Uint8Array([0xce, (newValue >>> 24) & 0xff, (newValue >>> 16) & 0xff, (newValue >>> 8) & 0xff, newValue & 0xff]);
    }
    if (newValue >= -32)    return new Uint8Array([0xe0 | (newValue + 32)]);
    if (newValue >= -128)   return new Uint8Array([0xd0, newValue & 0xff]);
    if (newValue >= -32768) return new Uint8Array([0xd1, (newValue >> 8) & 0xff, newValue & 0xff]);
    return new Uint8Array([0xd2, (newValue >>> 24) & 0xff, (newValue >>> 16) & 0xff, (newValue >>> 8) & 0xff, newValue & 0xff]);
}

function patchIntegerField(data, keyBytes, computeNewValue) {
    if (!data) return null;
    let bytes;
    if (data instanceof ArrayBuffer)       bytes = new Uint8Array(data);
    else if (ArrayBuffer.isView(data))     bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    else                                   return null;

    let valuePos = -1;
    outer: for (let i = 2; i <= bytes.length - keyBytes.length; i++) {
        for (let j = 0; j < keyBytes.length; j++) {
            if (bytes[i + j] !== keyBytes[j]) continue outer;
        }
        valuePos = i + keyBytes.length;
        break;
    }
    if (valuePos < 0 || valuePos >= bytes.length) return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const read = readMsgpackInt(view, valuePos);
    if (!read) return null;

    const newValue = computeNewValue(read.value);
    if (newValue == null) return null;
    const newBytes = encodeMsgpackValue(newValue);

    const out = new Uint8Array(bytes.length - read.size + newBytes.length);
    out.set(bytes.subarray(0, valuePos), 0);
    out.set(newBytes, valuePos);
    out.set(bytes.subarray(valuePos + read.size), valuePos + newBytes.length);
    return out.buffer;
}

const DMG_KEY_INT = fixstrKey('amount');

function patchDamage(data) {
    return patchIntegerField(data, DMG_KEY_INT, v => (v > 0 ? v * cfg.dmgMultiplier : null)) ?? data;
}

function patchHitName(data) {
    return patchIntegerField(data, fixstrKey('hitName'), () => cfg.headshotHitName) ?? data;
}

function patchWeapon(data) {
    return patchIntegerField(data, fixstrKey('gunID'), () => cfg.weaponSpoofId) ?? data;
}

setInterval(() => {
    if (!cfg.spacebarSpam) return;
    if (!document.pointerLockElement) return;
    for (const type of ['keydown', 'keyup']) {
        document.dispatchEvent(new KeyboardEvent(type, {
            key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true, cancelable: true
        }));
    }
}, 90);

setInterval(() => {
    if (!cfg.antiAFK) return;
    if (!document.pointerLockElement) return;
    if (window.unityInstance && typeof window.unityInstance.SendMessage === 'function') {
        try { window.unityInstance.SendMessage('AFKManager', 'ResetInactivityTimer'); } catch (e) {}
    }
}, 20000);

function grantAdReward() {
    if (window.unityInstance && typeof window.unityInstance.SendMessage === 'function') {
        try { window.unityInstance.SendMessage('SDKManager', 'OnVideoAdEnded', 'true'); } catch (e) {}
    }
}

const _origSetTimeout = window.setTimeout;
window.setTimeout = function (callback, delay, ...args) {
    if (cfg.adBypass && delay === 7000 && typeof callback === 'function') {
        callback(...args);
        return 0;
    }
    return _origSetTimeout(callback, delay, ...args);
};

if (!window.SDK) {
    window.SDK = {
        showRewarded(reason) {
            if (cfg.adBypass) setTimeout(grantAdReward, rnd(200, 800));
            return Promise.resolve({ success: !!cfg.adBypass });
        }
    };
}

let _sendMessagePatched = false;
const _sdkPollInterval = setInterval(() => {
    if (typeof window.unityInstance === 'undefined' || _sendMessagePatched) return;
    _sendMessagePatched = true;
    clearInterval(_sdkPollInterval);
    const orig = window.unityInstance.SendMessage;
    window.unityInstance.SendMessage = function (objectName, methodName, param) {
        if (cfg.adBypass && objectName === 'SDKManager' && methodName === 'OnVideoAdEnded' && param === 'false') {
            param = 'true';
        }
        return orig.call(this, objectName, methodName, param);
    };
}, 300);

const _overriddenProviders = new Set();
function scanAdProviders() {
    if (!cfg.adBypass) return;
    for (const key in window) {
        if (!Object.prototype.hasOwnProperty.call(window, key) || _overriddenProviders.has(key)) continue;
        let obj;
        try { obj = window[key]; } catch (e) { continue; }
        if (!obj || typeof obj !== 'object') continue;
        if (typeof obj.showRewarded !== 'function' && typeof obj.showMidroll !== 'function') continue;

        if (typeof obj.showRewarded === 'function') {
            obj.showRewarded = function (...args) {
                if (!cfg.adBypass) return Promise.resolve(false);
                setTimeout(grantAdReward, rnd(150, 900));
                args.forEach(a => typeof a === 'function' && a(true));
                return Promise.resolve(true);
            };
        }
        if (typeof obj.showMidroll === 'function') {
            obj.showMidroll = function (...args) {
                if (!cfg.adBypass) return Promise.resolve(false);
                setTimeout(grantAdReward, rnd(150, 900));
                args.forEach(a => typeof a === 'function' && a(true));
                return Promise.resolve(true);
            };
        }
        _overriddenProviders.add(key);
    }
}
setInterval(scanAdProviders, 600);
window.addEventListener('load', () => setTimeout(scanAdProviders, 2000));

const GUNID_LOG_RE = /Tracked kill with weapon ID (-?\d+)/;
const _origConsoleLog = console.log;
console.log = function (...args) {
    const line = args.join(' ');
    if (cfg.adBypass && line.includes('[SDKManager] ShowAd start WebGL: type=Rewarded')) {
        setTimeout(grantAdReward, 100);
    }
    const m = line.match(GUNID_LOG_RE);
    if (m) {
        const id = parseInt(m[1], 10);
        if (!discoveredGunIds.has(id)) {
            discoveredGunIds.set(id, '');
            updateDiscoveredGunIds();
        }
    }
    _origConsoleLog.apply(console, args);
};

function updateDiscoveredGunIds() {
    const el = document.getElementById('pm-gunids');
    if (!el) return;
    if (discoveredGunIds.size === 0) {
        el.textContent = 'none seen yet - get a kill to discover one';
        return;
    }
    el.innerHTML = '';
    for (const [id, label] of [...discoveredGunIds].sort((a, b) => a[0] - b[0])) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:3px 0';

        const btn = document.createElement('button');
        btn.className = 'pm-btn';
        btn.style.cssText = 'font-size:9px;padding:2px 6px;flex-shrink:0';
        btn.textContent = label ? `${id} (${label})` : id;
        btn.title = 'Click to set as Weapon Spoof ID';
        btn.addEventListener('click', () => {
            cfg.weaponSpoofId = id;
            const input = document.getElementById('i-weaponid');
            if (input) input.value = id;
        });

        const select = document.createElement('select');
        select.style.cssText = 'font-size:9px;background:var(--void);border:1px solid var(--line);color:var(--dim);font-family:var(--mono);padding:2px 4px;border-radius:2px;flex:1;min-width:0';
        const blank = document.createElement('option');
        blank.value = '';
        blank.textContent = '- label -';
        select.appendChild(blank);
        for (const cls of KNOWN_CLASSES) {
            const opt = document.createElement('option');
            opt.value = cls;
            opt.textContent = cls;
            if (cls === label) opt.selected = true;
            select.appendChild(opt);
        }
        select.addEventListener('change', () => {
            discoveredGunIds.set(id, select.value);
            updateDiscoveredGunIds();
        });

        row.appendChild(btn);
        row.appendChild(select);
        el.appendChild(row);
    }
}

HTMLCanvasElement.prototype.getContext = new Proxy(HTMLCanvasElement.prototype.getContext, {
    apply(target, thisArg, args) {
        if (args[1]) {
            args[1].preserveDrawingBuffer = true;
            if (cfg.fpsBoost) {
                args[1].antialias = false;
                args[1].powerPreference = 'high-performance';
            }
        }
        const ctx = Reflect.apply(...arguments);
        if (!gl && (args[0] === 'webgl2' || args[0] === 'webgl')) gl = ctx;
        return ctx;
    }
});

const WebGL = WebGL2RenderingContext.prototype;

WebGL.shaderSource = new Proxy(WebGL.shaderSource, {
    apply(target, thisArg, args) {
        let [shader, source] = args;
        if (source.indexOf('gl_Position') > -1) {
            if (source.indexOf('unity_ObjectToWorld') > -1) shader.isPlayerShader = true;
            source = source
                .replace('void main',
                    `out float vDepth;
                    out vec3 vWorldPos;
                    uniform bool uESP;
                    uniform float uDepthCut;
                    void main`)
                .replace(/return;/,
                    `vDepth = gl_Position.z;
                    vWorldPos = gl_Position.xyz;
                    if (uESP && vDepth > uDepthCut) { gl_Position.z = 1.0; }
                    `);
        } else if (source.indexOf('SV_Target0') > -1) {
            source = source
                .replace('void main',
                    `in float vDepth;
                    in vec3 vWorldPos;
                    uniform bool uESP;
                    uniform float uDepthCut;
                    void main`)
                .replace(/return;/,
                    `if (uESP && vDepth > uDepthCut) { SV_Target0 = vec4(1.0, 0.3, 0.5, 1.0); }
                    `);
        }
        args[1] = source;
        return Reflect.apply(...arguments);
    }
});

WebGL.attachShader = new Proxy(WebGL.attachShader, {
    apply(target, thisArg, [program, shader]) {
        if (shader.isPlayerShader) program.isPlayerProgram = true;
        return Reflect.apply(...arguments);
    }
});

WebGL.getUniformLocation = new Proxy(WebGL.getUniformLocation, {
    apply(target, thisArg, [program, name]) {
        const loc = Reflect.apply(...arguments);
        if (loc) { loc.name = name; loc.program = program; }
        return loc;
    }
});

WebGL.uniform4fv = new Proxy(WebGL.uniform4fv, {
    apply(target, thisArg, args) {
        const [loc] = args;
        const n = loc?.name;
        if (n === 'unity_ObjectToWorld' || n === 'unity_ObjectToWorld[0]') loc.program.isUIProgram = true;
        return Reflect.apply(...arguments);
    }
});

const drawHandler = {
    apply(target, thisArg, args) {
        const prog = thisArg.getParameter(thisArg.CURRENT_PROGRAM);
        if (!prog) return Reflect.apply(...arguments);
        if (!prog._u) {
            prog._u = {
                esp:   thisArg.getUniformLocation(prog, 'uESP'),
                depth: thisArg.getUniformLocation(prog, 'uDepthCut'),
            };
        }
        const vc       = args[1];
        const isPlayer = prog.isPlayerProgram && vc >= cfg.minVertices && vc <= cfg.maxVertices;
        if (prog._u.esp)   thisArg.uniform1i(prog._u.esp,   cfg.esp && isPlayer ? 1 : 0);
        if (prog._u.depth) thisArg.uniform1f(prog._u.depth, cfg.depthThreshold);
        return Reflect.apply(...arguments);
    }
};

WebGL.drawElements          = new Proxy(WebGL.drawElements,          drawHandler);
WebGL.drawElementsInstanced = new Proxy(WebGL.drawElementsInstanced, drawHandler);

window.requestAnimationFrame = new Proxy(window.requestAnimationFrame, {
    apply(target, thisArg, args) {
        if (typeof args[0] === 'function') {
            args[0] = new Proxy(args[0], {
                apply() {
                    frameCount++;
                    if (cfg.aimAssist && frameCount % 2 === 0) runAimAssist();
                    const result = Reflect.apply(...arguments);
                    return result;
                }
            });
        }
        return Reflect.apply(...arguments);
    }
});

function runAimAssist() {
    if (!gl) return;
    const canvas = document.querySelector('canvas');
    if (!canvas || canvas.style.cursor !== 'none') return;

    const cw  = gl.canvas.width, ch = gl.canvas.height;
    const fov = Math.min(cfg.aimFOV, cw, ch);
    const sx  = Math.floor(cw / 2 - fov / 2);
    const sy  = Math.floor(ch / 2 - fov / 2);
    const buf = new Uint8Array(fov * fov * 4);

    try { gl.readPixels(sx, sy, fov, fov, gl.RGBA, gl.UNSIGNED_BYTE, buf); }
    catch (e) { return; }

    let sumX = 0, sumY = 0, count = 0;
    for (let i = 0; i < buf.length; i += 4) {
        if (buf[i] === 255 && buf[i+1] <= 80 && buf[i+2] >= 100 && buf[i+2] <= 150 && buf[i+3] === 255) {
            const idx = i / 4;
            sumX += idx % fov;
            sumY += Math.floor(idx / fov);
            count++;
        }
    }
    if (count < 8) return;

    const half = fov / 2;
    let dx = ((sumX / count) - half) * cfg.aimStrength;
    let dy = ((sumY / count) - half) * cfg.aimStrength;
    if (Math.abs(dx) < 0.4 && Math.abs(dy) < 0.4) return;

    const cap = 60;
    dx = Math.max(-cap, Math.min(cap, dx));
    dy = Math.max(-cap, Math.min(cap, dy));
    window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy }));
}

const CROSSHAIR_STYLES = {
    dot:    { width: '8px',  height: '8px',  backgroundColor: 'red',         border: 'none', borderRadius: '50%' },
    cross:  { width: '2px',  height: '30px', backgroundColor: 'lime' },
    x:      { width: '2px',  height: '30px', backgroundColor: 'transparent', borderLeft: '2px solid lime', borderBottom: '2px solid lime' },
    circle: { width: '30px', height: '30px', backgroundColor: 'transparent', border: '2px solid yellow', borderRadius: '50%' },
};

function buildCrosshair() {
    crosshairEl = document.createElement('div');
    crosshairEl.id = 'pm-crosshair';
    document.body.appendChild(crosshairEl);
    applyCrosshairStyle(cfg.crosshairStyle);
    updateCrosshairVisibility();
}

function applyCrosshairStyle(name) {
    if (!crosshairEl || !CROSSHAIR_STYLES[name]) return;
    crosshairEl.removeAttribute('style');
    Object.assign(crosshairEl.style, {
        position: 'fixed', top: '50%', left: '50%', zIndex: '9999', pointerEvents: 'none',
        transform: name === 'x' ? 'translate(-50%, -50%) rotate(45deg)' : 'translate(-50%, -50%)',
    }, CROSSHAIR_STYLES[name]);
}

function updateCrosshairVisibility() {
    if (crosshairEl) crosshairEl.style.display = cfg.crosshair ? 'block' : 'none';
}

function updateAdBlockState() {
    document.body.classList.toggle('pm-adblock', cfg.adBlock);
}

window.addEventListener('DOMContentLoaded', () => {
    injectStyles();
    buildMenu();
    buildCrosshair();
    updateAdBlockState();
    document.addEventListener('keydown', e => {
        if (e.key === 'Insert') {
            menuOpen = !menuOpen;
            document.getElementById('pm-menu').classList.toggle('open', menuOpen);
        }
        if (e.altKey && e.key.toLowerCase() === 'e') {
            flip('t-esp', 'esp');
            e.preventDefault();
        }
    });
});

function buildMenu() {
    const el = document.createElement('div');
    el.innerHTML = `
<div id="pm-menu">
  <div id="pm-header">
    <span id="pm-title">POXEL.IO</span>
    <button id="pm-close">[×]</button>
  </div>
  <div id="pm-body">

    <div class="pm-group">
    <div class="pm-section">ESP</div>
    <div class="pm-card">
      ${row('t-esp', cfg.esp, 'Wall ESP', 'show enemies through walls', true)}
    </div>
    </div>

    <div class="pm-group">
    <div class="pm-section">AIM ASSIST</div>
    <div class="pm-card">
      ${row('t-aim', cfg.aimAssist, 'Aim Assist', `soft pixel-color pull, max strength (${cfg.aimStrength})`, true)}
    </div>
    </div>

    <div class="pm-group">
    <div class="pm-section">DAMAGE</div>
    <div class="pm-card">
      ${row('t-dmg', cfg.dmgEnabled, 'Damage Multiplier', `scales outgoing hit damage to max (${cfg.dmgMultiplier}x)`)}
      ${row('t-headshot', cfg.headshotSpoof, 'Headshot Spoof', `reports hitName=${cfg.headshotHitName} on every hit · from live capture`)}
      ${row('t-weaponspoof', cfg.weaponSpoof, 'Weapon Spoof', 'reports a chosen gunID on every hit')}
      <div class="pm-row">
        <div class="pm-row-left">
          <span class="pm-name">Weapon ID</span>
          <span class="pm-desc">or click a discovered ID below</span>
        </div>
        <input type="number" id="i-weaponid" value="${cfg.weaponSpoofId}"
          style="width:56px;background:var(--void);border:1px solid var(--line);color:var(--signal);font-family:var(--mono);font-size:11px;padding:4px 6px;border-radius:2px;text-align:center">
      </div>
      <div class="pm-row pm-row-last" style="flex-direction:column;align-items:stretch;gap:4px">
        <span class="pm-name">Discovered Weapon IDs</span>
        <div class="pm-desc" id="pm-gunids">none seen yet - get a kill to discover one</div>
      </div>
    </div>
    </div>

    <div class="pm-group">
    <div class="pm-section">EXTRAS</div>
    <div class="pm-card">
      ${row('t-spacebar', cfg.spacebarSpam, 'Spacebar Spam', 'rapid Space keydown/keyup while in-game')}
      ${row('t-fpsboost', cfg.fpsBoost, 'FPS Boost', 'disables antialiasing, requests high-perf GPU · applies on next context creation')}
      ${row('t-antiafk', cfg.antiAFK, 'Anti-AFK', 'resets the inactivity timer every 20s while in-game', true)}
    </div>
    </div>

    <div class="pm-group">
    <div class="pm-section">CROSSHAIR</div>
    <div class="pm-card">
      ${row('t-crosshair', cfg.crosshair, 'Custom Crosshair', 'overlay marker independent of the in-game one')}
      <div class="pm-row pm-row-last">
        <div class="pm-row-left"><span class="pm-name">Style</span></div>
        <div style="display:flex;gap:4px">
          <button class="pm-btn pm-xhstyle" data-style="dot">DOT</button>
          <button class="pm-btn pm-xhstyle" data-style="cross">LINE</button>
          <button class="pm-btn pm-xhstyle" data-style="x">X</button>
          <button class="pm-btn pm-xhstyle" data-style="circle">RING</button>
        </div>
      </div>
    </div>
    </div>

    <div class="pm-group">
    <div class="pm-section">REWARDS</div>
    <div class="pm-card">
      ${row('t-adbypass', cfg.adBypass, 'Instant Reward', 'skip rewarded-ad videos/cooldowns - grants the reward immediately')}
      ${row('t-adblock', cfg.adBlock, 'Ad Blocker', 'hides the banner ads · confirmed live selectors', true)}
    </div>
    </div>

  </div>
  <div id="pm-footer"><kbd>Insert</kbd> menu &nbsp;·&nbsp; <kbd>Alt+E</kbd> esp</div>
</div>`;
    document.body.appendChild(el);

    const menu   = document.getElementById('pm-menu');
    const header = document.getElementById('pm-header');
    let drag = false, ox = 0, oy = 0;
    header.addEventListener('mousedown', e => {
        if (e.target.closest('#pm-close')) return;
        drag = true; ox = e.clientX - menu.offsetLeft; oy = e.clientY - menu.offsetTop;
    });
    document.addEventListener('mousemove', e => {
        if (!drag) return;
        menu.style.left = clamp(e.clientX - ox, 0, innerWidth  - menu.offsetWidth)  + 'px';
        menu.style.top  = clamp(e.clientY - oy, 0, innerHeight - menu.offsetHeight) + 'px';
    });
    document.addEventListener('mouseup', () => drag = false);
    document.getElementById('pm-close').addEventListener('click', () => {
        menu.classList.remove('open'); menuOpen = false;
    });

    bindToggle('t-esp',         'esp');
    bindToggle('t-aim',         'aimAssist');
    bindToggle('t-dmg',         'dmgEnabled');
    bindToggle('t-headshot',    'headshotSpoof');
    bindToggle('t-weaponspoof', 'weaponSpoof');
    bindToggle('t-spacebar',    'spacebarSpam');
    bindToggle('t-fpsboost',    'fpsBoost');
    bindToggle('t-antiafk',     'antiAFK');
    bindToggle('t-adbypass',    'adBypass');
    bindToggle('t-adblock',     'adBlock');
    bindToggle('t-crosshair',   'crosshair');

    document.getElementById('t-adblock')?.addEventListener('change', updateAdBlockState);

    updateDiscoveredGunIds();

    document.getElementById('i-weaponid')?.addEventListener('input', function () {
        const v = parseInt(this.value, 10);
        if (!Number.isNaN(v)) cfg.weaponSpoofId = v;
    });

    document.getElementById('t-crosshair')?.addEventListener('change', updateCrosshairVisibility);
    const xhButtons = document.querySelectorAll('.pm-xhstyle');
    xhButtons.forEach(btn => {
        btn.classList.toggle('pm-btn-active', btn.dataset.style === cfg.crosshairStyle);
        btn.addEventListener('click', () => {
            cfg.crosshairStyle = btn.dataset.style;
            applyCrosshairStyle(cfg.crosshairStyle);
            xhButtons.forEach(b => b.classList.toggle('pm-btn-active', b === btn));
        });
    });

}

function row(id, val, name, desc, last) {
    return `<div class="pm-row${last ? ' pm-row-last' : ''}">
  <div class="pm-row-left">
    <span class="pm-name">${name}</span>
    <span class="pm-desc">${desc}</span>
  </div>
  <label class="pm-toggle">
    <input type="checkbox" id="${id}"${val ? ' checked' : ''}>
    <span class="pm-lbl">${val ? 'ON' : 'OFF'}</span>
  </label>
</div>`;
}

function bindToggle(id, key) {
    document.getElementById(id)?.addEventListener('change', function () {
        cfg[key] = this.checked;
        const lbl = this.nextElementSibling;
        if (lbl) lbl.textContent = this.checked ? 'ON' : 'OFF';
    });
}

function flip(inputId, key) {
    const inp = document.getElementById(inputId);
    if (!inp) return;
    cfg[key] = !cfg[key];
    inp.checked = cfg[key];
    const lbl = inp.nextElementSibling;
    if (lbl) lbl.textContent = cfg[key] ? 'ON' : 'OFF';
}

function fire(target, type, init) {
    try { target.dispatchEvent(new (type === 'click' ? MouseEvent : KeyboardEvent)(type, init)); }
    catch (e) {}
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function rnd(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

function toast(msg, variant) {
    const t = document.createElement('div');
    t.className = 'pm-toast' + (variant ? ' pm-toast-' + variant : '');
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('pm-toast-show'));
    setTimeout(() => { t.classList.remove('pm-toast-show'); setTimeout(() => t.remove(), 300); }, 2000);
}

function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
#pm-menu {
    --void:   #07090c; --panel:  #0e1116; --raised: #12161c;
    --line:   #1e252b; --signal: #ff4d2e; --phosphor:#35d67c;
    --text:   #d7dbde; --dim:    #7d8891; --faint:  #4b545c;
    --mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
}
#pm-menu, #pm-menu * { box-sizing: border-box; }
#pm-menu {
    position: fixed; top: 40px; left: 40px; width: 660px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 2px;
    font-family: var(--mono); font-size: 12px; color: var(--text);
    z-index: 99999; display: none; user-select: none;
    box-shadow: 0 0 0 1px rgba(255,77,46,.06), 0 24px 64px rgba(0,0,0,.85);
}
#pm-menu::before {
    content: ""; position: absolute; inset: 0; pointer-events: none; z-index: 1;
    background:
        linear-gradient(var(--signal),var(--signal)) top left /10px 2px no-repeat,
        linear-gradient(var(--signal),var(--signal)) top left /2px 10px no-repeat,
        linear-gradient(var(--signal),var(--signal)) top right/10px 2px no-repeat,
        linear-gradient(var(--signal),var(--signal)) top right/2px 10px no-repeat,
        linear-gradient(var(--signal),var(--signal)) bottom left /10px 2px no-repeat,
        linear-gradient(var(--signal),var(--signal)) bottom left /2px 10px no-repeat,
        linear-gradient(var(--signal),var(--signal)) bottom right/10px 2px no-repeat,
        linear-gradient(var(--signal),var(--signal)) bottom right/2px 10px no-repeat;
}
#pm-menu.open { display: block; animation: pm-in .16s ease-out; }
@keyframes pm-in { from{opacity:0;transform:translateY(-5px)} to{opacity:1;transform:translateY(0)} }

#pm-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 8px 12px; background: var(--void); border-bottom: 1px solid var(--line); cursor: move;
}
#pm-title { font-size: 9.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--text); }
#pm-title::after { content: "_"; color: var(--signal); animation: pm-blink 1.1s steps(1) infinite; }
@keyframes pm-blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
#pm-close {
    background: transparent; border: 1px solid var(--line); color: var(--dim);
    font-family: var(--mono); font-size: 10px; padding: 2px 7px;
    cursor: pointer; border-radius: 2px; transition: border-color .15s, color .15s;
}
#pm-close:hover { border-color: var(--signal); color: var(--signal); }

#pm-body {
    padding: 10px 12px;
    column-count: 2; column-gap: 16px;
    max-height: calc(100vh - 110px); overflow-y: auto;
}

.pm-group { break-inside: avoid; -webkit-column-break-inside: avoid; margin-bottom: 10px; }

.pm-section {
    font-size: 8.5px; font-weight: 700; letter-spacing: .14em;
    text-transform: uppercase; color: var(--faint); margin: 12px 0 6px;
}
.pm-section:first-child { margin-top: 0; }
.pm-section::before { content: "// "; color: var(--signal); }

.pm-card {
    position: relative; background: var(--raised);
    border: 1px solid var(--line); border-radius: 2px; overflow: hidden; margin-bottom: 2px;
}
.pm-card::before {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background:
        linear-gradient(var(--signal),var(--signal)) top left /5px 1px no-repeat,
        linear-gradient(var(--signal),var(--signal)) top left /1px 5px no-repeat,
        linear-gradient(var(--signal),var(--signal)) bottom right/5px 1px no-repeat,
        linear-gradient(var(--signal),var(--signal)) bottom right/1px 5px no-repeat;
    opacity: .25;
}

.pm-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 9px 12px; border-bottom: 1px solid var(--line); transition: background .1s;
}
.pm-row:hover { background: rgba(255,77,46,.03); }
.pm-row-last  { border-bottom: none; }
.pm-row-left  { display: flex; flex-direction: column; gap: 2px; }
.pm-name      { font-size: 11.5px; font-weight: 500; color: var(--text); }
.pm-desc      { font-size: 9px; color: var(--faint); }

.pm-btn {
    font-family: var(--mono); font-size: 9.5px; font-weight: 700;
    letter-spacing: .06em; padding: 3px 8px;
    border: 1px solid var(--signal); border-radius: 2px;
    color: var(--signal); background: transparent; cursor: pointer;
    transition: all .15s; white-space: nowrap; flex-shrink: 0;
}
.pm-btn::before { content: "["; }
.pm-btn::after  { content: "]"; }
.pm-btn:hover, .pm-btn.pm-btn-active { background: var(--signal); color: var(--void); }

.pm-toggle    { display: inline-flex; cursor: pointer; }
.pm-toggle input { position: absolute; opacity: 0; width: 0; height: 0; }
.pm-lbl {
    font-family: var(--mono); font-size: 9.5px; font-weight: 700;
    letter-spacing: .06em; padding: 3px 8px; border: 1px solid var(--line);
    border-radius: 2px; color: var(--faint); background: transparent;
    transition: all .15s; min-width: 40px; text-align: center;
}
.pm-lbl::before { content: "["; }
.pm-lbl::after  { content: "]"; }
.pm-toggle input:checked + .pm-lbl {
    color: var(--signal); border-color: var(--signal);
    background: rgba(255,77,46,.08); box-shadow: 0 0 8px rgba(255,77,46,.15);
}

#pm-footer {
    font-size: 9px; color: var(--faint); letter-spacing: .04em;
    padding: 8px 12px; border-top: 1px solid var(--line);
}
#pm-menu kbd {
    background: var(--raised); border: 1px solid var(--line);
    border-radius: 2px; padding: 1px 5px; font-family: var(--mono); font-size: 9px; color: var(--dim);
}

.pm-toast {
    position: fixed; bottom: 32px; left: 50%;
    transform: translateX(-50%) translateY(10px);
    background: #0e1116; border: 1px solid #1e252b; color: #d7dbde;
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 11px; font-weight: 600; padding: 8px 18px; border-radius: 2px;
    z-index: 999999; opacity: 0; pointer-events: none;
    transition: opacity .2s ease, transform .2s ease; white-space: nowrap;
    box-shadow: 0 8px 32px rgba(0,0,0,.7);
}
.pm-toast.pm-toast-show { opacity: 1; transform: translateX(-50%) translateY(0); }
.pm-toast.pm-toast-on   { border-color: #35d67c; color: #35d67c; }
.pm-toast.pm-toast-warn { border-color: #ff4d2e; color: #ff4d2e; }

body.pm-adblock .banner-container { display: none !important; }
`;
    document.head.appendChild(s);
}

})();
