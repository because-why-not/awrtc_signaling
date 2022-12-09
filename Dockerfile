FROM node:19-alpine
WORKDIR /awrtc_signaling
COPY ./out/. ./.
RUN npm install
CMD ["node", "server.js"]
EXPOSE 80 443