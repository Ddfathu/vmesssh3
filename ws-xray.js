// =============================================================
// WS-XRAY GATEWAY — Filter Payload Enhanced untuk VLESS/VMess/Trojan
// -------------------------------------------------------------
// Pasangan ws-proxy.js (yang itu buat SSH -> Dropbear).
// Yang ini buat Xray: APK injek (HTTP Custom, DarkTunnel, dll)
// ngirim request WebSocket yang dicampur payload enhanced
// (header sampah, request umpan, payload split). Xray nolak
// handshake kotor kayak gitu, jadi gateway ini:
//   1. Baca request mentah dari client (TCP polos, TANPA parser
//      HTTP bawaan Node yang ketat itu)
//   2. Cari blok request yang ASLI (yang ada Upgrade: websocket),
//      blok umpan/sampah sebelumnya DIBUANG
//   3. Bangun ulang request upgrade yang BERSIH ke Xray (8001)
//   4. Balasan 101 dari Xray diteruskan ke client, habis itu
//      tinggal sambung pipa dua arah — isi VLESS/VMess/Trojan
//      di dalam frame WS tidak disentuh sama sekali
// =============================================================
const net = require('net');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LISTEN_PORT = parseInt(process.env.XRAY_WS_PORT || '8882');
const XRAY_HOST = '127.0.0.1';
const XRAY_PORT = parseInt(process.env.XRAY_PORT || '8001');
const MAX_HEADER_BUFFER = 64 * 1024;   // batas scan payload sebelum nyerah
const HEADER_TIMEOUT_MS = 15000;       // payload split boleh telat, tapi jangan selamanya

// 🔍 PATH RESMI DARI FILE PANEL (pathvless.txt / pathvmess.txt / pathtrojan.txt)
function loadAllowedPaths() {
    const paths = new Set();
    for (const f of ['pathvless.txt', 'pathvmess.txt', 'pathtrojan.txt']) {
        try {
            const content = fs.readFileSync(path.join(__dirname, f), 'utf8');
            content.split('\n').map(s => s.trim()).filter(s => s.startsWith('/')).forEach(p => paths.add(p));
        } catch (e) {}
    }
    return paths;
}

// Parsing header longgar ala ws-proxy.js (tahan header aneh bawaan payload)
function parseHeaders(blockText) {
    const headers = {};
    const lines = blockText.split(/\r\n|\n/);
    for (let i = 1; i < lines.length; i++) {
        const idx = lines[i].indexOf(':');
        if (idx > 0) {
            const k = lines[i].slice(0, idx).trim().toLowerCase();
            const v = lines[i].slice(idx + 1).trim();
            if (k) headers[k] = v;
        }
    }
    return headers;
}

// Cari satu blok header utuh (\r\n\r\n atau \n\n) mulai dari posisi `from`.
// Return { blockText, rest } atau null kalau bloknya belum utuh.
function extractBlock(buf, from) {
    const crlf = buf.indexOf('\r\n\r\n', from);
    const lf = buf.indexOf('\n\n', from);
    let end = -1, termLen = 0;
    if (crlf !== -1 && (lf === -1 || crlf <= lf)) { end = crlf; termLen = 4; }
    else if (lf !== -1) { end = lf; termLen = 2; }
    if (end === -1) return null;
    return {
        blockText: buf.subarray(from, end).toString('utf8'),
        restStart: end + termLen
    };
}

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);
    clientConn.setKeepAlive(true, 15000);

    let buffer = Buffer.alloc(0);
    let done = false;

    const headerTimer = setTimeout(() => {
        if (!done) clientConn.destroy();
    }, HEADER_TIMEOUT_MS);

    function fail() {
        if (!done) {
            done = true;
            clearTimeout(headerTimer);
            clientConn.destroy();
        }
    }

    clientConn.on('data', onData);
    clientConn.on('error', fail);
    clientConn.on('close', () => clearTimeout(headerTimer));

    function onData(chunk) {
        if (done) return;
        buffer = Buffer.concat([buffer, chunk]);
        if (buffer.length > MAX_HEADER_BUFFER) return fail();

        // 🔎 SCAN BLOK DEMI BLOK: blok umpan dibuang, blok upgrade asli dipakai
        let offset = 0;
        while (true) {
            const blk = extractBlock(buffer, offset);
            if (!blk) return; // blok belum utuh, tunggu data berikutnya (payload split aman)

            const lower = blk.blockText.toLowerCase();
            const isUpgrade = lower.includes('upgrade:') && lower.includes('websocket');

            if (!isUpgrade) {
                // Ini request umpan dari payload -> buang, lanjut scan blok berikutnya
                offset = blk.restStart;
                if (offset >= buffer.length) { buffer = Buffer.alloc(0); return; }
                continue;
            }

            // ✅ KETEMU REQUEST ASLI
            done = true;
            clearTimeout(headerTimer);
            clientConn.removeListener('data', onData);

            const firstLine = blk.blockText.split(/\r\n|\n/)[0].trim();
            const m = firstLine.match(/^\S+\s+(\S+)\s+HTTP\//i);
            if (!m) return clientConn.destroy();

            let target = m[1];
            // Payload kadang pakai absolute-form (http://bug/path) -> ambil path-nya saja
            if (/^https?:\/\//i.test(target)) {
                try { const u = new URL(target); target = u.pathname + u.search; } catch (e) {}
            }
            const reqPath = target.split('?')[0];

            // 🛡️ Hanya path resmi panel yang boleh lewat
            const allowed = loadAllowedPaths();
            if (allowed.size > 0 && !allowed.has(reqPath)) {
                console.log(`[WS-Xray] Path ditolak: ${reqPath}`);
                return clientConn.destroy();
            }

            const headers = parseHeaders(blk.blockText);
            const wsKey = headers['sec-websocket-key'] || crypto.randomBytes(16).toString('base64');
            const wsVersion = headers['sec-websocket-version'] || '13';
            const hostHeader = headers['host'] || `${XRAY_HOST}:${XRAY_PORT}`;

            // 🧹 BANGUN REQUEST BERSIH BUAT XRAY (semua header sampah payload dibuang)
            let clean = `GET ${target} HTTP/1.1\r\n` +
                `Host: ${hostHeader}\r\n` +
                `Upgrade: websocket\r\n` +
                `Connection: Upgrade\r\n` +
                `Sec-WebSocket-Key: ${wsKey}\r\n` +
                `Sec-WebSocket-Version: ${wsVersion}\r\n`;
            if (headers['sec-websocket-protocol']) {
                clean += `Sec-WebSocket-Protocol: ${headers['sec-websocket-protocol']}\r\n`;
            }
            if (headers['cf-connecting-ip']) {
                clean += `CF-Connecting-IP: ${headers['cf-connecting-ip']}\r\n`;
            }
            clean += '\r\n';

            // Sisa byte setelah blok header client (frame WS yang keburu masuk) ikut diteruskan
            const leftoverClient = buffer.subarray(blk.restStart);
            buffer = null;

            connectToXray(clean, leftoverClient);
            return;
        }
    }

    function connectToXray(cleanRequest, leftoverClient) {
        const xrayConn = net.createConnection({ port: XRAY_PORT, host: XRAY_HOST }, () => {
            xrayConn.setNoDelay(true);
            xrayConn.setKeepAlive(true, 15000);
            xrayConn.write(cleanRequest);
            if (leftoverClient && leftoverClient.length > 0) xrayConn.write(leftoverClient);
        });

        // Tunggu jawaban Xray sampai header-nya utuh, teruskan apa adanya ke client,
        // habis itu sambung pipa dua arah (frame WS lewat utuh, tidak diutak-atik)
        let respBuf = Buffer.alloc(0);

        const onXrayData = (chunk) => {
            respBuf = Buffer.concat([respBuf, chunk]);
            const blk = extractBlock(respBuf, 0);
            if (!blk) {
                if (respBuf.length > MAX_HEADER_BUFFER) { clientConn.destroy(); xrayConn.destroy(); }
                return;
            }
            xrayConn.removeListener('data', onXrayData);
            if (clientConn.writable) clientConn.write(respBuf.subarray(0, blk.restStart));
            const rest = respBuf.subarray(blk.restStart);
            if (rest.length > 0 && clientConn.writable) clientConn.write(rest);
            respBuf = null;

            clientConn.pipe(xrayConn);
            xrayConn.pipe(clientConn);
        };

        xrayConn.on('data', onXrayData);

        xrayConn.on('error', () => clientConn.destroy());
        clientConn.on('error', () => xrayConn.destroy());
        xrayConn.on('close', () => clientConn.destroy());
        clientConn.on('close', () => xrayConn.destroy());
    }
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
    console.log(`[WS-Xray Gateway] Payload-Enhanced Filter Active on Port ${LISTEN_PORT} -> Xray ${XRAY_PORT}`);
});
