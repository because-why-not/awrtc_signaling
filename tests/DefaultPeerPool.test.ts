
import { describe, it, expect, vi, beforeEach, test } from 'vitest';
import { DefaultPeerPool } from '../src/PeerPool';
import { ISignalingPeer, SignalingConnectionState } from '../src/SignalingPeer';
import { ConnectionId } from '../src/INetwork';
import { AppConfig } from '../src/ServerConfig';
import { TestHelper } from './TestHelper';

// Mock implementation of ISignalingPeer for testing
class MockSignalingPeer implements ISignalingPeer {
    private _state: SignalingConnectionState = SignalingConnectionState.Connected;
    private _identity: string;
    private acceptedOutgoingConnections: Array<{ peer: ISignalingPeer, id: ConnectionId }> = [];
    private acceptedIncomingConnections: Array<ISignalingPeer> = [];
    private deniedConnections: Array<{ address: string, id: ConnectionId }> = [];
    private acceptedListening: Array<string> = [];
    private deniedListening: Array<string> = [];

    constructor(identity: string = 'mock-peer') {
        this._identity = identity;
    }

    get state(): SignalingConnectionState {
        return this._state;
    }

    setState(state: SignalingConnectionState): void {
        this._state = state;
    }

    acceptOutgoingConnection(otherPeer: ISignalingPeer, newConnectionId: ConnectionId): void {
        this.acceptedOutgoingConnections.push({ peer: otherPeer, id: newConnectionId });
    }

    acceptIncomingConnection(otherPeer: ISignalingPeer): void {
        this.acceptedIncomingConnections.push(otherPeer);
    }

    denyConnection(address: string, newConnectionId: ConnectionId): void {
        this.deniedConnections.push({ address, id: newConnectionId });
    }

    acceptListening(address: string): void {
        this.acceptedListening.push(address);
    }

    denyListening(address: string): void {
        this.deniedListening.push(address);
    }

    getIdentity(): string {
        return this._identity;
    }

    // Test helper methods
    getAcceptedOutgoingConnections() { return [...this.acceptedOutgoingConnections]; }
    getAcceptedIncomingConnections() { return [...this.acceptedIncomingConnections]; }
    getDeniedConnections() { return [...this.deniedConnections]; }
    getAcceptedListening() { return [...this.acceptedListening]; }
    getDeniedListening() { return [...this.deniedListening]; }

    clearHistory(): void {
        this.acceptedOutgoingConnections = [];
        this.acceptedIncomingConnections = [];
        this.deniedConnections = [];
        this.acceptedListening = [];
        this.deniedListening = [];
    }
}

describe('DefaultPeerPool', () => {
    let pool: DefaultPeerPool;
    let mockConfig: AppConfig;

    beforeEach(() => {
        mockConfig = {
            name: 'TestPool',
            address_sharing: false
        } as AppConfig;
        pool = new DefaultPeerPool(mockConfig, TestHelper.logger);
    });

    describe('Basic Operations', () => {
        test('should have correct name from config', () => {
            expect(pool.name).toBe('TestPool');
        });

        test('should start with empty connections', () => {
            expect(pool.count()).toBe(0);
        });

        test('should add peer', () => {
            const mockPeer = new MockSignalingPeer('test-peer');
            pool.addPeer(mockPeer);
            expect(pool.count()).toBe(1);
        });

        test('should remove peer', () => {
            const mockPeer = new MockSignalingPeer('test-peer');
            pool.addPeer(mockPeer);
            expect(pool.count()).toBe(1);

            pool.removeConnection(mockPeer);
            expect(pool.count()).toBe(0);
        });

        test('should handle removing unknown peer gracefully', () => {
            const mockPeer = new MockSignalingPeer('unknown-peer');
            expect(() => pool.removeConnection(mockPeer)).not.toThrow();
            expect(pool.count()).toBe(0);
        });
    });

    describe('Address Management', () => {
        test('should check address availability correctly', () => {
            const validAddress = 'valid-address';
            const tooLongAddress = 'a'.repeat(257); // maxAddressLength is 256

            expect(pool.isAddressAvailable(validAddress)).toBe(true);
            expect(pool.isAddressAvailable(tooLongAddress)).toBe(false);
        });

        test('should make address unavailable after use', () => {
            const address = 'test-address';
            const mockPeer = new MockSignalingPeer('test-peer');

            expect(pool.isAddressAvailable(address)).toBe(true);
            
            pool.addListener(mockPeer, address);
            expect(pool.isAddressAvailable(address)).toBe(false);
        });

        test('should return server connections for address', () => {
            const address = 'test-address';
            const mockPeer = new MockSignalingPeer('test-peer');

            pool.addListener(mockPeer, address);
            const servers = pool.getListenerPeers(address);
            
            expect(servers).toHaveLength(1);
            expect(servers[0]).toBe(mockPeer);
        });

        test('should support multiple peers on same address with address sharing', () => {
            const configWithSharing = { ...mockConfig, address_sharing: true };
            const poolWithSharing = new DefaultPeerPool(configWithSharing, TestHelper.logger);
            
            const address = 'shared-address';
            const peer1 = new MockSignalingPeer('peer1');
            const peer2 = new MockSignalingPeer('peer2');

            poolWithSharing.addListener(peer1, address);
            expect(poolWithSharing.isAddressAvailable(address)).toBe(true); // Still available with sharing

            poolWithSharing.addListener(peer2, address);
            const servers = poolWithSharing.getListenerPeers(address);
            expect(servers).toHaveLength(2);
        });

        test('should remove server and clean up empty address list', () => {
            const address = 'test-address';
            const mockPeer = new MockSignalingPeer('test-peer');

            pool.addListener(mockPeer, address);
            expect(pool.getListenerPeers(address)).toHaveLength(1);

            pool.removeListener(mockPeer, address);
            expect(pool.getListenerPeers(address)).toBeUndefined();
        });
    });

    describe('Listening Requests', () => {
        test('should accept listening request for available address', () => {
            const address = 'available-address';
            const mockPeer = new MockSignalingPeer('test-peer');

            pool.onListeningRequest(mockPeer, address);

            expect(mockPeer.getAcceptedListening()).toContain(address);
            expect(mockPeer.getDeniedListening()).toHaveLength(0);
            expect(pool.getListenerPeers(address)).toContain(mockPeer);
        });

        test('should deny listening request for unavailable address', () => {
            const address = 'taken-address';
            const peer1 = new MockSignalingPeer('peer1');
            const peer2 = new MockSignalingPeer('peer2');

            // First peer takes the address
            pool.onListeningRequest(peer1, address);
            expect(peer1.getAcceptedListening()).toContain(address);

            // Second peer should be denied
            pool.onListeningRequest(peer2, address);
            expect(peer2.getDeniedListening()).toContain(address);
            expect(peer2.getAcceptedListening()).toHaveLength(0);
        });


        test('should deny listening request for too long address', () => {
            const tooLongAddress = 'a'.repeat(257);
            const mockPeer = new MockSignalingPeer('test-peer');

            pool.onListeningRequest(mockPeer, tooLongAddress);

            expect(mockPeer.getDeniedListening()).toContain(tooLongAddress);
            expect(mockPeer.getAcceptedListening()).toHaveLength(0);
        });

        test('should handle address sharing correctly', () => {
            const configWithSharing = { ...mockConfig, address_sharing: true };
            const poolWithSharing = new DefaultPeerPool(configWithSharing, TestHelper.logger);
            
            const address = 'shared-address';
            const peer1 = new MockSignalingPeer('peer1');
            const peer2 = new MockSignalingPeer('peer2');

            poolWithSharing.onListeningRequest(peer1, address);
            poolWithSharing.onListeningRequest(peer2, address);

            expect(peer1.getAcceptedListening()).toContain(address);
            expect(peer2.getAcceptedListening()).toContain(address);
            expect(poolWithSharing.getListenerPeers(address)).toHaveLength(2);
        });

        test('should connect peers in address sharing mode', () => {
            const configWithSharing = { ...mockConfig, address_sharing: true };
            const poolWithSharing = new DefaultPeerPool(configWithSharing, TestHelper.logger);
            
            const address = 'shared-address';
            const peer1 = new MockSignalingPeer('peer1');
            const peer2 = new MockSignalingPeer('peer2');

            // Add first peer
            poolWithSharing.onListeningRequest(peer1, address);
            
            // Add second peer - should connect to first
            poolWithSharing.onListeningRequest(peer2, address);

            expect(peer1.getAcceptedIncomingConnections()).toContain(peer2);
            expect(peer2.getAcceptedIncomingConnections()).toContain(peer1);
        });
    });

    describe('Stop Listening', () => {
        test('should remove listener when stop listening', () => {
            const address = 'test-address';
            const mockPeer = new MockSignalingPeer('test-peer');

            pool.addListener(mockPeer, address);
            expect(pool.getListenerPeers(address)).toContain(mockPeer);

            pool.onStopListening(mockPeer, address);
            expect(pool.getListenerPeers(address)).toBeUndefined();
        });
    });

    describe('Connection Requests', () => {
        test('should connect to single peer listening on address', () => {
            const address = 'server-address';
            const connectionId = new ConnectionId(1);
            const serverPeer = new MockSignalingPeer('server-peer');
            const clientPeer = new MockSignalingPeer('client-peer');

            // Setup server
            pool.addListener(serverPeer, address);

            // Client tries to connect
            pool.onConnectionRequest(clientPeer, address, connectionId);

            // Verify bidirectional connection
            expect(serverPeer.getAcceptedIncomingConnections()).toContain(clientPeer);
            expect(clientPeer.getAcceptedOutgoingConnections()).toHaveLength(1);
            expect(clientPeer.getAcceptedOutgoingConnections()[0].peer).toBe(serverPeer);
            expect(clientPeer.getAcceptedOutgoingConnections()[0].id).toEqual(connectionId);
        });

        test('should deny connection to non-existent address', () => {
            const address = 'non-existent-address';
            const connectionId = new ConnectionId(1);
            const clientPeer = new MockSignalingPeer('client-peer');

            pool.onConnectionRequest(clientPeer, address, connectionId);

            expect(clientPeer.getDeniedConnections()).toHaveLength(1);
            expect(clientPeer.getDeniedConnections()[0].address).toBe(address);
            expect(clientPeer.getDeniedConnections()[0].id).toEqual(connectionId);
        });

        test('should deny connection when multiple peers share address', () => {
            const configWithSharing = { ...mockConfig, address_sharing: true };
            const poolWithSharing = new DefaultPeerPool(configWithSharing, TestHelper.logger);
            
            const address = 'shared-address';
            const connectionId = new ConnectionId(1);
            const listener1 = new MockSignalingPeer('listener1');
            const listener2 = new MockSignalingPeer('listener2');
            const client = new MockSignalingPeer('client');

            // Setup multiple listeners
            poolWithSharing.addListener(listener1, address);
            poolWithSharing.addListener(listener2, address);

            // Client tries to connect - should fail because connect is 1-to-1 only
            poolWithSharing.onConnectionRequest(client, address, connectionId);

            expect(client.getDeniedConnections()).toHaveLength(1);
            expect(client.getAcceptedOutgoingConnections()).toHaveLength(0);
        });
    });

    describe('Cleanup', () => {
        test('should remove peer on cleanup', () => {
            const mockPeer = new MockSignalingPeer('test-peer');
            pool.addPeer(mockPeer);
            expect(pool.count()).toBe(1);

            pool.onCleanup(mockPeer);
            expect(pool.count()).toBe(0);
        });
    });

    describe('Edge Cases', () => {
        test('should handle empty address', () => {
            const emptyAddress = '';
            const mockPeer = new MockSignalingPeer('test-peer');

            expect(pool.isAddressAvailable(emptyAddress)).toBe(true);
            pool.onListeningRequest(mockPeer, emptyAddress);
            expect(mockPeer.getAcceptedListening()).toContain(emptyAddress);
        });

        test('should handle address at max length boundary', () => {
            const maxLengthAddress = 'a'.repeat(256); // Exactly at limit
            const mockPeer = new MockSignalingPeer('test-peer');

            expect(pool.isAddressAvailable(maxLengthAddress)).toBe(true);
            pool.onListeningRequest(mockPeer, maxLengthAddress);
            expect(mockPeer.getAcceptedListening()).toContain(maxLengthAddress);
        });

        test('should handle removing peer from address with multiple listeners', () => {
            const configWithSharing = { ...mockConfig, address_sharing: true };
            const poolWithSharing = new DefaultPeerPool(configWithSharing, TestHelper.logger);
            
            const address = 'shared-address';
            const peer1 = new MockSignalingPeer('peer1');
            const peer2 = new MockSignalingPeer('peer2');

            poolWithSharing.addListener(peer1, address);
            poolWithSharing.addListener(peer2, address);
            expect(poolWithSharing.getListenerPeers(address)).toHaveLength(2);

            poolWithSharing.removeListener(peer1, address);
            const remainingServers = poolWithSharing.getListenerPeers(address);
            expect(remainingServers).toHaveLength(1);
            expect(remainingServers[0]).toBe(peer2);
        });

        test('should handle removing non-existent peer from address', () => {
            const address = 'test-address';
            const peer1 = new MockSignalingPeer('peer1');
            const peer2 = new MockSignalingPeer('peer2');

            pool.addListener(peer1, address);
            
            // Try to remove peer2 which was never added
            expect(() => pool.removeListener(peer2, address)).not.toThrow();
            expect(pool.getListenerPeers(address)).toContain(peer1);
        });
    });

    describe('Address Sharing Flag', () => {
        test('should return correct address sharing status', () => {
            expect(pool.hasAddressSharing()).toBe(false);

            const configWithSharing = { ...mockConfig, address_sharing: true };
            const poolWithSharing = new DefaultPeerPool(configWithSharing, TestHelper.logger);
            expect(poolWithSharing.hasAddressSharing()).toBe(true);
        });

        test('should handle undefined address_sharing in config', () => {
            const configNoSharing = { name: 'TestPool' } as AppConfig;
            const poolNoSharing = new DefaultPeerPool(configNoSharing, TestHelper.logger);
            expect(poolNoSharing.hasAddressSharing()).toBe(false);
        });
    });
});