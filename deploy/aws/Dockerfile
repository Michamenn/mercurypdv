# ============================================================
# Mercury PDV 1.3.1 — Imagem otimizada para AWS (ECR → EC2, ECS Fargate ou Elastic Beanstalk)
#
# Build (contexto = raiz do projeto):
#   docker build -t mercury-pdv:1.3.1 -f deploy/aws/Dockerfile .
# Push para o ECR:
#   aws ecr get-login-password --region sa-east-1 | docker login --username AWS --password-stdin <ACCOUNT>.dkr.ecr.sa-east-1.amazonaws.com
#   docker tag mercury-pdv:1.3.1 <ACCOUNT>.dkr.ecr.sa-east-1.amazonaws.com/mercury-pdv:1.3.1
#   docker push <ACCOUNT>.dkr.ecr.sa-east-1.amazonaws.com/mercury-pdv:1.3.1
#
# Guia completo: DEPLOY_AWS.md (na raiz do projeto)
# ============================================================

# Alpine: imagem final ~120 MB. node:sqlite é nativo do Node 22.5+ (zero compilação).
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

# 1) Dependências primeiro (camada cacheada; runtime só tem express + ws)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 2) Código da aplicação (só o que o runtime usa; data/, backups/ e logs/ ficam em volumes)
COPY server ./server
COPY public ./public

# 3) Diretórios persistentes com dono correto para o usuário não-root `node`
#    (o Docker preserva a posse ao popular o volume na 1ª utilização).
RUN mkdir -p /app/data /app/backups /app/logs \
 && chown -R node:node /app

USER node
EXPOSE 3000

# O próprio container informa saúde: usado pelo compose (EC2) e pelo ECS.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health >/dev/null 2>&1 || exit 1

# index.js faz checkpoint do WAL e fecha o SQLite no SIGTERM — encerramento limpo.
STOPSIGNAL SIGTERM
CMD ["node", "server/src/index.js"]
