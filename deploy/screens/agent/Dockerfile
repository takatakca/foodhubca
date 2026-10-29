FROM node:22-alpine
WORKDIR /agent
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY agent.mjs commands.mjs ./
USER node
CMD ["node", "agent.mjs"]
