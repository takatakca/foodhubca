# Screens gateway: Node 22 only, no dependency (deploy/screens/gateway).
FROM node:22-alpine
WORKDIR /gateway
COPY gateway-lib.mjs gateway.mjs ./
USER node
EXPOSE 8080
CMD ["node", "gateway.mjs"]
