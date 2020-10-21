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

import WebSocket = require('ws');
import * as url from 'url'
import * as http from 'http';
import * as inet from './INetwork'


export interface IAppConfig {
    name: string,
    path: string,
    address_sharing?:boolean
}


export interface IPoolDictionary {
    [path: string]: PeerPool;
}

/**
 * Gathers all data related to a single websocket.
 */
export class Endpoint
{
    public ws: WebSocket;
    public remoteAddress:string;
    public remotePort:number;
    public localAddress:string;
    public localPort:number;
    public appPath:string;

    getConnectionInfo():string{
        return this.remoteAddress + ":" + this.remotePort + " " + this.appPath;
    }

    getLocalConnectionInfo(): string{
        if(this.localAddress && this.localPort)
            return this.localAddress + ":" + this.localPort;
        return "unknown";
    }
}

export class WebsocketNetworkServer {
    private mPool: IPoolDictionary = {};

    private static sVerboseLog = true;
    public static SetLogLevel(verbose: boolean)
    {
        WebsocketNetworkServer.sVerboseLog = verbose;
    }

    public static logv(msg: string) {
        if(WebsocketNetworkServer.sVerboseLog)
            console.log("(" + new Date().toISOString() + ")" + msg);
    }

    private onConnection(ep : Endpoint) {
        this.mPool[ep.appPath].add(ep);
    }

    /**
     * Adds a new websocket server that will be used to receive incoming
     * connections for the given apps.
     *
     * @param websocketServer server used for the incoming connections
     * @param appConfig app the incoming connections are allowed to connect to.
     *  Apps can be given multiple times with different signaling servers to
     *  support different ports and protocols.
     */
    public addSocketServer(websocketServer: WebSocket.Server, appConfigs: IAppConfig[]): void {
        for(let i = 0; i < appConfigs.length; i++)
        {
            let app = appConfigs[i];
            if ((app.path in this.mPool) == false) {
                console.log("Add new pool " + app.path);
                this.mPool[app.path] = new PeerPool(app);
            }
        };

        websocketServer.on('connection', (socket: WebSocket, request: http.IncomingMessage) =>
        {
            let ep = new Endpoint();
            ep.ws = socket;
            ep.remoteAddress = request.socket.remoteAddress;
            ep.remotePort = request.socket.remotePort;
            ep.localAddress = request.socket.localAddress;
            ep.localPort = request.socket.localPort;
            ep.appPath = url.parse(request.url).pathname;

            if(ep.appPath in this.mPool)
            {
                if(WebsocketNetworkServer.sVerboseLog)
                    console.log("New websocket connection:" + ep.getConnectionInfo());
                this.onConnection(ep);
            }else{
                console.error("Websocket tried to connect to unknown app " + ep.appPath);
                socket.close();
            }
        });
    }
}

interface IAddressPeerDictionary {
    [key: string]: Array<SignalingPeer>;
};

/**
 * Pool of client connects that are allowed to communicate to each other
 */
class PeerPool {
    private mConnections: Array<SignalingPeer> = new Array<SignalingPeer>();
    private mServers: IAddressPeerDictionary = {};
    private mAddressSharing = false;

    private mAppConfig: IAppConfig;

    private maxAddressLength = 256;

    constructor(config: IAppConfig) {
        this.mAppConfig = config;
        if (this.mAppConfig.address_sharing) {
            this.mAddressSharing = this.mAppConfig.address_sharing;
        }
    }

    public hasAddressSharing(): boolean{
        return this.mAddressSharing;
    }

    /**
     * add a new connection based on this websocket
     */
    public add(ep: Endpoint) {
        let peer = new SignalingPeer(this, ep);
        this.mConnections.push(peer);
    }

    /**
     * Returns the SignalingClientConnection that opened a server using the
     * given address or null if address not in use
     */
    public getServerConnection(address: string): SignalingPeer[] {
        return this.mServers[address];
    }

    //Tests if the address is available for use.
    //returns true in the following cases
    //the address is shorter than the maxAddressLength and the server address is not yet in use or address sharing is active
    public isAddressAvailable(address: string): boolean{
        if (address.length <= this.maxAddressLength // only allow addresses shorter than maxAddressLength
            && (this.mServers[address] == null || this.mAddressSharing)) {
            return true;
        }
        return false;
    }

    //Adds the server. No checking is performed here! logic should be solely in the connection class
    public addServer(client: SignalingPeer, address: string) {
        if (this.mServers[address] == null) {
            this.mServers[address] = new Array<SignalingPeer>();
        }
        this.mServers[address].push(client);
    }

    //Removes an address from the server. No checks performed
    public removeServer(client: SignalingPeer, address: string) {

        //supports address sharing. remove the client from the server list that share the address
        let index = this.mServers[address].indexOf(client);
        if (index != -1) {
            this.mServers[address].splice(index, 1);
        }

        //delete the whole list if the last one left
        if (this.mServers[address].length == 0)
        {
            delete this.mServers[address];
            WebsocketNetworkServer.logv("Address " + address + " released.");
        }
    }

    //Removes a given connection from the pool
    public removeConnection(client: SignalingPeer) {
        let index = this.mConnections.indexOf(client);
        if (index != -1) {
            this.mConnections.splice(index, 1);
        } else {
            console.warn("Tried to remove unknown SignalingClientConnection. Bug?" + client.GetLogPrefix());
        }
    }

    public count(): number {
        return this.mConnections.length;
    }
}

enum SignalingConnectionState {
    Uninitialized,
    Connecting, //not needed but in the future the client might need to send info across before being fully connected
    Connected, //fully functional now. can send and receive messages
    Disconnecting, //about to propagate trough the system informing everyone that it is being disconnected
    Disconnected //means the instance is destroyed and unusable
}
interface IConnectionIdPeerDictionary {
    [key: string]: SignalingPeer;
};

/**
 * note: all methods starting with "internal" might leave the system in an
 * inconsistent state e.g. peerA is connected to peerB means peerB is connected
 * to peerA but internalRemoveConnection could cause peerA being disconnected
 * from peerB but peerB still thinking to be connected to peerA!!!
 */
class SignalingPeer {
    private mConnectionPool: PeerPool;
    private mEndPoint: Endpoint;
    private mState: SignalingConnectionState = SignalingConnectionState.Uninitialized;
    private mConnections: IConnectionIdPeerDictionary = {};
    // C# version uses short so 16384 is 50% of the positive numbers (maybe
    // might make sense to change to ushort or int)
    private mNextIncomingConnectionId: inet.ConnectionId = new inet.ConnectionId(16384);

    private mServerAddress: string;

    private mPingInterval: NodeJS.Timer;

    /**
     * false = We are waiting for a pong. If it
     * stays false until the next ping interval
     * we disconnect.
     */
    private mPongReceived: boolean;

    /// <summary>
    /// Version of the protocol implemented here
    /// </summary>
    public static readonly PROTOCOL_VERSION = 2;

    /// <summary>
    /// Minimal protocol version that is still supported.
    /// V 1 servers won't understand heartbeat and version
    /// messages but would just log an unknown message and
    /// continue normally.
    /// </summary>
    public static readonly PROTOCOL_VERSION_MIN = 1;

    /// <summary>
    /// Assume 1 until message received
    /// </summary>
    private mRemoteProtocolVersion = 1;

    public constructor(pool:PeerPool, ep: Endpoint) {
        this.mConnectionPool = pool;
        this.mEndPoint = ep;
        this.mPongReceived = true;

        this.mState = SignalingConnectionState.Connecting;


        WebsocketNetworkServer.logv("[" + this.mEndPoint.getConnectionInfo() + "]" +
            " connected on "  + this.mEndPoint.getLocalConnectionInfo());

        this.mEndPoint.ws.on('message', (message : any, flags: any) => {
            this.onMessage(message, flags);
        });
        this.mEndPoint.ws.on('error', (error: any) => {
            console.error(error);
        });
        this.mEndPoint.ws.on('close', (code: number, message: string) => { this.onClose(code, message);});

        this.mEndPoint.ws.on('pong', (data: any, flags: { binary: boolean }) =>
        {
            this.mPongReceived = true;
            this.logInc("pong");
        });

        this.mState = SignalingConnectionState.Connected;

        this.mPingInterval = setInterval(() => { this.doPing();}, 30000);
    }

    public GetLogPrefix(): string {
        //used to identify this peer for log messages / debugging
        return "[" + this.mEndPoint.getConnectionInfo() + "]";
    }

    private doPing() {
        if (this.mState == SignalingConnectionState.Connected && this.mEndPoint.ws.readyState == WebSocket.OPEN)
        {
            if (this.mPongReceived == false) {
                this.NoPongTimeout();
                return;
            }
            this.mPongReceived = false;
            this.mEndPoint.ws.ping();
            this.logOut("ping");
        }
    }

    private evtToString(evt: inet.NetworkEvent) : string
    {
        let output = "[";
        output += "NetEventType: (";
        output += inet.NetEventType[evt.Type];
        output += "), id: (";
        output += evt.ConnectionId.id;
        if (evt.Info != null) {
            output += "), Data: (";
            output += evt.Info;
        } else if (evt.MessageData != null) {
            let chars = new Uint16Array(evt.MessageData.buffer, evt.MessageData.byteOffset, evt.MessageData.byteLength / 2);
            output += "), Data: (";
            let binaryString = "";

            for (var i = 0; i < chars.length; i++) {
                binaryString += String.fromCharCode(chars[i]);
            }
            output += binaryString;
        }
        output += ")]";

        return output;
    }

    private onMessage(inmessage: any, flags: any): void {
        try {
            let msg = inmessage as Uint8Array;
            this.parseMessage(msg);
        } catch (err) {
            WebsocketNetworkServer.logv(this.GetLogPrefix() +" Invalid message received: " + inmessage + "  \n Error: " + err);
        }
    }

    private sendToClient(evt: inet.NetworkEvent) {
        //this method is also called during cleanup after a disconnect
        //check first if we are still connected

        //bugfix: aparently 2 sockets can be closed at exactly the same time without
        //onclosed being called immediately -> socket has to be checked if open
        if (this.mState == SignalingConnectionState.Connected
            && this.mEndPoint.ws.readyState == WebSocket.OPEN) {
            this.logOut(this.evtToString(evt));
            let msg = inet.NetworkEvent.toByteArray(evt);
            this.internalSend(msg);
        }
    }

    private logOut(msg:string)
    {
        WebsocketNetworkServer.logv(this.GetLogPrefix() + "OUT: " + msg);
    }

    private logInc(msg:string)
    {
        WebsocketNetworkServer.logv(this.GetLogPrefix() + "INC: " + msg);
    }

    private sendVersion(){
        let msg = new Uint8Array(2);
        let ver = SignalingPeer.PROTOCOL_VERSION;
        msg[0] = inet.NetEventType.MetaVersion;
        msg[1] = ver;
        this.logOut( "version " + ver);
        this.internalSend(msg);
    }

    private sendHeartbeat(){
        let msg = new Uint8Array(1);
        msg[0] = inet.NetEventType.MetaHeartbeat;
        this.logOut("heartbeat");
        this.internalSend(msg);
    }

    private internalSend(msg: Uint8Array){
        this.mEndPoint.ws.send(msg);
    }

    private onClose(code: number, error: string): void
    {
        WebsocketNetworkServer.logv(this.GetLogPrefix() + " CLOSED!");
        this.Cleanup();
    }

    private NoPongTimeout()
    {
        WebsocketNetworkServer.logv(this.GetLogPrefix()  + " TIMEOUT!");
        this.Cleanup();
    }

    //used for onClose or NoPongTimeout
    private Cleanup()
    {
        //if the connection was cleaned up during a timeout it might get triggered again during closing.
        if (this.mState === SignalingConnectionState.Disconnecting || this.mState === SignalingConnectionState.Disconnected)
            return;

        this.mState = SignalingConnectionState.Disconnecting;
        WebsocketNetworkServer.logv(this.GetLogPrefix() + " disconnecting.");

        if (this.mPingInterval != null) {
            clearInterval(this.mPingInterval);
        }

        this.mConnectionPool.removeConnection(this);

        //disconnect all connections
        let test: any = this.mConnections;//workaround for not having a proper dictionary yet...

        for (let v in this.mConnections) {
            if (this.mConnections.hasOwnProperty(v))
                this.disconnect(new inet.ConnectionId(+v));
        }

        //make sure the server address is freed
        if (this.mServerAddress != null){
            this.stopServer();
        }
        this.mEndPoint.ws.terminate();

        WebsocketNetworkServer.logv(this.GetLogPrefix() + "removed"
            + " " + this.mConnectionPool.count()
            + " connections left in pool ");
        this.mState = SignalingConnectionState.Disconnected;
    }

    private parseMessage(msg:Uint8Array):void
    {
        if(msg[0] == inet.NetEventType.MetaVersion)
        {
            let v = msg[1];
            this.logInc("protocol version " + v);
            this.mRemoteProtocolVersion = v;
            this.sendVersion();

        }else if(msg[0] == inet.NetEventType.MetaHeartbeat)
        {
            this.logInc("heartbeat");
            this.sendHeartbeat();
        }else{
            let evt = inet.NetworkEvent.fromByteArray(msg);
            this.logInc( this.evtToString(evt));
            this.handleIncomingEvent(evt);
        }
    }

    private handleIncomingEvent(evt: inet.NetworkEvent) {
        //update internal state based on the event
        if (evt.Type == inet.NetEventType.NewConnection) {
            //client wants to connect to another client
            let address: string = evt.Info;

            //the id this connection should be addressed with
            let newConnectionId = evt.ConnectionId;
            this.connect(address, newConnectionId);
        } else if (evt.Type == inet.NetEventType.ConnectionFailed) {
            //should never be received
        } else if (evt.Type == inet.NetEventType.Disconnected) {
            //peer tries to disconnect from another peer
            var otherPeerId = evt.ConnectionId;
            this.disconnect(otherPeerId);
        } else if (evt.Type == inet.NetEventType.ServerInitialized) {
            this.startServer(evt.Info);
        } else if (evt.Type == inet.NetEventType.ServerInitFailed) {
            //should never happen
        } else if (evt.Type == inet.NetEventType.ServerClosed) {
            //stop server request
            this.stopServer();
        } else if (evt.Type == inet.NetEventType.ReliableMessageReceived) {
            this.sendData(evt.ConnectionId, evt.MessageData, true);
        } else if (evt.Type == inet.NetEventType.UnreliableMessageReceived) {
            this.sendData(evt.ConnectionId, evt.MessageData, false);
        }
    }

    private internalAddIncomingPeer(peer: SignalingPeer): void {
        //another peer connected to this (while allowing incoming connections)

        //store the reference
        var id = this.nextConnectionId();
        this.mConnections[id.id] = peer;

        //event to this (the other peer gets the event via addOutgoing
        this.sendToClient(new inet.NetworkEvent(inet.NetEventType.NewConnection, id, null));
    }

    private internalAddOutgoingPeer(peer: SignalingPeer, id: inet.ConnectionId): void {
        //this peer successfully connected to another peer. id was generated on the
        //client side

        this.mConnections[id.id] = peer;

        //event to this (the other peer gets the event via addOutgoing
        this.sendToClient(new inet.NetworkEvent(inet.NetEventType.NewConnection, id, null));
    }

    private internalRemovePeer(id: inet.ConnectionId) {
        delete this.mConnections[id.id];
        this.sendToClient(new inet.NetworkEvent(inet.NetEventType.Disconnected, id, null));
    }

    //test this. might cause problems
    //the number is converted to string trough java script but we need get back the number
    //for creating the connection id
    private findPeerConnectionId(otherPeer: SignalingPeer) {
        for (let peer in this.mConnections) {
            if (this.mConnections[peer] === otherPeer) {
                return new inet.ConnectionId(+peer);
            }
        }
    }

    private nextConnectionId(): inet.ConnectionId {
        let result = this.mNextIncomingConnectionId;
        this.mNextIncomingConnectionId = new inet.ConnectionId(this.mNextIncomingConnectionId.id + 1);
        return result;
    }

    //public methods (not really needed but can be used for testing or server side deubgging)

    //this peer initializes a connection to a certain address. The connection id is set by the client
    //to allow tracking of the connection attempt
    public connect(address: string, newConnectionId: inet.ConnectionId) {
        var serverConnections = this.mConnectionPool.getServerConnection(address);

        //
        if (serverConnections != null && serverConnections.length == 1) {
            //inform the server connection about the new peer
            //events will be send by these methods

            //shared addresses -> connect to everyone listening

            serverConnections[0].internalAddIncomingPeer(this);
            this.internalAddOutgoingPeer(serverConnections[0], newConnectionId);
        } else {
            //if address is not in use or it is in multi join mode -> connection fails
            this.sendToClient(new inet.NetworkEvent(inet.NetEventType.ConnectionFailed, newConnectionId, null));

        }
    }

    //join connection happens if another user joins a multi address. it will connect to every address
    //listening to that room
    public connectJoin(address: string) {
        var serverConnections = this.mConnectionPool.getServerConnection(address);

        //in join mode every connection is incoming as everyone listens together
        if (serverConnections != null) {
            for (var v of serverConnections) {
                if (v != this) { //avoid connecting the peer to itself
                    v.internalAddIncomingPeer(this);
                    this.internalAddIncomingPeer(v);
                }
            }
        }
    }

    public disconnect(connectionId: inet.ConnectionId) {
        var otherPeer = this.mConnections[connectionId.id];

        if (otherPeer != null) {
            let idOfOther = otherPeer.findPeerConnectionId(this);

            //find the connection id the other peer uses to talk to this one
            this.internalRemovePeer(connectionId);
            otherPeer.internalRemovePeer(idOfOther);
        } else {
            //the connectionid isn't connected
            //invalid -> do nothing or log?
        }
    }

    public startServer(address: string) {
        //what to do if it is already a server?
        if (this.mServerAddress != null)
            this.stopServer();

        if (this.mConnectionPool.isAddressAvailable(address)) {
            this.mServerAddress = address;
            this.mConnectionPool.addServer(this, address);
            this.sendToClient(new inet.NetworkEvent(inet.NetEventType.ServerInitialized, inet.ConnectionId.INVALID, address));

            if (this.mConnectionPool.hasAddressSharing()) {
                //address sharing is active. connect to every endpoint already listening on this address
                this.connectJoin(address);
            }
        } else {
            this.sendToClient(new inet.NetworkEvent(inet.NetEventType.ServerInitFailed, inet.ConnectionId.INVALID, address));
        }
    }

    public stopServer() {
        if (this.mServerAddress != null) {
            this.mConnectionPool.removeServer(this, this.mServerAddress);
            this.sendToClient(new inet.NetworkEvent(inet.NetEventType.ServerClosed, inet.ConnectionId.INVALID, null));
            this.mServerAddress = null;
        }
        //do nothing if it wasnt a server
    }

    //delivers the message to the local peer
    private forwardMessage(senderPeer: SignalingPeer, msg: any, reliable: boolean) {
        let id = this.findPeerConnectionId(senderPeer);
        if (reliable)
            this.sendToClient(new inet.NetworkEvent(inet.NetEventType.ReliableMessageReceived, id, msg));
        else
            this.sendToClient(new inet.NetworkEvent(inet.NetEventType.UnreliableMessageReceived, id, msg));
    }

    public sendData(id: inet.ConnectionId, msg: any, reliable: boolean) {
        let peer = this.mConnections[id.id];
        if(peer != null)
            peer.forwardMessage(this, msg, reliable);
    }
}
