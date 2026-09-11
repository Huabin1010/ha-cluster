package webshell

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"golang.org/x/crypto/ssh"
)

type resizeMsg struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func isResize(typ websocket.MessageType, data []byte) (cols, rows int, ok bool) {
	if typ != websocket.MessageText {
		return 0, 0, false
	}
	var msg resizeMsg
	if json.Unmarshal(data, &msg) != nil || !strings.EqualFold(msg.Type, "resize") {
		return 0, 0, false
	}
	if msg.Cols <= 0 || msg.Rows <= 0 {
		return 0, 0, false
	}
	return msg.Cols, msg.Rows, true
}

func PipeEcho(ctx context.Context, c *websocket.Conn, banner string) {
	_ = c.Write(ctx, websocket.MessageBinary, []byte(banner))
	for {
		typ, data, err := c.Read(ctx)
		if err != nil {
			return
		}
		if _, _, ok := isResize(typ, data); ok {
			continue
		}
		if err := c.Write(ctx, websocket.MessageBinary, data); err != nil {
			return
		}
	}
}

func DialAndPipe(ctx context.Context, c *websocket.Conn, user, host string, port int, signer ssh.Signer, cols, rows int) error {
	if signer == nil {
		return fmt.Errorf("web terminal key not ready")
	}
	if cols <= 0 {
		cols = 120
	}
	if rows <= 0 {
		rows = 32
	}
	cfg := &ssh.ClientConfig{
		User:            user,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         8 * time.Second,
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return fmt.Errorf("ssh dial %s: %w", addr, err)
	}
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		return err
	}
	defer sess.Close()

	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		return fmt.Errorf("pty: %w", err)
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := sess.StderrPipe()
	if err != nil {
		return err
	}
	if err := sess.Shell(); err != nil {
		return fmt.Errorf("shell: %w", err)
	}

	var wg sync.WaitGroup
	copyOut := func(r io.Reader) {
		defer wg.Done()
		buf := make([]byte, 32*1024)
		for {
			n, err := r.Read(buf)
			if n > 0 {
				if werr := c.Write(ctx, websocket.MessageBinary, buf[:n]); werr != nil {
					return
				}
			}
			if err != nil {
				return
			}
		}
	}
	wg.Add(2)
	go copyOut(stdout)
	go copyOut(stderr)

	go func() {
		for {
			typ, data, err := c.Read(ctx)
			if err != nil {
				_ = sess.Close()
				return
			}
			if cols, rows, ok := isResize(typ, data); ok {
				_ = sess.WindowChange(rows, cols)
				continue
			}
			if _, err := stdin.Write(data); err != nil {
				return
			}
		}
	}()

	_ = sess.Wait()
	wg.Wait()
	return nil
}
