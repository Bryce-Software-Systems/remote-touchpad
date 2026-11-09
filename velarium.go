/*
 *    This file is part of Remote-Touchpad (Velarium fork).
 *
 *    Remote-Touchpad is free software: you can redistribute it and/or modify
 *    it under the terms of the GNU General Public License as published by
 *    the Free Software Foundation, either version 3 of the License, or
 *    (at your option) any later version.
 */

package main

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/net/websocket"
)

// Velarium integration: when this app runs on a Velarium box it can talk to the launcher over a per-user Unix
// socket ($XDG_RUNTIME_DIR/velarium/control.sock, newline-delimited JSON). The phone UI uses it to show the
// launcher's apps, launch them, go Home / close the running app, and to ask for power actions. Standalone (no
// socket) the UI simply hides those parts. The socket directory is private to the user, so only this user's
// processes can reach it; the phone still has to pass the websocket authentication before anything is forwarded.

const (
	velariumDialTimeout  = 500 * time.Millisecond
	velariumCallTimeout  = 4 * time.Second
	velariumMaxReplySize = 4 << 20
	velariumIconSize     = 128
)

var velariumOps = map[string]bool{
	"ping": true, "menus": true, "launch": true, "home": true, "status": true, "power": true,
}

var velariumPowerModes = map[string]bool{"shutdown": true, "restart": true, "sleep": true}

type velariumClient struct {
	socketPath string

	iconMu    sync.Mutex
	iconCache map[string]string // path|mtime -> data URL
}

func defaultVelariumSocket() string {
	runtime := os.Getenv("XDG_RUNTIME_DIR")
	if runtime == "" {
		return ""
	}
	return filepath.Join(runtime, "velarium", "control.sock")
}

func newVelariumClient(socketPath string) *velariumClient {
	return &velariumClient{socketPath: socketPath, iconCache: map[string]string{}}
}

func (c *velariumClient) roundTrip(request map[string]any, dial, total time.Duration) (map[string]any, error) {
	if c == nil || c.socketPath == "" {
		return nil, errors.New("velarium control socket not configured")
	}
	conn, err := net.DialTimeout("unix", c.socketPath, dial)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(total))
	payload, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	if _, err := conn.Write(append(payload, '\n')); err != nil {
		return nil, err
	}
	reader := bufio.NewReaderSize(conn, 64<<10)
	var line []byte
	for {
		chunk, isPrefix, err := reader.ReadLine()
		if err != nil {
			return nil, err
		}
		line = append(line, chunk...)
		if len(line) > velariumMaxReplySize {
			return nil, errors.New("velarium reply too large")
		}
		if !isPrefix {
			break
		}
	}
	var reply map[string]any
	if err := json.Unmarshal(line, &reply); err != nil {
		return nil, err
	}
	return reply, nil
}

// available reports whether a Velarium launcher is listening right now.
func (c *velariumClient) available() bool {
	reply, err := c.roundTrip(map[string]any{"op": "ping"}, velariumDialTimeout, velariumCallTimeout)
	return err == nil && reply["ok"] == true
}

// sanitize keeps only the fields each operation needs, so the phone cannot make this process forward arbitrary
// requests to the launcher.
func sanitizeVelariumRequest(raw map[string]any) (map[string]any, error) {
	op, _ := raw["op"].(string)
	if !velariumOps[op] {
		return nil, fmt.Errorf("unsupported operation %q", op)
	}
	request := map[string]any{"op": op}
	switch op {
	case "launch":
		menu, _ := raw["menu"].(string)
		index, isNumber := raw["index"].(float64)
		if menu == "" || len(menu) > 64 || !isNumber || index < 0 || index > 1000 || index != float64(int(index)) {
			return nil, errors.New("launch needs a menu name and an index")
		}
		request["menu"], request["index"] = menu, int(index)
	case "power":
		mode, _ := raw["mode"].(string)
		if !velariumPowerModes[mode] {
			return nil, fmt.Errorf("unsupported power mode %q", mode)
		}
		request["mode"] = mode
	}
	return request, nil
}

// Call forwards one phone request and returns the launcher's reply; "menus" replies get small inline icons.
func (c *velariumClient) Call(raw map[string]any) (map[string]any, error) {
	request, err := sanitizeVelariumRequest(raw)
	if err != nil {
		return nil, err
	}
	reply, err := c.roundTrip(request, velariumDialTimeout, velariumCallTimeout)
	if err != nil {
		return nil, err
	}
	if request["op"] == "menus" {
		c.attachIcons(reply)
	}
	return reply, nil
}

func (c *velariumClient) attachIcons(reply map[string]any) {
	root, _ := reply["root"].(string)
	menus, _ := reply["menus"].(map[string]any)
	if root == "" || menus == nil {
		return
	}
	for _, rawEntries := range menus {
		entries, _ := rawEntries.([]any)
		for _, rawEntry := range entries {
			entry, _ := rawEntry.(map[string]any)
			icon, _ := entry["icon"].(string)
			if entry == nil || icon == "" {
				continue
			}
			if data := c.iconDataURL(root, icon); data != "" {
				entry["iconData"] = data
			}
			delete(entry, "icon") // a filesystem path is of no use to the phone
		}
	}
}

// iconDataURL downsizes a launcher icon (only PNGs inside the Velarium directory) to a small data URL.
func (c *velariumClient) iconDataURL(root, icon string) string {
	path := icon
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	path = filepath.Clean(path)
	rel, err := filepath.Rel(filepath.Clean(root), path)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) ||
		strings.ToLower(filepath.Ext(path)) != ".png" {
		return ""
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() || info.Size() > 8<<20 {
		return ""
	}
	key := fmt.Sprintf("%s|%d", path, info.ModTime().UnixNano())
	c.iconMu.Lock()
	cached, ok := c.iconCache[key]
	c.iconMu.Unlock()
	if ok {
		return cached
	}
	file, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer file.Close()
	source, err := png.Decode(file)
	if err != nil {
		return ""
	}
	var out bytes.Buffer
	if err := png.Encode(&out, downscale(source, velariumIconSize)); err != nil {
		return ""
	}
	data := "data:image/png;base64," + base64.StdEncoding.EncodeToString(out.Bytes())
	c.iconMu.Lock()
	c.iconCache[key] = data
	c.iconMu.Unlock()
	return data
}

// downscale box-filters src to fit size x size (keeping aspect ratio); stdlib only.
func downscale(src image.Image, size int) image.Image {
	bounds := src.Bounds()
	sw, sh := bounds.Dx(), bounds.Dy()
	if sw <= size && sh <= size || sw == 0 || sh == 0 {
		return src
	}
	dw, dh := size, size
	if sw > sh {
		dh = max(1, sh*size/sw)
	} else {
		dw = max(1, sw*size/sh)
	}
	dst := image.NewNRGBA(image.Rect(0, 0, dw, dh))
	for y := 0; y < dh; y++ {
		y0, y1 := y*sh/dh, max(y*sh/dh+1, (y+1)*sh/dh)
		for x := 0; x < dw; x++ {
			x0, x1 := x*sw/dw, max(x*sw/dw+1, (x+1)*sw/dw)
			var r, g, b, a, n uint64
			for yy := y0; yy < y1; yy++ {
				for xx := x0; xx < x1; xx++ {
					pr, pg, pb, pa := src.At(bounds.Min.X+xx, bounds.Min.Y+yy).RGBA()
					r, g, b, a, n = r+uint64(pr), g+uint64(pg), b+uint64(pb), a+uint64(pa), n+1
				}
			}
			// RGBA() is alpha-premultiplied; NRGBA wants straight alpha.
			if a == 0 {
				dst.SetNRGBA(x, y, color.NRGBA{})
				continue
			}
			dst.SetNRGBA(x, y, color.NRGBA{
				R: uint8(min(255, r*255/a)), G: uint8(min(255, g*255/a)), B: uint8(min(255, b*255/a)),
				A: uint8(a * 255 / (n * 65535)),
			})
		}
	}
	return dst
}

// handleVelariumMessage answers one `v{"id":N,"op":...}` message from the phone with `{"id":N,...reply}`.
func handleVelariumMessage(ws *websocket.Conn, client *velariumClient, payload string) {
	var raw map[string]any
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		return
	}
	id := raw["id"]
	reply, err := client.Call(raw)
	if err != nil {
		reply = map[string]any{"ok": false, "error": err.Error()}
	}
	reply["id"] = id
	encoded, err := json.Marshal(reply)
	if err != nil {
		return
	}
	websocket.Message.Send(ws, string(encoded))
}
