/// <reference lib="webworker" />

import { type eventContents, type eventName, type eventType } from "@sss/sss-guis-smart-widgets-common";

/**
 * Abstract class representing a transport mechanism for event messages.
 * This class should be extended to implement specific communication protocols
 */
export abstract class transport {
    /**
     * Publishes an event message through the transport layer.
     * @param name The name of the event
     * @param type The type of the event
     * @param contents The payload of the event
     * @param time Optional timestamp for the event
     */
    public abstract publish(name: eventName, type: eventType, contents: eventContents, time?: Date): void;

    /**
     * Registers a follow request for specific events through the transport layer.
     * @param name The name of the event to follow
     * @param type The type of the event to follow
     */
    public abstract follow(name: eventName, type: eventType): void;

    /**
     * Unregisters a follow request for specific events through the transport layer.
     * @param name The name of the event to unfollow
     * @param type The type of the event to unfollow
     */
    public abstract unfollow(name: eventName, type: eventType): void;

    /**
     * Registers a listener for messages received through the transport layer.
     * @param listener The callback to execute when a message is received
     */
    public abstract receive(listener: (name: eventName, type: eventType, contents: eventContents, time?: Date) => void): void;

    /**
     * Whether the transport is actively connected
     * @returns If actively connected to the transport
     */
    public abstract connected(): boolean;
}
