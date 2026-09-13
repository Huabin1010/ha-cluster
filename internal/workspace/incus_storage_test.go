package workspace

import (
	"os"
	"path/filepath"
	"testing"
)

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

func TestFuseDebNames(t *testing.T) {
	dir := t.TempDir()
	for _, name := range []string{
		"docker.io_27_amd64.deb",
		"fuse-overlayfs_1.13-1_amd64.deb",
		"libfuse3-3_3.14.0-5build1_amd64.deb",
		"fuse3_3.14.0-5build1_amd64.deb",
		"containerd_1.7_amd64.deb",
	} {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
	}
	got := fuseDebNames(dir)
	if len(got) != 3 {
		t.Fatalf("fuseDebNames=%v", got)
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
