# Mercury PDV 1.3 — imagem de produção
# Build: docker compose -f deploy/docker-compose.yml up -d --build
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# Dependências primeiro (aproveita cache de camada).
# node:sqlite é nativo do Node 22.5+ — zero dependência nativa a compilar.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Apenas o que o runtime usa (data/, backups/, logs/ ficam em volumes).
COPY server ./server
COPY public ./public

# Diretórios persistentes criados com dono correto para o usuário não-root
# `node` (o Docker preserva posse/permissão ao popular o volume na 1ª uso).
RUN mkdir -p /app/data /app/backups /app/logs \
 && chown -R node:node /app

USER node
EXPOSE 3000

# index.js fecha o SQLite com WAL checkpoint em SIGTERM (shutdown limpo).
CMD ["node", "server/src/index.js"]
