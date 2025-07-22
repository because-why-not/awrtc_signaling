import { ConnectionId } from "./INetwork";
import { ILogger } from "./Logger";
import { AppConfig } from "./ServerConfig";
import { SignalingPeer } from "./SignalingPeer";
import { WebsocketEndpoint } from "./WebsocketEndpoint";
import { WebsocketNetworkServer } from "./WebsocketNetworkServer";
import { BinaryWebsocketProtocol } from "./WebsocketProtocol";

//Dictionary containing a list of peers that all listen on the same address.
export interface IAddressPeerDictionary {
    [key: string]: Array<SignalingPeer>;
};

export interface IPeerController {

    /** Peer requested to listen on an address to receive incoming connections.
     * 
     * Request must result in call to client.acceptListening or client.denyListening
     * 
     * @param client Peer that raised the event
     * @param address Address the peer wants to listen on
     */
    onListeningRequest(client: SignalingPeer, address: string): void;

    /** Called when a peer stops listening on an address. 
     * This can not be denied and the address must be freed during this call.
     * The peer automatically receives a confirmation that the address is no longer in use.
     * 
     * @param client Peer that raised this event
     * @param address Peer address that was stopped listening on
     */
    onStopListening(client: SignalingPeer, address: string): void;

    /** Called when a client requests an outgoing connection to an address.
     * 
     * @param client Peer the request comes from
     * @param address Address of a peer to connect to
     * @param id the connection id the peer chose for this connection (decided client side)
     */
    onConnectionRequest(client: SignalingPeer, address: string, id: ConnectionId): void;


    onCleanup(client: SignalingPeer): void;
}

//Pool of client connects that are allowed to communicate to each other
export abstract class PeerPool implements IPeerController {

    // List of all peer connectin in this pool.
    protected mConnections: Array<SignalingPeer> = new Array<SignalingPeer>();

    // Dictionary of addresses and the peers that listen on them
    protected mServers: IAddressPeerDictionary = {};

    protected maxAddressLength = 256;

    protected mLog: ILogger;

    constructor(logger: ILogger) {
        this.mLog = logger;
    }

    public abstract get name(): string;


    //add a new connection based on this websocket
    public add(ep: WebsocketEndpoint) {
        const peerName = ep.getConnectionInfo();
        const peerLogger = this.mLog.createSub(peerName);

        this.mLog.log("new peer for pool " + this.name + " remote address: " + ep.getConnectionInfo() + " local address: " + ep.getLocalConnectionInfo());
        const protocol = new BinaryWebsocketProtocol(ep, peerLogger);
        const peer = new SignalingPeer(this, protocol,  peerLogger);
        this.mConnections.push(peer);
    }

    //Returns the SignalingClientConnection that opened a server using the given address
    //or null if address not in use
    public getServerConnection(address: string): SignalingPeer[] {
        return this.mServers[address];
    }

    //Removes a given connection from the pool
    public removeConnection(client: SignalingPeer) {
        const index = this.mConnections.indexOf(client);
        if (index != -1) {
            this.mConnections.splice(index, 1);
        } else {
            this.mLog.warn("Tried to remove unknown SignalingClientConnection. Bug?" + client.getIdentity());
        }
    }


    public count(): number {
        return this.mConnections.length;
    }


    //adds a new address. No checks are performed here.
    public addListener(client: SignalingPeer, address: string): void {

        if (this.mServers[address] == null) {
            this.mServers[address] = new Array<SignalingPeer>();
        }
        this.mServers[address].push(client);
    }

    //Removes an address from the server. No checks performed
    public removeServer(client: SignalingPeer, address: string) {

        //supports address sharing. remove the client from the server list that share the address
        const index = this.mServers[address].indexOf(client);
        if (index != -1) {
            this.mServers[address].splice(index, 1);
        }
        //delete the whole list if the last one left
        if (this.mServers[address].length == 0) {
            delete this.mServers[address];
            this.mLog.logv("Address " + address + " released.");
        }
    }

    /** Request must result in call to client.acceptListening or client.denyListening
     * 
     * @param client 
     * @param address 
     */
    public abstract onListeningRequest(client: SignalingPeer, address: string): void;
    /** Called when a client stops listening on an address.
     * Free up the address in the local address pool.
     * 
     * @param client 
     * @param address 
     */
    public abstract onStopListening(client: SignalingPeer, address: string): void;

    public abstract onConnectionRequest(client: SignalingPeer, address: string, id: ConnectionId): void;

    public abstract onCleanup(client: SignalingPeer): void;
}


export class DefaultPeerPool extends PeerPool {
    private mAppConfig: AppConfig;
    public get name(): string {
        return this.mAppConfig.name;
    }

    private mAddressSharing = false;

    constructor(config: AppConfig, logger: ILogger) {
        super(logger);
        this.mAppConfig = config;
        if (this.mAppConfig.address_sharing) {
            this.mAddressSharing = this.mAppConfig.address_sharing;
        }
    }



    public onListeningRequest(client: SignalingPeer, address: string): void {
        if (this.isAddressAvailable(address)) {

            this.addListener(client, address);

            client.acceptListening(address);
            if (this.hasAddressSharing()) {
                //address sharing is active. connect to every endpoint already listening on this address
                this.acceptJoin(address, client);
            }
        } else {
            client.denyListening(address);
        }
    }

    //If multiple users listen on the same address we all connect them to each other
    //(hasAddressSharing flag is true)
    public acceptJoin(address: string, client: SignalingPeer): void {

        const serverConnections = this.getServerConnection(address);

        //in join mode every connection is incoming as everyone listens together
        if (serverConnections != null) {

            for (const v of serverConnections) {
                //avoid connecting the peer to itself
                if (v != client) {
                    v.acceptIncomingConnection(client);
                    client.acceptIncomingConnection(v);
                }
            }
        }
    }

    public onStopListening(client: SignalingPeer, address: string): void {

        this.removeServer(client, address);
    }


    public onConnectionRequest(client: SignalingPeer, address: string, newConnectionId: ConnectionId): void {

        //all peers listening to address
        //if this contains 0 peers -> connection fails because no one is listening
        //If this contains 1 peer -> connect to that peer
        //TODO: if it contains multiple peers -> trigger an error as connect can only be used for 1-to-1
        const serverConnections = this.getServerConnection(address);
        if (serverConnections != null && serverConnections.length == 1) {

            const otherPeer = serverConnections[0];
            //tell the other user they received an incoming connection
            otherPeer.acceptIncomingConnection(client);
            //tell this peer about the new connection
            client.acceptOutgoingConnection(otherPeer, newConnectionId);
        } else {
            //if address is not in use or it is in multi join mode -> connection fails
            client.denyConnection(address, newConnectionId);
        }
    }


    public hasAddressSharing(): boolean {
        return this.mAddressSharing;
    }


    //Tests if the address is available for use. 
    //returns true in the following cases
    //the address is longer than the maxAddressLength and the server the address is not yet in use or address sharing is active
    public isAddressAvailable(address: string): boolean {
        if (address.length <= this.maxAddressLength // only allow addresses shorter than maxAddressLength
            && (this.mServers[address] == null || this.mAddressSharing)) {
            return true;
        }
        return false;
    }

    public onCleanup(client: SignalingPeer): void {
        this.removeConnection(client);
        this.mLog.logv("removed peer " + client.getIdentity() + ""
            + " " + this.count()
            + " connections left in pool ");
    }
}