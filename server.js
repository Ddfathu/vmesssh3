#!/usr/bin/env node

const http = require("http");
const url = require("url");
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const crypto = require('crypto');
const { promisify } = require('util');
const execPromise = promisify(require('child_process').exec);
const { exec, execSync } = require('child_process');

// ========================================================
// VARIABEL KONFIGURASI GLOBAL
// ========================================================
const UPLOAD_URL = process.env.UPLOAD_URL || '';      
const PROJECT_URL = process.env.PROJECT_URL || '';    
const AUTO_ACCESS = process.env.AUTO_ACCESS || false; 
const FILE_PATH = process.env.FILE_PATH || '.tmp';   
const SUB_PATH = process.env.SUB_PATH || 'sub';       

const PORT = process.env.PORT || 8081; 
const UUID = process.env.UUID || '1f37ac4f-fdd0-49df-9406-1eda70a1d512'; 
const ARGO_PORT = 8001;            
const CFPORT = process.env.CFPORT || 443;                  
const NAME = process.env.NAME || 'ddfathu';                        

const LOG_PATH = path.join(FILE_PATH, "boot.log"); 
const ZT_LOG_PATH = "/tmp/named_tunnel.log";
const ZT_SINGLE_TOKEN_FILE = "/tmp/zt_single_token.txt";
const CFIP_FILE = "/tmp/cfip.txt";
const NET_SETTING_FILE = "/tmp/net_settings.json";
const WS_PROXY_CONFIG_FILE = "/tmp/ws_proxy_config.json";
const SYSTEM_CONFIG_FILE = "/tmp/system_config.json";

const ADMIN_PASS_FILE = "/tmp/admin_pass.txt";
const STATS_PATH = "/tmp/server_stats.json";
const DB_PATH = "/tmp/ssh_details.json";

let cachedDiskUsage = "38%";
let cachedSshOnline = "0 User";
let cachedUserListDetails = "Semua user offline";

if (!fs.existsSync(FILE_PATH)) {
  fs.mkdirSync(FILE_PATH);
}

function getNetworkSettings() {
    try {
        if (fs.existsSync(NET_SETTING_FILE)) {
            return JSON.parse(fs.readFileSync(NET_SETTING_FILE, 'utf8'));
        }
    } catch(e) {}
    return { dns_type: "udp", custom_dns: "8.8.8.8", engine: "ws" };
}

function saveNetworkSettings(dns_type, custom_dns, engine) {
    try {
        fs.writeFileSync(NET_SETTING_FILE, JSON.stringify({ dns_type, custom_dns, engine }, null, 2));
    } catch(e) {}
}

function getWsProxyConfig() {
    try {
        if (fs.existsSync(WS_PROXY_CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(WS_PROXY_CONFIG_FILE, 'utf8'));
        }
    } catch (e) {}
    return { sshPort: 22, keepAlive: 15000, maxBuffer: 32768 };
}

function saveWsProxyConfig(sshPort, keepAlive, maxBuffer) {
    try {
        const data = {
            sshPort: parseInt(sshPort) || 22,
            keepAlive: parseInt(keepAlive) || 15000,
            maxBuffer: parseInt(maxBuffer) || 32768
        };
        fs.writeFileSync(WS_PROXY_CONFIG_FILE, JSON.stringify(data, null, 2));
    } catch(e) {}
}

function getSystemSettings() {
    try {
        if (fs.existsSync(SYSTEM_CONFIG_FILE)) {
            return JSON.parse(fs.readFileSync(SYSTEM_CONFIG_FILE, 'utf8'));
        }
    } catch(e) {}
    return { banner: "", enable_bbr: "true", udpgw_port: "7300", udpgw_max_clients: "1000" };
}

function saveSystemSettings(banner, enable_bbr, udpgw_port, udpgw_max_clients) {
    try {
        const data = {
            banner: banner || "",
            enable_bbr: enable_bbr || "true",
            udpgw_port: udpgw_port || "7300",
            udpgw_max_clients: udpgw_max_clients || "1000"
        };
        fs.writeFileSync(SYSTEM_CONFIG_FILE, JSON.stringify(data, null, 2));
    } catch(e) {}
}

function getActiveCfip() {
    try {
        if (fs.existsSync(CFIP_FILE)) {
            const savedIp = fs.readFileSync(CFIP_FILE, 'utf8').trim();
            if (savedIp) return savedIp;
        }
    } catch(e) {}
    return process.env.CFIP || '104.17.3.81';
}

function getAdminPassword() {
    try {
        if (fs.existsSync(ADMIN_PASS_FILE)) {
            return fs.readFileSync(ADMIN_PASS_FILE, 'utf8').trim();
        }
    } catch (e) {}
    return process.env.ADMIN_PASSWORD || null;
}

function verifyAdminPassword(passInput) {
    const currentPass = getAdminPassword();
    if (!currentPass) return false;
    return currentPass === passInput;
}

function generateRandomName() {
  const characters = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return result;
}

let subContent = null;
const webName = generateRandomName();
const botName = generateRandomName();
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');

function loadDb() {
    if (fs.existsSync(DB_PATH)) {
        try { return JSON.parse(fs.readFileSync(DB_PATH, 'utf8')); } catch (e) { return {}; }
    }
    return {};
}

function saveDb(data) {
    try { fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2)); } catch (e) {}
}

let currentActiveDomain = '';

function restartSingleTunnel(newToken) {
    exec("pkill -9 -f 'cloudflared'", () => {
        setTimeout(() => {
            if (newToken && newToken.trim()) {
                fs.writeFileSync(ZT_SINGLE_TOKEN_FILE, newToken.trim());
                exec(`nohup ${botPath} tunnel run --protocol http2 --no-tls-verify --token "${newToken.trim()}" > ${ZT_LOG_PATH} 2>&1 &`);
            } else {
                if (fs.existsSync(ZT_SINGLE_TOKEN_FILE)) fs.unlinkSync(ZT_SINGLE_TOKEN_FILE);
                if (fs.existsSync(ZT_LOG_PATH)) fs.writeFileSync(ZT_LOG_PATH, "Token Dihapus.");
                let args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${LOG_PATH} --loglevel info --url http://localhost:${ARGO_PORT}`;
                exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
            }
        }, 1000);
    });
}

function getDomainsByPort(targetPorts) {
    const domains = [];
    try {
        if (fs.existsSync(ZT_LOG_PATH)) {
            const logContent = fs.readFileSync(ZT_LOG_PATH, 'utf8');
            const portRegexStr = targetPorts.join('|');

            const regexIngress = new RegExp(`(?:\\\\?"|")hostname(?:\\\\?"|")\\s*:\\s*(?:\\\\?"|")([^"\\\\]+)(?:\\\\?"|")[^}]*?localhost:(${portRegexStr})`, 'g');
            let match;
            
            while ((match = regexIngress.exec(logContent)) !== null) {
                const domainName = match[1].trim();
                const portNum = match[2];
                if (!domains.some(d => d.domain === domainName)) {
                    domains.push({ domain: domainName, port: portNum });
                }
            }

            if (domains.length === 0) {
                const regexIngressReverse = new RegExp(`localhost:(${portRegexStr})[^}]*?(?:\\\\?"|")hostname(?:\\\\?"|")\\s*:\\s*(?:\\\\?"|")([^"\\\\]+)(?:\\\\?"|")`, 'g');
                while ((match = regexIngressReverse.exec(logContent)) !== null) {
                    const portNum = match[1];
                    const domainName = match[2].trim();
                    if (!domains.some(d => d.domain === domainName)) {
                        domains.push({ domain: domainName, port: portNum });
                    }
                }
            }
        }
    } catch (e) {}

    return domains;
}

function getCurrentHosts() {
    let hwInfo = {};
    if (fs.existsSync(STATS_PATH)) {
        try { hwInfo = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')); } catch (e) {}
    }
    const ztDomains = getDomainsByPort(['8880', '8881']);
    const namedUrl = ztDomains.length > 0 ? ztDomains[0].domain : (process.env.D || "");
    let quickUrl = currentActiveDomain || "Menunggu Quick Tunnel...";
    
    let hostOutput = "";
    if (namedUrl && !namedUrl.includes("Menghubungkan")) hostOutput += `${namedUrl.replace(/https?:\/\//, '')} (SSH WS)`;
    
    if (process.env.RAILWAY_TCP_PROXY_DOMAIN && process.env.RAILWAY_TCP_PROXY_PORT) {
        const autoTcp = `${process.env.RAILWAY_TCP_PROXY_DOMAIN}:${process.env.RAILWAY_TCP_PROXY_PORT}`;
        hostOutput += hostOutput ? ` dan ini (SSH SNI) ${autoTcp}` : `${autoTcp}`;
    } else if (process.env.SNI) {
        hostOutput += hostOutput ? ` dan ${process.env.SNI.replace(/https?:\/\//, '')}` : `${process.env.SNI.replace(/https?:\/\//, '')}`;
    } else if (hwInfo.railway_proxy && hwInfo.railway_proxy.trim() !== "") {
        hostOutput += hostOutput ? ` dan ${hwInfo.railway_proxy}` : `${hwInfo.railway_proxy}`;
    }
    
    if (!hostOutput) hostOutput = quickUrl.replace(/https?:\/\//, '');
    return hostOutput;
}

function listSsh() {
    try {
        const users = [];
        const dbInfo = loadDb();
        const passwdContent = fs.readFileSync('/etc/passwd', 'utf8');
        const lines = passwdContent.split('\n');
        
        for (let line of lines) {
            if (!line.trim()) continue;
            const parts = line.split(':');
            const username = parts[0];
            const uid = parseInt(parts[2], 10);
            const shell = parts[parts.length - 1];
            
            if (uid >= 1000 && !["nobody", "ubuntu", "sshd", "dropbear", "stunnel"].includes(username)) {
                const extra = dbInfo[username] || { password: "-", ip: "Unknown", user_agent: "Unknown" };
                users.push({ username, uid, shell, ...extra });
            }
        }
        return { status: "success", total: users.length, users: users };
    } catch (e) {
        return { status: "error", message: e.message };
    }
}

function addSsh(username, password, ipAddr, userAgent) {
    if (!username || !password) return { status: "error", message: "Username dan password wajib diisi!" };
    if (!/^[a-zA-Z0-9_-]+$/.test(username) || !/^[a-zA-Z0-9_@.-]+$/.test(password)) {
        return { status: "error", message: "Username/Password mengandung karakter ilegal!" };
    }
    try {
        execSync(`useradd -m -s /bin/bash ${username}`);
        execSync(`echo '${username}:${password}' | chpasswd`);
        
        const dbInfo = loadDb();
        dbInfo[username] = { password, ip: ipAddr, user_agent: userAgent };
        saveDb(dbInfo);
        
        const activeHost = getCurrentHosts();
        const accountDetails = 
            `================================\n` +
            `       SSH ACCOUNT CREATED      \n` +
            `================================\n` +
            `🔹 Host SSH  : ${activeHost}\n` +
            `🔹 Port TLS  : 443\n` +
            `🔹 Port NTLS : 80\n` +
            `🔹 Username  : ${username}\n` +
            `🔹 Password  : ${password}\n` +
            `================================\n` +
            ` powered by : d e d e f a t h u\n` +
            `================================`;
        return { status: "success", message: accountDetails };
    } catch (e) {
        return { status: "error", message: `Gagal membuat user. Username mungkin sudah terpakai.` };
    }
}

function deleteSsh(username) {
    if (!username || !/^[a-zA-Z0-9_-]+$/.test(username)) return { status: "error", message: "Username ilegal!" };
    try {
        execSync(`userdel -r ${username}`);
        const dbInfo = loadDb();
        if (dbInfo[username]) {
            delete dbInfo[username];
            saveDb(dbInfo);
        }
        return { status: "success", message: `User ${username} berhasil dihapus!` };
    } catch (e) {
        return { status: "error", message: `Gagal menghapus user.` };
    }
}

function readPathsFromFile(filename, defaultPath) { 
  try { 
    if (fs.existsSync(filename)) { 
      const content = fs.readFileSync(filename, 'utf-8'); 
      const paths = content.split('\n').map(p => p.trim()).filter(p => p.startsWith('/')); 
      if (paths.length > 0) return paths; 
    } 
  } catch (e) {} 
  return [defaultPath]; 
}

async function generateConfig() {
  const netSettings = getNetworkSettings();
  const vlessPaths = readPathsFromFile('pathvless.txt', '/vless-argo');
  const vmessPaths = readPathsFromFile('pathvmess.txt', '/vmess-argo');
  const trojanPaths = readPathsFromFile('pathtrojan.txt', '/trojan-argo');
  
  const fallbacksList = [];
  const inboundsList = [];
  let nextPort = 3100;

  const engine = netSettings.engine || 'ws';

  let streamSettingsObj = {};
  if (engine === 'grpc') {
    streamSettingsObj = { network: "grpc", security: "none", grpcSettings: { serviceName: "grpc-service" } };
  } else if (engine === 'h2') {
    streamSettingsObj = { network: "h2", security: "none", httpSettings: { path: "/h2-path", host: ["localhost"] } };
  } else if (engine === 'tcp') {
    streamSettingsObj = { network: "tcp", security: "none" };
  } else {
    streamSettingsObj = { network: "ws", security: "none" };
  }

  vlessPaths.forEach(p => { 
    const cp = nextPort++; 
    fallbacksList.push({ path: p, dest: cp }); 
    let st = JSON.parse(JSON.stringify(streamSettingsObj));
    if (engine === 'ws') st.wsSettings = { path: p };

    inboundsList.push({ 
        port: cp, listen: "127.0.0.1", protocol: 'vless', 
        settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, 
        streamSettings: st, 
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } 
    }); 
  });

  vmessPaths.forEach(p => { 
    const cp = nextPort++; 
    fallbacksList.push({ path: p, dest: cp }); 
    let st = JSON.parse(JSON.stringify(streamSettingsObj));
    if (engine === 'ws') st.wsSettings = { path: p };

    inboundsList.push({ 
        port: cp, listen: "127.0.0.1", protocol: "vmess", 
        settings: { clients: [{ id: UUID, alterId: 0 }] }, 
        streamSettings: st, 
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } 
    }); 
  });

  trojanPaths.forEach(p => { 
    const cp = nextPort++; 
    fallbacksList.push({ path: p, dest: cp }); 
    let st = JSON.parse(JSON.stringify(streamSettingsObj));
    if (engine === 'ws') st.wsSettings = { path: p };

    inboundsList.push({ 
        port: cp, listen: "127.0.0.1", protocol: "trojan", 
        settings: { clients: [{ password: UUID }] }, 
        streamSettings: st, 
        sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] } 
    }); 
  });

  inboundsList.unshift({
    port: ARGO_PORT,
    protocol: 'vless',
    settings: { clients: [{ id: UUID }], decryption: 'none', fallbacks: fallbacksList },
    streamSettings: { network: 'tcp', security: 'none' },
    sniffing: { enabled: true, destOverride: ["http", "tls", "quic"] }
  });

  let dnsValue = (netSettings.custom_dns || "").trim();
  let dnsServers = [];

  if (netSettings.dns_type === 'doh') {
    if (!dnsValue.startsWith('http')) dnsValue = 'https://1.1.1.1/dns-query';
    dnsServers = [dnsValue, "8.8.8.8"];
  } else {
    if (!dnsValue || dnsValue.startsWith('http')) dnsValue = '8.8.8.8';
    dnsServers = [dnsValue, "1.1.1.1"];
  }

  const config = { 
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' }, 
    inbounds: inboundsList, 
    dns: { servers: dnsServers }, 
    outbounds: [{ protocol: "freedom", tag: "direct" }] 
  };
  
  fs.writeFileSync(path.join(FILE_PATH, 'config.json'), JSON.stringify(config, null, 2));
}

function getSystemArchitecture() { return os.arch().includes('arm') ? 'arm' : 'amd'; }
function downloadFile(fileName, fileUrl, callback) {
  if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });
  const writer = fs.createWriteStream(fileName);
  axios({ method: 'get', url: fileUrl, responseType: 'stream' }).then(response => {
    response.data.pipe(writer);
    writer.on('finish', () => { writer.close(); callback(null, fileName); });
    writer.on('error', err => { fs.unlink(fileName, () => {}); callback(err.message); });
  }).catch(err => callback(err.message));
}

async function downloadFilesAndRun() {
  const architecture = getSystemArchitecture();
  const filesToDownload = architecture === 'arm' ? 
    [{ fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" }, { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }] :
    [{ fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" }, { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }];

  for (let fileInfo of filesToDownload) {
    await new Promise((resolve, reject) => { downloadFile(fileInfo.fileName, fileInfo.fileUrl, (err) => err ? reject(err) : resolve()); });
  }
  fs.chmodSync(webPath, 0o775); fs.chmodSync(botPath, 0o775);

  exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);
  
  if (fs.existsSync(ZT_SINGLE_TOKEN_FILE)) {
    const singleToken = fs.readFileSync(ZT_SINGLE_TOKEN_FILE, 'utf8').trim();
    if (singleToken) {
      restartSingleTunnel(singleToken);
    } else {
      let args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${LOG_PATH} --loglevel info --url http://localhost:${ARGO_PORT}`;
      exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
    }
  } else {
    let args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${LOG_PATH} --loglevel info --url http://localhost:${ARGO_PORT}`;
    exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
  }

  await new Promise(r => setTimeout(r, 5000));
}

async function extractDomains() {
  try {
    if(fs.existsSync(LOG_PATH)) {
      const logContent = fs.readFileSync(LOG_PATH, 'utf-8');
      const match = logContent.match(/https:\/\/([a-zA-Z0-9-]+\.trycloudflare\.com)/);
      if (match) { 
        currentActiveDomain = match[1]; 
        await generateLinks(currentActiveDomain); 
      }
    }
  } catch (e) {}
}

async function getMetaInfo() { try { const res = await axios.get('https://api.ip.sb/geoip'); return `${res.data.country_code}-${res.data.isp}`.replace(/\s+/g, '_'); } catch(e) { return 'RailwayServer'; } }

async function generateLinks(argoDomain) {
  const ISP = await getMetaInfo();
  const nodeName = `${NAME}-${ISP}`;
  const activeCfip = getActiveCfip();
  const defaultVless = readPathsFromFile('pathvless.txt', '/vless-argo')[0];
  const defaultVmess = readPathsFromFile('pathvmess.txt', '/vmess-argo')[0];
  const defaultTrojan = readPathsFromFile('pathtrojan.txt', '/trojan-argo')[0];
  
  const vmessObj = {
    v: "2",
    ps: nodeName,
    add: activeCfip,
    port: String(CFPORT),
    id: UUID,
    aid: "0",
    scy: "auto",
    net: "ws",
    type: "none",
    host: argoDomain,
    path: defaultVmess,
    tls: "tls",
    sni: argoDomain
  };
  
  const vmessLink = `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`;
  const vlessLink = `vless://${UUID}@${activeCfip}:${CFPORT}?encryption=none&security=tls&sni=${argoDomain}&type=ws&host=${argoDomain}&path=${encodeURIComponent(defaultVless)}#${encodeURIComponent(nodeName)}`;
  const trojanLink = `trojan://${UUID}@${activeCfip}:${CFPORT}?security=tls&sni=${argoDomain}&type=ws&host=${argoDomain}&path=${encodeURIComponent(defaultTrojan)}#${encodeURIComponent(nodeName)}`;
  
  const subTxt = `${vlessLink}\n${vmessLink}\n${trojanLink}`;
  subContent = Buffer.from(subTxt).toString('base64');
  fs.writeFileSync(subPath, subContent);
}

// ========================================================
// HTTP SERVER (API & STATIC FILES HANDLER)
// ========================================================
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const pathName = parsedUrl.pathname;
    const query = parsedUrl.query;
    const ipAddr = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || "Unknown IP";
    const userAgent = req.headers['user-agent'] || "Unknown UA";
    
    res.setHeader('Access-Control-Allow-Origin', '*');

    if (pathName === `/${SUB_PATH}`) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(subContent || (fs.existsSync(subPath) ? fs.readFileSync(subPath, 'utf-8') : 'Loading sub...'));
    }

    if (pathName === '/__info') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const defaultVless = readPathsFromFile('pathvless.txt', '/vless-argo')[0];
        const defaultVmess = readPathsFromFile('pathvmess.txt', '/vmess-argo')[0];
        const defaultTrojan = readPathsFromFile('pathtrojan.txt', '/trojan-argo')[0];
        return res.end(JSON.stringify({ 
            uuid: UUID, 
            cfip: getActiveCfip(),
            domain: currentActiveDomain || "Menunggu Quick Tunnel...", 
            paths: { vless: defaultVless, vmess: defaultVmess, trojan: defaultTrojan } 
        }));
    }

    if (pathName === '/api/logtunnel') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end(fs.existsSync(LOG_PATH) ? fs.readFileSync(LOG_PATH, 'utf8') : "Log belum siap.");
    }

    if (pathName === '/api/lognamed') {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        if (fs.existsSync(ZT_LOG_PATH)) {
            return res.end(fs.readFileSync(ZT_LOG_PATH, 'utf8'));
        } else {
            return res.end("Log Zero Trust belum terbuat atau file /tmp/named_tunnel.log tidak ditemukan.");
        }
    }

    if (pathName === '/api/setup-pass') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        const newPass = query.pass ? query.pass.trim() : "";
        const oldPass = query.old_pass ? query.old_pass.trim() : "";
        const currentPass = getAdminPassword();

        if (currentPass) {
            if (oldPass !== currentPass) {
                return res.end(JSON.stringify({ status: "error", message: "Password Admin Lama Salah!" }));
            }
        }
        
        if (!newPass || newPass.length < 4) {
            return res.end(JSON.stringify({ status: "error", message: "Password minimal 4 karakter!" }));
        }

        fs.writeFileSync(ADMIN_PASS_FILE, newPass);
        return res.end(JSON.stringify({ status: "success", message: "Password Admin Berhasil Disimpan/Diubah!" }));
    }

    if (pathName === '/api/set-network') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) {
            return res.end(JSON.stringify({ status: "error", message: "Akses Ditolak! Anda harus Login Admin terlebih dahulu." }));
        }
        const dns_type = query.dns_type || "udp";
        const custom_dns = query.custom_dns ? decodeURIComponent(query.custom_dns) : "8.8.8.8";
        const engine = query.engine || "ws";
        
        saveNetworkSettings(dns_type, custom_dns, engine);
        await generateConfig();
        
        exec(`pkill -9 -f '${webName}'`, () => {
            setTimeout(() => {
                exec(`nohup ${webPath} -c ${FILE_PATH}/config.json >/dev/null 2>&1 &`);
            }, 1000);
        });

        return res.end(JSON.stringify({ status: "success", message: `Setting V2Ray Disimpan! DNS: [${dns_type.toUpperCase()}] ${custom_dns}, Engine: ${engine.toUpperCase()}. Engine restarted!` }));
    }

    if (pathName === '/api/set-wsproxy') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) {
            return res.end(JSON.stringify({ status: "error", message: "Akses Ditolak! Anda harus Login Admin terlebih dahulu." }));
        }

        saveWsProxyConfig(query.ssh_port, query.keep_alive, query.max_buffer);
        return res.end(JSON.stringify({ status: "success", message: `Setting SSH Disimpan! Target Port: ${query.ssh_port || 22}, KeepAlive: ${query.keep_alive || 15000}ms` }));
    }

    if (pathName === '/api/set-system') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) {
            return res.end(JSON.stringify({ status: "error", message: "Akses Ditolak! Anda harus Login Admin terlebih dahulu." }));
        }

        const banner = query.banner ? decodeURIComponent(query.banner) : "";
        const enable_bbr = query.enable_bbr || "true";
        const udpgw_port = query.udpgw_port || "7300";
        const udpgw_max_clients = query.udpgw_max_clients || "1000";

        saveSystemSettings(banner, enable_bbr, udpgw_port, udpgw_max_clients);

        if (banner) {
            try {
                fs.writeFileSync('/etc/dropbear_banner', banner);
            } catch(e) {
                console.error("Gagal tulis banner:", e);
            }
        } else {
            const defaultBanner = "==================================================\n" +
                                  "                 SSH SERVER PANEL                 \n" +
                                  "==================================================\n" +
                                  " powered by : d e d e f a t h u\n" +
                                  "==================================================\n";
            try { fs.writeFileSync('/etc/dropbear_banner', defaultBanner); } catch(e){}
        }

        exec("pkill -9 dropbear", () => {
            setTimeout(() => {
                const wsCfg = getWsProxyConfig();
                const sshPort = wsCfg.sshPort || 22;
                exec(`/usr/sbin/dropbear -p 127.0.0.1:${sshPort} -b /etc/dropbear_banner -W 1048576 -K 15 -I 300`, (err) => {
                    if (err) console.error("Gagal restart Dropbear:", err.message);
                });
            }, 1000);
        });

        exec("pkill -9 badvpn-udpgw", () => {
            setTimeout(() => {
                if (fs.existsSync('/usr/local/bin/badvpn-udpgw')) {
                    exec(`nohup /usr/local/bin/badvpn-udpgw --listen-addr 0.0.0.0:${udpgw_port} --max-clients ${udpgw_max_clients} --max-connections-for-client 50 >/dev/null 2>&1 &`);
                }
            }, 1000);
        });

        try {
            if (enable_bbr === "true") {
                exec("sysctl -w net.ipv4.tcp_congestion_control=bbr 2>/dev/null");
            } else {
                exec("sysctl -w net.ipv4.tcp_congestion_control=cubic 2>/dev/null");
            }
        } catch(e) {}

        return res.end(JSON.stringify({ status: "success", message: `System Config (Banner/BBR/UDPGW:${udpgw_port}) Berhasil Disimpan & Di-apply!` }));
    }

    if (pathName === '/api/set-token') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) {
            return res.end(JSON.stringify({ status: "error", message: "Akses Ditolak! Anda harus Login Admin terlebih dahulu." }));
        }
        
        const singleToken = query.token !== undefined ? query.token.trim() : null;
        if (singleToken !== null) restartSingleTunnel(singleToken);

        return res.end(JSON.stringify({ status: "success", message: "Perintah restart tunnel terkirim! Tunggu 10 detik..." }));
    }

    if (pathName === '/api/set-cfip') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (!verifyAdminPassword(query.pass)) {
            return res.end(JSON.stringify({ status: "error", message: "Akses Ditolak! Anda harus Login Admin terlebih dahulu." }));
        }
        const newIp = query.ip ? query.ip.trim() : "";
        if (newIp) {
            fs.writeFileSync(CFIP_FILE, newIp);
            if (currentActiveDomain) generateLinks(currentActiveDomain);
            return res.end(JSON.stringify({ status: "success", message: `CFIP Berhasil Diperbarui ke: ${newIp}` }));
        } else {
            if (fs.existsSync(CFIP_FILE)) fs.unlinkSync(CFIP_FILE);
            return res.end(JSON.stringify({ status: "success", message: "CFIP Direset ke Default." }));
        }
    }

    if (pathName === '/api/add') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(addSsh(query.user, query.pass, ipAddr, userAgent))); }
    
    if (pathName === '/api/delete') { 
        res.writeHead(200, { 'Content-Type': 'application/json' }); 
        if (!verifyAdminPassword(query.token)) return res.end(JSON.stringify({ status: "error", message: "Akses Ditolak!" })); 
        return res.end(JSON.stringify(deleteSsh(query.user))); 
    }
    
    if (pathName === '/api/list') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(listSsh())); }
    
    if (pathName === '/api/login') { 
        res.writeHead(200, { 'Content-Type': 'application/json' }); 
        const isPassConfigured = getAdminPassword() !== null;
        if (!isPassConfigured) {
            return res.end(JSON.stringify({ status: "not_configured", message: "Password Admin belum pernah dibuat!" }));
        }
        return res.end(JSON.stringify(verifyAdminPassword(query.pass) ? { status: "success", token: query.pass } : { status: "error", message: "Password Salah!" })); 
    }
    
    if (pathName === '/api/stats') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        
        let hwInfo = { 
            cpu_model: os.cpus()[0] ? os.cpus()[0].model : "Unknown Core", 
            ram_total: (os.totalmem()/1024/1024/1024).toFixed(2)+" GB", 
            ram_used: ((os.totalmem()-os.freemem())/1024/1024/1024).toFixed(2)+" GB", 
            disk_usage: cachedDiskUsage, 
            uptime: (os.uptime()/3600).toFixed(2)+" Hours", 
            ssh_online: cachedSshOnline, 
            user_list_details: cachedUserListDetails 
        };
        
        if (fs.existsSync(STATS_PATH)) { try { hwInfo = { ...hwInfo, ...JSON.parse(fs.readFileSync(STATS_PATH, 'utf8')) }; } catch (e) {} }
        
        let quickUrl = currentActiveDomain || "Menunggu Quick Tunnel...";
        let ztSshDomains = getDomainsByPort(['8880', '8881']);
        let ztVmessDomains = getDomainsByPort(['8001']);
        let passConfigured = getAdminPassword() !== null;
        let netSettings = getNetworkSettings();
        let wsProxyCfg = getWsProxyConfig();
        let sysSettings = getSystemSettings();
        
        let rlwyPublicDomain = process.env.RAILWAY_PUBLIC_DOMAIN || "";
        let rlwyTcpDomain = (process.env.RAILWAY_TCP_PROXY_DOMAIN && process.env.RAILWAY_TCP_PROXY_PORT)
            ? `${process.env.RAILWAY_TCP_PROXY_DOMAIN}:${process.env.RAILWAY_TCP_PROXY_PORT}`
            : (process.env.SNI ? process.env.SNI.replace(/https?:\/\//, '') : (hwInfo.railway_proxy || "Tidak Aktif"));
        
        let cleanOnlineStr = String(hwInfo.ssh_online).replace(/👥/g, '').replace(/Active/g, '').replace(/Users/g, '').trim();
        return res.end(JSON.stringify({ 
            active_cfip: getActiveCfip(), 
            quick_url: quickUrl, 
            zt_domains: ztSshDomains, 
            zt_vmess_domains: ztVmessDomains, 
            pass_configured: passConfigured, 
            railway_public: rlwyPublicDomain || "Tidak Aktif",
            railway_sni: rlwyTcpDomain,
            status: "ONLINE", 
            dns_type: netSettings.dns_type,
            custom_dns: netSettings.custom_dns,
            engine_mode: netSettings.engine,
            ws_proxy_cfg: wsProxyCfg,
            sys_settings: sysSettings,
            ...hwInfo, 
            ssh_online: cleanOnlineStr || "0" 
        }));
    }

    // --- SERVING FILE STATIS (HTML, CSS, JS) ---
    if (pathName === '/' || pathName === '/index.html') {
        const filePath = path.join(__dirname, 'index.html');
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(fs.readFileSync(filePath, 'utf-8'));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end("index.html tidak ditemukan!");
        }
    }

    if (pathName === '/style.css') {
        const filePath = path.join(__dirname, 'style.css');
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'text/css; charset=utf-8' });
            return res.end(fs.readFileSync(filePath, 'utf-8'));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end("style.css tidak ditemukan!");
        }
    }

    if (pathName === '/app.js') {
        const filePath = path.join(__dirname, 'app.js');
        if (fs.existsSync(filePath)) {
            res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8' });
            return res.end(fs.readFileSync(filePath, 'utf-8'));
        } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            return res.end("app.js tidak ditemukan!");
        }
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end("Not Found");
});

// ========================================================
// HANDLER WEBSOCKET DUAL-MODE (UI WEB & VPN XRAY FORWARDING)
// ========================================================
function forwardWebsocket(targetPort, req, socket, head) {
    const net = require('net');
    const targetConn = net.createConnection({ port: targetPort, host: '127.0.0.1' }, () => {
        let rawHeaders = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
        for (let i = 0; i < req.rawHeaders.length; i += 2) {
            rawHeaders += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
        }
        rawHeaders += '\r\n';
        
        targetConn.write(rawHeaders);
        if (head && head.length > 0) targetConn.write(head);
        
        socket.pipe(targetConn);
        targetConn.pipe(socket);
    });

    targetConn.on('error', () => {
        try { socket.destroy(); } catch(e){}
    });
    
    socket.on('error', () => {
        try { targetConn.destroy(); } catch(e){}
    });
}

server.on('upgrade', (req, socket, head) => {
    const urlPath = req.url.split('?')[0];

    // Jika Request WebSocket khusus SSH WS
    if (urlPath === '/ssh-ws' || urlPath.startsWith('/ssh')) {
        const wsCfg = getWsProxyConfig();
        const targetPort = wsCfg.sshPort || 22;
        return forwardWebsocket(targetPort, req, socket, head);
    }
    
    // Semua Request WebSocket (VLESS / VMess / Trojan) langsung dilayangkan ke Xray (Port 8001)
    return forwardWebsocket(ARGO_PORT, req, socket, head);
});

// ========================================================
// START LISTEN SERVER
// ========================================================
server.listen(PORT, () => {
    console.log(`[UI & Xray Gateway Engine] Running seamlessly on port ${PORT}`);
    generateConfig().then(() => downloadFilesAndRun()).then(() => extractDomains()).catch(e => console.error(e));
    
    if (fs.existsSync(ZT_SINGLE_TOKEN_FILE)) {
        try {
            const savedToken = fs.readFileSync(ZT_SINGLE_TOKEN_FILE, 'utf8').trim();
            if (savedToken) restartSingleTunnel(savedToken);
        } catch(e) {}
    }

    setInterval(() => {
        extractDomains();
    }, 3000);

    setInterval(() => {
        exec("df -h / | awk 'NR==2 {print $5}'", (err, stdout) => {
            if (!err && stdout.trim()) cachedDiskUsage = stdout.trim();
        });

        exec("netstat -anp 2>/dev/null | grep dropbear | grep ESTABLISHED | awk '{print $5}' | cut -d: -f1 | sort -u", (err, stdout) => {
            if (!err && stdout.trim()) {
                const ipLines = stdout.trim().split('\n').filter(Boolean);
                if (ipLines.length > 0) {
                    cachedSshOnline = "1 User";
                    cachedUserListDetails = `IP Active: ${ipLines[0]}`;
                } else {
                    cachedSshOnline = "0 User";
                    cachedUserListDetails = "Semua user offline";
                }
            } else {
                cachedSshOnline = "0 User";
                cachedUserListDetails = "Semua user offline";
            }
        });
    }, 4000);
});
