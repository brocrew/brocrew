package main

import (
	"strconv"
	"testing"
)

func TestTicksFromFiletime(t *testing.T) {
	for _, tc := range []struct {
		name string
		high uint32
		low  uint32
		want string
	}{
		{"epoch", 0, 0, "504911232000000000"},
		{"last-low-word", 0, 0xffffffff, "504911236294967295"},
		{"first-high-word", 1, 0, "504911236294967296"},
		{"above-double-integer-range", 0x200000, 1, "513918431254740993"},
		// 1970-01-01 UTC, with one additional 100 ns tick.
		{"unix-epoch-plus-one", 0x019db1de, 0xd53e8001, "621355968000000001"},
		// 2024-01-01 UTC, with one additional 100 ns tick.
		{"current-era-plus-one", 0x01da3c45, 0x7689c001, "638396640000000001"},
		{"maximum", 0x24c85a5e, 0xd1c03fff, "3155378975999999999"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := ticksFromFiletime(tc.high, tc.low)
			if err != nil || strconv.FormatUint(got, 10) != tc.want {
				t.Fatalf("got %d, %v; want %s", got, err, tc.want)
			}
		})
	}
}

func TestTicksFromFiletimeRejectsOverflow(t *testing.T) {
	for _, value := range []uint64{2650467744000000000, 1 << 63, ^uint64(0)} {
		got, err := ticksFromFiletime(uint32(value>>32), uint32(value&0xffffffff))
		if err == nil || got != 0 {
			t.Fatalf("FILETIME %d: got %d, %v; want refusal", value, got, err)
		}
	}
}

func TestParsePID(t *testing.T) {
	for _, tc := range []struct {
		input string
		want  uint32
	}{
		{"1", 1}, {"0001", 1}, {"4294967295", 4294967295},
	} {
		got, err := parsePID(tc.input)
		if err != nil || got != tc.want {
			t.Fatalf("PID %q: got %d, %v; want %d", tc.input, got, err, tc.want)
		}
	}
	for _, input := range []string{"", "0", "000", "-1", "+1", " 1", "1 ", "1\n", "1.0", "1e2", "0x10", "１２", "4294967296", "18446744073709551616"} {
		if got, err := parsePID(input); err == nil || got != 0 {
			t.Fatalf("PID %q: got %d, %v; want refusal", input, got, err)
		}
	}
}
