# ── Stage 1: build the React app ─────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build

# ── Stage 2: nginx with self-signed TLS ──────────────────────────────────────
FROM nginx:alpine

# Generate a self-signed certificate valid for 10 years.
# SAN (subjectAltName) is required by modern browsers — CN alone is not enough.
RUN apk add --no-cache openssl && mkdir -p /etc/nginx/ssl
COPY ssl.cnf /tmp/ssl.cnf
RUN openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
      -keyout /etc/nginx/ssl/key.pem \
      -out    /etc/nginx/ssl/cert.pem \
      -config /tmp/ssl.cnf && \
    rm /tmp/ssl.cnf

# Copy built React app from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Replace default nginx config with ours
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80 443
