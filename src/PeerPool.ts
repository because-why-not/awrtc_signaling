import { ConnectionId } from "./INetwork";
import { ILogger } from "./Logger";
import { Protocol } from "./Protocol";
import { AppConfig } from "./ServerConfig";
import { ISignalingPeer, SignalingPeer } from "./SignalingPeer";

//Dictionary containing a list of peers that all listen on the same address.
export interface IAddressPeerDictionary {
    [key: string]: Array<ISignalingPeer>;
};

export interface IPeerController {

    /** Peer requested to listen on an address to receive incoming connections.
     * 
     * Request must result in call to client.acceptListening or client.denyListening
     * 
     * @param client Peer that raised the event
     * @param address Address the peer wants to listen on
     */
    onListeningRequest(client: ISignalingPeer, address: string): void;

    /** Called when a peer stops listening on an address. 
     * This can not be denied and the address must be freed during this call.
     * The peer automatically receives a confirmation that the address is no longer in use.
     * 
     * @param client Peer that raised this event
     * @param address Peer address that was stopped listening on
     */
    onStopListening(client: ISignalingPeer, address: string): void;

    /** Called when a client requests an outgoing connection to an address.
     * 
     * @param client Peer the request comes from
     * @param address Address of a peer to connect to
     * @param id the connection id the peer chose for this connection (decided client side)
     */
    onConnectionRequest(client: ISignalingPeer, address: string, id: ConnectionId): void;


    onCleanup(client: ISignalingPeer): void;
}

//Pool of client connects that are allowed to communicate to each other
export abstract class PeerPool implements IPeerController {

    // List of all peer connections in this pool.
    protected mConnections: Array<ISignalingPeer> = new Array<ISignalingPeer>();

    // Dictionary of addresses and the peers that listen on them
    protected mListeners: IAddressPeerDictionary = {};

    protected maxAddressLength = 256;

    protected mLog: ILogger;

    constructor(logger: ILogger) {
        this.mLog = logger;
    }

    public abstract get name(): string;

    public addPeerFromProtocol(protocol: Protocol) {
        // using the identity returned by the protocol to identify the peer for now
        // e.g. this might be IP/port
        const peerLogger = this.mLog.createSub(protocol.getIdentity());
        const peer = new SignalingPeer(this, protocol, peerLogger);
        this.addPeer(peer);
    }
    public addPeer(peer: ISignalingPeer) {
        this.mConnections.push(peer);
    }

    /** Returns a list of all peers that listen on the given address.
     * 
     * @param address 
     * @returns 
     */
    public getListenerPeers(address: string): ISignalingPeer[] {
        return this.mListeners[address];
    }

    //Removes a given connection from the pool
    public removeConnection(client: ISignalingPeer) {
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
    public addListener(client: ISignalingPeer, address: string): void {

        if (this.mListeners[address] == null) {
            this.mListeners[address] = new Array<ISignalingPeer>();
        }
        this.mListeners[address].push(client);
    }

    //Removes an address from the server. No checks performed
    public removeListener(client: ISignalingPeer, address: string) {

        //supports address sharing. remove the client from the server list that share the address
        const index = this.mListeners[address].indexOf(client);
        if (index != -1) {
            this.mListeners[address].splice(index, 1);
        }
        //delete the whole list if the last one left
        if (this.mListeners[address].length == 0) {
            delete this.mListeners[address];
            this.mLog.logv("Address " + address + " released.");
        }
    }

    /** Request must result in call to client.acceptListening or client.denyListening
     * 
     * @param client 
     * @param address 
     */
    public abstract onListeningRequest(client: ISignalingPeer, address: string): void;
    /** Called when a client stops listening on an address.
     * Free up the address in the local address pool.
     * 
     * @param client 
     * @param address 
     */
    public abstract onStopListening(client: ISignalingPeer, address: string): void;

    public abstract onConnectionRequest(client: ISignalingPeer, address: string, id: ConnectionId): void;

    public abstract onCleanup(client: ISignalingPeer): void;
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

    public onListeningRequest(client: ISignalingPeer, address: string): void {
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
    public acceptJoin(address: string, client: ISignalingPeer): void {

        const listenerPeers = this.getListenerPeers(address);

        //in join mode every connection is incoming as everyone listens together
        if (listenerPeers != null) {

            for (const v of listenerPeers) {
                //avoid connecting the peer to itself
                if (v != client) {
                    v.acceptIncomingConnection(client);
                    client.acceptIncomingConnection(v);
                }
            }
        }
    }

    public onStopListening(client: ISignalingPeer, address: string): void {

        this.removeListener(client, address);
    }


    public onConnectionRequest(client: ISignalingPeer, address: string, newConnectionId: ConnectionId): void {

        //all peers listening to address
        //if this contains 0 peers -> connection fails because no one is listening
        //If this contains 1 peer -> connect to that peer
        //if it contains multiple peers -> error
        const listenerPeers = this.getListenerPeers(address);
        if (listenerPeers && listenerPeers.length == 1) {

            const otherPeer = listenerPeers[0];
            //tell the other user they received an incoming connection
            otherPeer.acceptIncomingConnection(client);
            //tell this peer about the new connection
            client.acceptOutgoingConnection(otherPeer, newConnectionId);
        } else if (listenerPeers && listenerPeers.length > 1) {
            // Outgoing connections are not supported for shared addresses. They are intendet to connect to a single peer only.
            this.mLog.warn("Peer " + client.getIdentity() + " attempted to create an outgoing connection to a shared address. This indicates a client side bug.");
            //deny to avoid any unexpected behavior 
            client.denyConnection(address, newConnectionId);
        }
        else {
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
            && (this.mListeners[address] == null || this.mAddressSharing)) {
            return true;
        }
        return false;
    }

    public onCleanup(client: ISignalingPeer): void {
        this.removeConnection(client);
        this.mLog.logv("removed peer " + client.getIdentity() + ""
            + " " + this.count()
            + " connections left in pool ");
    }
}