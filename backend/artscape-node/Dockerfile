FROM node:20-bookworm-slim
ARG DEBIAN_MIRROR=http://mirrors.aliyun.com
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends fonts-noto-cjk poppler-utils \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json hypha.lock.json ./
COPY backend/artscape-node/package.json backend/artscape-node/package.json
COPY Hypha Hypha
RUN npm --prefix Hypha install \
    && npm --prefix Hypha run build:packages -- --force \
    && npm ci \
    && mkdir -p node_modules/@hypha \
    && for package in adapters-local core domain fsm harness inference kernel mcp memory models serving-cache skills storage tools; do \
         ln -s "/app/Hypha/packages/$package" "node_modules/@hypha/$package"; \
       done
COPY backend/artscape-node backend/artscape-node
RUN test -f node_modules/@hypha/core/dist/index.d.ts \
    && node -e "console.log(require.resolve('@hypha/core'))" \
    && npm run build --workspace @artscape/backend
EXPOSE 3100
CMD ["npm", "run", "start", "--workspace", "@artscape/backend"]
