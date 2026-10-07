FROM node:22-alpine
WORKDIR /app
COPY package.json server.mjs ./
COPY lib ./lib
COPY public ./public
ENV HOST=0.0.0.0 PORT=5173 GALLERY_DIR=/data
RUN mkdir /data && chown node:node /data
VOLUME /data
EXPOSE 5173
USER node
CMD ["node", "server.mjs"]
