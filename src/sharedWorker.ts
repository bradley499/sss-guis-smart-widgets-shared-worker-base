/// <reference lib="webworker" />

import {
    type communicationDisconnect,
    type communicationEventMessage,
    type communicationStatus,
    communicationTimeout,
    type eventContents,
    type eventFollow,
    type eventMessage,
    type eventName,
    type eventType,
    interval
} from "@sss/sss-guis-smart-widgets-common";
import { transport } from "./transport";
import { nanoid as secureNanoId } from "nanoid";
import { nanoid as insecureNanoId } from "nanoid/non-secure";

const communicationPublicationInterval: number = 100;
console.assert((communicationPublicationInterval < communicationTimeout), "Communication state publish rate is too slow - this will lead to instability!");

/**
 * Generates a unique identifier string with a given size
 * @param size The length of the unique identifier
 * @returns Generated unique identifier
 */
export function generateUniqueIdentifier(size: number): string {
    console.assert((size >= 5), `Unique identifier generation requested with a small size of "${String(size)}"`);
    size = Math.abs(size);
    try {
        return secureNanoId(size);
    } catch {
        console.warn("Insecure shared worker context");
        return insecureNanoId(size);
    }
}

/**
 * Base class for the logic running inside a Shared Worker environment.
 * This class manages multiple message ports from connected clients, performs
 * topic-based message routing, and bridges communication with a transport layer.
 */
export class sharedWorker {
    /**
     * The transport mechanism used for communication.
     */
    protected readonly transport: transport;

    /**
     * A set of active message ports connected to this shared worker.
     */
    private readonly ports!: Set<MessagePort>;

    /**
     * Nested map of topic {@link eventName} -> {@link eventType} -> set of subscribed message ports
     */
    private readonly portSubscriptions!: Map<eventName, Map<eventType, Set<MessagePort>>>;

    /**
     * Map of message port to the list of topic subscriptions it holds
     */
    private readonly portTopics!: Map<MessagePort, eventFollow[]>;

    private topicsFollowed!: eventFollow[];
    private browserIdentifier!: string;
    private readonly communicationPublication!: interval;

    /**
     * Initializes a new instance of the sharedWorker class.
     * @param transport The transport mechanism to use for communication.
     */
    constructor(transport: transport) {
        this.transport = transport;
        this.ports = new Set();
        this.portSubscriptions = new Map();
        this.portTopics = new Map();
        this.topicsFollowed = [];
        this.browserIdentifier = generateUniqueIdentifier(32);
        this.setupCommunication();
        this.communicationPublication = new interval((): void => {
            this.broadcastStatus({
                connected: this.transport.connected(),
            } satisfies communicationStatus);
        }, communicationPublicationInterval);
        this.communicationPublication.start();
    }

    /**
     * Configures the communication handlers between the transport and the connected client ports.
     */
    private setupCommunication(): void {
        console.log(`Browser identifier is known as: "${this.browserIdentifier}"`);
        // Listen for messages from the transport and route them to ports following that topic
        this.transport.receive((name: eventName, type: eventType, contents: eventContents, time?: Date): void => {
            const message: eventMessage = {
                name: name,
                type: type,
                contents: contents,
            };
            if (time !== undefined) {
                message.time = time;
            }
            this.handleIncoming(message);
        });

        // Listen for new client connections to the shared worker
        (self as unknown as SharedWorkerGlobalScope).addEventListener("connect", (event: MessageEvent<unknown>): void => {
            const port: MessagePort = event.ports[0];
            this.ports.add(port);
            this.portTopics.set(port, []);

            // Immediately communicate current connection status to newly connected port
            try {
                port.postMessage({
                    connected: this.transport.connected(),
                } satisfies communicationStatus);
            } catch {
                // Ignore if port not ready
            }

            // Listen for messages from this specific client port
            port.addEventListener("message", (messageEvent: MessageEvent<communicationEventMessage | eventFollow | communicationDisconnect>): void => {
                const data: communicationEventMessage | eventFollow | communicationDisconnect = messageEvent.data;

                // Explicit disconnect notification from client
                if ("disconnect" in data) {
                    this.removePort(port);
                    return;
                }

                if ("contents" in data) {
                    this.transport.publish(data.name, data.type, data.contents, data.time);
                    // Broadcast peer message only to ports that follow this topic (excluding sender)
                    this.publishToSubscribers(data, port);
                } else {
                    this.registerPortSubscription(port, data);
                }
            });
            port.start();
        });
    }

    /**
     * Registers a subscription for a port and forwards to transport if new globally
     * @param port The client port subscribing
     * @param data The topic follow request
     */
    private registerPortSubscription(port: MessagePort, data: eventFollow): void {
        let typeMap: Map<eventType, Set<MessagePort>> | undefined = this.portSubscriptions.get(data.name);
        if (!typeMap) {
            typeMap = new Map();
            this.portSubscriptions.set(data.name, typeMap);
        }

        let subscribers: Set<MessagePort> | undefined = typeMap.get(data.type);
        if (!subscribers) {
            subscribers = new Set();
            typeMap.set(data.type, subscribers);
        }
        subscribers.add(port);

        const topicsForPort: eventFollow[] | undefined = this.portTopics.get(port);
        if (topicsForPort) {
            topicsForPort.push(data);
        }

        // Check if transport already follows this topic globally
        const isUnique: boolean = !this.topicsFollowed.some((topic: eventFollow): boolean => topic.name === data.name && topic.type === data.type);
        if (isUnique) {
            console.log(`Following topic: "${data.name}" (${data.type})`);
            this.topicsFollowed.push(data);
            this.transport.follow(data.name, data.type);
        }
    }

    /**
     * Removes a disconnected port and cleans up its topic associations
     * @param port The message port to clean up
     */
    private removePort(port: MessagePort): void {
        this.ports.delete(port);
        const subscriptions: eventFollow[] | undefined = this.portTopics.get(port);
        if (subscriptions) {
            for (const sub of subscriptions) {
                const typeMap: Map<eventType, Set<MessagePort>> | undefined = this.portSubscriptions.get(sub.name);
                if (typeMap) {
                    const subscribers: Set<MessagePort> | undefined = typeMap.get(sub.type);
                    if (subscribers) {
                        subscribers.delete(port);
                        if (subscribers.size === 0) {
                            typeMap.delete(sub.type);
                            // No other ports subscribed to this topic type globally: notify transport
                            this.topicsFollowed = this.topicsFollowed.filter(
                                (topic: eventFollow): boolean => !(topic.name === sub.name && topic.type === sub.type)
                            );
                            console.log(`Unfollowing topic: "${sub.name}" (${sub.type})`);
                            this.transport.unfollow(sub.name, sub.type);
                        }
                    }
                    if (typeMap.size === 0) {
                        this.portSubscriptions.delete(sub.name);
                    }
                }
            }
            this.portTopics.delete(port);
        }
        try {
            port.close();
        } catch {
            // Port may already be closed
        }
    }

    /**
     * Handles an incoming message from the transport layer by routing it to subscribed ports
     * @param message The message received from the transport
     */
    private handleIncoming(message: eventMessage): void {
        this.publishToSubscribers(message);
    }

    /**
     * Sends an event message to all ports that follow its topic
     * @param message The message to dispatch
     * @param exclude Optional port to exclude (such as the original sender)
     */
    private publishToSubscribers(message: communicationEventMessage, exclude?: MessagePort): void {
        const typeMap: Map<eventType, Set<MessagePort>> | undefined = this.portSubscriptions.get(message.name);
        if (!typeMap) {
            return;
        }

        const subscribers: Set<MessagePort> | undefined = typeMap.get(message.type);
        if (!subscribers) {
            return;
        }

        const deadPorts: MessagePort[] = [];
        subscribers.forEach((port: MessagePort): void => {
            if (port !== exclude) {
                try {
                    port.postMessage(message);
                } catch {
                    deadPorts.push(port);
                }
            }
        });

        // Prune any ports that threw on postMessage
        for (const deadPort of deadPorts) {
            this.removePort(deadPort);
        }
    }

    /**
     * Broadcasts status event to all active ports, cleaning up any unresponsive ports
     * @param status The status data to broadcast
     */
    private broadcastStatus(status: communicationStatus): void {
        const deadPorts: MessagePort[] = [];
        this.ports.forEach((port: MessagePort): void => {
            try {
                port.postMessage(status);
            } catch {
                deadPorts.push(port);
            }
        });

        for (const deadPort of deadPorts) {
            this.removePort(deadPort);
        }
    }
}
