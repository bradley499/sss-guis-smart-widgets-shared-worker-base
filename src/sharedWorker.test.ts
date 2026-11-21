/// <reference lib="webworker" />

import { afterEach, beforeEach, describe, expect, it, vi, type Mock, type MockInstance } from "vitest";
import { nanoid } from "nanoid";
import {
    type communicationDisconnect,
    type communicationEventMessage,
    type communicationStatus,
    type eventContents,
    type eventFollow,
    type eventMessage,
    type eventName,
    type eventType
} from "@sss/sss-guis-smart-widgets-common";
import { generateUniqueIdentifier, sharedWorker } from "./sharedWorker";
import { transport } from "./transport";

type nanoidMockModule = Omit<typeof import("nanoid"), "nanoid"> & {
    nanoid: Mock<(size?: number) => string>;
};

vi.mock("nanoid", async (importOriginal: () => Promise<typeof import("nanoid")>): Promise<nanoidMockModule> => {
    const actual: typeof import("nanoid") = await importOriginal();
    const originalNanoid: (size?: number) => string = actual.nanoid;
    return {
        ...actual,
        /**
         * Wraps nanoid so individual tests can simulate insecure-context exceptions
         * @param size Optional identifier length
         * @returns Generated identifier
         */
        nanoid: vi.fn((size?: number): string => originalNanoid(size)),
    };
});

/**
 * Union of all message payloads accepted by {@link sharedWorker} from a connected client port
 */
type portIncomingPayload = (communicationEventMessage | eventFollow | communicationDisconnect);

/**
 * Union of all message payloads sent by {@link sharedWorker} to a connected client port
 */
type portOutgoingPayload = (communicationEventMessage | communicationStatus);

/**
 * Concrete mock implementation of {@link transport} for testing {@link sharedWorker}
 */
class mockTransport extends transport {
    public readonly publishSpy: Mock<(name: eventName, type: eventType, contents: eventContents, time?: Date) => void> = vi.fn();
    public readonly followSpy: Mock<(name: eventName, type: eventType) => void> = vi.fn();
    public readonly unfollowSpy: Mock<(name: eventName, type: eventType) => void> = vi.fn();
    public readonly receiveSpy: Mock<(listener: (name: eventName, type: eventType, contents: eventContents, time?: Date) => void) => void> = vi.fn();
    public readonly connectedSpy: Mock<() => boolean> = vi.fn<() => boolean>().mockReturnValue(true);

    private receiveListener: ((name: eventName, type: eventType, contents: eventContents, time?: Date) => void) | null = null;

    /**
     * Records an outgoing publish call on the mock transport
     * @param name Event topic name
     * @param type Event payload type
     * @param contents Event payload contents
     * @param time Optional timestamp for the event
     */
    public publish(name: eventName, type: eventType, contents: eventContents, time?: Date): void {
        this.publishSpy(name, type, contents, time);
    }

    /**
     * Records a topic follow call on the mock transport
     * @param name Event topic name to follow
     * @param type Event payload type to follow
     */
    public follow(name: eventName, type: eventType): void {
        this.followSpy(name, type);
    }

    /**
     * Records a topic unfollow call on the mock transport
     * @param name Event topic name to unfollow
     * @param type Event payload type to unfollow
     */
    public unfollow(name: eventName, type: eventType): void {
        this.unfollowSpy(name, type);
    }

    /**
     * Registers the listener invoked when incoming transport messages arrive
     * @param listener Callback invoked with each incoming event message parts
     */
    public receive(listener: (name: eventName, type: eventType, contents: eventContents, time?: Date) => void): void {
        this.receiveListener = listener;
        this.receiveSpy(listener);
    }

    /**
     * Returns the mocked connection state of the transport
     * @returns Whether the transport is connected
     */
    public connected(): boolean {
        return this.connectedSpy();
    }

    /**
     * Simulates an incoming message arriving from the backend transport
     * @param name Event topic name
     * @param type Event payload type
     * @param contents Event payload contents
     * @param time Optional event timestamp
     */
    public emitIncoming(name: eventName, type: eventType, contents: eventContents, time?: Date): void {
        if (this.receiveListener) {
            this.receiveListener(name, type, contents, time);
        }
    }
}

/**
 * Simulated browser MessagePort for testing {@link sharedWorker} client lifecycle and routing
 */
class mockMessagePort {
    public readonly addEventListenerSpy: Mock<(event: string, listener: (event: { data: portIncomingPayload; }) => void) => void> = vi.fn();
    public readonly startSpy: Mock<() => void> = vi.fn();
    public readonly postMessageSpy: Mock<(message: portOutgoingPayload) => void> = vi.fn();
    public readonly closeSpy: Mock<() => void> = vi.fn();

    private messageListener: ((event: { data: portIncomingPayload; }) => void) | null = null;

    /**
     * Registers an event listener on the simulated message port
     * @param event Listener event type
     * @param listener Callback invoked when messages arrive from a client
     */
    public addEventListener(event: string, listener: (event: { data: portIncomingPayload; }) => void): void {
        this.addEventListenerSpy(event, listener);
        if (event === "message") {
            this.messageListener = listener;
        }
    }

    /**
     * Records port start activation
     */
    public start(): void {
        this.startSpy();
    }

    /**
     * Records a message posted by the shared worker to this client port
     * @param message Outgoing payload destined for the client page
     */
    public postMessage(message: portOutgoingPayload): void {
        this.postMessageSpy(message);
    }

    /**
     * Records closure of this simulated client port
     */
    public close(): void {
        this.closeSpy();
    }

    /**
     * Dispatches a message from the client page into the shared worker's port listener
     * @param payload Message, follow request, or disconnect control payload
     */
    public sendToWorker(payload: portIncomingPayload): void {
        if (this.messageListener) {
            this.messageListener({
                data: payload,
            });
        }
    }
}

describe("generateUniqueIdentifier", (): void => {
    afterEach((): void => {
        vi.restoreAllMocks();
    });

    it("should generate distinct identifiers with the requested positive or negated length", (): void => {
        const firstIdentifier: string = generateUniqueIdentifier(16);
        const secondIdentifier: string = generateUniqueIdentifier(16);

        expect(firstIdentifier).toHaveLength(16);
        expect(secondIdentifier).toHaveLength(16);
        expect(firstIdentifier).not.toBe(secondIdentifier);

        const assertSpy: MockInstance<(condition?: boolean, ...data: unknown[]) => void> = vi.spyOn(console, "assert").mockImplementation((): void => {
            return;
        });
        const negatedLengthIdentifier: string = generateUniqueIdentifier(-8);
        expect(negatedLengthIdentifier).toHaveLength(8);
        expect(assertSpy).toHaveBeenCalledWith(false, expect.stringContaining("-8"));
    });

    it("should trigger console.assert when requested length is smaller than 5", (): void => {
        const assertSpy: MockInstance<(condition?: boolean, ...data: unknown[]) => void> = vi.spyOn(console, "assert").mockImplementation((): void => {
            return;
        });

        const shortIdentifier: string = generateUniqueIdentifier(4);

        expect(shortIdentifier).toHaveLength(4);
        expect(assertSpy).toHaveBeenCalledWith(false, `Unique identifier generation requested with a small size of "4"`);
    });

    it("should fall back to non-secure nanoid and warn when secure nanoid throws", (): void => {
        const warnSpy: MockInstance<(...data: unknown[]) => void> = vi.spyOn(console, "warn").mockImplementation((): void => {
            return;
        });
        vi.mocked(nanoid).mockImplementationOnce((): string => {
            throw new Error("crypto unavailable");
        });

        const fallbackIdentifier: string = generateUniqueIdentifier(12);

        expect(fallbackIdentifier).toHaveLength(12);
        expect(warnSpy).toHaveBeenCalledWith("Insecure shared worker context");
    });
});

describe("sharedWorker", (): void => {
    let activeTransport: mockTransport;
    let connectListener: ((event: { ports: mockMessagePort[]; }) => void) | null = null;
    let globalAddEventListenerSpy: Mock<(event: string, listener: (event: { ports: mockMessagePort[]; }) => void) => void>;

    /**
     * Simulates a client page connecting a new {@link mockMessagePort} to the worker
     * @returns Connected mock client port instance
     */
    function connectClient(): mockMessagePort {
        const clientPort: mockMessagePort = new mockMessagePort();
        if (connectListener) {
            connectListener({
                ports: [clientPort],
            });
        }
        return clientPort;
    }

    beforeEach((): void => {
        vi.useFakeTimers();
        vi.clearAllMocks();
        vi.spyOn(console, "log").mockImplementation((): void => {
            return;
        });

        connectListener = null;
        globalAddEventListenerSpy = vi.fn((event: string, listener: (event: { ports: mockMessagePort[]; }) => void): void => {
            if (event === "connect") {
                connectListener = listener;
            }
        });

        vi.stubGlobal("self", {
            addEventListener: globalAddEventListenerSpy,
        });

        activeTransport = new mockTransport();
        new sharedWorker(activeTransport);
    });

    afterEach((): void => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("Initialization, connection, and status heartbeats", (): void => {
        it("should register transport.receive and self connect listeners during construction", (): void => {
            expect(activeTransport.receiveSpy).toHaveBeenCalledTimes(1);
            expect(globalAddEventListenerSpy).toHaveBeenCalledWith("connect", expect.any(Function));
        });

        it("should immediately push initial connection status and start newly connected ports", (): void => {
            activeTransport.connectedSpy.mockReturnValue(true);
            const onlineClient: mockMessagePort = connectClient();
            expect(onlineClient.postMessageSpy).toHaveBeenCalledWith({
                connected: true,
            });
            expect(onlineClient.startSpy).toHaveBeenCalledTimes(1);

            activeTransport.connectedSpy.mockReturnValue(false);
            const offlineClient: mockMessagePort = connectClient();
            expect(offlineClient.postMessageSpy).toHaveBeenCalledWith({
                connected: false,
            });
            expect(offlineClient.startSpy).toHaveBeenCalledTimes(1);
        });

        it("should safely finish port setup if initial postMessage throws", (): void => {
            const unreadyClient: mockMessagePort = new mockMessagePort();
            unreadyClient.postMessageSpy.mockImplementationOnce((): void => {
                throw new Error("Port not ready");
            });

            if (connectListener) {
                connectListener({
                    ports: [unreadyClient],
                });
            }

            expect(unreadyClient.addEventListenerSpy).toHaveBeenCalledWith("message", expect.any(Function));
            expect(unreadyClient.startSpy).toHaveBeenCalledTimes(1);
        });

        it("should broadcast transport connection status every 100 ms to all active ports", (): void => {
            const firstClient: mockMessagePort = connectClient();
            const secondClient: mockMessagePort = connectClient();
            firstClient.postMessageSpy.mockClear();
            secondClient.postMessageSpy.mockClear();

            vi.advanceTimersByTime(99);
            expect(firstClient.postMessageSpy).not.toHaveBeenCalled();

            vi.advanceTimersByTime(1);
            expect(firstClient.postMessageSpy).toHaveBeenCalledWith({
                connected: true,
            });
            expect(secondClient.postMessageSpy).toHaveBeenCalledWith({
                connected: true,
            });

            activeTransport.connectedSpy.mockReturnValue(false);
            vi.advanceTimersByTime(100);
            expect(firstClient.postMessageSpy).toHaveBeenLastCalledWith({
                connected: false,
            });
            expect(secondClient.postMessageSpy).toHaveBeenLastCalledWith({
                connected: false,
            });
        });
    });

    describe("Topic subscriptions (Client -> Transport)", (): void => {
        it("should follow unique topics on transport and ignore duplicates across ports", (): void => {
            const firstClient: mockMessagePort = connectClient();
            const secondClient: mockMessagePort = connectClient();

            const followTopic: eventFollow = {
                name: "telemetry",
                type: "binary",
            };

            firstClient.sendToWorker(followTopic);
            firstClient.sendToWorker(followTopic);
            secondClient.sendToWorker(followTopic);

            expect(activeTransport.followSpy).toHaveBeenCalledTimes(1);
            expect(activeTransport.followSpy).toHaveBeenCalledWith("telemetry", "binary");
        });

        it("should distinguish topics with the same name/different type and delimiter-ambiguous names", (): void => {
            const client: mockMessagePort = connectClient();

            client.sendToWorker({
                name: "sensor/temp",
                type: "json",
            });
            client.sendToWorker({
                name: "sensor/temp",
                type: "string",
            });
            client.sendToWorker({
                name: "a:::b",
                type: "c",
            });
            client.sendToWorker({
                name: "a",
                type: "b:::c",
            });

            expect(activeTransport.followSpy).toHaveBeenCalledTimes(4);
        });
    });

    describe("Incoming transport events (Transport -> Clients)", (): void => {
        it("should route transport messages only to ports subscribed to matching name and type", (): void => {
            const firstSubscriber: mockMessagePort = connectClient();
            const secondSubscriber: mockMessagePort = connectClient();
            const differentTypeSubscriber: mockMessagePort = connectClient();
            const unsubscribedClient: mockMessagePort = connectClient();

            firstSubscriber.sendToWorker({
                name: "test-topic",
                type: "json",
            });
            secondSubscriber.sendToWorker({
                name: "test-topic",
                type: "json",
            });
            differentTypeSubscriber.sendToWorker({
                name: "test-topic",
                type: "text",
            });

            const transportMessageTime: Date = new Date(123456789);
            const expectedMessage: eventMessage = {
                name: "test-topic",
                type: "json",
                contents: {
                    data: "hello",
                },
                time: transportMessageTime,
            };

            activeTransport.emitIncoming("test-topic", "json", {
                data: "hello",
            }, transportMessageTime);

            expect(firstSubscriber.postMessageSpy).toHaveBeenCalledWith(expectedMessage);
            expect(secondSubscriber.postMessageSpy).toHaveBeenCalledWith(expectedMessage);
            expect(differentTypeSubscriber.postMessageSpy).not.toHaveBeenCalledWith(expectedMessage);
            expect(unsubscribedClient.postMessageSpy).not.toHaveBeenCalledWith(expectedMessage);
        });

        it("should ignore transport messages targeting topics with no active subscribers", (): void => {
            const client: mockMessagePort = connectClient();
            client.postMessageSpy.mockClear();

            activeTransport.emitIncoming("untracked", "json", 123);

            expect(client.postMessageSpy).not.toHaveBeenCalled();
        });
    });

    describe("Client outgoing events (Client -> Transport & Peers)", (): void => {
        it("should publish to transport and peer-broadcast to subscribers excluding sender", (): void => {
            const senderClient: mockMessagePort = connectClient();
            const subscribedPeer: mockMessagePort = connectClient();
            const unsubscribedPeer: mockMessagePort = connectClient();

            senderClient.sendToWorker({
                name: "chat-message",
                type: "string",
            });
            subscribedPeer.sendToWorker({
                name: "chat-message",
                type: "string",
            });

            const clientMessage: eventMessage = {
                name: "chat-message",
                type: "string",
                contents: "Hello world!",
                time: new Date(987654321),
            };

            senderClient.sendToWorker(clientMessage);

            expect(activeTransport.publishSpy).toHaveBeenCalledWith(
                clientMessage.name,
                clientMessage.type,
                clientMessage.contents,
                clientMessage.time
            );
            expect(subscribedPeer.postMessageSpy).toHaveBeenCalledWith(clientMessage);
            expect(senderClient.postMessageSpy).not.toHaveBeenCalledWith(clientMessage);
            expect(unsubscribedPeer.postMessageSpy).not.toHaveBeenCalledWith(clientMessage);
        });

        it("should preserve deduplication id on peer broadcasts while omitting id from transport.publish", (): void => {
            const senderClient: mockMessagePort = connectClient();
            const subscribedPeer: mockMessagePort = connectClient();

            subscribedPeer.sendToWorker({
                name: "chat-message",
                type: "string",
            });

            const messageTime: Date = new Date("2026-05-01T12:00:00.000Z");
            const wireMessage: communicationEventMessage = {
                name: "chat-message",
                type: "string",
                contents: "Deduplicated payload",
                time: messageTime,
                id: "page-1:42",
            };

            senderClient.sendToWorker(wireMessage);

            expect(activeTransport.publishSpy).toHaveBeenCalledTimes(1);
            expect(activeTransport.publishSpy).toHaveBeenCalledWith(
                wireMessage.name,
                wireMessage.type,
                wireMessage.contents,
                wireMessage.time
            );
            expect(subscribedPeer.postMessageSpy).toHaveBeenCalledWith(wireMessage);
        });
    });

    describe("Client disconnect and dead port cleanup", (): void => {
        it("should close port, stop heartbeats/routing, and unfollow orphaned topics on disconnect", (): void => {
            const client: mockMessagePort = connectClient();

            client.sendToWorker({
                name: "telemetry",
                type: "binary",
            });
            client.sendToWorker({
                disconnect: true,
            });

            expect(activeTransport.unfollowSpy).toHaveBeenCalledWith("telemetry", "binary");
            expect(client.closeSpy).toHaveBeenCalledTimes(1);

            client.postMessageSpy.mockClear();
            activeTransport.emitIncoming("telemetry", "binary", "data");
            vi.advanceTimersByTime(100);

            expect(client.postMessageSpy).not.toHaveBeenCalled();
        });

        it("should keep topic followed until the last subscribed client disconnects and allow re-following later", (): void => {
            const firstClient: mockMessagePort = connectClient();
            const secondClient: mockMessagePort = connectClient();

            firstClient.sendToWorker({
                name: "telemetry",
                type: "binary",
            });
            secondClient.sendToWorker({
                name: "telemetry",
                type: "binary",
            });

            firstClient.sendToWorker({
                disconnect: true,
            });
            expect(activeTransport.unfollowSpy).not.toHaveBeenCalled();

            secondClient.sendToWorker({
                disconnect: true,
            });
            expect(activeTransport.unfollowSpy).toHaveBeenCalledWith("telemetry", "binary");

            const reconnectingClient: mockMessagePort = connectClient();
            reconnectingClient.sendToWorker({
                name: "telemetry",
                type: "binary",
            });
            expect(activeTransport.followSpy).toHaveBeenCalledTimes(2);
        });

        it("should unfollow only topics no longer followed by any remaining client on multi-topic disconnect", (): void => {
            const firstClient: mockMessagePort = connectClient();
            const secondClient: mockMessagePort = connectClient();

            firstClient.sendToWorker({
                name: "shared/topic",
                type: "json",
            });
            firstClient.sendToWorker({
                name: "exclusive/topic",
                type: "json",
            });
            secondClient.sendToWorker({
                name: "shared/topic",
                type: "json",
            });

            firstClient.sendToWorker({
                disconnect: true,
            });

            expect(activeTransport.unfollowSpy).toHaveBeenCalledTimes(1);
            expect(activeTransport.unfollowSpy).toHaveBeenCalledWith("exclusive/topic", "json");
        });

        it("should prune a dead port whose postMessage throws during message delivery", (): void => {
            const deadClient: mockMessagePort = connectClient();
            deadClient.sendToWorker({
                name: "dead/delivery",
                type: "json",
            });

            deadClient.postMessageSpy.mockImplementationOnce((): void => {
                throw new Error("Disconnected port");
            });

            activeTransport.emitIncoming("dead/delivery", "json", "payload");

            expect(deadClient.closeSpy).toHaveBeenCalledTimes(1);
            expect(activeTransport.unfollowSpy).toHaveBeenCalledWith("dead/delivery", "json");
        });

        it("should prune a dead port whose postMessage throws during status heartbeat and tolerate close errors", (): void => {
            const deadClient: mockMessagePort = connectClient();
            deadClient.sendToWorker({
                name: "dead/heartbeat",
                type: "text",
            });

            deadClient.postMessageSpy.mockImplementation((): void => {
                throw new Error("Disconnected port");
            });
            deadClient.closeSpy.mockImplementation((): void => {
                throw new Error("Already closed");
            });

            expect((): void => {
                vi.advanceTimersByTime(100);
            }).not.toThrow();

            expect(deadClient.closeSpy).toHaveBeenCalledTimes(1);
            expect(activeTransport.unfollowSpy).toHaveBeenCalledWith("dead/heartbeat", "text");
        });
    });
});
