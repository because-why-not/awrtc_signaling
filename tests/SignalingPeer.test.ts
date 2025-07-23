import { SignalingPeer, SignalingConnectionState } from '../src/SignalingPeer';
import { IPeerController } from '../src/PeerPool';
import { Protocol, ProtocolListener } from '../src/Protocol';
import { ConnectionId, NetEventType, NetworkEvent } from '../src/INetwork';
import { TestHelper } from './TestHelper';
import { beforeEach, describe, expect, test } from 'vitest';

// Mock Protocol implementation for testing
class MockProtocol extends Protocol {
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
class MockPeerController implements IPeerController {
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

describe('SignalingPeer', () => {
    let mockController: MockPeerController;
    let mockProtocol: MockProtocol;
    let signalingPeer: SignalingPeer;

    beforeEach(() => {
        mockController = new MockPeerController();
        mockProtocol = new MockProtocol('test-peer-1');
        signalingPeer = new SignalingPeer(mockController, mockProtocol, TestHelper.logger);
    });

    describe('Constructor and Initial State', () => {
        test('should initialize with Connected state', () => {
            expect(signalingPeer.state).toBe(SignalingConnectionState.Connected);
        });

        test('should set up protocol listener', () => {
            expect(mockProtocol.Listener).toBeDefined();
        });
    });

    describe('Connection Management', () => {
        test('should handle NewConnection event', () => {
            const connectionId = new ConnectionId(1);
            const address = 'test-address';

            mockProtocol.simulateNetworkEvent(
                new NetworkEvent(NetEventType.NewConnection, connectionId, address)
            );

            const requests = mockController.getConnectionRequests();
            expect(requests).toHaveLength(1);
            expect(requests[0].client).toBe(signalingPeer);
            expect(requests[0].address).toBe(address);
            expect(requests[0].id).toEqual(connectionId);
        });

        test('should handle Disconnected event', () => {
            const connectionId = new ConnectionId(1);
            
            // First establish a bidirectional connection
            const otherMockProtocol = new MockProtocol('other-peer');
            const otherPeer = new SignalingPeer(mockController, otherMockProtocol, TestHelper.logger);
            signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);
            otherPeer.acceptIncomingConnection(signalingPeer);
            
            // Clear sent events from connection setup
            mockProtocol.clearSentEvents();
            otherMockProtocol.clearSentEvents();
            
            // Now disconnect
            mockProtocol.simulateNetworkEvent(
                new NetworkEvent(NetEventType.Disconnected, connectionId, null)
            );

            // Both peers should receive Disconnected events
            const sentEvents = mockProtocol.getSentEvents();
            const otherSentEvents = otherMockProtocol.getSentEvents();
            
            expect(sentEvents.some(evt => evt.Type === NetEventType.Disconnected)).toBe(true);
            expect(otherSentEvents.some(evt => evt.Type === NetEventType.Disconnected)).toBe(true);
        });

    });

    describe('Server Management', () => {
        test('should handle ServerInitialized event', () => {
            const address = 'server-address';

            mockProtocol.simulateNetworkEvent(
                new NetworkEvent(NetEventType.ServerInitialized, ConnectionId.INVALID, address)
            );

            const requests = mockController.getListeningRequests();
            expect(requests).toHaveLength(1);
            expect(requests[0].address).toBe(address);
        });

        test('should handle ServerClosed event', () => {
            const address = 'server-address';

            // First accept listening
            signalingPeer.acceptListening(address);
            mockController.clearRequests();

            mockProtocol.simulateNetworkEvent(
                new NetworkEvent(NetEventType.ServerClosed, ConnectionId.INVALID, null)
            );

            const requests = mockController.getStopListeningRequests();
            expect(requests).toHaveLength(1);
            expect(requests[0].address).toBe(address);
        });
    });

    describe('Message Handling', () => {
        test('should handle ReliableMessageReceived event', () => {
            const connectionId = new ConnectionId(1);
            const messageData = 'test-message';

            // Setup a connection
            const otherPeer = new SignalingPeer(mockController, new MockProtocol('other-peer'), TestHelper.logger);
            signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);
            mockProtocol.clearSentEvents();

            mockProtocol.simulateNetworkEvent(
                new NetworkEvent(NetEventType.ReliableMessageReceived, connectionId, messageData)
            );

            // Should forward the message through sendData
            const sentEvents = mockProtocol.getSentEvents();
            expect(sentEvents).toHaveLength(0); // sendData forwards to other peer, not back to protocol
        });

        test('should handle UnreliableMessageReceived event', () => {
            const connectionId = new ConnectionId(1);
            const messageData = 'test-message';

            // Setup a connection
            const otherPeer = new SignalingPeer(mockController, new MockProtocol('other-peer'), TestHelper.logger);
            signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);
            mockProtocol.clearSentEvents();

            mockProtocol.simulateNetworkEvent(
                new NetworkEvent(NetEventType.UnreliableMessageReceived, connectionId, messageData)
            );

            // Should forward the message through sendData
            const sentEvents = mockProtocol.getSentEvents();
            expect(sentEvents).toHaveLength(0); // sendData forwards to other peer, not back to protocol
        });
    });

    describe('Peer-to-Peer Connection', () => {
        let otherPeer: SignalingPeer;
        let otherMockProtocol: MockProtocol;

        beforeEach(() => {
            otherMockProtocol = new MockProtocol('other-peer');
            otherPeer = new SignalingPeer(mockController, otherMockProtocol, TestHelper.logger);
        });

        test('should accept outgoing connection', () => {
            const connectionId = new ConnectionId(1);

            signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);

            const sentEvents = mockProtocol.getSentEvents();
            expect(sentEvents).toHaveLength(1);
            expect(sentEvents[0].Type).toBe(NetEventType.NewConnection);
            expect(sentEvents[0].ConnectionId).toEqual(connectionId);
        });

        test('should accept incoming connection', () => {
            signalingPeer.acceptIncomingConnection(otherPeer);

            const sentEvents = mockProtocol.getSentEvents();
            expect(sentEvents).toHaveLength(1);
            expect(sentEvents[0].Type).toBe(NetEventType.NewConnection);
            expect(sentEvents[0].ConnectionId.id).toBeGreaterThanOrEqual(16384);
        });

        test('should disconnect properly', () => {
            const connectionId = new ConnectionId(1);

            // Establish connection
            signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);
            otherPeer.acceptIncomingConnection(signalingPeer);

            mockProtocol.clearSentEvents();
            otherMockProtocol.clearSentEvents();

            // Disconnect
            signalingPeer.disconnect(connectionId);

            const sentEvents = mockProtocol.getSentEvents();
            const otherSentEvents = otherMockProtocol.getSentEvents();

            expect(sentEvents.some(evt => evt.Type === NetEventType.Disconnected)).toBe(true);
            expect(otherSentEvents.some(evt => evt.Type === NetEventType.Disconnected)).toBe(true);
        });

        test('should send data between peers', () => {
            const connectionId = new ConnectionId(1);
            // 'hello world' in UTF-16 (little endian with BOM)
            const testMessage = new Uint8Array([0xFF, 0xFE, 0x68, 0x00, 0x65, 0x00, 0x6C, 0x00, 0x6C, 0x00, 0x6F, 0x00, 0x20, 0x00, 0x77, 0x00, 0x6F, 0x00, 0x72, 0x00, 0x6C, 0x00, 0x64, 0x00]);

            // Establish bidirectional connection
            signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);
            otherPeer.acceptIncomingConnection(signalingPeer);

            mockProtocol.clearSentEvents();
            otherMockProtocol.clearSentEvents();

            // Send data
            signalingPeer.sendData(connectionId, testMessage, true);

            const otherSentEvents = otherMockProtocol.getSentEvents();
            expect(otherSentEvents).toHaveLength(1);
            expect(otherSentEvents[0].Type).toBe(NetEventType.ReliableMessageReceived);
            expect(otherSentEvents[0].MessageData).toEqual(testMessage);
        });
    });

    describe('Server Operations', () => {
        test('should accept listening', () => {
            const address = 'test-address';

            signalingPeer.acceptListening(address);

            const sentEvents = mockProtocol.getSentEvents();
            expect(sentEvents).toHaveLength(1);
            expect(sentEvents[0].Type).toBe(NetEventType.ServerInitialized);
            expect(sentEvents[0].Info).toBe(address);
        });

        test('should deny listening', () => {
            const address = 'test-address';

            signalingPeer.denyListening(address);

            const sentEvents = mockProtocol.getSentEvents();
            expect(sentEvents).toHaveLength(1);
            expect(sentEvents[0].Type).toBe(NetEventType.ServerInitFailed);
            expect(sentEvents[0].Info).toBe(address);
        });

        test('should deny connection', () => {
            const address = 'test-address';
            const connectionId = new ConnectionId(1);

            signalingPeer.denyConnection(address, connectionId);

            const sentEvents = mockProtocol.getSentEvents();
            expect(sentEvents).toHaveLength(1);
            expect(sentEvents[0].Type).toBe(NetEventType.ConnectionFailed);
            expect(sentEvents[0].ConnectionId).toEqual(connectionId);
        });
    });

    describe('Cleanup and Disposal', () => {
        test('should handle network close event', () => {
            mockProtocol.dispose(); // This triggers onNetworkClose

            expect(signalingPeer.state).toBe(SignalingConnectionState.Disconnected);
            expect(mockController.getCleanupRequests()).toContain(signalingPeer);
        });

        test('should not send messages after disconnection', () => {
            // Disconnect the peer
            mockProtocol.dispose();
            mockProtocol.clearSentEvents();

            // Try to send a message
            signalingPeer.acceptListening('test-address');

            // Should not send any messages
            const sentEvents = mockProtocol.getSentEvents();
            expect(sentEvents).toHaveLength(0);
        });

        test('should clean up all connections on disposal', () => {
            const connectionId = new ConnectionId(1);
            const otherPeer = new SignalingPeer(mockController, new MockProtocol('other-peer'), TestHelper.logger);

            // Establish connection
            signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);

            // Dispose
            mockProtocol.dispose();

            expect(signalingPeer.state).toBe(SignalingConnectionState.Disconnected);
            expect(mockProtocol.isDisposed()).toBe(true);
        });
    });

    describe('Identity', () => {
        test('should return protocol identity', () => {
            expect(signalingPeer.getIdentity()).toBe('test-peer-1');
        });
    });

    describe('Edge Cases', () => {
        test('should handle disconnect of non-existent connection', () => {
            const nonExistentId = new ConnectionId(999);

            // Should not throw an error
            expect(() => signalingPeer.disconnect(nonExistentId)).not.toThrow();
        });

        test('should handle sendData to non-existent connection', () => {
            const nonExistentId = new ConnectionId(999);

            // Should not throw an error
            expect(() => signalingPeer.sendData(nonExistentId, 'test', true)).not.toThrow();
        });

        test('should handle multiple cleanup calls', () => {
            // First cleanup
            mockProtocol.dispose();
            const firstCleanupCount = mockController.getCleanupRequests().length;

            // Second cleanup should not cause issues
            mockProtocol.dispose();
            const secondCleanupCount = mockController.getCleanupRequests().length;

            expect(secondCleanupCount).toBe(firstCleanupCount); // Should not increase
        });

        test('should handle stop listening without address', () => {
            // Try to stop listening without having started
            expect(() => signalingPeer.stopListen()).not.toThrow();
        });
    });
});