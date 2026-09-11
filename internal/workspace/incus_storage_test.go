package workspace

import "testing"

func TestDiskSizeArg(t *testing.T) {
	const gi = 1024 * 1024 * 1024
	const mi = 1024 * 1024
	cases := []struct {
		in   int64
		want string
	}{
		{0, ""},
		{-1, ""},
		{10 * gi, "10GiB"},
		{5 * gi, "5GiB"},
		{512 * mi, "512MiB"},
		{gi + 1, "1073741825B"},
	}
	for _, tc := range cases {
		if got := diskSizeArg(tc.in); got != tc.want {
			t.Fatalf("diskSizeArg(%d)=%q want %q", tc.in, got, tc.want)
		}
	}
}

func TestParseStorageListCSV(t *testing.T) {
	raw := "default,dir\nha-disk,lvm\n"
	got := parseStorageListCSV(raw)
	if got["default"] != "dir" || got["ha-disk"] != "lvm" {
		t.Fatalf("got %#v", got)
	}
}

func TestIsBlockStorageDriver(t *testing.T) {
	if isBlockStorageDriver("dir") || isBlockStorageDriver("btrfs") {
		t.Fatal("dir/btrfs must not be treated as df-accurate block storage")
	}
	if !isBlockStorageDriver("lvm") || !isBlockStorageDriver("ZFS") {
		t.Fatal("lvm/zfs should count as block storage")
	}
}
