# Gunmate: no npm packages, so the image is just Node and four files
FROM node:22-alpine
WORKDIR /app
COPY server.js room.js rules.js index.html ./
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "server.js"]
