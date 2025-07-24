import { ConnectionId, NetworkEvent } from "../src/INetwork";
import { SLogger } from "../src/Logger";
import { IPeerController } from "../src/PeerPool";
import { Protocol, ProtocolListener } from "../src/Protocol";
import { SignalingPeer } from "../src/SignalingPeer";

export class TestHelper {
    private static sLogger = new SLogger("test");
    static get logger(): SLogger {
        return this.sLogger;
    }
}

// Mock Protocol implementation for testing
export class MockProtocol extends Protocol {
    private identity: string;
    private sentEvents: NetworkEvent[] = [];
    private disposed: boolean = false;

    public get Listener(): ProtocolListener {
        return this.mListener;
    }   

    constructor(identity: string = 'test-peer') {
        super();
        this.identity = identity;
    }

    send(evt: NetworkEvent): void {
        this.sentEvents.push(evt);
    }

    getIdentity(): string {
        return this.identity;
    }

    dispose(): void {
        this.disposed = true;
        // Simulate protocol cleanup triggering onNetworkClosed
        if (this.mListener) {
            this.mListener.onNetworkClosed();
        }
    }

    // Test helpers
    getSentEvents(): NetworkEvent[] {
        return [...this.sentEvents];
    }

    clearSentEvents(): void {
        this.sentEvents = [];
    }

    isDisposed(): boolean {
        return this.disposed;
    }

    // Simulate incoming network events
    simulateNetworkEvent(evt: NetworkEvent): void {
        if (this.mListener) {
            this.mListener.onNetworkEvent(evt);
        }
    }
}

// Mock PeerController implementation for testing
export class MockPeerController implements IPeerController {
    private listeningRequests: Array<{ client: SignalingPeer, address: string }> = [];
    private stopListeningRequests: Array<{ client: SignalingPeer, address: string }> = [];
    private connectionRequests: Array<{ client: SignalingPeer, address: string, id: ConnectionId }> = [];
    private cleanupRequests: SignalingPeer[] = [];

    onListeningRequest(client: SignalingPeer, address: string): void {
        this.listeningRequests.push({ client, address });
    }

    onStopListening(client: SignalingPeer, address: string): void {
        this.stopListeningRequests.push({ client, address });
    }

    onConnectionRequest(client: SignalingPeer, address: string, id: ConnectionId): void {
        this.connectionRequests.push({ client, address, id });
    }

    onCleanup(client: SignalingPeer): void {
        this.cleanupRequests.push(client);
    }

    // Test helpers
    getListeningRequests() { return [...this.listeningRequests]; }
    getStopListeningRequests() { return [...this.stopListeningRequests]; }
    getConnectionRequests() { return [...this.connectionRequests]; }
    getCleanupRequests() { return [...this.cleanupRequests]; }

    clearRequests(): void {
        this.listeningRequests = [];
        this.stopListeningRequests = [];
        this.connectionRequests = [];
        this.cleanupRequests = [];
    }
}