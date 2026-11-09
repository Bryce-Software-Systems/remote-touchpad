/*
 *    Copyright (c) 2018-2019, 2023 Unrud <unrud@outlook.com>
 *
 *    This file is part of Remote-Touchpad.
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 *
 *    Remote-Touchpad is distributed in the hope that it will be useful,
 *    but WITHOUT ANY WARRANTY; without even the implied warranty of
 *    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *    GNU General Public License for more details.
 *
 *    You should have received a copy of the GNU General Public License
 *    along with Remote-Touchpad.  If not, see <http://www.gnu.org/licenses/>.
 */

import Keyboard from "./keyboard.mjs";
import Mouse from "./mouse.mjs";
import Touchpad from "./touchpad.mjs";
import * as compat from "./compat.mjs";
import * as keys from "./inputcontroller.mjs";

const CLICK_VIBRATION_PATTERN = [10];
const IGNORE_CLICK_AFTER_TOUCH_DURATION = 1000; // milliseconds
const KEY_REPEAT_DELAY = 380; // milliseconds before a held key starts repeating
const KEY_REPEAT_INTERVAL = 90;
const STATUS_POLL_INTERVAL = 3000;
const TOAST_DURATION = 2600;
const CONFIRM_TIMEOUT = 4000;
const TABS = ["home", "remote", "pad", "keys"];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export default class UI {
    #inputController;
    #velarium;
    #mouse;
    #keyboard;
    #touchpad;
    #tab = "home";
    #path = [];
    #query = "";
    #ready = false;
    #closed = false;
    #statusTimer = null;
    #toastTimer = null;
    #confirmTimer = null;
    #ignoreClickUntilTimeStamp = Number.MIN_VALUE;
    #liveLast = "";
    #composing = false;

    constructor(inputController, velarium) {
        this.#inputController = inputController;
        this.#velarium = velarium;
        this.#mouse = new Mouse(inputController, $("#mouse"));
        this.#keyboard = new Keyboard(inputController, () => this.#activeView()?.classList.contains("keyboard-input"));
        this.#touchpad = new Touchpad(inputController, (target) => target.classList.contains("touch-input"));
        document.addEventListener("mousedown", this.#handleMousedown.bind(this));
        document.addEventListener("touchend", this.#handleTouchend.bind(this));
        compat.addFullscreenchangeEventListener(() => this.#update());
        compat.addPointerlockchangeEventListener(() => this.#update());
        for (const tab of $$("[data-go]")) {
            tab.addEventListener("click", () => this.showTab(tab.dataset.go));
        }
        this.#wireKeys();
        this.#wireTopBar();
        this.#wireHome();
        this.#wireKeyboardView();
        this.#wirePad();
        this.#wirePower();
        document.addEventListener("visibilitychange", () => this.#syncPolling());
        this.#update();
    }

    configure(config) {
        this.#mouse.configure(config);
        this.#keyboard.configure(config);
        this.#touchpad.configure(config);
        this.#velarium.configure(config);
        if (!this.#closed) {
            this.#ready = true;
        }
        const saved = sessionStorage.getItem("tab");
        this.#tab = TABS.includes(saved) ? saved : (this.#velarium.available ? "home" : "remote");
        if (this.#tab === "home" && !this.#velarium.available) {
            this.#tab = "remote";
        }
        this.#update();
        this.showTab(this.#tab);
    }

    close() {
        this.#ready = false;
        this.#closed = true;
        this.#syncPolling();
        this.#update();
    }

    // ------------------------------------------------------------------ plumbing

    #activeView() {
        return $(`#view-${this.#tab}`);
    }

    #handleTouchend(event) {
        // HACK: event.preventDefault doesn't reliably stop click events in Firefox (112)
        this.#ignoreClickUntilTimeStamp = event.timeStamp + IGNORE_CLICK_AFTER_TOUCH_DURATION;
    }

    #handleMousedown(event) {
        // A desktop mouse pressed on the touchpad surface captures the pointer (relative mouse mode).
        if (this.#tab === "pad" && event.buttons == 1 &&
            this.#ignoreClickUntilTimeStamp <= event.timeStamp &&
            event.target.classList.contains("mouse-input")) {
            compat.requestPointerLock($("#mouse"));
        }
    }

    toast(text) {
        const toast = $("#toast");
        toast.textContent = text;
        toast.classList.remove("hidden");
        clearTimeout(this.#toastTimer);
        this.#toastTimer = setTimeout(() => toast.classList.add("hidden"), TOAST_DURATION);
    }

    #feedback(element) {
        element.classList.add("click");
        setTimeout(() => element.classList.remove("click"), 120);
        compat.vibrate(CLICK_VIBRATION_PATTERN);
    }

    #setStatusLine(text, offline = false) {
        const line = $("#status-line");
        line.textContent = text;
        line.classList.toggle("offline", offline);
    }

    showTab(name) {
        if (!TABS.includes(name)) {
            return;
        }
        if (name === "home" && !this.#velarium.available) {
            name = "remote";
        }
        this.#tab = name;
        sessionStorage.setItem("tab", name);
        if (name !== "pad" && compat.fullscreenElement()) {
            compat.exitFullscreen();
        }
        if (compat.pointerLockElement()) {
            compat.exitPointerLock();
        }
        for (const view of $$("main > .view")) {
            view.classList.toggle("active", view.dataset.tab === name);
        }
        for (const tab of $$("[data-go]")) {
            tab.classList.toggle("active", tab.dataset.go === name);
            tab.setAttribute("aria-current", tab.dataset.go === name ? "page" : "false");
        }
        if (name === "home") {
            this.#loadHome();
        }
        if (name === "keys") {
            $("#text-box").focus({preventScroll: true});
        } else {
            document.activeElement?.blur?.();
        }
        this.#syncPolling();
    }

    #update() {
        const overlays = {opening: !this.#ready && !this.#closed, closed: this.#closed};
        $("#opening").classList.toggle("hidden", !overlays.opening);
        $("#closed").classList.toggle("hidden", !overlays.closed);
        const fullscreenEnabled = compat.fullscreenEnabled();
        for (const element of $$(".visible-if-fullscreen-enabled")) {
            element.classList.toggle("hidden", !fullscreenEnabled);
        }
        $("#mouse").classList.toggle("hidden", !compat.pointerLockElement());
        $("#btn-home").classList.toggle("hidden", false);
        if (this.#closed) {
            this.#setStatusLine("Disconnected", true);
        } else if (this.#ready) {
            this.#setStatusLine(this.#velarium.available ? "Connected to Velarium" : "Connected (touchpad only)");
        }
        $$("[data-go='home']").forEach((tab) => tab.classList.toggle("hidden", this.#ready && !this.#velarium.available));
        const tabbar = $(".tabbar");
        tabbar.style.gridTemplateColumns = `repeat(${$$("[data-go]:not(.hidden)", tabbar).length || 4}, 1fr)`;
    }

    // ------------------------------------------------------------------ keys, top bar

    #sendKey(name) {
        const code = keys["KEY_" + name];
        if (code !== undefined) {
            this.#inputController.keyboardKey(code);
        }
    }

    #wireKeys() {
        for (const button of $$("[data-key]")) {
            let delayTimer = null;
            let repeatTimer = null;
            const stop = () => {
                clearTimeout(delayTimer);
                clearInterval(repeatTimer);
                delayTimer = repeatTimer = null;
            };
            button.addEventListener("pointerdown", (event) => {
                if (event.button !== undefined && event.button > 0) {
                    return;
                }
                event.preventDefault();
                this.#feedback(button);
                this.#sendKey(button.dataset.key);
                if (button.hasAttribute("data-repeat")) {
                    stop();
                    delayTimer = setTimeout(() => {
                        repeatTimer = setInterval(() => this.#sendKey(button.dataset.key), KEY_REPEAT_INTERVAL);
                    }, KEY_REPEAT_DELAY);
                }
            });
            for (const type of ["pointerup", "pointercancel", "pointerleave", "contextmenu"]) {
                button.addEventListener(type, stop);
            }
            // Keyboard activation (Enter/Space on a focused button) still works.
            button.addEventListener("keydown", (event) => {
                if ((event.key === "Enter" || event.key === " ") && !event.repeat) {
                    this.#sendKey(button.dataset.key);
                    event.preventDefault();
                }
            });
        }
        for (const button of $$("[data-action='home']")) {
            button.addEventListener("click", () => this.goHome());
        }
    }

    #wireTopBar() {
        $("#btn-home").addEventListener("click", () => {
            this.#feedback($("#btn-home"));
            this.goHome();
        });
        $("#btn-close-app").addEventListener("click", () => this.goHome());
    }

    // Home: with Velarium, close whatever is running and show the launcher; otherwise the classic Ctrl+W.
    async goHome() {
        if (!this.#velarium.available) {
            this.#inputController.keyboardKey(keys.KEY_CLOSE_WINDOW);
            return;
        }
        try {
            await this.#velarium.goHome();
            this.#path = [];
            this.toast("Back on the Velarium home screen");
            this.#pollStatus();
        } catch (error) {
            this.toast(error.message);
        }
    }

    // ------------------------------------------------------------------ apps (Velarium home)

    #wireHome() {
        $("#app-search").addEventListener("input", (event) => {
            this.#query = event.target.value.trim().toLowerCase();
            this.#renderTiles();
        });
    }

    async #loadHome(force = false) {
        if (!this.#velarium.available) {
            return;
        }
        if (this.#velarium.loaded && !force) {
            this.#renderTiles();
            return;
        }
        this.#renderSkeleton();
        try {
            await this.#velarium.loadMenus();
            this.#renderTiles();
        } catch (error) {
            this.#showMessage(`Couldn't load the apps (${error.message}).`, "Try again", () => this.#loadHome(true));
        }
    }

    #showMessage(text, buttonLabel = "", onClick = null) {
        const box = $("#home-message");
        box.replaceChildren(document.createTextNode(text));
        if (buttonLabel) {
            const button = document.createElement("button");
            button.textContent = buttonLabel;
            button.addEventListener("click", onClick);
            box.append(document.createElement("br"), button);
        }
        box.classList.remove("hidden");
        $("#tiles").replaceChildren();
    }

    #renderSkeleton() {
        $("#home-message").classList.add("hidden");
        $("#tiles").replaceChildren(...Array.from({length: 8}, () => {
            const skeleton = document.createElement("div");
            skeleton.className = "tile skeleton";
            return skeleton;
        }));
    }

    #currentMenu() {
        return this.#path.length ? this.#path[this.#path.length - 1] : this.#velarium.home;
    }

    #renderCrumbs() {
        const crumbs = $("#crumbs");
        const searching = Boolean(this.#query);
        crumbs.classList.toggle("hidden", this.#path.length === 0 || searching);
        if (this.#path.length === 0 || searching) {
            return;
        }
        const back = document.createElement("button");
        back.innerHTML = '<svg class="ico"><use href="#i-chevron-left"/></svg>';
        back.append(document.createTextNode(this.#path.length > 1 ? this.#path[this.#path.length - 2] : "Apps"));
        back.addEventListener("click", () => {
            this.#path.pop();
            this.#renderTiles();
        });
        const here = document.createElement("span");
        here.className = "here";
        here.textContent = this.#path[this.#path.length - 1];
        crumbs.replaceChildren(back, here);
    }

    #tile({entry, menu, trail = []}) {
        const button = document.createElement("button");
        button.className = "tile" + (entry.kind === "menu" ? " menu" : "");
        button.setAttribute("role", "listitem");
        if (entry.iconData) {
            const image = document.createElement("img");
            image.src = entry.iconData;
            image.alt = "";
            image.loading = "lazy";
            button.append(image);
        } else {
            const glyph = document.createElement("span");
            glyph.className = "glyph";
            glyph.textContent = (entry.title || "?").trim().charAt(0).toUpperCase();
            button.append(glyph);
        }
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = entry.title;
        button.append(name);
        if (trail.length) {
            const path = document.createElement("span");
            path.className = "path";
            path.textContent = trail.join(" › ");
            button.append(path);
        }
        button.addEventListener("click", () => this.#openEntry(entry, menu));
        return button;
    }

    #renderTiles() {
        $("#home-message").classList.add("hidden");
        this.#renderCrumbs();
        let items;
        if (this.#query) {
            items = this.#velarium.allEntries()
                .filter(({entry}) => entry.title.toLowerCase().includes(this.#query));
            if (!items.length) {
                this.#showMessage(`No app matches “${$("#app-search").value.trim()}”.`);
                return;
            }
        } else {
            const menu = this.#currentMenu();
            items = this.#velarium.entries(menu).map((entry) => ({entry, menu}));
            if (!items.length) {
                this.#showMessage("Nothing here yet.");
                return;
            }
        }
        $("#tiles").replaceChildren(...items.map((item) => this.#tile(item)));
    }

    async #openEntry(entry, menu) {
        if (entry.kind === "menu") {
            $("#app-search").value = "";
            this.#query = "";
            this.#path.push(entry.target);
            this.#renderTiles();
            return;
        }
        try {
            await this.#velarium.launch(menu, entry.index);
            this.toast(`Opening ${entry.title}…`);
            if (entry.kind === "app") {
                // You almost always want to drive an app you just opened.
                setTimeout(() => this.showTab("remote"), 700);
            }
            this.#pollStatus();
        } catch (error) {
            this.toast(error.message);
        }
    }

    // ------------------------------------------------------------------ status polling

    #syncPolling() {
        const shouldPoll = this.#ready && this.#velarium.available && !this.#closed &&
            document.visibilityState === "visible";
        if (shouldPoll && this.#statusTimer === null) {
            this.#pollStatus();
            this.#statusTimer = setInterval(() => this.#pollStatus(), STATUS_POLL_INTERVAL);
        } else if (!shouldPoll && this.#statusTimer !== null) {
            clearInterval(this.#statusTimer);
            this.#statusTimer = null;
        }
    }

    async #pollStatus() {
        if (!this.#velarium.available || this.#closed) {
            return;
        }
        try {
            const status = await this.#velarium.status();
            const running = Boolean(status.appRunning);
            $("#app-banner").classList.toggle("hidden", !running);
            this.#setStatusLine(running ? "An app is running on the TV" : `Velarium · ${status.menu || this.#velarium.home}`);
        } catch (error) {
            this.#setStatusLine("Velarium isn't answering", true);
        }
    }

    // ------------------------------------------------------------------ keyboard view

    #wireKeyboardView() {
        const box = $("#text-box");
        const live = $("#live-typing");
        live.checked = localStorage.getItem("live-typing") === "1";
        live.addEventListener("change", () => {
            localStorage.setItem("live-typing", live.checked ? "1" : "0");
            this.#liveLast = box.value;
            box.focus();
        });
        box.value = sessionStorage.getItem("text-box") || "";
        this.#liveLast = box.value;
        box.addEventListener("compositionstart", () => { this.#composing = true; });
        box.addEventListener("compositionend", () => { this.#composing = false; this.#onTextInput(); });
        box.addEventListener("input", () => { if (!this.#composing) this.#onTextInput(); });
        $("#btn-send").addEventListener("click", () => {
            this.#feedback($("#btn-send"));
            this.#sendText();
        });
        $("#btn-clear").addEventListener("click", () => {
            box.value = "";
            this.#liveLast = "";
            sessionStorage.removeItem("text-box");
            box.focus();
        });
    }

    #onTextInput() {
        const box = $("#text-box");
        sessionStorage.setItem("text-box", box.value);
        if (!$("#live-typing").checked) {
            return;
        }
        // Live typing: send only what changed since the last input (backspaces for deletions, then new text).
        const before = this.#liveLast;
        const now = box.value;
        let common = 0;
        while (common < before.length && common < now.length && before[common] === now[common]) {
            common += 1;
        }
        for (let i = 0; i < Math.min(before.length - common, 100); i += 1) {
            this.#inputController.keyboardKey(keys.KEY_BACK_SPACE);
        }
        if (now.length > common) {
            this.#inputController.keyboardText(now.slice(common).replace(/\r\n?/g, "\n"));
        }
        this.#liveLast = now;
    }

    #sendText() {
        const box = $("#text-box");
        if (!box.value) {
            return;
        }
        if (!$("#live-typing").checked) {
            this.#inputController.keyboardText(box.value.replace(/\r\n?/g, "\n"));
            this.toast("Sent to the TV");
        }
        box.value = "";
        this.#liveLast = "";
        sessionStorage.removeItem("text-box");
        box.focus();
    }

    // ------------------------------------------------------------------ touchpad view

    #wirePad() {
        for (const [id, button] of [["#btn-left-click", keys.POINTER_BUTTON_LEFT], ["#btn-right-click", keys.POINTER_BUTTON_RIGHT]]) {
            const element = $(id);
            const release = () => {
                if (element.dataset.down) {
                    delete element.dataset.down;
                    this.#inputController.pointerButton(button, false);
                }
            };
            element.addEventListener("pointerdown", (event) => {
                event.preventDefault();
                element.dataset.down = "1";
                this.#feedback(element);
                this.#inputController.pointerButton(button, true);
            });
            for (const type of ["pointerup", "pointercancel", "pointerleave"]) {
                element.addEventListener(type, release);
            }
        }
        $("#btn-fullscreen").addEventListener("click", () => this.toggleFullscreen());
    }

    toggleFullscreen() {
        if (compat.fullscreenElement()) {
            compat.exitFullscreen();
        } else {
            compat.requestFullscreen(document.documentElement, {navigationUI: "hide"});
        }
    }

    // ------------------------------------------------------------------ power

    #wirePower() {
        const sheet = $("#sheet");
        const close = () => {
            sheet.classList.add("hidden");
            this.#resetConfirm();
        };
        $("#btn-power").addEventListener("click", () => {
            if (!this.#velarium.available) {
                this.toast("Power options need a Velarium box");
                return;
            }
            sheet.classList.remove("hidden");
        });
        for (const element of $$("[data-close-sheet]")) {
            element.addEventListener("click", close);
        }
        for (const item of $$("[data-power]", sheet)) {
            item.addEventListener("click", async () => {
                const mode = item.dataset.power;
                if (mode !== "sleep" && !item.classList.contains("confirm")) {
                    this.#resetConfirm();
                    item.classList.add("confirm");
                    item.dataset.label = $("span", item).textContent;
                    $("span", item).textContent = "Tap again to confirm";
                    this.#confirmTimer = setTimeout(() => this.#resetConfirm(), CONFIRM_TIMEOUT);
                    return;
                }
                close();
                try {
                    await this.#velarium.power(mode);
                    this.toast(mode === "sleep" ? "Going to sleep…" : mode === "restart" ? "Restarting…" : "Shutting down…");
                } catch (error) {
                    this.toast(error.message);
                }
            });
        }
    }

    #resetConfirm() {
        clearTimeout(this.#confirmTimer);
        for (const item of $$("#sheet .confirm")) {
            item.classList.remove("confirm");
            $("span", item).textContent = item.dataset.label || $("span", item).textContent;
        }
    }
}
