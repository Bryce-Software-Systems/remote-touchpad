/*
 *    This file is part of Remote-Touchpad (Velarium fork).
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 */

import {$, debounce, el} from "./dom.mjs";

const MIN_QUERY = 2;
const DEBOUNCE = 350; // milliseconds
const GROUP_ORDER = ["Cinema", "Live TV", "Recordings", "YouTube"];

// Universal search under the Apps tab: apps match instantly on the phone; Cinema, Live TV, recordings and YouTube
// come from the launcher (one query, several sources) a moment later. Tapping a result opens it on the TV.
export default class Search {
    #velarium;
    #callbacks;
    #results = $("#results");
    #token = 0;
    #query = "";

    constructor(velarium, callbacks) {
        this.#velarium = velarium;
        this.#callbacks = callbacks; // {openApp(entry, menu), openResult(result), onError(text)}
        this.run = debounce((query) => this.#fetch(query), DEBOUNCE);
    }

    get active() {
        return this.#query.length >= MIN_QUERY;
    }

    setQuery(raw) {
        this.#query = raw.trim();
        this.#token += 1;
        if (!this.active) {
            this.#results.classList.add("hidden");
            return;
        }
        this.#results.classList.remove("hidden");
        this.#render(this.#localApps(), true);
        this.run(this.#query);
    }

    #localApps() {
        const needle = this.#query.toLowerCase();
        return this.#velarium.allEntries()
            .filter(({entry}) => entry.title.toLowerCase().includes(needle))
            .map(({entry, menu, trail}) => ({group: "Apps", kind: "app", title: entry.title, subtitle: trail.join(" › "), entry, menu}));
    }

    async #fetch(query) {
        if (query !== this.#query || !this.active) {
            return;
        }
        const token = this.#token;
        try {
            const remote = await this.#velarium.search(query);
            if (token !== this.#token) {
                return; // a newer query replaced this one
            }
            this.#render([...this.#localApps(), ...remote.filter((r) => r.group !== "Apps")], false);
        } catch (error) {
            if (token === this.#token) {
                this.#render(this.#localApps(), false, error.message);
            }
        }
    }

    #render(items, searching, error = "") {
        const groups = new Map();
        for (const item of items) {
            if (!groups.has(item.group)) {
                groups.set(item.group, []);
            }
            groups.get(item.group).push(item);
        }
        const nodes = [];
        for (const name of ["Apps", ...GROUP_ORDER]) {
            const group = groups.get(name);
            if (!group) {
                continue;
            }
            nodes.push(el("h3", {class: "group", text: name}));
            for (const item of group) {
                nodes.push(el("button", {class: "result", onclick: () => this.#open(item)},
                    el("span", {class: "result-title", text: item.title}),
                    item.subtitle && el("span", {class: "result-sub", text: item.subtitle})));
            }
        }
        if (searching) {
            nodes.push(el("p", {class: "searching", text: "Searching Cinema, Live TV and more…"}));
        } else if (error) {
            nodes.push(el("p", {class: "searching", text: `Some results are missing (${error}).`}));
        } else if (!items.length) {
            nodes.push(el("p", {class: "searching", text: `Nothing found for “${this.#query}”.`}));
        }
        this.#results.replaceChildren(...nodes);
    }

    #open(item) {
        if (item.kind === "app") {
            this.#callbacks.openApp(item.entry, item.menu);
        } else {
            this.#callbacks.openResult(item);
        }
    }
}
