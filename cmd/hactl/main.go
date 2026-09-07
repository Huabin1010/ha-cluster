package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"
)

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "hactl login|projects|capacity")
		os.Exit(2)
	}
	base := getenv("HA_API", "http://127.0.0.1:8080")
	switch os.Args[1] {
	case "login":
		if len(os.Args) < 4 {
			fmt.Fprintln(os.Stderr, "hactl login USER PASS")
			os.Exit(2)
		}
		body := fmt.Sprintf(`{"username":%q,"password":%q}`, os.Args[2], os.Args[3])
		resp, err := http.Post(base+"/auth/login", "application/json", strings.NewReader(body))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		defer resp.Body.Close()
		var out map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&out)
		fmt.Println(out["token"])
	case "projects", "capacity":
		tok := getenv("HA_TOKEN", "")
		req, _ := http.NewRequest(http.MethodGet, base+"/"+os.Args[1], nil)
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		defer resp.Body.Close()
		_, _ = os.Stdout.ReadFrom(resp.Body)
	default:
		os.Exit(2)
	}
}

func getenv(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}
