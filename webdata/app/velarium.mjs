/*
 *    This file is part of Remote-Touchpad (Velarium fork).
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 */

// The Velarium launcher as seen from the phone: its menus (apps), launching, Home / close app, status, power.
// All of it goes through the websocket to the Go server, which forwards a small fixed set of operations to the
// launcher's control socket. `available` is false when this app runs without Velarium.

export default class Velarium {
    #socket;
    available = false;
    home = "Main";
    menus = {};
    loaded = false;

    constructor(socket) {
        this.#socket = socket;
    }

    configure(config) {
        this.available = Boolean(config.velarium);
    }

    async #call(payload, timeout = undefined) {
        const reply = await this.#socket.request(payload, timeout);
        if (!reply.ok) {
            throw new Error(reply.error || "The TV box refused that");
        }
        return reply;
    }

    async loadMenus() {
        const reply = await this.#call({op: "menus"});
        this.home = reply.home || "Main";
        this.menus = reply.menus || {};
        this.loaded = true;
        return this.menus;
    }

    entries(menu) {
        return (this.menus[menu] || []).filter((entry) => entry.kind !== "back");
    }

    // Every launchable entry in every menu, with the path to reach it (for search).
    allEntries() {
        const found = [];
        const seen = new Set();
        const walk = (menu, trail) => {
            if (seen.has(menu)) {
                return;
            }
            seen.add(menu);
            for (const entry of this.entries(menu)) {
                if (entry.kind === "menu") {
                    walk(entry.target, [...trail, entry.title]);
                } else {
                    found.push({entry, menu, trail});
                }
            }
        };
        walk(this.home, []);
        return found;
    }

    launch(menu, index) {
        return this.#call({op: "launch", menu, index});
    }

    goHome() {
        return this.#call({op: "home"});
    }

    status() {
        return this.#call({op: "status"});
    }

    power(mode) {
        return this.#call({op: "power", mode});
    }

    // ---- Now Playing
    player(app, action, value = null) {
        return this.#call({op: "player", app, action, value});
    }

    // ---- search, open, cast
    async search(q) {
        return (await this.#call({op: "search", q}, 25000)).results || [];
    }

    open(kind, ref, at = undefined) {
        return this.#call({op: "open", kind, ref, ...(at === undefined ? {} : {at})});
    }

    cast(url) {
        return this.#call({op: "cast", url});
    }

    // ---- DVR
    dvr() {
        return this.#call({op: "dvr"});
    }

    dvrCancel(id) {
        return this.#call({op: "dvr_cancel", id});
    }

    dvrDelete(id) {
        return this.#call({op: "dvr_delete", id});
    }

    async dvrChannels(q = "") {
        return (await this.#call({op: "dvr_channels", q})).channels || [];
    }

    async dvrPrograms(streamId) {
        return (await this.#call({op: "dvr_programs", streamId})).programs || [];
    }

    dvrSchedule(streamId, startTs) {
        return this.#call({op: "dvr_schedule", streamId, startTs});
    }

    // ---- first-run setup
    setupStatus() {
        return this.#call({op: "setup_status"}, 20000);
    }

    wifiList() {
        return this.#call({op: "wifi_list"}, 45000);
    }

    wifiConnect(ssid, password) {
        return this.#call({op: "wifi_connect", ssid, password}, 70000);
    }

    jellyfinLogin(server, username, password) {
        return this.#call({op: "jellyfin_login", server, username, password}, 40000);
    }
}
