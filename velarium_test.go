package main

import (
	"bufio"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"net"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// fakeLauncher serves one JSON line per connection on a temporary Unix socket and records the requests it saw.
func fakeLauncher(t *testing.T, reply func(map[string]any) map[string]any) (string, *[]map[string]any) {
	t.Helper()
	dir, err := os.MkdirTemp("", "vl")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	path := filepath.Join(dir, "c.sock")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	seen := &[]map[string]any{}
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				line, err := bufio.NewReader(conn).ReadBytes('\n')
				if err != nil {
					return
				}
				var request map[string]any
				json.Unmarshal(line, &request)
				*seen = append(*seen, request)
				encoded, _ := json.Marshal(reply(request))
				conn.Write(append(encoded, '\n'))
			}()
		}
	}()
	return path, seen
}

func TestAvailableOnlyWhenLauncherAnswersPing(t *testing.T) {
	path, _ := fakeLauncher(t, func(map[string]any) map[string]any { return map[string]any{"ok": true} })
	if !newVelariumClient(path).available() {
		t.Fatal("expected available")
	}
	if newVelariumClient(filepath.Join(filepath.Dir(path), "missing.sock")).available() {
		t.Fatal("a missing socket must not be available")
	}
	if newVelariumClient("").available() {
		t.Fatal("an empty path must not be available")
	}
}

func TestSanitizeAcceptsOnlyKnownOperationsAndFields(t *testing.T) {
	good := map[string]map[string]any{
		"menus":  {"op": "menus", "evil": "x"},
		"home":   {"op": "home"},
		"launch": {"op": "launch", "menu": "Main", "index": float64(3), "extra": 1},
		"power":  {"op": "power", "mode": "restart"},
	}
	for name, raw := range good {
		got, err := sanitizeVelariumRequest(raw)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if _, leaked := got["evil"]; leaked {
			t.Fatalf("%s: unknown field was forwarded", name)
		}
		if _, leaked := got["extra"]; leaked {
			t.Fatalf("%s: unknown field was forwarded", name)
		}
	}
	bad := []map[string]any{
		{"op": "rm -rf"},
		{"op": ""},
		{"op": "launch", "menu": "Main"},
		{"op": "launch", "menu": "", "index": float64(1)},
		{"op": "launch", "menu": "Main", "index": float64(-1)},
		{"op": "launch", "menu": "Main", "index": 1.5},
		{"op": "launch", "menu": strings.Repeat("a", 65), "index": float64(0)},
		{"op": "power", "mode": "format"},
	}
	for _, raw := range bad {
		if _, err := sanitizeVelariumRequest(raw); err == nil {
			t.Fatalf("expected %v to be rejected", raw)
		}
	}
}

func TestCallForwardsOnlySanitizedRequests(t *testing.T) {
	path, seen := fakeLauncher(t, func(map[string]any) map[string]any { return map[string]any{"ok": true} })
	client := newVelariumClient(path)
	if _, err := client.Call(map[string]any{"op": "launch", "menu": "Main", "index": float64(2), "cmd": "reboot"}); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Call(map[string]any{"op": "shell"}); err == nil {
		t.Fatal("unknown op must fail before reaching the launcher")
	}
	if len(*seen) != 1 || (*seen)[0]["menu"] != "Main" || (*seen)[0]["cmd"] != nil {
		t.Fatalf("unexpected forwarded requests: %v", *seen)
	}
}

func writeTestIcon(t *testing.T, path string, size int) {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			img.SetNRGBA(x, y, color.NRGBA{R: 200, G: 50, B: 20, A: 255})
		}
	}
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	png.Encode(file, img)
}

func TestMenusRepliesGetSmallInlineIconsAndNoPaths(t *testing.T) {
	root := t.TempDir()
	os.MkdirAll(filepath.Join(root, "assets", "icons"), 0o755)
	writeTestIcon(t, filepath.Join(root, "assets", "icons", "app.png"), 512)
	outside := filepath.Join(t.TempDir(), "secret.png")
	writeTestIcon(t, outside, 64)
	path, _ := fakeLauncher(t, func(map[string]any) map[string]any {
		return map[string]any{"ok": true, "root": root, "menus": map[string]any{"Main": []any{
			map[string]any{"title": "App", "icon": "assets/icons/app.png"},
			map[string]any{"title": "Escape", "icon": "../" + filepath.Base(outside)},
			map[string]any{"title": "Abs", "icon": outside},
			map[string]any{"title": "NotPng", "icon": "assets/icons/app.txt"},
		}}}
	})
	reply, err := newVelariumClient(path).Call(map[string]any{"op": "menus"})
	if err != nil {
		t.Fatal(err)
	}
	entries := reply["menus"].(map[string]any)["Main"].([]any)
	first := entries[0].(map[string]any)
	data, _ := first["iconData"].(string)
	if !strings.HasPrefix(data, "data:image/png;base64,") {
		t.Fatalf("expected an inline icon, got %q", data)
	}
	raw, _ := base64.StdEncoding.DecodeString(strings.TrimPrefix(data, "data:image/png;base64,"))
	decoded, err := png.Decode(strings.NewReader(string(raw)))
	if err != nil || decoded.Bounds().Dx() != velariumIconSize {
		t.Fatalf("icon not downscaled to %d: %v %v", velariumIconSize, err, decoded)
	}
	for i, entry := range entries {
		item := entry.(map[string]any)
		if _, hasPath := item["icon"]; hasPath {
			t.Fatalf("entry %d still carries a filesystem path", i)
		}
		if i > 0 {
			if _, has := item["iconData"]; has {
				t.Fatalf("entry %d outside the Velarium directory / not a png must not be read", i)
			}
		}
	}
}

func TestDownscaleKeepsSmallImagesAndAspectRatio(t *testing.T) {
	small := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	if downscale(small, 128) != image.Image(small) {
		t.Fatal("images already small enough are returned as is")
	}
	wide := image.NewNRGBA(image.Rect(0, 0, 400, 100))
	got := downscale(wide, 128).Bounds()
	if got.Dx() != 128 || got.Dy() != 32 {
		t.Fatalf("aspect ratio lost: %v", got)
	}
}
