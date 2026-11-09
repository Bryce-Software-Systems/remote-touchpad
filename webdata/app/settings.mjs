/*
 *    This file is part of Remote-Touchpad (Velarium fork).
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 */

import {$, el, icon} from "./dom.mjs";

const COLOR = /^#[0-9a-fA-F]{3,8}$/;

// The TV's Configuration editor on the phone: collapsible sections, a switch for on/off options, swatches for colours,
// pills for short lists, a menu for long lists and a text box for everything else. Every change is saved at once; the
// launcher needs a restart to apply them, offered in the bar at the bottom.
export default class Settings {
    #velarium;
    #toast;
    #sections = [];
    #open = new Set();
    #loaded = false;
    #dirty = false;

    constructor(velarium, {toast}) {
        this.#velarium = velarium;
        this.#toast = toast;
        $("#settings-apply-go").addEventListener("click", () => this.#apply());
    }

    async opened() {
        if (this.#loaded) {
            return;
        }
        $("#settings-list").replaceChildren(el("p", {class: "empty", text: "Loading settings…"}));
        try {
            this.#sections = (await this.#velarium.configGet()).sections;
            this.#loaded = true;
            if (this.#open.size === 0 && this.#sections.length) {
                this.#open.add(this.#sections[0].name);
            }
            this.#render();
        } catch (error) {
            $("#settings-list").replaceChildren(el("p", {class: "empty", text: error.message}));
        }
    }

    #render() {
        const list = $("#settings-list");
        if (!this.#sections.length) {
            list.replaceChildren(el("p", {class: "empty", text: "No settings to show."}));
            return;
        }
        list.replaceChildren(...this.#sections.map((section) => this.#section(section)));
    }

    #section(section) {
        const open = this.#open.has(section.name);
        const head = el("button", {class: "section-head", "aria-expanded": String(open), onclick: () => {
            if (this.#open.has(section.name)) {
                this.#open.delete(section.name);
            } else {
                this.#open.add(section.name);
            }
            this.#render();
        }}, el("strong", {text: section.name}), el("span", {class: "chip", text: `${section.options.length}`}), icon("chevron-down"));
        return el("div", {class: `section${open ? " open" : ""}`}, head,
            open && el("div", {class: "section-body"}, section.options.map((option) => this.#row(section.name, option))));
    }

    #row(section, option) {
        const label = el("span", {class: "opt-label"}, el("strong", {text: option.displayName || option.key}),
            option.description && el("em", {text: option.description}));
        const labels = option.choiceLabels || {};
        const choices = option.choices || [];
        const set = (value) => this.#set(section, option, value);
        const name = (value) => labels[value] || (value === "true" ? "On" : value === "false" ? "Off" : value);
        let control;
        if (choices.length === 2 && choices.includes("true") && choices.includes("false")) {
            const on = option.value.trim().toLowerCase() === "true";
            control = el("button", {class: `toggle${on ? " on" : ""}`, role: "switch", "aria-checked": String(on), "aria-label": option.displayName,
                onclick: () => set(on ? "false" : "true")}, el("span", {class: "knob"}));
        } else if (option.isColor && choices.length) {
            control = el("div", {class: "swatches"}, choices.map((value) => el("button", {
                class: `swatch${value === option.value ? " selected" : ""}`, title: name(value), "aria-label": name(value),
                style: COLOR.test(value) ? `background:${value}` : false, onclick: () => set(value),
            }, value === option.value && icon("check"))));
        } else if (choices.length && choices.length <= 3) {
            control = el("div", {class: "pills"}, choices.map((value) => el("button", {
                class: value === option.value ? "active" : "", onclick: () => set(value), text: name(value)})));
        } else if (choices.length) {
            control = el("select", {"aria-label": option.displayName, onchange: (event) => set(event.target.value)},
                choices.map((value) => el("option", {value, text: name(value), selected: value === option.value})));
        } else {
            const numeric = /^-?\d+(\.\d+)?$/.test(option.value);
            const input = el("input", {type: "text", value: option.value, inputmode: numeric ? "decimal" : "text", autocomplete: "off",
                autocapitalize: "off", spellcheck: "false", "aria-label": option.displayName, enterkeyhint: "done"});
            input.addEventListener("change", () => set(input.value));
            control = el("div", {class: "textbox"}, input);
        }
        return el("div", {class: `opt${choices.length === 0 ? " stacked" : ""}`}, label, control);
    }

    async #set(section, option, value) {
        if (value === option.value) {
            return;
        }
        try {
            const reply = await this.#velarium.configSet(section, option.key, value);
            if (reply.sections?.length) {
                this.#sections = reply.sections;
            } else {
                option.value = value;
            }
            this.#dirty = true;
            $("#settings-apply").classList.remove("hidden");
            this.#render();
        } catch (error) {
            this.#toast(error.message);
            this.#render();                      // put the control back to what the box really has
        }
    }

    async #apply() {
        const button = $("#settings-apply-go");
        button.disabled = true;
        try {
            await this.#velarium.configApply();
            this.#toast("Restarting the launcher…");
            this.#dirty = false;
            this.#loaded = false;                // reload from the box once it is back
            $("#settings-apply").classList.add("hidden");
        } catch (error) {
            this.#toast(error.message);
        }
        button.disabled = false;
    }
}
