FROM node:24-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 COOKIE_SECURE=1 DATA_DIR=/var/data
COPY package.json server.mjs ./
COPY public ./public
EXPOSE 3000
CMD ["node", "server.mjs"]
