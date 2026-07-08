# DeFa v2 lender client — Vite static build served by nginx
# Build args:
#   VITE_API_URL, VITE_CHAIN_ID, VITE_CHAIN_NAME, VITE_RPC_URL, VITE_*_ADDRESS
# All VITE_* need to be present at BUILD time (Vite bakes them in).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

COPY . .

# .env variables are needed at build for Vite. If provided via docker-compose
# they'll be baked into the static bundle.
ARG VITE_API_URL
ARG VITE_CHAIN_ID
ARG VITE_CHAIN_NAME
ARG VITE_CHAIN_NATIVE_SYMBOL
ARG VITE_CHAIN_NATIVE_DECIMALS
ARG VITE_RPC_URL
ARG VITE_CHAIN_EXPLORER_URL
ARG VITE_STABLECOIN_ADDRESS
ARG VITE_TREASURY_ADDRESS
ARG VITE_FACTORY_ADDRESS
ARG VITE_WALLETCONNECT_PROJECT_ID

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_CHAIN_ID=${VITE_CHAIN_ID}
ENV VITE_CHAIN_NAME=${VITE_CHAIN_NAME}
ENV VITE_CHAIN_NATIVE_SYMBOL=${VITE_CHAIN_NATIVE_SYMBOL}
ENV VITE_CHAIN_NATIVE_DECIMALS=${VITE_CHAIN_NATIVE_DECIMALS}
ENV VITE_RPC_URL=${VITE_RPC_URL}
ENV VITE_CHAIN_EXPLORER_URL=${VITE_CHAIN_EXPLORER_URL}
ENV VITE_STABLECOIN_ADDRESS=${VITE_STABLECOIN_ADDRESS}
ENV VITE_TREASURY_ADDRESS=${VITE_TREASURY_ADDRESS}
ENV VITE_FACTORY_ADDRESS=${VITE_FACTORY_ADDRESS}
ENV VITE_WALLETCONNECT_PROJECT_ID=${VITE_WALLETCONNECT_PROJECT_ID}

RUN npm run build

# ── nginx stage ──────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html

# SPA fallback — every unknown route serves index.html so react-router
# picks it up.
RUN echo 'server { \
  listen 80; \
  server_name _; \
  root /usr/share/nginx/html; \
  index index.html; \
  location / { try_files $uri $uri/ /index.html; } \
  location ~* \\.(css|js|svg|png|jpg|jpeg|webp|ico)$ { \
    expires 30d; add_header Cache-Control "public"; \
  } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
