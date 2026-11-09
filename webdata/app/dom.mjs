/*
 *    This file is part of Remote-Touchpad (Velarium fork).
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 */

// Small DOM helpers. Text always goes in as text (never innerHTML), because titles, network names and search results
// come from outside this page.

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

export function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(props)) {
        if (value === false || value === null || value === undefined) {
            continue;
        }
        if (name === "class") {
            node.className = value;
        } else if (name === "text") {
            node.textContent = value;
        } else if (name.startsWith("on")) {
            node.addEventListener(name.slice(2), value);
        } else {
            node.setAttribute(name, value === true ? "" : String(value));
        }
    }
    for (const child of children.flat()) {
        if (child !== false && child !== null && child !== undefined) {
            node.append(child instanceof Node ? child : document.createTextNode(String(child)));
        }
    }
    return node;
}

export function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "ico");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
}

export function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "0:00";
    }
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, "0");
    return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export function formatWhen(timestamp) {
    return new Date(timestamp * 1000).toLocaleString([], {weekday: "short", hour: "numeric", minute: "2-digit"});
}

export function formatBytes(bytes) {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let value = bytes;
    let unit = 0;
    while (value >= 1000 && unit < units.length - 1) {
        value /= 1000;
        unit += 1;
    }
    return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), delay);
    };
}
