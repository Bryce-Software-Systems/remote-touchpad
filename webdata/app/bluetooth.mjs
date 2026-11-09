/*
 *    This file is part of Remote-Touchpad (Velarium fork).
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 */

import {$, el, icon} from "./dom.mjs";

// Bluetooth setup: scan, pair (the box also trusts and connects), connect, disconnect, forget.
export default class Bluetooth {
    #velarium;
    #toast;
    #devices = [];
    #busyMac = "";
    #scanned = false;

    constructor(velarium, {toast}) {
        this.#velarium = velarium;
        this.#toast = toast;
        $("#bt-scan").addEventListener("click", () => this.scan());
    }

    // Shown for the first time: scan straight away, it is what people came for.
    opened() {
        if (!this.#scanned) {
            this.scan();
        }
    }

    async scan() {
        const button = $("#bt-scan");
        button.disabled = true;
        button.lastChild.textContent = "Scanning…";
        $("#bt-status-sub").textContent = "Looking for devices nearby (about 10 seconds)…";
        try {
            const reply = await this.#velarium.btList();
            this.#scanned = true;
            if (!reply.available) {
                $("#bt-status").textContent = "No Bluetooth adapter";
                $("#bt-status-sub").textContent = "This box has no Bluetooth adapter, or it is turned off.";
                this.#devices = [];
            } else {
                this.#devices = reply.devices;
                const connected = this.#devices.filter((d) => d.connected).length;
                $("#bt-status").textContent = connected ? `${connected} connected` : "Bluetooth is on";
                $("#bt-status-sub").textContent = this.#devices.length
                    ? "Tap a device to pair or manage it."
                    : "Nothing found. Put the device in pairing mode and scan again.";
            }
            this.#render();
        } catch (error) {
            $("#bt-status-sub").textContent = `Couldn't scan (${error.message}).`;
        }
        button.disabled = false;
        button.lastChild.textContent = "Scan for devices";
    }

    #render() {
        $("#bt-list").replaceChildren(...this.#devices.map((device) => this.#row(device)));
    }

    #row(device) {
        const busy = this.#busyMac === device.mac;
        const state = device.connected ? "Connected" : device.paired ? "Paired" : "Not paired";
        const actions = [];
        const act = (label, action, cls = "key") => el("button", {class: `${cls} small`, disabled: this.#busyMac !== "", onclick: () => this.#run(device, action), text: label});
        if (!device.paired) {
            actions.push(act("Pair", "pair", "primary"));
        } else if (device.connected) {
            actions.push(act("Disconnect", "disconnect"), act("Forget", "forget", "danger"));
        } else {
            actions.push(act("Connect", "connect", "primary"), act("Forget", "forget", "danger"));
        }
        return el("div", {class: `device${device.connected ? " connected" : ""}`},
            el("span", {class: "device-icon"}, icon("bluetooth")),
            el("span", {class: "device-main"},
                el("strong", {text: device.name}),
                el("span", {class: "chips"}, el("span", {class: `chip${device.connected ? " ok" : ""}`, text: busy ? "Working…" : state}))),
            el("span", {class: "device-actions"}, actions));
    }

    async #run(device, action) {
        this.#busyMac = device.mac;
        this.#render();
        try {
            const reply = await this.#velarium.btAction(device.mac, action);
            if (reply.device) {
                this.#devices = this.#devices.map((d) => d.mac === device.mac ? {...d, ...reply.device} : d);
            } else {
                this.#devices = this.#devices.filter((d) => d.mac !== device.mac);
            }
            this.#toast({pair: `Paired with ${device.name}`, connect: `Connected to ${device.name}`,
                disconnect: `Disconnected ${device.name}`, forget: `Forgot ${device.name}`}[action]);
        } catch (error) {
            this.#toast(error.message);
        }
        this.#busyMac = "";
        this.#render();
    }
}
