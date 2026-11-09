/*
 *    This file is part of Remote-Touchpad (Velarium fork).
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 */

import {$, $$, debounce, el, formatBytes, formatWhen} from "./dom.mjs";

const DVR_REFRESH = 5000; // milliseconds
const STATUS_LABELS = {scheduled: "Scheduled", recording: "Recording", completed: "Ready", failed: "Failed", cancelled: "Stopped", missed: "Missed"};

// The "More" tab: a menu of Cast a link, Recordings (DVR) and Set up, each a page of its own with a Back button.
export default class More {
    #velarium;
    #toast;
    #page = "";
    #dvrTimer = null;
    #dvrMode = "recordings";
    #channel = null;
    #pendingDelete = null;

    constructor(velarium, {toast, onOpened}) {
        this.#velarium = velarium;
        this.#toast = toast;
        this.onOpened = onOpened;
        for (const card of $$("[data-more]")) {
            card.addEventListener("click", () => this.show(card.dataset.more));
        }
        for (const back of $$("[data-more-back]")) {
            back.addEventListener("click", () => this.show(""));
        }
        this.#wireCast();
        this.#wireDvr();
        this.#wireSetup();
    }

    show(page) {
        this.#page = page;
        for (const section of $$("#view-more [data-page]")) {
            section.classList.toggle("hidden", section.dataset.page !== page);
        }
        $("#more-menu").classList.toggle("hidden", page !== "");
        clearInterval(this.#dvrTimer);
        this.#dvrTimer = null;
        if (page === "dvr") {
            this.#showDvr(this.#dvrMode);
        } else if (page === "setup") {
            this.#refreshSetup();
        } else if (page === "cast") {
            $("#cast-url").focus({preventScroll: true});
        }
    }

    // Called when the whole More tab is shown or hidden.
    visible(isVisible) {
        if (!isVisible) {
            clearInterval(this.#dvrTimer);
            this.#dvrTimer = null;
        } else if (this.#page) {
            this.show(this.#page);
        }
    }

    #busy(button, working, label) {
        button.disabled = working;
        if (label !== undefined) {
            button.dataset.label = button.dataset.label || button.textContent;
            button.textContent = working ? label : button.dataset.label;
        }
    }

    // ------------------------------------------------------------------ cast

    #wireCast() {
        const input = $("#cast-url");
        const button = $("#cast-go");
        const send = async () => {
            const url = input.value.trim();
            if (!url) {
                return;
            }
            this.#busy(button, true, "Sending…");
            try {
                const reply = await this.#velarium.cast(url);
                this.#toast(reply.via === "youtube" ? "Opening in YouTube on the TV…" : "Opening in the browser on the TV…");
                input.value = "";
                this.onOpened?.();
            } catch (error) {
                this.#toast(error.message);
            }
            this.#busy(button, false, "");
        };
        button.addEventListener("click", send);
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                send();
            }
        });
        $("#cast-paste").addEventListener("click", async () => {
            try {
                input.value = (await navigator.clipboard.readText()).trim();
            } catch (error) {
                this.#toast("Long-press the box and choose Paste");
            }
            input.focus();
        });
    }

    // ------------------------------------------------------------------ DVR

    #wireDvr() {
        for (const button of $$("[data-dvr-mode]")) {
            button.addEventListener("click", () => this.#showDvr(button.dataset.dvrMode));
        }
        $("#dvr-channel-search").addEventListener("input", debounce(() => this.#loadChannels(), 300));
        $("#dvr-programs-back").addEventListener("click", () => {
            this.#channel = null;
            this.#renderSchedulePane();
        });
    }

    #showDvr(mode) {
        this.#dvrMode = mode;
        for (const button of $$("[data-dvr-mode]")) {
            button.classList.toggle("active", button.dataset.dvrMode === mode);
        }
        $("#dvr-recordings").classList.toggle("hidden", mode !== "recordings");
        $("#dvr-schedule").classList.toggle("hidden", mode !== "schedule");
        clearInterval(this.#dvrTimer);
        this.#dvrTimer = null;
        if (mode === "recordings") {
            this.#loadRecordings();
            this.#dvrTimer = setInterval(() => !document.hidden && this.#loadRecordings(), DVR_REFRESH);
        } else {
            this.#renderSchedulePane();
        }
    }

    async #loadRecordings() {
        try {
            const reply = await this.#velarium.dvr();
            $("#dvr-free").textContent = `${formatBytes(reply.freeBytes)} free for recordings`;
            const list = $("#dvr-list");
            if (!reply.recordings.length) {
                list.replaceChildren(el("p", {class: "empty", text: "No recordings yet. Open Schedule to choose a show."}));
                return;
            }
            list.replaceChildren(...reply.recordings.map((rec) => this.#recordingRow(rec)));
        } catch (error) {
            $("#dvr-list").replaceChildren(el("p", {class: "empty", text: `Couldn't load recordings (${error.message}).`}));
        }
    }

    #recordingRow(rec) {
        const active = rec.status === "scheduled" || rec.status === "recording";
        const actions = [];
        if (rec.playable) {
            actions.push(el("button", {class: "small primary", text: "Play", onclick: () => this.#play(rec)}));
        }
        if (active) {
            actions.push(el("button", {class: "small", text: rec.status === "recording" ? "Stop" : "Cancel", onclick: () => this.#act(() => this.#velarium.dvrCancel(rec.id))}));
        }
        const armed = this.#pendingDelete === rec.id;
        actions.push(el("button", {class: `small danger${armed ? " armed" : ""}`, text: armed ? "Tap again" : "Delete", onclick: () => {
            if (this.#pendingDelete !== rec.id) {
                this.#pendingDelete = rec.id;
                setTimeout(() => { if (this.#pendingDelete === rec.id) { this.#pendingDelete = null; this.#loadRecordings(); } }, 4000);
                this.#loadRecordings();
                return;
            }
            this.#pendingDelete = null;
            this.#act(() => this.#velarium.dvrDelete(rec.id));
        }}));
        return el("div", {class: `rec ${rec.status}`},
            el("div", {class: "rec-main"},
                el("strong", {text: rec.title || "Untitled"}),
                el("span", {text: `${rec.channel} · ${formatWhen(rec.startTs)}`}),
                rec.status === "failed" && rec.error && el("span", {class: "rec-error", text: rec.error})),
            el("span", {class: "chip", text: STATUS_LABELS[rec.status] || rec.status}),
            el("div", {class: "rec-actions"}, ...actions));
    }

    async #act(fn) {
        try {
            await fn();
        } catch (error) {
            this.#toast(error.message);
        }
        this.#loadRecordings();
    }

    async #play(rec) {
        try {
            await this.#velarium.open("recording", rec.id);
            this.#toast(`Playing “${rec.title}” on the TV…`);
            this.onOpened?.();
        } catch (error) {
            this.#toast(error.message);
        }
    }

    async #loadChannels() {
        const list = $("#dvr-channels");
        list.replaceChildren(el("p", {class: "empty", text: "Loading…"}));
        try {
            const channels = await this.#velarium.dvrChannels($("#dvr-channel-search").value.trim());
            list.replaceChildren(...(channels.length ? channels.map((channel) =>
                el("button", {class: "result", onclick: () => { this.#channel = channel; this.#renderSchedulePane(); }},
                    el("span", {class: "result-title", text: channel.name}),
                    channel.category && el("span", {class: "result-sub", text: channel.category})))
                : [el("p", {class: "empty", text: "No channels yet. Open Live TV on the TV once so the guide can download."})]));
        } catch (error) {
            list.replaceChildren(el("p", {class: "empty", text: `Couldn't load channels (${error.message}).`}));
        }
    }

    async #renderSchedulePane() {
        const showPrograms = this.#channel !== null;
        $("#dvr-channel-pane").classList.toggle("hidden", showPrograms);
        $("#dvr-programs-pane").classList.toggle("hidden", !showPrograms);
        if (!showPrograms) {
            this.#loadChannels();
            return;
        }
        $("#dvr-programs-title").textContent = this.#channel.name;
        const list = $("#dvr-programs");
        list.replaceChildren(el("p", {class: "empty", text: "Loading the guide…"}));
        try {
            const programs = await this.#velarium.dvrPrograms(this.#channel.stream_id);
            list.replaceChildren(...(programs.length ? programs.map((p) => this.#programRow(p))
                : [el("p", {class: "empty", text: "No guide data for this channel yet."})]));
        } catch (error) {
            list.replaceChildren(el("p", {class: "empty", text: `Couldn't load the guide (${error.message}).`}));
        }
    }

    #programRow(program) {
        const onNow = program.start_ts * 1000 <= Date.now();
        const button = el("button", {class: `small ${program.scheduled ? "" : "primary"}`, text: program.scheduled ? "✓ Scheduled" : (onNow ? "Record now" : "Record"),
            disabled: program.scheduled, onclick: async () => {
                button.disabled = true;
                try {
                    await this.#velarium.dvrSchedule(this.#channel.stream_id, program.start_ts);
                    button.textContent = "✓ Scheduled";
                    this.#toast("Scheduled");
                } catch (error) {
                    button.disabled = false;
                    this.#toast(error.message);
                }
            }});
        return el("div", {class: "program"},
            el("div", {class: "rec-main"}, el("strong", {text: program.title}),
                el("span", {text: `${formatWhen(program.start_ts)}${onNow ? " · on now" : ""}`})),
            button);
    }

    // ------------------------------------------------------------------ setup

    #wireSetup() {
        $("#wifi-scan").addEventListener("click", () => this.#scanWifi());
        $("#wifi-form").addEventListener("submit", (event) => {
            event.preventDefault();
            this.#connectWifi();
        });
        $("#wifi-cancel").addEventListener("click", () => $("#wifi-form").classList.add("hidden"));
    }

    async #refreshSetup() {
        try {
            const status = await this.#velarium.setupStatus();
            const wifi = status.wifi || {};
            $("#wifi-status").textContent = !wifi.available ? "Network tools aren't available on this box."
                : wifi.connection ? `Connected to ${wifi.connection}${wifi.internet === "full" ? " · internet OK" : wifi.internet === "limited" || wifi.internet === "none" ? " · no internet" : ""}`
                : "Not connected to a network.";
        } catch (error) {
            $("#wifi-status").textContent = `Couldn't read the box's status (${error.message}).`;
        }
    }

    async #scanWifi() {
        const button = $("#wifi-scan");
        const list = $("#wifi-list");
        this.#busy(button, true, "Scanning…");
        list.replaceChildren(el("p", {class: "empty", text: "Looking for networks…"}));
        try {
            const reply = await this.#velarium.wifiList();
            if (!reply.adapter && !reply.ethernet) {
                list.replaceChildren(el("p", {class: "empty", text: "No Wi-Fi adapter found."}));
            } else if (!reply.networks.length) {
                list.replaceChildren(el("p", {class: "empty", text: reply.ethernet ? "This box is on a wired connection. No Wi-Fi networks in range." : "No networks in range."}));
            } else {
                list.replaceChildren(...reply.networks.map((network) =>
                    el("button", {class: "result", onclick: () => this.#chooseNetwork(network)},
                        el("span", {class: "result-title", text: network.ssid}),
                        el("span", {class: "result-sub", text: `${network.connected ? "Connected · " : ""}${network.secured ? "Secured" : "Open"} · signal ${network.signal}%`}))));
            }
        } catch (error) {
            list.replaceChildren(el("p", {class: "empty", text: `Couldn't scan (${error.message}).`}));
        }
        this.#busy(button, false, "");
    }

    #chooseNetwork(network) {
        const form = $("#wifi-form");
        form.dataset.ssid = network.ssid;
        $("#wifi-form-title").textContent = network.ssid;
        $("#wifi-password").value = "";
        $("#wifi-password-row").classList.toggle("hidden", !network.secured);
        form.classList.remove("hidden");
        (network.secured ? $("#wifi-password") : $("#wifi-connect")).focus({preventScroll: true});
        form.scrollIntoView({block: "nearest"});
    }

    async #connectWifi() {
        const form = $("#wifi-form");
        const button = $("#wifi-connect");
        this.#busy(button, true, "Connecting…");
        try {
            await this.#velarium.wifiConnect(form.dataset.ssid, $("#wifi-password").value);
            $("#wifi-password").value = "";
            form.classList.add("hidden");
            this.#toast(`Connected to ${form.dataset.ssid}`);
            this.#refreshSetup();
        } catch (error) {
            this.#toast(error.message);
        }
        this.#busy(button, false, "");
    }
}
