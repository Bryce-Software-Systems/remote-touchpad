"""A stand-in for the Velarium launcher's control socket, for developing this web app without a Velarium box.

    python3 dev/fake_velarium.py /tmp/velarium.sock [path/to/velarium/checkout]
    go run -tags null . -bind 127.0.0.1:8099 -secret test -velarium-socket /tmp/velarium.sock
    # then open http://127.0.0.1:8099/#test in a browser (phone-sized window)

The second argument (a Velarium checkout) is only used to find the app icons.
"""
import json, os, socket, sys
path = sys.argv[1]; root = sys.argv[2] if len(sys.argv) > 2 else "."
state = {"running": False, "menu": "Main", "log": []}
MENUS = {
  "Main": [("App Store","assets/icons/appstore.png",":app"),("Internet","assets/icons/browser.png","app"),("Cable TV","assets/icons/livetv.png","app"),("Cinema","assets/icons/cinema.png","app"),("System","assets/icons/settings.png",":submenu System")],
  "System": [("Back","assets/icons/back.png",":back"),("Activation","assets/icons/activation.png","app"),("Hardware","assets/icons/hardware.png",":submenu Hardware"),("Remote Touchpad","assets/icons/remote_touchpad.png","app")],
  "Hardware": [("Back","assets/icons/back.png",":back"),("Bluetooth","assets/icons/bluetooth.png","app"),("Network","assets/icons/network.png","app"),("Storage","assets/icons/storage.png","app")],
}
def kind(cmd):
    if cmd.startswith(":submenu"): return "menu", cmd.split(" ",1)[1]
    if cmd == ":back": return "back", ""
    if cmd.startswith(":"): return "action", ""
    return "app", ""
def menus():
    out = {}
    for name, entries in MENUS.items():
        out[name] = []
        for i,(t,icon,cmd) in enumerate(entries):
            k,target = kind(cmd)
            out[name].append({"index":i,"title":t,"icon":icon,"kind":k,"target":target})
    return out
if os.path.exists(path): os.unlink(path)
srv = socket.socket(socket.AF_UNIX); srv.bind(path); srv.listen(8)
print("ready", flush=True)
while True:
    c,_ = srv.accept()
    data = c.makefile().readline()
    try: req = json.loads(data)
    except Exception: c.close(); continue
    op = req.get("op"); state["log"].append(req)
    if op == "ping": rep = {"ok": True, "version": 1}
    elif op == "menus": rep = {"ok": True, "home": "Main", "root": root, "menus": menus()}
    elif op == "status": rep = {"ok": True, "menu": state["menu"], "appRunning": state["running"]}
    elif op == "launch": state["running"] = True; rep = {"ok": True}
    elif op == "home": state["running"] = False; rep = {"ok": True}
    elif op == "power": rep = {"ok": True}
    else: rep = {"ok": False, "error": "unknown"}
    c.sendall((json.dumps(rep)+"\n").encode()); c.close()
    open(path+".log","w").write(json.dumps(state["log"]))
