# =================================================================
# STAGE 1: BUILDER (Kompilasi BadVPN UDPGW)
# =================================================================
FROM ubuntu:22.04 AS builder

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
    cmake \
    make \
    gcc \
    g++ \
    curl \
    tar \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src

# Download dan compile badvpn-udpgw dari release github
RUN curl -fsSL https://github.com/ambrop72/badvpn/archive/refs/tags/1.999.130.tar.gz | tar -xz \
    && cd badvpn-1.999.130 \
    && mkdir build && cd build \
    && cmake .. -DBUILD_NOTHING_BY_DEFAULT=1 -DBUILD_UDPGW=1 \
    && make badvpn-udpgw

# =================================================================
# STAGE 2: RUNTIME (Pondasi Utama Aplikasi & Network Services)
# =================================================================
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

# Install Node.js, Dropbear, Stunnel, jq, dan tools pendukung
RUN apt-get update && apt-get install -y \
    curl \
    dropbear \
    stunnel4 \
    openssl \
    ca-certificates \
    procps \
    net-tools \
    bash \
    jq \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Unduh utilitas Cloudflared Resmi
RUN curl -fsSL -o /usr/local/bin/cloudflared https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    && chmod +x /usr/local/bin/cloudflared

# Salin binary badvpn-udpgw dari stage builder
COPY --from=builder /src/badvpn-1.999.130/build/udpgw/badvpn-udpgw /usr/local/bin/badvpn-udpgw
RUN chmod +x /usr/local/bin/badvpn-udpgw

# Atur Direktori Kerja Container
WORKDIR /app

# Salin package.json dan pasang dependensi NPM
COPY package.json ./
RUN npm install --omit=dev || npm install

# Salin seluruh berkas proyek ke container
COPY . .

# Berikan hak akses eksekusi script entrypoint
RUN chmod +x start.sh

# Eksekusi utama saat container aktif (Berjalan penuh sebagai ROOT)
CMD ["./start.sh"]