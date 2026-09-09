import os
import sys
import paramiko

def test_pve():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    
    # 尝试 key
    key_path = os.path.expanduser('~/.ssh/id_rsa')
    print("Testing root@192.168.1.8 with key:", key_path)
    try:
        k = paramiko.RSAKey.from_private_key_file(key_path)
        client.connect('192.168.1.8', username='root', pkey=k, timeout=5)
        print("SUCCESS with root + id_rsa!")
        stdin, stdout, stderr = client.exec_command('uptime')
        print(stdout.read().decode())
        client.close()
        return
    except Exception as e:
        print("Failed with key:", e)

    # 尝试用户名密码
    for user in ['root', 'shuangyuan']:
        for pwd in ['123456qq', '123456', 'root', 'password']:
            try:
                client.connect('192.168.1.8', username=user, password=pwd, timeout=3)
                print(f"SUCCESS with {user} / {pwd}!")
                client.close()
                return
            except Exception as e:
                pass
    print("All direct logins to 192.168.1.8 failed.")

if __name__ == '__main__':
    test_pve()
