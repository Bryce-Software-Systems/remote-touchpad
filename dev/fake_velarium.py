"""A stand-in for the Velarium launcher's control socket, for developing this web app without a Velarium box.

    python3 dev/fake_velarium.py /tmp/velarium.sock [path/to/velarium/checkout]
    go run -tags null . -bind 127.0.0.1:8099 -secret test -velarium-socket /tmp/velarium.sock
    # then open http://127.0.0.1:8099/#test in a browser (phone-sized window)

It simulates every operation the phone UI uses (apps, Now Playing, search, cast, DVR, Wi-Fi/Bluetooth/settings setup) with canned
data. The second argument (a Velarium checkout) is only used to find the app icons. Every request is appended to
<socket>.log as JSON so tests can check what the phone asked for.
"""
import json
import os
import socket
import sys
import time

path = sys.argv[1]
root = sys.argv[2] if len(sys.argv) > 2 else "."
NOW = time.time()

state = {
    "running": False, "menu": "Main", "log": [],
    "playing": None,
    "recordings": [
        {"id": "aaaaaaaaaaaa", "title": "The National", "channel": "CBC News", "startTs": NOW - 7200, "endTs": NOW - 3600,
         "status": "completed", "error": "", "playable": True},
        {"id": "bbbbbbbbbbbb", "title": "Hockey Night", "channel": "TSN 1", "startTs": NOW + 3600, "endTs": NOW + 10800,
         "status": "scheduled", "error": "", "playable": False},
        {"id": "cccccccccccc", "title": "Late Show", "channel": "CTV", "startTs": NOW - 5000, "endTs": NOW - 4000,
         "status": "failed", "error": "No data was received.", "playable": False},
    ],
    "scheduled": set(),
    "wifi": "Home-5G",
    "bt": [{"mac": "AA:BB:CC:00:00:01", "name": "Logitech K400", "paired": True, "trusted": True, "connected": True},
           {"mac": "AA:BB:CC:00:00:02", "name": "Xbox Wireless Controller", "paired": True, "trusted": True, "connected": False},
           {"mac": "AA:BB:CC:00:00:03", "name": "JBL Flip 5", "paired": False, "trusted": False, "connected": False}],
    "config": [
        {"name": "General", "options": [
            {"key": "WrapEntries", "displayName": "Wrap Around Navigation", "value": "true", "choices": ["true", "false"], "choiceLabels": {}, "isColor": False},
            {"key": "OnLaunch", "displayName": "Screen Behavior on Launch", "value": "Blank", "choices": ["Blank", "None"], "choiceLabels": {}, "isColor": False},
            {"key": "DefaultMenu", "displayName": "Startup Menu", "value": "Main", "choices": ["Main", "System", "Hardware", "Games"], "choiceLabels": {}, "isColor": False},
            {"key": "ApplicationTimeout", "displayName": "Blank Screen Duration (sec)", "value": "3", "choices": [], "choiceLabels": {}, "isColor": False}]},
        {"name": "Time & Weather", "options": [
            {"key": "Enabled", "displayName": "Enabled", "value": "true", "choices": ["true", "false"], "choiceLabels": {}, "isColor": False},
            {"key": "ClockPosition", "displayName": "Clock Position", "value": "top_right", "choices": ["top_left", "top_right"], "choiceLabels": {"top_left": "Left", "top_right": "Right"}, "isColor": False},
            {"key": "TemperatureUnit", "displayName": "Temperature Unit", "value": "C", "choices": ["C", "F"], "choiceLabels": {}, "isColor": False},
            {"key": "TimeFormat", "displayName": "Time Format", "value": "%H:%M", "choices": [], "choiceLabels": {}, "isColor": False}]},
        {"name": "Cinema", "options": [
            {"key": "AccentPrimaryColor", "displayName": "Accent Color (Primary)", "value": "#12a8ff", "isColor": True,
             "choices": ["#12a8ff", "#ff5d73", "#50dc8c", "#ffb23e", "#a78bfa", "#ffffff"],
             "choiceLabels": {"#12a8ff": "Blue", "#ff5d73": "Red", "#50dc8c": "Green", "#ffb23e": "Amber", "#a78bfa": "Violet", "#ffffff": "White"},
             "description": "Main highlight color used throughout Cinema."},
            {"key": "SkipForwardSeconds", "displayName": "Skip Forward Seconds", "value": "15", "choices": [], "choiceLabels": {}, "isColor": False,
             "description": "How far the skip-forward button jumps."}]}],
}

MENUS = {
    "Main": [("App Store", "assets/icons/appstore.png", ":app"), ("Internet", "assets/icons/browser.png", "app"),
             ("Cable TV", "assets/icons/livetv.png", "app"), ("Cinema", "assets/icons/cinema.png", "app"),
             ("System", "assets/icons/settings.png", ":submenu System")],
    "System": [("Back", "assets/icons/back.png", ":back"), ("Activation", "assets/icons/activation.png", "app"),
               ("Hardware", "assets/icons/hardware.png", ":submenu Hardware"), ("Remote Touchpad", "assets/icons/remote_touchpad.png", "app")],
    "Hardware": [("Back", "assets/icons/back.png", ":back"), ("Bluetooth", "assets/icons/bluetooth.png", "app"),
                 ("Network", "assets/icons/network.png", "app"), ("Storage", "assets/icons/storage.png", "app")],
}
CHANNELS = [{"stream_id": "10", "name": "CBC News", "category": "News"}, {"stream_id": "11", "name": "CNN", "category": "News"},
            {"stream_id": "20", "name": "TSN 1", "category": "Sports"}, {"stream_id": "21", "name": "Sportsnet", "category": "Sports"}]
PROGRAMS = {sid: [
    {"title": t, "start_ts": NOW - 600 + i * 3600, "end_ts": NOW + 3000 + i * 3600, "description": ""}
    for i, t in enumerate(("Evening News", "The National", "Late Edition", "Documentary"))] for sid in ("10", "11", "20", "21")}


def kind(command):
    if command.startswith(":submenu"):
        return "menu", command.split(" ", 1)[1]
    if command == ":back":
        return "back", ""
    return ("action", "") if command.startswith(":") else ("app", "")


def menus():
    return {name: [{"index": i, "title": t, "icon": icon, "kind": kind(cmd)[0], "target": kind(cmd)[1]}
                   for i, (t, icon, cmd) in enumerate(entries)] for name, entries in MENUS.items()}


def now_playing():
    play = state["playing"]
    if not play:
        return None
    if play["status"] == "playing":
        play["position"] = min(play["duration"] or 10 ** 9, play["position"] + (time.time() - play["at"]))
    play["at"] = time.time()
    return {k: v for k, v in play.items() if k != "at"}


def start_playing(title, subtitle, kind_, duration):
    state["running"] = True
    state["playing"] = {
        "app": "cinema" if kind_ != "live" else "livetv", "title": title, "subtitle": subtitle, "kind": kind_,
        "status": "playing", "position": 600.0 if duration else 0.0, "duration": duration, "canSeek": bool(duration),
        "hasNext": True, "hasPrev": kind_ == "episode", "at": time.time(),
        "audioTracks": [{"id": 1, "label": "English · AC3", "selected": True}, {"id": 2, "label": "Français", "selected": False}],
        "subtitleTracks": [{"id": -1, "label": "Off", "selected": True}, {"id": 4, "label": "English", "selected": False}],
    }


def handle(req):
    op = req.get("op")
    if op == "ping":
        return {"ok": True, "version": 1}
    if op == "menus":
        return {"ok": True, "home": "Main", "root": root, "menus": menus()}
    if op == "status":
        return {"ok": True, "menu": state["menu"], "appRunning": state["running"], "nowPlaying": now_playing()}
    if op == "launch":
        state["running"] = True
        if req.get("index") == 3:
            start_playing("Pilot", "The Show · S1E1", "episode", 1320.0)
        return {"ok": True}
    if op == "home":
        state["running"], state["playing"] = False, None
        return {"ok": True}
    if op == "power":
        return {"ok": True}
    if op == "nowplaying":
        return {"ok": True, "nowPlaying": now_playing()}
    if op == "player":
        play = state["playing"]
        if not play:
            return {"ok": False, "error": "that player is not answering"}
        action, value = req.get("action"), req.get("value")
        now_playing()
        if action == "toggle":
            play["status"] = "paused" if play["status"] == "playing" else "playing"
        elif action in ("play", "pause"):
            play["status"] = "playing" if action == "play" else "paused"
        elif action == "seek":
            play["position"] = max(0, play["position"] + value)
        elif action == "seekto":
            play["position"] = value
        elif action == "stop":
            state["playing"] = None
        elif action == "audio":
            for t in play["audioTracks"]:
                t["selected"] = t["id"] == value
        elif action == "subtitle":
            for t in play["subtitleTracks"]:
                t["selected"] = t["id"] == (-1 if value is None else value)
        return {"ok": True}
    if op == "search":
        q = req.get("q", "").lower()
        out = []
        if "nat" in q:
            out += [{"group": "Cinema", "kind": "cinema", "title": "National Treasure", "subtitle": "Movie · 2004", "ref": "0123456789abcdef"},
                    {"group": "Live TV", "kind": "channel", "title": "CBC News", "subtitle": "Channel · News", "ref": "10"},
                    {"group": "Live TV", "kind": "programme", "title": "The National", "subtitle": "CBC News · Tonight 9:00 PM", "ref": "10", "at": NOW + 600},
                    {"group": "Recordings", "kind": "recording", "title": "The National", "subtitle": "CBC News · recorded", "ref": "aaaaaaaaaaaa"},
                    {"group": "YouTube", "kind": "youtube", "title": "Nat Geo: Wild Planet", "subtitle": "National Geographic", "ref": "dQw4w9WgXcQ"}]
        time.sleep(0.4)
        return {"ok": True, "results": out}
    if op == "open":
        state["running"] = True
        if req.get("kind") == "cinema":
            start_playing("National Treasure", "", "movie", 7860.0)
        elif req.get("kind") in ("channel", "programme"):
            start_playing("CBC News", "The National", "live", None)
        return {"ok": True}
    if op == "cast":
        url = req.get("url", "")
        return {"ok": True, "via": "youtube" if "youtu" in url else "browser"}
    if op == "dvr":
        return {"ok": True, "recordings": state["recordings"], "freeBytes": 214_000_000_000}
    if op in ("dvr_cancel", "dvr_delete"):
        if op == "dvr_delete":
            state["recordings"] = [r for r in state["recordings"] if r["id"] != req.get("id")]
        else:
            for r in state["recordings"]:
                if r["id"] == req.get("id"):
                    r["status"] = "cancelled"
        return {"ok": True}
    if op == "dvr_channels":
        q = req.get("q", "").lower()
        return {"ok": True, "channels": [c for c in CHANNELS if q in c["name"].lower()]}
    if op == "dvr_programs":
        sid = req.get("streamId")
        return {"ok": True, "programs": [{**p, "scheduled": (sid, p["start_ts"]) in state["scheduled"]} for p in PROGRAMS.get(sid, [])]}
    if op == "dvr_schedule":
        state["scheduled"].add((req.get("streamId"), req.get("startTs")))
        return {"ok": True}
    if op == "setup_status":
        return {"ok": True, "wifi": {"available": True, "connection": state["wifi"], "type": "wifi", "internet": "full"},
                "bluetooth": {"available": True}}
    if op == "wifi_list":
        time.sleep(0.5)
        return {"ok": True, "adapter": True, "wifiEnabled": True, "ethernet": False, "networks": [
            {"ssid": state["wifi"], "signal": 82, "secured": True, "connected": True},
            {"ssid": "Neighbour", "signal": 41, "secured": True, "connected": False},
            {"ssid": "Cafe Guest", "signal": 55, "secured": False, "connected": False}]}
    if op == "wifi_connect":
        if req.get("ssid") == "Neighbour" and req.get("password") != "correct-password":
            return {"ok": False, "error": "The password was not accepted."}
        state["wifi"] = req.get("ssid")
        return {"ok": True}
    if op == "bt_list":
        time.sleep(0.6)
        return {"ok": True, "available": True, "devices": state["bt"]}
    if op == "bt_action":
        device = next((d for d in state["bt"] if d["mac"] == req.get("mac")), None)
        action = req.get("action")
        time.sleep(0.3)
        if action == "forget":
            state["bt"] = [d for d in state["bt"] if d is not device]
            return {"ok": True, "device": None}
        if action in ("pair", "connect"):
            device.update(paired=True, trusted=True, connected=True)
        elif action == "disconnect":
            device["connected"] = False
        return {"ok": True, "device": device}
    if op == "config_get":
        return {"ok": True, "sections": state["config"]}
    if op == "config_set":
        for sec in state["config"]:
            for opt in sec["options"]:
                if sec["name"] == req.get("section") and opt["key"] == req.get("key"):
                    opt["value"] = req.get("value")
        return {"ok": True, "sections": state["config"]}
    if op == "config_apply":
        return {"ok": True}
    return {"ok": False, "error": "unknown"}


if os.path.exists(path):
    os.unlink(path)
server = socket.socket(socket.AF_UNIX)
server.bind(path)
server.listen(8)
print("ready", flush=True)
while True:
    conn, _ = server.accept()
    line = conn.makefile().readline()
    try:
        request = json.loads(line)
    except ValueError:
        conn.close()
        continue
    safe = {k: ("***" if k == "password" else v) for k, v in request.items()}
    state["log"].append(safe)
    conn.sendall((json.dumps(handle(request)) + "\n").encode())
    conn.close()
    with open(path + ".log", "w") as log:
        json.dump(state["log"], log)
