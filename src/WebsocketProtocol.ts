import WebSocket from 'ws';
import { NetEventType, NetworkEvent } from "./INetwork";
import { Protocol } from "./Protocol";
import { WebsocketEndpoint } from "./WebsocketEndpoint";
import { ILogger } from './Logger';

/** BinaryWebsocketProtocol communicate with the client via 
 * binary websockets. Used by WebRTC Video Chat, awrtc_browser or awrtc_python.
 */
export class BinaryWebsocketProtocol extends Protocol {

    /**
     * Version of the protocol implemented here
     */
    public static readonly PROTOCOL_VERSION = 2;

    /** Minimal protocol version that is still supported.
     */
    public static readonly PROTOCOL_VERSION_MIN = 1;

    /** Assume 1 until message received
     *  V1 servers won't understand heartbeat and version
     * messages but would just log an unknown message and continue normally.
     */
    private mRemoteProtocolVersion = 1;

    /** websocket specific  */
    private mEndPoint: WebsocketEndpoint;

    /** Interval used for ping messages */
    private mPingInterval: NodeJS.Timeout;

    /**false = We are waiting for a pong. If it
     * stays false until the next ping interval 
     * we disconnect.
     */
    private mPongReceived: boolean;

    /** True if object has been disposed and should no longer be used */
    private mIsDisposed: boolean = false;

    private mLog: ILogger

    constructor(ep: WebsocketEndpoint, logger: ILogger) {
        super();
        this.mEndPoint = ep;
        this.mLog = logger;
        this.mEndPoint.ws.on('message', (message: any, flags: any) => {
            this.onMessage(message, flags);
        });
        this.mEndPoint.ws.on('error', this.onError);
        this.mEndPoint.ws.on('close', (code: number, message: string) => { this.onClose(code, message); });

        this.mEndPoint.ws.on('pong', (data: any, flags: { binary: boolean }) => {
            this.mPongReceived = true;
            this.logInc("pong");
        });

        this.mPongReceived = true;
        this.mPingInterval = setInterval(() => { this.doPing(); }, 30000);

        this.mLog.logv(" connected on " + this.mEndPoint.getLocalConnectionInfo());
    }

    public send(evt: NetworkEvent): void {

        //bugfix: apprently 2 sockets can be closed at exactly the same time without
        //onclosed being called immediately -> socket has to be checked if open
        if (this.mEndPoint.ws.readyState == WebSocket.OPEN) {
            this.logOut(this.evtToString(evt));
            const msg = NetworkEvent.toByteArray(evt);
            this.internalSend(msg);
        } else {
            this.mLog.warn(`dropped message of type ${NetEventType[evt.Type]} because the websocket is not open. Websocket state: ${this.mEndPoint.ws.readyState}` );
        }
    }

    private logInc(msg: string) {
        this.mLog.logv("INC: " + msg);
    }

    private onMessage(inmessage: any, flags: any): void {

        try {
            const msg = inmessage as Uint8Array;
            this.processMessage(msg);
        } catch (err) {
            console.error("Caught exception:", err);
            this.mLog.error(this.getIdentity() + " Invalid message received: " + inmessage + "  \n Error: " + err);
        }
    }

    private onClose(code: number, error: string): void {
        this.mLog.logv(" CLOSED!");
        this.cleanup();
    }
    private onError = (error: any) => {
        this.mLog.error(" ERROR: " + error);
        this.cleanup();
    }

    public getIdentity(): string {
        //used to identify this peer for log messages / debugging
        return this.mEndPoint.getConnectionInfo();
    }

    private doPing() {
        if (this.mEndPoint.ws.readyState == WebSocket.OPEN) {
            if (this.mPongReceived == false) {
                this.onNoPongTimeout();
                return;
            }
            this.mPongReceived = false;
            this.mEndPoint.ws.ping();
            this.logOut("ping");
        }
    }

    private onNoPongTimeout() {
        this.mLog.logv("TIMEOUT!");
        this.cleanup();
    }

    //Triggers the cleanup process. 
    //This will also trigger the onCloseHandler!
    public dispose() {
        this.cleanup();
    }

    //Triggered by:
    // - NoPongTimeout
    // - onClose
    private cleanup() {
        if (this.mIsDisposed)
            return; //already cleaned up

        //stop timer
        this.cleanupInterval();

        //inform user side about disconnect
        this.mListener.onNetworkClosed();

        //close the websocket
        if (this.mEndPoint.ws.readyState != WebSocket.CLOSED) {
            this.mEndPoint.ws.close(1000, "Done");
            const fallbackWs = this.mEndPoint.ws;
            const closingTimeout = 5000;
            setTimeout(() => {
                if (fallbackWs.readyState != WebSocket.CLOSED) {
                    this.mLog.logv("Terminating websocket after " + closingTimeout + "ms.");
                    fallbackWs.terminate();
                }
            }, closingTimeout);
        }
        this.mIsDisposed = true;
    }

    private cleanupInterval() {
        if (this.mPingInterval != null) {
            clearInterval(this.mPingInterval);
        }
    }

    private processMessage(msg: Uint8Array): void {
        if (msg[0] == NetEventType.MetaVersion) {
            const v = msg[1];
            this.logInc("protocol version " + v);
            this.mRemoteProtocolVersion = v;
            this.sendVersion();

        } else if (msg[0] == NetEventType.MetaHeartbeat) {
            this.logInc("heartbeat");
            this.sendHeartbeat();
        } else {
            const evt = NetworkEvent.fromByteArray(msg);
            this.logInc(this.evtToString(evt));
            this.handleIncomingEvent(evt);
        }
    }

    private handleIncomingEvent(evt: NetworkEvent) {
        this.mListener.onNetworkEvent(evt);
    }

    private logOut(msg: string) {
        this.mLog.logv("OUT: " + msg);
    }

    private sendVersion() {
        const msg = new Uint8Array(2);
        const ver = BinaryWebsocketProtocol.PROTOCOL_VERSION;
        msg[0] = NetEventType.MetaVersion;
        msg[1] = ver;
        this.logOut("version " + ver);
        this.internalSend(msg);
    }

    private sendHeartbeat() {
        const msg = new Uint8Array(1);
        msg[0] = NetEventType.MetaHeartbeat;
        this.logOut("heartbeat");
        this.internalSend(msg);
    }

    private internalSend(msg: Uint8Array) {
        this.mEndPoint.ws.send(msg);
    }

    private evtToString(evt: NetworkEvent): string {

        let output = "[";
        output += "NetEventType: (";
        output += NetEventType[evt.Type];
        output += "), id: (";
        output += evt.ConnectionId.id;
        if (evt.Info != null) {
            output += "), Data: (";
            output += evt.Info;
        } else if (evt.MessageData != null) {
            const chars = new Uint16Array(evt.MessageData.buffer, evt.MessageData.byteOffset, evt.MessageData.byteLength / 2);
            output += "), Data: (";
            let binaryString = "";

            for (let i = 0; i < chars.length; i++) {
                binaryString += String.fromCharCode(chars[i]);
            }
            output += binaryString;
        }
        output += ")]";

        return output;
    }
}