FROM node:20-slim
WORKDIR /app
# packages are installed before the build (pure JavaScript, no native parts)
COPY node_modules ./node_modules
COPY package.json server.js index.html ./
EXPOSE 8080
CMD ["node", "server.js"]
