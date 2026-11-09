/*
 *    This file is part of Remote-Touchpad (Velarium fork).
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 */

import {$, el, formatTime} from "./dom.mjs";

const SEEK_STEP = 10; // seconds for the skip buttons
const KIND_LABELS = {live: "Live", movie: "Movie", episode: "Episode", recording: "Recording", video: "Video"};

// What is playing on the TV, with transport controls: a card at the top of the Remote screen, and a one-line bar above
// the tab bar on every other screen. The state comes from the launcher's status poll (ui.mjs calls update()); between
// polls the position is advanced locally so the bar moves smoothly.
export default class NowPlaying {
    #velarium;
    #onError;
    #onOpenRemote;
    #state = null;
    #stateAt = 0;
    #dragging = false;
    #tab = "";
    #card = $("#now-playing");
    #mini = $("#mini-np");
    #range = $("#np-range");
    #audio = $("#np-audio");
    #subs = $("#np-subs");

    constructor(velarium, {onError, onOpenRemote, onChanged}) {
        this.#velarium = velarium;
        this.#onError = onError;
        this.#onOpenRemote = onOpenRemote;
        this.onChanged = onChanged;
        $("#np-toggle").addEventListener("click", () => this.#send("toggle"));
        $("#np-back").addEventListener("click", () => this.#send("seek", -SEEK_STEP));
        $("#np-forward").addEventListener("click", () => this.#send("seek", SEEK_STEP));
        $("#np-prev").addEventListener("click", () => this.#send("prev"));
        $("#np-next").addEventListener("click", () => this.#send("next"));
        $("#np-stop").addEventListener("click", () => this.#send("stop"));
        $("#mini-np-toggle").addEventListener("click", (event) => {
            event.stopPropagation();
            this.#send("toggle");
        });
        this.#mini.addEventListener("click", () => this.#onOpenRemote());
        this.#range.addEventListener("input", () => {
            this.#dragging = true;
            if (this.#state?.duration) {
                $("#np-pos").textContent = formatTime(this.#range.value / 1000 * this.#state.duration);
            }
        });
        this.#range.addEventListener("change", () => {
            this.#dragging = false;
            if (this.#state?.duration) {
                this.#send("seekto", Math.round(this.#range.value / 1000 * this.#state.duration));
            }
        });
        this.#audio.addEventListener("change", () => this.#send("audio", JSON.parse(this.#audio.value)));
        this.#subs.addEventListener("change", () => this.#send("subtitle", JSON.parse(this.#subs.value)));
        setInterval(() => this.#tick(), 500);
    }

    get playing() {
        return this.#state !== null;
    }

    // The mini bar is for every screen except the Remote, which shows the full card.
    setTab(tab) {
        this.#tab = tab;
        this.#mini.classList.toggle("hidden", !this.#state || tab === "remote");
    }

    async #send(action, value = null) {
        const state = this.#state;
        if (!state) {
            return;
        }
        // Optimistic: flip the button at once; the next poll confirms (or corrects) it.
        if (action === "toggle") {
            state.status = state.status === "paused" ? "playing" : "paused";
            this.#render();
        }
        try {
            await this.#velarium.player(state.app, action, value);
            this.onChanged?.();
        } catch (error) {
            this.#onError(error.message);
        }
    }

    update(state) {
        this.#state = state;
        this.#stateAt = performance.now();
        this.#render();
    }

    #position() {
        const state = this.#state;
        if (!state) {
            return 0;
        }
        const elapsed = state.status === "playing" ? (performance.now() - this.#stateAt) / 1000 : 0;
        const position = state.position + elapsed;
        return state.duration ? Math.min(position, state.duration) : position;
    }

    #tick() {
        if (this.#state && !this.#dragging && !document.hidden) {
            this.#renderProgress();
        }
    }

    #renderProgress() {
        const state = this.#state;
        if (!state) {
            return;
        }
        const position = this.#position();
        $("#np-pos").textContent = state.duration ? formatTime(position) : "";
        $("#np-dur").textContent = state.duration ? formatTime(state.duration) : (state.kind === "live" ? "LIVE" : "");
        this.#range.disabled = !state.canSeek || !state.duration;
        this.#range.classList.toggle("hidden", !state.duration);
        if (state.duration && !this.#dragging) {
            this.#range.value = String(Math.round(position / state.duration * 1000));
        }
    }

    #fillTracks(select, tracks, label) {
        const key = JSON.stringify(tracks.map((t) => [t.id, t.label, t.selected]));
        if (select.dataset.key === key) {
            return;
        }
        select.dataset.key = key;
        select.replaceChildren(...tracks.map((track) =>
            el("option", {value: JSON.stringify(track.id), selected: track.selected, text: track.label})));
        select.classList.toggle("hidden", tracks.length < 2);
        select.setAttribute("aria-label", label);
    }

    #render() {
        const state = this.#state;
        this.#card.classList.toggle("hidden", !state);
        this.#mini.classList.toggle("hidden", !state || this.#tab === "remote");
        if (!state) {
            return;
        }
        const paused = state.status === "paused";
        $("#np-title").textContent = state.title || "Playing";
        $("#np-sub").textContent = state.subtitle;
        $("#np-sub").classList.toggle("hidden", !state.subtitle);
        $("#np-kind").textContent = KIND_LABELS[state.kind] || "";
        $("#np-buffering").classList.toggle("hidden", state.status !== "buffering");
        for (const id of ["#np-toggle", "#mini-np-toggle"]) {
            const button = $(id);
            button.setAttribute("aria-label", paused ? "Play" : "Pause");
            button.classList.toggle("is-paused", paused);
        }
        $("#np-prev").disabled = !state.hasPrev;
        $("#np-next").disabled = !state.hasNext;
        $("#np-back").disabled = $("#np-forward").disabled = !state.canSeek;
        $("#mini-np-title").textContent = state.subtitle ? `${state.title} · ${state.subtitle}` : state.title;
        this.#fillTracks(this.#audio, state.audioTracks, "Audio track");
        this.#fillTracks(this.#subs, state.subtitleTracks, "Subtitles");
        this.#renderProgress();
    }
}
