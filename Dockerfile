FROM node:24-alpine
WORKDIR /awrtc_signaling
COPY ./. ./.
RUN npm install
RUN npm run build
CMD ["npm", "start"]
EXPOSE 80 443