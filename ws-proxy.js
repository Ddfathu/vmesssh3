const net = require('net');
const crypto = require('crypto');
const fs = require('fs');

const WS_PORT = process.env.WS_PORT || '8880';
const SSH_TARGET_HOST = '127.0.0.1';
const WSMagic = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const PROXY_CONFIG_FILE = "/tmp/ws_proxy_config.json";

// 🔍 FUNGSI BACA CONFIG DINAMIS DARI BACKEND UI
function getProxyConfig() {
    try {
        if (fs.existsSync(PROXY_CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(PROXY_CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return {
        sshPort: parseInt(process.env.SSH_TARGET_PORT || '22'),
        keepAlive: 15000,
        maxBuffer: 32 * 1024
    };
}

function parseHeaders(rawText) {
    const headers = {};
    const lines = rawText.split("\r\n");
    for (let i = 1; i < lines.length; i++) {
        let line = lines[i];
        if (line.includes(":")) {
            let parts = line.split(":");
            let k = parts[0].trim().toLowerCase();
            let v = parts.slice(1).join(":").trim();
            headers[k] = v;
        }
    }
    return headers;
}

const server = net.createServer((clientConn) => {
    // Ambil settingan terbaru tiap ada client konek
    const cfg = getProxyConfig();
    const targetSshPort = cfg.sshPort || 22;
    const keepAliveMs = cfg.keepAlive || 15000;
    const maxBufferLimit = cfg.maxBuffer || (32 * 1024);

    clientConn.setNoDelay(true);
    clientConn.setKeepAlive(true, keepAliveMs); // ⚡ Ping KeepAlive Dinamis
    clientConn.readableHighWaterMark = 64 * 1024;
    clientConn.writableHighWaterMark = 64 * 1024;

    clientConn.once('data', (rawHeaders) => {
        if (!rawHeaders || rawHeaders.length === 0) {
            clientConn.destroy();
            return;
        }

        const rawText = rawHeaders.toString('utf8');
        const rawTextLower = rawText.toLowerCase();
        const headers = parseHeaders(rawText);

        const isWsUpgrade = rawTextLower.includes('upgrade: websocket') || headers['upgrade'] === 'websocket';

        if (isWsUpgrade) {
            let wsKey = headers['sec-websocket-key'];
            if (!wsKey && rawTextLower.includes('sec-websocket-key:')) {
                const lines = rawText.split("\r\n");
                for (let line of lines) {
                    if (line.toLowerCase().startsWith('sec-websocket-key:')) {
                        wsKey = line.split(":")[1].trim();
                        break;
                    }
                }
            }

            if (!wsKey) {
                wsKey = crypto.randomBytes(16).toString('base64');
            }

            const shasum = crypto.createHash('sha1');
            shasum.update(wsKey + WSMagic);
            const acceptKey = shasum.digest('base64');

            let response = "HTTP/1.1 101 Switching Protocols\r\n" +
                             "Upgrade: websocket\r\n" +
                             "Connection: Upgrade\r\n" +
                             `Sec-WebSocket-Accept: ${acceptKey}\r\n`;
            
            if (headers['sec-websocket-protocol']) {
                response += `Sec-WebSocket-Protocol: ${headers['sec-websocket-protocol']}\r\n`;
            }
            response += "\r\n";
            
            clientConn.write(response);
        } else {
            const defaultResp = process.env.WS_RESPONSE || "HTTP/1.1 101 Switching Protocols\r\n\r\n";
            clientConn.write(defaultResp);
        }

        // =========================================================
        // KONEKSI DINAMIS KE DROPBEAR / OPENSSH
        // =========================================================
        const sshConn = net.createConnection({ port: targetSshPort, host: SSH_TARGET_HOST }, () => {
            sshConn.setNoDelay(true);
            sshConn.setKeepAlive(true, keepAliveMs);

            let sshHandshakeDone = false;
            let pendingBuffer = Buffer.alloc(0);

            clientConn.on('data', (chunk) => {
                if (sshHandshakeDone) {
                    if (sshConn.writable) {
                        const flush = sshConn.write(chunk);
                        if (!flush) clientConn.pause();
                    }
                    return;
                }

                pendingBuffer = Buffer.concat([pendingBuffer, chunk]);
                const sshIndex = pendingBuffer.indexOf(Buffer.from('SSH-'));

                if (sshIndex !== -1) {
                    const cleanSshData = pendingBuffer.subarray(sshIndex);
                    sshHandshakeDone = true;

                    if (sshConn.writable) {
                        const flush = sshConn.write(cleanSshData);
                        if (!flush) clientConn.pause();
                    }
                    pendingBuffer = null; 
                } else {
                    // Batas penyaringan buffer dinamis
                    if (pendingBuffer.length > maxBufferLimit) {
                        clientConn.destroy();
                        sshConn.destroy();
                    }
                }
            });

            sshConn.on('data', (data) => {
                if (clientConn.writable) {
                    const flush = clientConn.write(data);
                    if (!flush) sshConn.pause();
                }
            });

            sshConn.on('drain', () => clientConn.resume());
            clientConn.on('drain', () => sshConn.resume());
        });

        sshConn.on('error', () => clientConn.destroy());
        clientConn.on('error', () => sshConn.destroy());
        sshConn.on('close', () => clientConn.destroy());
        clientConn.on('close', () => sshConn.destroy());
    });
});

server.listen(WS_PORT, '0.0.0.0', () => {
    console.log(`[WS Engine JS] Dynamic Proxy Active on Port ${WS_PORT}`);
});