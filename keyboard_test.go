package main

import (
	"strings"
	"testing"
)

func TestSanitizeKeyboardTextKeepsTypedCharactersOnly(t *testing.T) {
	cases := map[string]string{
		"Hello, World! 123 #@$%&*()_+-=[]{};:'\",.<>/?\\|`~": "Hello, World! 123 #@$%&*()_+-=[]{};:'\",.<>/?\\|`~",
		"café ñ 日本語 😀":                                       "café ñ 日本語 😀",
		"a\nb\rc\td\x1be\x00f\x7f":                           "abcdef", // Enter, Tab, Escape, NUL, DEL are keys, not text
		"x‍y‮z":                                              "xyz",    // zero-width joiner and bidi override are dropped
		"\n\t\x03":                                           "",
	}
	for in, want := range cases {
		if got := sanitizeKeyboardText(in); got != want {
			t.Errorf("sanitizeKeyboardText(%q) = %q, want %q", in, got, want)
		}
	}
	if got := sanitizeKeyboardText(strings.Repeat("a", 2000)); len(got) != keyboardTextMax {
		t.Errorf("long text not capped: %d", len(got))
	}
}
