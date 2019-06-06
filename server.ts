/*
Copyright (c) 2019, because-why-not.com Limited
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
import * as http from 'http';
import https = require('https');
import url = require('url');
import ws = require('ws');
import fs = require('fs');
import * as wns from './WebsocketNetworkServer';
import * as inet from './INetwork';
import serveStatic = require('serve-static');
import { AddressInfo } from 'net';
var finalhandler = require('finalhandler');

var config = require("./config.json");



console.log("This app was developed and tested with nodejs v6.9 and v8.9.1. Your current nodejs version: " + process.version)

//for backwards compatibility undefined still keeps the verbose log active
if(typeof config.log_verbose === 'undefined' || config.log_verbose == true)
{
    console.log('Using verbose log. This might lower performance. Add "log_verbose": false to config.json to deactivate this.');
    wns.WebsocketNetworkServer.SetLogLevel(true);
}else{
    wns.WebsocketNetworkServer.SetLogLevel(false);
}

/*

*/
if(process.env.port){
    console.log("The environment variable process.env.port is set to " + process.env.port 
    + ". Ports set in config json will be ignored");
}
if(process.env.port && config.httpConfig && config.httpsConfig)
{
    //Many hosting provider set process.env.port and don't allow multiple ports 
    //If this is the case https will be deactivated to avoid a crash due to two services 
    //trying to use the same port
    console.warn("Only http/ws will be started as only one port can be set via process.env.port.");
    console.warn("Remove the httpConfig section in the config.json if you want to use https"
     +" instead or make sure the PORT variable is not set by you / your provider.");
    delete config.httpsConfig;
}



//request handler that will deliver files from public directory
//can be used like a simple http / https webserver
var serve = serveStatic("./public");

//setup
var httpServer: http.Server = null;
var httpsServer: https.Server = null;

//this is used to handle regular http  / https requests
//to allow checking if the server is online
function defaultRequest(req, res) {
    console.log("http/https request received");
    var done = finalhandler(req, res);
    serve(req, res, done);
  }

  

if (config.httpConfig) {
    httpServer = http.createServer(defaultRequest);
    let options = {
        port: process.env.port || config.httpConfig.port,
        host: config.httpConfig.host
    }
    httpServer.listen(options, function () { 
        console.log('websockets/http listening on ', httpServer.address());
    });
}



if (config.httpsConfig) {
    httpsServer = https.createServer({
        key: fs.readFileSync(config.httpsConfig.ssl_key_file),
        cert: fs.readFileSync(config.httpsConfig.ssl_cert_file)
    }, defaultRequest);
    
    let options = {
        port: process.env.port || config.httpsConfig.port,
        host: config.httpsConfig.host
    }
    httpsServer.listen(options, function () {
        console.log('secure websockets/https listening on ', httpsServer.address());
        });
}


var websocketSignalingServer = new wns.WebsocketNetworkServer();



for (let app of config.apps) {
    if (httpServer) {

        //perMessageDeflate: false needs to be set to false turning off the compression. if set to true
        //the websocket library crashes if big messages are received (eg.128mb) no matter which payload is set!!!
        var webSocket = new ws.Server(
            {
                server: httpServer,
                path: app.path,
                maxPayload: config.maxPayload,
                perMessageDeflate: false
            });

        websocketSignalingServer.addSocketServer(webSocket, app);

    }
    if (httpsServer) {
        var webSocketSecure = new ws.Server(
            {
                server: httpsServer,
                path: app.path,
                maxPayload: config.maxPayload,
                perMessageDeflate: false
        } as any); //problem in the typings -> setup to only accept http not https so cast to any to turn off typechecks
        websocketSignalingServer.addSocketServer(webSocketSecure, app);

    }
}


