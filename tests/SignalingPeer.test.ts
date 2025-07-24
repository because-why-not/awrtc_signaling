import { SignalingPeer, SignalingConnectionState } from "../src/SignalingPeer";
import { ConnectionId, NetEventType, NetworkEvent } from "../src/INetwork";
import { TestHelper, MockProtocol, MockPeerController } from "./TestHelper";
import { beforeEach, describe, expect, test } from "vitest";

describe("SignalingPeer", () => {
  let mockController: MockPeerController;
  let mockProtocol: MockProtocol;
  let signalingPeer: SignalingPeer;

  beforeEach(() => {
    mockController = new MockPeerController();
    mockProtocol = new MockProtocol("test-peer-1");
    signalingPeer = new SignalingPeer(
      mockController,
      mockProtocol,
      TestHelper.logger,
    );
  });

  describe("Constructor and Initial State", () => {
    test("should initialize with Connected state", () => {
      expect(signalingPeer.state).toBe(SignalingConnectionState.Connected);
    });

    test("should set up protocol listener", () => {
      expect(mockProtocol.Listener).toBeDefined();
    });
    test("should return protocol identity", () => {
      expect(signalingPeer.getIdentity()).toBe("test-peer-1");
    });
  });

  describe("Peer Connect and Disconnect ", () => {
    let otherPeer: SignalingPeer;
    let otherMockProtocol: MockProtocol;

    beforeEach(() => {
      otherMockProtocol = new MockProtocol("other-peer");
      otherPeer = new SignalingPeer(
        mockController,
        otherMockProtocol,
        TestHelper.logger,
      );
    });

    test("should forward NewConnection request to IController", () => {
      const connectionId = new ConnectionId(1);
      const address = "test-address";

      mockProtocol.simulateNetworkEvent(
        new NetworkEvent(NetEventType.NewConnection, connectionId, address),
      );

      const requests = mockController.getConnectionRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].client).toBe(signalingPeer);
      expect(requests[0].address).toBe(address);
      expect(requests[0].id).toEqual(connectionId);
    });
    test("should accept outgoing connection", () => {
      const connectionId = new ConnectionId(1);

      signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);

      const sentEvents = mockProtocol.getSentEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].Type).toBe(NetEventType.NewConnection);
      expect(sentEvents[0].ConnectionId).toEqual(connectionId);
    });

    test("should accept incoming connection", () => {
      signalingPeer.acceptIncomingConnection(otherPeer);

      const sentEvents = mockProtocol.getSentEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].Type).toBe(NetEventType.NewConnection);
      expect(sentEvents[0].ConnectionId.id).toBeGreaterThanOrEqual(16384);
    });

    test("should forward Disconnected event to both client connections", () => {
      const connectionId = new ConnectionId(1);

      // Establish connection between two peers
      const otherMockProtocol = new MockProtocol("other-peer");
      const otherPeer = new SignalingPeer(
        mockController,
        otherMockProtocol,
        TestHelper.logger,
      );
      signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);
      otherPeer.acceptIncomingConnection(signalingPeer);

      // Clear sent events from connection setup
      mockProtocol.clearSentEvents();
      otherMockProtocol.clearSentEvents();

      // Trigger a disconnect event sent from one of the clients
      mockProtocol.simulateNetworkEvent(
        new NetworkEvent(NetEventType.Disconnected, connectionId, null),
      );

      // Both peers should receive Disconnected events
      const sentEvents = mockProtocol.getSentEvents();
      const otherSentEvents = otherMockProtocol.getSentEvents();

      expect(
        sentEvents.some((evt) => evt.Type === NetEventType.Disconnected),
      ).toBe(true);
      expect(
        otherSentEvents.some((evt) => evt.Type === NetEventType.Disconnected),
      ).toBe(true);
    });

    test("should disconnect on connected peer dispose", () => {
      const connectionId = new ConnectionId(1);

      // Establish connection
      signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);
      otherPeer.acceptIncomingConnection(signalingPeer);

      mockProtocol.clearSentEvents();
      otherMockProtocol.clearSentEvents();

      // Disconnect
      otherMockProtocol.dispose();

      const sentEvents = mockProtocol.getSentEvents();
      const otherSentEvents = otherMockProtocol.getSentEvents();

      expect(
        sentEvents.some((evt) => evt.Type === NetEventType.Disconnected),
      ).toBe(true);
      expect(
        otherSentEvents.some((evt) => evt.Type === NetEventType.Disconnected),
      ).toBe(false);
    });
  });
  describe("Message forwarding", () => {
    test("should handle ReliableMessageReceived event and forward to connected peer", () => {
      const connectionId = new ConnectionId(1);

      // 'hello world' in utf16
      const messageData = new Uint8Array([
        0xff, 0xfe, 0x68, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00,
        0x20, 0x00, 0x77, 0x00, 0x6f, 0x00, 0x72, 0x00, 0x6c, 0x00, 0x64, 0x00,
      ]);

      // Setup a bidirectional connection
      const otherMockProtocol = new MockProtocol("other-peer");
      const otherPeer = new SignalingPeer(
        mockController,
        otherMockProtocol,
        TestHelper.logger,
      );
      signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);
      otherPeer.acceptIncomingConnection(signalingPeer);

      mockProtocol.clearSentEvents();
      otherMockProtocol.clearSentEvents();

      // Simulate message received from mockProtocol to signalingPeer
      mockProtocol.simulateNetworkEvent(
        new NetworkEvent(
          NetEventType.ReliableMessageReceived,
          connectionId,
          messageData,
        ),
      );

      // The message should be forwarded to otherPeer via otherMockProtocol
      const sentEvents = mockProtocol.getSentEvents();
      const otherSentEvents = otherMockProtocol.getSentEvents();

      expect(sentEvents).toHaveLength(0); // Original peer shouldn't receive its own message back
      expect(otherSentEvents).toHaveLength(1); // Other peer should receive the forwarded message
      expect(otherSentEvents[0].Type).toBe(
        NetEventType.ReliableMessageReceived,
      );
      expect(otherSentEvents[0].MessageData).toEqual(messageData);
    });

    test("should handle UnreliableMessageReceived event and forward to connected peer", () => {
      const connectionId = new ConnectionId(1);
      // 'hello world' in utf16
      const messageData = new Uint8Array([
        0xff, 0xfe, 0x68, 0x00, 0x65, 0x00, 0x6c, 0x00, 0x6c, 0x00, 0x6f, 0x00,
        0x20, 0x00, 0x77, 0x00, 0x6f, 0x00, 0x72, 0x00, 0x6c, 0x00, 0x64, 0x00,
      ]);

      // Setup a bidirectional connection
      const otherMockProtocol = new MockProtocol("other-peer");
      const otherPeer = new SignalingPeer(
        mockController,
        otherMockProtocol,
        TestHelper.logger,
      );
      signalingPeer.acceptOutgoingConnection(otherPeer, connectionId);
      otherPeer.acceptIncomingConnection(signalingPeer);

      mockProtocol.clearSentEvents();
      otherMockProtocol.clearSentEvents();

      // Simulate message received from mockProtocol to signalingPeer
      mockProtocol.simulateNetworkEvent(
        new NetworkEvent(
          NetEventType.UnreliableMessageReceived,
          connectionId,
          messageData,
        ),
      );

      // The message should be forwarded to otherPeer via otherMockProtocol
      const sentEvents = mockProtocol.getSentEvents();
      const otherSentEvents = otherMockProtocol.getSentEvents();

      expect(sentEvents).toHaveLength(0); // Original peer shouldn't receive its own message back
      expect(otherSentEvents).toHaveLength(1); // Other peer should receive the forwarded message
      expect(otherSentEvents[0].Type).toBe(
        NetEventType.UnreliableMessageReceived,
      );
      expect(otherSentEvents[0].MessageData).toEqual(messageData);
    });

    test("should ignore messages sent to unknown connection ID without crashing", () => {
      // the async nature of the message system means a client might send messages to unknown connection IDs
      // because they haven't received a disconnected event yet. Must not result in an exception.
      const unknownConnectionId = new ConnectionId(999);
      // 'test message' in utf16
      const messageData = new Uint8Array([
        0xff, 0xfe, 0x74, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, 0x20, 0x00,
        0x6d, 0x00, 0x65, 0x00, 0x73, 0x00, 0x73, 0x00, 0x61, 0x00, 0x67, 0x00,
        0x65, 0x00,
      ]);

      mockProtocol.clearSentEvents();

      // Should not throw an exception when receiving message for unknown connection
      expect(() => {
        mockProtocol.simulateNetworkEvent(
          new NetworkEvent(
            NetEventType.ReliableMessageReceived,
            unknownConnectionId,
            messageData,
          ),
        );
      }).not.toThrow();

      expect(() => {
        mockProtocol.simulateNetworkEvent(
          new NetworkEvent(
            NetEventType.UnreliableMessageReceived,
            unknownConnectionId,
            messageData,
          ),
        );
      }).not.toThrow();

      // No messages should be sent as there's no connection to forward to
      const sentEvents = mockProtocol.getSentEvents();
      expect(sentEvents).toHaveLength(0);
    });
  });

  describe("Address and connection management via IController", () => {
    test("should forward ServerInitialized / Listen event to IController", () => {
      const address = "server-address";

      mockProtocol.simulateNetworkEvent(
        new NetworkEvent(
          NetEventType.ServerInitialized,
          ConnectionId.INVALID,
          address,
        ),
      );

      const requests = mockController.getListeningRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].address).toBe(address);
    });

    test("should forward ServerClosed / StopListen to IController", () => {
      const address = "server-address";

      // First accept listening
      signalingPeer.acceptListening(address);
      mockController.clearRequests();

      mockProtocol.simulateNetworkEvent(
        new NetworkEvent(NetEventType.ServerClosed, ConnectionId.INVALID, null),
      );

      const requests = mockController.getStopListeningRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].address).toBe(address);
    });

    test("should accept listening", () => {
      const address = "test-address";

      signalingPeer.acceptListening(address);

      const sentEvents = mockProtocol.getSentEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].Type).toBe(NetEventType.ServerInitialized);
      expect(sentEvents[0].Info).toBe(address);
    });

    test("should deny listening", () => {
      const address = "test-address";

      signalingPeer.denyListening(address);

      const sentEvents = mockProtocol.getSentEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].Type).toBe(NetEventType.ServerInitFailed);
      expect(sentEvents[0].Info).toBe(address);
    });
    test("should deny connection", () => {
      const address = "test-address";
      const connectionId = new ConnectionId(1);

      signalingPeer.denyConnection(address, connectionId);

      const sentEvents = mockProtocol.getSentEvents();
      expect(sentEvents).toHaveLength(1);
      expect(sentEvents[0].Type).toBe(NetEventType.ConnectionFailed);
      expect(sentEvents[0].ConnectionId).toEqual(connectionId);
    });
  });

  describe("Cleanup and Disposal", () => {
    test("should handle network close event", () => {
      mockProtocol.dispose(); // This triggers onNetworkClose

      expect(signalingPeer.state).toBe(SignalingConnectionState.Disconnected);
      expect(mockController.getCleanupRequests()).toContain(signalingPeer);
    });

    test("should not send messages after disconnection", () => {
      // Disconnect the peer
      mockProtocol.dispose();
      mockProtocol.clearSentEvents();

      // Try to send a message
      signalingPeer.acceptListening("test-address");

      // Should not send any messages
      const sentEvents = mockProtocol.getSentEvents();
      expect(sentEvents).toHaveLength(0);
    });

    test("should handle multiple cleanup calls", () => {
      // First cleanup
      mockProtocol.dispose();
      const firstCleanupCount = mockController.getCleanupRequests().length;

      // Second cleanup should not cause issues
      mockProtocol.dispose();
      const secondCleanupCount = mockController.getCleanupRequests().length;

      expect(secondCleanupCount).toBe(firstCleanupCount); // Should not increase
    });
  });
});
