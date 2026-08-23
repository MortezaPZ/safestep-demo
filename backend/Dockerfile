# ─────────────────────────────────────────────────────────────
#  SafeStep Backend
#  تصویر سبک بر پایه‌ی Node 22 LTS
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine

# ابزار لازم برای healthcheck و اسکریپت‌های shell
RUN apk add --no-cache tini

WORKDIR /app

# ابتدا فقط مانیفست‌ها کپی می‌شوند تا لایه‌ی node_modules در
# بیلدهای بعدی از کش استفاده کند و با هر تغییر کد دوباره نصب نشود
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

COPY src ./src

ENV NODE_ENV=production
ENV PORT=4000
EXPOSE 4000

# اجرا با کاربر غیر root
USER node

# tini سیگنال‌ها را درست منتقل می‌کند تا خاموش شدن تمیز انجام شود
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
