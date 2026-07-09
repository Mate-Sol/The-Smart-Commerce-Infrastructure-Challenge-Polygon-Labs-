# PayMate PSP + admin (legacy) client — Vite static build served by nginx.
# Multi-stage so CI builds dist/ inside the image (dist/ is gitignored and
# not committed, so it must be produced here, not copied from the context).
# Build args:
#   VITE_API_URL, VITE_CHAIN_ID, VITE_CHAIN_NAME, VITE_RPC_URL, VITE_*_ADDRESS
# All VITE_* need to be present at BUILD time (Vite bakes them in).
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit

COPY . .

ARG VITE_API_URL
ARG VITE_CHAIN_ID
ARG VITE_CHAIN_NAME
ARG VITE_CHAIN_NATIVE_SYMBOL
ARG VITE_RPC_URL
ARG VITE_STABLECOIN_ADDRESS
ARG VITE_FACTORY_ADDRESS
ARG VITE_WALLETCONNECT_PROJECT_ID

ENV VITE_API_URL=${VITE_API_URL}
ENV VITE_CHAIN_ID=${VITE_CHAIN_ID}
ENV VITE_CHAIN_NAME=${VITE_CHAIN_NAME}
ENV VITE_CHAIN_NATIVE_SYMBOL=${VITE_CHAIN_NATIVE_SYMBOL}
ENV VITE_RPC_URL=${VITE_RPC_URL}
ENV VITE_STABLECOIN_ADDRESS=${VITE_STABLECOIN_ADDRESS}
ENV VITE_FACTORY_ADDRESS=${VITE_FACTORY_ADDRESS}
ENV VITE_WALLETCONNECT_PROJECT_ID=${VITE_WALLETCONNECT_PROJECT_ID}

# Heavy dep tree (Solana adapters, CopilotKit, Sentry) can exhaust Node's
# default heap during the Vite build on CI runners -> exit 137. Raise it.
ENV NODE_OPTIONS=--max-old-space-size=4096

RUN npm run build

# ── nginx stage ──────────────────────────────────────────────
FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html

# SPA fallback so React Router deep links resolve. Listen on 8080 to match
# the ploygon-admin Service targetPort.
RUN echo 'server { \
  listen 8080; \
  server_name _; \
  root /usr/share/nginx/html; \
  index index.html; \
  location / { try_files $uri $uri/ /index.html; } \
  location ~* \\.(css|js|svg|png|jpg|jpeg|webp|ico)$ { \
    expires 30d; add_header Cache-Control "public"; \
  } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
