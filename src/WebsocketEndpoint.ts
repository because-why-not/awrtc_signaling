import WebSocket from 'ws';
import http from 'http';
import url from 'url'

/**
 * Gathers all data related to a single websocket. 
 * 
 */
export class WebsocketEndpoint {
    public ws: WebSocket;
    private remoteAddress: string;
    private remotePort: number;
    private localAddress: string;
    private localPort: number;
    public appPath: string;

    public constructor(ws: WebSocket, request: http.IncomingMessage) {
        this.ws = ws;

        this.remoteAddress = request.socket.remoteAddress;
        this.remotePort = request.socket.remotePort;
        this.localAddress = request.socket.localAddress;
        this.localPort = request.socket.localPort;
        this.appPath = url.parse(request.url).pathname;
    }

    getConnectionInfo(): string {

        return "(" + this.remoteAddress + ":" + this.remotePort + ")";
    }

    getLocalConnectionInfo(): string {
        if (this.localAddress && this.localPort)
            return "(" + this.localAddress + ":" + this.localPort + ")";
        return "unknown";
    }
}
