FROM node:19-alpine
WORKDIR /awrtc_signaling_build
COPY ./. ./.
RUN npm install
RUN npm run build
RUN mv out ../awrtc_signaling
WORKDIR /awrtc_signaling
RUN rm -rf /awrtc_signaling_build
RUN npm install
CMD ["node", "server.js"]
EXPOSE 80 443