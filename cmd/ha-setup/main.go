package main

import (
	"fmt"
	"os"
	"strings"

	"ha-cluster/internal/setup"
)

func main() {
	args := os.Args[1:]
	if len(args) == 0 {
		fmt.Fprintf(os.Stderr, `ha-setup — join ha-cluster nodes

Commands:
  detect
  join --token URL [--root DIR] [--role worker] [--power mains|battery] [--class phone|desktop] [--fabric-ip IP]
  add-node --host IP [--role worker]
`)
		os.Exit(2)
	}
	switch args[0] {
	case "detect":
		d := setup.Detect()
		fmt.Printf("os=%s arch=%s payload=%s\n", d.OS, d.GOARCH, setup.PayloadName(d.GOARCH))
	case "join":
		token := flagVal(args[1:], "--token")
		root := flagVal(args[1:], "--root")
		role := flagVal(args[1:], "--role")
		power := flagVal(args[1:], "--power")
		class := flagVal(args[1:], "--class")
		fabric := flagVal(args[1:], "--fabric-ip")
		if role == "" {
			role = "worker"
		}
		if power == "" {
			power = "mains"
		}
		if class == "" {
			class = "desktop"
		}
		spec, err := setup.ParseJoinToken(token)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		d := setup.Detect()
		if setup.ArchMismatch(d.GOARCH, d.GOARCH) {
			os.Exit(1)
		}
		if setup.RejectServerOnBattery(role, power) {
			fmt.Fprintln(os.Stderr, "refusing server role on battery node")
			os.Exit(1)
		}
		spec.RootDir = root
		spec.Role = role
		spec.Power = power
		spec.Class = class
		spec.FabricIP = fabric
		if err := setup.WriteJoinFiles(spec); err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		ipv4 := or(fabric, "10.88.0.10")
		fmt.Printf("wrote join files under %s\npayload=%s\neasytier: %v\n",
			or(root, "/var/lib/ha-setup"), setup.PayloadName(d.GOARCH), setup.EasyTierCommand(spec, ipv4))
	case "add-node":
		host := flagVal(args[1:], "--host")
		role := flagVal(args[1:], "--role")
		if role == "" {
			role = "worker"
		}
		if host == "" {
			fmt.Fprintln(os.Stderr, "--host required")
			os.Exit(1)
		}
		fmt.Printf("ssh %s 'curl -fsSL $DEPOT/ha-setup | sudo bash -s join --token $TOKEN --role %s'\n", host, role)
	default:
		os.Exit(2)
	}
}

func or(a, b string) string {
	if a == "" {
		return b
	}
	return a
}

func flagVal(args []string, name string) string {
	for i, a := range args {
		if a == name && i+1 < len(args) {
			return args[i+1]
		}
		if strings.HasPrefix(a, name+"=") {
			return strings.TrimPrefix(a, name+"=")
		}
	}
	return ""
}
