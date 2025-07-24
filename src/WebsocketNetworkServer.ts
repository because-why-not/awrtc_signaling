import WebSocket from "ws";
import http from "http";
import { WebsocketEndpoint } from "./WebsocketEndpoint";
import { PeerPool } from "./PeerPool";
import { ILogger } from "./Logger";
import { BinaryWebsocketProtocol } from "./WebsocketProtocol";

export interface IPoolDictionary {
  [path: string]: PeerPool;
}
export class WebsocketNetworkServer {
  private mPool: IPoolDictionary = {};
  private mLog: ILogger;

  public constructor(logger: ILogger) {
    this.mLog = logger;
  }

  private onConnection(ep: WebsocketEndpoint, pool: PeerPool) {
    this.mLog.log(
      "new peer for pool " +
        pool.name +
        " remote address: " +
        ep.getConnectionInfo() +
        " local address: " +
        ep.getLocalConnectionInfo(),
    );
    const peerLogger = this.mLog.createSub(ep.getConnectionInfo());
    const protocol = new BinaryWebsocketProtocol(ep, peerLogger);
    pool.addPeerFromProtocol(protocol);
  }

  public addPeerPool(path: string, pool: PeerPool) {
    this.mLog.log("Add new pool " + path);
    this.mPool[path] = pool;
  }

  /**Adds a new websocket server that will be used to receive incoming connections for
   * the given apps.
   *
   * @param websocketServer server used for the incoming connections
   * @param requestChecker callback to validate any incoming requests
   */
  public addSocketServer(
    websocketServer: WebSocket.Server,
    requestChecker: (request: http.IncomingMessage) => boolean,
  ): void {
    websocketServer.on(
      "connection",
      (socket: WebSocket, request: http.IncomingMessage) => {
        if (requestChecker(request) == false) {
          socket.close(1008, "Invalid token");
          return;
        }
        const ep = new WebsocketEndpoint(socket, request);

        if (ep.appPath in this.mPool) {
          this.mLog.log(
            "New websocket connection from " +
              ep.getConnectionInfo() +
              " on " +
              ep.getLocalConnectionInfo(),
          );

          const pool = this.mPool[ep.appPath];
          this.onConnection(ep, pool);
        } else {
          this.mLog.error(
            "Websocket tried to connect to unknown app " + ep.appPath,
          );

          socket.close();
        }
      },
    );
  }
}
