package webshell

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"time"

	"golang.org/x/crypto/ssh"
)

const (
	DefaultExecTimeout = 60 * time.Second
	MaxExecTimeout     = 5 * time.Minute
	MaxExecOutput      = 2 << 20
)

// RunCommand opens a one-shot SSH session (no PTY) and runs command.
// Non-zero process exits are returned as exit, not err.
func RunCommand(ctx context.Context, user, host string, port int, signer ssh.Signer, command string, stdin []byte, timeout time.Duration) (stdout, stderr []byte, exit int, err error) {
	if signer == nil {
		return nil, nil, -1, fmt.Errorf("web terminal key not ready")
	}
	if timeout <= 0 {
		timeout = DefaultExecTimeout
	}
	if timeout > MaxExecTimeout {
		timeout = MaxExecTimeout
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cfg := &ssh.ClientConfig{
		User:            user,
		Auth:            []ssh.AuthMethod{ssh.PublicKeys(signer)},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         8 * time.Second,
	}
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	d := net.Dialer{Timeout: 8 * time.Second}
	raw, err := d.DialContext(runCtx, "tcp", addr)
	if err != nil {
		return nil, nil, -1, fmt.Errorf("ssh dial %s: %w", addr, err)
	}
	_ = raw.SetDeadline(time.Now().Add(timeout))

	ncc, chans, reqs, err := ssh.NewClientConn(raw, addr, cfg)
	if err != nil {
		_ = raw.Close()
		return nil, nil, -1, fmt.Errorf("ssh handshake %s: %w", addr, err)
	}
	client := ssh.NewClient(ncc, chans, reqs)
	defer client.Close()

	sess, err := client.NewSession()
	if err != nil {
		return nil, nil, -1, err
	}
	defer sess.Close()

	if len(stdin) > 0 {
		sess.Stdin = bytes.NewReader(stdin)
	}
	var outBuf, errBuf capBuffer
	outBuf.limit = MaxExecOutput
	errBuf.limit = MaxExecOutput
	sess.Stdout = &outBuf
	sess.Stderr = &errBuf

	done := make(chan error, 1)
	go func() { done <- sess.Run(command) }()

	select {
	case <-runCtx.Done():
		_ = sess.Close()
		_ = client.Close()
		return outBuf.bytes(), errBuf.bytes(), -1, fmt.Errorf("exec timeout after %s", timeout)
	case err := <-done:
		if err != nil {
			var ee *ssh.ExitError
			if errors.As(err, &ee) {
				return outBuf.bytes(), errBuf.bytes(), ee.ExitStatus(), nil
			}
			return outBuf.bytes(), errBuf.bytes(), -1, err
		}
		return outBuf.bytes(), errBuf.bytes(), 0, nil
	}
}

func FakeRun(command string, stdin []byte) (stdout, stderr []byte, exit int) {
	var b bytes.Buffer
	b.WriteString(command)
	if len(stdin) > 0 {
		b.WriteByte('\n')
		_, _ = b.Write(stdin)
	}
	return b.Bytes(), nil, 0
}

type capBuffer struct {
	buf   bytes.Buffer
	limit int
	hit   bool
}

func (c *capBuffer) Write(p []byte) (int, error) {
	if c.limit <= 0 {
		return c.buf.Write(p)
	}
	remain := c.limit - c.buf.Len()
	if remain <= 0 {
		c.hit = true
		return len(p), nil
	}
	if len(p) > remain {
		c.hit = true
		_, err := c.buf.Write(p[:remain])
		if err != nil {
			return 0, err
		}
		return len(p), nil
	}
	return c.buf.Write(p)
}

func (c *capBuffer) bytes() []byte {
	out := c.buf.Bytes()
	if c.hit {
		out = append(append([]byte{}, out...), []byte("\n...[truncated]")...)
	}
	return out
}

var _ io.Writer = (*capBuffer)(nil)
