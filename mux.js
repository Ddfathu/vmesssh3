const net = require('net');

const PUBLIC_PORT = 8881; 
const SSL_TARGET = parseInt(process.env.SSL_TARGET_PORT || '2443');
const WS_TARGET = parseInt(process.env.WS_TARGET_PORT || '8880');

const server = net.createServer((clientConn) => {
    clientConn.setNoDelay(true);
    clientConn.setKeepAlive(true, 15000); // Anti silent disconnect
    clientConn.readableHighWaterMark = 64 * 1024;
    clientConn.writableHighWaterMark = 64 * 1024;

    let backendConn = null;
    let isConnected = false;
    const earlyBuffer = [];

    const handleInitialData = (buffer) => {
        if (!buffer || buffer.length === 0) return;

        clientConn.removeListener('data', handleInitialData);

        // ⚡ PEMISAH LALU LINTAS MURNI:
        // Cuma cek Byte Pertama: 0x16 = Handshake TLS/SSL -> Stunnel (2443)
        // Selain itu (HTTP/WS/Inject Payload) -> WS-Proxy (8880)
        const targetPort = (buffer[0] === 0x16) ? SSL_TARGET : WS_TARGET;

        backendConn = net.createConnection({ port: targetPort, host: '127.0.0.1' }, () => {
            isConnected = true;
            backendConn.setNoDelay(true);
            backendConn.setKeepAlive(true, 15000);

            backendConn.write(buffer);

            while (earlyBuffer.length > 0) {
                const chunk = earlyBuffer.shift();
                backendConn.write(chunk);
            }
        });

        clientConn.on('data', (data) => {
            if (isConnected && backendConn && backendConn.writable) {
                const flush = backendConn.write(data);
                if (!flush) clientConn.pause();
            } else {
                earlyBuffer.push(data);
            }
        });

        backendConn.on('data', (data) => {
            if (clientConn.writable) {
                const flush = clientConn.write(data);
                if (!flush) backendConn.pause();
            }
        });

        backendConn.on('drain', () => clientConn.resume());
        clientConn.on('drain', () => backendConn.resume());

        backendConn.on('error', () => clientConn.destroy());
        clientConn.on('error', () => backendConn ? backendConn.destroy() : null);
        backendConn.on('close', () => clientConn.destroy());
        clientConn.on('close', () => backendConn ? backendConn.destroy() : null);
    };

    clientConn.on('data', handleInitialData);
});

server.listen(PUBLIC_PORT, '0.0.0.0', () => {
    console.log(`[Mux JS] Pure Traffic Splitter Active on Port ${PUBLIC_PORT}`);
});