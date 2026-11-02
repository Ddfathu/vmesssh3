let adminToken = localStorage.getItem("admin_session_token") || "";
let savedUsersData = []; 
let isPassConfigured = false;
let railwayDomainStored = "";

// ========================================================
// FUNGSI UNIVERSAL COPY (HTTPS + HTTP FALLBACK ALL BROWSER)
// ========================================================
function copyToClipboard(textToCopy, onSuccess) {
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(textToCopy)
            .then(() => { if (onSuccess) onSuccess(); })
            .catch(() => { fallbackCopyText(textToCopy, onSuccess); });
    } else {
        fallbackCopyText(textToCopy, onSuccess);
    }
}

function fallbackCopyText(text, onSuccess) {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.top = "-9999px";
    textArea.style.left = "-9999px";
    document.body.appendChild(textArea);
    
    textArea.focus();
    textArea.select();

    try {
        const successful = document.execCommand('copy');
        if (successful && onSuccess) {
            onSuccess();
        }
    } catch (err) {
        alert("Browser tidak mendukung copy otomatis!");
    }

    document.body.removeChild(textArea);
}

function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

// ========================================================
// NAVIGASI & UI HANDLER
// ========================================================
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('active');
    document.getElementById('sidebar-overlay').classList.toggle('active');
}

function switchPage(pageId, evt) {
    document.querySelectorAll('.page-section').forEach(page => {
        page.classList.remove('active');
    });
    document.getElementById(pageId).classList.add('active');

    document.querySelectorAll('.menu-item').forEach(item => {
        item.classList.remove('active');
    });
    
    if (evt && evt.currentTarget) {
        evt.currentTarget.classList.add('active');
    }

    toggleSidebar();
}

function checkAdminUI() {
    let indicator = document.getElementById('admin-indicator'); 
    let loginBtn = document.getElementById('admin-login-btn');
    let changePassBtn = document.getElementById('btn-change-pass');

    if (!isPassConfigured) {
        loginBtn.innerText = "SETUP PASS";
        loginBtn.style.background = "#f8fafc"; loginBtn.style.color = "#334155";
        if (changePassBtn) changePassBtn.style.display = "none";
    } else if (adminToken) {
        if (indicator) { indicator.innerText = "ADMIN ROUTE"; indicator.style.color = "#0284c7"; indicator.style.background = "#f0f9ff"; }
        loginBtn.innerText = "LOGOUT"; loginBtn.style.background = "#fef2f2"; loginBtn.style.color = "#dc2626";
        if (changePassBtn) changePassBtn.style.display = "inline";
        document.querySelectorAll('.btn-del').forEach(b => b.style.display = "inline-block"); 
        document.querySelectorAll('.btn-info').forEach(b => b.style.display = "inline-block");
    } else {
        if (indicator) { indicator.innerText = "PUBLIC CREATION"; indicator.style.color = "#475569"; indicator.style.background = "#f1f5f9"; }
        loginBtn.innerText = "LOGIN ADMIN"; loginBtn.style.background = "#f8fafc"; loginBtn.style.color = "#334155";
        if (changePassBtn) changePassBtn.style.display = "none";
        document.querySelectorAll('.btn-del').forEach(b => b.style.display = "none"); 
        document.querySelectorAll('.btn-info').forEach(b => b.style.display = "none");
    }
}

function toggleDnsPlaceholder() { toggleCustomDnsInput(); }

function toggleCustomDnsInput() {
    let sel = document.getElementById('dnsDropdown').value;
    let inp = document.getElementById('customDnsInput');
    inp.style.display = (sel === 'custom') ? 'block' : 'none';
}

function toggleCustomWsPortInput() {
    let sel = document.getElementById('wsPortDropdown').value;
    let inp = document.getElementById('wsPortInput');
    inp.style.display = (sel === 'custom') ? 'block' : 'none';
}

function toggleCustomWsKeepInput() {
    let sel = document.getElementById('wsKeepDropdown').value;
    let inp = document.getElementById('wsKeepInput');
    inp.style.display = (sel === 'custom') ? 'block' : 'none';
}

function toggleCustomWsBufInput() {
    let sel = document.getElementById('wsBufDropdown').value;
    let inp = document.getElementById('wsBufInput');
    inp.style.display = (sel === 'custom') ? 'block' : 'none';
}

// ========================================================
// ADMIN AUTHENTICATION
// ========================================================
async function handleAdminAuthBtn() {
    if (!isPassConfigured) {
        let newP = prompt("KREASI PASSWORD ADMIN PERTAMA KALI:\nMasukkan Password Admin Baru:");
        if (!newP) return false;
        try {
            let res = await fetch('/api/setup-pass?pass=' + encodeURIComponent(newP));
            let data = await res.json();
            alert(data.message);
            if (data.status === "success") { 
                adminToken = newP; 
                localStorage.setItem("admin_session_token", adminToken); 
                updateStats(); 
                return true;
            }
        } catch(e) { alert("Gagal membuat password!"); }
        return false;
    }

    if (adminToken) { 
        localStorage.removeItem("admin_session_token"); 
        adminToken = ""; 
        checkAdminUI(); 
        fetchAccounts(); 
        return false; 
    }
    
    let pass = prompt("Masukkan Password Admin:"); if(!pass) return false;
    try {
        let res = await fetch('/api/login?pass=' + encodeURIComponent(pass)); 
        let data = await res.json();
        if (data.status === "success") { 
            adminToken = data.token; 
            localStorage.setItem("admin_session_token", adminToken); 
            checkAdminUI(); 
            fetchAccounts(); 
            return true;
        } else { 
            alert(data.message); 
        }
    } catch(e) { alert("Gagal terhubung"); }
    return false;
}

async function changeAdminPassUI() {
    if (!adminToken) return;
    let newP = prompt("GANTI PASSWORD ADMIN:\nMasukkan Password Admin Baru:");
    if (!newP) return;
    try {
        let res = await fetch('/api/setup-pass?old_pass=' + encodeURIComponent(adminToken) + '&pass=' + encodeURIComponent(newP));
        let data = await res.json();
        alert(data.message);
        if (data.status === "success") { 
            adminToken = newP; 
            localStorage.setItem("admin_session_token", adminToken); 
            checkAdminUI(); 
        }
    } catch(e) { alert("Gagal mengupdate password!"); }
}

// ========================================================
// API & SYSTEM SETTINGS
// ========================================================
async function saveDnsNetworkSetting() {
    if (!adminToken) {
        alert("Akses Ditolak! Anda harus Login Admin terlebih dahulu.");
        let loggedIn = await handleAdminAuthBtn();
        if (!loggedIn && !adminToken) return;
    }

    let dnsType = document.getElementById('dnsTypeSelect').value;
    let selDns = document.getElementById('dnsDropdown').value;
    let customDns = (selDns === 'custom') ? document.getElementById('customDnsInput').value.trim() : selDns;
    let engine = document.getElementById('engineSelect').value;

    if (!customDns) customDns = "8.8.8.8";

    try {
        let res = await fetch('/api/set-network?pass=' + encodeURIComponent(adminToken) + '&dns_type=' + dnsType + '&custom_dns=' + encodeURIComponent(customDns) + '&engine=' + engine);
        let data = await res.json();
        alert(data.message);
        if (data.status === "success") updateStats();
    } catch(e) { alert("Gagal menyimpan konfigurasi ke backend!"); }
}

async function saveWsProxySettingUI() {
    if (!adminToken) {
        alert("Akses Ditolak! Anda harus Login Admin terlebih dahulu.");
        let loggedIn = await handleAdminAuthBtn();
        if (!loggedIn && !adminToken) return;
    }

    let selPort = document.getElementById('wsPortDropdown').value;
    let port = (selPort === 'custom') ? document.getElementById('wsPortInput').value.trim() : selPort;

    let selKeep = document.getElementById('wsKeepDropdown').value;
    let keep = (selKeep === 'custom') ? document.getElementById('wsKeepInput').value.trim() : selKeep;

    let selBuf = document.getElementById('wsBufDropdown').value;
    let buf = (selBuf === 'custom') ? document.getElementById('wsBufInput').value.trim() : selBuf;

    let banner = document.getElementById('bannerInput').value.trim();
    let bbr = document.getElementById('bbrSelect').value;
    let udpgw = document.getElementById('udpgwPortSelect').value;

    if (!port) port = "22";
    if (!keep) keep = "15000";
    if (!buf) buf = "32768";

    try {
        let res1 = await fetch('/api/set-wsproxy?pass=' + encodeURIComponent(adminToken) + '&ssh_port=' + port + '&keep_alive=' + keep + '&max_buffer=' + buf);
        let data1 = await res1.json();

        let res2 = await fetch('/api/set-system?pass=' + encodeURIComponent(adminToken) + '&banner=' + encodeURIComponent(banner) + '&enable_bbr=' + bbr + '&udpgw_port=' + udpgw);
        let data2 = await res2.json();

        alert(data1.message + "\n" + data2.message);
        updateStats();
    } catch(e) { alert("Gagal memperbarui SSH Config!"); }
}

async function promptSingleTokenInput() {
    if (!adminToken) {
        alert("Akses Ditolak! Anda harus Login Admin terlebih dahulu.");
        let loggedIn = await handleAdminAuthBtn();
        if (!loggedIn && !adminToken) return;
    }

    let inputToken = prompt("MASUKKAN TOKEN CLOUDFLARE ARGO:\n\n(Kosongkan lalu klik OK jika ingin menghapus token tersimpan)");
    if (inputToken === null) return;

    try {
        let res = await fetch('/api/set-token?pass=' + encodeURIComponent(adminToken) + '&token=' + encodeURIComponent(inputToken.trim()));
        let data = await res.json();
        alert(data.message);
        updateStats();
    } catch(e) { alert("Gagal memperbarui token!"); }
}

async function promptCfipInput() {
    if (!adminToken) {
        alert("Akses Ditolak! Anda harus Login Admin terlebih dahulu.");
        let loggedIn = await handleAdminAuthBtn();
        if (!loggedIn && !adminToken) return;
    }

    let inputIp = prompt("MASUKKAN IP CLEAN CLOUDFLARE (CFIP):\nContoh: 104.17.3.81\n\n(Kosongkan untuk reset ke default)");
    if (inputIp === null) return;

    try {
        let res = await fetch('/api/set-cfip?pass=' + encodeURIComponent(adminToken) + '&ip=' + encodeURIComponent(inputIp.trim()));
        let data = await res.json();
        alert(data.message);
        updateStats();
    } catch(e) { alert("Gagal memperbarui CFIP!"); }
}

async function updateStats() {
    try {
        let res = await fetch('/api/stats'); 
        let data = await res.json();
        isPassConfigured = data.pass_configured;
        checkAdminUI();

        document.getElementById('cpu').innerText = data.cpu_model || "N/A"; 
        document.getElementById('ram').innerText = (data.ram_used || "0") + " / " + (data.ram_total || "0"); 
        document.getElementById('disk').innerText = data.disk_usage || "0%"; 
        document.getElementById('uptime').innerText = data.uptime || "0 Hours";
        let detailActiveList = data.user_list_details || "Semua user offline";
        document.getElementById('ssh').innerHTML = (data.ssh_online || "0") + " Active<br><span style='font-size:9px; font-weight:normal; color:#64748b; display:block; margin-top:2px; white-space:pre-line;'>" + detailActiveList + "</span>";
        document.getElementById('display-cfip').innerText = data.active_cfip || "Default";

        if (data.dns_type) {
            document.getElementById('dnsTypeSelect').value = data.dns_type;
            document.getElementById('display-dns').innerText = (data.dns_type + " (" + (data.custom_dns || "8.8.8.8") + ")").toUpperCase();
        }
        if (data.custom_dns) {
            let dropdown = document.getElementById('dnsDropdown');
            let found = Array.from(dropdown.options).some(opt => opt.value === data.custom_dns);
            if (found) {
                dropdown.value = data.custom_dns;
            } else {
                dropdown.value = 'custom';
                document.getElementById('customDnsInput').value = data.custom_dns;
            }
            toggleCustomDnsInput();
        }
        if (data.engine_mode) {
            document.getElementById('engineSelect').value = data.engine_mode;
            document.getElementById('display-engine').innerText = data.engine_mode.toUpperCase();
        }
        if (data.ws_proxy_cfg) {
            let pDrop = document.getElementById('wsPortDropdown');
            let foundP = Array.from(pDrop.options).some(opt => opt.value == data.ws_proxy_cfg.sshPort);
            if (foundP) { pDrop.value = data.ws_proxy_cfg.sshPort; } else { pDrop.value = 'custom'; document.getElementById('wsPortInput').value = data.ws_proxy_cfg.sshPort; }
            toggleCustomWsPortInput();

            let kDrop = document.getElementById('wsKeepDropdown');
            let foundK = Array.from(kDrop.options).some(opt => opt.value == data.ws_proxy_cfg.keepAlive);
            if (foundK) { kDrop.value = data.ws_proxy_cfg.keepAlive; } else { kDrop.value = 'custom'; document.getElementById('wsKeepInput').value = data.ws_proxy_cfg.keepAlive; }
            toggleCustomWsKeepInput();

            let bDrop = document.getElementById('wsBufDropdown');
            let foundB = Array.from(bDrop.options).some(opt => opt.value == data.ws_proxy_cfg.maxBuffer);
            if (foundB) { bDrop.value = data.ws_proxy_cfg.maxBuffer; } else { bDrop.value = 'custom'; document.getElementById('wsBufInput').value = data.ws_proxy_cfg.maxBuffer; }
            toggleCustomWsBufInput();

            document.getElementById('display-ws-port').innerText = data.ws_proxy_cfg.sshPort;
            document.getElementById('display-ws-keep').innerText = (data.ws_proxy_cfg.keepAlive || 15000) + "ms";
        }

        if (data.sys_settings) {
            if (data.sys_settings.banner) document.getElementById('bannerInput').value = data.sys_settings.banner;
            if (data.sys_settings.enable_bbr) document.getElementById('bbrSelect').value = data.sys_settings.enable_bbr;
            if (data.sys_settings.udpgw_port) document.getElementById('udpgwPortSelect').value = data.sys_settings.udpgw_port;

            document.getElementById('display-bbr').innerText = (data.sys_settings.enable_bbr === "true") ? "ON" : "OFF";
            document.getElementById('display-udpgw').innerText = data.sys_settings.udpgw_port || "7300";
        }

        let ztContainer = document.getElementById('zt-container');
        if (data.zt_domains && data.zt_domains.length > 1) {
            let dropdownHtml = '<select id="named-url" class="select-zt-mini" onmousedown="event.stopPropagation()">';
            data.zt_domains.forEach(item => { dropdownHtml += '<option value="' + item.domain + '">' + item.domain + ' (' + item.port + ')</option>'; });
            dropdownHtml += '</select>';
            ztContainer.innerHTML = dropdownHtml;
        } else if (data.zt_domains && data.zt_domains.length === 1) {
            ztContainer.innerHTML = '<div class="url-box" id="named-url">' + data.zt_domains[0].domain + '</div>';
        } else {
            ztContainer.innerHTML = '<div class="url-box" id="named-url">Menghubungkan...</div>';
        }

        let ztVmessContainer = document.getElementById('zt-vmess-container');
        if (data.zt_vmess_domains && data.zt_vmess_domains.length > 1) {
            let dropdownVmessHtml = '<select id="vmess-named-url" class="select-zt-mini" onmousedown="event.stopPropagation()">';
            data.zt_vmess_domains.forEach(item => { dropdownVmessHtml += '<option value="' + item.domain + '">' + item.domain + ' (' + item.port + ')</option>'; });
            dropdownVmessHtml += '</select>';
            ztVmessContainer.innerHTML = dropdownVmessHtml;
        } else if (data.zt_vmess_domains && data.zt_vmess_domains.length === 1) {
            ztVmessContainer.innerHTML = '<div class="url-box" id="vmess-named-url">' + data.zt_vmess_domains[0].domain + '</div>';
        } else {
            ztVmessContainer.innerHTML = '<div class="url-box" id="vmess-named-url">Menghubungkan...</div>';
        }

        railwayDomainStored = data.railway_public && data.railway_public !== "Tidak Aktif" ? data.railway_public : "";
        document.getElementById('railway-url').innerText = data.railway_public || "Tidak Aktif"; 
        document.getElementById('sni-url').innerText = data.railway_sni || "Tidak Aktif"; 
        document.getElementById('quick-url').innerText = data.quick_url || "Menunggu Quick Tunnel...";

        // POPULASI DROPDOWN GENERATOR DOMAIN (AUTO-DETECT URL WOKKU)
        let currentHostDomain = window.location.hostname;
        let domainSelect = document.getElementById('domainSelect');
        let currentSelected = domainSelect.value;
        let optionsHtml = '';

        if (currentHostDomain) {
            optionsHtml += '<option value="' + currentHostDomain + '">Domain Utama: ' + currentHostDomain + '</option>';
        }

        if (railwayDomainStored) {
            optionsHtml += '<option value="' + railwayDomainStored + '">Railway Reality: ' + railwayDomainStored + '</option>';
        }

        if (data.quick_url && !data.quick_url.includes("Menunggu")) {
            optionsHtml += '<option value="' + data.quick_url + '">Quick Tunnel: ' + data.quick_url + '</option>';
        }

        if (data.zt_vmess_domains && data.zt_vmess_domains.length > 0) {
            data.zt_vmess_domains.forEach(d => {
                optionsHtml += '<option value="' + d.domain + '">Zero Argo: ' + d.domain + '</option>';
            });
        }

        if (!optionsHtml) {
            optionsHtml = '<option value="">-- Menunggu Domain --</option>';
        }

        domainSelect.innerHTML = optionsHtml;
        if (currentSelected) domainSelect.value = currentSelected;

    } catch(e) {}
}

// ========================================================
// MANAJEMEN AKUN SSH
// ========================================================
async function fetchAccounts() {
    try {
        let res = await fetch('/api/list'); 
        let data = await res.json(); 
        let tbody = document.getElementById('ssh-table-body'); 
        tbody.innerHTML = "";
        
        if (data.status === "success" && data.users.length > 0) {
            savedUsersData = data.users; 
            data.users.forEach(u => {
                tbody.innerHTML += '<tr><td style="font-weight:bold; color:#0f172a;">'+u.username+'</td><td style="color:#475569;">'+u.shell+'</td><td style="text-align: right;"><div class="btn-action-group"><button class="btn-info" onclick="showAccountDetails(\''+u.username+'\')">INFO</button><button class="btn-del" onclick="deleteAccount(\''+u.username+'\')">HAPUS</button></div></td></tr>';
            });
            checkAdminUI();
        } else { 
            tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#94a3b8;">Belum ada akun SSH kustom</td></tr>'; 
        }
    } catch(e) {}
}

function showAccountDetails(username) { 
    let userObj = savedUsersData.find(u => u.username === username); 
    if (userObj) { 
        alert("DATA AKUN:\n===============================\nUsername   : " + userObj.username + "\nPassword   : " + userObj.password + "\nIP Address : " + userObj.ip); 
    } 
}

async function createAccount() {
    let user = document.getElementById('ssh-user').value.trim(); 
    let pass = document.getElementById('ssh-pass').value.trim(); 
    let msg = document.getElementById('ssh-msg'); 
    let resBox = document.getElementById('ssh-result'); 
    let copyBtn = document.getElementById('btn-copy-acc');

    if (!user || !pass) { 
        msg.style.color = "#dc2626"; 
        msg.innerText = "Isi username & password!"; 
        return; 
    }
    
    try {
        let res = await fetch('/api/add?user=' + encodeURIComponent(user) + '&pass=' + encodeURIComponent(pass)); 
        let data = await res.json();
        if (data.status === "success") { 
            msg.innerText = ""; 
            resBox.innerText = data.message; 
            resBox.style.display = "block"; 
            copyBtn.style.display = "block"; 
            document.getElementById('ssh-user').value = ""; 
            document.getElementById('ssh-pass').value = ""; 
            fetchAccounts(); 
        } else { 
            msg.style.color = "#dc2626"; 
            msg.innerText = data.message; 
            resBox.style.display = "none"; 
            copyBtn.style.display = "none"; 
        }
    } catch(e) { msg.innerText = "Gagal memproses API"; }
}

async function deleteAccount(username) {
    if (!adminToken) { alert("Aksi Ilegal! Login Admin dulu Bos!"); return; }
    if (confirm("Hapus akun SSH " + username + "?")) {
        try {
            let res = await fetch('/api/delete?user=' + encodeURIComponent(username) + '&token=' + encodeURIComponent(adminToken)); 
            let data = await res.json();
            if (data.status === "success") { fetchAccounts(); } else { alert(data.message); }
        } catch(e) {}
    }
}

// ========================================================
// AKSI COPY TOMBOL
// ========================================================
function copyTxt(elementId, btnId) {
    let elem = document.getElementById(elementId);
    if (!elem) return;
    let urlText = elem.tagName === "SELECT" ? elem.value : elem.innerText;
    
    if (!urlText.includes("Menunggu") && !urlText.includes("Tidak Aktif")) {
        copyToClipboard(urlText, () => {
            let btn = document.getElementById(btnId);
            btn.innerText = "Done"; 
            btn.style.background = "#e2e8f0"; 
            btn.style.color = "#0284c7";
            setTimeout(() => { 
                btn.innerText = "Copy"; 
                btn.style.background = "#ffffff"; 
                btn.style.color = "#334155"; 
            }, 1500);
        });
    }
}

function copyAccountText() { 
    let txt = document.getElementById('ssh-result').innerText; 
    copyToClipboard(txt, () => {
        let btn = document.getElementById('btn-copy-acc'); 
        btn.innerText = "COPIED!"; 
        setTimeout(() => { btn.innerText = "COPY DETAIL AKUN"; }, 1500);
    });
}

function copyOutConfig() {
    let txt = document.getElementById('configText').innerText;
    copyToClipboard(txt, () => {
        alert('Config Berhasil Disalin!');
    });
}

// ========================================================
// CONVERTER GENERATOR ENGINES (CLASH & SINGBOX)
// ========================================================
function generateClashProxyOnly(protocol, targetConnect, selectedPort, uuid, targetSni, targetWsHost, finalPath, remark) {
    const isTls = selectedPort === "443";
    if (protocol === 'vless') {
        return `
proxies:
  - name: "${remark}"
    type: vless
    server: ${targetConnect}
    port: ${parseInt(selectedPort)}
    uuid: ${uuid}
    udp: true
    tls: ${isTls}
    servername: ${targetSni}
    skip-cert-verify: true
    network: ws
    ws-opts:
      path: "${finalPath}"
      headers:
        Host: ${targetWsHost}
`.trim();
    } else if (protocol === 'vmess') {
        return `
proxies:
  - name: "${remark}"
    type: vmess
    server: ${targetConnect}
    port: ${parseInt(selectedPort)}
    uuid: ${uuid}
    alterId: 0
    cipher: auto
    udp: true
    tls: ${isTls}
    servername: ${targetSni}
    skip-cert-verify: true
    network: ws
    ws-opts:
      path: "${finalPath}"
      headers:
        Host: ${targetWsHost}
`.trim();
    } else {
        return `
proxies:
  - name: "${remark}"
    type: trojan
    server: ${targetConnect}
    port: ${parseInt(selectedPort)}
    password: ${uuid}
    udp: true
    sni: ${targetSni}
    skip-cert-verify: true
    network: ws
    ws-opts:
      path: "${finalPath}"
      headers:
        Host: ${targetWsHost}
`.trim();
    }
}

function generateClashMihomo(protocol, targetConnect, selectedPort, uuid, targetSni, targetWsHost, finalPath, remark) {
    const proxyYaml = generateClashProxyOnly(protocol, targetConnect, selectedPort, uuid, targetSni, targetWsHost, finalPath, remark);
    return `
mixed-port: 7890
allow-lan: true
mode: rule
log-level: info
ipv6: false

dns:
  enable: true
  enhanced-mode: fake-ip
  nameserver:
    - 8.8.8.8
    - 1.1.1.1

${proxyYaml}

proxy-groups:
  - name: PROXY
    type: select
    proxies:
      - "${remark}"
      - DIRECT

rules:
  - GEOIP,LAN,DIRECT
  - MATCH,PROXY
`.trim();
}

function generateSingBoxJson(protocol, targetConnect, selectedPort, uuid, targetSni, targetWsHost, finalPath, remark) {
    const isTls = selectedPort === "443";
    let outboundObj = {
        type: protocol,
        tag: remark,
        server: targetConnect,
        server_port: parseInt(selectedPort),
        transport: {
            type: "ws",
            path: finalPath,
            headers: {
                Host: targetWsHost
            }
        }
    };

    if (protocol === 'vless' || protocol === 'vmess') {
        outboundObj.uuid = uuid;
    } else if (protocol === 'trojan') {
        outboundObj.password = uuid;
    }

    if (isTls) {
        outboundObj.tls = {
            enabled: true,
            server_name: targetSni,
            insecure: true
        };
    }

    const fullConfig = {
        log: { level: "info" },
        inbounds: [{ type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 2080 }],
        outbounds: [outboundObj, { type: "direct", tag: "direct" }],
        route: { auto_detect_interface: true }
    };

    return JSON.stringify(fullConfig, null, 2);
}

// ========================================================
// CONFIG GENERATOR ENGINE (V2RAY / CLASH / SINGBOX)
// ========================================================
async function fetchServerInfo() {
    try {
        const response = await fetch('/__info');
        if (!response.ok) return;
        const data = await response.json();
        if (data.uuid) document.getElementById('uuidInput').value = data.uuid;
        window.serverActivePaths = data.paths;
    } catch (e) {}
}

function buildRealityConfig(protocol, evt) {
    document.querySelectorAll('.btn-blue').forEach(b => b.classList.remove('btn-active'));
    if (evt && evt.target) evt.target.classList.add('btn-active');

    const uuid = document.getElementById('uuidInput').value.trim();
    let targetHost = railwayDomainStored || document.getElementById('domainSelect').value.trim();
    targetHost = targetHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
    const bugHost = document.getElementById('bugInput').value.trim() || 'v.whatsapp.net';
    
    const pathsMapping = window.serverActivePaths || { vless: '/vless-argo', vmess: '/vmess-argo', trojan: '/trojan-argo' };
    let basePath = pathsMapping[protocol] || '/' + protocol + '-argo';

    const area = document.getElementById('output-area');
    const label = document.getElementById('out-type');
    const txt = document.getElementById('configText');

    let protoLabel = (protocol === 'vless' ? 'VLESS' : (protocol === 'vmess' ? 'VMESS' : 'TROJAN'));
    let remark = 'REALITY-' + protoLabel + '-' + targetHost;

    let uriLink = '';
    if (protocol === 'vless') {
        uriLink = 'vless://' + uuid + '@' + targetHost + ':443?encryption=none&security=tls&sni=' + bugHost + '&fp=firefox&type=ws&host=' + targetHost + '&path=' + encodeURIComponent(basePath) + '#' + encodeURIComponent(remark);
    } else if (protocol === 'vmess') {
        let vmessObj = { v: "2", ps: remark, add: targetHost, port: "443", id: uuid, aid: "0", scy: "auto", net: "ws", type: "none", host: targetHost, path: basePath, tls: "tls", sni: bugHost, fp: "chrome" };
        uriLink = 'vmess://' + toBase64(JSON.stringify(vmessObj));
    } else {
        uriLink = 'trojan://' + uuid + '@' + targetHost + ':443?security=tls&sni=' + bugHost + '&type=ws&host=' + targetHost + '&path=' + encodeURIComponent(basePath) + '#' + encodeURIComponent(remark);
    }

    label.innerText = 'REALITY ' + protoLabel;
    txt.innerText = uriLink;
    area.style.display = 'block';
}

function buildConfig(protocol, type, evt) {
    document.querySelectorAll('.btn-blue').forEach(b => b.classList.remove('btn-active'));
    if (evt && evt.target) evt.target.classList.add('btn-active');
    
    const uuid = document.getElementById('uuidInput').value.trim();
    const hostSelect = document.getElementById('domainSelect');
    const host = hostSelect.value.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''); 
    const bugHost = document.getElementById('bugInput').value.trim() || host; 
    const engine = document.getElementById('engineSelect').value;
    
    const selectedPort = document.getElementById('portSelect') ? document.getElementById('portSelect').value : "443";
    const selectedFormat = document.getElementById('formatSelect') ? document.getElementById('formatSelect').value : "standard";
    const isTls = selectedPort === "443";
    const securityMode = isTls ? "tls" : "none";
    const fpParam = isTls ? "&fp=chrome" : "";

    const area = document.getElementById('output-area');
    const label = document.getElementById('out-type');
    const txt = document.getElementById('configText');

    if (!host || host.includes("Menunggu")) {
        alert("Domain Tunnel belum siap / belum dipilih!");
        return;
    }

    const pathsMapping = window.serverActivePaths || { vless: '/vless-argo', vmess: '/vmess-argo', trojan: '/trojan-argo' };
    let basePath = pathsMapping[protocol] || '/' + protocol + '-argo';
    
    let remark = 'DDFATHU-' + protocol.toUpperCase() + '-' + type.toUpperCase() + '-' + selectedPort;
    let configResult = '';

    let netType = engine;
    let targetConnect = (type === 'sni') ? bugHost : host;
    let targetSni = (type === 'sni_reverse') ? bugHost : host;
    let targetWsHost = (type === 'sni_reverse') ? bugHost : host;
    let finalPath = (type === 'cdn') ? ('/' + bugHost + basePath) : basePath;

    // --- HASIL BERDASARKAN FORMAT PILIHAN ---
    if (selectedFormat === 'clash_proxy') {
        label.innerText = remark + ' (CLASH PROXY)';
        configResult = generateClashProxyOnly(protocol, targetConnect, selectedPort, uuid, targetSni, targetWsHost, finalPath, remark);
    } 
    else if (selectedFormat === 'clash_mihomo') {
        label.innerText = remark + ' (CLASH MIHOMO)';
        configResult = generateClashMihomo(protocol, targetConnect, selectedPort, uuid, targetSni, targetWsHost, finalPath, remark);
    } 
    else if (selectedFormat === 'singbox') {
        label.innerText = remark + ' (SINGBOX JSON)';
        configResult = generateSingBoxJson(protocol, targetConnect, selectedPort, uuid, targetSni, targetWsHost, finalPath, remark);
    } 
    else {
        // STANDARD V2RAY LINK (DEFAULT)
        label.innerText = remark;
        if (protocol === 'vless') {
            let q = '?encryption=none&security=' + securityMode;
            if (isTls) q += '&sni=' + targetSni + fpParam;
            q += '&type=' + netType;
            if (netType === 'ws') q += '&host=' + targetWsHost + '&path=' + encodeURIComponent(finalPath);
            
            configResult = 'vless://' + uuid + '@' + targetConnect + ':' + selectedPort + q + '#' + encodeURIComponent(remark);
        } 
        else if (protocol === 'vmess') {
            let jsonVmess = {
                v: "2", ps: remark, add: targetConnect, port: selectedPort, id: uuid, aid: "0",
                scy: "auto", net: netType, type: "none", host: targetWsHost, path: finalPath,
                tls: isTls ? "tls" : "", sni: isTls ? targetSni : "", fp: isTls ? "chrome" : ""
            };
            configResult = 'vmess://' + toBase64(JSON.stringify(jsonVmess));
        } 
        else if (protocol === 'trojan') {
            let q = '?security=' + securityMode;
            if (isTls) q += '&sni=' + targetSni + fpParam;
            q += '&type=' + netType;
            if (netType === 'ws') q += '&host=' + targetWsHost + '&path=' + encodeURIComponent(finalPath);
            
            configResult = 'trojan://' + uuid + '@' + targetConnect + ':' + selectedPort + q + '#' + encodeURIComponent(remark);
        }
    }

    txt.innerText = configResult;
    area.style.display = 'block';
}

// ========================================================
// INISIALISASI HALAMAN
// ========================================================
setInterval(updateStats, 300000); 
updateStats(); 
fetchAccounts();
fetchServerInfo();
