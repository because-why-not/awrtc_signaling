import { Protocol } from './Protocol';
import { IPeerController } from './PeerPool';
import { WebsocketNetworkServer } from './WebsocketNetworkServer';
import { ConnectionId, NetEventType, NetworkEvent } from './INetwork';
import { ILogger } from './Logger';

export enum SignalingConnectionState {
    Uninitialized,
    Connecting, //not needed but in the future the client might need to send info across before being fully connected
    Connected, //fully functional now. can send and receive messages
    Disconnecting, //about to propagate trough the system informing everyone that it is being disconnected
    Disconnected //means the instance is destroyed and unusable
}
export interface IConnectionIdPeerDictionary {
    [key: string]: SignalingPeer;
};


///note: all methods starting with "internal" might leave the system in an inconsistent state
///e.g. peerA is connected to peerB means peerB is connected to peerA but internalRemoveConnection
///could cause peerA being disconnected from peerB but peerB still thinking to be connected to peerA!!!
export class SignalingPeer {

    private mController: IPeerController;
    private mState: SignalingConnectionState = SignalingConnectionState.Uninitialized;
    public get state(): SignalingConnectionState {
        return this.mState;
    }

    private mConnections: IConnectionIdPeerDictionary = {};
    //C# version uses short so 16384 is 50% of the positive numbers (maybe might make sense to change to ushort or int)
    private mNextIncomingConnectionId: ConnectionId = new ConnectionId(16384);
    private mOwnAddress: string = null;
    private mProtocol: Protocol;
    private mLog: ILogger;

    public constructor(pool: IPeerController, protocol: Protocol, logger: ILogger) {
        this.mLog = logger;
        this.mState = SignalingConnectionState.Connecting;
        this.mController = pool;
        this.mProtocol = protocol;
        this.mProtocol.setListener({
            onNetworkEvent: this.onNetworkEvent,
            onNetworkClosed: this.onNetworkClose
        });
        this.mState = SignalingConnectionState.Connected;
    }

    private onNetworkEvent = (evt: NetworkEvent): void => {
        //update internal state based on the event
        if (evt.Type == NetEventType.NewConnection) {
            //client wants to connect to another client
            const address: string = evt.Info;

            //the id this connection should be addressed with
            const newConnectionId = evt.ConnectionId;
            this.connect(address, newConnectionId);

        } else if (evt.Type == NetEventType.ConnectionFailed) {

            //should never be received

        } else if (evt.Type == NetEventType.Disconnected) {

            //peer tries to disconnect from another peer
            const otherPeerId = evt.ConnectionId;
            this.disconnect(otherPeerId);

        } else if (evt.Type == NetEventType.ServerInitialized) {
            this.listen(evt.Info);
        } else if (evt.Type == NetEventType.ServerInitFailed) {
            //should never happen
        } else if (evt.Type == NetEventType.ServerClosed) {
            //stop server request
            this.stopListen();
        } else if (evt.Type == NetEventType.ReliableMessageReceived) {
            this.sendData(evt.ConnectionId, evt.MessageData, true);
        } else if (evt.Type == NetEventType.UnreliableMessageReceived) {
            this.sendData(evt.ConnectionId, evt.MessageData, false);
        }
    }
    //called by the protocol if the underlaying socket closed
    private onNetworkClose = (): void => {
        //cleanup is triggered by the protocol
        this.Cleanup();
    }

    private sendToClient(evt: NetworkEvent) {

        //this method might still be called during cleanup after a disconnect
        //check first if we are still connected
        if (this.mState == SignalingConnectionState.Connected) {
            this.mProtocol.send(evt);
        } else {
            this.mLog.logv(`dropped message of type ${NetEventType[evt.Type]} due to state ${ SignalingConnectionState[this.mState]}`);
        }
    }

    //used for onClose or NoPongTimeout
    private Cleanup() {
        //if the connection was cleaned up during a timeout it might get triggered again during closing.
        if (this.mState === SignalingConnectionState.Disconnecting || this.mState === SignalingConnectionState.Disconnected)
            return;
        this.mState = SignalingConnectionState.Disconnecting;
        this.mLog.logv("disconnecting.");


        this.mController.onCleanup(this);

        //disconnect all connections        
        for (const v in this.mConnections) {
            if (this.mConnections.hasOwnProperty(v))
                this.disconnect(new ConnectionId(+v));
        }

        //make sure the server address is freed 
        if (this.mOwnAddress != null) {
            this.stopListen();
        }
        //Ensure we dispose the socket if not done already
        //note this can trigger onSocketClosed again! 
        this.mProtocol.dispose();

        this.mState = SignalingConnectionState.Disconnected;
        this.mLog.logv("disconnected.");
    }

    private internalAddIncomingPeer(peer: SignalingPeer): void {

        //another peer connected to this (while allowing incoming connections)

        //store the reference
        const id = this.nextConnectionId();
        this.mConnections[id.id] = peer;

        //event to this (the other peer gets the event via addOutgoing
        this.sendToClient(new NetworkEvent(NetEventType.NewConnection, id, null));
    }

    private internalAddOutgoingPeer(peer: SignalingPeer, id: ConnectionId): void {
        //this peer successfully connected to another peer. id was generated on the 
        //client side

        this.mConnections[id.id] = peer;

        //event to this (the other peer gets the event via addOutgoing
        this.sendToClient(new NetworkEvent(NetEventType.NewConnection, id, null));
    }

    private internalRemovePeer(id: ConnectionId) {
        delete this.mConnections[id.id];
        this.sendToClient(new NetworkEvent(NetEventType.Disconnected, id, null));
    }
    //test this. might cause problems
    //the number is converted to string trough java script but we need get back the number
    //for creating the connection id
    private findPeerConnectionId(otherPeer: SignalingPeer) {

        for (const peer in this.mConnections) {
            if (this.mConnections[peer] === otherPeer) {

                return new ConnectionId(+peer);
            }
        }
    }

    private nextConnectionId(): ConnectionId {
        const result = this.mNextIncomingConnectionId;
        this.mNextIncomingConnectionId = new ConnectionId(this.mNextIncomingConnectionId.id + 1);
        return result;
    }

    //this peer initializes a connection to a certain address. The connection id is set by the client
    //to allow tracking of the connection attempt
    public connect(address: string, newConnectionId: ConnectionId) {
        this.mController.onConnectionRequest(this, address, newConnectionId);
    }

    public acceptOutgoingConnection(otherPeer: SignalingPeer, newConnectionId: ConnectionId) {
        this.internalAddOutgoingPeer(otherPeer, newConnectionId);
    }

    public acceptIncomingConnection(otherPeer: SignalingPeer) {
        this.internalAddIncomingPeer(otherPeer);
    }

    public denyConnection(address: string, newConnectionId: ConnectionId) {
        //addresses are currently not sent back. 
        this.sendToClient(new NetworkEvent(NetEventType.ConnectionFailed, newConnectionId, null));
    }

    public disconnect(connectionId: ConnectionId) {
        const otherPeer = this.mConnections[connectionId.id];

        if (otherPeer != null) {

            const idOfOther = otherPeer.findPeerConnectionId(this);
            if (idOfOther === undefined) {
                this.mLog.error("Tried to disconnect from a peer that is not connected. Bug in IController not creating bidrectional connections? " + otherPeer.getIdentity());
                return;
            }
            //find the connection id the other peer uses to talk to this one
            this.internalRemovePeer(connectionId);
            otherPeer.internalRemovePeer(idOfOther);
        } else {
            //the connectionid isn't connected 
            //invalid -> do nothing or log?
        }
    }

    private listen(address: string) {

        //what to do if it is already a server?
        if (this.mOwnAddress != null)
            this.stopListen();

        this.mController.onListeningRequest(this, address);
    }

    public acceptListening(address: string) {
        this.mOwnAddress = address;
        this.sendToClient(new NetworkEvent(NetEventType.ServerInitialized, ConnectionId.INVALID, address));
    }

    public denyListening(address: string) {
        this.sendToClient(new NetworkEvent(NetEventType.ServerInitFailed, ConnectionId.INVALID, address));
    }

    public stopListen() {
        this.mController.onStopListening(this, this.mOwnAddress);

        if (this.mOwnAddress == null) {
            //not possible under normal operation. This indicates the bug send a message
            //to stop listening without ever having aquired an address (client side bug)
            //or the server lost track of the address
            this.mLog.error("Tried to stop listening on an address but no address was set. Server or client side bug?");
            return;
        }
        this.sendToClient(new NetworkEvent(NetEventType.ServerClosed, ConnectionId.INVALID, null));
        this.mOwnAddress = null;
    }

    //delivers the message to the local peer
    private forwardMessage(senderPeer: SignalingPeer, msg: any, reliable: boolean) {

        const id = this.findPeerConnectionId(senderPeer);
        if (reliable)
            this.sendToClient(new NetworkEvent(NetEventType.ReliableMessageReceived, id, msg));
        else
            this.sendToClient(new NetworkEvent(NetEventType.UnreliableMessageReceived, id, msg));
    }
    public sendData(id: ConnectionId, msg: any, reliable: boolean) {

        const peer = this.mConnections[id.id];
        if (peer != null)
            peer.forwardMessage(this, msg, reliable);
    }

    public getIdentity(): string {
        //used to identify this peer for log messages / debugging
        return this.mProtocol.getIdentity();
    }

}
