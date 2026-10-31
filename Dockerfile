# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# 1) وابستگی‌های ساخت — نصب کامل برای اجرای `astro build`
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
ENV npm_config_update_notifier=false
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---------------------------------------------------------------------------
# 2) ساخت برنامه — خروجی مستقل Astro (output: server)
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# 3) تصویر اجرا — فقط خروجی تولید و وابستگی‌های زمان اجرا
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=4321 \
	TZ=Asia/Tehran

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
	&& npm cache clean --force

# پوشه‌هایی که پنل در زمان اجرا در آن‌ها می‌نویسد. در compose به‌صورت والیوم
# سوار می‌شوند تا با ساخت دوبارهٔ تصویر از بین نروند.
RUN mkdir -p /app/data /app/src/content/blog /app/src/assets/uploads \
	&& chown -R node:node /app/data /app/src

COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src/content/blog ./src/content/blog
# Built-in media (including the editable Builder templates) is read at runtime.
# User uploads are excluded from the build context and remain a separate volume.
COPY --from=build --chown=node:node /app/src/assets/*.jpg ./src/assets/

USER node
EXPOSE 4321

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4321)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "./dist/server/entry.mjs"]
