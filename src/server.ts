import http from 'http';
import https from 'https';
import ws from 'ws';
import fs from 'fs';
import url from 'url';
import serveStatic from 'serve-static';
import finalhandler from 'finalhandler';

import * as wns from './WebsocketNetworkServer';
import { TokenManager } from './TokenManager';
import { ServerConfig, validatePort } from './ServerConfig';
import { DefaultPeerPool } from './PeerPool';

import { SLogger } from './Logger';  

const logger = new SLogger("sig");

const config: ServerConfig = require("../config.json");

logger.info("Your current nodejs version: " + process.version)

//for backwards compatibility undefined still keeps the verbose log active
if (typeof config.log_verbose === 'undefined' || config.log_verbose == true) {
    logger.log('Using verbose log. This might lower performance. Add "log_verbose": false to config.json to deactivate this.');
    logger.setLogLevel(true);
} else {
    logger.setLogLevel(false);
}


//This contains the actual logic of our signaling server
const signalingServer = new wns.WebsocketNetworkServer(logger);

config.apps.forEach((app) => {
    signalingServer.addPeerPool(app.path, new DefaultPeerPool(app, logger.createSub(app.path)));
})

//azure uses port
//heroku uses PORT
const env_port = process.env.port || process.env.PORT;

//handle special cloud service setup
if (env_port) {
    logger.log("The environment variable process.env.port or PORT is set to " + env_port
        + ". Ports set in config json will be ignored");

    //overwrite config ports to use whatever the cloud wants us to
    if (config.httpConfig)
        config.httpConfig.port = validatePort(env_port);

    if (config.httpsConfig)
        config.httpsConfig.port = validatePort(env_port);

    if (config.httpConfig && config.httpsConfig) {
        //Many cloud provider set process.env.port and don't allow multiple ports 
        //If this is the case https will be deactivated to avoid a crash due to two services 
        //trying to use the same port
        //heroku will actually reroute HTTPS port 443 to regular HTTP on 80 so one port with HTTP is enough
        logger.warn("Only http/ws will be started as only one port can be set via process.env.port.");
        logger.warn("Remove the httpConfig section in the config.json if you want to use https"
            + " instead or make sure the PORT variable is not set by you / your provider.");
        delete config.httpsConfig;
    }
}


//if adminToken is not a valid value the token manager just acts as a dummy allowing all connections
let tokenManager = new TokenManager(config.adminToken, config.log_verbose);
if (tokenManager.isActive()) {
    logger.log("Admin token set in config.json. Connections will be blocked by default unless a valid user token is used.");
} else {
    logger.log("No admin token set. The server allows all connections.");
}



//request handler that will deliver files from public directory
//can be used like a simple http / https webserver
//also needed for let's encrypt to get a free SSL certificate
const serve = serveStatic("./public", {dotfiles: "allow"});

//setup http/https endpoints
let httpServer: http.Server = null;
let httpsServer: https.Server = null;




//this is used to handle regular http / https requests
//to allow checking if the server is online
function defaultRequest(req: http.IncomingMessage, res: http.ServerResponse) {

    logger.log(`Request received from IP: ${req.socket.remoteAddress}:${req.socket.remotePort} to url ${req.url}`);
    const parsedUrl = url.parse(req.url!, true);
    const pathname = parsedUrl.pathname;
    if (pathname === '/api/admin/regUserToken') {
        tokenManager.processRequest(req, res);
    } else {
        //res.setHeader("Access-Control-Allow-Origin", "*"); //allow access from anywhere
        const done = finalhandler(req, res);
        serve(req, res, done);
    }
}



//Setup http endpoint for ws://
if (config.httpConfig) {
    httpServer = http.createServer(defaultRequest);
    let options = {
        port: config.httpConfig.port,
        host: config.httpConfig.host
    }

    httpServer.listen(options, function () {
        logger.log('websockets/http listening on ' + JSON.stringify(httpServer.address()));
    });
    //perMessageDeflate: false needs to be set to false turning off the compression. if set to true
    //the websocket library crashes if big messages are received (eg.128mb) no matter which payload is set!!!
    const webSocketServer = new ws.Server(
        {
            server: httpServer,
            //path: app.path,
            maxPayload: config.maxPayload,
            perMessageDeflate: false
        });
    //incoming websocket connections will be handled by signalingServer
    signalingServer.addSocketServer(webSocketServer, tokenManager.checkUserToken);
}



//Setup https endpoint for wss://
if (config.httpsConfig) {
    //load SSL files. If this crashes check the congig.json and make sure the files
    //are at the correct location
    httpsServer = https.createServer({
        key: fs.readFileSync(config.httpsConfig.ssl_key_file),
        cert: fs.readFileSync(config.httpsConfig.ssl_cert_file)
    }, defaultRequest);

    let options = {
        port: config.httpsConfig.port,
        host: config.httpsConfig.host
    }
    httpsServer.listen(options, function () {
        logger.log('secure websockets/https listening on ' + JSON.stringify(httpsServer.address()));
    });

    const webSocketSecure = new ws.Server({
        server: httpsServer,
        //path: app.path,
        maxPayload: config.maxPayload,
        perMessageDeflate: false
    });
    //incoming websocket connections will be handled by signalingServer
    signalingServer.addSocketServer(webSocketSecure, tokenManager.checkUserToken);
}